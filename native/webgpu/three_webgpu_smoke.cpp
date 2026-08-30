#include "three_webgpu.h"
#include "cmd_ops_webgpu.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <algorithm>
#include <chrono>
#include <array>
#include <cstddef>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <new>
#include <string>
#include <thread>
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

bool runDynamicTriangleMeshSmoke() {
    TWRayQueryCapabilities before{};
    before.struct_size = sizeof(before);
    if (!tw_ray_query_capabilities(&before) || !before.supported) return true;

    constexpr uint32_t kPositionsTexture = 100;
    constexpr uint32_t kStaticEncoder = 101;
    constexpr uint32_t kCreateEncoder = 102;
    constexpr uint32_t kRefitEncoder = 103;
    constexpr uint32_t kRebuildEncoder = 104;
    constexpr uint32_t kDestroyEncoder = 105;
    constexpr uint32_t kMesh = 106;
    constexpr uint32_t kRgba32Float = 41;
    constexpr uint32_t kTextureUsage = 0x01u | 0x02u | 0x08u;
    constexpr uint32_t kTextureDimension2D = 2;
    constexpr uint32_t kTransferDstLayout = 7;
    constexpr uint32_t kProtocolVersion = 1;
    const std::array<float, 16> dynamicPositions{{
        -0.25f, -0.25f, 0.0f, 1.0f,
         0.25f, -0.25f, 0.0f, 1.0f,
         0.00f,  0.25f, 0.0f, 1.0f,
         0.00f,  0.00f, 0.0f, 1.0f,
    }};
    const std::array<float, 9> staticPositions{{
        -1.0f, -1.0f, 1.0f,
         1.0f, -1.0f, 1.0f,
         0.0f,  1.0f, 1.0f,
    }};
    const std::array<uint32_t, 3> indices{{0u, 1u, 2u}};

    Stream stream;
    {
        const auto start = stream.begin(tw::cmd::OP_TEX_CREATE);
        stream.u32(kPositionsTexture);
        stream.u32(2u);
        stream.u32(2u);
        stream.u32(1u);
        stream.u32(kRgba32Float);
        stream.u32(kTextureUsage);
        stream.u32(kTextureDimension2D);
        stream.u32(1u);
        stream.u32(1u);
        stream.u32(0u);
        stream.end(start);
    }
    {
        const auto start = stream.begin(tw::cmd::OP_TEX_WRITE);
        stream.u32(kPositionsTexture);
        stream.u32(0u); // mip
        stream.u32(0u);
        stream.u32(0u);
        stream.u32(0u);
        stream.u32(2u);
        stream.u32(2u);
        stream.u32(1u);
        stream.u32(2u * 4u * sizeof(float));
        stream.u32(2u);
        stream.u32(static_cast<uint32_t>(dynamicPositions.size() * sizeof(float)));
        stream.u32(0u);
        stream.raw(dynamicPositions.data(),
                   static_cast<uint32_t>(dynamicPositions.size() * sizeof(float)));
        stream.end(start);
    }
    const auto beginEncoder = [&stream](uint32_t handle) {
        const auto start = stream.begin(tw::cmd::OP_ENC_BEGIN);
        stream.u32(handle);
        stream.u32(0u);
        stream.end(start);
    };
    const auto submitEncoder = [&stream] {
        const auto start = stream.begin(tw::cmd::OP_SUBMIT);
        stream.end(start);
    };

    beginEncoder(kStaticEncoder);
    {
        const auto start = stream.begin(tw::cmd::OP_RTX_SCENE_BEGIN);
        stream.u32(kProtocolVersion);
        stream.end(start);
    }
    {
        const auto start = stream.begin(tw::cmd::OP_RTX_SCENE_POSITIONS);
        stream.u32(kProtocolVersion);
        stream.u32(3u);
        stream.raw(staticPositions.data(),
                   static_cast<uint32_t>(staticPositions.size() * sizeof(float)));
        stream.end(start);
    }
    {
        const auto start = stream.begin(tw::cmd::OP_RTX_SCENE_INDICES);
        stream.u32(kProtocolVersion);
        stream.u32(static_cast<uint32_t>(indices.size()));
        stream.raw(indices.data(),
                   static_cast<uint32_t>(indices.size() * sizeof(uint32_t)));
        stream.end(start);
    }
    {
        const auto start = stream.begin(tw::cmd::OP_RTX_SCENE_COMMIT);
        stream.u32(kProtocolVersion);
        stream.u32(kStaticEncoder);
        stream.end(start);
    }
    submitEncoder();

    beginEncoder(kCreateEncoder);
    {
        const auto start = stream.begin(tw::cmd::OP_RTX_DYNAMIC_MESH_CREATE);
        stream.u32(kProtocolVersion);
        stream.u32(kCreateEncoder);
        stream.u32(kMesh);
        stream.u32(kPositionsTexture);
        stream.u32(kTransferDstLayout);
        stream.u32(2u);
        stream.u32(2u);
        stream.u32(3u);
        stream.u32(static_cast<uint32_t>(indices.size()));
        stream.raw(indices.data(),
                   static_cast<uint32_t>(indices.size() * sizeof(uint32_t)));
        stream.end(start);
    }
    submitEncoder();

    const auto appendRefit = [&](uint32_t encoder, bool rebuild) {
        beginEncoder(encoder);
        const auto start = stream.begin(tw::cmd::OP_RTX_DYNAMIC_MESH_REFIT);
        stream.u32(kProtocolVersion);
        stream.u32(encoder);
        stream.u32(kMesh);
        stream.u32(kPositionsTexture);
        stream.u32(kTransferDstLayout);
        stream.u32(2u);
        stream.u32(2u);
        stream.u32(3u);
        stream.u32(rebuild ? 1u : 0u);
        stream.end(start);
        submitEncoder();
    };
    appendRefit(kRefitEncoder, false);
    appendRefit(kRebuildEncoder, true);

    beginEncoder(kDestroyEncoder);
    {
        const auto start = stream.begin(tw::cmd::OP_RTX_DYNAMIC_MESH_DESTROY);
        stream.u32(kProtocolVersion);
        stream.u32(kDestroyEncoder);
        stream.u32(kMesh);
        stream.end(start);
    }
    submitEncoder();

    if (!tw_cmd_submit(stream.bytes.data(), static_cast<int>(stream.bytes.size()))) {
        std::cerr << "dynamic triangle-mesh command submit failed: "
                  << tw_last_error() << '\n';
        return false;
    }
    TWRayQueryCapabilities after{};
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    do {
        after = {};
        after.struct_size = sizeof(after);
        tw_ray_query_capabilities(&after);
        if (after.failure_count != before.failure_count ||
            after.build_count >= before.build_count + 5u) {
            break;
        }
        Sleep(1);
    } while (std::chrono::steady_clock::now() < deadline);
    if (!after.active || after.failure_count != before.failure_count ||
        after.build_count != before.build_count + 5u ||
        after.triangle_count != 1u) {
        std::cerr << "dynamic triangle-mesh GPU smoke failed: "
                  << after.reason << " builds=" << after.build_count
                  << " failures=" << after.failure_count
                  << " triangles=" << after.triangle_count << '\n';
        return false;
    }
    std::cout << "dynamic_blas=ok builds="
              << (after.build_count - before.build_count) << '\n';
    return true;
}

bool runLegacyGpuQuerySmoke() {
    constexpr size_t kLegacyCapabilitiesSize =
        offsetof(TWGpuCapabilities, dlss_neural_rendering);
    constexpr size_t kLegacyStatusSize =
        offsetof(TWGpuFeatureStatus, neural_rendering_supported);
    constexpr size_t kCanarySize = 32;

    alignas(TWGpuCapabilities)
        std::array<uint8_t, sizeof(TWGpuCapabilities) + kCanarySize>
            capabilitiesBytes{};
    auto* capabilities =
        new (capabilitiesBytes.data()) TWGpuCapabilities{};
    std::fill(capabilitiesBytes.begin() + kLegacyCapabilitiesSize,
              capabilitiesBytes.end(), 0xa5);
    capabilities->struct_size =
        static_cast<uint32_t>(kLegacyCapabilitiesSize);
    if (!tw_gpu_capabilities(capabilities) ||
        capabilities->struct_size != kLegacyCapabilitiesSize ||
        !std::all_of(capabilitiesBytes.begin() + kLegacyCapabilitiesSize,
                     capabilitiesBytes.end(),
                     [](uint8_t value) { return value == 0xa5; })) {
        std::cerr << "Legacy GPU capability query crossed its caller-owned boundary\n";
        return false;
    }

    alignas(TWGpuFeatureStatus)
        std::array<uint8_t, sizeof(TWGpuFeatureStatus) + kCanarySize>
            statusBytes{};
    auto* status = new (statusBytes.data()) TWGpuFeatureStatus{};
    std::fill(statusBytes.begin() + kLegacyStatusSize, statusBytes.end(),
              0x5a);
    status->struct_size = static_cast<uint32_t>(kLegacyStatusSize);
    if (!tw_gpu_feature_status(status) ||
        status->struct_size != kLegacyStatusSize ||
        !std::all_of(statusBytes.begin() + kLegacyStatusSize,
                     statusBytes.end(),
                     [](uint8_t value) { return value == 0x5a; })) {
        std::cerr << "Legacy GPU feature query crossed its caller-owned boundary\n";
        return false;
    }
    return true;
}

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
    TWGpuCapabilities gpuCapabilities{};
    gpuCapabilities.struct_size = sizeof(gpuCapabilities);
    const auto capabilityDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    do {
        tw_gpu_capabilities(&gpuCapabilities);
        if (gpuCapabilities.adapter_name[0] != '\0') break;
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    } while (std::chrono::steady_clock::now() < capabilityDeadline);
    if (gpuCapabilities.adapter_name[0] == '\0') {
        std::cerr << "GPU capability query failed\n";
        tw_shutdown();
        return 13;
    }
    if (std::string(tw_backend_name()) == "Vulkan" && gpuCapabilities.streamline_present &&
        !gpuCapabilities.vulkan_attached) {
        std::cerr << "Streamline did not attach to the native Vulkan device: "
                  << gpuCapabilities.status << '\n';
        tw_shutdown();
        return 14;
    }
    std::cout << "gpu=" << gpuCapabilities.adapter_name
              << " rtx=" << gpuCapabilities.is_rtx
              << " dlss=" << gpuCapabilities.dlss_super_resolution
              << " framegen=" << gpuCapabilities.dlss_frame_generation
              << " rayreconstruction=" << gpuCapabilities.dlss_ray_reconstruction
              << " neuralrendering=" << gpuCapabilities.dlss_neural_rendering
              << " neuralrendering_api="
              << gpuCapabilities.dlss_neural_rendering_api_loaded
              << " reflex=" << gpuCapabilities.reflex
              << " status=\"" << gpuCapabilities.status << "\"\n";

    if (!runLegacyGpuQuerySmoke()) {
        tw_shutdown();
        return 21;
    }

    if (!runDynamicTriangleMeshSmoke()) {
        tw_shutdown();
        return 19;
    }

    TWGpuFeatureStatus featureStatus{};
    featureStatus.struct_size = sizeof(featureStatus);
    if (!tw_gpu_feature_status(&featureStatus)) {
        std::cerr << "GPU feature-state query failed\n";
        tw_shutdown();
        return 15;
    }
    if (featureStatus.neural_rendering_supported !=
            gpuCapabilities.dlss_neural_rendering ||
        featureStatus.neural_rendering_api_loaded !=
            gpuCapabilities.dlss_neural_rendering_api_loaded ||
        featureStatus.neural_rendering_requested ||
        featureStatus.neural_rendering_configured ||
        featureStatus.neural_rendering_active ||
        featureStatus.neural_rendering_evaluation_count != 0) {
        std::cerr << "DLSS Neural Rendering reported state without an evaluation: "
                  << featureStatus.neural_rendering_reason << '\n';
        tw_shutdown();
        return 20;
    }
    if (gpuCapabilities.dlss_super_resolution) {
        TWGpuFeatureRequest request{};
        request.struct_size = sizeof(request);
        request.dlss_mode = TW_DLSS_MAX_QUALITY;
        request.output_width = 640;
        request.output_height = 480;
        request.pre_exposure = 1.0f;
        request.exposure_scale = 1.0f;
        request.color_buffers_hdr = 1;
        request.ray_reconstruction = gpuCapabilities.dlss_ray_reconstruction ? 1 : 0;
        if (!tw_request_gpu_features(&request)) {
            std::cerr << "DLSS request failed: " << tw_last_error() << '\n';
            tw_shutdown();
            return 16;
        }
        featureStatus = {};
        featureStatus.struct_size = sizeof(featureStatus);
        if (!tw_gpu_feature_status(&featureStatus) || !featureStatus.dlss_requested ||
            !featureStatus.dlss_configured || featureStatus.dlss_active) {
            std::cerr << "DLSS request state was not truthful: "
                      << featureStatus.dlss_reason << '\n';
            tw_shutdown();
            return 17;
        }
        if (gpuCapabilities.dlss_ray_reconstruction &&
            (!featureStatus.ray_reconstruction_supported ||
             !featureStatus.ray_reconstruction_api_loaded ||
             !featureStatus.ray_reconstruction_requested ||
             featureStatus.ray_reconstruction_configured ||
             featureStatus.ray_reconstruction_active ||
             featureStatus.ray_reconstruction_evaluation_count != 0)) {
            std::cerr << "Ray Reconstruction claimed activation without real denoiser inputs: "
                      << featureStatus.ray_reconstruction_reason << '\n';
            tw_shutdown();
            return 18;
        }
    }

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
    if (overlayWidth > 680 || overlayHeight > 680 || overlayWidth < 1 || overlayHeight < 1) {
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
    tw_overlay_wheel(-120);
    tw_overlay_raster(3840, 2160, 120, 8000, tw_backend_name(), 0, presents,
                      &overlayRowBytes);
    if (tw_overlay_revision() == menuRevision) {
        std::cerr << "pixel scrolling did not invalidate the menu overlay\n";
        tw_shutdown();
        return 12;
    }
    tw_set_overlay(0);
    tw_shutdown();
    return 0;
}
