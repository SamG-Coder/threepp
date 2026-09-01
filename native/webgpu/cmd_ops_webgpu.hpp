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
// DLSS SR evaluate, replayed after rendering and before OP_SUBMIT. Payload:
// u32 encoder, viewport; 5x {texture, VkImageLayout, left, top, width, height};
// u32 hasExposure; 102x f32 common constants; 7x u32 common-constant flags.
constexpr uint32_t OP_DLSS_EVALUATE = 74;
// DLSS Ray Reconstruction evaluate.  Payload carries ten resources, packed /
// alternate-guide flags, world/view matrices and the common frame constants.
constexpr uint32_t OP_RAY_RECONSTRUCTION_EVALUATE = 76;
// Native Vulkan ray-query bridge. The runtime owns one world-space static
// scene (one BLAS + identity TLAS) per WebGPU context. Every payload starts
// with a u32 protocol version. Scene-upload commands remain version 1.
constexpr uint32_t OP_RTX_SCENE_BEGIN = 77;     // version
constexpr uint32_t OP_RTX_SCENE_POSITIONS = 78; // version, vertexCount, vertexCount * vec3f
constexpr uint32_t OP_RTX_SCENE_INDICES = 79;   // version, indexCount, indexCount * u32
constexpr uint32_t OP_RTX_SCENE_COMMIT = 80;    // version, encoder; build BLAS/TLAS
constexpr uint32_t OP_RTX_SCENE_DESTROY = 81;   // version
// Version 1: encoder, rgba16f color texture/layout, depth32f texture/layout,
// width, height, inverseViewProjection[16], cameraPosition[4], legacy
// directional-light direction/intensity[4], parameters[4], flags and four
// legacy extension floats.
// Version 2 keeps the common prefix, with parameters = directional visibility
// strength, AO strength, AO radius and directional angular radius. It then
// carries flags, maxDistance, rayBias, directionalSampleCount, aoSampleCount,
// frameIndex and an optional custom pipeline handle. Color is modified in
// place and both incoming Vulkan layouts are restored before returning.
constexpr uint32_t OP_RTX_LIGHTING_EVALUATE = 82;
// Optional terminal radiance for each primitive in the single static BLAS.
// Chunks are concatenated until scene commit. Payload:
// version, triangleCount, triangleCount * vec4f (linear HDR RGB, reserved A).
constexpr uint32_t OP_RTX_SCENE_TRIANGLE_RADIANCE = 83;
// One-bounce roughness-aware reflection composite. Payload:
// version, encoder; source/output/depth/normalRoughness/specularAlbedo as
// {texture, VkImageLayout}; width, height; inverseViewProjection[16],
// cameraPosition[4], parameters[4] (strength, maxDistance, bias,
// roughnessCutoff), environment[4] (linear RGB, intensity), flags and
// frameIndex. Version 2 appends an optional custom pipeline handle. Source and
// output must be distinct rgba16f images.
constexpr uint32_t OP_RTX_REFLECTIONS_EVALUATE = 84;
// Optional material response for each primitive in the single static BLAS.
// Chunks are concatenated until scene commit. Payload:
// version, triangleCount, triangleCount * vec4f (linear albedo RGB, roughness).
constexpr uint32_t OP_RTX_SCENE_TRIANGLE_SURFACE = 85;
// Optional static lights used to shade reflection hits. Payload:
// version, lightCount (maximum 8), lightCount * 4 * vec4f containing
// position/range, direction/outerCos, linear color/intensity and
// innerCos/type/decay/reserved. Type 0 is point and type 1 is spot.
constexpr uint32_t OP_RTX_SCENE_LIGHTS = 86;
// Create a device-scoped custom ray-query compute pipeline. Payload:
// version (= 1), handle, profile, entryPointByteLength, spirvByteLength,
// entry-point UTF-8 padded to four bytes, then aligned SPIR-V bytes. Profile 1
// is lighting-v1 and profile 2 is reflections-v1.
constexpr uint32_t OP_RTX_PIPELINE_CREATE = 87;
// Destroy a custom pipeline by handle. Payload: version (= 1), handle.
constexpr uint32_t OP_RTX_PIPELINE_DESTROY = 88;
// version, id, capacity, vertexOffset, vertexCount, indexOffset, indexCount,
// primitiveBase. Geometry is appended to the scene upload and receives one
// reusable BLAS plus fixed-capacity masked TLAS slots.
constexpr uint32_t OP_RTX_SCENE_INSTANCE_GROUP = 89;
// version, encoder, id, count, count * row-major mat3x4<f32>, count * u32 mask.
constexpr uint32_t OP_RTX_INSTANCE_GROUP_UPDATE = 90;
// Compile GLSL compute source through the bundled native shader compiler and
// create a device-scoped custom ray-query pipeline. Payload:
// version (= 1), handle, profile, entryPointByteLength, sourceByteLength,
// entry-point UTF-8 padded to four bytes, then raw GLSL UTF-8 source. The
// source compiler uses a content-addressed SPIR-V cache; opcode 87 remains the
// direct/precompiled SPIR-V path.
constexpr uint32_t OP_RTX_PIPELINE_CREATE_SOURCE = 91;
// Attach one fixed-topology deformable BLAS to the reserved active-scene TLAS
// slot. Positions come from one rgba32float texel per vertex. Create payload:
// version, encoder, mesh, texture, VkImageLayout, width, height, vertexCount,
// indexCount, followed by indexCount * u32. Refit has the same prefix through
// vertexCount plus flags (bit 0 = rebuild). Destroy: version, encoder, mesh.
constexpr uint32_t OP_RTX_DYNAMIC_MESH_CREATE = 92;
constexpr uint32_t OP_RTX_DYNAMIC_MESH_REFIT = 93;
constexpr uint32_t OP_RTX_DYNAMIC_MESH_DESTROY = 94;
// DLSS Neural Rendering evaluate. Payload:
// u32 encoder, viewport; 5x {texture, VkImageLayout, left, top, width, height}
// for input, output, depth, motion, and optional r8unorm control mask;
// u32 hasControlMask, enabled; 4x f32 tone/structure controls; u32 style,
// renderPreset, useAutoMask; f32 skinStructureStrength; u32 performanceMode;
// then 102x f32 common constants and 7x u32 common-constant flags.
constexpr uint32_t OP_DLSS_NR_EVALUATE = 95;
// version, visible, left, top, displayWidth, displayHeight, sourceWidth,
// sourceHeight, rowBytes, byteLength, RGBA8 bytes
constexpr uint32_t OP_CANVAS_OVERLAY = 96;
// DLSS Frame Generation resource tag/options command, replayed after rendering
// and before OP_SUBMIT/OP_PRESENT. Payload:
// u32 encoder, viewport; 4x {texture, VkImageLayout, left, top, width, height};
// u32 hasUI, uiAlphaOnly, framesToGenerate; 102x f32 common constants;
// 7x u32 common-constant flags. Configuration is not ACTIVE until a later
// slDLSSGGetState reports more than one frame from Present.
constexpr uint32_t OP_DLSSG_TAG = 75;

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
