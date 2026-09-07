#pragma once

#include "VirtualGeometryHierarchy.hpp"
#include "GLIndirectCompaction.hpp"
#include "threepp/core/BufferGeometry.hpp"
#include "threepp/core/InterleavedBufferAttribute.hpp"
#include "threepp/renderers/gl/GLState.hpp"
#include <chrono>
#include <cstdio>
#include <future>
#include <bit>
#include <list>
#include <memory>
#include <unordered_map>

#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>
#endif

namespace threepp::gl {

// Optional lossy detail selection. This owns derived indices only; application
// vertices, attributes and shader programs continue through the normal renderer.
class GLAdaptiveGeometry {
public:
    float pixelError = 0;
    uint64_t draws{}, builds{}, pending{}, bytes{}, failed{};
    uint64_t reused{}, commandBytes{};

    bool draw(BufferGeometry& geometry, const Matrix4& clip, int first, int count,
              const Vector4& viewport, GLState& state, GLuint instancesBuffer, unsigned instances,
              unsigned instanceVersion=0, uint64_t instanceGeneration=0) {
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
        if (!(pixelError > 0) || !std::isfinite(pixelError) || !instances ||
            first != 0 || count < 768 || uint64_t(count) * instances < 12288 || !geometry.getIndex() || count != geometry.getIndex()->count() ||
            !geometry.groups.empty() || !geometry.getMorphAttributes().empty() ||
            !(viewport.z > 0 && viewport.w > 0) || !initialize()) return false;
        for (float v : clip.elements) if (!std::isfinite(v)) return false;
        auto* position = geometry.getAttribute<float>("position");
        auto* index = geometry.getIndex();
        if (!position || position->itemSize() != 3 || position->normalized() ||
            index->getUsage() != DrawUsage::Static || count > 1000000 || position->count() > 350000) return false;
        std::vector<std::pair<std::string, FloatBufferAttribute*>> attributes;
        unsigned channels = 0;
        for (const auto& [name, attribute] : geometry.getAttributes()) {
            auto* floats = dynamic_cast<FloatBufferAttribute*>(attribute.get());
            if (!floats || floats->itemSize() < 1 || floats->itemSize() > 4 || dynamic_cast<InterleavedBufferAttribute*>(floats) || floats->normalized() || floats->getUsage() != DrawUsage::Static ||
                floats->count() != position->count()) return false;
            // Arbitrary shader attributes are not covered by the stock-material
            // simplification metric. Unsupported layouts use exact geometry.
            if (name != "position" && name != "normal" && name != "uv" && name != "uv2" && name != "color" && name != "tangent") return false;
            attributes.emplace_back(name, floats);
            if (name != "position") channels += floats->itemSize();
        }
        if (channels > 32) return false;
        std::sort(attributes.begin(), attributes.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
        std::vector<unsigned> revision{geometry.attributesVersion(), index->version};
        for (auto& a : attributes) revision.push_back(a.second->version);
        auto found = cache_.find(geometry.id);
        if (found != cache_.end() && found->second->revision != revision) {
            if(std::getenv("THREEBROWSER_ADAPTIVE_TRACE")) std::fprintf(stderr,"adaptive invalidate %u\n",geometry.id);
            bytes -= found->second->bytes;
            cache_.erase(found);
            found = cache_.end();
        }
        // Only one immutable snapshot is cooked at a time. No GL calls, live
        // geometry pointers or application code cross the worker boundary.
        if (job_.valid() && job_.wait_for(std::chrono::seconds(0)) == std::future_status::ready) {
            auto result = job_.get();
            pending = 0;
            auto destination = cache_.find(jobOwner_);
            if (destination != cache_.end() && destination->second->serial == jobSerial_) {
                auto& entry = *destination->second;
                const size_t cost = result.nodes.size() * (64 + 20) + result.indices.size() * 4;
                if (result.nodes.empty() || cost > budget_) { entry.failed = true; ++failed; }
                else {
                    while (bytes + cost > budget_) {
                        auto oldest = cache_.end();
                        for (auto it = cache_.begin(); it != cache_.end(); ++it)
                            if (it != destination && it->second->bytes && (oldest == cache_.end() || it->second->used < oldest->second->used)) oldest = it;
                        // Do not repeatedly evict/re-cook the active working
                        // set. Recently used pages keep residency; other meshes
                        // use the exact path until capacity becomes available.
                        if (oldest == cache_.end() || serial_-oldest->second->used<4096) break;
                        if(std::getenv("THREEBROWSER_ADAPTIVE_TRACE")) std::fprintf(stderr,"adaptive evict %u bytes=%zu age=%llu\n",oldest->first,oldest->second->bytes,static_cast<unsigned long long>(serial_-oldest->second->used));
                        bytes -= oldest->second->bytes;
                        cache_.erase(oldest);
                    }
                    if(bytes+cost>budget_) {
                        entry.requiredBytes=cost;
                    } else {
                    upload(entry, result);
                    if(std::getenv("THREEBROWSER_ADAPTIVE_TRACE")) std::fprintf(stderr,"adaptive cooked %u nodes=%u bytes=%zu\n",destination->first,entry.count,entry.bytes);
                    bytes += entry.bytes;
                    ++builds;
                    }
                }
            }
            // Upload/eviction can invalidate the lookup made above.
            found = cache_.find(geometry.id);
        }
        if (found == cache_.end()) {
            if (cache_.size() >= 256) {
                auto oldest = std::min_element(cache_.begin(), cache_.end(), [](const auto& a, const auto& b) { return a.second->used < b.second->used; });
                bytes -= oldest->second->bytes;
                cache_.erase(oldest);
            }
            auto entry = std::make_unique<Entry>();
            entry->revision = std::move(revision);
            entry->serial = ++serial_;
            entry->subscription = geometry.subscribe("dispose", [this, id=geometry.id](Event&) {
                auto it = cache_.find(id);
                if (it != cache_.end()) { bytes -= it->second->bytes; cache_.erase(it); }
            });
            found = cache_.emplace(geometry.id, std::move(entry)).first;
        }
        auto& entry = *found->second;
        entry.used = ++serial_;
        if (!entry.nodes) {
            if (!job_.valid() && !entry.failed && (!entry.requiredBytes || bytes+entry.requiredBytes<=budget_)) {
                VirtualGeometryCookInput snapshot;
                snapshot.positions = position->array();
                snapshot.indices = index->array();
                snapshot.attributes.resize(size_t(position->count()) * channels);
                snapshot.attributeWeights.assign(channels, 1.f);
                unsigned offset = 0;
                for (const auto& [name, attribute] : attributes) if (name != "position") {
                    for (unsigned v = 0; v < unsigned(position->count()); ++v)
                        for (unsigned c = 0; c < attribute->itemSize(); ++c)
                            snapshot.attributes[size_t(v) * channels + offset + c] = attribute->array()[size_t(v) * attribute->itemSize() + c];
                    offset += attribute->itemSize();
                }
                jobOwner_ = geometry.id; jobSerial_ = entry.serial;
                job_ = std::async(std::launch::async, [snapshot=std::move(snapshot)] {
                    try { return cookVirtualGeometryHierarchy(snapshot); }
                    catch (...) { return VirtualGeometryHierarchy{}; }
                });
                pending = 1;
            }
            return false;
        }
        const uint64_t commandCount = uint64_t(entry.count) * instances;
        if (commandCount > 262144) return false;
        SelectionKey key{};
        for(unsigned i=0;i<16;++i) key[i]=std::bit_cast<uint32_t>(clip.elements[i]);
        key[16]=std::bit_cast<uint32_t>(viewport.z); key[17]=std::bit_cast<uint32_t>(viewport.w);
        key[18]=std::bit_cast<uint32_t>(pixelError);
        key[19]=uint32_t(entry.serial); key[20]=uint32_t(entry.serial>>32);
        key[21]=instancesBuffer; key[22]=instances; key[23]=instanceVersion;
        key[24]=uint32_t(instanceGeneration); key[25]=uint32_t(instanceGeneration>>32);
        auto& commands=selection(key,commandCount*20,((commandCount+255)/256+1)*4);
        if(commands.ready) {
            GLint oldIndex=0,oldIndirect=0;
            glGetIntegerv(GL_ELEMENT_ARRAY_BUFFER_BINDING,&oldIndex);
            glGetIntegerv(0x8F43,&oldIndirect);
            glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,entry.indices);
            glBindBuffer(0x8F3F,commands.buffer);
            if(!compactor_.draw(commands.countBuffer,commandCount)) multiDraw_(GL_TRIANGLES,GL_UNSIGNED_INT,nullptr,commandCount,20);
            glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,oldIndex);
            glBindBuffer(0x8F3F,oldIndirect);
            ++reused; ++draws;
            return true;
        }
        // Shared scratch commands are bounded. GPU ordering/barriers protect
        // alternating cameras and instance owners without a CPU readback.
        GLint previousArray = 0, previousIndirect = 0, previousIndex = 0, previousStorage = 0;
        glGetIntegerv(GL_ARRAY_BUFFER_BINDING, &previousArray);
        glGetIntegerv(0x8F43, &previousIndirect);
        glGetIntegerv(GL_ELEMENT_ARRAY_BUFFER_BINDING, &previousIndex);
        glGetIntegerv(0x90D3, &previousStorage);
        GLint bindings[3]; GLint64 starts[3], sizes[3];
        for (unsigned i=0; i<3; ++i) {
            glGetIntegeri_v(0x90D3, i, &bindings[i]);
            glGetInteger64i_v(0x90D4, i, &starts[i]);
            glGetInteger64i_v(0x90D5, i, &sizes[i]);
        }
        const auto oldProgram = state.currentProgram;
        state.useProgram(program_);
        glUniformMatrix4fv(clipLocation_, 1, GL_FALSE, clip.elements.data());
        glUniform2f(viewLocation_, viewport.z, viewport.w);
        glUniform1f(errorLocation_, pixelError);
        glUniform1ui(countLocation_, entry.count);
        glUniform1ui(commandsLocation_, commandCount);
        glUniform1ui(instancesLocation_, instancesBuffer ? 1 : 0);
        glBindBufferBase(0x90D2, 0, entry.nodes);
        glBindBufferBase(0x90D2, 1, commands.buffer);
        glBindBufferBase(0x90D2, 2, instancesBuffer);
        barrier_(0x2000);
        dispatch_((commandCount + 63) / 64, 1, 1);
        barrier_(0x40 | 0x2000);
        compactor_.compact(commands.buffer,commands.countBuffer,commandCount,state);
        state.useProgram(oldProgram.value_or(0));
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, entry.indices);
        glBindBuffer(0x8F3F, commands.buffer);
        if(!compactor_.draw(commands.countBuffer,commandCount)) multiDraw_(GL_TRIANGLES, GL_UNSIGNED_INT, nullptr, commandCount, 20);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, previousIndex);
        glBindBuffer(0x8F3F, previousIndirect);
        for (unsigned i=0; i<3; ++i) {
            if (bindings[i] && sizes[i] > 0) glBindBufferRange(0x90D2, i, bindings[i], starts[i], sizes[i]);
            else glBindBufferBase(0x90D2, i, bindings[i]);
        }
        glBindBuffer(0x90D2, previousStorage);
        commands.ready=true;
        ++draws;
        return true;
#else
        return false;
#endif
    }

    void dispose() {
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
        cache_.clear(); // subscriptions and GL storage released on context thread
        if (program_) glDeleteProgram(program_);
        selections_.clear(); selectionIndex_.clear(); commandBytes=0;
        compactor_.dispose();
        program_ = 0; initialized_ = false;
        // A pending CPU-only cook may finish; its serial can no longer attach.
#endif
        draws = builds = bytes = failed = reused = 0;
    }

private:
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
    struct Entry {
        GLuint nodes{}, indices{};
        unsigned count{};
        uint64_t serial{}, used{};
        size_t bytes{};
        size_t requiredBytes{};
        bool failed{};
        std::vector<unsigned> revision;
        Subscription subscription;
        ~Entry() { if (nodes) glDeleteBuffers(1, &nodes); if (indices) glDeleteBuffers(1, &indices); }
    };
    static constexpr size_t budget_ = 64 * 1024 * 1024;
    std::unordered_map<unsigned, std::unique_ptr<Entry>> cache_;
    std::future<VirtualGeometryHierarchy> job_;
    unsigned jobOwner_{};
    uint64_t jobSerial_{}, serial_{};
    GLuint program_{};
    using SelectionKey=std::array<uint32_t,26>;
    struct KeyHash {
        size_t operator()(const SelectionKey& key) const {
            size_t hash=1469598103934665603ull;
            for(auto value:key) hash=(hash^value)*1099511628211ull;
            return hash;
        }
    };
    struct Commands {
        SelectionKey key{};
        GLuint buffer{},countBuffer{};
        size_t bytes{};
        bool ready{};
        ~Commands() { if(buffer) glDeleteBuffers(1,&buffer); if(countBuffer) glDeleteBuffers(1,&countBuffer); }
    };
    std::list<Commands> selections_;
    std::unordered_map<SelectionKey,std::list<Commands>::iterator,KeyHash> selectionIndex_;
    GLIndirectCompaction compactor_;
    Commands& selection(const SelectionKey& key,size_t size,size_t counterBytes) {
        auto found=selectionIndex_.find(key);
        if(found!=selectionIndex_.end()) {
            selections_.splice(selections_.end(),selections_,found->second);
            return *found->second;
        }
        static constexpr size_t commandBudget=64*1024*1024;
        while(!selections_.empty() && (commandBytes+size+counterBytes>commandBudget || selections_.size()>=1024)) {
            auto& oldest=selections_.front();
            commandBytes-=oldest.bytes;
            selectionIndex_.erase(oldest.key);
            selections_.pop_front();
        }
        auto& result=selections_.emplace_back();
        result.key=key; result.bytes=size+counterBytes;
        GLint old=0; glGetIntegerv(GL_ARRAY_BUFFER_BINDING,&old);
        glGenBuffers(1,&result.buffer); glBindBuffer(GL_ARRAY_BUFFER,result.buffer);
        glBufferData(GL_ARRAY_BUFFER,size,nullptr,GL_DYNAMIC_DRAW);
        glBindBuffer(GL_ARRAY_BUFFER,old);
        commandBytes+=result.bytes;
        selectionIndex_.emplace(key,std::prev(selections_.end()));
        return result;
    }
    bool initialized_{};
    using Dispatch = void(APIENTRY*)(GLuint, GLuint, GLuint);
    using Barrier = void(APIENTRY*)(GLbitfield);
    using MultiDraw = void(APIENTRY*)(GLenum, GLenum, const void*, GLsizei, GLsizei);
    Dispatch dispatch_{}; Barrier barrier_{}; MultiDraw multiDraw_{};
    GLint clipLocation_{}, viewLocation_{}, errorLocation_{}, countLocation_{}, commandsLocation_{}, instancesLocation_{};

    void upload(Entry& entry, const VirtualGeometryHierarchy& hierarchy) {
        static_assert(sizeof(VirtualGeometryHierarchy::Node) == 64);
        GLint old = 0; glGetIntegerv(GL_ARRAY_BUFFER_BINDING, &old);
        glGenBuffers(1, &entry.nodes); glBindBuffer(GL_ARRAY_BUFFER, entry.nodes);
        glBufferData(GL_ARRAY_BUFFER, hierarchy.nodes.size() * 64, hierarchy.nodes.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &entry.indices); glBindBuffer(GL_ARRAY_BUFFER, entry.indices);
        glBufferData(GL_ARRAY_BUFFER, hierarchy.indices.size() * 4, hierarchy.indices.data(), GL_STATIC_DRAW);
        glBindBuffer(GL_ARRAY_BUFFER, old);
        entry.count = hierarchy.nodes.size();
        entry.bytes = hierarchy.nodes.size() * 64 + hierarchy.indices.size() * 4;
    }

    bool initialize() {
        if (initialized_) return program_ != 0;
        initialized_ = true;
        GLint major=0, minor=0;
        glGetIntegerv(GL_MAJOR_VERSION, &major); glGetIntegerv(GL_MINOR_VERSION, &minor);
        if (major < 4 || (major == 4 && minor < 3)) return false;
        dispatch_ = reinterpret_cast<Dispatch>(glfwGetProcAddress("glDispatchCompute"));
        barrier_ = reinterpret_cast<Barrier>(glfwGetProcAddress("glMemoryBarrier"));
        multiDraw_ = reinterpret_cast<MultiDraw>(glfwGetProcAddress("glMultiDrawElementsIndirect"));
        if (!dispatch_ || !barrier_ || !multiDraw_) return false;
        const char* source = R"GLSL(#version 430 core
layout(local_size_x=64) in;
struct Node { vec4 lo; vec4 hi; uvec4 draw; uvec4 tree; };
layout(std430,binding=0) readonly buffer Nodes { Node nodes[]; };
struct Draw { uint count; uint instances; uint first; uint baseVertex; uint baseInstance; };
layout(std430,binding=1) writeonly buffer Commands { Draw commands[]; };
layout(std430,binding=2) readonly buffer Transforms { mat4 transforms[]; };
uniform mat4 clip;
uniform vec2 viewport;
uniform float pixelError;
uniform uint nodeCount, commandCount, instanced;
bool acceptable(Node n, mat4 m) {
    if (n.tree.x == 0xffffffffu) return true;
    if (n.draw.y == 0u) return false;
    vec4 c=m*vec4((n.lo.xyz+n.hi.xyz)*0.5,1);
    vec3 h=(n.hi.xyz-n.lo.xyz)*0.5;
    mat4 t=transpose(m);
    float e=n.lo.w;
    float minW=c.w-dot(abs(t[3].xyz),h)-e*length(t[3].xyz);
    // Near-plane intersections must descend, including orthographic views.
    vec4 nearPlane=t[3]+t[2];
    if (minW <= 1e-5 || dot(nearPlane,vec4((n.lo.xyz+n.hi.xyz)*0.5,1))-dot(abs(nearPlane.xyz),h) <= e*length(nearPlane.xyz)) return false;
    vec2 ndc=(abs(c.xy)+vec2(dot(abs(t[0].xyz),h),dot(abs(t[1].xyz),h)))/minW;
    vec2 projected=e*(vec2(length(t[0].xyz),length(t[1].xyz))+ndc*length(t[3].xyz))/minW*viewport*0.5;
    return !any(isnan(projected)) && !any(isinf(projected)) && max(projected.x,projected.y)<=pixelError;
}
bool visible(Node n, mat4 m) {
    mat4 t=transpose(m);
    for(int axis=0;axis<3;++axis) for(int sign=-1;sign<=1;sign+=2) {
        vec4 p=t[3]+float(sign)*t[axis];
        vec3 support=mix(n.lo.xyz,n.hi.xyz,greaterThanEqual(p.xyz,vec3(0)));
        float tolerance=1e-4*(1+dot(abs(p.xyz),abs(support))+abs(p.w));
        if(dot(p,vec4(support,1)) < -tolerance) return false;
    }
    return true;
}
void main() {
    uint id=gl_GlobalInvocationID.x;
    if(id>=commandCount) return;
    uint node=id%nodeCount, instance=id/nodeCount;
    mat4 m=instanced!=0u ? clip*transforms[instance] : clip;
    Node n=nodes[node];
    bool selected=acceptable(n,m) && visible(n,m);
    // Exactly one cut: test every ancestor, even an unsimplifiable parent.
    for(uint p=n.draw.z; p!=0xffffffffu && selected; p=nodes[p].draw.z)
        if(acceptable(nodes[p],m)) selected=false;
    commands[id].count=selected?n.draw.y:0u;
    commands[id].instances=1u;
    commands[id].first=n.draw.x;
    commands[id].baseVertex=0u;
    commands[id].baseInstance=instance;
})GLSL";
        GLuint shader=glCreateShader(0x91B9);
        glShaderSource(shader,1,&source,nullptr); glCompileShader(shader);
        GLint ok=0; glGetShaderiv(shader,GL_COMPILE_STATUS,&ok);
        if(ok) {
            program_=glCreateProgram(); glAttachShader(program_,shader); glLinkProgram(program_);
            glGetProgramiv(program_,GL_LINK_STATUS,&ok);
        }
        if(!ok) {
            char message[2048]{};
            if(program_) glGetProgramInfoLog(program_,sizeof(message),nullptr,message);
            else glGetShaderInfoLog(shader,sizeof(message),nullptr,message);
            std::fprintf(stderr,"Adaptive Geometry unavailable: %s\n",message);
            if(program_) glDeleteProgram(program_); program_=0;
        }
        glDeleteShader(shader);
        if(program_) {
            clipLocation_=glGetUniformLocation(program_,"clip"); viewLocation_=glGetUniformLocation(program_,"viewport");
            errorLocation_=glGetUniformLocation(program_,"pixelError"); countLocation_=glGetUniformLocation(program_,"nodeCount");
            commandsLocation_=glGetUniformLocation(program_,"commandCount"); instancesLocation_=glGetUniformLocation(program_,"instanced");
        }
        return program_!=0;
    }
#endif
};
}
