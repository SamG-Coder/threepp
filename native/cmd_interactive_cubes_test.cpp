// Packs the webgl_interactive_cubes scene through the aligned command ring
// (same ops as host/ThreeBrowser/web/three/00-cmdbuf.js) and checks poses.

#include "cmd_ops.hpp"
#include "three_native.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <vector>

namespace {

constexpr int kCubes = 2000;

struct Stream {
    std::vector<uint8_t> bytes;

    void u32(uint32_t v) {
        uint8_t raw[4];
        std::memcpy(raw, &v, 4);
        bytes.insert(bytes.end(), raw, raw + 4);
    }

    void f32(float v) {
        uint8_t raw[4];
        std::memcpy(raw, &v, 4);
        bytes.insert(bytes.end(), raw, raw + 4);
    }

    size_t begin(uint32_t op) {
        const size_t start = bytes.size();
        u32(op);
        u32(0);
        return start;
    }

    void end(size_t start) {
        const uint32_t size = tn::cmd::align8(static_cast<uint32_t>(bytes.size() - start));
        bytes.resize(start + size, 0);
        std::memcpy(bytes.data() + start + 4, &size, 4);
    }
};

float rnd(uint32_t& state) {
    state = state * 1664525u + 1013904223u;
    return static_cast<float>((state >> 8) & 0x00ffffffu) / 16777216.f;
}

bool near(float a, float b) {
    return std::fabs(a - b) < 1e-4f;
}

int fail(const char* msg) {
    std::cerr << "FAIL: " << msg;
    const char* err = tn_last_error();
    if (err && err[0]) {
        std::cerr << " (" << err << ")";
    }
    std::cerr << '\n';
    tn_runtime_shutdown();
    return 1;
}

}// namespace

int main() {
    if (!tn_runtime_start(640, 480, "interactive cubes cmd")) {
        std::cerr << "start failed: " << tn_last_error() << '\n';
        return 1;
    }

    Stream s;
    uint32_t id = 1;
    const uint32_t scene = id++;
    const uint32_t camera = id++;
    const uint32_t light = id++;
    const uint32_t geo = id++;

    {
        const size_t b = s.begin(tn::cmd::OP_SCENE_CREATE);
        s.u32(scene);
        s.end(b);
    }
    {
        const size_t b = s.begin(tn::cmd::OP_SCENE_BG);
        s.u32(scene);
        s.u32(0xf0f0f0);
        s.end(b);
    }
    {
        const size_t b = s.begin(tn::cmd::OP_PERSP_CAM);
        s.u32(camera);
        s.f32(70.f);
        s.f32(640.f / 480.f);
        s.f32(0.1f);
        s.f32(100.f);
        s.end(b);
    }
    {
        const size_t b = s.begin(tn::cmd::OP_LIGHT_DIR);
        s.u32(light);
        s.u32(0xffffff);
        s.f32(3.f);
        s.end(b);
    }
    {
        const float n = 1.f / std::sqrt(3.f);
        const size_t b = s.begin(tn::cmd::OP_SET_POSE);
        s.u32(light);
        s.f32(n);
        s.f32(n);
        s.f32(n);
        s.f32(0);
        s.f32(0);
        s.f32(0);
        s.f32(1);
        s.f32(1);
        s.f32(1);
        s.end(b);
    }
    {
        const size_t b = s.begin(tn::cmd::OP_OBJECT_ADD);
        s.u32(scene);
        s.u32(light);
        s.end(b);
    }
    {
        const size_t b = s.begin(tn::cmd::OP_BOX_GEO);
        s.u32(geo);
        s.f32(1);
        s.f32(1);
        s.f32(1);
        s.end(b);
    }

    uint32_t rng = 1;
    struct Pose {
        uint32_t mesh;
        float x, y, z, rx, ry, rz, sx, sy, sz;
    };
    std::vector<Pose> poses;
    poses.reserve(kCubes);

    for (int i = 0; i < kCubes; i++) {
        const uint32_t mat = id++;
        const uint32_t mesh = id++;
        const uint32_t hex = static_cast<uint32_t>(rnd(rng) * 16777215.f) & 0xffffffu;
        Pose p;
        p.mesh = mesh;
        p.x = rnd(rng) * 40.f - 20.f;
        p.y = rnd(rng) * 40.f - 20.f;
        p.z = rnd(rng) * 40.f - 20.f;
        p.rx = rnd(rng) * 6.2831853f;
        p.ry = rnd(rng) * 6.2831853f;
        p.rz = rnd(rng) * 6.2831853f;
        p.sx = rnd(rng) + 0.5f;
        p.sy = rnd(rng) + 0.5f;
        p.sz = rnd(rng) + 0.5f;
        poses.push_back(p);

        {
            const size_t b = s.begin(tn::cmd::OP_MAT_LAMBERT);
            s.u32(mat);
            s.u32(hex);
            s.end(b);
        }
        {
            const size_t b = s.begin(tn::cmd::OP_MESH);
            s.u32(mesh);
            s.u32(geo);
            s.u32(mat);
            s.end(b);
        }
        {
            const size_t b = s.begin(tn::cmd::OP_SET_POSE);
            s.u32(mesh);
            s.f32(p.x);
            s.f32(p.y);
            s.f32(p.z);
            s.f32(p.rx);
            s.f32(p.ry);
            s.f32(p.rz);
            s.f32(p.sx);
            s.f32(p.sy);
            s.f32(p.sz);
            s.end(b);
        }
        {
            const size_t b = s.begin(tn::cmd::OP_OBJECT_ADD);
            s.u32(scene);
            s.u32(mesh);
            s.end(b);
        }
    }

    const float radius = 5.f;
    const float theta = 0.1f * 3.14159265f / 180.f;
    const float cx = radius * std::sin(theta);
    const float cy = radius * std::sin(theta);
    const float cz = radius * std::cos(theta);
    {
        const size_t b = s.begin(tn::cmd::OP_LOOK_FROM);
        s.u32(camera);
        s.f32(cx);
        s.f32(cy);
        s.f32(cz);
        s.f32(0);
        s.f32(0);
        s.f32(0);
        s.end(b);
    }
    {
        const size_t b = s.begin(tn::cmd::OP_OBJECT_ADD);
        s.u32(scene);
        s.u32(camera);
        s.end(b);
    }
    {
        const size_t b = s.begin(tn::cmd::OP_RENDER);
        s.u32(scene);
        s.u32(camera);
        s.end(b);
    }

    for (size_t i = 0; i < s.bytes.size();) {
        if (i + 8 > s.bytes.size()) {
            return fail("truncated command header");
        }
        uint32_t size = 0;
        std::memcpy(&size, s.bytes.data() + i + 4, 4);
        if (size < 8 || (size & 7u) != 0 || i + size > s.bytes.size()) {
            return fail("command is not 8-byte aligned");
        }
        i += size;
    }

    if (!tn_cmd_submit(s.bytes.data(), static_cast<int>(s.bytes.size()))) {
        return fail("tn_cmd_submit");
    }

    float x = 0, y = 0, z = 0;
    if (!tn_object_get_position(camera, &x, &y, &z)) {
        return fail("camera get_position");
    }
    if (!near(x, cx) || !near(y, cy) || !near(z, cz)) {
        return fail("camera pose");
    }

    const Pose& first = poses.front();
    const Pose& last = poses.back();
    if (!tn_object_get_position(first.mesh, &x, &y, &z) || !near(x, first.x) || !near(y, first.y) || !near(z, first.z)) {
        return fail("first cube pose");
    }
    if (!tn_object_get_position(last.mesh, &x, &y, &z) || !near(x, last.x) || !near(y, last.y) || !near(z, last.z)) {
        return fail("last cube pose");
    }

    float rx = 0, ry = 0, rz = 0;
    if (!tn_object_get_rotation(first.mesh, &rx, &ry, &rz) || !near(rx, first.rx) || !near(ry, first.ry) || !near(rz, first.rz)) {
        return fail("first cube rotation");
    }

    if (!tn_runtime_render(scene, camera)) {
        return fail("render");
    }

    tn_runtime_shutdown();
    std::cout << "CUBES OK cubes=" << kCubes << " bytes=" << s.bytes.size() << '\n';
    return 0;
}
