#include "three_webgpu.h"
#include "cmd_ops_webgpu.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <chrono>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

namespace {

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

    void raw(const void* p, uint32_t n) {
        const auto* b = static_cast<const uint8_t*>(p);
        bytes.insert(bytes.end(), b, b + n);
    }

    size_t begin(uint32_t op) {
        const size_t start = bytes.size();
        u32(op);
        u32(0);
        return start;
    }

    void end(size_t start) {
        const uint32_t size = tw::cmd::align8(static_cast<uint32_t>(bytes.size() - start));
        bytes.resize(start + size, 0);
        std::memcpy(bytes.data() + start + 4, &size, 4);
    }
};

constexpr char kShader[] = R"(
@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(
        vec2f( 0.0,  0.6),
        vec2f(-0.6, -0.6),
        vec2f( 0.6, -0.6)
    );
    return vec4f(p[i], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
    return vec4f(0.15, 0.85, 0.35, 1.0);
}
)";

}// namespace

int main() {
    const bool testExclusiveFullscreen = std::getenv("THREEBROWSER_TEST_EXCLUSIVE_FULLSCREEN") != nullptr;
    const bool testBorderlessFullscreen = std::getenv("THREEBROWSER_TEST_BORDERLESS_FULLSCREEN") != nullptr;
    if (testExclusiveFullscreen || testBorderlessFullscreen) {
        tw_set_standalone_ui(1);
    }
    if (!tw_start(nullptr, 80, 80, 640, 480)) {
        std::cerr << "start failed: " << tw_last_error() << '\n';
        return 1;
    }
    if (void* hwnd = tw_hwnd()) {
        ShowWindow(static_cast<HWND>(hwnd), SW_SHOWNOACTIVATE);
    }
    std::cout << "backend=" << tw_backend_name() << '\n';

    if (testExclusiveFullscreen) {
        DEVMODEW mode{};
        mode.dmSize = sizeof(mode);
        if (!EnumDisplaySettingsW(nullptr, ENUM_CURRENT_SETTINGS, &mode) ||
            !tw_set_fullscreen(2, static_cast<int>(mode.dmPelsWidth),
                               static_cast<int>(mode.dmPelsHeight),
                               static_cast<int>(mode.dmDisplayFrequency))) {
            std::cerr << "exclusive fullscreen enter failed: " << tw_last_error() << '\n';
            tw_shutdown();
            return 6;
        }
    } else if (testBorderlessFullscreen && !tw_set_fullscreen(1, 0, 0, 0)) {
        std::cerr << "borderless fullscreen enter failed: " << tw_last_error() << '\n';
        tw_shutdown();
        return 8;
    }

    Stream s;
    const uint32_t shader = 1;
    const uint32_t layout = 2;
    const uint32_t pipe = 3;
    const uint32_t enc = 4;

    {
        const auto st = s.begin(tw::cmd::OP_SHADER_CREATE);
        s.u32(shader);
        s.u32(static_cast<uint32_t>(sizeof(kShader) - 1));
        s.raw(kShader, static_cast<uint32_t>(sizeof(kShader) - 1));
        s.end(st);
    }
    {
        const auto st = s.begin(tw::cmd::OP_PL_CREATE);
        s.u32(layout);
        s.u32(0);
        s.end(st);
    }
    {
        const auto st = s.begin(tw::cmd::OP_RPIPE_CREATE);
        s.u32(pipe);
        s.u32(layout);
        s.u32(shader);
        s.u32(shader);
        s.u32(0); // topology -> triangle list
        s.u32(0); // cull none
        s.u32(0); // surface format
        s.u32(0); // no depth
        s.end(st);
    }

    constexpr int kFrames = 30;
    for (int i = 0; i < kFrames; ++i) {
        {
            const auto st = s.begin(tw::cmd::OP_ENC_BEGIN);
            s.u32(enc);
            s.end(st);
        }
        {
            const auto st = s.begin(tw::cmd::OP_RENDER_BEGIN);
            s.u32(0);
            s.u32(0);
            s.f32(0.08f);
            s.f32(0.12f);
            s.f32(0.28f);
            s.f32(1.f);
            s.u32(2); // WGPULoadOp_Clear
            s.end(st);
        }
        {
            const auto st = s.begin(tw::cmd::OP_RENDER_PIPE);
            s.u32(enc);
            s.u32(pipe);
            s.end(st);
        }
        {
            const auto st = s.begin(tw::cmd::OP_DRAW);
            s.u32(enc);
            s.u32(3);
            s.u32(1);
            s.u32(0);
            s.u32(0);
            s.end(st);
        }
        {
            const auto st = s.begin(tw::cmd::OP_RENDER_END);
            s.end(st);
        }
        {
            const auto st = s.begin(tw::cmd::OP_SUBMIT);
            s.end(st);
        }
        {
            const auto st = s.begin(tw::cmd::OP_PRESENT);
            s.end(st);
        }
    }

    const auto t0 = std::chrono::steady_clock::now();
    // Keep the diagnostics visible while the scene submits so the smoke test
    // exercises the in-encoder overlay path used by real WebGPU pages.
    tw_toggle_fps_overlay();
    // Reproduce a Win32 double-click resize race: browser layout can still
    // report the old large canvas while this pass targets the resized surface.
    int staleOverlayRowBytes = 0;
    tw_overlay_raster(2560, 1440, 120, 8000, tw_backend_name(), 0, 0,
                      &staleOverlayRowBytes);
    if (!tw_cmd_submit(s.bytes.data(), static_cast<int>(s.bytes.size()))) {
        std::cerr << "cmd_submit failed: " << tw_last_error() << '\n';
        tw_shutdown();
        return 2;
    }
    int fps = 0, frameUs = 0, width = 0, height = 0, vsync = 0;
    uint64_t presents = 0;
    const auto deadline = t0 + std::chrono::seconds(10);
    do {
        tw_stats(&fps, &frameUs, &width, &height, &vsync, &presents);
        if (presents >= kFrames) break;
        Sleep(1);
    } while (std::chrono::steady_clock::now() < deadline);
    const double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    if (sec > 1e-6 && presents > 0) {
        fps = static_cast<int>(static_cast<double>(presents) / sec + 0.5);
    }
    const char* err = tw_last_error();
    std::cout << "SMOKE OK backend=" << tw_backend_name()
              << " fps=" << fps
              << " frame_us=" << frameUs
              << " size=" << width << "x" << height
              << " vsync=" << vsync
              << " presents=" << presents << '\n';
    if (err && err[0]) {
        std::cout << "last_error=" << err << '\n';
    }
    if (presents == 0) {
        std::cerr << "no presents\n";
        tw_shutdown();
        return 3;
    }
    if ((testExclusiveFullscreen || testBorderlessFullscreen) &&
        !tw_set_fullscreen(0, 0, 0, 0)) {
        std::cerr << "fullscreen restore failed: " << tw_last_error() << '\n';
        tw_shutdown();
        return 7;
    }
    int overlayRowBytes = 0;
    if (!tw_overlay_raster(width, height, 120, 8000, tw_backend_name(), 0, presents, &overlayRowBytes)) {
        std::cerr << "overlay raster failed\n";
        tw_shutdown();
        return 4;
    }
    const uint64_t firstOverlayRevision = tw_overlay_revision();
    tw_overlay_raster(width, height, 121, 8100, tw_backend_name(), 0, presents + 1, &overlayRowBytes);
    if (tw_overlay_revision() != firstOverlayRevision) {
        std::cerr << "diagnostic overlay rebuilt without its refresh interval elapsing\n";
        tw_shutdown();
        return 5;
    }
    tw_toggle_fps_overlay();
    tw_set_overlay(1);
    int overlayLeft = 0;
    int overlayTop = 0;
    int overlayWidth = 0;
    int overlayHeight = 0;
    tw_overlay_bounds(3840, 2160, &overlayLeft, &overlayTop, &overlayWidth, &overlayHeight);
    if (overlayWidth > 620 || overlayHeight > 430 || overlayWidth < 1 || overlayHeight < 1) {
        std::cerr << "menu overlay was not bounded to its resident panel texture\n";
        tw_shutdown();
        return 9;
    }
    const uint8_t* menuPixels = tw_overlay_raster(
        3840, 2160, 120, 8000, tw_backend_name(), 0, presents, &overlayRowBytes);
    if (!menuPixels) {
        std::cerr << "cropped menu raster was empty\n";
        tw_shutdown();
        return 11;
    }
    size_t lightMenuPixels = 0;
    const size_t menuPixelCount = static_cast<size_t>(overlayWidth) * overlayHeight;
    for (int y = 0; y < overlayHeight; ++y) {
        const uint8_t* row = menuPixels + static_cast<size_t>(y) * overlayRowBytes;
        for (int x = 0; x < overlayWidth; ++x) {
            const uint8_t* pixel = row + x * 4;
            if (pixel[0] > 180 && pixel[1] > 180 && pixel[2] > 180) {
                ++lightMenuPixels;
            }
        }
    }
    if (menuPixelCount == 0 || lightMenuPixels * 100 < menuPixelCount * 70) {
        std::cerr << "cropped menu content was not aligned to its resident texture\n";
        tw_shutdown();
        return 11;
    }
    const uint64_t menuRevision = tw_overlay_revision();
    for (int i = 0; i < 1000; ++i) {
        tw_overlay_raster(3840, 2160, 120 + (i & 3), 8000 + i,
                          tw_backend_name(), 0, presents + i, &overlayRowBytes);
    }
    if (tw_overlay_revision() != menuRevision) {
        std::cerr << "static menu overlay rebuilt for changing diagnostics\n";
        tw_shutdown();
        return 10;
    }
    tw_set_overlay(0);
    tw_shutdown();
    return 0;
}
