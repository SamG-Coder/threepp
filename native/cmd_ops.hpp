#pragma once

#include <cstdint>

// Command stream is little-endian, 4-byte field alignment, each command
// padded to an 8-byte multiple. Header is always:
//   uint32 op
//   uint32 bytes   // size of this command including header
//
// Keep these values in sync with host/ThreeBrowser/web/three/00-cmdbuf.js

namespace tn::cmd {

constexpr uint32_t OP_NOP = 0;
constexpr uint32_t OP_RENDER = 1;
constexpr uint32_t OP_SET_SIZE = 2;

constexpr uint32_t OP_SCENE_CREATE = 10;
constexpr uint32_t OP_SCENE_BG = 11;
constexpr uint32_t OP_SCENE_FOG = 12;
constexpr uint32_t OP_SCENE_FOG_EXP2 = 13;

constexpr uint32_t OP_PERSP_CAM = 20;
constexpr uint32_t OP_ORTHO_CAM = 21;
constexpr uint32_t OP_ORTHO_UPDATE = 22;
constexpr uint32_t OP_CAM_ASPECT = 23;
constexpr uint32_t OP_CAM_UPD_PROJ = 24;

constexpr uint32_t OP_BUF_GEO = 30;
constexpr uint32_t OP_BOX_GEO = 31;
constexpr uint32_t OP_BUF_ATTR = 32;
constexpr uint32_t OP_TEX_RGBA = 33;
constexpr uint32_t OP_TEX_BEGIN = 34;
constexpr uint32_t OP_TEX_ROWS = 35;

constexpr uint32_t OP_MAT_BASIC = 40;
constexpr uint32_t OP_MAT_LAMBERT = 41;
constexpr uint32_t OP_MAT_STANDARD = 42;
constexpr uint32_t OP_MAT_LINE = 43;
constexpr uint32_t OP_MAT_POINTS = 44;
constexpr uint32_t OP_MAT_SPRITE = 45;
constexpr uint32_t OP_MAT_SIDE = 46;
constexpr uint32_t OP_MAT_MAP = 47;
constexpr uint32_t OP_MAT_PBR = 48;
constexpr uint32_t OP_MAT_EMISSIVE = 49;
constexpr uint32_t OP_MAT_MAP_SLOT = 50;
constexpr uint32_t OP_MAT_NORMAL = 51;
constexpr uint32_t OP_MAT_ALPHA = 52;
constexpr uint32_t OP_MAT_VISIBLE = 53;
constexpr uint32_t OP_TEX_PARAMS = 36;

constexpr uint32_t OP_MESH = 60;
constexpr uint32_t OP_GROUP = 61;
constexpr uint32_t OP_INSTANCED = 62;
constexpr uint32_t OP_LINE = 63;
constexpr uint32_t OP_LINE_SEG = 64;
constexpr uint32_t OP_LINE_LOOP = 65;
constexpr uint32_t OP_POINTS = 66;
constexpr uint32_t OP_SPRITE = 67;
constexpr uint32_t OP_SKINNED = 68;
constexpr uint32_t OP_SKINNED_BIND = 69;
constexpr uint32_t OP_MESH_MAT = 70;

// OP_MAT_MAP_SLOT slot ids (keep in sync with 00-cmdbuf.js MAP_SLOT)
constexpr uint32_t MAP_SLOT_ALBEDO = 0;
constexpr uint32_t MAP_SLOT_NORMAL = 1;
constexpr uint32_t MAP_SLOT_ROUGHNESS = 2;
constexpr uint32_t MAP_SLOT_METALNESS = 3;
constexpr uint32_t MAP_SLOT_AO = 4;
constexpr uint32_t MAP_SLOT_EMISSIVE = 5;
constexpr uint32_t MAP_SLOT_ENV = 6;

constexpr uint32_t OP_OBJECT_ADD = 80;
constexpr uint32_t OP_SET_POSE = 81;
constexpr uint32_t OP_LOOK_AT = 82;
constexpr uint32_t OP_LOOK_FROM = 83;
constexpr uint32_t OP_SET_VISIBLE = 84;
constexpr uint32_t OP_OBJECT_REMOVE = 85;
constexpr uint32_t OP_SLOT_DESTROY = 86;

constexpr uint32_t OP_LIGHT_AMBIENT = 90;
constexpr uint32_t OP_LIGHT_DIR = 91;
constexpr uint32_t OP_LIGHT_HEMI = 92;
constexpr uint32_t OP_LIGHT_POINT = 93;
constexpr uint32_t OP_LIGHT_SPOT = 94;

constexpr uint32_t OP_INST_MATRIX = 100;
constexpr uint32_t OP_INST_COLOR = 101;
constexpr uint32_t OP_INST_COUNT = 102;
constexpr uint32_t OP_INST_MATRICES = 103;

inline uint32_t align8(uint32_t n) {
    return (n + 7u) & ~7u;
}

}// namespace tn::cmd
