#pragma once

#include <cstdint>

// Command stream is little-endian, 4-byte field alignment, each command
// padded to an 8-byte multiple. Header is always:
//   uint32 op
//   uint32 bytes   // size of this command including header
//
// Keep these values in sync with native/webgpu consumers.

namespace tw::cmd {

constexpr uint32_t OP_NOP = 0;
constexpr uint32_t OP_START = 1;       // unused if tw_start already ran
constexpr uint32_t OP_RESIZE = 2;      // u32 w, u32 h
constexpr uint32_t OP_PRESENT = 3;
constexpr uint32_t OP_SET_VSYNC = 4;   // u32 on

constexpr uint32_t OP_BUF_CREATE = 10; // u32 handle, u64 size, u32 usage
constexpr uint32_t OP_BUF_WRITE = 11;  // u32 handle, u64 offset, u32 nbytes, bytes
constexpr uint32_t OP_BUF_DESTROY = 12;// u32 handle

constexpr uint32_t OP_TEX_CREATE = 20; // u32 handle, w, h, d, format, usage, mip, sample, dim
constexpr uint32_t OP_TEX_DESTROY = 21;
constexpr uint32_t OP_TEX_VIEW = 22;   // handle, texture, format, aspect, baseMip, mipCount, baseLayer, layerCount
constexpr uint32_t OP_TEX_WRITE = 23;  // handle, originX/Y/Z, bytesPerRow, nbytes, bytes

constexpr uint32_t OP_SAMP_CREATE = 30;// handle, mag, min, mip, addressU/V/W, maxAniso

constexpr uint32_t OP_SHADER_CREATE = 40; // handle, nbytes, wgsl utf8
constexpr uint32_t OP_BGL_CREATE = 41;    // handle, entryCount, entries: binding, visibility, type, viewDim, sampleType, hasDynOffset
constexpr uint32_t OP_PL_CREATE = 42;     // handle, bglCount, bgl handles[]
constexpr uint32_t OP_CPIPE_CREATE = 43;  // handle, layout, shader, entryLen, entry utf8
constexpr uint32_t OP_RPIPE_CREATE = 44;  // handle, layout, vertShader, fragShader, topology, cull, format, depth
constexpr uint32_t OP_BG_CREATE = 45;     // handle, layout, entryCount, entries: binding, kind(0 buf 1 samp 2 view), resourceHandle, offset, size

constexpr uint32_t OP_ENC_BEGIN = 50;     // u32 handle
constexpr uint32_t OP_COMPUTE_BEGIN = 51; // u32 encoder
constexpr uint32_t OP_COMPUTE_PIPE = 52;  // u32 pipeline
constexpr uint32_t OP_COMPUTE_BG = 53;    // u32 index, u32 bindGroup
constexpr uint32_t OP_DISPATCH = 54;      // u32 x,y,z
constexpr uint32_t OP_COMPUTE_END = 55;
constexpr uint32_t OP_RENDER_BEGIN = 56;  // colorView (0=swapchain), depthView, 4x f32 clear, loadOp
constexpr uint32_t OP_RENDER_PIPE = 57;
constexpr uint32_t OP_RENDER_BG = 58;
constexpr uint32_t OP_SET_VERTEX = 59;    // u32 slot, u32 buffer, u64 offset
constexpr uint32_t OP_SET_INDEX = 60;     // u32 buffer, u32 format, u64 offset
constexpr uint32_t OP_DRAW = 61;          // vertexCount, instanceCount, firstVertex, firstInstance
constexpr uint32_t OP_DRAW_INDEXED = 62;  // indexCount, instanceCount, firstIndex, baseVertex, firstInstance
constexpr uint32_t OP_RENDER_END = 63;
constexpr uint32_t OP_SUBMIT = 64;        // finish encoder + queue.submit; does not present
constexpr uint32_t OP_COPY_BUF = 65;      // src, dst, srcOffset u64, dstOffset u64, size u64
constexpr uint32_t OP_COPY_TEX = 66;      // src, dst, srcXYZ, dstXYZ, w,h,d, srcMip, dstMip
constexpr uint32_t OP_PIPE_BGL = 67;      // handle, pipeline, groupIndex
constexpr uint32_t OP_SET_VIEWPORT = 68;  // encoder, x,y,w,h,minDepth,maxDepth (f32)
constexpr uint32_t OP_SET_SCISSOR = 69;   // encoder, x,y,w,h (u32)
constexpr uint32_t OP_SET_STENCIL = 70;   // encoder, reference
constexpr uint32_t OP_SET_BLEND = 71;     // encoder, rgba (f32)
constexpr uint32_t OP_DRAW_INDIRECT = 72; // encoder, buffer, offset
constexpr uint32_t OP_DRAW_INDEXED_INDIRECT = 73; // encoder, buffer, offset

// OP_BGL_CREATE type field
constexpr uint32_t BGL_UNIFORM = 0;
constexpr uint32_t BGL_SAMPLER = 1;
constexpr uint32_t BGL_TEXTURE = 2;
constexpr uint32_t BGL_STORAGE = 3;
constexpr uint32_t BGL_STORAGE_TEX = 4;

// OP_BG_CREATE kind field
constexpr uint32_t BG_BUF = 0;
constexpr uint32_t BG_SAMP = 1;
constexpr uint32_t BG_VIEW = 2;

inline uint32_t align8(uint32_t n) {
    return (n + 7u) & ~7u;
}

}// namespace tw::cmd
