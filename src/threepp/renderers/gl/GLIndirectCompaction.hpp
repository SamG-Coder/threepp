#pragma once

#include "threepp/renderers/gl/GLState.hpp"
#include <algorithm>
#include <array>
#include <cstdio>
#include <cstring>
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
#include <glad/glad.h>
#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>
#endif

namespace threepp::gl {
// Stable GPU compaction for sparse DrawElementsIndirectCommand arrays. The
// prefix/scatter preserves order (including coincident instance depth ties).
// ARB_indirect_parameters consumes the GPU count without a CPU readback.
class GLIndirectCompaction {
public:
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
    bool compact(GLuint& commands,GLuint& countBuffer,unsigned count,GLState& state) {
        if(count<512 || !initialize()) return false;
        GLint oldArray=0,oldStorage=0; GLint bindings[4]; GLint64 starts[4],sizes[4];
        glGetIntegerv(GL_ARRAY_BUFFER_BINDING,&oldArray); glGetIntegerv(0x90D3,&oldStorage);
        for(unsigned i=0;i<4;++i) {
            glGetIntegeri_v(0x90D3,i,&bindings[i]); glGetInteger64i_v(0x90D4,i,&starts[i]); glGetInteger64i_v(0x90D5,i,&sizes[i]);
        }
        const unsigned groups=(count+255)/256;
        if(rankCapacity_<count) {
            if(!ranks_) glGenBuffers(1,&ranks_);
            glBindBuffer(GL_ARRAY_BUFFER,ranks_); glBufferData(GL_ARRAY_BUFFER,size_t(count)*4,nullptr,GL_DYNAMIC_DRAW);
            rankCapacity_=count;
        }
        glGenBuffers(1,&countBuffer); glBindBuffer(GL_ARRAY_BUFFER,countBuffer);
        glBufferData(GL_ARRAY_BUFFER,size_t(groups+1)*4,nullptr,GL_DYNAMIC_DRAW);
        GLuint output=0; glGenBuffers(1,&output); glBindBuffer(GL_ARRAY_BUFFER,output);
        glBufferData(GL_ARRAY_BUFFER,size_t(count)*20,nullptr,GL_DYNAMIC_DRAW);
        glBindBufferBase(0x90D2,0,commands); glBindBufferBase(0x90D2,1,ranks_);
        glBindBufferBase(0x90D2,2,countBuffer); glBindBufferBase(0x90D2,3,output);
        const auto oldProgram=state.currentProgram;
        for(unsigned phase=0;phase<3;++phase) {
            state.useProgram(programs_[phase]);
            glUniform1ui(countLocations_[phase],count);
            dispatch_(phase==1 ? 1 : groups,1,1);
            barrier_(0x2000 | 0x40);
        }
        state.useProgram(oldProgram.value_or(0));
        for(unsigned i=0;i<4;++i) {
            if(bindings[i] && sizes[i]>0) glBindBufferRange(0x90D2,i,bindings[i],starts[i],sizes[i]);
            else glBindBufferBase(0x90D2,i,bindings[i]);
        }
        glBindBuffer(0x90D2,oldStorage); glBindBuffer(GL_ARRAY_BUFFER,oldArray);
        glDeleteBuffers(1,&commands); commands=output;
        return true;
    }
    bool draw(GLuint countBuffer,unsigned maxCount) {
        if(!countBuffer || !drawCount_) return false;
        GLint previous=0; glGetIntegerv(0x80ef,&previous);
        glBindBuffer(0x80ee,countBuffer);
        drawCount_(GL_TRIANGLES,GL_UNSIGNED_INT,nullptr,GLintptr((maxCount+255)/256)*4,maxCount,20);
        glBindBuffer(0x80ee,previous);
        return true;
    }
#endif
    void dispose() {
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
        for(auto& program:programs_) { if(program) glDeleteProgram(program); program=0; }
        if(ranks_) glDeleteBuffers(1,&ranks_);
        ranks_=0; rankCapacity_=0; initialized_=false;
#endif
    }
private:
#if !defined(__ANDROID__) && !defined(__EMSCRIPTEN__)
    using Dispatch=void(APIENTRY*)(GLuint,GLuint,GLuint);
    using Barrier=void(APIENTRY*)(GLbitfield);
    using DrawCount=void(APIENTRY*)(GLenum,GLenum,const void*,GLintptr,GLsizei,GLsizei);
    Dispatch dispatch_{}; Barrier barrier_{}; DrawCount drawCount_{};
    bool initialized_{};
    std::array<GLuint,3> programs_{};
    std::array<GLint,3> countLocations_{};
    GLuint ranks_{}; unsigned rankCapacity_{};
    bool initialize() {
        if(initialized_) return programs_[0]!=0;
        initialized_=true;
        bool supported=false; GLint extensions=0; glGetIntegerv(GL_NUM_EXTENSIONS,&extensions);
        for(GLint i=0;i<extensions;++i)
            if(std::strcmp(reinterpret_cast<const char*>(glGetStringi(GL_EXTENSIONS,i)),"GL_ARB_indirect_parameters")==0) supported=true;
        GLint major=0,minor=0; glGetIntegerv(GL_MAJOR_VERSION,&major); glGetIntegerv(GL_MINOR_VERSION,&minor);
        supported=supported || major>4 || (major==4 && minor>=6);
        if(!supported) return false;
        dispatch_=reinterpret_cast<Dispatch>(glfwGetProcAddress("glDispatchCompute"));
        barrier_=reinterpret_cast<Barrier>(glfwGetProcAddress("glMemoryBarrier"));
        drawCount_=reinterpret_cast<DrawCount>(glfwGetProcAddress("glMultiDrawElementsIndirectCountARB"));
        if(!drawCount_) drawCount_=reinterpret_cast<DrawCount>(glfwGetProcAddress("glMultiDrawElementsIndirectCount"));
        if(!dispatch_ || !barrier_ || !drawCount_) return false;
        const char* sources[3]={R"GLSL(#version 430 core
layout(local_size_x=256) in;
struct Draw { uint count; uint instances; uint first; uint baseVertex; uint baseInstance; };
layout(std430,binding=0) readonly buffer Input { Draw commands[]; };
layout(std430,binding=1) writeonly buffer Ranks { uint ranks[]; };
layout(std430,binding=2) writeonly buffer Groups { uint groups[]; };
uniform uint commandCount;
shared uint scan[256];
void main() {
    uint id=gl_GlobalInvocationID.x,lane=gl_LocalInvocationID.x;
    uint active=0u;
    if(id<commandCount) active=commands[id].count>0u ? 1u : 0u;
    scan[lane]=active; barrier();
    for(uint offset=1u;offset<256u;offset*=2u) {
        uint prior=lane>=offset ? scan[lane-offset] : 0u;
        barrier(); scan[lane]+=prior; barrier();
    }
    if(id<commandCount) ranks[id]=scan[lane]-active;
    if(lane==255u) groups[gl_WorkGroupID.x]=scan[lane];
})GLSL",R"GLSL(#version 430 core
layout(local_size_x=1) in;
layout(std430,binding=2) buffer Groups { uint groups[]; };
uniform uint commandCount;
void main() {
    uint prefix=0u,count=(commandCount+255u)/256u;
    for(uint i=0u;i<count;++i) { uint value=groups[i]; groups[i]=prefix; prefix+=value; }
    groups[count]=prefix;
})GLSL",R"GLSL(#version 430 core
layout(local_size_x=256) in;
struct Draw { uint count; uint instances; uint first; uint baseVertex; uint baseInstance; };
layout(std430,binding=0) readonly buffer Input { Draw commands[]; };
layout(std430,binding=1) readonly buffer Ranks { uint ranks[]; };
layout(std430,binding=2) readonly buffer Groups { uint groups[]; };
layout(std430,binding=3) writeonly buffer Output { Draw result[]; };
uniform uint commandCount;
void main() {
    uint id=gl_GlobalInvocationID.x;
    if(id>=commandCount || commands[id].count==0u) return;
    result[groups[id/256u]+ranks[id]]=commands[id];
})GLSL"};
        for(unsigned i=0;i<3;++i) {
            GLuint shader=glCreateShader(0x91b9); glShaderSource(shader,1,&sources[i],nullptr); glCompileShader(shader);
            GLint ok=0; glGetShaderiv(shader,GL_COMPILE_STATUS,&ok);
            if(ok) {
                programs_[i]=glCreateProgram(); glAttachShader(programs_[i],shader); glLinkProgram(programs_[i]);
                glGetProgramiv(programs_[i],GL_LINK_STATUS,&ok);
            }
            if(!ok) {
                char message[2048]{};
                if(programs_[i]) glGetProgramInfoLog(programs_[i],sizeof(message),nullptr,message);
                else glGetShaderInfoLog(shader,sizeof(message),nullptr,message);
                std::fprintf(stderr,"Indirect compaction unavailable: %s\n",message);
                glDeleteShader(shader); dispose(); initialized_=true; return false;
            }
            glDeleteShader(shader); countLocations_[i]=glGetUniformLocation(programs_[i],"commandCount");
        }
        return true;
    }
#endif
};
}
