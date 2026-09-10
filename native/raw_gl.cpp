#include "raw_gl.h"
#include "runtime_internal.hpp"
#include "glad/glad.h"
#include "GLFW/glfw3.h"
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace {
uint64_t executedCommands=0,executedBatches=0; // Context worker only.

size_t pixelBytes(int format, int type) {
    const size_t channels=format==GL_RGBA||format==GL_RGBA_INTEGER?4:format==GL_RGB||format==GL_RGB_INTEGER?3:format==GL_RG||format==GL_RG_INTEGER?2:1;
    switch(type) {
        case GL_UNSIGNED_BYTE:case GL_BYTE:return channels;
        case GL_UNSIGNED_SHORT:case GL_SHORT:case GL_HALF_FLOAT:return channels*2;
        case GL_FLOAT:case GL_UNSIGNED_INT:case GL_INT:return channels*4;
        case GL_UNSIGNED_SHORT_5_6_5:case GL_UNSIGNED_SHORT_4_4_4_4:case GL_UNSIGNED_SHORT_5_5_5_1:return 2;
        case GL_UNSIGNED_INT_24_8:case GL_UNSIGNED_INT_2_10_10_10_REV:case GL_UNSIGNED_INT_10F_11F_11F_REV:return 4;
        default:throw std::runtime_error("Unsupported raw GL pixel type");
    }
}
void validatePixels(double wd,double hd,double dd,double format,double type,size_t bytes,bool allowNull) {
    if(wd<0||hd<0||dd<0||wd>32768||hd>32768||dd>2048)throw std::runtime_error("Invalid raw GL texture dimensions");
    if(!bytes&&allowNull)return;
    GLint alignment=4,rowLength=0,imageHeight=0,skipRows=0,skipPixels=0,skipImages=0;
    glGetIntegerv(GL_UNPACK_ALIGNMENT,&alignment);glGetIntegerv(GL_UNPACK_ROW_LENGTH,&rowLength);glGetIntegerv(GL_UNPACK_IMAGE_HEIGHT,&imageHeight);
    glGetIntegerv(GL_UNPACK_SKIP_ROWS,&skipRows);glGetIntegerv(GL_UNPACK_SKIP_PIXELS,&skipPixels);glGetIntegerv(GL_UNPACK_SKIP_IMAGES,&skipImages);
    const size_t w=size_t(wd),h=size_t(hd),d=size_t(dd),bpp=pixelBytes(int(format),int(type));
    const size_t row=((size_t(rowLength?rowLength:w)*bpp+alignment-1)/alignment)*alignment;
    const size_t image=row*size_t(imageHeight?imageHeight:h);
    const size_t required=w&&h&&d?size_t(skipImages)*image+size_t(skipRows)*row+size_t(skipPixels)*bpp+(d-1)*image+(h-1)*row+w*bpp:0;
    if(bytes<required)throw std::runtime_error("Raw GL texture upload exceeds source data");
}
void validateRead(double w,double h,double format,double type,size_t bytes) {
    if(w<0||h<0||w>32768||h>32768)throw std::runtime_error("Invalid raw GL readback dimensions");
    GLint alignment=4,rowLength=0,skipRows=0,skipPixels=0,pbo=0;
    glGetIntegerv(GL_PACK_ALIGNMENT,&alignment);glGetIntegerv(GL_PACK_ROW_LENGTH,&rowLength);glGetIntegerv(GL_PACK_SKIP_ROWS,&skipRows);glGetIntegerv(GL_PACK_SKIP_PIXELS,&skipPixels);glGetIntegerv(GL_PIXEL_PACK_BUFFER_BINDING,&pbo);
    if(pbo)throw std::runtime_error("Raw GL typed readback cannot target a pixel pack buffer");
    const size_t bpp=pixelBytes(int(format),int(type));
    const size_t row=((size_t(rowLength?rowLength:w)*bpp+alignment-1)/alignment)*alignment;
    const size_t required=w&&h?size_t(skipRows)*row+size_t(skipPixels)*bpp+(size_t(h)-1)*row+size_t(w)*bpp:0;
    if(bytes<required)throw std::runtime_error("Raw GL readback exceeds destination data");
}
void execute(int op,const double* a,const void* data,size_t bytes,void* output,TNRawGLResult& r) {
    ++executedCommands;
    // Context functions beyond the bundled GL 3.3 loader are resolved from the
    // actual context. The experiment requires native texture storage support.
    using Storage2D=void(APIENTRY*)(GLenum,GLsizei,GLenum,GLsizei,GLsizei);
    using Storage3D=void(APIENTRY*)(GLenum,GLsizei,GLenum,GLsizei,GLsizei,GLsizei);
    using Invalidate=void(APIENTRY*)(GLenum,GLsizei,const GLenum*);
    static const auto glTexStorage2D=reinterpret_cast<Storage2D>(glfwGetProcAddress("glTexStorage2D"));
    static const auto glTexStorage3D=reinterpret_cast<Storage3D>(glfwGetProcAddress("glTexStorage3D"));
    static const auto glInvalidateFramebuffer=reinterpret_cast<Invalidate>(glfwGetProcAddress("glInvalidateFramebuffer"));
    if(!glTexStorage2D||!glTexStorage3D||!glInvalidateFramebuffer)throw std::runtime_error("Raw GL requires texture storage and framebuffer invalidation support");
    switch(op) {
#include "raw_gl_ops.inc"
        default:throw std::runtime_error("Unsupported raw GL command");
    }
}
bool synchronous(int op) {
#include "raw_gl_sync.inc"
}
}

void tn_raw_gl_reset() {
    try {tn::onWorker([]{executedCommands=0;executedBatches=0;});}
    catch(const std::exception& error){tn::setError(error.what());}
}
void tn_raw_gl_begin_batch() { ++executedBatches; }

void tn_raw_gl_command(const void* data,size_t bytes,TNRawGLResult* result) {
    // Called by the main command stream on the owning worker. Its payload is
    // one raw GL record; enforce exact bounds before invoking the dispatcher.
    *result={};
    try {
        if(std::this_thread::get_id()!=tn::g.workerId||!tn::g.open.load()||tn::g.backend.load()!=0)
            throw std::runtime_error("Raw GL command requires the OpenGL context worker");
        if(bytes<88)throw std::runtime_error("Truncated raw GL command");
        const auto* input=static_cast<const unsigned char*>(data);
        uint32_t op=0,size=0;std::memcpy(&op,input,4);std::memcpy(&size,input+4,4);
        if(size>64*1024*1024-96||88+((size_t(size)+7)&~size_t(7))!=bytes||synchronous(int(op)))
            throw std::runtime_error("Invalid raw GL command payload or synchronous opcode");
        std::array<double,10> args;std::memcpy(args.data(),input+8,80);
        for(const double value:args)if(!std::isfinite(value))throw std::runtime_error("Non-finite raw GL argument");
        execute(int(op),args.data(),input+88,size,nullptr,*result);
    } catch(const std::exception& error){result->kind=-1;std::snprintf(result->text,sizeof(result->text),"%s",error.what());}
}

void tn_raw_gl_call(int op,const double* args,const void* data,size_t bytes,void* output,TNRawGLResult* result) {
    *result={};
    try {
        if(!synchronous(op))throw std::runtime_error("Raw GL setters must use the main command stream");
        if(!tn::g.open.load()||tn::g.backend.load()!=0)throw std::runtime_error("Raw GL requires the active OpenGL runtime");
        tn::onWorker([&] {
            if(!tn::g.canvas)throw std::runtime_error("Raw GL context was closed");
            execute(op,args,data,bytes,output,*result);
        });
    } catch(const std::exception& error){result->kind=-1;std::snprintf(result->text,sizeof(result->text),"%s",error.what());}
}
