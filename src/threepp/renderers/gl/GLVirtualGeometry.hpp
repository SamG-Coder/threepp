#ifndef THREEPP_GL_VIRTUAL_GEOMETRY_HPP
#define THREEPP_GL_VIRTUAL_GEOMETRY_HPP

#include "threepp/core/BufferGeometry.hpp"
#include "threepp/math/Frustum.hpp"
#include "threepp/renderers/gl/GLState.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <unordered_map>
#include <vector>

#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>
#endif

namespace threepp::gl {

// Full-detail, order-preserving cluster submission. Source vertex/index buffers,
// shaders, render targets and fixed-function state remain owned by GLRenderer.
// No application shaders or scene-specific rules are compiled here.
class GLVirtualGeometry {
public:
    struct Statistics {
        uint64_t draws{}, clusters{}, builds{}, fallback{}, cacheBytes{}, dispatches{}, reused{};
        uint64_t shaderFallback{}, topologyFallback{}, smallFallback{}, visibleFallback{};
    } stats;

    bool enabled = false;

    bool draw(BufferGeometry& geometry, const Matrix4& clipFromLocal,
              int first, int count, GLState& state, GLuint instanceBuffer = 0, unsigned instances = 1,
              unsigned instanceVersion = 0, unsigned instanceOwner = 0) {
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
        if (uint64_t(count) * instances < 12288) {
            ++stats.fallback;
            ++stats.smallFallback;
            return false;
        }
        if (!enabled || instances == 0 || first % 3 || count % 3 || !initialize()) {
            ++stats.fallback;
            return false;
        }
        auto* position = geometry.getAttribute<float>("position");
        auto* index = geometry.getIndex();
        if (!position || !index || position->itemSize() != 3 || position->normalized() ||
            position->getUsage() != DrawUsage::Static || index->getUsage() != DrawUsage::Static ||
            first < 0 || uint64_t(first) + count > uint64_t(index->count())) {
            ++stats.fallback;
            return false;
        }
        auto found = cache_.find(geometry.id);
        if (found != cache_.end() && (found->second->structure != geometry.attributesVersion() ||
            found->second->positionVersion != position->version ||
            found->second->indexVersion != index->version)) {
            erase(found);
            found = cache_.end();
        }
        if (found == cache_.end()) {
            // Bound first-use work and residency. Oversized/dynamic geometry uses
            // the ordinary renderer; it is never truncated to meet a budget.
            if (index->count() > 3000000) { ++stats.fallback; return false; }
            auto entry = build(*position, *index);
            if (!entry) { ++stats.fallback; return false; }
            while (!cache_.empty() && residentBytes_ + entry->bytes > budget_) {
                auto oldest = std::min_element(cache_.begin(), cache_.end(),
                    [](const auto& a, const auto& b) { return a.second->lastUse < b.second->lastUse; });
                erase(oldest);
            }
            entry->structure = geometry.attributesVersion();
            entry->positionVersion = position->version;
            entry->indexVersion = index->version;
            entry->generation = ++serial_;
            entry->subscription = geometry.subscribe("dispose", [this, id = geometry.id](Event&) {
                auto it = cache_.find(id);
                if (it != cache_.end()) erase(it);
            });
            residentBytes_ += entry->bytes;
            found = cache_.emplace(geometry.id, std::move(entry)).first;
            ++stats.builds;
            stats.cacheBytes = residentBytes_ + instanceCommandBytes_;
        }
        auto& entry = *found->second;
        entry.lastUse = ++serial_;
        const uint64_t commandCount = uint64_t(entry.clusters) * instances;
        if (commandCount > 262144) { ++stats.fallback; return false; }
        Selection key{true, clipFromLocal.elements, first, count, instances, instanceBuffer,
                      instanceVersion, instanceOwner, entry.generation};
        auto selected = std::find_if(entry.selections.begin(), entry.selections.end(),
            [&](const auto& selection) { return selection.key == key; });
        if (selected == entry.selections.end()) selected = std::min_element(entry.selections.begin(), entry.selections.end(),
            [](const auto& a, const auto& b) { return a.lastUse < b.lastUse; });
        selected->lastUse = ++serial_;
        GLuint commands = entry.commands[std::distance(entry.selections.begin(), selected)];
        if (instanceBuffer) {
            const size_t bytes = commandCount * 20;
            if (bytes > instanceCommandBytes_) {
                GLint previous = 0;
                glGetIntegerv(GL_ARRAY_BUFFER_BINDING, &previous);
                if (!instanceCommands_) glGenBuffers(1, &instanceCommands_);
                glBindBuffer(GL_ARRAY_BUFFER, instanceCommands_);
                glBufferData(GL_ARRAY_BUFFER, bytes, nullptr, GL_DYNAMIC_DRAW);
                glBindBuffer(GL_ARRAY_BUFFER, previous);
                instanceCommandBytes_ = bytes;
                instanceSelection_.valid = false;
                stats.cacheBytes = residentBytes_ + instanceCommandBytes_;
            }
            commands = instanceCommands_;
        }
        auto& previousSelection = instanceBuffer ? instanceSelection_ : selected->key;
        if (previousSelection == key) {
            GLint previousIndirect = 0;
            glGetIntegerv(0x8F43, &previousIndirect);
            glBindBuffer(indirectTarget, commands);
            multiDraw_(GL_TRIANGLES, GL_UNSIGNED_INT, nullptr, commandCount, 20);
            glBindBuffer(indirectTarget, previousIndirect);
            ++stats.draws;
            ++stats.reused;
            stats.clusters += commandCount;
            return true;
        }
        Frustum frustum;
        frustum.setFromProjectionMatrix(clipFromLocal);
        std::array<float, 24> planes;
        for (unsigned i = 0; i < 6; ++i) {
            const auto& p = frustum.planes()[i];
            planes[i * 4] = p.normal.x;
            planes[i * 4 + 1] = p.normal.y;
            planes[i * 4 + 2] = p.normal.z;
            planes[i * 4 + 3] = p.constant;
            // Degenerate/infinite projections must not feed NaNs to culling.
            for (unsigned j = 0; j < 4; ++j) {
                if (!std::isfinite(planes[i * 4 + j])) { ++stats.fallback; return false; }
            }
        }
        bool whollyInside = !instanceBuffer;
        for (unsigned p = 0; p < 6 && whollyInside; ++p) {
            float minimum = planes[p * 4 + 3];
            for (unsigned j = 0; j < 3; ++j)
                minimum += planes[p * 4 + j] * (planes[p * 4 + j] >= 0 ? entry.root.lo[j] : entry.root.hi[j]);
            whollyInside = minimum > 1e-3f;
        }
        // A fully visible object cannot benefit from finer frustum rejection.
        // Retain its single original draw instead of launching redundant compute.
        if (whollyInside) { ++stats.fallback; ++stats.visibleFallback; return false; }
        GLint previousStorage, previousIndirect, previous0, previous1, previous2;
        glGetIntegerv(storageBinding, &previousStorage);
        glGetIntegerv(0x8F43 /* DRAW_INDIRECT_BUFFER_BINDING */, &previousIndirect);
        glGetIntegeri_v(storageBinding, 0, &previous0);
        glGetIntegeri_v(storageBinding, 1, &previous1);
        glGetIntegeri_v(storageBinding, 2, &previous2);
        // Preserve range bindings too, not just buffer names.
        GLint64 starts[3], sizes[3];
        for (unsigned i = 0; i < 3; ++i) {
            glGetInteger64i_v(0x90D4, i, &starts[i]);
            glGetInteger64i_v(0x90D5, i, &sizes[i]);
        }
        const auto previousProgram = state.currentProgram;
        state.useProgram(program_);
        glUniform4fv(planeLocation_, 6, planes.data());
        glUniform2ui(rangeLocation_, first, first + count);
        glUniform1ui(clusterLocation_, entry.clusters);
        glUniform1ui(commandLocation_, commandCount);
        glUniform1ui(instancedLocation_, instanceBuffer ? 1 : 0);
        glBindBufferBase(storageTarget, 0, entry.bounds);
        glBindBufferBase(storageTarget, 1, commands);
        glBindBufferBase(storageTarget, 2, instanceBuffer);
        // A previous camera/group can still be reading this command buffer.
        barrier_(0x2000 /* SHADER_STORAGE_BARRIER_BIT */);
        dispatch_((commandCount + 63) / 64, 1, 1);
        ++stats.dispatches;
        barrier_(0x40 /* COMMAND_BARRIER_BIT */ | 0x2000 /* SHADER_STORAGE_BARRIER_BIT */);
        state.useProgram(previousProgram.value_or(0));
        glBindBuffer(indirectTarget, commands);
        multiDraw_(GL_TRIANGLES, GL_UNSIGNED_INT, nullptr, commandCount, 20);
        glBindBuffer(indirectTarget, previousIndirect);
        const GLint previous[3]{previous0, previous1, previous2};
        for (unsigned i = 0; i < 3; ++i) {
            if (previous[i] && sizes[i] > 0)
                glBindBufferRange(storageTarget, i, previous[i], starts[i], sizes[i]);
            else glBindBufferBase(storageTarget, i, previous[i]);
        }
        glBindBuffer(storageTarget, previousStorage);
        previousSelection = key;
        ++stats.draws;
        stats.clusters += commandCount;
        stats.cacheBytes = residentBytes_ + instanceCommandBytes_;
        return true;
#else
        ++stats.fallback;
        return false;
#endif
    }

    void dispose() {
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
        cache_.clear();
        residentBytes_ = 0;
        if (instanceCommands_) glDeleteBuffers(1, &instanceCommands_);
        instanceCommands_ = 0;
        instanceCommandBytes_ = 0;
        instanceSelection_.valid = false;
        if (program_) glDeleteProgram(program_);
        program_ = 0;
        initialized_ = false;
#endif
        stats = {};
    }

private:
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
    static constexpr GLenum storageTarget = 0x90D2, storageBinding = 0x90D3, indirectTarget = 0x8F3F;
    static constexpr size_t budget_ = 32 * 1024 * 1024;
    // Each entry describes a contiguous 64-triangle range in the ORIGINAL index
    // buffer. Keeping ranges in input order preserves equal-depth tie ordering.
    struct Bounds { float lo[4], hi[4]; };
    struct Selection {
        bool valid{};
        std::array<float, 16> clip{};
        int first{}, count{};
        unsigned instances{}, instanceBuffer{}, instanceVersion{}, instanceOwner{};
        uint64_t generation{};
        bool operator==(const Selection&) const = default;
    };
    struct Entry {
        GLuint bounds{};
        std::array<GLuint, 4> commands{};
        uint32_t clusters{}, structure{}, positionVersion{}, indexVersion{};
        uint64_t lastUse{};
        uint64_t generation{};
        size_t bytes{};
        Bounds root{};
        struct CachedSelection { Selection key; uint64_t lastUse{}; };
        std::array<CachedSelection, 4> selections;
        Subscription subscription;
        ~Entry() {
            if (bounds) glDeleteBuffers(1, &bounds);
            glDeleteBuffers(commands.size(), commands.data());
        }
    };
    using Cache = std::unordered_map<unsigned, std::unique_ptr<Entry>>;
    Cache cache_;
    size_t residentBytes_{};
    uint64_t serial_{};
    bool initialized_{};
    GLuint program_{};
    GLuint instanceCommands_{};
    size_t instanceCommandBytes_{};
    Selection instanceSelection_;
    GLint planeLocation_{}, rangeLocation_{}, clusterLocation_{}, commandLocation_{}, instancedLocation_{};
    using Dispatch = void(APIENTRY*)(GLuint, GLuint, GLuint);
    using Barrier = void(APIENTRY*)(GLbitfield);
    using MultiDraw = void(APIENTRY*)(GLenum, GLenum, const void*, GLsizei, GLsizei);
    Dispatch dispatch_{};
    Barrier barrier_{};
    MultiDraw multiDraw_{};

    void erase(Cache::iterator it) {
        residentBytes_ -= it->second->bytes;
        cache_.erase(it);
        stats.cacheBytes = residentBytes_ + instanceCommandBytes_;
    }

    bool initialize() {
        if (initialized_) return program_ != 0;
        initialized_ = true;
        GLint major = 0, minor = 0;
        glGetIntegerv(GL_MAJOR_VERSION, &major);
        glGetIntegerv(GL_MINOR_VERSION, &minor);
        if (major < 4 || (major == 4 && minor < 3)) return false;
        dispatch_ = reinterpret_cast<Dispatch>(glfwGetProcAddress("glDispatchCompute"));
        barrier_ = reinterpret_cast<Barrier>(glfwGetProcAddress("glMemoryBarrier"));
        multiDraw_ = reinterpret_cast<MultiDraw>(glfwGetProcAddress("glMultiDrawElementsIndirect"));
        if (!dispatch_ || !barrier_ || !multiDraw_) return false;
        const char* source = R"GLSL(#version 430 core
layout(local_size_x=64) in;
struct Bounds { vec4 lo; vec4 hi; };
layout(std430, binding=0) readonly buffer ClusterBounds { Bounds bounds[]; };
struct Draw { uint count; uint instances; uint first; uint baseVertex; uint baseInstance; };
layout(std430, binding=1) writeonly buffer Commands { Draw commands[]; };
layout(std430, binding=2) readonly buffer InstanceTransforms { mat4 transforms[]; };
uniform vec4 planes[6];
uniform uvec2 range;
uniform uint clusterCount;
uniform uint commandCount;
uniform uint instanced;
void main() {
    uint id = gl_GlobalInvocationID.x;
    if (id >= commandCount) return;
    uint cluster = id % clusterCount;
    uint instance = id / clusterCount;
    uint first = max(cluster * 192u, range.x);
    uint end = min((cluster + 1u) * 192u, range.y);
    bool visible = end > first;
    for (int p=0; p<6 && visible; ++p) {
        vec4 plane = instanced != 0u ? transpose(transforms[instance]) * planes[p] : planes[p];
        if (any(isnan(plane)) || any(isinf(plane))) continue;
        vec3 support = mix(bounds[cluster].lo.xyz, bounds[cluster].hi.xyz, greaterThanEqual(plane.xyz, vec3(0)));
        // Outward error allowance covers float transform/plane rounding.
        float tolerance = 1e-4 * (1.0 + dot(abs(plane.xyz), abs(support)) + abs(plane.w));
        visible = dot(plane.xyz, support) + plane.w >= -tolerance;
    }
    commands[id].count = visible ? end - first : 0u;
    commands[id].instances = 1u;
    commands[id].first = first;
    commands[id].baseVertex = 0u;
    commands[id].baseInstance = instance;
})GLSL";
        const GLuint shader = glCreateShader(0x91B9 /* COMPUTE_SHADER */);
        glShaderSource(shader, 1, &source, nullptr);
        glCompileShader(shader);
        GLint ok = 0;
        glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
        if (ok) {
            program_ = glCreateProgram();
            glAttachShader(program_, shader);
            glLinkProgram(program_);
            glGetProgramiv(program_, GL_LINK_STATUS, &ok);
        }
        if (!ok) {
            char message[2048]{};
            if (program_) glGetProgramInfoLog(program_, sizeof(message), nullptr, message);
            else glGetShaderInfoLog(shader, sizeof(message), nullptr, message);
            std::fprintf(stderr, "Virtual Geometry unavailable: %s\n", message);
            if (program_) glDeleteProgram(program_);
            program_ = 0;
        }
        glDeleteShader(shader);
        if (program_) {
            planeLocation_ = glGetUniformLocation(program_, "planes");
            rangeLocation_ = glGetUniformLocation(program_, "range");
            clusterLocation_ = glGetUniformLocation(program_, "clusterCount");
            commandLocation_ = glGetUniformLocation(program_, "commandCount");
            instancedLocation_ = glGetUniformLocation(program_, "instanced");
        }
        return program_ != 0;
    }

    std::unique_ptr<Entry> build(const FloatBufferAttribute& position, const IntBufferAttribute& index) {
        const auto clusterCount = (index.count() + 191) / 192;
        std::vector<Bounds> bounds(clusterCount);
        for (int c = 0; c < clusterCount; ++c) {
            auto& b = bounds[c];
            for (int j = 0; j < 3; ++j) { b.lo[j] = INFINITY; b.hi[j] = -INFINITY; }
            for (int i = c * 192; i < std::min(index.count(), (c + 1) * 192); ++i) {
                const auto vertex = index.getX(i);
                if (vertex >= unsigned(position.count())) return {};
                const float p[3]{position.getX(vertex), position.getY(vertex), position.getZ(vertex)};
                for (int j = 0; j < 3; ++j) {
                    if (!std::isfinite(p[j])) return {};
                    b.lo[j] = std::min(b.lo[j], p[j]);
                    b.hi[j] = std::max(b.hi[j], p[j]);
                }
            }
        }
        auto entry = std::make_unique<Entry>();
        for (int j = 0; j < 3; ++j) {
            entry->root.lo[j] = INFINITY;
            entry->root.hi[j] = -INFINITY;
            for (const auto& b : bounds) {
                entry->root.lo[j] = std::min(entry->root.lo[j], b.lo[j]);
                entry->root.hi[j] = std::max(entry->root.hi[j], b.hi[j]);
            }
        }
        entry->clusters = clusterCount;
        entry->bytes = clusterCount * (sizeof(Bounds) + 20 * entry->commands.size());
        GLint previous = 0;
        glGetIntegerv(GL_ARRAY_BUFFER_BINDING, &previous);
        glGenBuffers(1, &entry->bounds);
        glBindBuffer(GL_ARRAY_BUFFER, entry->bounds);
        glBufferData(GL_ARRAY_BUFFER, bounds.size() * sizeof(Bounds), bounds.data(), GL_STATIC_DRAW);
        glGenBuffers(entry->commands.size(), entry->commands.data());
        for (auto commands : entry->commands) {
            glBindBuffer(GL_ARRAY_BUFFER, commands);
            glBufferData(GL_ARRAY_BUFFER, clusterCount * 20, nullptr, GL_DYNAMIC_DRAW);
        }
        glBindBuffer(GL_ARRAY_BUFFER, previous);
        return entry;
    }
#endif
};

}
#endif
