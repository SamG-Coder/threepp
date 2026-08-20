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

constexpr uint32_t OP_MESH = 60;
constexpr uint32_t OP_GROUP = 61;
constexpr uint32_t OP_INSTANCED = 62;
constexpr uint32_t OP_LINE = 63;
constexpr uint32_t OP_LINE_SEG = 64;
constexpr uint32_t OP_LINE_LOOP = 65;
constexpr uint32_t OP_POINTS = 66;
constexpr uint32_t OP_SPRITE = 67;

constexpr uint32_t OP_OBJECT_ADD = 80;
constexpr uint32_t OP_SET_POSE = 81;
constexpr uint32_t OP_LOOK_AT = 82;
constexpr uint32_t OP_LOOK_FROM = 83;

constexpr uint32_t OP_LIGHT_AMBIENT = 90;
constexpr uint32_t OP_LIGHT_DIR = 91;
constexpr uint32_t OP_LIGHT_HEMI = 92;
constexpr uint32_t OP_LIGHT_POINT = 93;
constexpr uint32_t OP_LIGHT_SPOT = 94;

constexpr uint32_t OP_INST_MATRIX = 100;
constexpr uint32_t OP_INST_COLOR = 101;

inline uint32_t align8(uint32_t n) {
    return (n + 7u) & ~7u;
}

}// namespace tn::cmd
