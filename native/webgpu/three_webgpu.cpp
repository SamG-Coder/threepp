#include "three_webgpu.h"
#include "cmd_ops_webgpu.hpp"
#include "ray_query_bridge.h"
#include "shader_compiler.h"
#include "streamline_bridge.h"

#ifndef WGPU_SHARED_LIBRARY
#define WGPU_SHARED_LIBRARY
#endif
#include "wgpu.h"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>

#if defined(THREEBROWSER_STREAMLINE) || defined(THREEBROWSER_RAY_QUERY)
#include <vulkan/vulkan.h>
#endif

#include <algorithm>
#include <array>
#include <cctype>
#include <atomic>
#include <chrono>
#include <climits>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <deque>
#include <fstream>
#include <functional>
#include <future>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace {

constexpr wchar_t kClassName[] = L"ThreeBrowser.WebGPU";

WGPUStringView twSv(const char* s) {
    WGPUStringView v{};
    v.data = s;
    v.length = s ? WGPU_STRLEN : 0;
    return v;
}

std::string fromWgpuString(WGPUStringView value) {
    if (!value.data) return {};
    const size_t length = value.length == WGPU_STRLEN ? std::strlen(value.data) : value.length;
    return std::string(value.data, length);
}

void logLine(const char* message) {
    std::ofstream out("C:\\ThreeBrowser\\host\\native.log", std::ios::app);
    if (out) {
        out << "[webgpu] " << (message ? message : "") << '\n' << std::flush;
    }
}

enum class Kind {
    None,
    Buffer,
    Texture,
    TextureView,
    Sampler,
    Shader,
    BindGroupLayout,
    PipelineLayout,
    ComputePipeline,
    RenderPipeline,
    BindGroup,
    Encoder
};

struct Slot {
    Kind kind{Kind::None};
    WGPUBuffer buffer{};
    WGPUTexture texture{};
    WGPUTextureView view{};
    WGPUSampler sampler{};
    WGPUShaderModule shader{};
    WGPUBindGroupLayout bgl{};
    WGPUPipelineLayout pl{};
    WGPUComputePipeline cpipe{};
    WGPURenderPipeline rpipe{};
    WGPUBindGroup bg{};
    WGPUCommandEncoder encoder{};
    uint32_t texW{0};
    uint32_t texH{0};
    uint32_t texD{0};
    uint32_t texSampleCount{1};
    uint32_t texMipLevels{1};
    uint32_t textureHandle{0};
    WGPUTextureFormat texFormat{WGPUTextureFormat_Undefined};
    WGPUTextureUsage texUsage{WGPUTextureUsage_None};
    WGPUBufferUsage bufUsage{WGPUBufferUsage_None};
    uint64_t bufSize{0};
    std::string wgsl;
};

struct DisplayMode {
    int width{};
    int height{};
    int refreshHz{};
};

struct OverlayDropdown {
    bool open{false};
    int hoverIndex{-1};
    int scrollOffset{0};
};

struct Runtime {
    std::mutex mu;
    std::condition_variable cv;
    std::deque<std::function<void()>> jobs;
    std::thread worker;
    std::thread::id workerId;
    bool stop{false};
    bool workerStarted{false};

    std::mutex errMu;
    std::string lastError;
    std::string backendName{"WebGPU"};
    WGPUBackendType backendType{WGPUBackendType_Undefined};

    std::atomic<void*> nativeHwnd{nullptr};
    std::atomic<int> statsFps{0};
    std::atomic<int> statsFrameUs{0};
    std::atomic<int> statsW{0};
    std::atomic<int> statsH{0};
    std::atomic<uint64_t> statsPresents{0};
    std::atomic<uint64_t> statsCmdSubmits{0};
    std::atomic<uint64_t> validationErrors{0};
    std::atomic<uint64_t> statsCmdBytes{0};
    std::atomic<int> pendingCommandSubmits{0};
    std::atomic<uint64_t> commandGeneration{1};
    std::atomic<int> vsync{0};
    std::atomic<int> open{0};
    std::atomic<int> wheelDelta{0};
    std::atomic<int> standaloneUi{0};
    std::atomic<int> fpsOverlay{0};
    std::atomic<int> debugOverlay{0};
    std::atomic<int> overlayOpen{0};
    std::atomic<int> overlayDirty{1};
    std::atomic<int> overlayScrollPx{0};
    std::atomic<uint64_t> overlayRevision{0};
    std::atomic<void*> overlayWindow{nullptr};
    std::mutex featureControlMu;
    StreamlineDLSSOptions requestedDlssOptions{};
    bool featureRequestValid{false};
    bool requestedFrameGeneration{false};
    bool requestedRayReconstruction{false};
    int requestedReflexMode{-1};
    std::atomic<int> dlssRuntimeEnabled{1};
    std::atomic<int> frameGenerationRuntimeEnabled{1};
    std::atomic<int> rayReconstructionRuntimeEnabled{1};
    std::atomic<int> reflexRuntimeEnabled{1};
    // Runtime controls are preferences.  Keep the last successfully applied
    // state separate so public feature status never races ahead of Streamline.
    std::atomic<int> dlssRuntimeApplied{1};
    std::atomic<int> frameGenerationRuntimeApplied{1};
    std::atomic<int> rayReconstructionRuntimeApplied{1};
    std::atomic<int> reflexRuntimeApplied{1};
    std::atomic<int> featureApplyPending{0};
    std::atomic<uint64_t> featureControlRevision{0};
    std::atomic<int> overlayFeatureHover{-1};
    std::string featureControlError;
    std::atomic<int> fullscreenState{0};
    std::mutex displayMu;
    std::vector<DisplayMode> displayModes;
    int selectedDisplayMode{0};
    OverlayDropdown resolutionDropdown{};
    bool displayCommandReady{false};
    int displayCommandEnabled{0}; // 0 windowed, 1 borderless, 2 exclusive
    DisplayMode displayCommandMode{};
    bool pendingDisplayTransition{false};
    int pendingDisplayMode{0};
    DisplayMode pendingDisplayModeDetails{};
    std::atomic<int> loading{0};
    std::atomic<uint32_t> loadingPhase{0};
    std::mutex loadingMu;
    std::wstring loadingStage{L"Preparing native renderer"};
    std::atomic<int> pointerLocked{0};
    int mouseButtons{0};
    bool trackingMouseLeave{false};
    std::mutex inputMu;
    std::deque<TWInputEvent> inputEvents;
    POINT pointerRestore{};
    bool pointerRestoreValid{false};

    HWND hwnd{nullptr};
    HWND parent{nullptr};
    bool classRegistered{false};
    bool started{false};
    bool fullscreenActive{false};
    bool windowedStateSaved{false};
    bool displayModeChanged{false};
    WINDOWPLACEMENT windowedPlacement{sizeof(WINDOWPLACEMENT)};
    LONG_PTR windowedStyle{0};
    LONG_PTR windowedExStyle{0};
    std::wstring fullscreenDevice;

    WGPUTexture overlayTexture{};
    WGPUTextureView overlayView{};
    WGPUSampler overlaySampler{};
    WGPUShaderModule overlayShader{};
    WGPURenderPipeline overlayPipeline{};
    WGPUBindGroup overlayBindGroup{};
    int overlayWidth{0};
    int overlayHeight{0};
    int overlayLeft{0};
    int overlayTop{0};
    uint32_t overlaySampleCount{1};
    WGPUTextureFormat overlayDepthFormat{WGPUTextureFormat_Undefined};
    int overlayRenderedFps{-1};
    std::vector<uint8_t> overlayPixels;

    uint32_t gpuVendorId{0};
    uint32_t gpuDeviceId{0};
    std::string gpuDeviceName;
    bool streamlineSimulationEnded{false};
    bool rtxAdapter{false};
    bool rayQueryFeatureEnabled{false};

    WGPUInstance instance{};
    WGPUAdapter adapter{};
    WGPUDevice device{};
    WGPUQueue queue{};
    WGPUSurface surface{};
    WGPUSurfaceConfiguration config{};
    WGPUTextureFormat surfaceFormat{WGPUTextureFormat_BGRA8Unorm};
    WGPUCompositeAlphaMode alphaMode{WGPUCompositeAlphaMode_Opaque};
    std::vector<WGPUPresentMode> presentModes;

    WGPUTexture currentTex{};
    WGPUTextureView currentView{};
    bool surfaceConfigured{false};
    int pendingResizeW{0};
    int pendingResizeH{0};
    int resizeHoldFrames{0};

    std::unordered_map<uint32_t, Slot> slots;
    WGPUCommandEncoder currentEncoder{};
    uint32_t currentEncoderHandle{0};
    bool currentEncoderUsesSurface{false};
    bool activeRenderPassUsesSurface{false};
    uint32_t activeRenderPassSampleCount{1};
    WGPUTextureFormat activeRenderPassDepthFormat{WGPUTextureFormat_Undefined};
    int activeRenderPassWidth{0};
    int activeRenderPassHeight{0};
    bool overlayRecordedForCurrentTexture{false};
    WGPUComputePassEncoder computePass{};
    WGPURenderPassEncoder renderPass{};
    bool computePipelineSet{false};
    bool renderPipelineSet{false};
    bool skipRenderPass{false};
    bool traceCommands{false};
    int traceRemaining{0};
    std::atomic_bool statsLog{false};
    std::chrono::steady_clock::time_point lastStatsLog{};
};

Runtime g;

WGPUCommandEncoder ensureEncoder();
bool acquireSwapchain();
void tryApplyPendingDisplayTransition();
void requestSurfaceResize(int w, int h);
void restoreExclusiveFullscreenOnWindowThread(bool reconfigureSurface);
void dropdownClamp(OverlayDropdown& dropdown, int itemCount);

bool sameResolution(const DisplayMode& a, const DisplayMode& b) {
    return a.width == b.width && a.height == b.height;
}

bool displayInfoForWindow(HWND hwnd, MONITORINFOEXW& info) {
    if (!hwnd || !IsWindow(hwnd)) return false;
    info = {};
    info.cbSize = sizeof(info);
    const HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    return monitor && GetMonitorInfoW(monitor, &info) != FALSE;
}

std::vector<DisplayMode> enumerateDisplayModes(HWND hwnd) {
    MONITORINFOEXW monitor{};
    if (!displayInfoForWindow(hwnd, monitor)) return {};

    DEVMODEW current{};
    current.dmSize = sizeof(current);
    if (!EnumDisplaySettingsExW(monitor.szDevice, ENUM_CURRENT_SETTINGS, &current, 0)) return {};
    const DisplayMode currentMode{static_cast<int>(current.dmPelsWidth),
                                  static_cast<int>(current.dmPelsHeight),
                                  std::max(1, static_cast<int>(current.dmDisplayFrequency))};

    std::vector<DisplayMode> available;
    for (DWORD index = 0;; ++index) {
        DEVMODEW mode{};
        mode.dmSize = sizeof(mode);
        if (!EnumDisplaySettingsExW(monitor.szDevice, index, &mode, 0)) break;
        if (mode.dmPelsWidth < 800 || mode.dmPelsHeight < 600 || mode.dmBitsPerPel < 24) continue;
        const DisplayMode candidate{static_cast<int>(mode.dmPelsWidth),
                                    static_cast<int>(mode.dmPelsHeight),
                                    std::max(1, static_cast<int>(mode.dmDisplayFrequency))};
        auto existing = std::find_if(available.begin(), available.end(), [&](const DisplayMode& value) {
            return sameResolution(value, candidate);
        });
        if (existing == available.end()) available.push_back(candidate);
        else existing->refreshHz = std::max(existing->refreshHz, candidate.refreshHz);
    }

    auto findResolution = [&](int width, int height) -> const DisplayMode* {
        auto found = std::find_if(available.begin(), available.end(), [&](const DisplayMode& value) {
            return value.width == width && value.height == height;
        });
        return found == available.end() ? nullptr : &*found;
    };
    std::vector<DisplayMode> choices;
    auto add = [&](const DisplayMode& mode) {
        if (std::none_of(choices.begin(), choices.end(), [&](const DisplayMode& value) {
                return sameResolution(value, mode);
            })) choices.push_back(mode);
    };
    add(currentMode);
    constexpr int preferred[][2] = {
        {3840, 2160}, {3440, 1440}, {2560, 1440}, {2560, 1080},
        {1920, 1200}, {1920, 1080}, {1600, 900}, {1366, 768}, {1280, 720}
    };
    for (const auto& resolution : preferred) {
        if (const DisplayMode* mode = findResolution(resolution[0], resolution[1])) add(*mode);
        if (choices.size() >= 24) break;
    }
    std::sort(available.begin(), available.end(), [](const DisplayMode& a, const DisplayMode& b) {
        const long long pixelsA = static_cast<long long>(a.width) * a.height;
        const long long pixelsB = static_cast<long long>(b.width) * b.height;
        return pixelsA != pixelsB ? pixelsA > pixelsB : a.refreshHz > b.refreshHz;
    });
    for (const DisplayMode& mode : available) {
        if (choices.size() >= 24) break;
        add(mode);
    }
    return choices;
}

void refreshDisplayModes() {
    HWND hwnd = static_cast<HWND>(g.overlayWindow.load(std::memory_order_acquire));
    if (!hwnd || !IsWindow(hwnd)) hwnd = g.hwnd;
    std::vector<DisplayMode> modes = enumerateDisplayModes(hwnd);
    if (modes.empty()) return;
    std::lock_guard<std::mutex> lock(g.displayMu);
    DisplayMode previous{};
    if (!g.displayModes.empty() && g.selectedDisplayMode >= 0 &&
        g.selectedDisplayMode < static_cast<int>(g.displayModes.size())) {
        previous = g.displayModes[static_cast<size_t>(g.selectedDisplayMode)];
    }
    g.displayModes = std::move(modes);
    g.selectedDisplayMode = 0;
    if (previous.width > 0) {
        for (size_t index = 0; index < g.displayModes.size(); ++index) {
            if (sameResolution(g.displayModes[index], previous)) {
                g.selectedDisplayMode = static_cast<int>(index);
                break;
            }
        }
    }
    dropdownClamp(g.resolutionDropdown, static_cast<int>(g.displayModes.size()));
}

void setError(const char* message) {
    std::lock_guard<std::mutex> lock(g.errMu);
    g.lastError = message ? message : "";
    if (message && message[0]) {
        logLine(message);
    }
}

void pumpHwnd() {
    MSG msg;
    while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

std::wstring wideFromUtf8(const char* text) {
    if (!text || !text[0]) return {};
    const int length = MultiByteToWideChar(CP_UTF8, 0, text, -1, nullptr, 0);
    if (length <= 1) return {};
    std::wstring result(static_cast<size_t>(length), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text, -1, result.data(), length);
    result.resize(static_cast<size_t>(length - 1));
    return result;
}

void setLoadingState(bool enabled, const char* stage) {
    if (stage && stage[0]) {
        std::wstring converted = wideFromUtf8(stage);
        if (!converted.empty()) {
            std::lock_guard<std::mutex> lock(g.loadingMu);
            g.loadingStage = std::move(converted);
        }
    }
    g.loading.store(enabled ? 1 : 0, std::memory_order_release);
    g.loadingPhase.store(0, std::memory_order_relaxed);
    g.overlayDirty.store(1, std::memory_order_release);
    if (g.hwnd) PostMessageW(g.hwnd, WM_SETCURSOR, reinterpret_cast<WPARAM>(g.hwnd), MAKELPARAM(HTCLIENT, WM_MOUSEMOVE));
    g.cv.notify_one();
}

int inputModifiers() {
    int modifiers = 0;
    if (GetKeyState(VK_SHIFT) & 0x8000) modifiers |= 1;
    if (GetKeyState(VK_CONTROL) & 0x8000) modifiers |= 2;
    if (GetKeyState(VK_MENU) & 0x8000) modifiers |= 4;
    return modifiers;
}

void queueInput(int type, int code, int x, int y, int movementX = 0, int movementY = 0) {
    std::lock_guard<std::mutex> lock(g.inputMu);
    if (g.inputEvents.size() >= 2048) g.inputEvents.pop_front();
    g.inputEvents.push_back(TWInputEvent{type, code, x, y, movementX, movementY, inputModifiers()});
}

void setPointerLockOnWindowThread(bool enabled, bool notifyLoss = false) {
    if (!g.hwnd) return;
    if (enabled) {
        if (g.pointerLocked.load(std::memory_order_relaxed)) return;
        g.pointerRestoreValid = GetCursorPos(&g.pointerRestore) != FALSE;
        RECT client{};
        GetClientRect(g.hwnd, &client);
        POINT topLeft{client.left, client.top};
        POINT bottomRight{client.right, client.bottom};
        ClientToScreen(g.hwnd, &topLeft);
        ClientToScreen(g.hwnd, &bottomRight);
        RECT clip{topLeft.x, topLeft.y, bottomRight.x, bottomRight.y};
        ClipCursor(&clip);
        SetCapture(g.hwnd);
        while (ShowCursor(FALSE) >= 0) {}
        g.pointerLocked.store(1, std::memory_order_release);
    } else {
        if (!g.pointerLocked.exchange(0, std::memory_order_acq_rel)) return;
        ReleaseCapture();
        ClipCursor(nullptr);
        while (ShowCursor(TRUE) < 0) {}
        if (g.pointerRestoreValid) SetCursorPos(g.pointerRestore.x, g.pointerRestore.y);
        g.pointerRestoreValid = false;
        if (notifyLoss) queueInput(TW_INPUT_POINTER_LOCK_LOST, 0, 0, 0);
    }
}

LRESULT CALLBACK wndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_CLOSE:
            restoreExclusiveFullscreenOnWindowThread(false);
            ShowWindow(hwnd, SW_HIDE);
            g.open.store(0, std::memory_order_relaxed);
            return 0;
        case WM_DESTROY:
            g.open.store(0, std::memory_order_relaxed);
            return 0;
        case WM_SETFOCUS:
            return 0;
        case WM_KILLFOCUS:
            if (g.mouseButtons != 0) {
                g.mouseButtons = 0;
                queueInput(TW_INPUT_POINTER_CANCEL, 0, 0, 0);
            }
            setPointerLockOnWindowThread(false, true);
            return 0;
        case WM_SETCURSOR:
            if (LOWORD(lp) == HTCLIENT && g.loading.load(std::memory_order_relaxed)) {
                SetCursor(LoadCursorW(nullptr, MAKEINTRESOURCEW(32514)));
                return TRUE;
            }
            break;
        case WM_INPUT: {
            if (!g.pointerLocked.load(std::memory_order_relaxed)) return 0;
            UINT size = 0;
            GetRawInputData(reinterpret_cast<HRAWINPUT>(lp), RID_INPUT, nullptr, &size, sizeof(RAWINPUTHEADER));
            std::vector<uint8_t> storage(size);
            if (size && GetRawInputData(reinterpret_cast<HRAWINPUT>(lp), RID_INPUT, storage.data(), &size,
                                        sizeof(RAWINPUTHEADER)) == size) {
                const auto* raw = reinterpret_cast<const RAWINPUT*>(storage.data());
                if (raw->header.dwType == RIM_TYPEMOUSE &&
                    (raw->data.mouse.lLastX != 0 || raw->data.mouse.lLastY != 0)) {
                    RECT client{};
                    GetClientRect(hwnd, &client);
                    queueInput(TW_INPUT_POINTER_MOVE, 0, client.right / 2, client.bottom / 2,
                               raw->data.mouse.lLastX, raw->data.mouse.lLastY);
                }
            }
            return 0;
        }
        case WM_MOUSEMOVE:
            if (!g.pointerLocked.load(std::memory_order_relaxed)) {
                if (!g.trackingMouseLeave) {
                    TRACKMOUSEEVENT tracking{sizeof(TRACKMOUSEEVENT), TME_LEAVE, hwnd, 0};
                    if (TrackMouseEvent(&tracking)) g.trackingMouseLeave = true;
                }
                queueInput(TW_INPUT_POINTER_MOVE, 0, GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            }
            return 0;
        case WM_MOUSELEAVE:
            g.trackingMouseLeave = false;
            queueInput(TW_INPUT_POINTER_LEAVE, 0, 0, 0);
            return 0;
        case WM_LBUTTONDOWN:
        case WM_RBUTTONDOWN:
        case WM_MBUTTONDOWN:
            SetFocus(hwnd);
            if (!g.pointerLocked.load(std::memory_order_relaxed)) SetCapture(hwnd);
            g.mouseButtons |= msg == WM_LBUTTONDOWN ? 1 : msg == WM_RBUTTONDOWN ? 2 : 4;
            queueInput(TW_INPUT_POINTER_DOWN,
                       msg == WM_LBUTTONDOWN ? VK_LBUTTON : msg == WM_RBUTTONDOWN ? VK_RBUTTON : VK_MBUTTON,
                       GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            return 0;
        case WM_LBUTTONUP:
        case WM_RBUTTONUP:
        case WM_MBUTTONUP:
            g.mouseButtons &= ~(msg == WM_LBUTTONUP ? 1 : msg == WM_RBUTTONUP ? 2 : 4);
            queueInput(TW_INPUT_POINTER_UP,
                       msg == WM_LBUTTONUP ? VK_LBUTTON : msg == WM_RBUTTONUP ? VK_RBUTTON : VK_MBUTTON,
                       GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            if (g.mouseButtons == 0 && !g.pointerLocked.load(std::memory_order_relaxed) && GetCapture() == hwnd) ReleaseCapture();
            return 0;
        case WM_XBUTTONDOWN: {
            SetFocus(hwnd);
            if (!g.pointerLocked.load(std::memory_order_relaxed)) SetCapture(hwnd);
            const bool first = GET_XBUTTON_WPARAM(wp) == XBUTTON1;
            g.mouseButtons |= first ? 8 : 16;
            queueInput(TW_INPUT_POINTER_DOWN, first ? VK_XBUTTON1 : VK_XBUTTON2,
                       GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            return TRUE;
        }
        case WM_XBUTTONUP: {
            const bool first = GET_XBUTTON_WPARAM(wp) == XBUTTON1;
            g.mouseButtons &= ~(first ? 8 : 16);
            queueInput(TW_INPUT_POINTER_UP, first ? VK_XBUTTON1 : VK_XBUTTON2,
                       GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            if (g.mouseButtons == 0 && !g.pointerLocked.load(std::memory_order_relaxed) && GetCapture() == hwnd) ReleaseCapture();
            return TRUE;
        }
        case WM_LBUTTONDBLCLK:
        case WM_RBUTTONDBLCLK:
        case WM_MBUTTONDBLCLK:
            SetFocus(hwnd);
            if (!g.pointerLocked.load(std::memory_order_relaxed)) SetCapture(hwnd);
            g.mouseButtons |= msg == WM_LBUTTONDBLCLK ? 1 : msg == WM_RBUTTONDBLCLK ? 2 : 4;
            queueInput(TW_INPUT_POINTER_DOUBLE_CLICK,
                       msg == WM_LBUTTONDBLCLK ? VK_LBUTTON : msg == WM_RBUTTONDBLCLK ? VK_RBUTTON : VK_MBUTTON,
                       GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            return 0;
        case WM_XBUTTONDBLCLK: {
            SetFocus(hwnd);
            if (!g.pointerLocked.load(std::memory_order_relaxed)) SetCapture(hwnd);
            const bool first = GET_XBUTTON_WPARAM(wp) == XBUTTON1;
            g.mouseButtons |= first ? 8 : 16;
            queueInput(TW_INPUT_POINTER_DOUBLE_CLICK, first ? VK_XBUTTON1 : VK_XBUTTON2,
                       GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            return TRUE;
        }
        case WM_CAPTURECHANGED:
            if (!g.pointerLocked.load(std::memory_order_relaxed) && g.mouseButtons != 0) {
                g.mouseButtons = 0;
                queueInput(TW_INPUT_POINTER_CANCEL, 0, 0, 0);
            }
            return 0;
        case WM_MOUSEWHEEL:
            g.wheelDelta.fetch_add(GET_WHEEL_DELTA_WPARAM(wp), std::memory_order_relaxed);
            {
                POINT point{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
                ScreenToClient(hwnd, &point);
                queueInput(TW_INPUT_WHEEL, GET_WHEEL_DELTA_WPARAM(wp), point.x, point.y);
            }
            return 0;
        case WM_MOUSEHWHEEL:
            {
                POINT point{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
                ScreenToClient(hwnd, &point);
                queueInput(TW_INPUT_HORIZONTAL_WHEEL, GET_WHEEL_DELTA_WPARAM(wp), point.x, point.y);
            }
            return 0;
        case WM_KEYDOWN:
        case WM_SYSKEYDOWN:
            queueInput(TW_INPUT_KEY_DOWN, static_cast<int>(wp), 0, 0);
            return 0;
        case WM_KEYUP:
        case WM_SYSKEYUP:
            queueInput(TW_INPUT_KEY_UP, static_cast<int>(wp), 0, 0);
            return 0;
        case WM_SIZE:
            if (wp != SIZE_MINIMIZED) {
                g.statsW.store(std::max(1, static_cast<int>(LOWORD(lp))), std::memory_order_relaxed);
                g.statsH.store(std::max(1, static_cast<int>(HIWORD(lp))), std::memory_order_relaxed);
                g.overlayDirty.store(1, std::memory_order_relaxed);
            }
            return 0;
        case WM_ERASEBKGND:
            return 1;
        default:
            break;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

void ensureWorker();

template<class Fn>
auto onWorker(Fn&& fn) -> std::invoke_result_t<Fn> {
    using R = std::invoke_result_t<Fn>;
    ensureWorker();
    if (std::this_thread::get_id() == g.workerId) {
        return fn();
    }
    auto task = std::make_shared<std::packaged_task<R()>>(std::forward<Fn>(fn));
    auto fut = task->get_future();
    {
        std::lock_guard<std::mutex> lock(g.mu);
        if (g.stop) {
            throw std::runtime_error("webgpu runtime is shutting down");
        }
        g.jobs.emplace_back([task] { (*task)(); });
    }
    g.cv.notify_one();
    return fut.get();
}

void onWorkerAsync(std::function<void()> fn) {
    ensureWorker();
    {
        std::lock_guard<std::mutex> lock(g.mu);
        if (g.stop) {
            return;
        }
        g.jobs.emplace_back(std::move(fn));
    }
    g.cv.notify_one();
}

struct RuntimeFeatureIntent {
    bool valid{false};
    StreamlineDLSSOptions dlss{};
    bool frameGeneration{false};
    bool rayReconstruction{false};
    int reflexMode{-1};
};

struct RuntimeFeaturePreferences {
    bool dlss{true};
    bool frameGeneration{true};
    bool rayReconstruction{true};
    bool reflex{true};
};

struct RuntimeFeatureApplyResult {
    bool graphics{true};
    bool reflex{true};
};

RuntimeFeatureIntent runtimeFeatureIntent() {
    std::lock_guard<std::mutex> lock(g.featureControlMu);
    RuntimeFeatureIntent intent{};
    intent.valid = g.featureRequestValid;
    intent.dlss = g.requestedDlssOptions;
    intent.frameGeneration = g.requestedFrameGeneration;
    intent.rayReconstruction = g.requestedRayReconstruction;
    intent.reflexMode = g.requestedReflexMode;
    return intent;
}

RuntimeFeaturePreferences runtimeFeaturePreferences() {
    RuntimeFeaturePreferences preferences{};
    preferences.dlss = g.dlssRuntimeEnabled.load(std::memory_order_acquire) != 0;
    preferences.frameGeneration =
        g.frameGenerationRuntimeEnabled.load(std::memory_order_acquire) != 0;
    preferences.rayReconstruction =
        g.rayReconstructionRuntimeEnabled.load(std::memory_order_acquire) != 0;
    preferences.reflex = g.reflexRuntimeEnabled.load(std::memory_order_acquire) != 0;
    return preferences;
}

RuntimeFeaturePreferences runtimeAppliedFeatures() {
    RuntimeFeaturePreferences applied{};
    applied.dlss = g.dlssRuntimeApplied.load(std::memory_order_acquire) != 0;
    applied.frameGeneration =
        g.frameGenerationRuntimeApplied.load(std::memory_order_acquire) != 0;
    applied.rayReconstruction =
        g.rayReconstructionRuntimeApplied.load(std::memory_order_acquire) != 0;
    applied.reflex = g.reflexRuntimeApplied.load(std::memory_order_acquire) != 0;
    return applied;
}

void storeRuntimeAppliedGraphics(const RuntimeFeaturePreferences& target) {
    g.dlssRuntimeApplied.store(target.dlss ? 1 : 0, std::memory_order_release);
    g.frameGenerationRuntimeApplied.store(target.frameGeneration ? 1 : 0,
                                           std::memory_order_release);
    // Ray Reconstruction is an SR-dependent feature.  Preserve the user's
    // preference separately, but only report it applied while SR is applied.
    g.rayReconstructionRuntimeApplied.store(
        target.rayReconstruction && target.dlss ? 1 : 0,
        std::memory_order_release);
}

std::string runtimeFeatureFailureReason(bool graphicsFailure, bool reflexFailure) {
    const StreamlineFeatureState state = streamlineFeatureState();
    if (graphicsFailure) {
        if (!state.rayReconstructionReason.empty()) return state.rayReconstructionReason;
        if (!state.frameGenerationReason.empty()) return state.frameGenerationReason;
        if (!state.dlssReason.empty()) return state.dlssReason;
        return "Streamline rejected the requested DLSS feature configuration";
    }
    if (reflexFailure) return "Streamline rejected the requested NVIDIA Reflex mode";
    return {};
}

RuntimeFeatureApplyResult applyRuntimeFeatureTargetOnWorker(
    const RuntimeFeaturePreferences& target, bool forceGraphics, bool forceReflex) {
    const RuntimeFeatureIntent intent = runtimeFeatureIntent();
    const RuntimeFeaturePreferences applied = runtimeAppliedFeatures();
    RuntimeFeatureApplyResult result{};

    const bool effectiveRayReconstruction = target.rayReconstruction && target.dlss;
    const bool graphicsChanged = target.dlss != applied.dlss ||
        target.frameGeneration != applied.frameGeneration ||
        effectiveRayReconstruction != applied.rayReconstruction;
    if (forceGraphics || graphicsChanged) {
        if (intent.valid) {
            StreamlineDLSSOptions options = intent.dlss;
            if (!target.dlss) options.mode = StreamlineDLSSMode::Off;
            const bool frameGeneration = intent.frameGeneration && target.frameGeneration;
            const bool rayReconstruction = intent.rayReconstruction &&
                effectiveRayReconstruction;
            result.graphics = streamlineRequestFeatures(
                options, frameGeneration, rayReconstruction);
            if (result.graphics &&
                (options.mode != StreamlineDLSSMode::Off || frameGeneration ||
                 rayReconstruction)) {
                streamlineFrameBegin(static_cast<uint32_t>(
                    g.statsPresents.load(std::memory_order_relaxed)));
            }
        }
        if (result.graphics) storeRuntimeAppliedGraphics(target);
    }

    const bool reflexChanged = target.reflex != applied.reflex;
    if (forceReflex || reflexChanged) {
        int requestedMode = intent.reflexMode;
        if (!target.reflex) requestedMode = 0;
        // No page has requested Reflex yet.  Enabling the runtime gate is
        // still a successfully-applied permission, without forcing a mode.
        if (requestedMode >= 0) {
            result.reflex = streamlineSetReflexMode(requestedMode);
        }
        if (result.reflex) {
            g.reflexRuntimeApplied.store(target.reflex ? 1 : 0,
                                         std::memory_order_release);
        }
    }
    return result;
}

bool applyRuntimeFeatureRequestOnWorker(bool forceGraphics = false) {
    const RuntimeFeatureApplyResult result = applyRuntimeFeatureTargetOnWorker(
        runtimeFeaturePreferences(), forceGraphics, false);
    if (result.graphics) {
        std::lock_guard<std::mutex> lock(g.featureControlMu);
        g.featureControlError.clear();
    }
    g.overlayDirty.store(1, std::memory_order_release);
    return result.graphics;
}

void reapplyRuntimeFeatureRequestAsync() {
    const uint64_t revision =
        g.featureControlRevision.fetch_add(1, std::memory_order_acq_rel) + 1;
    g.featureApplyPending.store(1, std::memory_order_release);
    {
        std::lock_guard<std::mutex> lock(g.featureControlMu);
        g.featureControlError.clear();
    }
    onWorkerAsync([revision] {
        const RuntimeFeaturePreferences target = runtimeFeaturePreferences();
        const RuntimeFeatureApplyResult result = applyRuntimeFeatureTargetOnWorker(
            target, false, false);
        const bool current =
            revision == g.featureControlRevision.load(std::memory_order_acquire);
        if (current) {
            if (!result.graphics || !result.reflex) {
                const RuntimeFeaturePreferences applied = runtimeAppliedFeatures();
                // Roll the effective gates back to the last state Streamline
                // accepted.  RR's preference remains remembered while SR is
                // deliberately off so re-enabling SR restores it.
                g.dlssRuntimeEnabled.store(applied.dlss ? 1 : 0,
                                           std::memory_order_release);
                g.frameGenerationRuntimeEnabled.store(
                    applied.frameGeneration ? 1 : 0, std::memory_order_release);
                if (target.dlss) {
                    g.rayReconstructionRuntimeEnabled.store(
                        applied.rayReconstruction ? 1 : 0,
                        std::memory_order_release);
                }
                g.reflexRuntimeEnabled.store(applied.reflex ? 1 : 0,
                                             std::memory_order_release);
                std::lock_guard<std::mutex> lock(g.featureControlMu);
                g.featureControlError = runtimeFeatureFailureReason(
                    !result.graphics, !result.reflex);
            }
            g.featureApplyPending.store(0, std::memory_order_release);
        }
        g.overlayDirty.store(1, std::memory_order_release);
    });
}

StreamlineFeatureState runtimeFeatureState() {
    StreamlineFeatureState state = streamlineFeatureState();
    const bool dlssEnabled = g.dlssRuntimeApplied.load(std::memory_order_acquire) != 0;
    const bool frameGenerationEnabled =
        g.frameGenerationRuntimeApplied.load(std::memory_order_acquire) != 0;
    const bool rayReconstructionEnabled =
        g.rayReconstructionRuntimeApplied.load(std::memory_order_acquire) != 0;
    const bool rayReconstructionPreferred =
        g.rayReconstructionRuntimeEnabled.load(std::memory_order_acquire) != 0;

    if (!dlssEnabled) {
        state.dlssRequested = false;
        state.dlssConfigured = false;
        state.dlssActive = false;
        state.dlssMode = StreamlineDLSSMode::Off;
        state.renderWidth = 0;
        state.renderHeight = 0;
        state.outputWidth = 0;
        state.outputHeight = 0;
        state.estimatedVramBytes = 0;
        state.dlssLastResult = 0;
        state.dlssReason = "Disabled from runtime controls";
    }
    if (!frameGenerationEnabled) {
        state.frameGenerationRequested = false;
        state.frameGenerationConfigured = false;
        state.frameGenerationActive = false;
        state.frameGenerationFramesToGenerate = 0;
        state.frameGenerationLastFramesPresented = 0;
        state.frameGenerationEstimatedVramBytes = 0;
        state.frameGenerationLastResult = 0;
        state.frameGenerationLastStatus = 0;
        state.frameGenerationReason = "Disabled from runtime controls";
    }
    if (!rayReconstructionEnabled || !dlssEnabled) {
        state.rayReconstructionRequested = false;
        state.rayReconstructionConfigured = false;
        state.rayReconstructionActive = false;
        state.rayReconstructionEstimatedVramBytes = 0;
        state.rayReconstructionLastResult = 0;
        state.rayReconstructionReason = !dlssEnabled && rayReconstructionPreferred
            ? "Blocked by runtime controls: DLSS Super Resolution is disabled"
            : "Disabled from runtime controls";
    }
    return state;
}

bool hasVulkanDll() {
    HMODULE m = LoadLibraryW(L"vulkan-1.dll");
    if (!m) {
        return false;
    }
    FreeLibrary(m);
    return true;
}

void wgpuLog(WGPULogLevel level, WGPUStringView message, void*) {
    if (level > WGPULogLevel_Warn) {
        return;
    }
    std::string s;
    if (message.data && message.length) {
        const size_t n = message.length == WGPU_STRLEN ? std::strlen(message.data) : message.length;
        s.assign(message.data, n);
    }
    if (level == WGPULogLevel_Error) {
        setError(s.c_str());
    } else {
        logLine(s.c_str());
    }
}

void onUncaptured(WGPUDevice const*, WGPUErrorType, WGPUStringView message, void*, void*) {
    g.validationErrors.fetch_add(1, std::memory_order_relaxed);
    if (message.data && message.length) {
        const size_t n = message.length == WGPU_STRLEN ? std::strlen(message.data) : message.length;
        std::string s(message.data, n);
        setError(s.c_str());
        logLine(s.c_str());
    }
}

void onDeviceLost(WGPUDevice const*, WGPUDeviceLostReason, WGPUStringView message, void*, void*) {
    if (message.data && message.length) {
        const size_t n = message.length == WGPU_STRLEN ? std::strlen(message.data) : message.length;
        std::string s("device lost: ");
        s.append(message.data, n);
        setError(s.c_str());
    } else {
        setError("device lost");
    }
}

bool waitFuture(WGPUFuture fut) {
    if (!g.instance || fut.id == 0) {
        return true;
    }
    WGPUFutureWaitInfo info{};
    info.future = fut;
    for (int i = 0; i < 20000; ++i) {
        wgpuInstanceWaitAny(g.instance, 1, &info, 0);
        wgpuInstanceProcessEvents(g.instance);
        if (info.completed) {
            return true;
        }
        pumpHwnd();
        Sleep(0);
        if ((i % 64) == 63) {
            Sleep(1);
        }
    }
    return info.completed != 0;
}

WGPUPresentMode pickPresentMode(bool vsyncOn) {
    auto hasMode = [&](WGPUPresentMode m) {
        return std::find(g.presentModes.begin(), g.presentModes.end(), m) != g.presentModes.end();
    };
    if (vsyncOn) {
        return hasMode(WGPUPresentMode_Fifo) ? WGPUPresentMode_Fifo : WGPUPresentMode_Undefined;
    }
    if (hasMode(WGPUPresentMode_Immediate)) {
        return WGPUPresentMode_Immediate;
    }
    if (hasMode(WGPUPresentMode_Mailbox)) {
        return WGPUPresentMode_Mailbox;
    }
    return WGPUPresentMode_Fifo;
}

void dropCurrentTexture() {
    if (g.currentView) {
        wgpuTextureViewRelease(g.currentView);
        g.currentView = nullptr;
    }
    if (g.currentTex) {
        wgpuTextureRelease(g.currentTex);
        g.currentTex = nullptr;
    }
    g.overlayRecordedForCurrentTexture = false;
}

bool drawOverlayInPass(WGPURenderPassEncoder pass);

bool beginSwapchainPass(WGPULoadOp load, float cr, float cg, float cb, float ca) {
    WGPUCommandEncoder encoder = ensureEncoder();
    if (!encoder) {
        return false;
    }
    if (!acquireSwapchain() || !g.currentView) {
        setError("swapchain acquire failed");
        return false;
    }
    if (g.renderPass) {
        wgpuRenderPassEncoderEnd(g.renderPass);
        wgpuRenderPassEncoderRelease(g.renderPass);
        g.renderPass = nullptr;
    }
    WGPURenderPassColorAttachment caa{};
    caa.view = g.currentView;
    caa.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    caa.loadOp = load;
    caa.storeOp = WGPUStoreOp_Store;
    caa.clearValue.r = cr;
    caa.clearValue.g = cg;
    caa.clearValue.b = cb;
    caa.clearValue.a = ca;
    WGPURenderPassDescriptor rd{};
    rd.colorAttachmentCount = 1;
    rd.colorAttachments = &caa;
    g.renderPass = wgpuCommandEncoderBeginRenderPass(encoder, &rd);
    if (!g.renderPass) {
        setError("beginSwapchainPass failed");
        return false;
    }
    g.activeRenderPassUsesSurface = true;
    g.currentEncoderUsesSurface = true;
    g.activeRenderPassSampleCount = 1;
    g.activeRenderPassDepthFormat = WGPUTextureFormat_Undefined;
    g.activeRenderPassWidth = static_cast<int>(g.config.width);
    g.activeRenderPassHeight = static_cast<int>(g.config.height);
    return true;
}

void endPasses() {
    if (g.computePass) {
        wgpuComputePassEncoderEnd(g.computePass);
        wgpuComputePassEncoderRelease(g.computePass);
        g.computePass = nullptr;
    }
    g.computePipelineSet = false;
    if (g.renderPass) {
        if (g.activeRenderPassUsesSurface && drawOverlayInPass(g.renderPass)) {
            g.overlayRecordedForCurrentTexture = true;
        }
        wgpuRenderPassEncoderEnd(g.renderPass);
        wgpuRenderPassEncoderRelease(g.renderPass);
        g.renderPass = nullptr;
    }
    g.activeRenderPassUsesSurface = false;
    g.activeRenderPassSampleCount = 1;
    g.activeRenderPassDepthFormat = WGPUTextureFormat_Undefined;
    g.activeRenderPassWidth = 0;
    g.activeRenderPassHeight = 0;
    g.renderPipelineSet = false;
    g.skipRenderPass = false;
}

void releaseSlot(Slot& s) {
    if (s.encoder && s.encoder == g.currentEncoder) {
        endPasses();
        g.currentEncoder = nullptr;
        g.currentEncoderHandle = 0;
    }
    switch (s.kind) {
        case Kind::Buffer:
            if (s.buffer) wgpuBufferRelease(s.buffer);
            break;
        case Kind::Texture:
            if (s.texture) {
#if defined(THREEBROWSER_RAY_QUERY)
                rayQueryBridgeForgetImage(wgpuTextureGetNativeVulkanImage(s.texture));
#endif
#if defined(THREEBROWSER_STREAMLINE)
                streamlineForgetVulkanImage(wgpuTextureGetNativeVulkanImage(s.texture));
#endif
                wgpuTextureRelease(s.texture);
            }
            break;
        case Kind::TextureView:
            if (s.view) wgpuTextureViewRelease(s.view);
            break;
        case Kind::Sampler:
            if (s.sampler) wgpuSamplerRelease(s.sampler);
            break;
        case Kind::Shader:
            if (s.shader) wgpuShaderModuleRelease(s.shader);
            break;
        case Kind::BindGroupLayout:
            if (s.bgl) wgpuBindGroupLayoutRelease(s.bgl);
            break;
        case Kind::PipelineLayout:
            if (s.pl) wgpuPipelineLayoutRelease(s.pl);
            break;
        case Kind::ComputePipeline:
            if (s.cpipe) wgpuComputePipelineRelease(s.cpipe);
            break;
        case Kind::RenderPipeline:
            if (s.rpipe) wgpuRenderPipelineRelease(s.rpipe);
            break;
        case Kind::BindGroup:
            if (s.bg) wgpuBindGroupRelease(s.bg);
            break;
        case Kind::Encoder:
            if (s.encoder) wgpuCommandEncoderRelease(s.encoder);
            break;
        default:
            break;
    }
    s = Slot{};
}

void clearSlots() {
    endPasses();
    for (auto& kv : g.slots) {
        releaseSlot(kv.second);
    }
    g.slots.clear();
    g.currentEncoder = nullptr;
    g.currentEncoderHandle = 0;
}

Slot* getSlot(uint32_t id) {
    if (id == 0) {
        return nullptr;
    }
    auto it = g.slots.find(id);
    return it == g.slots.end() ? nullptr : &it->second;
}

void putSlot(uint32_t id, Slot slot) {
    if (id == 0) {
        setError("handle 0 is reserved");
        return;
    }
    auto it = g.slots.find(id);
    if (it != g.slots.end()) {
        releaseSlot(it->second);
        it->second = std::move(slot);
    } else {
        g.slots.emplace(id, std::move(slot));
    }
}

void applyAttachStyle(HWND child, HWND parent, int x, int y, int width, int height) {
    LONG_PTR style = GetWindowLongPtrW(child, GWL_STYLE);
    style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU |
               WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_BORDER | WS_DLGFRAME);
    style |= WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN;
    SetWindowLongPtrW(child, GWL_STYLE, style);
    LONG_PTR ex = GetWindowLongPtrW(child, GWL_EXSTYLE);
    ex &= ~(WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME |
            WS_EX_STATICEDGE | WS_EX_OVERLAPPEDWINDOW | WS_EX_APPWINDOW);
    ex |= WS_EX_NOACTIVATE | WS_EX_TRANSPARENT;
    SetWindowLongPtrW(child, GWL_EXSTYLE, ex);
    if (GetParent(child) != parent) {
        SetParent(child, parent);
    }
    SetWindowPos(child, HWND_BOTTOM, x, y, width, height,
                 SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED);
    POINT clientOrigin{0, 0};
    ClientToScreen(child, &clientOrigin);
    POINT parentOrigin{0, 0};
    ClientToScreen(parent, &parentOrigin);
    RECT clientRc{};
    GetClientRect(child, &clientRc);
    const int curX = clientOrigin.x - parentOrigin.x;
    const int curY = clientOrigin.y - parentOrigin.y;
    const int curW = clientRc.right;
    const int curH = clientRc.bottom;
    if (curX != x || curY != y || curW != width || curH != height) {
        RECT outer{};
        GetWindowRect(child, &outer);
        POINT outerPos{outer.left, outer.top};
        ScreenToClient(parent, &outerPos);
        SetWindowPos(child, HWND_BOTTOM,
                     outerPos.x + (x - curX),
                     outerPos.y + (y - curY),
                     (outer.right - outer.left) + (width - curW),
                     (outer.bottom - outer.top) + (height - curH),
                     SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
}

bool createHwnd(HWND parent, int x, int y, int w, int h) {
    HINSTANCE inst = GetModuleHandleW(nullptr);
    if (!g.classRegistered) {
        WNDCLASSEXW wc{};
        wc.cbSize = sizeof(wc);
        wc.style = CS_OWNDC | CS_DBLCLKS;
        wc.lpfnWndProc = wndProc;
        wc.hInstance = inst;
        wc.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
        wc.lpszClassName = kClassName;
        if (!RegisterClassExW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
            setError("RegisterClassEx failed");
            return false;
        }
        g.classRegistered = true;
    }
    // Always create on this worker thread with no parent. Creating WS_CHILD
    // of the UI form while the UI thread is blocked in tw_start() deadlocks
    // (WM_PARENTNOTIFY). Same pattern as GL: start unparented, attach later.
    const bool standalone = g.standaloneUi.load(std::memory_order_relaxed) != 0;
    DWORD style = standalone ? WS_OVERLAPPEDWINDOW : WS_POPUP;
    DWORD ex = standalone ? WS_EX_APPWINDOW : (WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT);
    RECT windowRect{0, 0, w, h};
    AdjustWindowRectEx(&windowRect, style, FALSE, ex);
    const int windowW = windowRect.right - windowRect.left;
    const int windowH = windowRect.bottom - windowRect.top;
    g.hwnd = CreateWindowExW(ex, kClassName, L"ThreeBrowser WebGPU", style,
                             CW_USEDEFAULT, CW_USEDEFAULT, windowW, windowH,
                             nullptr, nullptr, inst, nullptr);
    if (!g.hwnd) {
        setError("CreateWindowEx failed");
        return false;
    }
    ShowWindow(g.hwnd, SW_HIDE);
    g.parent = nullptr;
    g.nativeHwnd.store(g.hwnd);
    g.overlayWindow.store(g.hwnd, std::memory_order_release);
    g.open.store(1, std::memory_order_relaxed);
    RAWINPUTDEVICE mouse{};
    mouse.usUsagePage = 0x01;
    mouse.usUsage = 0x02;
    mouse.dwFlags = 0;
    mouse.hwndTarget = g.hwnd;
    if (!RegisterRawInputDevices(&mouse, 1, sizeof(mouse))) {
        logLine("RegisterRawInputDevices failed; pointer lock will use window mouse messages");
    }
    pumpHwnd();
    if (parent) {
        applyAttachStyle(g.hwnd, parent, x, y, w, h);
    }
    return true;
}

void setHwndClientSize(HWND hwnd, int width, int height) {
    if (!hwnd) return;
    const DWORD style = static_cast<DWORD>(GetWindowLongPtrW(hwnd, GWL_STYLE));
    const DWORD ex = static_cast<DWORD>(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
    RECT rect{0, 0, std::max(1, width), std::max(1, height)};
    AdjustWindowRectEx(&rect, style, FALSE, ex);
    SetWindowPos(hwnd, nullptr, 0, 0, rect.right - rect.left, rect.bottom - rect.top,
                 SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
}

bool configureSurface(int w, int h) {
    if (!g.surface || !g.device) {
        return false;
    }
    streamlineSuspendFrameGeneration(
        "Frame Generation suspended before swapchain configuration", false);
    w = std::max(1, w);
    h = std::max(1, h);
    dropCurrentTexture();
    g.config = WGPUSurfaceConfiguration{};
    g.config.device = g.device;
    g.config.format = g.surfaceFormat;
    g.config.usage = WGPUTextureUsage_RenderAttachment;
    g.config.width = static_cast<uint32_t>(w);
    g.config.height = static_cast<uint32_t>(h);
    g.config.alphaMode = g.alphaMode;
    g.config.presentMode = pickPresentMode(g.vsync.load(std::memory_order_relaxed) != 0);
    wgpuSurfaceConfigure(g.surface, &g.config);
    g.surfaceConfigured = true;
    return true;
}

void requestSurfaceResize(int w, int h) {
    g.pendingResizeW = std::max(1, w);
    g.pendingResizeH = std::max(1, h);
    g.resizeHoldFrames = 3;
}

void updateWindowSizeAfterDisplayChange() {
    if (!g.hwnd) return;
    RECT client{};
    GetClientRect(g.hwnd, &client);
    const int width = std::max(1L, client.right - client.left);
    const int height = std::max(1L, client.bottom - client.top);
    g.statsW.store(width, std::memory_order_relaxed);
    g.statsH.store(height, std::memory_order_relaxed);
    g.overlayDirty.store(1, std::memory_order_release);
    requestSurfaceResize(width, height);
}

bool selectExclusiveMode(const wchar_t* device, int width, int height, int refreshHz,
                         DEVMODEW& selected) {
    bool found = false;
    int bestRefreshDistance = INT_MAX;
    for (DWORD index = 0;; ++index) {
        DEVMODEW mode{};
        mode.dmSize = sizeof(mode);
        if (!EnumDisplaySettingsExW(device, index, &mode, 0)) break;
        if (static_cast<int>(mode.dmPelsWidth) != width ||
            static_cast<int>(mode.dmPelsHeight) != height || mode.dmBitsPerPel < 24) continue;
        const int modeRefresh = std::max(1, static_cast<int>(mode.dmDisplayFrequency));
        const int distance = refreshHz > 0 ? std::abs(modeRefresh - refreshHz) : -modeRefresh;
        if (!found || distance < bestRefreshDistance) {
            selected = mode;
            bestRefreshDistance = distance;
            found = true;
        }
    }
    if (!found) return false;
    selected.dmFields |= DM_PELSWIDTH | DM_PELSHEIGHT | DM_BITSPERPEL | DM_DISPLAYFREQUENCY;
    return true;
}

bool usesVulkanBackend() {
    return g.backendType == WGPUBackendType_Vulkan;
}

bool displayTransitionIsIdle() {
    if (!g.currentEncoder && !g.renderPass && !g.computePass &&
        !g.currentTex && !g.currentView) return true;
    setError("fullscreen transition requires a completed frame");
    return false;
}

bool setVulkanExclusiveRequest(bool enabled, HMONITOR monitor) {
    if (!usesVulkanBackend()) return true;
    if (!g.surface) {
        setError("no Vulkan surface for fullscreen transition");
        return false;
    }
    if (wgpuSurfaceSetVulkanExclusiveFullscreen(g.surface, enabled ? 1 : 0,
                                                enabled ? monitor : nullptr) !=
        WGPUStatus_Success) {
        setError(enabled ? "Vulkan exclusive fullscreen is unavailable"
                         : "failed to clear Vulkan exclusive fullscreen");
        return false;
    }
    return true;
}

void unconfigureSurfaceForDisplayTransition() {
    streamlineSuspendFrameGeneration(
        "Frame Generation suspended before a display-mode transition", false);
    dropCurrentTexture();
    if (g.surface && g.surfaceConfigured) {
        wgpuSurfaceUnconfigure(g.surface);
        g.surfaceConfigured = false;
    }
}

void restoreExclusiveFullscreenOnWindowThread(bool reconfigureSurface) {
    if (!g.fullscreenActive && !g.displayModeChanged && !g.windowedStateSaved) return;
    if (reconfigureSurface && usesVulkanBackend() && !displayTransitionIsIdle()) return;

    const bool reconfigureVulkan = usesVulkanBackend() && g.surface && g.device;
    bool windowedRequestReady = true;
    if (reconfigureVulkan) {
        unconfigureSurfaceForDisplayTransition();
        windowedRequestReady = setVulkanExclusiveRequest(false, nullptr);
    }
    if (g.displayModeChanged && !g.fullscreenDevice.empty()) {
        ChangeDisplaySettingsExW(g.fullscreenDevice.c_str(), nullptr, nullptr, 0, nullptr);
    }
    g.displayModeChanged = false;
    if (g.hwnd && g.windowedStateSaved) {
        SetWindowLongPtrW(g.hwnd, GWL_STYLE, g.windowedStyle);
        SetWindowLongPtrW(g.hwnd, GWL_EXSTYLE, g.windowedExStyle);
        SetWindowPlacement(g.hwnd, &g.windowedPlacement);
        SetWindowPos(g.hwnd, HWND_NOTOPMOST, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE |
                         SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    }
    g.fullscreenActive = false;
    g.windowedStateSaved = false;
    g.fullscreenDevice.clear();
    updateWindowSizeAfterDisplayChange();
    if (reconfigureSurface && reconfigureVulkan && windowedRequestReady) {
        configureSurface(g.statsW.load(std::memory_order_relaxed),
                         g.statsH.load(std::memory_order_relaxed));
    }
    tw_set_fullscreen_state(0, g.statsW.load(std::memory_order_relaxed),
                            g.statsH.load(std::memory_order_relaxed), 0);
}

bool applyExclusiveFullscreenOnWindowThread(int width, int height, int refreshHz) {
    if (!g.hwnd || !IsWindow(g.hwnd) || g.parent ||
        g.standaloneUi.load(std::memory_order_relaxed) == 0) return false;

    if (g.fullscreenState.load(std::memory_order_relaxed) == 1) {
        restoreExclusiveFullscreenOnWindowThread(true);
        if (g.fullscreenActive) return false;
    }

    const HMONITOR monitorHandle = MonitorFromWindow(g.hwnd, MONITOR_DEFAULTTONEAREST);
    MONITORINFOEXW monitor{};
    if (!monitorHandle || !displayInfoForWindow(g.hwnd, monitor)) return false;
    DEVMODEW mode{};
    if (!selectExclusiveMode(monitor.szDevice, width, height, refreshHz, mode)) return false;
    if (ChangeDisplaySettingsExW(monitor.szDevice, &mode, nullptr, CDS_TEST, nullptr) != DISP_CHANGE_SUCCESSFUL) {
        return false;
    }

    const bool wasFullscreen = g.fullscreenActive;
    const int previousWidth = std::max(1, g.statsW.load(std::memory_order_relaxed));
    const int previousHeight = std::max(1, g.statsH.load(std::memory_order_relaxed));
    if (!g.fullscreenActive) {
        g.windowedPlacement = {sizeof(WINDOWPLACEMENT)};
        if (!GetWindowPlacement(g.hwnd, &g.windowedPlacement)) return false;
        g.windowedStyle = GetWindowLongPtrW(g.hwnd, GWL_STYLE);
        g.windowedExStyle = GetWindowLongPtrW(g.hwnd, GWL_EXSTYLE);
        g.windowedStateSaved = true;
    }

    if (usesVulkanBackend()) {
        if (!displayTransitionIsIdle() ||
            !setVulkanExclusiveRequest(true, monitorHandle)) {
            if (!wasFullscreen) g.windowedStateSaved = false;
            return false;
        }
        unconfigureSurfaceForDisplayTransition();
    }

    bool releasedPreviousDisplay = false;
    if (g.fullscreenActive && g.displayModeChanged && !g.fullscreenDevice.empty() &&
        g.fullscreenDevice != monitor.szDevice) {
        ChangeDisplaySettingsExW(g.fullscreenDevice.c_str(), nullptr, nullptr, 0, nullptr);
        g.displayModeChanged = false;
        releasedPreviousDisplay = true;
    }

    if (ChangeDisplaySettingsExW(monitor.szDevice, &mode, nullptr, CDS_FULLSCREEN, nullptr) !=
        DISP_CHANGE_SUCCESSFUL) {
        if (usesVulkanBackend()) {
            if (wasFullscreen && !releasedPreviousDisplay) {
                configureSurface(previousWidth, previousHeight);
            } else {
                restoreExclusiveFullscreenOnWindowThread(true);
            }
        } else if (!wasFullscreen) {
            g.windowedStateSaved = false;
        }
        return false;
    }
    g.displayModeChanged = true;
    g.fullscreenDevice = monitor.szDevice;

    LONG_PTR style = g.windowedStyle;
    style &= ~(WS_OVERLAPPEDWINDOW | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU |
               WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_BORDER | WS_DLGFRAME);
    style |= WS_POPUP | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN;
    LONG_PTR exStyle = g.windowedExStyle;
    exStyle &= ~(WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME | WS_EX_STATICEDGE);
    exStyle |= WS_EX_APPWINDOW;
    SetWindowLongPtrW(g.hwnd, GWL_STYLE, style);
    SetWindowLongPtrW(g.hwnd, GWL_EXSTYLE, exStyle);

    DEVMODEW active{};
    active.dmSize = sizeof(active);
    EnumDisplaySettingsExW(monitor.szDevice, ENUM_CURRENT_SETTINGS, &active, 0);
    const int x = static_cast<int>(active.dmPosition.x);
    const int y = static_cast<int>(active.dmPosition.y);
    const int activeWidth = std::max(1, static_cast<int>(active.dmPelsWidth));
    const int activeHeight = std::max(1, static_cast<int>(active.dmPelsHeight));
    SetWindowPos(g.hwnd, HWND_TOPMOST, x, y, activeWidth, activeHeight,
                 SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    ShowWindow(g.hwnd, SW_SHOW);
    SetForegroundWindow(g.hwnd);
    SetFocus(g.hwnd);
    g.fullscreenActive = true;
    updateWindowSizeAfterDisplayChange();
    if (usesVulkanBackend() && !configureSurface(activeWidth, activeHeight)) {
        restoreExclusiveFullscreenOnWindowThread(true);
        return false;
    }
    tw_set_fullscreen_state(2, activeWidth, activeHeight,
                            std::max(1, static_cast<int>(active.dmDisplayFrequency)));
    return true;
}

bool applyBorderlessFullscreenOnWindowThread(int width, int height, int refreshHz) {
    (void) width;
    (void) height;
    (void) refreshHz;
    if (!g.hwnd || !IsWindow(g.hwnd) || g.parent ||
        g.standaloneUi.load(std::memory_order_relaxed) == 0 ||
        !displayTransitionIsIdle()) return false;

    if (g.fullscreenActive) {
        restoreExclusiveFullscreenOnWindowThread(true);
        if (g.fullscreenActive) return false;
    }

    const HMONITOR monitorHandle = MonitorFromWindow(g.hwnd, MONITOR_DEFAULTTONEAREST);
    MONITORINFOEXW monitor{};
    monitor.cbSize = sizeof(monitor);
    if (!monitorHandle || !GetMonitorInfoW(monitorHandle, &monitor)) return false;

    g.windowedPlacement = {sizeof(WINDOWPLACEMENT)};
    if (!GetWindowPlacement(g.hwnd, &g.windowedPlacement)) return false;
    g.windowedStyle = GetWindowLongPtrW(g.hwnd, GWL_STYLE);
    g.windowedExStyle = GetWindowLongPtrW(g.hwnd, GWL_EXSTYLE);
    g.windowedStateSaved = true;

    const bool reconfigureVulkan = usesVulkanBackend() && g.surface && g.device;
    if (reconfigureVulkan) unconfigureSurfaceForDisplayTransition();

    LONG_PTR style = g.windowedStyle;
    style &= ~(WS_OVERLAPPEDWINDOW | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU |
               WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_BORDER | WS_DLGFRAME);
    style |= WS_POPUP | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN;
    LONG_PTR exStyle = g.windowedExStyle;
    exStyle &= ~(WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME | WS_EX_STATICEDGE);
    exStyle |= WS_EX_APPWINDOW;
    SetWindowLongPtrW(g.hwnd, GWL_STYLE, style);
    SetWindowLongPtrW(g.hwnd, GWL_EXSTYLE, exStyle);

    const RECT bounds = monitor.rcMonitor;
    const int activeWidth = std::max(1L, bounds.right - bounds.left);
    const int activeHeight = std::max(1L, bounds.bottom - bounds.top);
    SetWindowPos(g.hwnd, HWND_TOPMOST, bounds.left, bounds.top, activeWidth, activeHeight,
                 SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    ShowWindow(g.hwnd, SW_SHOW);
    SetForegroundWindow(g.hwnd);
    SetFocus(g.hwnd);
    g.fullscreenActive = true;
    updateWindowSizeAfterDisplayChange();
    if (reconfigureVulkan && !configureSurface(activeWidth, activeHeight)) {
        restoreExclusiveFullscreenOnWindowThread(true);
        return false;
    }
    tw_set_fullscreen_state(1, activeWidth, activeHeight, 0);
    return true;
}

void tryApplyPendingDisplayTransition() {
    if (!g.pendingDisplayTransition || !displayTransitionIsIdle()) return;
    const int mode = std::clamp(g.pendingDisplayMode, 0, 2);
    const DisplayMode details = g.pendingDisplayModeDetails;
    bool applied = false;
    if (mode == 0) {
        restoreExclusiveFullscreenOnWindowThread(true);
        applied = !g.fullscreenActive;
    } else if (mode == 1) {
        applied = applyBorderlessFullscreenOnWindowThread(details.width, details.height,
                                                           details.refreshHz);
    } else {
        applied = applyExclusiveFullscreenOnWindowThread(std::max(1, details.width),
                                                          std::max(1, details.height),
                                                          std::max(1, details.refreshHz));
    }
    if (applied) {
        g.pendingDisplayTransition = false;
        setError("");
    }
}

bool createSurface() {
    if (!g.instance || !g.hwnd) {
        setError("no instance/hwnd for surface");
        return false;
    }
    WGPUSurfaceSourceWindowsHWND src{};
    src.chain.sType = WGPUSType_SurfaceSourceWindowsHWND;
    src.hinstance = GetModuleHandleW(nullptr);
    src.hwnd = g.hwnd;
    WGPUSurfaceDescriptor desc{};
    desc.nextInChain = &src.chain;
    desc.label = twSv("three_webgpu");
    g.surface = wgpuInstanceCreateSurface(g.instance, &desc);
    if (!g.surface) {
        setError("wgpuInstanceCreateSurface failed");
        return false;
    }
    return true;
}

bool createInstance(WGPUInstanceBackend backends) {
    WGPUInstanceExtras extras{};
    extras.chain.sType = static_cast<WGPUSType>(WGPUSType_InstanceExtras);
    extras.backends = backends;
    extras.flags = WGPUInstanceFlag_Empty;
    // Keep DX12 presentation attached directly to our HWND.  Besides being
    // the path understood by graphics tooling and Windows game capture, this
    // avoids the DirectComposition visual swapchain used for transparent UI.
    // wgpu-native ignores this setting for Vulkan instances.
    extras.dx12PresentationSystem = WGPUDx12SwapchainKind_DxgiFromHwnd;
    WGPUInstanceDescriptor desc{};
    desc.nextInChain = &extras.chain;
    g.instance = wgpuCreateInstance(&desc);
    return g.instance != nullptr;
}

bool requestAdapterAndDevice() {
    WGPUAdapter adapter = nullptr;
    auto onAdapter = [](WGPURequestAdapterStatus status, WGPUAdapter a, WGPUStringView message,
                        void* ud1, void*) {
        if (status == WGPURequestAdapterStatus_Success) {
            *static_cast<WGPUAdapter*>(ud1) = a;
        } else if (message.data && message.length) {
            const size_t n = message.length == WGPU_STRLEN ? std::strlen(message.data) : message.length;
            std::string s("requestAdapter: ");
            s.append(message.data, n);
            setError(s.c_str());
        }
    };
    WGPURequestAdapterOptions opts{};
    opts.compatibleSurface = g.surface;
    opts.powerPreference = WGPUPowerPreference_HighPerformance;
    WGPURequestAdapterCallbackInfo acb{};
    acb.mode = WGPUCallbackMode_AllowSpontaneous;
    acb.callback = onAdapter;
    acb.userdata1 = &adapter;
    WGPUFuture af = wgpuInstanceRequestAdapter(g.instance, &opts, acb);
    if (!adapter) {
        waitFuture(af);
    }
    if (!adapter) {
        setError("no WebGPU adapter");
        return false;
    }
    g.adapter = adapter;

    WGPUAdapterInfo info{};
    if (wgpuAdapterGetInfo(g.adapter, &info) == WGPUStatus_Success) {
        g.backendType = info.backendType;
        g.gpuVendorId = info.vendorID;
        g.gpuDeviceId = info.deviceID;
        g.gpuDeviceName = fromWgpuString(info.device);
        std::string adapterNameLower = g.gpuDeviceName;
        std::transform(adapterNameLower.begin(), adapterNameLower.end(), adapterNameLower.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        g.rtxAdapter = info.vendorID == 0x10de && adapterNameLower.find("rtx") != std::string::npos;
        switch (info.backendType) {
            case WGPUBackendType_Vulkan:
                g.backendName = "Vulkan";
                break;
            case WGPUBackendType_D3D12:
                g.backendName = "D3D12";
                break;
            case WGPUBackendType_D3D11:
                g.backendName = "D3D11";
                break;
            default:
                g.backendName = "WebGPU";
                break;
        }
        wgpuAdapterInfoFreeMembers(info);
    }

    WGPUDevice device = nullptr;
    auto onDevice = [](WGPURequestDeviceStatus status, WGPUDevice d, WGPUStringView message,
                       void* ud1, void*) {
        if (status == WGPURequestDeviceStatus_Success) {
            *static_cast<WGPUDevice*>(ud1) = d;
        } else if (message.data && message.length) {
            const size_t n = message.length == WGPU_STRLEN ? std::strlen(message.data) : message.length;
            std::string s("requestDevice: ");
            s.append(message.data, n);
            setError(s.c_str());
        }
    };
    WGPUDeviceDescriptor dd{};
    dd.label = twSv("three_webgpu");
    WGPUSupportedFeatures supported{};
    wgpuAdapterGetFeatures(g.adapter, &supported);
    const std::array<WGPUFeatureName, 10> desiredFeatures{
        WGPUFeatureName_DepthClipControl,
        WGPUFeatureName_Depth32FloatStencil8,
        WGPUFeatureName_TextureCompressionBC,
        WGPUFeatureName_IndirectFirstInstance,
        WGPUFeatureName_RG11B10UfloatRenderable,
        WGPUFeatureName_BGRA8UnormStorage,
        WGPUFeatureName_Float32Filterable,
        WGPUFeatureName_Float32Blendable,
        WGPUFeatureName_ClipDistances,
        WGPUFeatureName_DualSourceBlending,
    };
    std::vector<WGPUFeatureName> enabledFeatures;
    for (const auto desired : desiredFeatures) {
        if (std::find(supported.features, supported.features + supported.featureCount, desired) !=
            supported.features + supported.featureCount) {
            enabledFeatures.push_back(desired);
        }
    }
#if defined(THREEBROWSER_RAY_QUERY)
    g.rayQueryFeatureEnabled = false;
    const auto nativeRayQueryFeature =
        static_cast<WGPUFeatureName>(WGPUNativeFeature_RayQuery);
    if (std::find(supported.features, supported.features + supported.featureCount,
                  nativeRayQueryFeature) != supported.features + supported.featureCount) {
        enabledFeatures.push_back(nativeRayQueryFeature);
        g.rayQueryFeatureEnabled = true;
    }
#endif
    wgpuSupportedFeaturesFreeMembers(supported);
    dd.requiredFeatureCount = enabledFeatures.size();
    dd.requiredFeatures = enabledFeatures.data();
    WGPULimits adapterLimits = WGPU_LIMITS_INIT;
    if (wgpuAdapterGetLimits(g.adapter, &adapterLimits) == WGPUStatus_Success) {
        // Request the limits that the JavaScript-facing device advertises.
        // Otherwise wgpu-native creates a device at conservative WebGPU
        // defaults (notably 64 KiB buffer bindings) even when the adapter can
        // support substantially larger render and compute workloads.
        dd.requiredLimits = &adapterLimits;
    }
    dd.deviceLostCallbackInfo.mode = WGPUCallbackMode_AllowSpontaneous;
    dd.deviceLostCallbackInfo.callback = onDeviceLost;
    dd.uncapturedErrorCallbackInfo.callback = onUncaptured;
    WGPURequestDeviceCallbackInfo dcb{};
    dcb.mode = WGPUCallbackMode_AllowSpontaneous;
    dcb.callback = onDevice;
    dcb.userdata1 = &device;
    WGPUFuture df = wgpuAdapterRequestDevice(g.adapter, &dd, dcb);
    if (!device) {
        waitFuture(df);
    }
    if (!device) {
        setError("no WebGPU device");
        return false;
    }
    g.device = device;
    WGPULimits deviceLimits = WGPU_LIMITS_INIT;
    if (wgpuDeviceGetLimits(g.device, &deviceLimits) == WGPUStatus_Success) {
        char limitsMessage[192];
        std::snprintf(limitsMessage, sizeof(limitsMessage),
                      "device limits uniform=%llu storage=%llu buffer=%llu",
                      static_cast<unsigned long long>(deviceLimits.maxUniformBufferBindingSize),
                      static_cast<unsigned long long>(deviceLimits.maxStorageBufferBindingSize),
                      static_cast<unsigned long long>(deviceLimits.maxBufferSize));
        logLine(limitsMessage);
    }
    g.queue = wgpuDeviceGetQueue(g.device);
    if (!g.queue) {
        setError("no WebGPU queue");
        return false;
    }
    if (g.backendType == WGPUBackendType_Vulkan) {
        WGPUVulkanContextInfo nativeContext{};
        const WGPUStatus nativeStatus = wgpuDeviceGetNativeVulkanContext(g.device, &nativeContext);
        if (nativeStatus == WGPUStatus_Success) {
#if defined(THREEBROWSER_RAY_QUERY)
            rayQueryBridgeAttachVulkan(RayQueryVulkanContext{
                nativeContext.instance,
                nativeContext.physicalDevice,
                nativeContext.device,
                nativeContext.queue,
                nativeContext.queueFamilyIndex,
                nativeContext.queueIndex,
                g.rayQueryFeatureEnabled,
            });
#endif
#if defined(THREEBROWSER_STREAMLINE)
            if (streamlineAttachVulkan(StreamlineVulkanContext{
                nativeContext.instance,
                nativeContext.physicalDevice,
                nativeContext.device,
                nativeContext.queue,
                nativeContext.queueFamilyIndex,
                nativeContext.queueIndex,
            })) {
                streamlineFrameBegin(0);
                g.streamlineSimulationEnded = false;
            }
#endif
        } else {
            logLine("wgpu-native did not expose its Vulkan device context");
        }
    }

    WGPUSurfaceCapabilities caps{};
    wgpuSurfaceGetCapabilities(g.surface, g.adapter, &caps);
    if (caps.formatCount > 0 && caps.formats) {
        g.surfaceFormat = caps.formats[0];
        // three.js getPreferredCanvasFormat() is bgra8unorm (not sRGB).
        bool foundUnorm = false;
        for (size_t i = 0; i < caps.formatCount; ++i) {
            if (caps.formats[i] == WGPUTextureFormat_BGRA8Unorm) {
                g.surfaceFormat = caps.formats[i];
                foundUnorm = true;
                break;
            }
        }
        if (!foundUnorm) {
            for (size_t i = 0; i < caps.formatCount; ++i) {
                if (caps.formats[i] == WGPUTextureFormat_BGRA8UnormSrgb) {
                    g.surfaceFormat = caps.formats[i];
                    break;
                }
            }
        }
    }
    if (caps.alphaModeCount > 0 && caps.alphaModes) {
        g.alphaMode = caps.alphaModes[0];
    }
    g.presentModes.clear();
    for (size_t i = 0; i < caps.presentModeCount; ++i) {
        g.presentModes.push_back(caps.presentModes[i]);
    }
    wgpuSurfaceCapabilitiesFreeMembers(caps);
    return true;
}

struct OverlayLayout {
    int margin{};
    bool wide{};
    int maxScroll{};
    RECT performance{};
    RECT settings{};
    RECT input{};
    RECT bodyClip{};
    RECT scrollTrack{};
    RECT scrollThumb{};
    RECT resolutionButton{};
    RECT windowedButton{};
    RECT borderlessButton{};
    RECT fullscreenButton{};
    RECT fpsButton{};
    RECT debugButton{};
    RECT dlssStatus{};
    RECT dlssSuperResolutionButton{};
    RECT dlssFrameGenerationButton{};
    RECT dlssRayReconstructionButton{};
    RECT reflexButton{};
};

OverlayLayout overlayLayout(int width, int height) {
    OverlayLayout layout{};
    const int panelWidth = std::min(680, std::max(340, width - 40));
    const int panelHeight = std::min(680, std::max(360, height - 40));
    const int left = std::max(20, (width - panelWidth) / 2);
    const int top = std::max(20, (height - panelHeight) / 2);
    layout.margin = left;
    layout.wide = true;
    layout.performance = RECT{left, top, left + panelWidth, top + panelHeight};
    layout.settings = layout.performance;
    layout.input = layout.performance;
    layout.bodyClip = RECT{left + 1, top + 96, left + panelWidth - 12, top + panelHeight - 20};
    constexpr int contentHeight = 664;
    const int bodyHeight = std::max(1L, layout.bodyClip.bottom - layout.bodyClip.top);
    layout.maxScroll = std::max(0, contentHeight - bodyHeight);
    const int scroll = std::clamp(g.overlayScrollPx.load(std::memory_order_relaxed), 0,
                                  layout.maxScroll);
    const int contentTop = layout.bodyClip.top + 18 - scroll;
    layout.resolutionButton = RECT{left + 24, contentTop + 25, left + panelWidth - 24, contentTop + 73};
    const int columnGap = 8;
    const int columnWidth = (panelWidth - 48 - columnGap * 2) / 3;
    layout.windowedButton = RECT{left + 24, contentTop + 83, left + 24 + columnWidth, contentTop + 129};
    layout.borderlessButton = RECT{layout.windowedButton.right + columnGap, contentTop + 83,
                                   layout.windowedButton.right + columnGap + columnWidth, contentTop + 129};
    layout.fullscreenButton = RECT{layout.borderlessButton.right + columnGap, contentTop + 83,
                                   left + panelWidth - 24, contentTop + 129};
    layout.fpsButton = RECT{left + 24, contentTop + 182, left + 24 + columnWidth, contentTop + 228};
    layout.debugButton = RECT{layout.fpsButton.right + columnGap, contentTop + 182,
                              left + panelWidth - 24, contentTop + 228};
    layout.dlssStatus = RECT{left + 24, contentTop + 288, left + panelWidth - 24, contentTop + 354};
    layout.dlssSuperResolutionButton = RECT{left + 24, contentTop + 366,
                                            left + panelWidth - 24, contentTop + 420};
    layout.dlssFrameGenerationButton = RECT{left + 24, contentTop + 430,
                                            left + panelWidth - 24, contentTop + 484};
    layout.dlssRayReconstructionButton = RECT{left + 24, contentTop + 494,
                                              left + panelWidth - 24, contentTop + 548};
    layout.reflexButton = RECT{left + 24, contentTop + 558,
                               left + panelWidth - 24, contentTop + 612};
    layout.scrollTrack = RECT{left + panelWidth - 8, layout.bodyClip.top + 6,
                              left + panelWidth - 4, layout.bodyClip.bottom - 6};
    const int trackHeight = std::max(1L, layout.scrollTrack.bottom - layout.scrollTrack.top);
    const int thumbHeight = layout.maxScroll == 0
        ? trackHeight
        : std::max(34, trackHeight * bodyHeight / contentHeight);
    const int thumbTravel = std::max(0, trackHeight - thumbHeight);
    const int thumbTop = layout.scrollTrack.top +
        (layout.maxScroll > 0 ? thumbTravel * scroll / layout.maxScroll : 0);
    layout.scrollThumb = RECT{layout.scrollTrack.left, thumbTop,
                              layout.scrollTrack.right, thumbTop + thumbHeight};
    return layout;
}

RECT overlayRasterRect(int width, int height) {
    width = std::max(1, width);
    height = std::max(1, height);
    if (g.loading.load(std::memory_order_relaxed) != 0) {
        return RECT{0, 0, width, height};
    }
    if (g.overlayOpen.load(std::memory_order_relaxed) != 0) {
        return overlayLayout(width, height).performance;
    }
    if (g.fpsOverlay.load(std::memory_order_relaxed) != 0) {
        const int badgeWidth = std::min(188, width);
        const int badgeHeight = std::min(44, height);
        const int left = std::max(0, width - badgeWidth - 14);
        const int top = std::min(14, std::max(0, height - badgeHeight));
        return RECT{left, top, left + badgeWidth, top + badgeHeight};
    }
    return RECT{};
}

constexpr int kDropdownVisibleRows = 6;
constexpr int kDropdownOptionHeight = 32;

int dropdownMaxOffset(int itemCount) {
    return std::max(0, itemCount - kDropdownVisibleRows);
}

void dropdownClamp(OverlayDropdown& dropdown, int itemCount) {
    dropdown.scrollOffset = std::clamp(dropdown.scrollOffset, 0, dropdownMaxOffset(itemCount));
    if (dropdown.hoverIndex >= itemCount) dropdown.hoverIndex = -1;
}

void dropdownReveal(OverlayDropdown& dropdown, int selectedIndex, int itemCount) {
    dropdownClamp(dropdown, itemCount);
    if (selectedIndex < dropdown.scrollOffset) dropdown.scrollOffset = selectedIndex;
    if (selectedIndex >= dropdown.scrollOffset + kDropdownVisibleRows) {
        dropdown.scrollOffset = selectedIndex - kDropdownVisibleRows + 1;
    }
    dropdownClamp(dropdown, itemCount);
}

RECT dropdownOptionRect(const RECT& button, int visibleRow) {
    return RECT{button.left,
                button.bottom + 2 + visibleRow * kDropdownOptionHeight,
                button.right,
                button.bottom + 2 + (visibleRow + 1) * kDropdownOptionHeight};
}

int dropdownHitIndex(const OverlayDropdown& dropdown, const RECT& button, int itemCount, POINT point) {
    const int visibleCount = std::min(kDropdownVisibleRows,
                                      std::max(0, itemCount - dropdown.scrollOffset));
    for (int row = 0; row < visibleCount; ++row) {
        RECT option = dropdownOptionRect(button, row);
        if (PtInRect(&option, point)) return dropdown.scrollOffset + row;
    }
    return -1;
}

void releaseOverlayGpu() {
    if (g.overlayBindGroup) { wgpuBindGroupRelease(g.overlayBindGroup); g.overlayBindGroup = nullptr; }
    if (g.overlayPipeline) { wgpuRenderPipelineRelease(g.overlayPipeline); g.overlayPipeline = nullptr; }
    if (g.overlayShader) { wgpuShaderModuleRelease(g.overlayShader); g.overlayShader = nullptr; }
    if (g.overlaySampler) { wgpuSamplerRelease(g.overlaySampler); g.overlaySampler = nullptr; }
    if (g.overlayView) { wgpuTextureViewRelease(g.overlayView); g.overlayView = nullptr; }
    if (g.overlayTexture) { wgpuTextureRelease(g.overlayTexture); g.overlayTexture = nullptr; }
    g.overlayWidth = 0;
    g.overlayHeight = 0;
    g.overlaySampleCount = 1;
    g.overlayDepthFormat = WGPUTextureFormat_Undefined;
    g.overlayPixels.clear();
}

bool createOverlayGpu(int width, int height, uint32_t sampleCount,
                      WGPUTextureFormat depthFormat) {
    releaseOverlayGpu();
    if (!g.device || width < 1 || height < 1) return false;

    WGPUTextureDescriptor textureDesc{};
    textureDesc.label = twSv("ThreeBrowser overlay texture");
    textureDesc.dimension = WGPUTextureDimension_2D;
    textureDesc.size = WGPUExtent3D{static_cast<uint32_t>(width), static_cast<uint32_t>(height), 1};
    textureDesc.format = WGPUTextureFormat_BGRA8Unorm;
    textureDesc.mipLevelCount = 1;
    textureDesc.sampleCount = 1;
    textureDesc.usage = WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst;
    g.overlayTexture = wgpuDeviceCreateTexture(g.device, &textureDesc);
    if (!g.overlayTexture) return false;
    g.overlayView = wgpuTextureCreateView(g.overlayTexture, nullptr);

    WGPUSamplerDescriptor samplerDesc{};
    samplerDesc.addressModeU = WGPUAddressMode_ClampToEdge;
    samplerDesc.addressModeV = WGPUAddressMode_ClampToEdge;
    samplerDesc.addressModeW = WGPUAddressMode_ClampToEdge;
    samplerDesc.magFilter = WGPUFilterMode_Linear;
    samplerDesc.minFilter = WGPUFilterMode_Linear;
    samplerDesc.mipmapFilter = WGPUMipmapFilterMode_Nearest;
    samplerDesc.maxAnisotropy = 1;
    g.overlaySampler = wgpuDeviceCreateSampler(g.device, &samplerDesc);

    static constexpr char shaderSource[] = R"WGSL(
@group(0) @binding(0) var overlayTexture: texture_2d<f32>;
@group(0) @binding(1) var overlaySampler: sampler;
struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> VertexOutput {
  var positions = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  var uvs = array<vec2<f32>, 3>(vec2(0.0, 1.0), vec2(2.0, 1.0), vec2(0.0, -1.0));
  var output: VertexOutput;
  output.position = vec4(positions[index], 0.0, 1.0);
  output.uv = uvs[index];
  return output;
}
@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  return textureSample(overlayTexture, overlaySampler, input.uv);
}
)WGSL";
    WGPUShaderSourceWGSL wgsl{};
    wgsl.chain.sType = WGPUSType_ShaderSourceWGSL;
    wgsl.code = twSv(shaderSource);
    WGPUShaderModuleDescriptor shaderDesc{};
    shaderDesc.nextInChain = &wgsl.chain;
    shaderDesc.label = twSv("ThreeBrowser overlay shader");
    g.overlayShader = wgpuDeviceCreateShaderModule(g.device, &shaderDesc);

    WGPUBlendState blend{};
    blend.color.srcFactor = WGPUBlendFactor_SrcAlpha;
    blend.color.dstFactor = WGPUBlendFactor_OneMinusSrcAlpha;
    blend.color.operation = WGPUBlendOperation_Add;
    blend.alpha.srcFactor = WGPUBlendFactor_One;
    blend.alpha.dstFactor = WGPUBlendFactor_OneMinusSrcAlpha;
    blend.alpha.operation = WGPUBlendOperation_Add;
    WGPUColorTargetState target{};
    target.format = g.surfaceFormat;
    target.blend = &blend;
    target.writeMask = WGPUColorWriteMask_All;
    WGPUFragmentState fragment{};
    fragment.module = g.overlayShader;
    fragment.entryPoint = twSv("fs_main");
    fragment.targetCount = 1;
    fragment.targets = &target;
    WGPURenderPipelineDescriptor pipelineDesc{};
    pipelineDesc.label = twSv("ThreeBrowser overlay pipeline");
    pipelineDesc.vertex.module = g.overlayShader;
    pipelineDesc.vertex.entryPoint = twSv("vs_main");
    pipelineDesc.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    pipelineDesc.primitive.frontFace = WGPUFrontFace_CCW;
    pipelineDesc.primitive.cullMode = WGPUCullMode_None;
    pipelineDesc.multisample.count = std::max(1u, sampleCount);
    pipelineDesc.multisample.mask = 0xffffffffu;
    pipelineDesc.fragment = &fragment;
    WGPUDepthStencilState depthStencil{};
    if (depthFormat != WGPUTextureFormat_Undefined) {
        depthStencil.format = depthFormat;
        depthStencil.depthWriteEnabled = WGPUOptionalBool_False;
        depthStencil.depthCompare = WGPUCompareFunction_Always;
        depthStencil.stencilFront.compare = WGPUCompareFunction_Always;
        depthStencil.stencilFront.failOp = WGPUStencilOperation_Keep;
        depthStencil.stencilFront.depthFailOp = WGPUStencilOperation_Keep;
        depthStencil.stencilFront.passOp = WGPUStencilOperation_Keep;
        depthStencil.stencilBack = depthStencil.stencilFront;
        depthStencil.stencilReadMask = 0;
        depthStencil.stencilWriteMask = 0;
        pipelineDesc.depthStencil = &depthStencil;
    }
    g.overlayPipeline = wgpuDeviceCreateRenderPipeline(g.device, &pipelineDesc);
    if (!g.overlayView || !g.overlaySampler || !g.overlayShader || !g.overlayPipeline) {
        releaseOverlayGpu();
        return false;
    }

    WGPUBindGroupLayout layout = wgpuRenderPipelineGetBindGroupLayout(g.overlayPipeline, 0);
    WGPUBindGroupEntry entries[2]{};
    entries[0].binding = 0;
    entries[0].textureView = g.overlayView;
    entries[1].binding = 1;
    entries[1].sampler = g.overlaySampler;
    WGPUBindGroupDescriptor bindDesc{};
    bindDesc.label = twSv("ThreeBrowser overlay bind group");
    bindDesc.layout = layout;
    bindDesc.entryCount = 2;
    bindDesc.entries = entries;
    g.overlayBindGroup = wgpuDeviceCreateBindGroup(g.device, &bindDesc);
    wgpuBindGroupLayoutRelease(layout);
    g.overlayWidth = width;
    g.overlayHeight = height;
    g.overlaySampleCount = std::max(1u, sampleCount);
    g.overlayDepthFormat = depthFormat;
    g.overlayDirty.store(1, std::memory_order_relaxed);
    return g.overlayBindGroup != nullptr;
}

void buildOverlayPixels(int width, int height, bool compactFps = false,
                        int cropLeft = 0, int cropTop = 0,
                        int cropWidth = 0, int cropHeight = 0) {
    const bool loading = g.loading.load(std::memory_order_relaxed) != 0;
    const bool menu = !loading && g.overlayOpen.load(std::memory_order_relaxed) != 0;
    const bool fpsOnly = !loading && !menu && g.fpsOverlay.load(std::memory_order_relaxed) != 0;
    cropWidth = cropWidth > 0 ? cropWidth : width;
    cropHeight = cropHeight > 0 ? cropHeight : height;
    // GDI's rounded primitives are not antialiased. Draw interactive overlays
    // at 2x and filter once into the GPU texture so pills, switches, and text
    // retain smooth edges without making the full-time renderer multisampled.
    const int renderScale = (menu || fpsOnly) ? 2 : 1;
    const int renderWidth = cropWidth * renderScale;
    const int renderHeight = cropHeight * renderScale;
    const int rowBytes = cropWidth * 4;
    const int renderRowBytes = renderWidth * 4;
    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = renderWidth;
    info.bmiHeader.biHeight = -renderHeight;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    void* bits = nullptr;
    HDC dc = CreateCompatibleDC(nullptr);
    HBITMAP bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &bits, nullptr, 0);
    HGDIOBJ oldBitmap = SelectObject(dc, bitmap);
    std::memset(bits, 0, static_cast<size_t>(renderRowBytes) * renderHeight);
    if (renderScale > 1) {
        SetMapMode(dc, MM_ANISOTROPIC);
        SetWindowExtEx(dc, cropWidth, cropHeight, nullptr);
        SetViewportExtEx(dc, renderWidth, renderHeight, nullptr);
    }
    SetBkMode(dc, TRANSPARENT);

    HFONT heading = CreateFontW(-27, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
    HFONT title = CreateFontW(-18, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                              OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
    HFONT body = CreateFontW(-15, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                             OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
    HFONT label = CreateFontW(-12, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                              OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
    HGDIOBJ oldFont = SelectObject(dc, body);

    auto fillRect = [&](RECT rect, COLORREF color) {
        HBRUSH brush = CreateSolidBrush(color);
        FillRect(dc, &rect, brush);
        DeleteObject(brush);
    };
    auto rounded = [&](RECT rect, COLORREF fill, COLORREF border, int radius = 14) {
        HBRUSH brush = CreateSolidBrush(fill);
        HPEN pen = CreatePen(PS_SOLID, 1, border);
        HGDIOBJ previousBrush = SelectObject(dc, brush);
        HGDIOBJ previousPen = SelectObject(dc, pen);
        RoundRect(dc, rect.left, rect.top, rect.right, rect.bottom, radius, radius);
        SelectObject(dc, previousBrush);
        SelectObject(dc, previousPen);
        DeleteObject(brush);
        DeleteObject(pen);
    };
    auto line = [&](int x1, int y1, int x2, int y2, COLORREF color) {
        HPEN pen = CreatePen(PS_SOLID, 1, color);
        HGDIOBJ previous = SelectObject(dc, pen);
        MoveToEx(dc, x1, y1, nullptr);
        LineTo(dc, x2, y2);
        SelectObject(dc, previous);
        DeleteObject(pen);
    };
    auto drawText = [&](const wchar_t* text, RECT rect, HFONT font, COLORREF color, UINT format) {
        SelectObject(dc, font);
        SetTextColor(dc, color);
        DrawTextW(dc, text, -1, &rect, format);
    };
    auto drawLogo = [&](int x, int y, int size) {
        RECT box{x, y, x + size, y + size};
        rounded(box, RGB(238, 245, 255), RGB(185, 210, 248), 11);
        HPEN pen = CreatePen(PS_SOLID, 2, RGB(20, 105, 220));
        HGDIOBJ previousPen = SelectObject(dc, pen);
        HBRUSH hollow = static_cast<HBRUSH>(GetStockObject(HOLLOW_BRUSH));
        HGDIOBJ previousBrush = SelectObject(dc, hollow);
        POINT triangle[3]{{x + size * 38 / 100, y + size * 27 / 100},
                          {x + size * 72 / 100, y + size / 2},
                          {x + size * 38 / 100, y + size * 73 / 100}};
        Polygon(dc, triangle, 3);
        SelectObject(dc, previousBrush);
        SelectObject(dc, previousPen);
        DeleteObject(pen);
    };

    if (loading) {
        RECT full{0, 0, width, height};
        fillRect(full, RGB(246, 247, 249));
        const int centerX = width / 2;
        const int centerY = height / 2 - 14;
        const double loadingSeconds = std::chrono::duration<double>(
            std::chrono::steady_clock::now().time_since_epoch()).count();
        constexpr int spinnerSize = 52;
        constexpr int spinnerScale = 4;
        constexpr int sourceSize = spinnerSize * spinnerScale;
        BITMAPINFO spinnerInfo{};
        spinnerInfo.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        spinnerInfo.bmiHeader.biWidth = sourceSize;
        spinnerInfo.bmiHeader.biHeight = -sourceSize;
        spinnerInfo.bmiHeader.biPlanes = 1;
        spinnerInfo.bmiHeader.biBitCount = 32;
        spinnerInfo.bmiHeader.biCompression = BI_RGB;
        void* spinnerBits = nullptr;
        HDC spinnerDc = CreateCompatibleDC(dc);
        HBITMAP spinnerBitmap = CreateDIBSection(spinnerDc, &spinnerInfo, DIB_RGB_COLORS,
                                                 &spinnerBits, nullptr, 0);
        HGDIOBJ oldSpinnerBitmap = SelectObject(spinnerDc, spinnerBitmap);
        RECT spinnerBackground{0, 0, sourceSize, sourceSize};
        HBRUSH backgroundBrush = CreateSolidBrush(RGB(246, 247, 249));
        FillRect(spinnerDc, &spinnerBackground, backgroundBrush);
        DeleteObject(backgroundBrush);
        const int ringInset = 7 * spinnerScale;
        HPEN ringPen = CreatePen(PS_SOLID, 3 * spinnerScale, RGB(218, 226, 237));
        HGDIOBJ previousPen = SelectObject(spinnerDc, ringPen);
        HGDIOBJ previousBrush = SelectObject(spinnerDc, GetStockObject(HOLLOW_BRUSH));
        Ellipse(spinnerDc, ringInset, ringInset, sourceSize - ringInset, sourceSize - ringInset);
        SelectObject(spinnerDc, previousBrush);
        SelectObject(spinnerDc, previousPen);
        DeleteObject(ringPen);

        constexpr double pi = 3.14159265358979323846;
        // Time-based rather than work-based: heavy upload queues must not make
        // the visual race. One revolution every 2.4 seconds feels deliberate.
        const double headDegrees = std::fmod(loadingSeconds * 150.0, 360.0) - 90.0;
        constexpr int arcSegments = 64;
        constexpr double arcDegrees = 104.0;
        const double radius = (spinnerSize / 2.0 - 7.0) * spinnerScale;
        std::vector<POINT> arc;
        arc.reserve(arcSegments + 1);
        for (int i = 0; i <= arcSegments; ++i) {
            const double degrees = headDegrees - arcDegrees + arcDegrees * i / arcSegments;
            const double angle = degrees * pi / 180.0;
            arc.push_back(POINT{
                static_cast<LONG>(sourceSize / 2 + std::cos(angle) * radius),
                static_cast<LONG>(sourceSize / 2 + std::sin(angle) * radius)});
        }
        HPEN arcPen = CreatePen(PS_SOLID, 3 * spinnerScale, RGB(20, 105, 220));
        previousPen = SelectObject(spinnerDc, arcPen);
        Polyline(spinnerDc, arc.data(), static_cast<int>(arc.size()));
        SelectObject(spinnerDc, previousPen);
        DeleteObject(arcPen);

        const int capRadius = 3 * spinnerScale / 2;
        HBRUSH capBrush = CreateSolidBrush(RGB(20, 105, 220));
        previousBrush = SelectObject(spinnerDc, capBrush);
        HPEN nullPen = CreatePen(PS_NULL, 0, 0);
        previousPen = SelectObject(spinnerDc, nullPen);
        for (const POINT point : {arc.front(), arc.back()}) {
            Ellipse(spinnerDc, point.x - capRadius, point.y - capRadius,
                    point.x + capRadius + 1, point.y + capRadius + 1);
        }
        SelectObject(spinnerDc, previousBrush);
        SelectObject(spinnerDc, previousPen);
        DeleteObject(capBrush);
        DeleteObject(nullPen);
        SetStretchBltMode(dc, HALFTONE);
        SetBrushOrgEx(dc, 0, 0, nullptr);
        StretchBlt(dc, centerX - spinnerSize / 2, centerY - spinnerSize / 2,
                   spinnerSize, spinnerSize, spinnerDc, 0, 0, sourceSize, sourceSize, SRCCOPY);
        SelectObject(spinnerDc, oldSpinnerBitmap);
        DeleteObject(spinnerBitmap);
        DeleteDC(spinnerDc);
        RECT loadingText{centerX - 100, centerY + 34, centerX + 100, centerY + 62};
        drawText(L"Loading\u2026", loadingText, body, RGB(104, 113, 130),
                 DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    }

    if (menu) {
        RECT full{0, 0, cropWidth, cropHeight};
        fillRect(full, RGB(15, 20, 28));
        OverlayLayout layout = overlayLayout(width, height);
        auto makeCropLocal = [&](RECT& rect) {
            OffsetRect(&rect, -cropLeft, -cropTop);
        };
        makeCropLocal(layout.performance);
        makeCropLocal(layout.settings);
        makeCropLocal(layout.input);
        makeCropLocal(layout.bodyClip);
        makeCropLocal(layout.scrollTrack);
        makeCropLocal(layout.scrollThumb);
        makeCropLocal(layout.resolutionButton);
        makeCropLocal(layout.windowedButton);
        makeCropLocal(layout.borderlessButton);
        makeCropLocal(layout.fullscreenButton);
        makeCropLocal(layout.fpsButton);
        makeCropLocal(layout.debugButton);
        makeCropLocal(layout.dlssStatus);
        makeCropLocal(layout.dlssSuperResolutionButton);
        makeCropLocal(layout.dlssFrameGenerationButton);
        makeCropLocal(layout.dlssRayReconstructionButton);
        makeCropLocal(layout.reflexButton);
        layout.margin -= cropLeft;
        const RECT panel = layout.performance;
        rounded(panel, RGB(255, 255, 255), RGB(223, 227, 232), 16);

        drawLogo(panel.left + 24, panel.top + 20, 38);
        RECT panelTitle{panel.left + 76, panel.top + 17, panel.right - 170, panel.top + 43};
        drawText(L"Runtime controls", panelTitle, title, RGB(21, 25, 34),
                 DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS);
        RECT panelSubtitle{panel.left + 76, panel.top + 41, panel.right - 170, panel.top + 64};
        drawText(L"ThreeBrowser", panelSubtitle, body, RGB(104, 113, 130),
                 DT_LEFT | DT_VCENTER | DT_SINGLELINE);
        RECT keycap{std::max<LONG>(panel.left + 190, panel.right - 146), panel.top + 22,
                    panel.right - 24, panel.top + 57};
        rounded(keycap, RGB(248, 250, 252), RGB(207, 213, 221), 9);
        drawText(L"SHIFT + TAB", keycap, label, RGB(86, 97, 115),
                 DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        line(panel.left + 24, panel.top + 78, panel.right - 24, panel.top + 78, RGB(223, 227, 232));

        std::vector<DisplayMode> displayModes;
        int selectedDisplayMode = 0;
        OverlayDropdown resolutionDropdown{};
        {
            std::lock_guard<std::mutex> lock(g.displayMu);
            displayModes = g.displayModes;
            selectedDisplayMode = g.selectedDisplayMode;
            resolutionDropdown = g.resolutionDropdown;
        }

        const int bodyDc = SaveDC(dc);
        IntersectClipRect(dc, layout.bodyClip.left, layout.bodyClip.top,
                         layout.bodyClip.right, layout.bodyClip.bottom);

        RECT displayLabel{panel.left + 24, layout.resolutionButton.top - 25,
                          panel.right - 24, layout.resolutionButton.top - 2};
        drawText(L"DISPLAY", displayLabel, label, RGB(86, 97, 115),
                 DT_LEFT | DT_VCENTER | DT_SINGLELINE);
        rounded(layout.resolutionButton, RGB(255, 255, 255), RGB(207, 213, 221), 9);
        wchar_t selectedResolution[96]{L"Choose a supported resolution"};
        if (!displayModes.empty() && selectedDisplayMode >= 0 &&
            selectedDisplayMode < static_cast<int>(displayModes.size())) {
            const DisplayMode& mode = displayModes[static_cast<size_t>(selectedDisplayMode)];
            std::swprintf(selectedResolution, std::size(selectedResolution), L"%d × %d  ·  %d Hz",
                          mode.width, mode.height, mode.refreshHz);
        }
        RECT resolutionText{layout.resolutionButton.left + 15, layout.resolutionButton.top,
                            layout.resolutionButton.right - 46, layout.resolutionButton.bottom};
        drawText(selectedResolution, resolutionText, body, RGB(31, 40, 54),
                 DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS);
        RECT chevron{layout.resolutionButton.right - 40, layout.resolutionButton.top,
                     layout.resolutionButton.right - 12, layout.resolutionButton.bottom};
        drawText(resolutionDropdown.open ? L"▴" : L"▾", chevron, body, RGB(86, 97, 115),
                 DT_CENTER | DT_VCENTER | DT_SINGLELINE);

        const int fullscreen = std::clamp(g.fullscreenState.load(std::memory_order_relaxed), 0, 2);
        auto drawModeButton = [&](RECT rect, bool active, const wchar_t* text) {
            rounded(rect, active ? RGB(238, 245, 255) : RGB(255, 255, 255),
                    active ? RGB(20, 105, 220) : RGB(207, 213, 221), 9);
            drawText(text, rect, body, active ? RGB(20, 105, 220) : RGB(54, 65, 81),
                     DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS);
        };
        drawModeButton(layout.windowedButton, fullscreen == 0, L"Windowed");
        drawModeButton(layout.borderlessButton, fullscreen == 1, L"Borderless");
        drawModeButton(layout.fullscreenButton, fullscreen == 2, L"Exclusive");

        auto drawCompactToggle = [&](RECT rect, bool active, const wchar_t* text) {
            rounded(rect, active ? RGB(238, 245, 255) : RGB(255, 255, 255),
                    active ? RGB(185, 210, 248) : RGB(207, 213, 221), 9);
            RECT textRect{rect.left + 15, rect.top, rect.right - 62, rect.bottom};
            drawText(text, textRect, body, RGB(31, 40, 54), DT_LEFT | DT_VCENTER | DT_SINGLELINE);
            RECT track{rect.right - 52, rect.top + 14, rect.right - 14, rect.bottom - 14};
            rounded(track, active ? RGB(20, 105, 220) : RGB(207, 213, 221),
                    active ? RGB(20, 105, 220) : RGB(207, 213, 221), 20);
            const int knobLeft = active ? static_cast<int>(track.right) - 14 : static_cast<int>(track.left) + 3;
            HBRUSH knob = CreateSolidBrush(RGB(255, 255, 255));
            HGDIOBJ previousBrush = SelectObject(dc, knob);
            HPEN nullPen = CreatePen(PS_NULL, 0, 0);
            HGDIOBJ previousPen = SelectObject(dc, nullPen);
            Ellipse(dc, knobLeft, track.top + 3, knobLeft + 11, track.bottom - 3);
            SelectObject(dc, previousBrush);
            SelectObject(dc, previousPen);
            DeleteObject(knob);
            DeleteObject(nullPen);
        };
        RECT overlayLabel{panel.left + 24, layout.fpsButton.top - 25,
                          panel.right - 24, layout.fpsButton.top - 2};
        drawText(L"OVERLAYS", overlayLabel, label, RGB(86, 97, 115),
                 DT_LEFT | DT_VCENTER | DT_SINGLELINE);
        drawCompactToggle(layout.fpsButton, g.fpsOverlay.load(std::memory_order_relaxed) != 0, L"FPS counter");
        drawCompactToggle(layout.debugButton, g.debugOverlay.load(std::memory_order_relaxed) != 0, L"Diagnostic log");

        RECT dlssLabel{panel.left + 24, layout.dlssStatus.top - 25,
                       panel.right - 24, layout.dlssStatus.top - 2};
        drawText(L"NVIDIA RTX", dlssLabel, label, RGB(86, 97, 115),
                 DT_LEFT | DT_VCENTER | DT_SINGLELINE);

        const StreamlineCapabilities streamline = streamlineCapabilities();
        const StreamlineFeatureState featureState = runtimeFeatureState();
        const bool rtxAvailable = g.rtxAdapter && streamline.vulkanAttached;
        rounded(layout.dlssStatus,
                rtxAvailable ? RGB(241, 248, 245) : RGB(248, 249, 251),
                rtxAvailable ? RGB(183, 220, 199) : RGB(223, 227, 232), 10);
        std::wstring gpuName = wideFromUtf8(g.gpuDeviceName.c_str());
        if (gpuName.empty()) gpuName = L"GPU capability unavailable";
        RECT gpuTitle{layout.dlssStatus.left + 16, layout.dlssStatus.top + 8,
                      layout.dlssStatus.right - 16, layout.dlssStatus.top + 31};
        drawText(gpuName.c_str(), gpuTitle, body,
                 rtxAvailable ? RGB(25, 95, 60) : RGB(86, 97, 115),
                 DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS);
        RECT gpuStatus{layout.dlssStatus.left + 16, layout.dlssStatus.top + 31,
                       layout.dlssStatus.right - 16, layout.dlssStatus.bottom - 7};
        std::wstring streamlineStatus = wideFromUtf8(streamline.status.c_str());
        {
            std::lock_guard<std::mutex> lock(g.featureControlMu);
            if (!g.featureControlError.empty()) {
                streamlineStatus = L"Runtime controls: " +
                    wideFromUtf8(g.featureControlError.c_str());
            }
        }
        if (streamlineStatus.empty()) {
            streamlineStatus = rtxAvailable
                ? L"Streamline is connected to the Vulkan device"
                : L"DLSS controls require a supported NVIDIA RTX adapter";
        }
        drawText(streamlineStatus.c_str(),
                 gpuStatus, label, RGB(104, 113, 130),
                 DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS);

        auto drawFeature = [&](int featureIndex, RECT rect, const wchar_t* name,
                               const wchar_t* requirement, bool available, bool active,
                               bool desiredEnabled, bool appliedEnabled, bool pending,
                               bool blocked) {
            const bool hovered = available &&
                g.overlayFeatureHover.load(std::memory_order_relaxed) == featureIndex;
            rounded(rect,
                    hovered ? RGB(239, 246, 255) :
                    desiredEnabled ? RGB(248, 249, 251) : RGB(241, 243, 246),
                    hovered ? RGB(134, 177, 240) :
                    desiredEnabled ? RGB(223, 227, 232) : RGB(207, 213, 221), 9);
            RECT featureName{rect.left + 15, rect.top + 5, rect.right - 170, rect.top + 28};
            drawText(name, featureName, body,
                     desiredEnabled ? RGB(54, 65, 81) : RGB(112, 121, 135),
                     DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS);
            RECT featureRequirement{rect.left + 15, rect.top + 27, rect.right - 145, rect.bottom - 4};
            drawText(requirement, featureRequirement, label,
                     desiredEnabled ? RGB(120, 130, 146) : RGB(137, 145, 158),
                     DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS);
            RECT badge{rect.right - 137, rect.top + 12, rect.right - 14, rect.bottom - 12};
            const wchar_t* actionText = !available ? L"UNAVAILABLE" :
                pending ? L"APPLYING..." : desiredEnabled ? L"TURN OFF" : L"TURN ON";
            rounded(badge,
                    hovered ? RGB(224, 238, 255) :
                    pending ? RGB(239, 242, 246) :
                    !desiredEnabled ? RGB(231, 234, 239) :
                    active && appliedEnabled ? RGB(235, 247, 240) : RGB(245, 248, 252),
                    hovered ? RGB(113, 164, 238) :
                    pending ? RGB(203, 209, 218) :
                    !desiredEnabled ? RGB(198, 204, 213) :
                    active && appliedEnabled ? RGB(175, 218, 193) : RGB(190, 210, 239), 12);
            drawText(actionText, badge, label,
                     !available ? RGB(104, 113, 130) :
                     pending ? RGB(104, 113, 130) :
                     desiredEnabled ? RGB(31, 91, 176) : RGB(20, 105, 220),
                     DT_CENTER | DT_VCENTER | DT_SINGLELINE);
            if (blocked) {
                RECT blockedMark{rect.left + 3, rect.top + 10, rect.left + 6,
                                 rect.bottom - 10};
                rounded(blockedMark, RGB(229, 173, 64), RGB(229, 173, 64), 2);
            }
        };
        std::wstring dlssReason = wideFromUtf8(featureState.dlssReason.c_str());
        if (dlssReason.empty()) dlssReason = L"No DLSS Super Resolution state is available";
        if (featureState.dlssEvaluationCount != 0) {
            dlssReason += L"  ·  ";
            dlssReason += std::to_wstring(featureState.dlssEvaluationCount);
            dlssReason += featureState.dlssEvaluationCount == 1 ? L" evaluation" : L" evaluations";
        }
        std::wstring frameGenerationReason =
            wideFromUtf8(featureState.frameGenerationReason.c_str());
        if (frameGenerationReason.empty()) {
            frameGenerationReason = L"Frame Generation has not been requested";
        }
        std::wstring rayReconstructionReason =
            wideFromUtf8(featureState.rayReconstructionReason.c_str());
        if (rayReconstructionReason.empty()) {
            rayReconstructionReason = L"Ray Reconstruction has not been requested";
        }
        const bool dlssRuntimeEnabled =
            g.dlssRuntimeEnabled.load(std::memory_order_acquire) != 0;
        const bool frameGenerationRuntimeEnabled =
            g.frameGenerationRuntimeEnabled.load(std::memory_order_acquire) != 0;
        const bool rayReconstructionRuntimeEnabled =
            g.rayReconstructionRuntimeEnabled.load(std::memory_order_acquire) != 0;
        const bool reflexRuntimeEnabled =
            g.reflexRuntimeEnabled.load(std::memory_order_acquire) != 0;
        const RuntimeFeaturePreferences appliedFeatures = runtimeAppliedFeatures();
        const bool dlssPending = dlssRuntimeEnabled != appliedFeatures.dlss;
        const bool frameGenerationPending =
            frameGenerationRuntimeEnabled != appliedFeatures.frameGeneration;
        const bool rayReconstructionBlocked =
            rayReconstructionRuntimeEnabled && !dlssRuntimeEnabled;
        const bool rayReconstructionPending = dlssRuntimeEnabled &&
            rayReconstructionRuntimeEnabled != appliedFeatures.rayReconstruction;
        const bool reflexPending = reflexRuntimeEnabled != appliedFeatures.reflex;
        if (rayReconstructionBlocked) {
            rayReconstructionReason =
                L"Blocked while Super Resolution is off · preference is remembered";
        }
        drawFeature(0, layout.dlssSuperResolutionButton, L"DLSS Super Resolution",
                    dlssReason.c_str(),
                    featureState.dlssSupported && featureState.dlssFunctionsLoaded,
                    featureState.dlssActive,
                    dlssRuntimeEnabled,
                    appliedFeatures.dlss, dlssPending, false);
        drawFeature(1, layout.dlssFrameGenerationButton, L"DLSS Frame Generation",
                    frameGenerationReason.c_str(),
                    featureState.frameGenerationSupported &&
                        featureState.frameGenerationFunctionsLoaded,
                    featureState.frameGenerationActive,
                    frameGenerationRuntimeEnabled,
                    appliedFeatures.frameGeneration, frameGenerationPending, false);
        drawFeature(2, layout.dlssRayReconstructionButton, L"DLSS Ray Reconstruction",
                    rayReconstructionReason.c_str(),
                    featureState.rayReconstructionSupported &&
                        featureState.rayReconstructionFunctionsLoaded,
                    featureState.rayReconstructionActive,
                    rayReconstructionRuntimeEnabled,
                    appliedFeatures.rayReconstruction, rayReconstructionPending,
                    rayReconstructionBlocked);
        const int reflexMode = appliedFeatures.reflex ? streamlineReflexMode() : 0;
        drawFeature(3, layout.reflexButton, L"NVIDIA Reflex",
                    reflexRuntimeEnabled
                        ? L"Enabled · Click to disable"
                        : L"Disabled from runtime controls · Click to enable",
                    streamline.reflex, reflexRuntimeEnabled && reflexMode != 0,
                    reflexRuntimeEnabled,
                    appliedFeatures.reflex, reflexPending, false);

        RECT hint{panel.left + 24, layout.reflexButton.bottom + 12,
                  panel.right - 24, layout.reflexButton.bottom + 38};
        drawText(L"Esc closes controls  ·  Shift + Tab opens them again", hint, body, RGB(120, 130, 146),
                 DT_CENTER | DT_VCENTER | DT_SINGLELINE);

        if (resolutionDropdown.open && !displayModes.empty()) {
            const int count = std::min(kDropdownVisibleRows,
                                       static_cast<int>(displayModes.size()) - resolutionDropdown.scrollOffset);
            for (int row = 0; row < count; ++row) {
                const int index = resolutionDropdown.scrollOffset + row;
                RECT option = dropdownOptionRect(layout.resolutionButton, row);
                const bool selected = index == selectedDisplayMode;
                const bool hovered = index == resolutionDropdown.hoverIndex;
                rounded(option, selected ? RGB(238, 245, 255) :
                                hovered ? RGB(246, 249, 253) : RGB(255, 255, 255),
                        selected ? RGB(185, 210, 248) :
                                   hovered ? RGB(207, 221, 242) : RGB(223, 227, 232), 5);
                wchar_t optionText[96]{};
                const DisplayMode& mode = displayModes[static_cast<size_t>(index)];
                std::swprintf(optionText, std::size(optionText), L"%d × %d  ·  %d Hz",
                              mode.width, mode.height, mode.refreshHz);
                RECT optionTextRect{option.left + 15, option.top, option.right - 15, option.bottom};
                drawText(optionText, optionTextRect, body,
                         selected ? RGB(20, 105, 220) : RGB(31, 40, 54),
                         DT_LEFT | DT_VCENTER | DT_SINGLELINE);
            }
            if (resolutionDropdown.scrollOffset > 0) {
                RECT up{layout.resolutionButton.right - 38, layout.resolutionButton.bottom + 4,
                        layout.resolutionButton.right - 12, layout.resolutionButton.bottom + 30};
                drawText(L"▲", up, label, RGB(86, 97, 115), DT_CENTER | DT_VCENTER | DT_SINGLELINE);
            }
            if (resolutionDropdown.scrollOffset < dropdownMaxOffset(static_cast<int>(displayModes.size()))) {
                RECT down = dropdownOptionRect(layout.resolutionButton, count - 1);
                down.left = down.right - 38;
                down.right -= 12;
                drawText(L"▼", down, label, RGB(86, 97, 115), DT_CENTER | DT_VCENTER | DT_SINGLELINE);
            }
        }
        RestoreDC(dc, bodyDc);
        if (layout.maxScroll > 0) {
            rounded(layout.scrollTrack, RGB(237, 240, 244), RGB(237, 240, 244), 4);
            rounded(layout.scrollThumb, RGB(157, 168, 184), RGB(157, 168, 184), 4);
        }
    }

    if (!loading && !menu && g.fpsOverlay.load(std::memory_order_relaxed)) {
        RECT badge = compactFps
            ? RECT{4, 4, width - 4, height - 4}
            : RECT{width - 138, 18, width - 18, 54};
        rounded(badge, RGB(255, 255, 255), RGB(207, 213, 221), 10);
        wchar_t fps[32]{};
        std::swprintf(fps, std::size(fps), L"%d FPS  ·  %.1f ms",
                      g.statsFps.load(std::memory_order_relaxed),
                      g.statsFrameUs.load(std::memory_order_relaxed) / 1000.0);
        drawText(fps, badge, title, RGB(20, 105, 220), DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    }

    const int paddedRowBytes = (rowBytes + 255) & ~255;
    g.overlayPixels.assign(static_cast<size_t>(paddedRowBytes) * cropHeight, 0);
    const auto* source = static_cast<const uint8_t*>(bits);
    int sourceRowBytes = renderRowBytes;
    HDC downsampleDc = nullptr;
    HBITMAP downsampleBitmap = nullptr;
    HGDIOBJ oldDownsampleBitmap = nullptr;
    if (renderScale > 1) {
        SetMapMode(dc, MM_TEXT);
        BITMAPINFO downsampleInfo{};
        downsampleInfo.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        downsampleInfo.bmiHeader.biWidth = cropWidth;
        downsampleInfo.bmiHeader.biHeight = -cropHeight;
        downsampleInfo.bmiHeader.biPlanes = 1;
        downsampleInfo.bmiHeader.biBitCount = 32;
        downsampleInfo.bmiHeader.biCompression = BI_RGB;
        void* downsampleBits = nullptr;
        downsampleDc = CreateCompatibleDC(nullptr);
        downsampleBitmap = CreateDIBSection(downsampleDc, &downsampleInfo, DIB_RGB_COLORS,
                                             &downsampleBits, nullptr, 0);
        oldDownsampleBitmap = SelectObject(downsampleDc, downsampleBitmap);
        SetStretchBltMode(downsampleDc, HALFTONE);
        SetBrushOrgEx(downsampleDc, 0, 0, nullptr);
        StretchBlt(downsampleDc, 0, 0, cropWidth, cropHeight,
                   dc, 0, 0, renderWidth, renderHeight, SRCCOPY);
        source = static_cast<const uint8_t*>(downsampleBits);
        sourceRowBytes = rowBytes;
    }
    for (int y = 0; y < cropHeight; ++y) {
        auto* destination = g.overlayPixels.data() + static_cast<size_t>(y) * paddedRowBytes;
        std::memcpy(destination, source + static_cast<size_t>(y) * sourceRowBytes, rowBytes);
        for (int x = 0; x < cropWidth; ++x) {
            uint8_t* pixel = destination + x * 4;
            const int brightness = pixel[0] + pixel[1] + pixel[2];
            if (loading) {
                pixel[3] = 255;
            } else if (menu) {
                const bool backdrop = pixel[2] == 15 && pixel[1] == 20 && pixel[0] == 28;
                pixel[3] = backdrop ? 176 : 250;
            } else {
                pixel[3] = static_cast<uint8_t>(brightness == 0 ? 0 : 245);
            }
        }
    }

    if (downsampleDc) {
        SelectObject(downsampleDc, oldDownsampleBitmap);
        DeleteObject(downsampleBitmap);
        DeleteDC(downsampleDc);
    }

    SelectObject(dc, oldFont);
    DeleteObject(heading);
    DeleteObject(title);
    DeleteObject(body);
    DeleteObject(label);
    SelectObject(dc, oldBitmap);
    DeleteObject(bitmap);
    DeleteDC(dc);
    g.overlayRevision.fetch_add(1, std::memory_order_release);
}

bool prepareOverlay(int width, int height, uint32_t sampleCount,
                    WGPUTextureFormat depthFormat) {
    const bool visible = g.loading.load(std::memory_order_relaxed) != 0 ||
                         g.overlayOpen.load(std::memory_order_relaxed) != 0 ||
                         g.fpsOverlay.load(std::memory_order_relaxed) != 0;
    if (!visible || !g.currentView || !g.device || !g.queue) return false;
    if (width < 1 || height < 1) return false;
    const bool loading = g.loading.load(std::memory_order_relaxed) != 0;
    const bool menu = !loading && g.overlayOpen.load(std::memory_order_relaxed) != 0;
    const bool fpsOnly = !loading && g.overlayOpen.load(std::memory_order_relaxed) == 0 &&
                         g.fpsOverlay.load(std::memory_order_relaxed) != 0;
    const RECT rasterRect = overlayRasterRect(width, height);
    const int textureWidth = std::max(1L, rasterRect.right - rasterRect.left);
    const int textureHeight = std::max(1L, rasterRect.bottom - rasterRect.top);
    g.overlayLeft = rasterRect.left;
    g.overlayTop = rasterRect.top;
    if (!g.overlayPipeline || g.overlayWidth != textureWidth || g.overlayHeight != textureHeight ||
        g.overlaySampleCount != std::max(1u, sampleCount) || g.overlayDepthFormat != depthFormat) {
        if (!createOverlayGpu(textureWidth, textureHeight, sampleCount, depthFormat)) return false;
    }
    const auto now = std::chrono::steady_clock::now();
    static thread_local auto lastDiagnosticsRefresh = std::chrono::steady_clock::time_point{};
    const bool diagnosticsDue = fpsOnly &&
        (lastDiagnosticsRefresh.time_since_epoch().count() == 0 ||
         now - lastDiagnosticsRefresh >= std::chrono::seconds(1));
    const bool dirty = g.overlayDirty.exchange(0, std::memory_order_acq_rel) != 0;
    if (loading || dirty || diagnosticsDue) {
        if (menu) {
            buildOverlayPixels(width, height, false, g.overlayLeft, g.overlayTop,
                               textureWidth, textureHeight);
        } else {
            buildOverlayPixels(textureWidth, textureHeight, fpsOnly);
        }
        const int rowBytes = (textureWidth * 4 + 255) & ~255;
        WGPUTexelCopyTextureInfo destination{};
        destination.texture = g.overlayTexture;
        WGPUTexelCopyBufferLayout layout{};
        layout.bytesPerRow = static_cast<uint32_t>(rowBytes);
        layout.rowsPerImage = static_cast<uint32_t>(textureHeight);
        WGPUExtent3D extent{static_cast<uint32_t>(textureWidth), static_cast<uint32_t>(textureHeight), 1};
        wgpuQueueWriteTexture(g.queue, &destination, g.overlayPixels.data(), g.overlayPixels.size(), &layout, &extent);
        g.overlayRenderedFps = g.statsFps.load(std::memory_order_relaxed);
        if (fpsOnly) lastDiagnosticsRefresh = now;
    }
    return true;
}

void encodeOverlayDraw(WGPURenderPassEncoder pass, int width, int height) {
    if (width < 1 || height < 1) return;
    const int clampedLeft = std::clamp(g.overlayLeft, 0, width);
    const int clampedTop = std::clamp(g.overlayTop, 0, height);
    const int remainingWidth = width - clampedLeft;
    const int remainingHeight = height - clampedTop;
    const int clampedWidth = std::clamp(g.overlayWidth, 0, remainingWidth);
    const int clampedHeight = std::clamp(g.overlayHeight, 0, remainingHeight);
    if (clampedWidth < 1 || clampedHeight < 1) return;
    wgpuRenderPassEncoderSetPipeline(pass, g.overlayPipeline);
    wgpuRenderPassEncoderSetBindGroup(pass, 0, g.overlayBindGroup, 0, nullptr);
    const uint32_t left = static_cast<uint32_t>(clampedLeft);
    const uint32_t top = static_cast<uint32_t>(clampedTop);
    const uint32_t drawWidth = static_cast<uint32_t>(clampedWidth);
    const uint32_t drawHeight = static_cast<uint32_t>(clampedHeight);
    wgpuRenderPassEncoderSetViewport(pass, static_cast<float>(left), static_cast<float>(top),
                                     static_cast<float>(drawWidth), static_cast<float>(drawHeight), 0.f, 1.f);
    wgpuRenderPassEncoderSetScissorRect(pass, left, top, drawWidth, drawHeight);
    wgpuRenderPassEncoderDraw(pass, 3, 1, 0, 0);
}

bool drawOverlayInPass(WGPURenderPassEncoder pass) {
    const int width = g.activeRenderPassWidth;
    const int height = g.activeRenderPassHeight;
    if (!pass || !prepareOverlay(width, height, g.activeRenderPassSampleCount,
                                 g.activeRenderPassDepthFormat)) return false;
    encodeOverlayDraw(pass, width, height);
    return true;
}

bool recordOverlay(WGPUCommandEncoder encoder) {
    const int width = static_cast<int>(g.config.width);
    const int height = static_cast<int>(g.config.height);
    if (!encoder || !prepareOverlay(width, height, 1, WGPUTextureFormat_Undefined)) return false;
    WGPURenderPassColorAttachment color{};
    color.view = g.currentView;
    color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    color.loadOp = WGPULoadOp_Load;
    color.storeOp = WGPUStoreOp_Store;
    WGPURenderPassDescriptor passDesc{};
    passDesc.colorAttachmentCount = 1;
    passDesc.colorAttachments = &color;
    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &passDesc);
    if (!pass) return false;
    encodeOverlayDraw(pass, width, height);
    wgpuRenderPassEncoderEnd(pass);
    wgpuRenderPassEncoderRelease(pass);
    return true;
}

void renderOverlay() {
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(g.device, nullptr);
    if (!encoder) return;
    if (recordOverlay(encoder)) {
        WGPUCommandBuffer command = wgpuCommandEncoderFinish(encoder, nullptr);
        if (command) {
            wgpuQueueSubmit(g.queue, 1, &command);
            wgpuCommandBufferRelease(command);
        }
    }
    wgpuCommandEncoderRelease(encoder);
}

void presentLoadingFrame() {
    if (!g.loading.load(std::memory_order_acquire) || !g.started || !g.open.load(std::memory_order_relaxed) ||
        !g.surface || !g.surfaceConfigured || g.currentEncoder || g.renderPass || g.computePass || g.currentTex) {
        return;
    }
    if (!acquireSwapchain() || !g.currentView) return;

    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(g.device, nullptr);
    if (!encoder) {
        dropCurrentTexture();
        return;
    }
    WGPURenderPassColorAttachment color{};
    color.view = g.currentView;
    color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    color.loadOp = WGPULoadOp_Clear;
    color.storeOp = WGPUStoreOp_Store;
    color.clearValue = WGPUColor{246.0 / 255.0, 247.0 / 255.0, 249.0 / 255.0, 1.0};
    WGPURenderPassDescriptor passDesc{};
    passDesc.colorAttachmentCount = 1;
    passDesc.colorAttachments = &color;
    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &passDesc);
    if (pass) {
        wgpuRenderPassEncoderEnd(pass);
        wgpuRenderPassEncoderRelease(pass);
    }
    WGPUCommandBuffer command = wgpuCommandEncoderFinish(encoder, nullptr);
    if (command) {
        wgpuQueueSubmit(g.queue, 1, &command);
        wgpuCommandBufferRelease(command);
    }
    wgpuCommandEncoderRelease(encoder);

    g.loadingPhase.fetch_add(1, std::memory_order_relaxed);
    g.overlayDirty.store(1, std::memory_order_release);
    if (!g.overlayRecordedForCurrentTexture) renderOverlay();
    wgpuSurfacePresent(g.surface);
    dropCurrentTexture();
    if (g.device) wgpuDevicePoll(g.device, 0, nullptr);
}

void destroyGpu() {
    dropCurrentTexture();
    clearSlots();
    releaseOverlayGpu();
#if defined(THREEBROWSER_RAY_QUERY)
    rayQueryBridgeShutdown();
#endif
    if (g.surface && g.surfaceConfigured) {
        wgpuSurfaceUnconfigure(g.surface);
        g.surfaceConfigured = false;
    }
    if (g.queue) {
        wgpuQueueRelease(g.queue);
        g.queue = nullptr;
    }
    if (g.device) {
        wgpuDeviceRelease(g.device);
        g.device = nullptr;
    }
    if (g.adapter) {
        wgpuAdapterRelease(g.adapter);
        g.adapter = nullptr;
    }
    if (g.surface) {
        wgpuSurfaceRelease(g.surface);
        g.surface = nullptr;
    }
    if (g.instance) {
        wgpuInstanceRelease(g.instance);
        g.instance = nullptr;
    }
    g.backendName = "WebGPU";
    g.backendType = WGPUBackendType_Undefined;
    g.rayQueryFeatureEnabled = false;
}

void destroyHwnd() {
    restoreExclusiveFullscreenOnWindowThread(false);
    setPointerLockOnWindowThread(false);
    g.nativeHwnd.store(nullptr);
    g.open.store(0, std::memory_order_relaxed);
    if (g.hwnd) {
        ShowWindow(g.hwnd, SW_HIDE);
        SetParent(g.hwnd, nullptr);
        DestroyWindow(g.hwnd);
        g.hwnd = nullptr;
        g.parent = nullptr;
        pumpHwnd();
    }
    std::lock_guard<std::mutex> lock(g.inputMu);
    g.inputEvents.clear();
}

bool initGpu(WGPUInstanceBackend backends) {
    if (backends == WGPUInstanceBackend_Vulkan) streamlinePrepare();
    if (!createInstance(backends)) {
        setError("wgpuCreateInstance failed");
        return false;
    }
    if (!createSurface()) {
        destroyGpu();
        return false;
    }
    if (!requestAdapterAndDevice()) {
        destroyGpu();
        return false;
    }
    return true;
}

bool implStart(void* parentHwnd, int x, int y, int w, int h) {
    setError("");
    w = std::max(1, w);
    h = std::max(1, h);
    if (g.started && g.hwnd && g.device) {
        return true;
    }
    destroyGpu();
    destroyHwnd();

    wgpuSetLogCallback(wgpuLog, nullptr);
    wgpuSetLogLevel(WGPULogLevel_Warn);

    // Never CreateWindow(WS_CHILD, form) here. The host calls tw_start from
    // the UI/COM thread and waits; a child of that form would deadlock.
    if (!createHwnd(nullptr, x, y, w, h)) {
        return false;
    }

    const bool wantVk = hasVulkanDll();
    bool ok = false;
    if (wantVk) {
        ok = initGpu(WGPUInstanceBackend_Vulkan);
        if (!ok) {
            logLine("Vulkan adapter failed, falling back to D3D12");
            destroyGpu();
        }
    }
    if (!ok) {
        ok = initGpu(WGPUInstanceBackend_DX12);
    }
    if (!ok) {
        destroyHwnd();
        if (g.lastError.empty()) {
            setError("WebGPU init failed");
        }
        return false;
    }
    if (!configureSurface(w, h)) {
        destroyGpu();
        destroyHwnd();
        setError("surface configure failed");
        return false;
    }
    g.started = true;
    char traceFlag[8]{};
    g.traceCommands = GetEnvironmentVariableA("THREEBROWSER_WGPU_TRACE", traceFlag,
                                               static_cast<DWORD>(sizeof(traceFlag))) > 0;
    g.traceRemaining = g.traceCommands ? 1200 : 0;
    char statsFlag[8]{};
    g.statsLog.store(GetEnvironmentVariableA("THREEBROWSER_WGPU_STATS", statsFlag,
                                             static_cast<DWORD>(sizeof(statsFlag))) > 0,
                     std::memory_order_relaxed);
    g.lastStatsLog = {};
    g.statsCmdSubmits.store(0, std::memory_order_relaxed);
    g.statsCmdBytes.store(0, std::memory_order_relaxed);
    g.pendingCommandSubmits.store(0, std::memory_order_relaxed);
    g.statsW.store(w, std::memory_order_relaxed);
    g.statsH.store(h, std::memory_order_relaxed);
    logLine((std::string("runtime started backend=") + g.backendName).c_str());
    return true;
}

void releaseSurfaceOnly() {
    streamlineSuspendFrameGeneration(
        "Frame Generation suspended before the Vulkan surface was released", false);
    dropCurrentTexture();
    if (g.surface && g.surfaceConfigured) {
        wgpuSurfaceUnconfigure(g.surface);
        g.surfaceConfigured = false;
    }
    if (g.surface) {
        wgpuSurfaceRelease(g.surface);
        g.surface = nullptr;
    }
}

void implAttach(void* parentHwnd, int x, int y, int w, int h) {
    w = std::max(1, w);
    h = std::max(1, h);
    g.statsW.store(w, std::memory_order_relaxed);
    g.statsH.store(h, std::memory_order_relaxed);
    HWND parent = static_cast<HWND>(parentHwnd);
    if (!g.hwnd || !parent) {
        setError("runtime not started");
        return;
    }
    const bool alreadyAttached = g.parent == parent && GetParent(g.hwnd) == parent;
    applyAttachStyle(g.hwnd, parent, x, y, w, h);
    g.parent = parent;
    if (alreadyAttached) {
        // A WinForms resize arrives before the page's resize event. Resize the
        // child HWND immediately, but leave swapchain configuration ordered
        // with the page's OP_RESIZE and its replacement depth/MSAA textures.
        return;
    }
    // Vulkan/DXGI swapchain is tied to the HWND's parentage. Recreate after
    // SetParent or Present() can abort the process.
    releaseSurfaceOnly();
    if (!createSurface()) {
        setError("surface recreate after attach failed");
        return;
    }
    if (!configureSurface(w, h)) {
        setError("surface configure after attach failed");
        return;
    }
    logLine("attached host hwnd");
}

void recordFps(std::chrono::steady_clock::time_point t1, int frameUs) {
    g.statsFrameUs.store(frameUs, std::memory_order_relaxed);
    g.statsPresents.fetch_add(1, std::memory_order_relaxed);
    static thread_local auto windowStart = t1;
    static thread_local int windowFrames = 0;
    windowFrames++;
    const double elapsed = std::chrono::duration<double>(t1 - windowStart).count();
    if (elapsed >= 0.05 || windowFrames >= 8) {
        if (elapsed > 1e-6) {
            g.statsFps.store(static_cast<int>(std::lround(windowFrames / elapsed)), std::memory_order_relaxed);
        } else if (frameUs > 0) {
            g.statsFps.store(static_cast<int>(std::lround(1e6 / static_cast<double>(frameUs))), std::memory_order_relaxed);
        }
        windowFrames = 0;
        windowStart = t1;
    }
    if (g.statsLog.load(std::memory_order_relaxed) &&
        (g.lastStatsLog.time_since_epoch().count() == 0 ||
         std::chrono::duration<double>(t1 - g.lastStatsLog).count() >= 1.0)) {
        const int backlog = g.pendingCommandSubmits.load(std::memory_order_relaxed);
        char stats[192];
        std::snprintf(stats, sizeof(stats),
                      "stats native_fps=%d presents=%llu submits=%llu bytes=%llu backlog=%d",
                      g.statsFps.load(std::memory_order_relaxed),
                      static_cast<unsigned long long>(g.statsPresents.load(std::memory_order_relaxed)),
                      static_cast<unsigned long long>(g.statsCmdSubmits.load(std::memory_order_relaxed)),
                      static_cast<unsigned long long>(g.statsCmdBytes.load(std::memory_order_relaxed)),
                      backlog);
        logLine(stats);
        g.lastStatsLog = t1;
    }
}

bool acquireSwapchain() {
    if (g.currentView && g.currentTex) {
        return true;
    }
    if (!g.surfaceConfigured) {
        configureSurface(g.config.width ? static_cast<int>(g.config.width) : g.statsW.load(),
                         g.config.height ? static_cast<int>(g.config.height) : g.statsH.load());
    }
    WGPUSurfaceTexture st{};
    wgpuSurfaceGetCurrentTexture(g.surface, &st);
    switch (st.status) {
        case WGPUSurfaceGetCurrentTextureStatus_SuccessOptimal:
        case WGPUSurfaceGetCurrentTextureStatus_SuccessSuboptimal:
            break;
        case WGPUSurfaceGetCurrentTextureStatus_Timeout:
        case WGPUSurfaceGetCurrentTextureStatus_Outdated:
        case WGPUSurfaceGetCurrentTextureStatus_Lost:
        case WGPUSurfaceGetCurrentTextureStatus_Error:
            if (st.texture) {
                wgpuTextureRelease(st.texture);
            }
            configureSurface(g.config.width ? static_cast<int>(g.config.width) : g.statsW.load(),
                             g.config.height ? static_cast<int>(g.config.height) : g.statsH.load());
            wgpuSurfaceGetCurrentTexture(g.surface, &st);
            if (st.status != WGPUSurfaceGetCurrentTextureStatus_SuccessOptimal &&
                st.status != WGPUSurfaceGetCurrentTextureStatus_SuccessSuboptimal) {
                if (st.texture) {
                    wgpuTextureRelease(st.texture);
                }
                setError("wgpuSurfaceGetCurrentTexture failed");
                return false;
            }
            break;
        default:
            if (st.status == static_cast<WGPUSurfaceGetCurrentTextureStatus>(
                        WGPUSurfaceGetCurrentTextureStatus_Occluded)) {
                if (st.texture) {
                    wgpuTextureRelease(st.texture);
                }
                return false;
            }
            if (st.texture) {
                wgpuTextureRelease(st.texture);
            }
            setError("wgpuSurfaceGetCurrentTexture status");
            return false;
    }
    g.currentTex = st.texture;
    g.currentView = wgpuTextureCreateView(g.currentTex, nullptr);
    if (!g.currentView) {
        setError("swapchain view failed");
        dropCurrentTexture();
        return false;
    }
    return true;
}

bool implPresent() {
    if (g.resizeHoldFrames > 0) {
        --g.resizeHoldFrames;
        dropCurrentTexture();
        return true;
    }
    if (!g.surface || !g.surfaceConfigured) {
        dropCurrentTexture();
        return true;
    }
    const auto t0 = std::chrono::steady_clock::now();
    pumpHwnd();
    if (!g.currentTex) {
        if (!acquireSwapchain()) {
            return false;
        }
    }
    const bool nativeOverlayHidden =
        g.loading.load(std::memory_order_relaxed) == 0 &&
        g.overlayOpen.load(std::memory_order_relaxed) == 0 &&
        g.fpsOverlay.load(std::memory_order_relaxed) == 0;
    streamlineFrameGenerationBeforePresent(nativeOverlayHidden);
    if (!g.overlayRecordedForCurrentTexture) renderOverlay();
    const bool firstPresent = g.statsPresents.load(std::memory_order_relaxed) == 0;
    streamlinePresentBegin();
    wgpuSurfacePresent(g.surface);
    streamlinePresentEnd();
    streamlineFrameGenerationAfterPresent();
    dropCurrentTexture();
    if (g.device) {
        wgpuDevicePoll(g.device, 0, nullptr);
    }
    if (g.instance) {
        wgpuInstanceProcessEvents(g.instance);
    }
    pumpHwnd();
    const auto t1 = std::chrono::steady_clock::now();
    recordFps(t1, static_cast<int>(std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count()));
    streamlineFrameBegin(static_cast<uint32_t>(
        g.statsPresents.load(std::memory_order_relaxed)));
    g.streamlineSimulationEnded = false;
    if (firstPresent) {
        logLine("native Vulkan surface presented first frame");
    }
    // Overlay commands can arrive while JavaScript is encoding a frame. Apply
    // the requested mode only after presentation has released the swapchain.
    tryApplyPendingDisplayTransition();
    return true;
}

struct Reader {
    const uint8_t* p;
    const uint8_t* end;
    bool ok{true};

    bool has(size_t n) const { return p + n <= end; }

    uint32_t u32() {
        if (!has(4)) {
            ok = false;
            return 0;
        }
        uint32_t v;
        std::memcpy(&v, p, 4);
        p += 4;
        return v;
    }
    uint64_t u64() {
        if (!has(8)) {
            ok = false;
            return 0;
        }
        uint64_t v;
        std::memcpy(&v, p, 8);
        p += 8;
        return v;
    }
    float f32() {
        if (!has(4)) {
            ok = false;
            return 0.f;
        }
        float v;
        std::memcpy(&v, p, 4);
        p += 4;
        return v;
    }
    const uint8_t* bytes(uint32_t n) {
        if (!has(n)) {
            ok = false;
            return nullptr;
        }
        const uint8_t* out = p;
        p += n;
        return out;
    }

    size_t remaining() const { return p <= end ? static_cast<size_t>(end - p) : 0; }

    uint32_t peekU32() const {
        if (!has(4)) {
            return 0;
        }
        uint32_t v;
        std::memcpy(&v, p, 4);
        return v;
    }
};

std::string findWgslEntry(const std::string& src, const char* stage) {
    const std::string tag = std::string("@") + stage;
    size_t pos = 0;
    while ((pos = src.find(tag, pos)) != std::string::npos) {
        const size_t fn = src.find("fn", pos);
        if (fn == std::string::npos || fn - pos > 96) {
            pos += tag.size();
            continue;
        }
        size_t i = fn + 2;
        while (i < src.size() && (src[i] == ' ' || src[i] == '\t' || src[i] == '\n' || src[i] == '\r')) {
            i++;
        }
        size_t j = i;
        while (j < src.size() && (std::isalnum(static_cast<unsigned char>(src[j])) || src[j] == '_')) {
            j++;
        }
        if (j > i) {
            return src.substr(i, j - i);
        }
        pos += tag.size();
    }
    return {};
}

bool hasWgslFn(const std::string& src, const std::string& name) {
    if (src.empty() || name.empty()) {
        return false;
    }
    const std::string pat = "fn " + name;
    size_t p = 0;
    while ((p = src.find(pat, p)) != std::string::npos) {
        const size_t after = p + pat.size();
        const char c = after < src.size() ? src[after] : '\0';
        if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '_')) {
            return true;
        }
        p += pat.size();
    }
    return false;
}

std::string pickEntry(const Slot* sh, const std::string& want, const char* stage) {
    const std::string& src = sh ? sh->wgsl : std::string();
    if (!want.empty() && hasWgslFn(src, want)) {
        return want;
    }
    std::string found = findWgslEntry(src, stage);
    if (!found.empty()) {
        return found;
    }
    static const char* kCands[] = {"main", "vs_main", "fs_main", "vertex", "fragment",
                                   "vertex_main", "fragment_main", "main_vertex", "main_fragment"};
    for (const char* c : kCands) {
        if (hasWgslFn(src, c)) {
            return c;
        }
    }
    return want.empty() ? "main" : want;
}

std::string readPaddedString(Reader& r) {
    const uint32_t n = r.u32();
    const uint8_t* b = n ? r.bytes(n) : nullptr;
    std::string s;
    if (b && n) {
        s.assign(reinterpret_cast<const char*>(b), n);
    }
    const uint32_t pad = (4u - (n & 3u)) & 3u;
    if (pad) {
        r.bytes(pad);
    }
    return s;
}

WGPUTextureView viewFromHandle(uint32_t handle, bool swapchainIfZero) {
    if (handle == 0) {
        if (!swapchainIfZero) {
            return nullptr;
        }
        if (!acquireSwapchain()) {
            return nullptr;
        }
        return g.currentView;
    }
    Slot* s = getSlot(handle);
    if (!s || s->kind != Kind::TextureView) {
        setError("invalid texture view handle");
        return nullptr;
    }
    return s->view;
}

WGPULoadOp loadOpFrom(uint32_t v) {
    if (v == 0 || v == static_cast<uint32_t>(WGPULoadOp_Clear)) {
        return WGPULoadOp_Clear;
    }
    if (v == static_cast<uint32_t>(WGPULoadOp_Load) || v == 1) {
        return WGPULoadOp_Load;
    }
    return WGPULoadOp_Clear;
}

WGPUPrimitiveTopology topologyFrom(uint32_t v) {
    if (v == 0) {
        return WGPUPrimitiveTopology_TriangleList;
    }
    return static_cast<WGPUPrimitiveTopology>(v);
}

WGPUCullMode cullFrom(uint32_t v) {
    if (v == 0) {
        return WGPUCullMode_None;
    }
    return static_cast<WGPUCullMode>(v);
}

WGPUFilterMode filterFrom(uint32_t v) {
    if (v == 0) {
        return WGPUFilterMode_Linear;
    }
    return static_cast<WGPUFilterMode>(v);
}

WGPUMipmapFilterMode mipFilterFrom(uint32_t v) {
    if (v == 0) {
        return WGPUMipmapFilterMode_Linear;
    }
    return static_cast<WGPUMipmapFilterMode>(v);
}

WGPUAddressMode addressFrom(uint32_t v) {
    if (v == 0) {
        return WGPUAddressMode_ClampToEdge;
    }
    return static_cast<WGPUAddressMode>(v);
}

void stubUnknown(uint32_t op) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "unknown/stub cmd opcode %u", op);
    logLine(buf);
}

void execOne(uint32_t op, Reader& r);

void execStream(const uint8_t* data, int nbytes) {
    if (!data || nbytes < 8) {
        return;
    }
    const uint8_t* p = data;
    const uint8_t* end = data + nbytes;
    while (p + 8 <= end) {
        uint32_t op = 0;
        uint32_t bytes = 0;
        std::memcpy(&op, p, 4);
        std::memcpy(&bytes, p + 4, 4);
        if (bytes < 8 || p + bytes > end) {
            setError("truncated command stream");
            return;
        }
        Reader r{p + 8, p + bytes, true};
        execOne(op, r);
        p += bytes;
    }
}

void finishEncoderSubmit() {
    endPasses();
    if (!g.currentEncoder || !g.queue) {
        return;
    }
    if (g.currentEncoderUsesSurface && !g.overlayRecordedForCurrentTexture &&
        recordOverlay(g.currentEncoder)) {
        g.overlayRecordedForCurrentTexture = true;
    }
    WGPUCommandBufferDescriptor cbd{};
    WGPUCommandBuffer cmd = wgpuCommandEncoderFinish(g.currentEncoder, &cbd);
    if (cmd) {
        if (!g.streamlineSimulationEnded) {
            streamlineSimulationEnd();
            g.streamlineSimulationEnded = true;
        }
        streamlineRenderSubmitBegin();
        wgpuQueueSubmit(g.queue, 1, &cmd);
        streamlineRenderSubmitEnd();
        wgpuCommandBufferRelease(cmd);
    }
    Slot* s = getSlot(g.currentEncoderHandle);
    if (s && s->kind == Kind::Encoder) {
        wgpuCommandEncoderRelease(g.currentEncoder);
        s->encoder = nullptr;
        s->kind = Kind::None;
    } else if (g.currentEncoder) {
        wgpuCommandEncoderRelease(g.currentEncoder);
    }
    g.currentEncoder = nullptr;
    g.currentEncoderHandle = 0;
    g.currentEncoderUsesSurface = false;
}

WGPUCommandEncoder ensureEncoder() {
    if (g.currentEncoder) {
        return g.currentEncoder;
    }
    if (!g.device) {
        return nullptr;
    }
    WGPUCommandEncoderDescriptor ed{};
    g.currentEncoder = wgpuDeviceCreateCommandEncoder(g.device, &ed);
    g.currentEncoderHandle = 0;
    g.currentEncoderUsesSurface = false;
    return g.currentEncoder;
}

void execOne(uint32_t op, Reader& r) {
    using namespace tw::cmd;
    if (g.traceRemaining > 0 && op >= OP_ENC_BEGIN && op <= OP_DRAW_INDEXED_INDIRECT) {
        char trace[192];
        std::snprintf(trace, sizeof(trace),
                      "cmd op=%u bytes=%zu first=%u enc=%u render=%u compute=%u",
                      op, static_cast<size_t>(r.end - r.p),
                      r.remaining() >= 4 ? r.peekU32() : 0u,
                      g.currentEncoderHandle, g.renderPass ? 1u : 0u,
                      g.computePass ? 1u : 0u);
        logLine(trace);
        --g.traceRemaining;
    }
    switch (op) {
        case OP_NOP:
            return;
        case OP_START: {
            const int w = static_cast<int>(r.has(4) ? r.u32() : 640);
            const int h = static_cast<int>(r.has(4) ? r.u32() : 480);
            if (g.started) {
                configureSurface(w, h);
            }
            return;
        }
        case OP_RESIZE: {
            const int w = static_cast<int>(r.u32());
            const int h = static_cast<int>(r.u32());
            // This is the WebGPU canvas backing-store size. It can be larger
            // than the HWND client area when Three.js uses DPR or
            // supersampling, so resizing the native window here is incorrect.
            // Command streams can split one encoder across several submits.
            // Never invalidate its acquired surface texture mid-encoder.
            requestSurfaceResize(w, h);
            return;
        }
        case OP_PRESENT:
            setLoadingState(false, nullptr);
            implPresent();
            return;
        case OP_SET_VSYNC: {
            const int on = static_cast<int>(r.u32());
            g.vsync.store(on != 0 ? 1 : 0, std::memory_order_relaxed);
            configureSurface(g.config.width ? static_cast<int>(g.config.width) : g.statsW.load(),
                             g.config.height ? static_cast<int>(g.config.height) : g.statsH.load());
            return;
        }
        case OP_BUF_CREATE: {
            // JS: handle, usage, size, mappedAtCreation (all u32)
            const uint32_t handle = r.u32();
            const uint32_t usage = r.u32();
            const uint32_t size32 = r.u32();
            const uint32_t mapped = r.has(4) ? r.u32() : 0;
            const uint64_t size = size32;
            (void)mapped;
            if (!r.ok || !g.device) {
                return;
            }
            if (size == 0 || size > (256ull * 1024ull * 1024ull)) {
                setError("buffer create: invalid size");
                return;
            }
            WGPUBufferDescriptor bd{};
            bd.size = size;
            bd.usage = static_cast<WGPUBufferUsage>(usage);
            Slot s;
            s.kind = Kind::Buffer;
            s.buffer = wgpuDeviceCreateBuffer(g.device, &bd);
            s.bufUsage = bd.usage;
            s.bufSize = size;
            if (!s.buffer) {
                setError("buffer create failed");
                return;
            }
            putSlot(handle, std::move(s));
            return;
        }
        case OP_BUF_WRITE: {
            // JS: handle, offset, nbytes, pad, bytes
            const uint32_t handle = r.u32();
            const uint32_t offset32 = r.u32();
            const uint32_t nbytes = r.u32();
            if (r.has(4)) {
                r.u32();
            }
            const uint64_t offset = offset32;
            const uint8_t* data = r.bytes(nbytes);
            Slot* s = getSlot(handle);
            if (!s || s->kind != Kind::Buffer || !s->buffer || !data || !g.queue) {
                setError("buf write: bad handle");
                return;
            }
            wgpuQueueWriteBuffer(g.queue, s->buffer, offset, data, nbytes);
            return;
        }
        case OP_BUF_DESTROY: {
            const uint32_t handle = r.u32();
            auto it = g.slots.find(handle);
            if (it != g.slots.end()) {
                releaseSlot(it->second);
                g.slots.erase(it);
            }
            return;
        }
        case OP_TEX_CREATE: {
            const uint32_t handle = r.u32();
            const uint32_t tw = r.u32();
            const uint32_t th = r.u32();
            const uint32_t td = r.u32();
            const uint32_t format = r.u32();
            const uint32_t usage = r.u32();
            // JS: dimension, mips, samples, pad
            const uint32_t dim = r.u32();
            const uint32_t mip = r.u32();
            const uint32_t sample = r.u32();
            if (r.has(4)) {
                r.u32();
            }
            if (!r.ok || !g.device) {
                return;
            }
            WGPUTextureDescriptor tdsc{};
            const std::string textureLabel = "ThreeBrowser texture " + std::to_string(handle);
            tdsc.label = twSv(textureLabel.c_str());
            tdsc.size.width = std::max(1u, tw);
            tdsc.size.height = std::max(1u, th);
            tdsc.size.depthOrArrayLayers = std::max(1u, td);
            tdsc.format = format ? static_cast<WGPUTextureFormat>(format) : WGPUTextureFormat_RGBA8Unorm;
            tdsc.usage = static_cast<WGPUTextureUsage>(usage);
            tdsc.mipLevelCount = std::max(1u, mip);
            tdsc.sampleCount = std::max(1u, sample);
            tdsc.dimension = dim ? static_cast<WGPUTextureDimension>(dim) : WGPUTextureDimension_2D;
            Slot s;
            s.kind = Kind::Texture;
            s.texture = wgpuDeviceCreateTexture(g.device, &tdsc);
            s.texW = tdsc.size.width;
            s.texH = tdsc.size.height;
            s.texD = tdsc.size.depthOrArrayLayers;
            s.texSampleCount = tdsc.sampleCount;
            s.texMipLevels = tdsc.mipLevelCount;
            s.texFormat = tdsc.format;
            s.texUsage = tdsc.usage;
            if (!s.texture) {
                setError("texture create failed");
                return;
            }
            putSlot(handle, std::move(s));
            return;
        }
        case OP_TEX_DESTROY: {
            const uint32_t handle = r.u32();
            auto it = g.slots.find(handle);
            if (it != g.slots.end()) {
                releaseSlot(it->second);
                g.slots.erase(it);
            }
            return;
        }
        case OP_TEX_VIEW: {
            const uint32_t handle = r.u32();
            const uint32_t tex = r.u32();
            const uint32_t format = r.u32();
            const uint32_t viewDim = r.has(4) ? r.u32() : 0;
            const uint32_t aspect = r.u32();
            const uint32_t baseMip = r.u32();
            const uint32_t mipCount = r.u32();
            const uint32_t baseLayer = r.u32();
            const uint32_t layerCount = r.u32();
            Slot* ts = getSlot(tex);
            if (!ts || ts->kind != Kind::Texture || !ts->texture) {
                setError("tex view: bad texture");
                return;
            }
            WGPUTextureViewDescriptor vd{};
            const std::string viewLabel = "ThreeBrowser texture view " + std::to_string(handle) +
                " (texture " + std::to_string(tex) + ")";
            vd.label = twSv(viewLabel.c_str());
            vd.format = format ? static_cast<WGPUTextureFormat>(format) : ts->texFormat;
            vd.dimension = viewDim ? static_cast<WGPUTextureViewDimension>(viewDim)
                                   : WGPUTextureViewDimension_Undefined;
            vd.aspect = aspect ? static_cast<WGPUTextureAspect>(aspect) : WGPUTextureAspect_All;
            vd.baseMipLevel = baseMip;
            vd.mipLevelCount = mipCount ? mipCount : WGPU_MIP_LEVEL_COUNT_UNDEFINED;
            vd.baseArrayLayer = baseLayer;
            vd.arrayLayerCount = layerCount ? layerCount : WGPU_ARRAY_LAYER_COUNT_UNDEFINED;
            Slot s;
            s.kind = Kind::TextureView;
            const uint32_t actualW = wgpuTextureGetWidth(ts->texture);
            const uint32_t actualH = wgpuTextureGetHeight(ts->texture);
            const uint32_t actualD = wgpuTextureGetDepthOrArrayLayers(ts->texture);
            s.texW = std::max(1u, actualW >> std::min(baseMip, 31u));
            s.texH = std::max(1u, actualH >> std::min(baseMip, 31u));
            s.texD = actualD;
            s.texSampleCount = ts->texSampleCount;
            s.texMipLevels = ts->texMipLevels;
            s.textureHandle = tex;
            s.texFormat = vd.format;
            s.texUsage = ts->texUsage;
            s.view = wgpuTextureCreateView(ts->texture, &vd);
            if (!s.view) {
                setError("texture view failed");
                return;
            }
            putSlot(handle, std::move(s));
            return;
        }
        case OP_TEX_WRITE: {
            // JS: handle, mip, x,y,z, w,h,d, bytesPerRow, rowsPerImage, nbytes, pad, data
            const uint32_t handle = r.u32();
            const uint32_t mip = r.has(4) ? r.u32() : 0;
            const uint32_t ox = r.has(4) ? r.u32() : 0;
            const uint32_t oy = r.has(4) ? r.u32() : 0;
            const uint32_t oz = r.has(4) ? r.u32() : 0;
            const uint32_t tw = r.has(4) ? r.u32() : 0;
            const uint32_t th = r.has(4) ? r.u32() : 0;
            const uint32_t td = r.has(4) ? r.u32() : 0;
            const uint32_t bpr = r.has(4) ? r.u32() : 0;
            const uint32_t rpi = r.has(4) ? r.u32() : 0;
            const uint32_t nbytes = r.u32();
            if (r.has(4)) {
                r.u32();
            }
            const uint8_t* data = r.bytes(nbytes);
            Slot* s = getSlot(handle);
            if (!s || s->kind != Kind::Texture || !s->texture || !data || !g.queue) {
                setError("tex write: bad handle");
                return;
            }
            WGPUTexelCopyTextureInfo dst{};
            dst.texture = s->texture;
            dst.mipLevel = mip;
            dst.origin.x = ox;
            dst.origin.y = oy;
            dst.origin.z = oz;
            WGPUTexelCopyBufferLayout layout{};
            layout.bytesPerRow = bpr ? bpr : WGPU_COPY_STRIDE_UNDEFINED;
            layout.rowsPerImage = rpi ? rpi : WGPU_COPY_STRIDE_UNDEFINED;
            WGPUExtent3D extent{};
            extent.width = tw ? tw : s->texW;
            extent.height = th ? th : s->texH;
            extent.depthOrArrayLayers = td ? td : 1;
            wgpuQueueWriteTexture(g.queue, &dst, data, nbytes, &layout, &extent);
            return;
        }
        case OP_SAMP_CREATE: {
            // JS: handle, addrUVW, mag/min/mip, compare, maxAniso, lodMin, lodMax, pad
            const uint32_t handle = r.u32();
            const uint32_t au = r.u32();
            const uint32_t av = r.u32();
            const uint32_t aw = r.u32();
            const uint32_t mag = r.u32();
            const uint32_t minf = r.u32();
            const uint32_t mip = r.u32();
            const uint32_t compare = r.has(4) ? r.u32() : 0;
            const uint32_t aniso = r.has(4) ? r.u32() : 1;
            const float lodMin = r.has(4) ? r.f32() : 0.f;
            const float lodMax = r.has(4) ? r.f32() : 32.f;
            if (!g.device) {
                return;
            }
            WGPUSamplerDescriptor sd{};
            sd.magFilter = filterFrom(mag);
            sd.minFilter = filterFrom(minf);
            sd.mipmapFilter = mipFilterFrom(mip);
            sd.addressModeU = addressFrom(au);
            sd.addressModeV = addressFrom(av);
            sd.addressModeW = addressFrom(aw);
            sd.compare = compare ? static_cast<WGPUCompareFunction>(compare)
                                 : WGPUCompareFunction_Undefined;
            sd.lodMinClamp = lodMin;
            sd.lodMaxClamp = lodMax;
            sd.maxAnisotropy = static_cast<uint16_t>(std::max(1u, aniso));
            Slot s;
            s.kind = Kind::Sampler;
            s.sampler = wgpuDeviceCreateSampler(g.device, &sd);
            if (!s.sampler) {
                setError("sampler create failed");
                return;
            }
            putSlot(handle, std::move(s));
            return;
        }
        case OP_SHADER_CREATE: {
            const uint32_t handle = r.u32();
            const uint32_t nbytes = r.u32();
            const uint8_t* src = r.bytes(nbytes);
            if (!g.device || !src) {
                return;
            }
            Slot s;
            s.kind = Kind::Shader;
            s.wgsl.assign(reinterpret_cast<const char*>(src), nbytes);
            WGPUShaderSourceWGSL wg{};
            wg.chain.sType = WGPUSType_ShaderSourceWGSL;
            wg.code.data = s.wgsl.c_str();
            wg.code.length = s.wgsl.size();
            WGPUShaderModuleDescriptor md{};
            md.nextInChain = &wg.chain;
            s.shader = wgpuDeviceCreateShaderModule(g.device, &md);
            if (!s.shader) {
                setError("shader create failed");
                return;
            }
            putSlot(handle, std::move(s));
            return;
        }
        case OP_BGL_CREATE: {
            const uint32_t handle = r.u32();
            const uint32_t count = r.u32();
            std::vector<WGPUBindGroupLayoutEntry> entries(count);
            for (uint32_t i = 0; i < count; ++i) {
                // JS: binding, visibility, kind, a, b, c
                // kind 0 buffer (type, hasDynamicOffset, minBindingSize)
                // kind 1 sampler (type, 0, 0)
                // kind 2 texture (sampleType, viewDimension, multisampled)
                // kind 3 storageTexture (access, format, viewDimension)
                const uint32_t binding = r.u32();
                const uint32_t vis = r.u32();
                const uint32_t kind = r.u32();
                const uint32_t a = r.u32();
                const uint32_t b = r.u32();
                const uint32_t c = r.u32();
                WGPUBindGroupLayoutEntry e{};
                e.binding = binding;
                e.visibility = vis ? static_cast<WGPUShaderStage>(vis)
                                   : (WGPUShaderStage_Vertex | WGPUShaderStage_Fragment | WGPUShaderStage_Compute);
                if (kind == 1) {
                    e.sampler.type = a ? static_cast<WGPUSamplerBindingType>(a)
                                       : WGPUSamplerBindingType_Filtering;
                } else if (kind == 2) {
                    e.texture.sampleType = a ? static_cast<WGPUTextureSampleType>(a)
                                             : WGPUTextureSampleType_Float;
                    e.texture.viewDimension = b ? static_cast<WGPUTextureViewDimension>(b)
                                                : WGPUTextureViewDimension_2D;
                    e.texture.multisampled = c ? 1 : 0;
                } else if (kind == 3) {
                    e.storageTexture.access = a ? static_cast<WGPUStorageTextureAccess>(a)
                                                : WGPUStorageTextureAccess_WriteOnly;
                    e.storageTexture.format = b ? static_cast<WGPUTextureFormat>(b) : g.surfaceFormat;
                    e.storageTexture.viewDimension = c ? static_cast<WGPUTextureViewDimension>(c)
                                                      : WGPUTextureViewDimension_2D;
                } else {
                    e.buffer.type = a ? static_cast<WGPUBufferBindingType>(a)
                                      : WGPUBufferBindingType_Uniform;
                    e.buffer.hasDynamicOffset = b ? 1 : 0;
                    e.buffer.minBindingSize = c;
                }
                entries[i] = e;
            }
            if (!g.device) {
                return;
            }
            WGPUBindGroupLayoutDescriptor ld{};
            ld.entryCount = entries.size();
            ld.entries = entries.data();
            Slot s;
            s.kind = Kind::BindGroupLayout;
            s.bgl = wgpuDeviceCreateBindGroupLayout(g.device, &ld);
            if (!s.bgl) {
                setError("bind group layout failed");
                return;
            }
            putSlot(handle, std::move(s));
            return;
        }
        case OP_PL_CREATE: {
            const uint32_t handle = r.u32();
            const uint32_t n = r.u32();
            std::vector<WGPUBindGroupLayout> layouts;
            layouts.reserve(n);
            for (uint32_t i = 0; i < n; ++i) {
                const uint32_t id = r.u32();
                Slot* s = getSlot(id);
                if (!s || s->kind != Kind::BindGroupLayout) {
                    setError("pipeline layout: bad bgl");
                    return;
                }
                layouts.push_back(s->bgl);
            }
            WGPUPipelineLayoutDescriptor pd{};
            pd.bindGroupLayoutCount = layouts.size();
            pd.bindGroupLayouts = layouts.data();
            Slot s;
            s.kind = Kind::PipelineLayout;
            s.pl = wgpuDeviceCreatePipelineLayout(g.device, &pd);
            if (!s.pl) {
                setError("pipeline layout failed");
                return;
            }
            putSlot(handle, std::move(s));
            return;
        }
        case OP_CPIPE_CREATE: {
            const uint32_t handle = r.u32();
            const uint32_t layout = r.u32();
            const uint32_t shader = r.u32();
            const uint32_t entryLen = r.u32();
            const uint8_t* entry = r.bytes(entryLen);
            Slot* sh = getSlot(shader);
            if (!sh || sh->kind != Kind::Shader) {
                setError("compute pipeline: bad shader");
                return;
            }
            std::string ep;
            if (entry && entryLen) {
                ep.assign(reinterpret_cast<const char*>(entry), entryLen);
            } else {
                ep = "main";
            }
            WGPUComputePipelineDescriptor cd{};
            if (layout) {
                Slot* ls = getSlot(layout);
                if (ls && ls->kind == Kind::PipelineLayout && ls->pl) {
                    cd.layout = ls->pl;
                }
            }
            ep = pickEntry(sh, ep, "compute");
            cd.compute.module = sh->shader;
            cd.compute.entryPoint = twSv(ep.c_str());
            Slot s;
            s.kind = Kind::ComputePipeline;
            s.cpipe = wgpuDeviceCreateComputePipeline(g.device, &cd);
            if (g.device) {
                wgpuDevicePoll(g.device, 0, nullptr);
            }
            if (!s.cpipe) {
                setError("compute pipeline failed");
                return;
            }
            putSlot(handle, std::move(s));
            return;
        }
        case OP_RPIPE_CREATE: {
            const uint32_t handle = r.u32();
            const uint32_t layout = r.u32();
            const uint32_t vert = r.u32();
            const uint32_t frag = r.u32();
            std::string vsEp = "vs_main";
            std::string fsEp = "fs_main";
            uint32_t topology = 0;
            uint32_t cull = 0;
            uint32_t front = 0;
            uint32_t stripIndex = 0;
            uint32_t format = 0;
            uint32_t depthFmt = 0;
            bool hasDepth = false;
            uint32_t depthWrite = 1;
            uint32_t depthCompare = 2;
            uint32_t sampleCount = 1;
            std::vector<WGPUColorTargetState> targets;
            std::vector<WGPUBlendState> blends;
            std::vector<WGPUVertexBufferLayout> vbLayouts;
            std::vector<std::vector<WGPUVertexAttribute>> vbAttrs;
            if (r.remaining() > 48) {
                vsEp = readPaddedString(r);
                fsEp = readPaddedString(r);
                if (vsEp.empty()) vsEp = "main";
                if (fsEp.empty()) fsEp = "main";
                topology = r.u32();
                cull = r.u32();
                front = r.u32();
                stripIndex = r.u32();
                sampleCount = std::max(1u, r.u32());
                r.u32(); // alphaToCoverage
                r.u32(); // pad
                hasDepth = r.u32() != 0;
                depthFmt = r.u32();
                depthWrite = r.u32();
                depthCompare = r.u32();
                for (int i = 0; i < 4; ++i) r.u32(); // stencil front
                r.u32();
                r.u32();
                const uint32_t colorCount = r.u32();
                targets.resize(colorCount);
                blends.resize(colorCount);
                for (uint32_t i = 0; i < colorCount; ++i) {
                    WGPUTextureFormat tf = static_cast<WGPUTextureFormat>(r.u32());
                    if (!tf || tf == WGPUTextureFormat_BGRA8Unorm ||
                        tf == WGPUTextureFormat_BGRA8UnormSrgb) {
                        tf = g.surfaceFormat;
                    }
                    targets[i].format = tf;
                    targets[i].writeMask = static_cast<WGPUColorWriteMask>(r.u32());
                    const uint32_t hasBlend = r.u32();
                    if (hasBlend) {
                        blends[i].color.srcFactor = static_cast<WGPUBlendFactor>(r.u32());
                        blends[i].color.dstFactor = static_cast<WGPUBlendFactor>(r.u32());
                        blends[i].color.operation = static_cast<WGPUBlendOperation>(r.u32());
                        blends[i].alpha.srcFactor = static_cast<WGPUBlendFactor>(r.u32());
                        blends[i].alpha.dstFactor = static_cast<WGPUBlendFactor>(r.u32());
                        blends[i].alpha.operation = static_cast<WGPUBlendOperation>(r.u32());
                        targets[i].blend = &blends[i];
                    }
                }
                const uint32_t vbCount = r.has(4) ? r.u32() : 0;
                vbLayouts.resize(vbCount);
                vbAttrs.resize(vbCount);
                for (uint32_t i = 0; i < vbCount; ++i) {
                    vbLayouts[i].arrayStride = r.u32();
                    const uint32_t step = r.u32();
                    vbLayouts[i].stepMode = step ? static_cast<WGPUVertexStepMode>(step)
                                                 : WGPUVertexStepMode_Vertex;
                    const uint32_t ac = r.u32();
                    vbAttrs[i].resize(ac);
                    for (uint32_t j = 0; j < ac; ++j) {
                        vbAttrs[i][j].shaderLocation = r.u32();
                        vbAttrs[i][j].offset = r.u32();
                        vbAttrs[i][j].format = static_cast<WGPUVertexFormat>(r.u32());
                    }
                    vbLayouts[i].attributeCount = vbAttrs[i].size();
                    vbLayouts[i].attributes = vbAttrs[i].data();
                }
                if (!targets.empty()) {
                    format = static_cast<uint32_t>(targets[0].format);
                }
            } else {
                topology = r.has(4) ? r.u32() : 0;
                cull = r.has(4) ? r.u32() : 0;
                format = r.has(4) ? r.u32() : 0;
                depthFmt = r.has(4) ? r.u32() : 0;
                hasDepth = depthFmt != 0;
            }
            Slot* vs = getSlot(vert);
            Slot* fs = getSlot(frag ? frag : vert);
            if (!vs || vs->kind != Kind::Shader || !fs || fs->kind != Kind::Shader) {
                setError("render pipeline: bad shader");
                return;
            }
            vsEp = pickEntry(vs, vsEp, "vertex");
            fsEp = pickEntry(fs, fsEp, "fragment");
            if (targets.empty()) {
                targets.resize(1);
                targets[0].format = format ? static_cast<WGPUTextureFormat>(format) : g.surfaceFormat;
                targets[0].writeMask = WGPUColorWriteMask_All;
            }
            WGPUFragmentState fragSt{};
            fragSt.module = fs->shader;
            fragSt.entryPoint = twSv(fsEp.c_str());
            fragSt.targetCount = targets.size();
            fragSt.targets = targets.data();
            WGPUDepthStencilState ds{};
            ds.format = static_cast<WGPUTextureFormat>(depthFmt);
            ds.depthWriteEnabled = depthWrite ? WGPUOptionalBool_True : WGPUOptionalBool_False;
            ds.depthCompare = depthCompare ? static_cast<WGPUCompareFunction>(depthCompare)
                                           : WGPUCompareFunction_Less;
            ds.stencilReadMask = 0xFFFFFFFFu;
            ds.stencilWriteMask = 0xFFFFFFFFu;
            WGPURenderPipelineDescriptor pd{};
            if (layout) {
                Slot* ls = getSlot(layout);
                if (ls && ls->kind == Kind::PipelineLayout && ls->pl) {
                    pd.layout = ls->pl;
                }
            }
            pd.vertex.module = vs->shader;
            pd.vertex.entryPoint = twSv(vsEp.c_str());
            pd.vertex.bufferCount = vbLayouts.size();
            pd.vertex.buffers = vbLayouts.empty() ? nullptr : vbLayouts.data();
            pd.fragment = &fragSt;
            pd.primitive.topology = topologyFrom(topology);
            pd.primitive.cullMode = cullFrom(cull);
            pd.primitive.frontFace = front ? static_cast<WGPUFrontFace>(front) : WGPUFrontFace_CCW;
            pd.primitive.stripIndexFormat = stripIndex ? static_cast<WGPUIndexFormat>(stripIndex)
                                                       : WGPUIndexFormat_Undefined;
            pd.multisample.count = sampleCount;
            pd.multisample.mask = 0xFFFFFFFFu;
            if (hasDepth && depthFmt) {
                pd.depthStencil = &ds;
            }
            Slot s;
            s.kind = Kind::RenderPipeline;
            const uint64_t errorsBefore = g.validationErrors.load(std::memory_order_relaxed);
            s.rpipe = wgpuDeviceCreateRenderPipeline(g.device, &pd);
            if (g.device) {
                // wgpu-native can return a non-null invalid pipeline and report
                // the validation error only while the device is polled. Never
                // retain that handle: submitting it aborts inside wgpuQueueSubmit.
                wgpuDevicePoll(g.device, 0, nullptr);
            }
            if (!s.rpipe || g.validationErrors.load(std::memory_order_relaxed) != errorsBefore) {
                if (s.rpipe) wgpuRenderPipelineRelease(s.rpipe);
                setError("render pipeline failed validation");
                return;
            }
            putSlot(handle, std::move(s));
            return;
        }
        case OP_BG_CREATE: {
            const uint32_t handle = r.u32();
            const uint32_t layout = r.u32();
            const uint32_t count = r.u32();
            Slot* ls = getSlot(layout);
            if (!ls || ls->kind != Kind::BindGroupLayout) {
                setError("bind group: bad layout");
                return;
            }
            std::vector<WGPUBindGroupEntry> entries(count);
            for (uint32_t i = 0; i < count; ++i) {
                // JS: binding, kind, resource, offset u32, size u32
                const uint32_t binding = r.u32();
                const uint32_t kind = r.u32();
                const uint32_t res = r.u32();
                const uint32_t off = r.has(4) ? r.u32() : 0;
                const uint32_t sz = r.has(4) ? r.u32() : 0;
                WGPUBindGroupEntry e{};
                e.binding = binding;
                e.size = sz ? sz : WGPU_WHOLE_SIZE;
                e.offset = off;
                Slot* rs = getSlot(res);
                if (!rs) {
                    setError("bind group: bad resource");
                    return;
                }
                if (kind == BG_SAMP || rs->kind == Kind::Sampler) {
                    e.sampler = rs->sampler;
                } else if (kind == BG_VIEW || rs->kind == Kind::TextureView) {
                    e.textureView = rs->view;
                } else {
                    e.buffer = rs->buffer;
                }
                entries[i] = e;
            }
            WGPUBindGroupDescriptor bd{};
            bd.layout = ls->bgl;
            bd.entryCount = entries.size();
            bd.entries = entries.data();
            Slot s;
            s.kind = Kind::BindGroup;
            const uint64_t errorsBefore = g.validationErrors.load(std::memory_order_relaxed);
            s.bg = wgpuDeviceCreateBindGroup(g.device, &bd);
            if (g.device) wgpuDevicePoll(g.device, 1, nullptr);
            if (!s.bg || g.validationErrors.load(std::memory_order_relaxed) != errorsBefore) {
                if (s.bg) wgpuBindGroupRelease(s.bg);
                setError("bind group failed");
                return;
            }
            putSlot(handle, std::move(s));
            return;
        }
        case OP_ENC_BEGIN: {
            const uint32_t handle = r.u32();
            if (!g.device) {
                return;
            }
            endPasses();
            if (g.currentEncoder && g.currentEncoderHandle != handle) {
                wgpuCommandEncoderRelease(g.currentEncoder);
                g.currentEncoder = nullptr;
                g.currentEncoderUsesSurface = false;
            }
            WGPUCommandEncoderDescriptor ed{};
            Slot s;
            s.kind = Kind::Encoder;
            s.encoder = wgpuDeviceCreateCommandEncoder(g.device, &ed);
            g.currentEncoder = s.encoder;
            g.currentEncoderHandle = handle;
            g.currentEncoderUsesSurface = false;
            putSlot(handle, std::move(s));
            return;
        }
        case OP_COMPUTE_BEGIN: {
            const uint32_t enc = r.u32();
            Slot* s = getSlot(enc);
            WGPUCommandEncoder encoder = (s && s->kind == Kind::Encoder) ? s->encoder : g.currentEncoder;
            if (!encoder) {
                setError("compute begin: no encoder");
                return;
            }
            if (g.computePass) {
                wgpuComputePassEncoderEnd(g.computePass);
                wgpuComputePassEncoderRelease(g.computePass);
            }
            WGPUComputePassDescriptor pd{};
            g.computePass = wgpuCommandEncoderBeginComputePass(encoder, &pd);
            g.computePipelineSet = false;
            return;
        }
        case OP_COMPUTE_PIPE: {
            r.u32(); // encoder
            const uint32_t pipe = r.u32();
            Slot* s = getSlot(pipe);
            if (!g.computePass || !s || s->kind != Kind::ComputePipeline) {
                setError("compute pipe: bad state");
                g.computePipelineSet = false;
                return;
            }
            wgpuComputePassEncoderSetPipeline(g.computePass, s->cpipe);
            g.computePipelineSet = true;
            return;
        }
        case OP_COMPUTE_BG: {
            r.u32(); // encoder
            const uint32_t index = r.u32();
            const uint32_t bg = r.u32();
            const uint32_t dynamicCount = r.u32();
            std::vector<uint32_t> dynamicOffsets(dynamicCount);
            for (uint32_t i = 0; i < dynamicCount; ++i) dynamicOffsets[i] = r.u32();
            Slot* s = getSlot(bg);
            if (!g.computePass || !s || s->kind != Kind::BindGroup) {
                setError("compute bg: bad state");
                return;
            }
            wgpuComputePassEncoderSetBindGroup(g.computePass, index, s->bg,
                                               dynamicOffsets.size(), dynamicOffsets.data());
            return;
        }
        case OP_DISPATCH: {
            r.u32(); // encoder
            const uint32_t x = r.u32();
            const uint32_t y = r.u32();
            const uint32_t z = r.u32();
            if (!g.computePass || !g.computePipelineSet) {
                setError("dispatch: no valid compute pipeline");
                return;
            }
            wgpuComputePassEncoderDispatchWorkgroups(g.computePass, x, y, z);
            return;
        }
        case OP_COMPUTE_END:
            if (g.computePass) {
                wgpuComputePassEncoderEnd(g.computePass);
                wgpuComputePassEncoderRelease(g.computePass);
                g.computePass = nullptr;
            }
            g.computePipelineSet = false;
            return;
        case OP_RENDER_BEGIN: {
            g.renderPipelineSet = false;
            g.skipRenderPass = false;
            struct ColorInput {
                uint32_t view = 0;
                uint32_t resolve = 0xffffffffu;
                uint32_t load = 2;
                uint32_t store = 1;
                float r = 0.f, g = 0.f, b = 0.f, a = 1.f;
            };
            std::vector<ColorInput> colorInputs;
            uint32_t depthView = 0;
            uint32_t depthLoad = 2, depthStore = 1;
            float depthClear = 1.f;
            uint32_t stencilLoad = 0, stencilStore = 0, stencilClear = 0;
            endPasses();
            if (r.remaining() >= 40) {
                // JS: encoder, colorCount, depthView, depthLoad, depthStore,
                // depthClear, stencilLoad, stencilStore, stencilClear, hasDepth,
                // then colors: view, resolve, load, store, r,g,b,a
                r.u32(); // encoder
                const uint32_t colorCount = r.u32();
                depthView = r.u32();
                depthLoad = r.u32();
                depthStore = r.u32();
                depthClear = r.f32();
                stencilLoad = r.u32();
                stencilStore = r.u32();
                stencilClear = r.u32();
                r.u32();
                if (colorCount > 0 && colorCount < 8 && r.remaining() >= colorCount * 32u) {
                    colorInputs.resize(colorCount);
                    for (auto& color : colorInputs) {
                        color.view = r.u32();
                        color.resolve = r.u32();
                        color.load = r.u32();
                        color.store = r.u32();
                        color.r = r.f32();
                        color.g = r.f32();
                        color.b = r.f32();
                        color.a = r.f32();
                    }
                }
            } else {
                ColorInput color;
                color.view = r.u32();
                depthView = r.u32();
                color.r = r.f32();
                color.g = r.f32();
                color.b = r.f32();
                color.a = r.f32();
                color.load = r.has(4) ? r.u32() : 0;
                colorInputs.push_back(color);
            }
            if (colorInputs.empty()) {
                setError("render begin: no color attachments");
                return;
            }
            const bool usesSwapchain = std::any_of(colorInputs.begin(), colorInputs.end(), [](const ColorInput& color) {
                return color.view == 0 || (color.view != 0 && color.resolve == 0);
            });
            if (g.resizeHoldFrames > 0 && usesSwapchain) {
                // A page may record several passes before its next present.
                // Hold only swapchain work until complete animation frames
                // have elapsed with a stable canvas size. Offscreen work can
                // be one-shot startup content (PMREM, LUTs, shadow caches), so
                // dropping it here leaves those textures permanently empty.
                g.skipRenderPass = true;
                return;
            }
            WGPUCommandEncoder encoder = ensureEncoder();
            if (!encoder) {
                setError("render begin: no encoder");
                return;
            }
            auto viewSize = [](uint32_t handle, uint32_t& width, uint32_t& height) {
                if (handle == 0) {
                    width = g.config.width;
                    height = g.config.height;
                    return width != 0 && height != 0;
                }
                Slot* slot = getSlot(handle);
                if (!slot || slot->kind != Kind::TextureView || !slot->view) {
                    return false;
                }
                width = slot->texW;
                height = slot->texH;
                return width != 0 && height != 0;
            };
            uint32_t depthW = 0, depthH = 0;
            const bool hasDepthSize = depthView != 0 && viewSize(depthView, depthW, depthH);
            const uint32_t primaryColorView = colorInputs.front().view;
            uint32_t colorW = 0, colorH = 0;
            const bool hasOffscreenColorSize = primaryColorView != 0 && viewSize(primaryColorView, colorW, colorH);
            uint32_t frameW = hasOffscreenColorSize ? colorW : (hasDepthSize ? depthW : 0);
            uint32_t frameH = hasOffscreenColorSize ? colorH : (hasDepthSize ? depthH : 0);
            if (frameW == 0 || frameH == 0) {
                frameW = g.pendingResizeW > 0 ? static_cast<uint32_t>(g.pendingResizeW) : g.config.width;
                frameH = g.pendingResizeH > 0 ? static_cast<uint32_t>(g.pendingResizeH) : g.config.height;
            }
            if (usesSwapchain && frameW != 0 && frameH != 0 &&
                (g.config.width != frameW || g.config.height != frameH)) {
                configureSurface(static_cast<int>(frameW), static_cast<int>(frameH));
            }
            if (g.pendingResizeW == static_cast<int>(frameW) &&
                g.pendingResizeH == static_cast<int>(frameH)) {
                g.pendingResizeW = 0;
                g.pendingResizeH = 0;
            }
            if (primaryColorView == 0) {
                colorW = g.config.width;
                colorH = g.config.height;
            } else if (!hasOffscreenColorSize) {
                colorW = g.config.width;
                colorH = g.config.height;
            }
            bool attachmentMismatch = hasDepthSize && (depthW != colorW || depthH != colorH);
            for (const auto& color : colorInputs) {
                uint32_t width = 0, height = 0;
                if (color.view != 0 && (!viewSize(color.view, width, height) || width != colorW || height != colorH)) {
                    attachmentMismatch = true;
                }
                if (color.resolve != 0xffffffffu && color.resolve != 0 &&
                    (!viewSize(color.resolve, width, height) || width != colorW || height != colorH)) {
                    attachmentMismatch = true;
                }
            }
            if (attachmentMismatch) {
                // A resize can occur between the page rebuilding attachments
                // and acquiring the swapchain texture. Skip only this frame;
                // passing mismatched views to wgpu aborts at encoder finish.
                g.skipRenderPass = true;
                return;
            }
            std::vector<WGPURenderPassColorAttachment> colorAttachments(colorInputs.size());
            for (size_t i = 0; i < colorInputs.size(); ++i) {
                const auto& input = colorInputs[i];
                auto& attachment = colorAttachments[i];
                attachment.view = viewFromHandle(input.view, input.view == 0);
                if (!attachment.view) {
                    setError("render begin: no color view");
                    g.skipRenderPass = true;
                    return;
                }
                if (input.resolve != 0xffffffffu) attachment.resolveTarget = viewFromHandle(input.resolve, input.resolve == 0);
                attachment.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
                attachment.loadOp = loadOpFrom(input.load);
                attachment.storeOp = attachment.resolveTarget ? WGPUStoreOp_Discard :
                    (input.store ? WGPUStoreOp_Store : WGPUStoreOp_Discard);
                attachment.clearValue = {input.r, input.g, input.b, input.a};
            }
            WGPURenderPassDepthStencilAttachment da{};
            WGPUTextureView dv = viewFromHandle(depthView, false);
            if (dv) {
                da.view = dv;
                da.depthLoadOp = loadOpFrom(depthLoad);
                da.depthStoreOp = depthStore ? WGPUStoreOp_Store : WGPUStoreOp_Discard;
                da.depthClearValue = depthClear;
                da.stencilLoadOp = stencilLoad ? loadOpFrom(stencilLoad) : WGPULoadOp_Undefined;
                da.stencilStoreOp = stencilStore ? WGPUStoreOp_Store : WGPUStoreOp_Undefined;
                da.stencilClearValue = stencilClear;
            }
            WGPURenderPassDescriptor rd{};
            std::string passLabel = "ThreeBrowser render pass colors";
            for (const auto& input : colorInputs) {
                passLabel += " " + std::to_string(input.view);
                if (input.resolve != 0xffffffffu) {
                    passLabel += "->" + std::to_string(input.resolve);
                }
            }
            if (depthView) passLabel += " depth " + std::to_string(depthView);
            rd.label = twSv(passLabel.c_str());
            rd.colorAttachmentCount = colorAttachments.size();
            rd.colorAttachments = colorAttachments.data();
            if (dv) {
                rd.depthStencilAttachment = &da;
            }
            g.renderPass = wgpuCommandEncoderBeginRenderPass(encoder, &rd);
            if (!g.renderPass) {
                char buf[128];
                std::snprintf(buf, sizeof(buf),
                              "render begin failed color=%u resolve=%u depth=%u",
                              primaryColorView, colorInputs.front().resolve, depthView);
                setError(buf);
            } else if (usesSwapchain) {
                g.currentEncoderUsesSurface = true;
                g.activeRenderPassUsesSurface = true;
                g.activeRenderPassSampleCount = 1;
                g.activeRenderPassWidth = static_cast<int>(colorW);
                g.activeRenderPassHeight = static_cast<int>(colorH);
                if (primaryColorView != 0) {
                    if (Slot* colorSlot = getSlot(primaryColorView)) {
                        g.activeRenderPassSampleCount = std::max(1u, colorSlot->texSampleCount);
                    }
                }
                g.activeRenderPassDepthFormat = WGPUTextureFormat_Undefined;
                if (depthView != 0) {
                    if (Slot* depthSlot = getSlot(depthView)) {
                        g.activeRenderPassDepthFormat = depthSlot->texFormat;
                    }
                }
            }
            return;
        }
        case OP_RENDER_PIPE: {
            r.u32(); // encoder
            const uint32_t pipe = r.u32();
            if (g.skipRenderPass) {
                return;
            }
            Slot* s = getSlot(pipe);
            if (!g.renderPass || !s || s->kind != Kind::RenderPipeline || !s->rpipe) {
                char buf[128];
                std::snprintf(buf, sizeof(buf), "render pipe: bad state pipe=%u pass=%u kind=%u",
                              pipe, g.renderPass ? 1u : 0u,
                              s ? static_cast<unsigned>(s->kind) : 0u);
                setError(buf);
                g.skipRenderPass = true;
                return;
            }
            wgpuRenderPassEncoderSetPipeline(g.renderPass, s->rpipe);
            g.renderPipelineSet = true;
            return;
        }
        case OP_RENDER_BG: {
            r.u32(); // encoder
            const uint32_t index = r.u32();
            const uint32_t bg = r.u32();
            const uint32_t dynamicCount = r.u32();
            std::vector<uint32_t> dynamicOffsets(dynamicCount);
            for (uint32_t i = 0; i < dynamicCount; ++i) dynamicOffsets[i] = r.u32();
            if (g.skipRenderPass) {
                return;
            }
            Slot* s = getSlot(bg);
            if (!g.renderPass || !s || s->kind != Kind::BindGroup || !s->bg) {
                setError("render bg: bad state");
                g.skipRenderPass = true;
                return;
            }
            wgpuRenderPassEncoderSetBindGroup(g.renderPass, index, s->bg,
                                              dynamicOffsets.size(), dynamicOffsets.data());
            return;
        }
        case OP_SET_VERTEX: {
            r.u32(); // encoder
            const uint32_t slot = r.u32();
            const uint32_t buffer = r.u32();
            const uint32_t offset32 = r.has(4) ? r.u32() : 0;
            const uint32_t size32 = r.has(4) ? r.u32() : 0;
            const uint64_t offset = offset32;
            if (g.skipRenderPass) {
                return;
            }
            Slot* s = getSlot(buffer);
            if (!g.renderPass || !s || s->kind != Kind::Buffer) {
                setError("set vertex: bad state");
                return;
            }
            wgpuRenderPassEncoderSetVertexBuffer(g.renderPass, slot, s->buffer, offset,
                                                 size32 ? size32 : WGPU_WHOLE_SIZE);
            return;
        }
        case OP_SET_INDEX: {
            r.u32(); // encoder
            const uint32_t buffer = r.u32();
            const uint32_t format = r.u32();
            const uint32_t offset32 = r.has(4) ? r.u32() : 0;
            const uint32_t size32 = r.has(4) ? r.u32() : 0;
            const uint64_t offset = offset32;
            if (g.skipRenderPass) {
                return;
            }
            Slot* s = getSlot(buffer);
            if (!g.renderPass || !s || s->kind != Kind::Buffer) {
                setError("set index: bad state");
                return;
            }
            const WGPUIndexFormat fmt = format ? static_cast<WGPUIndexFormat>(format) : WGPUIndexFormat_Uint16;
            wgpuRenderPassEncoderSetIndexBuffer(g.renderPass, s->buffer, fmt, offset,
                                                size32 ? size32 : WGPU_WHOLE_SIZE);
            return;
        }
        case OP_DRAW: {
            r.u32(); // encoder
            const uint32_t vc = r.u32();
            const uint32_t ic = r.has(4) ? r.u32() : 1;
            const uint32_t fv = r.has(4) ? r.u32() : 0;
            const uint32_t fi = r.has(4) ? r.u32() : 0;
            if (g.skipRenderPass) {
                return;
            }
            if (!g.renderPass || !g.renderPipelineSet) {
                setError("draw: no valid render pipeline");
                return;
            }
            wgpuRenderPassEncoderDraw(g.renderPass, vc, ic ? ic : 1, fv, fi);
            return;
        }
        case OP_DRAW_INDEXED: {
            r.u32(); // encoder
            const uint32_t ic = r.u32();
            const uint32_t inst = r.has(4) ? r.u32() : 1;
            const uint32_t first = r.has(4) ? r.u32() : 0;
            const int32_t base = r.has(4) ? static_cast<int32_t>(r.u32()) : 0;
            const uint32_t fi = r.has(4) ? r.u32() : 0;
            if (g.skipRenderPass) {
                return;
            }
            if (!g.renderPass || !g.renderPipelineSet) {
                setError("draw indexed: no valid render pipeline");
                return;
            }
            wgpuRenderPassEncoderDrawIndexed(g.renderPass, ic, inst ? inst : 1, first, base, fi);
            return;
        }
        case OP_SET_VIEWPORT: {
            r.u32(); // encoder
            const float x = r.f32();
            const float y = r.f32();
            const float width = r.f32();
            const float height = r.f32();
            const float minDepth = r.f32();
            const float maxDepth = r.f32();
            if (!g.renderPass) { setError("set viewport: no render pass"); return; }
            wgpuRenderPassEncoderSetViewport(g.renderPass, x, y, width, height, minDepth, maxDepth);
            return;
        }
        case OP_SET_SCISSOR: {
            r.u32(); // encoder
            const uint32_t x = r.u32();
            const uint32_t y = r.u32();
            const uint32_t width = r.u32();
            const uint32_t height = r.u32();
            if (!g.renderPass) { setError("set scissor: no render pass"); return; }
            wgpuRenderPassEncoderSetScissorRect(g.renderPass, x, y, width, height);
            return;
        }
        case OP_SET_STENCIL: {
            r.u32(); // encoder
            const uint32_t reference = r.u32();
            if (!g.renderPass) { setError("set stencil: no render pass"); return; }
            wgpuRenderPassEncoderSetStencilReference(g.renderPass, reference);
            return;
        }
        case OP_SET_BLEND: {
            r.u32(); // encoder
            WGPUColor color{};
            color.r = r.f32(); color.g = r.f32(); color.b = r.f32(); color.a = r.f32();
            if (!g.renderPass) { setError("set blend: no render pass"); return; }
            wgpuRenderPassEncoderSetBlendConstant(g.renderPass, &color);
            return;
        }
        case OP_DRAW_INDIRECT:
        case OP_DRAW_INDEXED_INDIRECT: {
            r.u32(); // encoder
            const uint32_t buffer = r.u32();
            const uint64_t offset = r.u32();
            if (g.skipRenderPass) {
                return;
            }
            Slot* s = getSlot(buffer);
            if (!g.renderPass || !g.renderPipelineSet || !s || s->kind != Kind::Buffer) {
                setError("draw indirect: bad state");
                return;
            }
            if (op == OP_DRAW_INDEXED_INDIRECT) {
                wgpuRenderPassEncoderDrawIndexedIndirect(g.renderPass, s->buffer, offset);
            } else {
                wgpuRenderPassEncoderDrawIndirect(g.renderPass, s->buffer, offset);
            }
            return;
        }
        case OP_RENDER_END:
            if (g.renderPass) {
                if (g.activeRenderPassUsesSurface && drawOverlayInPass(g.renderPass)) {
                    g.overlayRecordedForCurrentTexture = true;
                }
                wgpuRenderPassEncoderEnd(g.renderPass);
                wgpuRenderPassEncoderRelease(g.renderPass);
                g.renderPass = nullptr;
            }
            g.activeRenderPassUsesSurface = false;
            g.activeRenderPassSampleCount = 1;
            g.activeRenderPassDepthFormat = WGPUTextureFormat_Undefined;
            g.activeRenderPassWidth = 0;
            g.activeRenderPassHeight = 0;
            g.renderPipelineSet = false;
            g.skipRenderPass = false;
            return;
        case OP_DLSS_EVALUATE: {
            TWDLSSFrame frame{};
            frame.struct_size = sizeof(frame);
            frame.command_encoder_handle = r.u32();
            frame.viewport = r.u32();
            auto readResource = [&r](TWDLSSResource& resource) {
                resource.texture_handle = r.u32();
                resource.vulkan_layout = r.u32();
                resource.left = r.u32();
                resource.top = r.u32();
                resource.width = r.u32();
                resource.height = r.u32();
            };
            readResource(frame.color_input);
            readResource(frame.color_output);
            readResource(frame.depth);
            readResource(frame.motion_vectors);
            readResource(frame.exposure);
            frame.has_exposure = static_cast<int>(r.u32());
            auto readFloats = [&r](float* values, uint32_t count) {
                for (uint32_t i = 0; i < count; ++i) values[i] = r.f32();
            };
            readFloats(frame.constants.camera_view_to_clip, 16);
            readFloats(frame.constants.clip_to_camera_view, 16);
            readFloats(frame.constants.clip_to_lens_clip, 16);
            readFloats(frame.constants.clip_to_prev_clip, 16);
            readFloats(frame.constants.prev_clip_to_clip, 16);
            readFloats(frame.constants.jitter_offset, 2);
            readFloats(frame.constants.motion_vector_scale, 2);
            readFloats(frame.constants.camera_pinhole_offset, 2);
            readFloats(frame.constants.camera_position, 3);
            readFloats(frame.constants.camera_up, 3);
            readFloats(frame.constants.camera_right, 3);
            readFloats(frame.constants.camera_forward, 3);
            frame.constants.camera_near = r.f32();
            frame.constants.camera_far = r.f32();
            frame.constants.camera_fov = r.f32();
            frame.constants.camera_aspect_ratio = r.f32();
            frame.constants.depth_inverted = static_cast<int>(r.u32());
            frame.constants.camera_motion_included = static_cast<int>(r.u32());
            frame.constants.motion_vectors_3d = static_cast<int>(r.u32());
            frame.constants.reset = static_cast<int>(r.u32());
            frame.constants.orthographic_projection = static_cast<int>(r.u32());
            frame.constants.motion_vectors_dilated = static_cast<int>(r.u32());
            frame.constants.motion_vectors_jittered = static_cast<int>(r.u32());
            if (!r.ok) {
                setError("DLSS command payload is truncated");
                return;
            }
            // This call is executing on the native worker, after OP_ENC_BEGIN and
            // before OP_SUBMIT, so encoder/resource lifetime and ordering match WebGPU.
            tw_dlss_evaluate(&frame);
            return;
        }
        case OP_DLSSG_TAG: {
            TWFrameGenerationFrame frame{};
            frame.struct_size = sizeof(frame);
            frame.command_encoder_handle = r.u32();
            frame.viewport = r.u32();
            auto readResource = [&r](TWDLSSResource& resource) {
                resource.texture_handle = r.u32();
                resource.vulkan_layout = r.u32();
                resource.left = r.u32();
                resource.top = r.u32();
                resource.width = r.u32();
                resource.height = r.u32();
            };
            readResource(frame.hudless_color);
            readResource(frame.depth);
            readResource(frame.motion_vectors);
            readResource(frame.ui);
            frame.has_ui = static_cast<int>(r.u32());
            frame.ui_alpha_only = static_cast<int>(r.u32());
            frame.frames_to_generate = r.u32();
            auto readFloats = [&r](float* values, uint32_t count) {
                for (uint32_t i = 0; i < count; ++i) values[i] = r.f32();
            };
            readFloats(frame.constants.camera_view_to_clip, 16);
            readFloats(frame.constants.clip_to_camera_view, 16);
            readFloats(frame.constants.clip_to_lens_clip, 16);
            readFloats(frame.constants.clip_to_prev_clip, 16);
            readFloats(frame.constants.prev_clip_to_clip, 16);
            readFloats(frame.constants.jitter_offset, 2);
            readFloats(frame.constants.motion_vector_scale, 2);
            readFloats(frame.constants.camera_pinhole_offset, 2);
            readFloats(frame.constants.camera_position, 3);
            readFloats(frame.constants.camera_up, 3);
            readFloats(frame.constants.camera_right, 3);
            readFloats(frame.constants.camera_forward, 3);
            frame.constants.camera_near = r.f32();
            frame.constants.camera_far = r.f32();
            frame.constants.camera_fov = r.f32();
            frame.constants.camera_aspect_ratio = r.f32();
            frame.constants.depth_inverted = static_cast<int>(r.u32());
            frame.constants.camera_motion_included = static_cast<int>(r.u32());
            frame.constants.motion_vectors_3d = static_cast<int>(r.u32());
            frame.constants.reset = static_cast<int>(r.u32());
            frame.constants.orthographic_projection = static_cast<int>(r.u32());
            frame.constants.motion_vectors_dilated = static_cast<int>(r.u32());
            frame.constants.motion_vectors_jittered = static_cast<int>(r.u32());
            if (!r.ok) {
                setError("DLSS Frame Generation command payload is truncated");
                return;
            }
            tw_frame_generation_tag(&frame);
            return;
        }
        case OP_RAY_RECONSTRUCTION_EVALUATE: {
            TWRayReconstructionFrame frame{};
            frame.struct_size = sizeof(frame);
            frame.command_encoder_handle = r.u32();
            frame.viewport = r.u32();
            auto readResource = [&r](TWDLSSResource& resource) {
                resource.texture_handle = r.u32();
                resource.vulkan_layout = r.u32();
                resource.left = r.u32();
                resource.top = r.u32();
                resource.width = r.u32();
                resource.height = r.u32();
            };
            readResource(frame.noisy_color);
            readResource(frame.color_output);
            readResource(frame.depth);
            readResource(frame.motion_vectors);
            readResource(frame.diffuse_albedo);
            readResource(frame.specular_albedo);
            readResource(frame.normal_roughness);
            readResource(frame.roughness);
            readResource(frame.specular_motion_vectors);
            readResource(frame.specular_hit_distance);
            frame.normal_roughness_packed = static_cast<int>(r.u32());
            frame.has_roughness = static_cast<int>(r.u32());
            frame.has_specular_motion_vectors = static_cast<int>(r.u32());
            frame.has_specular_hit_distance = static_cast<int>(r.u32());
            auto readFloats = [&r](float* values, uint32_t count) {
                for (uint32_t i = 0; i < count; ++i) values[i] = r.f32();
            };
            readFloats(frame.world_to_camera_view, 16);
            readFloats(frame.camera_view_to_world, 16);
            readFloats(frame.constants.camera_view_to_clip, 16);
            readFloats(frame.constants.clip_to_camera_view, 16);
            readFloats(frame.constants.clip_to_lens_clip, 16);
            readFloats(frame.constants.clip_to_prev_clip, 16);
            readFloats(frame.constants.prev_clip_to_clip, 16);
            readFloats(frame.constants.jitter_offset, 2);
            readFloats(frame.constants.motion_vector_scale, 2);
            readFloats(frame.constants.camera_pinhole_offset, 2);
            readFloats(frame.constants.camera_position, 3);
            readFloats(frame.constants.camera_up, 3);
            readFloats(frame.constants.camera_right, 3);
            readFloats(frame.constants.camera_forward, 3);
            frame.constants.camera_near = r.f32();
            frame.constants.camera_far = r.f32();
            frame.constants.camera_fov = r.f32();
            frame.constants.camera_aspect_ratio = r.f32();
            frame.constants.depth_inverted = static_cast<int>(r.u32());
            frame.constants.camera_motion_included = static_cast<int>(r.u32());
            frame.constants.motion_vectors_3d = static_cast<int>(r.u32());
            frame.constants.reset = static_cast<int>(r.u32());
            frame.constants.orthographic_projection = static_cast<int>(r.u32());
            frame.constants.motion_vectors_dilated = static_cast<int>(r.u32());
            frame.constants.motion_vectors_jittered = static_cast<int>(r.u32());
            if (!r.ok) {
                setError("DLSS Ray Reconstruction command payload is truncated");
                return;
            }
            tw_ray_reconstruction_evaluate(&frame);
            return;
        }
        case OP_RTX_SCENE_BEGIN: {
            const uint32_t version = r.u32();
            if (!r.ok || version != 1u) {
                setError("Unsupported or truncated RTX scene-begin command");
                return;
            }
            tw_ray_query_scene_begin();
            return;
        }
        case OP_RTX_SCENE_POSITIONS: {
            const uint32_t version = r.u32();
            const uint32_t vertexCount = r.u32();
            if (!r.ok || version != 1u || vertexCount == 0u ||
                static_cast<uint64_t>(vertexCount) * 12ull > r.remaining()) {
                setError("Unsupported or truncated RTX position chunk");
                return;
            }
            std::vector<float> positions(static_cast<std::size_t>(vertexCount) * 3u);
            for (float& value : positions) value = r.f32();
            if (!r.ok || !tw_ray_query_scene_positions(positions.data(), vertexCount)) {
                if (!r.ok) setError("RTX position chunk ended before vertexCount");
                return;
            }
            return;
        }
        case OP_RTX_SCENE_INDICES: {
            const uint32_t version = r.u32();
            const uint32_t indexCount = r.u32();
            if (!r.ok || version != 1u || indexCount == 0u || indexCount % 3u != 0u ||
                static_cast<uint64_t>(indexCount) * 4ull > r.remaining()) {
                setError("Unsupported, unaligned or truncated RTX index chunk");
                return;
            }
            std::vector<uint32_t> indices(indexCount);
            for (uint32_t& value : indices) value = r.u32();
            if (!r.ok || !tw_ray_query_scene_indices(indices.data(), indexCount)) {
                if (!r.ok) setError("RTX index chunk ended before indexCount");
                return;
            }
            return;
        }
        case OP_RTX_SCENE_TRIANGLE_RADIANCE: {
            const uint32_t version = r.u32();
            const uint32_t triangleCount = r.u32();
            if (!r.ok || version != 1u || triangleCount == 0u ||
                static_cast<uint64_t>(triangleCount) * 16ull > r.remaining()) {
                setError("Unsupported or truncated RTX triangle-radiance chunk");
                return;
            }
            std::vector<float> radiance(static_cast<std::size_t>(triangleCount) * 4u);
            for (float& value : radiance) value = r.f32();
            if (!r.ok || !tw_ray_query_scene_triangle_radiance(
                    radiance.data(), triangleCount)) {
                if (!r.ok) setError("RTX triangle-radiance chunk ended before triangleCount");
                return;
            }
            return;
        }
        case OP_RTX_SCENE_TRIANGLE_SURFACE: {
            const uint32_t version = r.u32();
            const uint32_t triangleCount = r.u32();
            if (!r.ok || version != 1u || triangleCount == 0u ||
                static_cast<uint64_t>(triangleCount) * 16ull > r.remaining()) {
                setError("Unsupported or truncated RTX triangle-surface chunk");
                return;
            }
            std::vector<float> surface(static_cast<std::size_t>(triangleCount) * 4u);
            for (float& value : surface) value = r.f32();
            if (!r.ok || !tw_ray_query_scene_triangle_surface(
                    surface.data(), triangleCount)) {
                if (!r.ok) setError("RTX triangle-surface chunk ended before triangleCount");
                return;
            }
            return;
        }
        case OP_RTX_SCENE_LIGHTS: {
            const uint32_t version = r.u32();
            const uint32_t lightCount = r.u32();
            if (!r.ok || version != 1u || lightCount == 0u || lightCount > 8u ||
                static_cast<uint64_t>(lightCount) * 64ull > r.remaining()) {
                setError("Unsupported or truncated RTX static-light payload");
                return;
            }
            std::vector<float> lights(static_cast<std::size_t>(lightCount) * 16u);
            for (float& value : lights) value = r.f32();
            if (!r.ok || !tw_ray_query_scene_lights(lights.data(), lightCount)) {
                if (!r.ok) setError("RTX static-light payload ended before lightCount");
                return;
            }
            return;
        }
        case OP_RTX_SCENE_INSTANCE_GROUP: {
            const uint32_t version = r.u32();
            const uint32_t id = r.u32();
            const uint32_t capacity = r.u32();
            const uint32_t vertexOffset = r.u32();
            const uint32_t vertexCount = r.u32();
            const uint32_t indexOffset = r.u32();
            const uint32_t indexCount = r.u32();
            const uint32_t primitiveBase = r.u32();
            if (!r.ok || version != 1u || id == 0u || capacity == 0u ||
                capacity > 1024u || vertexCount == 0u || indexCount == 0u ||
                indexCount % 3u != 0u || r.remaining() != 0u) {
                setError("Unsupported or malformed RTX instance-group descriptor");
                return;
            }
            tw_ray_query_scene_instance_group(
                id, capacity, vertexOffset, vertexCount, indexOffset,
                indexCount, primitiveBase);
            return;
        }
        case OP_RTX_SCENE_COMMIT: {
            const uint32_t version = r.u32();
            const uint32_t encoder = r.u32();
            if (!r.ok || version != 1u) {
                setError("Unsupported or truncated RTX scene-commit command");
                return;
            }
            tw_ray_query_scene_commit(encoder);
            return;
        }
        case OP_RTX_SCENE_DESTROY: {
            const uint32_t version = r.u32();
            if (!r.ok || version != 1u) {
                setError("Unsupported or truncated RTX scene-destroy command");
                return;
            }
            tw_ray_query_scene_destroy();
            return;
        }
        case OP_RTX_INSTANCE_GROUP_UPDATE: {
            const uint32_t version = r.u32();
            const uint32_t encoder = r.u32();
            const uint32_t id = r.u32();
            const uint32_t instanceCount = r.u32();
            const uint64_t expectedBytes =
                static_cast<uint64_t>(instanceCount) *
                (12ull * sizeof(float) + sizeof(uint32_t));
            if (!r.ok || version != 1u || id == 0u || instanceCount == 0u ||
                instanceCount > 1024u || expectedBytes != r.remaining()) {
                setError("Unsupported or malformed RTX instance-group update");
                return;
            }
            std::vector<float> matrices(
                static_cast<std::size_t>(instanceCount) * 12u);
            std::vector<uint32_t> masks(instanceCount);
            for (float& value : matrices) value = r.f32();
            for (uint32_t& value : masks) value = r.u32();
            if (!r.ok || !tw_ray_query_instance_group_update(
                    encoder, id, matrices.data(), masks.data(), instanceCount)) {
                if (!r.ok) {
                    setError("RTX instance-group update ended before instanceCount");
                }
                return;
            }
            return;
        }
        case OP_RTX_LIGHTING_EVALUATE: {
            const uint32_t version = r.u32();
            if (version == 1u) {
                TWRayQueryLightingFrame frame{};
                frame.struct_size = sizeof(frame);
                frame.command_encoder_handle = r.u32();
                frame.color_texture_handle = r.u32();
                frame.color_vulkan_layout = r.u32();
                frame.depth_texture_handle = r.u32();
                frame.depth_vulkan_layout = r.u32();
                frame.width = r.u32();
                frame.height = r.u32();
                for (float& value : frame.inverse_view_projection) value = r.f32();
                for (float& value : frame.camera_position) value = r.f32();
                for (float& value : frame.sun_direction_intensity) value = r.f32();
                for (float& value : frame.parameters) value = r.f32();
                frame.flags = r.u32();
                for (float& value : frame.water) value = r.f32();
                if (!r.ok) {
                    setError("Unsupported or truncated RTX lighting command");
                    return;
                }
                tw_ray_query_lighting_evaluate(&frame);
                return;
            }
            if (version == 2u) {
                TWRayQueryLightingFrameV2 frame{};
                frame.struct_size = sizeof(frame);
                frame.command_encoder_handle = r.u32();
                frame.color_texture_handle = r.u32();
                frame.color_vulkan_layout = r.u32();
                frame.depth_texture_handle = r.u32();
                frame.depth_vulkan_layout = r.u32();
                frame.width = r.u32();
                frame.height = r.u32();
                for (float& value : frame.inverse_view_projection) value = r.f32();
                for (float& value : frame.camera_position) value = r.f32();
                for (float& value : frame.directional_light_direction_intensity) {
                    value = r.f32();
                }
                frame.directional_visibility_strength = r.f32();
                frame.ao_strength = r.f32();
                frame.ao_radius = r.f32();
                frame.directional_angular_radius = r.f32();
                frame.flags = r.u32();
                frame.max_distance = r.f32();
                frame.ray_bias = r.f32();
                frame.directional_sample_count = r.u32();
                frame.ao_sample_count = r.u32();
                frame.frame_index = r.u32();
                frame.pipeline_handle = r.u32();
                if (!r.ok) {
                    setError("Unsupported or truncated RTX lighting command");
                    return;
                }
                tw_ray_query_lighting_evaluate_v2(&frame);
                return;
            }
            {
                setError("Unsupported or truncated RTX lighting command");
                return;
            }
        }
        case OP_RTX_REFLECTIONS_EVALUATE: {
            const uint32_t version = r.u32();
            if (version != 1u && version != 2u && version != 3u) {
                setError("Unsupported or truncated RTX reflection command");
                return;
            }
            TWRayQueryReflectionFrameV3 frame{};
            frame.struct_size = sizeof(frame);
            frame.command_encoder_handle = r.u32();
            frame.source_color_texture_handle = r.u32();
            frame.source_color_vulkan_layout = r.u32();
            frame.output_color_texture_handle = r.u32();
            frame.output_color_vulkan_layout = r.u32();
            frame.depth_texture_handle = r.u32();
            frame.depth_vulkan_layout = r.u32();
            frame.normal_roughness_texture_handle = r.u32();
            frame.normal_roughness_vulkan_layout = r.u32();
            frame.specular_albedo_texture_handle = r.u32();
            frame.specular_albedo_vulkan_layout = r.u32();
            frame.width = r.u32();
            frame.height = r.u32();
            for (float& value : frame.inverse_view_projection) value = r.f32();
            for (float& value : frame.camera_position) value = r.f32();
            for (float& value : frame.parameters) value = r.f32();
            for (float& value : frame.environment) value = r.f32();
            frame.flags = r.u32();
            frame.frame_index = r.u32();
            if (version >= 2u) frame.pipeline_handle = r.u32();
            if (version >= 3u) {
                frame.specular_hit_distance_texture_handle = r.u32();
                frame.specular_hit_distance_vulkan_layout = r.u32();
            }
            if (!r.ok) {
                setError("Unsupported or truncated RTX reflection command");
                return;
            }
            tw_ray_query_reflections_evaluate_v3(&frame);
            return;
        }
        case OP_RTX_PIPELINE_CREATE: {
            const uint32_t version = r.u32();
            const uint32_t handle = r.u32();
            const uint32_t profile = r.u32();
            const uint32_t entryPointLength = r.u32();
            const uint32_t spirvByteLength = r.u32();
            if (version != 1u || handle == 0u || entryPointLength == 0u ||
                entryPointLength > 255u || spirvByteLength < 20u ||
                spirvByteLength > 1024u * 1024u ||
                (spirvByteLength & 3u) != 0u) {
                setError("Invalid RTX custom-pipeline command");
                return;
            }
            const uint8_t* entryBytes = r.bytes(entryPointLength);
            const uint32_t entryPadding = (4u - (entryPointLength & 3u)) & 3u;
            if (entryPadding) r.bytes(entryPadding);
            const uint8_t* spirvBytes = r.bytes(spirvByteLength);
            if (!r.ok || !entryBytes || !spirvBytes ||
                std::memchr(entryBytes, '\0', entryPointLength)) {
                setError("Truncated or invalid RTX custom-pipeline command");
                return;
            }
            std::string entryPoint(reinterpret_cast<const char*>(entryBytes),
                                   entryPointLength);
            std::vector<uint32_t> spirv(spirvByteLength / sizeof(uint32_t));
            std::memcpy(spirv.data(), spirvBytes, spirvByteLength);
            tw_ray_query_pipeline_create(handle, profile, spirv.data(),
                                         spirvByteLength, entryPoint.data(),
                                         entryPointLength);
            return;
        }
        case OP_RTX_PIPELINE_CREATE_SOURCE: {
            const uint32_t version = r.u32();
            const uint32_t handle = r.u32();
            const uint32_t profile = r.u32();
            const uint32_t entryPointLength = r.u32();
            const uint32_t sourceByteLength = r.u32();
            if (version != 1u || handle == 0u || entryPointLength == 0u ||
                entryPointLength > 255u || sourceByteLength == 0u ||
                sourceByteLength > 1024u * 1024u) {
                setError("Invalid RTX GLSL custom-pipeline command");
                return;
            }
            const uint8_t* entryBytes = r.bytes(entryPointLength);
            const uint32_t entryPadding = (4u - (entryPointLength & 3u)) & 3u;
            if (entryPadding) r.bytes(entryPadding);
            const uint8_t* sourceBytes = r.bytes(sourceByteLength);
            if (!r.ok || !entryBytes || !sourceBytes ||
                std::memchr(entryBytes, '\0', entryPointLength) ||
                std::memchr(sourceBytes, '\0', sourceByteLength)) {
                setError("Truncated or invalid RTX GLSL custom-pipeline command");
                return;
            }
            tw_ray_query_pipeline_create_glsl(
                handle, profile,
                reinterpret_cast<const char*>(sourceBytes), sourceByteLength,
                reinterpret_cast<const char*>(entryBytes), entryPointLength);
            return;
        }
        case OP_RTX_PIPELINE_DESTROY: {
            const uint32_t version = r.u32();
            const uint32_t handle = r.u32();
            if (!r.ok || version != 1u || handle == 0u) {
                setError("Invalid RTX custom-pipeline destroy command");
                return;
            }
            tw_ray_query_pipeline_destroy(handle);
            return;
        }
        case OP_SUBMIT:
            finishEncoderSubmit();
            return;
        case OP_COPY_BUF: {
            r.u32(); // encoder
            const uint32_t src = r.u32();
            const uint32_t dst = r.u32();
            const uint64_t srcOff = r.u32();
            const uint64_t dstOff = r.u32();
            const uint64_t size = r.u32();
            Slot* ss = getSlot(src);
            Slot* ds = getSlot(dst);
            if (!ss || ss->kind != Kind::Buffer || !ds || ds->kind != Kind::Buffer) {
                setError("copy buf: bad handle");
                return;
            }
            WGPUCommandEncoder enc = ensureEncoder();
            if (!enc) {
                return;
            }
            wgpuCommandEncoderCopyBufferToBuffer(enc, ss->buffer, srcOff, ds->buffer, dstOff, size);
            return;
        }
        case OP_PIPE_BGL: {
            const uint32_t handle = r.u32();
            const uint32_t pipe = r.u32();
            const uint32_t index = r.u32();
            Slot* ps = getSlot(pipe);
            WGPUBindGroupLayout bgl = nullptr;
            if (ps && ps->kind == Kind::ComputePipeline && ps->cpipe) {
                bgl = wgpuComputePipelineGetBindGroupLayout(ps->cpipe, index);
            } else if (ps && ps->kind == Kind::RenderPipeline && ps->rpipe) {
                bgl = wgpuRenderPipelineGetBindGroupLayout(ps->rpipe, index);
            }
            if (!bgl) {
                setError("pipeline bind group layout failed");
                return;
            }
            Slot s;
            s.kind = Kind::BindGroupLayout;
            s.bgl = bgl;
            putSlot(handle, std::move(s));
            return;
        }
        case OP_COPY_TEX: {
            if (r.remaining() < 84) {
                setError("copy tex: unsupported command payload");
                return;
            }
            const uint32_t encoder = r.u32();
            const uint32_t kind = r.u32();
            const uint32_t src = r.u32();
            const uint32_t dst = r.u32();
            const uint32_t sx = r.u32();
            const uint32_t sy = r.u32();
            const uint32_t sz = r.u32();
            const uint32_t smip = r.u32();
            const uint32_t srcAspect = r.u32();
            const uint32_t dx = r.u32();
            const uint32_t dy = r.u32();
            const uint32_t dz = r.u32();
            const uint32_t dmip = r.u32();
            const uint32_t dstAspect = r.u32();
            const uint32_t bufferOffset = r.u32();
            const uint32_t bytesPerRow = r.u32();
            const uint32_t rowsPerImage = r.u32();
            const uint32_t cw = r.u32();
            const uint32_t ch = r.u32();
            const uint32_t cd = r.u32();
            r.u32(); // pad
            Slot* ss = getSlot(src);
            Slot* ds = getSlot(dst);
            Slot* es = getSlot(encoder);
            WGPUCommandEncoder enc = es && es->kind == Kind::Encoder ? es->encoder : g.currentEncoder;
            if (!enc || !ss || !ds) {
                setError("copy tex: bad handle");
                return;
            }
            WGPUExtent3D extent{};
            extent.width = cw ? cw : (ss->kind == Kind::Texture ? ss->texW : ds->texW);
            extent.height = ch ? ch : (ss->kind == Kind::Texture ? ss->texH : ds->texH);
            extent.depthOrArrayLayers = cd ? cd : 1;
            auto textureInfo = [](Slot* slot, uint32_t mip, uint32_t x, uint32_t y, uint32_t z,
                                  uint32_t aspect) {
                WGPUTexelCopyTextureInfo info{};
                info.texture = slot->texture;
                info.mipLevel = mip;
                info.origin = {x, y, z};
                info.aspect = aspect ? static_cast<WGPUTextureAspect>(aspect) : WGPUTextureAspect_All;
                return info;
            };
            WGPUTexelCopyBufferInfo bufferInfo{};
            bufferInfo.layout.offset = bufferOffset;
            bufferInfo.layout.bytesPerRow = bytesPerRow ? bytesPerRow : WGPU_COPY_STRIDE_UNDEFINED;
            bufferInfo.layout.rowsPerImage = rowsPerImage ? rowsPerImage : WGPU_COPY_STRIDE_UNDEFINED;
            if (kind == 0 && ss->kind == Kind::Texture && ds->kind == Kind::Buffer) {
                const auto source = textureInfo(ss, smip, sx, sy, sz, srcAspect);
                bufferInfo.buffer = ds->buffer;
                wgpuCommandEncoderCopyTextureToBuffer(enc, &source, &bufferInfo, &extent);
            } else if (kind == 1 && ss->kind == Kind::Buffer && ds->kind == Kind::Texture) {
                bufferInfo.buffer = ss->buffer;
                const auto destination = textureInfo(ds, dmip, dx, dy, dz, dstAspect);
                wgpuCommandEncoderCopyBufferToTexture(enc, &bufferInfo, &destination, &extent);
            } else if (kind == 2 && ss->kind == Kind::Texture && ds->kind == Kind::Texture) {
                const auto source = textureInfo(ss, smip, sx, sy, sz, srcAspect);
                const auto destination = textureInfo(ds, dmip, dx, dy, dz, dstAspect);
                wgpuCommandEncoderCopyTextureToTexture(enc, &source, &destination, &extent);
            } else {
                setError("copy tex: resource kind mismatch");
            }
            return;
        }
        default:
            stubUnknown(op);
            return;
    }
}

int implMapRead(uint32_t handle, uint64_t offset, uint64_t size, void* dst, int dstBytes) {
    if (!dst || dstBytes <= 0 || size == 0) {
        return 0;
    }
    Slot* s = getSlot(handle);
    if (!s || s->kind != Kind::Buffer || !s->buffer) {
        setError("map_read: bad buffer");
        return 0;
    }
    const uint64_t copy = std::min<uint64_t>(size, static_cast<uint64_t>(dstBytes));
    WGPUBuffer src = s->buffer;
    WGPUBuffer mapBuf = src;
    WGPUBuffer staging = nullptr;
    const bool canMap = (s->bufUsage & WGPUBufferUsage_MapRead) != 0;
    if (!canMap) {
        WGPUBufferDescriptor bd{};
        bd.size = copy;
        bd.usage = WGPUBufferUsage_MapRead | WGPUBufferUsage_CopyDst;
        staging = wgpuDeviceCreateBuffer(g.device, &bd);
        if (!staging) {
            setError("map_read: staging failed");
            return 0;
        }
        WGPUCommandEncoderDescriptor ed{};
        WGPUCommandEncoder enc = wgpuDeviceCreateCommandEncoder(g.device, &ed);
        wgpuCommandEncoderCopyBufferToBuffer(enc, src, offset, staging, 0, copy);
        WGPUCommandBuffer cmd = wgpuCommandEncoderFinish(enc, nullptr);
        wgpuQueueSubmit(g.queue, 1, &cmd);
        wgpuCommandBufferRelease(cmd);
        wgpuCommandEncoderRelease(enc);
        mapBuf = staging;
        offset = 0;
        wgpuDevicePoll(g.device, 1, nullptr);
    }
    struct Wait {
        WGPUMapAsyncStatus status{WGPUMapAsyncStatus_Error};
        bool done{false};
    } wait;
    auto cb = [](WGPUMapAsyncStatus status, WGPUStringView, void* ud1, void*) {
        auto* w = static_cast<Wait*>(ud1);
        w->status = status;
        w->done = true;
    };
    WGPUBufferMapCallbackInfo ci{};
    ci.mode = WGPUCallbackMode_AllowSpontaneous;
    ci.callback = cb;
    ci.userdata1 = &wait;
    WGPUFuture fut = wgpuBufferMapAsync(mapBuf, WGPUMapMode_Read, static_cast<size_t>(offset),
                                        static_cast<size_t>(copy), ci);
    if (!wait.done) {
        waitFuture(fut);
        wgpuDevicePoll(g.device, 1, nullptr);
    }
    int out = 0;
    if (wait.status == WGPUMapAsyncStatus_Success) {
        const void* mapped = wgpuBufferGetConstMappedRange(mapBuf, static_cast<size_t>(offset),
                                                           static_cast<size_t>(copy));
        if (mapped) {
            std::memcpy(dst, mapped, static_cast<size_t>(copy));
            out = static_cast<int>(copy);
        }
        wgpuBufferUnmap(mapBuf);
    } else {
        setError("map_read: map failed");
    }
    if (staging) {
        wgpuBufferRelease(staging);
    }
    return out;
}

void implShutdown() {
    setLoadingState(false, nullptr);
    // Streamline must release its feature state while the Vulkan device and
    // instance are still valid. wgpu-native retains its own module reference
    // to the interposer until the Vulkan objects are destroyed below.
    streamlineShutdown();
    destroyGpu();
    destroyHwnd();
    g.started = false;
    g.statsPresents.store(0, std::memory_order_relaxed);
    g.statsFps.store(0, std::memory_order_relaxed);
}

void implReset() {
    dropCurrentTexture();
    clearSlots();
#if defined(THREEBROWSER_RAY_QUERY)
    rayQueryBridgeDestroyScene();
    rayQueryBridgeResetPipelines();
#endif
}

void workerMain() {
    g.workerId = std::this_thread::get_id();
    logLine("worker started");
    constexpr std::size_t maxJobsPerTurn = 64;
    while (true) {
        pumpHwnd();
        std::vector<std::function<void()>> batch;
        bool stopping = false;
        {
            std::unique_lock<std::mutex> lock(g.mu);
            if (g.jobs.empty() && !g.stop) {
                g.cv.wait_for(lock, std::chrono::milliseconds(16), [] {
                    return g.stop || !g.jobs.empty();
                });
            }
            while (!g.jobs.empty() && batch.size() < maxJobsPerTurn) {
                batch.push_back(std::move(g.jobs.front()));
                g.jobs.pop_front();
            }
            stopping = g.stop && batch.empty();
        }
        if (stopping) {
            break;
        }
        for (std::size_t index = 0; index < batch.size(); ++index) {
            try {
                batch[index]();
            } catch (const std::exception& ex) {
                setError(ex.what());
            } catch (...) {
                setError("webgpu worker: unknown exception");
            }
            if ((index & 7u) == 7u) pumpHwnd();
        }
        pumpHwnd();
        presentLoadingFrame();
        if (g.instance) {
            wgpuInstanceProcessEvents(g.instance);
        }
        if (g.stop) {
            break;
        }
    }
    implShutdown();
    logLine("worker stopped");
}

void ensureWorker() {
    std::lock_guard<std::mutex> lock(g.mu);
    if (g.workerStarted) {
        return;
    }
    g.stop = false;
    g.worker = std::thread(workerMain);
    g.workerStarted = true;
}

#if defined(THREEBROWSER_STREAMLINE)
VkFormat toVulkanFormat(WGPUTextureFormat format) {
    switch (format) {
        case WGPUTextureFormat_R8Unorm: return VK_FORMAT_R8_UNORM;
        case WGPUTextureFormat_R8Snorm: return VK_FORMAT_R8_SNORM;
        case WGPUTextureFormat_R8Uint: return VK_FORMAT_R8_UINT;
        case WGPUTextureFormat_R8Sint: return VK_FORMAT_R8_SINT;
        case WGPUTextureFormat_R16Uint: return VK_FORMAT_R16_UINT;
        case WGPUTextureFormat_R16Sint: return VK_FORMAT_R16_SINT;
        case WGPUTextureFormat_R16Float: return VK_FORMAT_R16_SFLOAT;
        case WGPUTextureFormat_RG8Unorm: return VK_FORMAT_R8G8_UNORM;
        case WGPUTextureFormat_RG8Snorm: return VK_FORMAT_R8G8_SNORM;
        case WGPUTextureFormat_RG8Uint: return VK_FORMAT_R8G8_UINT;
        case WGPUTextureFormat_RG8Sint: return VK_FORMAT_R8G8_SINT;
        case WGPUTextureFormat_R32Float: return VK_FORMAT_R32_SFLOAT;
        case WGPUTextureFormat_R32Uint: return VK_FORMAT_R32_UINT;
        case WGPUTextureFormat_R32Sint: return VK_FORMAT_R32_SINT;
        case WGPUTextureFormat_RG16Uint: return VK_FORMAT_R16G16_UINT;
        case WGPUTextureFormat_RG16Sint: return VK_FORMAT_R16G16_SINT;
        case WGPUTextureFormat_RG16Float: return VK_FORMAT_R16G16_SFLOAT;
        case WGPUTextureFormat_RGBA8Unorm: return VK_FORMAT_R8G8B8A8_UNORM;
        case WGPUTextureFormat_RGBA8UnormSrgb: return VK_FORMAT_R8G8B8A8_SRGB;
        case WGPUTextureFormat_RGBA8Snorm: return VK_FORMAT_R8G8B8A8_SNORM;
        case WGPUTextureFormat_RGBA8Uint: return VK_FORMAT_R8G8B8A8_UINT;
        case WGPUTextureFormat_RGBA8Sint: return VK_FORMAT_R8G8B8A8_SINT;
        case WGPUTextureFormat_BGRA8Unorm: return VK_FORMAT_B8G8R8A8_UNORM;
        case WGPUTextureFormat_BGRA8UnormSrgb: return VK_FORMAT_B8G8R8A8_SRGB;
        case WGPUTextureFormat_RGB10A2Uint: return VK_FORMAT_A2B10G10R10_UINT_PACK32;
        case WGPUTextureFormat_RGB10A2Unorm: return VK_FORMAT_A2B10G10R10_UNORM_PACK32;
        case WGPUTextureFormat_RG11B10Ufloat: return VK_FORMAT_B10G11R11_UFLOAT_PACK32;
        case WGPUTextureFormat_RG32Float: return VK_FORMAT_R32G32_SFLOAT;
        case WGPUTextureFormat_RG32Uint: return VK_FORMAT_R32G32_UINT;
        case WGPUTextureFormat_RG32Sint: return VK_FORMAT_R32G32_SINT;
        case WGPUTextureFormat_RGBA16Uint: return VK_FORMAT_R16G16B16A16_UINT;
        case WGPUTextureFormat_RGBA16Sint: return VK_FORMAT_R16G16B16A16_SINT;
        case WGPUTextureFormat_RGBA16Float: return VK_FORMAT_R16G16B16A16_SFLOAT;
        case WGPUTextureFormat_RGBA32Float: return VK_FORMAT_R32G32B32A32_SFLOAT;
        case WGPUTextureFormat_RGBA32Uint: return VK_FORMAT_R32G32B32A32_UINT;
        case WGPUTextureFormat_RGBA32Sint: return VK_FORMAT_R32G32B32A32_SINT;
        case WGPUTextureFormat_Depth16Unorm: return VK_FORMAT_D16_UNORM;
        case WGPUTextureFormat_Depth32Float: return VK_FORMAT_D32_SFLOAT;
        case WGPUTextureFormat_Stencil8: return VK_FORMAT_S8_UINT;
        case WGPUTextureFormat_Depth32FloatStencil8: return VK_FORMAT_D32_SFLOAT_S8_UINT;
        default: return VK_FORMAT_UNDEFINED;
    }
}

VkImageUsageFlags toVulkanUsage(WGPUTextureUsage usage, bool depth) {
    VkImageUsageFlags out{};
    if (usage & WGPUTextureUsage_CopySrc) out |= VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
    if (usage & WGPUTextureUsage_CopyDst) out |= VK_IMAGE_USAGE_TRANSFER_DST_BIT;
    if (usage & WGPUTextureUsage_TextureBinding) out |= VK_IMAGE_USAGE_SAMPLED_BIT;
    if (usage & WGPUTextureUsage_StorageBinding) out |= VK_IMAGE_USAGE_STORAGE_BIT;
    if (usage & WGPUTextureUsage_RenderAttachment) {
        out |= depth ? VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT
                     : VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
    }
    return out;
}

Slot* textureSlotFromHandle(uint32_t handle) {
    Slot* slot = getSlot(handle);
    if (slot && slot->kind == Kind::TextureView) slot = getSlot(slot->textureHandle);
    return slot && slot->kind == Kind::Texture ? slot : nullptr;
}

bool makeStreamlineResource(const TWDLSSResource& input, bool depth, bool outputResource,
                             StreamlineVulkanResource& output, std::string& error) {
    Slot* slot = textureSlotFromHandle(input.texture_handle);
    if (!slot || !slot->texture) {
        error = "DLSS texture handle " + std::to_string(input.texture_handle) + " is invalid";
        return false;
    }
    if (slot->texSampleCount != 1) {
        error = "DLSS resources must be single-sampled";
        return false;
    }
    if (slot->texD != 1 || slot->texMipLevels != 1) {
        error = "DLSS resources must be single-layer 2D textures with one mip level";
        return false;
    }
    const WGPUTextureUsage requiredUsage = outputResource
        ? WGPUTextureUsage_StorageBinding
        : WGPUTextureUsage_TextureBinding;
    if ((slot->texUsage & requiredUsage) == 0) {
        error = outputResource
            ? "The DLSS output texture requires GPUTextureUsage.STORAGE_BINDING"
            : "DLSS input textures require GPUTextureUsage.TEXTURE_BINDING";
        return false;
    }
    if (input.vulkan_layout == VK_IMAGE_LAYOUT_UNDEFINED) {
        error = "DLSS requires the current Vulkan image layout for every resource";
        return false;
    }
    const VkFormat format = toVulkanFormat(slot->texFormat);
    if (format == VK_FORMAT_UNDEFINED) {
        error = "DLSS does not support this WebGPU texture format through the native bridge";
        return false;
    }
    output.image = wgpuTextureGetNativeVulkanImage(slot->texture);
    output.width = slot->texW;
    output.height = slot->texH;
    output.format = static_cast<uint32_t>(format);
    output.layout = input.vulkan_layout;
    output.usage = toVulkanUsage(slot->texUsage, depth);
    output.aspectMask = depth ? VK_IMAGE_ASPECT_DEPTH_BIT : VK_IMAGE_ASPECT_COLOR_BIT;
    output.mipLevels = slot->texMipLevels;
    output.arrayLayers = slot->texD;
    output.left = input.left;
    output.top = input.top;
    output.extentWidth = input.width;
    output.extentHeight = input.height;
    const uint32_t extentWidth = output.extentWidth ? output.extentWidth : output.width;
    const uint32_t extentHeight = output.extentHeight ? output.extentHeight : output.height;
    if (output.left >= output.width || output.top >= output.height ||
        extentWidth > output.width - output.left ||
        extentHeight > output.height - output.top) {
        error = "DLSS resource extent is outside the texture bounds";
        return false;
    }
    if (!output.image) {
        error = "wgpu-native did not expose a Vulkan image for a DLSS resource";
        return false;
    }
    return true;
}

enum class RayReconstructionResourceKind {
    HdrColor,
    Depth,
    MotionVectors,
    LinearAlbedo,
    Normal,
    Scalar,
};

bool validateRayReconstructionFormat(uint32_t textureHandle,
                                     RayReconstructionResourceKind kind,
                                     const char* name, std::string& error) {
    const Slot* slot = textureSlotFromHandle(textureHandle);
    if (!slot) {
        error = std::string("Ray Reconstruction ") + name + " texture is invalid";
        return false;
    }
    const WGPUTextureFormat format = slot->texFormat;
    bool valid = false;
    switch (kind) {
        case RayReconstructionResourceKind::HdrColor:
            valid = format == WGPUTextureFormat_RG11B10Ufloat ||
                    format == WGPUTextureFormat_RGBA16Float ||
                    format == WGPUTextureFormat_RGBA32Float;
            break;
        case RayReconstructionResourceKind::Depth:
            valid = format == WGPUTextureFormat_Depth16Unorm ||
                    format == WGPUTextureFormat_Depth32Float ||
                    format == WGPUTextureFormat_Depth32FloatStencil8;
            break;
        case RayReconstructionResourceKind::MotionVectors:
            valid = format == WGPUTextureFormat_RG16Float ||
                    format == WGPUTextureFormat_RG32Float;
            break;
        case RayReconstructionResourceKind::LinearAlbedo:
            valid = format == WGPUTextureFormat_RGBA8Unorm ||
                    format == WGPUTextureFormat_RGB10A2Unorm ||
                    format == WGPUTextureFormat_RG11B10Ufloat ||
                    format == WGPUTextureFormat_RGBA16Float ||
                    format == WGPUTextureFormat_RGBA32Float;
            break;
        case RayReconstructionResourceKind::Normal:
            valid = format == WGPUTextureFormat_RGBA16Float ||
                    format == WGPUTextureFormat_RGBA32Float;
            break;
        case RayReconstructionResourceKind::Scalar:
            valid = format == WGPUTextureFormat_R16Float ||
                    format == WGPUTextureFormat_R32Float;
            break;
    }
    if (!valid) {
        error = std::string("Ray Reconstruction ") + name +
                " texture format does not satisfy the Streamline DLSS-RR input contract";
    }
    return valid;
}

bool finiteMatrix(const float* matrix) {
    return matrix && std::all_of(matrix, matrix + 16,
                                 [](float value) { return std::isfinite(value); });
}

void copyConstants(const TWDLSSFrameConstants& source, StreamlineFrameConstants& target) {
    std::copy_n(source.camera_view_to_clip, 16, target.cameraViewToClip.begin());
    std::copy_n(source.clip_to_camera_view, 16, target.clipToCameraView.begin());
    std::copy_n(source.clip_to_lens_clip, 16, target.clipToLensClip.begin());
    std::copy_n(source.clip_to_prev_clip, 16, target.clipToPrevClip.begin());
    std::copy_n(source.prev_clip_to_clip, 16, target.prevClipToClip.begin());
    std::copy_n(source.jitter_offset, 2, target.jitterOffset.begin());
    std::copy_n(source.motion_vector_scale, 2, target.motionVectorScale.begin());
    std::copy_n(source.camera_pinhole_offset, 2, target.cameraPinholeOffset.begin());
    std::copy_n(source.camera_position, 3, target.cameraPosition.begin());
    std::copy_n(source.camera_up, 3, target.cameraUp.begin());
    std::copy_n(source.camera_right, 3, target.cameraRight.begin());
    std::copy_n(source.camera_forward, 3, target.cameraForward.begin());
    target.cameraNear = source.camera_near;
    target.cameraFar = source.camera_far;
    target.cameraFov = source.camera_fov;
    target.cameraAspectRatio = source.camera_aspect_ratio;
    target.depthInverted = source.depth_inverted != 0;
    target.cameraMotionIncluded = source.camera_motion_included != 0;
    target.motionVectors3D = source.motion_vectors_3d != 0;
    target.reset = source.reset != 0;
    target.orthographicProjection = source.orthographic_projection != 0;
    target.motionVectorsDilated = source.motion_vectors_dilated != 0;
    target.motionVectorsJittered = source.motion_vectors_jittered != 0;
}
#endif

}// namespace

extern "C" {

int tw_start(void* parent_hwnd, int x, int y, int w, int h) {
    try {
        return onWorker([parent_hwnd, x, y, w, h] {
            return implStart(parent_hwnd, x, y, w, h) ? 1 : 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_attach_host(void* parent_hwnd, int x, int y, int w, int h) {
    try {
        if (!parent_hwnd) {
            setError("invalid hwnd");
            return 0;
        }
        w = std::max(1, w);
        h = std::max(1, h);
        // Async: SetParent of a UI-owned form from this caller's thread
        // deadlocks (same note as tn_runtime_attach_host).
        onWorkerAsync([parent_hwnd, x, y, w, h] {
            if (!g.started) {
                if (!implStart(nullptr, x, y, w, h)) {
                    return;
                }
            }
            implAttach(parent_hwnd, x, y, w, h);
        });
        return 1;
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tw_set_size(int w, int h) {
    try {
        w = std::max(1, w);
        h = std::max(1, h);
        g.statsW.store(w, std::memory_order_relaxed);
        g.statsH.store(h, std::memory_order_relaxed);
        onWorkerAsync([w, h] {
            if (g.hwnd) {
                setHwndClientSize(g.hwnd, w, h);
            }
            requestSurfaceResize(w, h);
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

void tw_set_vsync(int on) {
    g.vsync.store(on != 0 ? 1 : 0, std::memory_order_relaxed);
    try {
        onWorkerAsync([] {
            if (g.surfaceConfigured) {
                configureSurface(g.config.width ? static_cast<int>(g.config.width) : g.statsW.load(),
                                 g.config.height ? static_cast<int>(g.config.height) : g.statsH.load());
            }
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

void* tw_hwnd(void) {
    return g.nativeHwnd.load();
}

void tw_set_standalone_ui(int on) {
    g.standaloneUi.store(on != 0 ? 1 : 0, std::memory_order_relaxed);
}

int tw_take_wheel_delta(void) {
    return g.wheelDelta.exchange(0, std::memory_order_acq_rel);
}

int tw_backlog(void) {
    return g.pendingCommandSubmits.load(std::memory_order_relaxed);
}

int tw_content_offset_y(void) {
    return 0;
}

void tw_set_overlay_window(void* hwnd) {
    g.overlayWindow.store(hwnd, std::memory_order_release);
    refreshDisplayModes();
    g.overlayDirty.store(1, std::memory_order_release);
}

void tw_set_overlay(int on) {
    if (on) refreshDisplayModes();
    {
        std::lock_guard<std::mutex> lock(g.displayMu);
        g.resolutionDropdown.open = false;
        g.resolutionDropdown.hoverIndex = -1;
    }
    if (on) g.overlayScrollPx.store(0, std::memory_order_relaxed);
    g.overlayOpen.store(on != 0 ? 1 : 0, std::memory_order_relaxed);
    g.overlayDirty.store(1, std::memory_order_release);
}

void tw_set_loading(int on, const char* stage) {
    setLoadingState(on != 0, stage);
}

int tw_loading_visible(void) {
    return g.loading.load(std::memory_order_acquire) != 0;
}

int tw_overlay_open(void) {
    return g.overlayOpen.load(std::memory_order_relaxed);
}

static POINT overlayPointFromClient(int x, int y, int renderWidth, int renderHeight) {
    renderWidth = std::max(1, renderWidth);
    renderHeight = std::max(1, renderHeight);
    return POINT{
        std::clamp(x, 0, renderWidth - 1),
        std::clamp(y, 0, renderHeight - 1),
    };
}

void tw_overlay_click(int x, int y) {
    if (!g.overlayOpen.load(std::memory_order_relaxed)) return;
    const int width = g.statsW.load(std::memory_order_relaxed);
    const int height = g.statsH.load(std::memory_order_relaxed);
    POINT point = overlayPointFromClient(x, y, width, height);
    x = point.x;
    y = point.y;
    const OverlayLayout layout = overlayLayout(width, height);
    const bool insideBody = PtInRect(&layout.bodyClip, point) != FALSE;
    if (layout.maxScroll > 0 && PtInRect(&layout.scrollTrack, point)) {
        const int trackHeight = std::max(1L, layout.scrollTrack.bottom - layout.scrollTrack.top);
        const int thumbHeight = std::max(1L, layout.scrollThumb.bottom - layout.scrollThumb.top);
        const int travel = std::max(1, trackHeight - thumbHeight);
        const int relative = std::clamp(
            y - static_cast<int>(layout.scrollTrack.top) - thumbHeight / 2, 0, travel);
        g.overlayScrollPx.store(relative * layout.maxScroll / travel, std::memory_order_relaxed);
        g.overlayDirty.store(1, std::memory_order_release);
        return;
    }
    {
        std::lock_guard<std::mutex> lock(g.displayMu);
        OverlayDropdown& dropdown = g.resolutionDropdown;
        if (insideBody && dropdown.open && PtInRect(&layout.resolutionButton, point)) {
            dropdown.open = false;
            dropdown.hoverIndex = -1;
            g.overlayDirty.store(1, std::memory_order_release);
            return;
        }
        if (dropdown.open) {
            const int index = dropdownHitIndex(dropdown, layout.resolutionButton,
                                               static_cast<int>(g.displayModes.size()), point);
            if (insideBody && index >= 0) {
                g.selectedDisplayMode = index;
                dropdown.open = false;
                dropdown.hoverIndex = -1;
                const int currentMode = g.fullscreenState.load(std::memory_order_relaxed);
                if (currentMode != 0) {
                    g.displayCommandReady = true;
                    g.displayCommandEnabled = currentMode;
                    g.displayCommandMode = g.displayModes[static_cast<size_t>(index)];
                }
                g.overlayDirty.store(1, std::memory_order_release);
                return;
            }
            dropdown.open = false;
            dropdown.hoverIndex = -1;
        }
        if (insideBody && PtInRect(&layout.resolutionButton, point)) {
            dropdown.open = true;
            dropdown.hoverIndex = -1;
            dropdownReveal(dropdown, g.selectedDisplayMode, static_cast<int>(g.displayModes.size()));
            g.overlayDirty.store(1, std::memory_order_release);
            return;
        }
        if (insideBody && PtInRect(&layout.windowedButton, point)) {
            if (g.fullscreenState.load(std::memory_order_relaxed) != 0) {
                g.displayCommandReady = true;
                g.displayCommandEnabled = 0;
                g.displayCommandMode = {};
            }
            g.overlayDirty.store(1, std::memory_order_release);
            return;
        }
        if (insideBody && PtInRect(&layout.fullscreenButton, point)) {
            if (!g.displayModes.empty()) {
                const int selected = std::clamp(g.selectedDisplayMode, 0,
                                                static_cast<int>(g.displayModes.size()) - 1);
                g.displayCommandReady = true;
                g.displayCommandEnabled = 2;
                g.displayCommandMode = g.displayModes[static_cast<size_t>(selected)];
            }
            g.overlayDirty.store(1, std::memory_order_release);
            return;
        }
        if (insideBody && PtInRect(&layout.borderlessButton, point)) {
            if (!g.displayModes.empty()) {
                const int selected = std::clamp(g.selectedDisplayMode, 0,
                                                static_cast<int>(g.displayModes.size()) - 1);
                g.displayCommandReady = true;
                g.displayCommandEnabled = 1;
                g.displayCommandMode = g.displayModes[static_cast<size_t>(selected)];
            }
            g.overlayDirty.store(1, std::memory_order_release);
            return;
        }
    }
    const RECT fps = layout.fpsButton;
    const RECT debug = layout.debugButton;
    if (insideBody && PtInRect(&fps, point)) {
        g.fpsOverlay.store(!g.fpsOverlay.load(std::memory_order_relaxed), std::memory_order_relaxed);
    } else if (insideBody && PtInRect(&debug, point)) {
        const bool enabled = !g.debugOverlay.load(std::memory_order_relaxed);
        g.debugOverlay.store(enabled, std::memory_order_relaxed);
        g.statsLog.store(enabled, std::memory_order_relaxed);
    } else if (insideBody && PtInRect(&layout.dlssSuperResolutionButton, point)) {
        const StreamlineFeatureState state = streamlineFeatureState();
        if (state.dlssSupported && state.dlssFunctionsLoaded) {
            const bool enabled = g.dlssRuntimeEnabled.load(std::memory_order_acquire) != 0;
            g.dlssRuntimeEnabled.store(enabled ? 0 : 1, std::memory_order_release);
            reapplyRuntimeFeatureRequestAsync();
        }
    } else if (insideBody && PtInRect(&layout.dlssFrameGenerationButton, point)) {
        const StreamlineFeatureState state = streamlineFeatureState();
        if (state.frameGenerationSupported && state.frameGenerationFunctionsLoaded) {
            const bool enabled =
                g.frameGenerationRuntimeEnabled.load(std::memory_order_acquire) != 0;
            g.frameGenerationRuntimeEnabled.store(enabled ? 0 : 1,
                                                   std::memory_order_release);
            reapplyRuntimeFeatureRequestAsync();
        }
    } else if (insideBody && PtInRect(&layout.dlssRayReconstructionButton, point)) {
        const StreamlineFeatureState state = streamlineFeatureState();
        if (state.rayReconstructionSupported && state.rayReconstructionFunctionsLoaded) {
            const bool enabled =
                g.rayReconstructionRuntimeEnabled.load(std::memory_order_acquire) != 0;
            g.rayReconstructionRuntimeEnabled.store(enabled ? 0 : 1,
                                                     std::memory_order_release);
            reapplyRuntimeFeatureRequestAsync();
        }
    } else if (insideBody && PtInRect(&layout.reflexButton, point)) {
        const StreamlineCapabilities capabilities = streamlineCapabilities();
        if (capabilities.reflex) {
            const bool enabled = g.reflexRuntimeEnabled.load(std::memory_order_acquire) != 0;
            if (enabled) {
                const int activeMode = streamlineReflexMode();
                if (activeMode > 0) {
                    std::lock_guard<std::mutex> lock(g.featureControlMu);
                    g.requestedReflexMode = activeMode;
                }
                g.reflexRuntimeEnabled.store(0, std::memory_order_release);
            } else {
                {
                    std::lock_guard<std::mutex> lock(g.featureControlMu);
                    if (g.requestedReflexMode <= 0) g.requestedReflexMode = 1;
                }
                g.reflexRuntimeEnabled.store(1, std::memory_order_release);
            }
            reapplyRuntimeFeatureRequestAsync();
        }
    }
    g.overlayDirty.store(1, std::memory_order_release);
}

void tw_overlay_pointer_move(int x, int y) {
    if (!g.overlayOpen.load(std::memory_order_relaxed)) return;
    const int width = g.statsW.load(std::memory_order_relaxed);
    const int height = g.statsH.load(std::memory_order_relaxed);
    const OverlayLayout layout = overlayLayout(width, height);
    const POINT point = overlayPointFromClient(x, y, width, height);
    {
        std::lock_guard<std::mutex> lock(g.displayMu);
        OverlayDropdown& dropdown = g.resolutionDropdown;
        if (dropdown.open) {
            if (g.overlayFeatureHover.exchange(-1, std::memory_order_acq_rel) != -1) {
                g.overlayDirty.store(1, std::memory_order_release);
            }
            const int hovered = PtInRect(&layout.bodyClip, point)
                ? dropdownHitIndex(dropdown, layout.resolutionButton,
                                   static_cast<int>(g.displayModes.size()), point)
                : -1;
            if (hovered != dropdown.hoverIndex) {
                dropdown.hoverIndex = hovered;
                g.overlayDirty.store(1, std::memory_order_release);
            }
            return;
        }
    }
    int featureHover = -1;
    if (PtInRect(&layout.bodyClip, point)) {
        if (PtInRect(&layout.dlssSuperResolutionButton, point)) featureHover = 0;
        else if (PtInRect(&layout.dlssFrameGenerationButton, point)) featureHover = 1;
        else if (PtInRect(&layout.dlssRayReconstructionButton, point)) featureHover = 2;
        else if (PtInRect(&layout.reflexButton, point)) featureHover = 3;
    }
    if (g.overlayFeatureHover.exchange(featureHover, std::memory_order_acq_rel) !=
        featureHover) {
        g.overlayDirty.store(1, std::memory_order_release);
    }
}

void tw_overlay_wheel(int delta) {
    if (!g.overlayOpen.load(std::memory_order_relaxed) || delta == 0) return;
    {
        std::lock_guard<std::mutex> lock(g.displayMu);
        OverlayDropdown& dropdown = g.resolutionDropdown;
        if (dropdown.open) {
            const int steps = std::max(1, std::abs(delta) / WHEEL_DELTA);
            const int next = dropdown.scrollOffset + (delta < 0 ? steps : -steps);
            const int clamped = std::clamp(
                next, 0, dropdownMaxOffset(static_cast<int>(g.displayModes.size())));
            if (clamped != dropdown.scrollOffset) {
                dropdown.scrollOffset = clamped;
                dropdown.hoverIndex = -1;
                g.overlayDirty.store(1, std::memory_order_release);
            }
            return;
        }
    }
    const OverlayLayout layout = overlayLayout(g.statsW.load(std::memory_order_relaxed),
                                               g.statsH.load(std::memory_order_relaxed));
    const int current = g.overlayScrollPx.load(std::memory_order_relaxed);
    int pixelDelta = delta / 2;
    if (pixelDelta == 0) pixelDelta = delta > 0 ? 1 : -1;
    const int next = std::clamp(current - pixelDelta, 0, layout.maxScroll);
    if (next != current) {
        g.overlayScrollPx.store(next, std::memory_order_relaxed);
        g.overlayDirty.store(1, std::memory_order_release);
    }
}

int tw_take_display_command(int* enabled, int* width, int* height, int* refreshHz) {
    std::lock_guard<std::mutex> lock(g.displayMu);
    if (!g.displayCommandReady) return 0;
    if (enabled) *enabled = g.displayCommandEnabled;
    if (width) *width = g.displayCommandMode.width;
    if (height) *height = g.displayCommandMode.height;
    if (refreshHz) *refreshHz = g.displayCommandMode.refreshHz;
    g.displayCommandReady = false;
    return 1;
}

void tw_set_fullscreen_state(int fullscreen, int width, int height, int refreshHz) {
    fullscreen = std::clamp(fullscreen, 0, 2);
    g.fullscreenState.store(fullscreen, std::memory_order_relaxed);
    std::lock_guard<std::mutex> lock(g.displayMu);
    if (width > 0 && height > 0) {
        auto found = std::find_if(g.displayModes.begin(), g.displayModes.end(), [&](const DisplayMode& mode) {
            return mode.width == width && mode.height == height;
        });
        if (found != g.displayModes.end()) {
            if (refreshHz > 0) found->refreshHz = refreshHz;
            g.selectedDisplayMode = static_cast<int>(std::distance(g.displayModes.begin(), found));
        } else if (fullscreen) {
            g.displayModes.insert(g.displayModes.begin(), DisplayMode{width, height, std::max(1, refreshHz)});
            if (g.displayModes.size() > 24) g.displayModes.resize(24);
            g.selectedDisplayMode = 0;
        }
    }
    g.overlayDirty.store(1, std::memory_order_release);
}

void tw_toggle_fps_overlay(void) {
    g.fpsOverlay.store(!g.fpsOverlay.load(std::memory_order_relaxed), std::memory_order_relaxed);
    g.overlayDirty.store(1, std::memory_order_release);
}

int tw_overlay_visible(void) {
    return g.loading.load(std::memory_order_relaxed) != 0 ||
           g.overlayOpen.load(std::memory_order_relaxed) != 0 ||
           g.fpsOverlay.load(std::memory_order_relaxed) != 0;
}

void tw_overlay_bounds(int canvasWidth, int canvasHeight,
                       int* left, int* top, int* width, int* height) {
    const RECT rect = overlayRasterRect(canvasWidth, canvasHeight);
    if (left) *left = rect.left;
    if (top) *top = rect.top;
    if (width) *width = std::max(0L, rect.right - rect.left);
    if (height) *height = std::max(0L, rect.bottom - rect.top);
}

const uint8_t* tw_overlay_raster(int width, int height, int fps, int frameUs,
                                 const char* backend, int backlog, uint64_t packets,
                                 int* rowBytes) {
    static int cachedWidth = 0;
    static int cachedHeight = 0;
    static auto lastDiagnosticsRefresh = std::chrono::steady_clock::time_point{};
    width = std::max(1, width);
    height = std::max(1, height);
    g.statsFps.store(fps, std::memory_order_relaxed);
    g.statsFrameUs.store(frameUs, std::memory_order_relaxed);
    g.pendingCommandSubmits.store(backlog, std::memory_order_relaxed);
    g.statsCmdSubmits.store(packets, std::memory_order_relaxed);
    if (backend && backend[0]) g.backendName = backend;
    const RECT rasterRect = overlayRasterRect(width, height);
    const int rasterWidth = std::max(1L, rasterRect.right - rasterRect.left);
    const int rasterHeight = std::max(1L, rasterRect.bottom - rasterRect.top);
    const int stride = (rasterWidth * 4 + 255) & ~255;
    if (rowBytes) *rowBytes = stride;
    if (!tw_overlay_visible()) return nullptr;
    const bool loading = g.loading.load(std::memory_order_relaxed) != 0;
    const bool menu = !loading && g.overlayOpen.load(std::memory_order_relaxed) != 0;
    const bool fpsOnly = !loading && !menu && g.fpsOverlay.load(std::memory_order_relaxed) != 0;
    if (loading) {
        g.loadingPhase.fetch_add(1, std::memory_order_relaxed);
        g.overlayDirty.store(1, std::memory_order_release);
    }
    const auto now = std::chrono::steady_clock::now();
    const bool sizeChanged = cachedWidth != rasterWidth || cachedHeight != rasterHeight;
    const bool diagnosticsDue = fpsOnly &&
        (lastDiagnosticsRefresh.time_since_epoch().count() == 0 ||
         now - lastDiagnosticsRefresh >= std::chrono::seconds(1));
    const bool dirty = g.overlayDirty.exchange(0, std::memory_order_acq_rel) != 0;
    if (loading || dirty || sizeChanged || diagnosticsDue) {
        if (menu) {
            buildOverlayPixels(width, height, false, rasterRect.left, rasterRect.top,
                               rasterWidth, rasterHeight);
        } else {
            buildOverlayPixels(rasterWidth, rasterHeight, fpsOnly);
        }
        cachedWidth = rasterWidth;
        cachedHeight = rasterHeight;
        if (fpsOnly) lastDiagnosticsRefresh = now;
    }
    return g.overlayPixels.empty() ? nullptr : g.overlayPixels.data();
}

uint64_t tw_overlay_revision(void) {
    return g.overlayRevision.load(std::memory_order_acquire);
}

int tw_set_pointer_lock(int on) {
    try {
        return onWorker([on] {
            setPointerLockOnWindowThread(on != 0);
            return g.pointerLocked.load(std::memory_order_relaxed);
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_poll_input(TWInputEvent* events, int capacity) {
    if (!events || capacity <= 0) return 0;
    std::lock_guard<std::mutex> lock(g.inputMu);
    int count = 0;
    while (count < capacity && !g.inputEvents.empty()) {
        events[count++] = g.inputEvents.front();
        g.inputEvents.pop_front();
    }
    return count;
}

void tw_stats(int* fps, int* frame_us, int* width, int* height, int* vsync, uint64_t* presents) {
    if (fps) *fps = g.statsFps.load(std::memory_order_relaxed);
    if (frame_us) *frame_us = g.statsFrameUs.load(std::memory_order_relaxed);
    if (width) *width = g.statsW.load(std::memory_order_relaxed);
    if (height) *height = g.statsH.load(std::memory_order_relaxed);
    if (vsync) *vsync = g.vsync.load(std::memory_order_relaxed) ? 1 : 0;
    if (presents) *presents = g.statsPresents.load(std::memory_order_relaxed);
}

int tw_is_open(void) {
    return g.open.load(std::memory_order_relaxed);
}

int tw_set_fullscreen(int mode, int width, int height, int refreshHz) {
    try {
        return onWorker([mode, width, height, refreshHz] {
            g.pendingDisplayMode = std::clamp(mode, 0, 2);
            g.pendingDisplayModeDetails = DisplayMode{width, height, refreshHz};
            g.pendingDisplayTransition = true;
            tryApplyPendingDisplayTransition();
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tw_shutdown(void) {
    {
        std::lock_guard<std::mutex> lock(g.mu);
        if (!g.workerStarted) {
            return;
        }
        g.commandGeneration.fetch_add(1, std::memory_order_relaxed);
        g.stop = true;
    }
    g.cv.notify_one();
    if (g.worker.joinable() && std::this_thread::get_id() != g.worker.get_id()) {
        g.worker.join();
    }
    std::lock_guard<std::mutex> lock(g.mu);
    g.workerStarted = false;
}

void tw_reset(void) {
    try {
        ensureWorker();
        {
            std::lock_guard<std::mutex> lock(g.mu);
            if (g.stop) {
                return;
            }
            // Invalidate command jobs already pulled into the worker's local
            // batch, and insert reset before any command from the next page.
            g.commandGeneration.fetch_add(1, std::memory_order_relaxed);
            g.jobs.emplace_back([] { implReset(); });
        }
        g.cv.notify_one();
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

const char* tw_last_error(void) {
    thread_local std::string copy;
    std::lock_guard<std::mutex> lock(g.errMu);
    copy = g.lastError;
    return copy.c_str();
}

const char* tw_backend_name(void) {
    thread_local std::string copy;
    copy = g.backendName;
    return copy.c_str();
}

int tw_gpu_capabilities(TWGpuCapabilities* capabilities) {
    if (!capabilities || capabilities->struct_size < sizeof(TWGpuCapabilities)) return 0;
    const auto streamline = streamlineCapabilities();
    const auto rayQuery = rayQueryBridgeCapabilities();
    TWGpuCapabilities result{};
    result.struct_size = sizeof(result);
    result.vendor_id = g.gpuVendorId;
    result.device_id = g.gpuDeviceId;
    result.is_rtx = g.rtxAdapter ? 1 : 0;
    result.streamline_present = streamline.runtimePresent ? 1 : 0;
    result.streamline_initialized = streamline.initialized ? 1 : 0;
    result.vulkan_attached = streamline.vulkanAttached ? 1 : 0;
    result.dlss_super_resolution = streamline.dlssSuperResolution ? 1 : 0;
    result.dlss_frame_generation = streamline.dlssFrameGeneration ? 1 : 0;
    result.dlss_ray_reconstruction = streamline.dlssRayReconstruction ? 1 : 0;
    result.reflex = streamline.reflex ? 1 : 0;
    std::snprintf(result.adapter_name, sizeof(result.adapter_name), "%s", g.gpuDeviceName.c_str());
    std::snprintf(result.status, sizeof(result.status), "%s", streamline.status.c_str());
    const bool nativeRayTracing = rayQuery.webgpuFeatureEnabled &&
                                  rayQuery.accelerationStructureSupported &&
                                  rayQuery.rayQuerySupported;
    result.native_ray_tracing = nativeRayTracing ? 1 : 0;
    result.ray_query = nativeRayTracing ? 1 : 0;
    *capabilities = result;
    return 1;
}

int tw_request_gpu_features(const TWGpuFeatureRequest* request) {
    if (!request || request->struct_size < sizeof(TWGpuFeatureRequest)) return 0;
    const TWGpuFeatureRequest copy = *request;
    try {
        return onWorker([copy] {
            StreamlineDLSSOptions options{};
            options.mode = copy.dlss_mode <= TW_DLSS_DLAA
                ? static_cast<StreamlineDLSSMode>(copy.dlss_mode)
                : StreamlineDLSSMode::Off;
            options.outputWidth = copy.output_width ? copy.output_width : g.config.width;
            options.outputHeight = copy.output_height ? copy.output_height : g.config.height;
            options.preExposure = copy.pre_exposure;
            options.exposureScale = copy.exposure_scale;
            options.colorBuffersHDR = copy.color_buffers_hdr != 0;
            options.useAutoExposure = copy.auto_exposure != 0;
            options.alphaUpscaling = copy.alpha_upscaling != 0;
            {
                std::lock_guard<std::mutex> lock(g.featureControlMu);
                g.requestedDlssOptions = options;
                g.requestedFrameGeneration = copy.frame_generation != 0;
                g.requestedRayReconstruction = copy.ray_reconstruction != 0;
                g.featureRequestValid = true;
            }
            return applyRuntimeFeatureRequestOnWorker(true) ? 1 : 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_gpu_feature_status(TWGpuFeatureStatus* status) {
    if (!status || status->struct_size < sizeof(TWGpuFeatureStatus)) return 0;
    const StreamlineFeatureState state = runtimeFeatureState();
    const auto rayQuery = rayQueryBridgeCapabilities();
    TWGpuFeatureStatus result{};
    result.struct_size = sizeof(result);
    result.dlss_supported = state.dlssSupported ? 1 : 0;
    result.dlss_api_loaded = state.dlssFunctionsLoaded ? 1 : 0;
    result.dlss_requested = state.dlssRequested ? 1 : 0;
    result.dlss_configured = state.dlssConfigured ? 1 : 0;
    result.dlss_active = state.dlssActive ? 1 : 0;
    result.dlss_mode = static_cast<uint32_t>(state.dlssMode);
    result.render_width = state.renderWidth;
    result.render_height = state.renderHeight;
    result.output_width = state.outputWidth;
    result.output_height = state.outputHeight;
    result.estimated_vram_bytes = state.estimatedVramBytes;
    result.dlss_evaluation_count = state.dlssEvaluationCount;
    result.dlss_failure_count = state.dlssFailureCount;
    result.dlss_last_result = state.dlssLastResult;
    result.frame_generation_supported = state.frameGenerationSupported ? 1 : 0;
    result.frame_generation_api_loaded = state.frameGenerationFunctionsLoaded ? 1 : 0;
    result.frame_generation_requested = state.frameGenerationRequested ? 1 : 0;
    result.frame_generation_configured = state.frameGenerationConfigured ? 1 : 0;
    result.frame_generation_active = state.frameGenerationActive ? 1 : 0;
    result.ray_reconstruction_supported = state.rayReconstructionSupported ? 1 : 0;
    result.ray_reconstruction_api_loaded = state.rayReconstructionFunctionsLoaded ? 1 : 0;
    result.ray_reconstruction_requested = state.rayReconstructionRequested ? 1 : 0;
    result.ray_reconstruction_configured = state.rayReconstructionConfigured ? 1 : 0;
    result.ray_reconstruction_active = state.rayReconstructionActive ? 1 : 0;
    result.ray_reconstruction_evaluation_count =
        state.rayReconstructionEvaluationCount;
    result.ray_reconstruction_failure_count =
        state.rayReconstructionFailureCount;
    result.ray_reconstruction_estimated_vram_bytes =
        state.rayReconstructionEstimatedVramBytes;
    result.ray_reconstruction_last_result =
        state.rayReconstructionLastResult;
    std::snprintf(result.dlss_reason, sizeof(result.dlss_reason), "%s",
                  state.dlssReason.c_str());
    std::snprintf(result.frame_generation_reason, sizeof(result.frame_generation_reason), "%s",
                  state.frameGenerationReason.c_str());
    std::snprintf(result.ray_reconstruction_reason,
                  sizeof(result.ray_reconstruction_reason), "%s",
                  state.rayReconstructionReason.c_str());
    result.native_ray_tracing_supported =
        rayQuery.webgpuFeatureEnabled && rayQuery.accelerationStructureSupported &&
        rayQuery.rayQuerySupported ? 1 : 0;
    result.native_ray_tracing_configured = rayQuery.pipelineReady ? 1 : 0;
    result.native_ray_tracing_active = rayQuery.sceneReady ? 1 : 0;
    std::snprintf(result.native_ray_tracing_reason,
                  sizeof(result.native_ray_tracing_reason), "%s",
                  rayQuery.status ? rayQuery.status : "Ray query status is unavailable");
    *status = result;
    return 1;
}

int tw_dlss_optimal_settings(const TWGpuFeatureRequest* request,
                             TWDLSSOptimalSettings* settings) {
    if (!request || request->struct_size < sizeof(TWGpuFeatureRequest) || !settings ||
        settings->struct_size < sizeof(TWDLSSOptimalSettings)) return 0;
    if (g.dlssRuntimeApplied.load(std::memory_order_acquire) == 0) {
        const uint32_t nativeWidth = request->output_width
            ? request->output_width
            : std::max<uint32_t>(1, g.config.width);
        const uint32_t nativeHeight = request->output_height
            ? request->output_height
            : std::max<uint32_t>(1, g.config.height);
        TWDLSSOptimalSettings result{};
        result.struct_size = sizeof(result);
        result.optimal_render_width = nativeWidth;
        result.optimal_render_height = nativeHeight;
        result.render_width_min = nativeWidth;
        result.render_height_min = nativeHeight;
        result.render_width_max = nativeWidth;
        result.render_height_max = nativeHeight;
        result.optimal_sharpness = 0.0f;
        *settings = result;
        return 1;
    }
    StreamlineDLSSOptions options{};
    options.mode = request->dlss_mode <= TW_DLSS_DLAA
        ? static_cast<StreamlineDLSSMode>(request->dlss_mode)
        : StreamlineDLSSMode::Off;
    options.outputWidth = request->output_width;
    options.outputHeight = request->output_height;
    options.preExposure = request->pre_exposure;
    options.exposureScale = request->exposure_scale;
    options.colorBuffersHDR = request->color_buffers_hdr != 0;
    options.useAutoExposure = request->auto_exposure != 0;
    options.alphaUpscaling = request->alpha_upscaling != 0;
    StreamlineDLSSOptimalSettings native{};
    try {
        if (!onWorker([options, &native] {
                return streamlineDLSSGetOptimalSettings(options, native);
            })) return 0;
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
    TWDLSSOptimalSettings result{};
    result.struct_size = sizeof(result);
    result.optimal_render_width = native.optimalRenderWidth;
    result.optimal_render_height = native.optimalRenderHeight;
    result.render_width_min = native.renderWidthMin;
    result.render_height_min = native.renderHeightMin;
    result.render_width_max = native.renderWidthMax;
    result.render_height_max = native.renderHeightMax;
    result.optimal_sharpness = native.optimalSharpness;
    *settings = result;
    return 1;
}

int tw_dlss_evaluate(const TWDLSSFrame* frame) {
    if (!frame || frame->struct_size < sizeof(TWDLSSFrame)) return 0;
    if (g.dlssRuntimeApplied.load(std::memory_order_acquire) == 0) return 0;
#if !defined(THREEBROWSER_STREAMLINE)
    (void)frame;
    return 0;
#else
    const TWDLSSFrame copy = *frame;
    try {
        return onWorker([copy] {
            if (g.dlssRuntimeApplied.load(std::memory_order_acquire) == 0) return 0;
            endPasses();
            WGPUCommandEncoder encoder = g.currentEncoder;
            if (copy.command_encoder_handle) {
                Slot* slot = getSlot(copy.command_encoder_handle);
                encoder = slot && slot->kind == Kind::Encoder ? slot->encoder : nullptr;
            }
            if (!encoder) {
                setError("DLSS evaluation requires an active WebGPU command encoder");
                return 0;
            }
            StreamlineDLSSFrame native{};
            native.viewport = copy.viewport;
            std::string error;
            if (!makeStreamlineResource(copy.color_input, false, false,
                                        native.colorInput, error) ||
                !makeStreamlineResource(copy.color_output, false, true,
                                        native.colorOutput, error) ||
                !makeStreamlineResource(copy.depth, true, false, native.depth, error) ||
                !makeStreamlineResource(copy.motion_vectors, false, false,
                                        native.motionVectors, error) ||
                (copy.has_exposure && !makeStreamlineResource(copy.exposure, false, false,
                                                               native.exposure, error))) {
                setError(error.c_str());
                return 0;
            }
            native.hasExposure = copy.has_exposure != 0;
            copyConstants(copy.constants, native.constants);
            struct Evaluation {
                StreamlineDLSSFrame* frame;
                bool result{};
            } evaluation{&native, false};
            const WGPUStatus status = wgpuCommandEncoderWithNativeVulkanCommandBuffer(
                encoder,
                [](void* commandBuffer, void* userdata) {
                    auto* value = static_cast<Evaluation*>(userdata);
                    value->frame->commandBuffer = commandBuffer;
                    value->result = streamlineDLSSEvaluate(*value->frame);
                },
                &evaluation);
            if (status != WGPUStatus_Success || !evaluation.result) {
                if (status != WGPUStatus_Success) {
                    setError("wgpu-native rejected the native DLSS command-buffer callback");
                }
                return 0;
            }
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
#endif
}

int tw_ray_reconstruction_evaluate(const TWRayReconstructionFrame* frame) {
    if (!frame || frame->struct_size < sizeof(TWRayReconstructionFrame)) return 0;
    if (g.rayReconstructionRuntimeApplied.load(std::memory_order_acquire) == 0 ||
        g.dlssRuntimeApplied.load(std::memory_order_acquire) == 0) return 0;
#if !defined(THREEBROWSER_STREAMLINE)
    setError("DLSS Ray Reconstruction support was not compiled into this build");
    return 0;
#else
    const TWRayReconstructionFrame copy = *frame;
    try {
        return onWorker([copy] {
            if (g.rayReconstructionRuntimeApplied.load(std::memory_order_acquire) == 0 ||
                g.dlssRuntimeApplied.load(std::memory_order_acquire) == 0) return 0;
            endPasses();
            WGPUCommandEncoder encoder = g.currentEncoder;
            if (copy.command_encoder_handle) {
                Slot* slot = getSlot(copy.command_encoder_handle);
                encoder = slot && slot->kind == Kind::Encoder ? slot->encoder : nullptr;
            }
            if (!encoder) {
                setError("Ray Reconstruction evaluation requires an active WebGPU command encoder");
                return 0;
            }
            const bool packedNormalRoughness = copy.normal_roughness_packed != 0;
            const bool hasRoughness = copy.has_roughness != 0;
            const bool hasSpecularMotion = copy.has_specular_motion_vectors != 0;
            const bool hasSpecularHitDistance = copy.has_specular_hit_distance != 0;
            if (packedNormalRoughness == hasRoughness) {
                setError("Ray Reconstruction requires packed normal/roughness or separate normal and roughness inputs");
                return 0;
            }
            if (hasSpecularMotion == hasSpecularHitDistance) {
                setError("Ray Reconstruction requires exactly one specular reflection motion guide");
                return 0;
            }
            if (copy.noisy_color.texture_handle == copy.color_output.texture_handle) {
                setError("Ray Reconstruction noisy input and denoised output must be different textures");
                return 0;
            }
            if (hasSpecularHitDistance &&
                (!finiteMatrix(copy.world_to_camera_view) ||
                 !finiteMatrix(copy.camera_view_to_world) ||
                 (std::all_of(copy.world_to_camera_view,
                              copy.world_to_camera_view + 16,
                              [](float value) { return value == 0.0f; })) ||
                 (std::all_of(copy.camera_view_to_world,
                              copy.camera_view_to_world + 16,
                              [](float value) { return value == 0.0f; })))) {
                setError("Specular hit distance requires finite, non-zero world/view matrices");
                return 0;
            }

            std::string error;
            const auto validateFormat = [&error](const TWDLSSResource& resource,
                                                 RayReconstructionResourceKind kind,
                                                 const char* name) {
                return validateRayReconstructionFormat(resource.texture_handle, kind,
                                                       name, error);
            };
            if (!validateFormat(copy.noisy_color,
                                RayReconstructionResourceKind::HdrColor,
                                "noisy HDR color") ||
                !validateFormat(copy.color_output,
                                RayReconstructionResourceKind::HdrColor,
                                "denoised output") ||
                !validateFormat(copy.depth, RayReconstructionResourceKind::Depth,
                                "depth") ||
                !validateFormat(copy.motion_vectors,
                                RayReconstructionResourceKind::MotionVectors,
                                "dense motion vectors") ||
                !validateFormat(copy.diffuse_albedo,
                                RayReconstructionResourceKind::LinearAlbedo,
                                "diffuse albedo") ||
                !validateFormat(copy.specular_albedo,
                                RayReconstructionResourceKind::LinearAlbedo,
                                "specular albedo") ||
                !validateFormat(copy.normal_roughness,
                                RayReconstructionResourceKind::Normal,
                                packedNormalRoughness ? "packed normal/roughness" : "normals") ||
                (hasRoughness &&
                 !validateFormat(copy.roughness,
                                 RayReconstructionResourceKind::Scalar,
                                 "roughness")) ||
                (hasSpecularMotion &&
                 !validateFormat(copy.specular_motion_vectors,
                                 RayReconstructionResourceKind::MotionVectors,
                                 "specular motion vectors")) ||
                (hasSpecularHitDistance &&
                 !validateFormat(copy.specular_hit_distance,
                                 RayReconstructionResourceKind::Scalar,
                                 "specular hit distance"))) {
                setError(error.c_str());
                return 0;
            }

            StreamlineRayReconstructionFrame native{};
            native.viewport = copy.viewport;
            if (!makeStreamlineResource(copy.noisy_color, false, false,
                                        native.noisyColor, error) ||
                !makeStreamlineResource(copy.color_output, false, true,
                                        native.colorOutput, error) ||
                !makeStreamlineResource(copy.depth, true, false,
                                        native.depth, error) ||
                !makeStreamlineResource(copy.motion_vectors, false, false,
                                        native.motionVectors, error) ||
                !makeStreamlineResource(copy.diffuse_albedo, false, false,
                                        native.diffuseAlbedo, error) ||
                !makeStreamlineResource(copy.specular_albedo, false, false,
                                        native.specularAlbedo, error) ||
                !makeStreamlineResource(copy.normal_roughness, false, false,
                                        native.normalRoughness, error) ||
                (hasRoughness &&
                 !makeStreamlineResource(copy.roughness, false, false,
                                         native.roughness, error)) ||
                (hasSpecularMotion &&
                 !makeStreamlineResource(copy.specular_motion_vectors, false, false,
                                         native.specularMotionVectors, error)) ||
                (hasSpecularHitDistance &&
                 !makeStreamlineResource(copy.specular_hit_distance, false, false,
                                         native.specularHitDistance, error))) {
                setError(error.c_str());
                return 0;
            }

            const auto extentWidth = [](const StreamlineVulkanResource& resource) {
                return resource.extentWidth ? resource.extentWidth : resource.width;
            };
            const auto extentHeight = [](const StreamlineVulkanResource& resource) {
                return resource.extentHeight ? resource.extentHeight : resource.height;
            };
            const uint32_t inputWidth = extentWidth(native.noisyColor);
            const uint32_t inputHeight = extentHeight(native.noisyColor);
            const auto matchesInput = [inputWidth, inputHeight, &extentWidth, &extentHeight](
                                          const StreamlineVulkanResource& resource) {
                return extentWidth(resource) == inputWidth &&
                       extentHeight(resource) == inputHeight;
            };
            if (!matchesInput(native.depth) || !matchesInput(native.motionVectors) ||
                !matchesInput(native.diffuseAlbedo) ||
                !matchesInput(native.specularAlbedo) ||
                !matchesInput(native.normalRoughness) ||
                (hasRoughness && !matchesInput(native.roughness)) ||
                (hasSpecularMotion && !matchesInput(native.specularMotionVectors)) ||
                (hasSpecularHitDistance && !matchesInput(native.specularHitDistance))) {
                setError("Every Ray Reconstruction guide must match the noisy input extent");
                return 0;
            }
            const StreamlineFeatureState featureState = streamlineFeatureState();
            if (featureState.outputWidth && featureState.outputHeight &&
                (extentWidth(native.colorOutput) != featureState.outputWidth ||
                 extentHeight(native.colorOutput) != featureState.outputHeight)) {
                setError("Ray Reconstruction output extent does not match the configured DLSS output size");
                return 0;
            }

            native.normalRoughnessPacked = packedNormalRoughness;
            native.hasRoughness = hasRoughness;
            native.hasSpecularMotionVectors = hasSpecularMotion;
            native.hasSpecularHitDistance = hasSpecularHitDistance;
            std::copy_n(copy.world_to_camera_view, 16,
                        native.worldToCameraView.begin());
            std::copy_n(copy.camera_view_to_world, 16,
                        native.cameraViewToWorld.begin());
            copyConstants(copy.constants, native.constants);

            struct Evaluation {
                StreamlineRayReconstructionFrame* frame;
                bool result{};
            } evaluation{&native, false};
            const WGPUStatus status = wgpuCommandEncoderWithNativeVulkanCommandBuffer(
                encoder,
                [](void* commandBuffer, void* userdata) {
                    auto* value = static_cast<Evaluation*>(userdata);
                    value->frame->commandBuffer = commandBuffer;
                    value->result =
                        streamlineRayReconstructionEvaluate(*value->frame);
                },
                &evaluation);
            if (status != WGPUStatus_Success || !evaluation.result) {
                if (status != WGPUStatus_Success) {
                    setError("wgpu-native rejected the native Ray Reconstruction command-buffer callback");
                } else {
                    const StreamlineFeatureState failed = streamlineFeatureState();
                    setError(failed.rayReconstructionReason.c_str());
                }
                return 0;
            }
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
#endif
}

int tw_frame_generation_tag(const TWFrameGenerationFrame* frame) {
    if (!frame || frame->struct_size < sizeof(TWFrameGenerationFrame)) return 0;
    if (g.frameGenerationRuntimeApplied.load(std::memory_order_acquire) == 0) return 0;
#if !defined(THREEBROWSER_STREAMLINE)
    (void)frame;
    return 0;
#else
    const TWFrameGenerationFrame copy = *frame;
    try {
        return onWorker([copy] {
            if (g.frameGenerationRuntimeApplied.load(std::memory_order_acquire) == 0) return 0;
            if (g.vsync.load(std::memory_order_relaxed) != 0) {
                streamlineSuspendFrameGeneration(
                    "Frame Generation is suspended because Vulkan VSync is enabled",
                    false);
                setError("DLSS Frame Generation with VSync is not supported on Vulkan");
                return 0;
            }
            endPasses();
            WGPUCommandEncoder encoder = g.currentEncoder;
            if (copy.command_encoder_handle) {
                Slot* slot = getSlot(copy.command_encoder_handle);
                encoder = slot && slot->kind == Kind::Encoder ? slot->encoder : nullptr;
            }
            if (!encoder) {
                setError("Frame Generation tagging requires an active WebGPU command encoder");
                return 0;
            }
            StreamlineFrameGenerationFrame native{};
            native.viewport = copy.viewport;
            std::string error;
            if (!makeStreamlineResource(copy.hudless_color, false, false,
                                        native.hudlessColor, error) ||
                !makeStreamlineResource(copy.depth, true, false, native.depth, error) ||
                !makeStreamlineResource(copy.motion_vectors, false, false,
                                        native.motionVectors, error) ||
                (copy.has_ui && !makeStreamlineResource(copy.ui, false, false,
                                                        native.ui, error))) {
                setError(error.c_str());
                return 0;
            }
            native.hasUi = copy.has_ui != 0;
            native.uiAlphaOnly = copy.ui_alpha_only != 0;
            native.backbufferWidth = g.config.width;
            native.backbufferHeight = g.config.height;
            native.backbufferFormat = static_cast<uint32_t>(
                toVulkanFormat(g.surfaceFormat));
            native.framesToGenerate = copy.frames_to_generate
                ? copy.frames_to_generate
                : 1u;
            if (!native.backbufferFormat) {
                setError("Frame Generation does not support the active swapchain format");
                return 0;
            }
            copyConstants(copy.constants, native.constants);
            struct Tagging {
                StreamlineFrameGenerationFrame* frame;
                bool result{};
            } tagging{&native, false};
            const WGPUStatus status = wgpuCommandEncoderWithNativeVulkanCommandBuffer(
                encoder,
                [](void* commandBuffer, void* userdata) {
                    auto* value = static_cast<Tagging*>(userdata);
                    value->frame->commandBuffer = commandBuffer;
                    value->result = streamlineFrameGenerationTag(*value->frame);
                },
                &tagging);
            if (status != WGPUStatus_Success || !tagging.result) {
                if (status != WGPUStatus_Success) {
                    setError("wgpu-native rejected the native Frame Generation tag callback");
                }
                return 0;
            }
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
#endif
}

int tw_frame_generation_status(TWFrameGenerationStatus* status) {
    if (!status || status->struct_size < sizeof(TWFrameGenerationStatus)) return 0;
    const StreamlineFeatureState state = runtimeFeatureState();
    TWFrameGenerationStatus result{};
    result.struct_size = sizeof(result);
    result.supported = state.frameGenerationSupported ? 1 : 0;
    result.api_loaded = state.frameGenerationFunctionsLoaded ? 1 : 0;
    result.requested = state.frameGenerationRequested ? 1 : 0;
    result.configured = state.frameGenerationConfigured ? 1 : 0;
    result.active = state.frameGenerationActive ? 1 : 0;
    result.frames_to_generate = state.frameGenerationFramesToGenerate;
    result.frames_to_generate_max = state.frameGenerationFramesToGenerateMax;
    result.last_frames_presented = state.frameGenerationLastFramesPresented;
    result.generated_frame_count = state.frameGenerationPresentedFrameCount;
    result.failure_count = state.frameGenerationFailureCount;
    result.estimated_vram_bytes = state.frameGenerationEstimatedVramBytes;
    result.last_result = state.frameGenerationLastResult;
    result.last_status = state.frameGenerationLastStatus;
    std::snprintf(result.reason, sizeof(result.reason), "%s",
                  state.frameGenerationReason.c_str());
    *status = result;
    return 1;
}

void tw_dlss_release_viewport(uint32_t viewport) {
    try {
        onWorker([viewport] {
            streamlineReleaseViewport(viewport);
            // Viewport 0 is the browser's retained swapchain contract.  Reapply
            // the page's request only after its old Streamline resources have
            // been released, while preserving the runtime-control gates.
            if (viewport == 0) applyRuntimeFeatureRequestOnWorker(true);
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

int tw_set_reflex_mode(int mode) {
    if (mode < 0 || mode > 2) {
        setError("Reflex mode must be 0 (Off), 1 (On), or 2 (On + Boost)");
        return 0;
    }
    const int requestedMode = mode;
    {
        std::lock_guard<std::mutex> lock(g.featureControlMu);
        g.requestedReflexMode = requestedMode;
    }
    if (g.reflexRuntimeApplied.load(std::memory_order_acquire) == 0) {
        return 1;
    }
    try {
        return onWorker([requestedMode] {
            const bool result = streamlineSetReflexMode(requestedMode);
            if (result) g.reflexRuntimeApplied.store(1, std::memory_order_release);
            return result ? 1 : 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_reflex_mode(void) {
    return g.reflexRuntimeApplied.load(std::memory_order_acquire) != 0
        ? streamlineReflexMode()
        : 0;
}

int tw_ray_query_capabilities(TWRayQueryCapabilities* capabilities) {
    if (!capabilities || capabilities->struct_size < sizeof(TWRayQueryCapabilities)) return 0;
    const auto native = rayQueryBridgeCapabilities();
    TWRayQueryCapabilities result{};
    result.struct_size = sizeof(result);
    result.supported = native.webgpuFeatureEnabled &&
                       native.accelerationStructureSupported &&
                       native.rayQuerySupported ? 1 : 0;
    result.configured = native.pipelineReady ? 1 : 0;
    result.active = native.sceneReady ? 1 : 0;
    result.webgpu_feature_enabled = native.webgpuFeatureEnabled ? 1 : 0;
    result.acceleration_structure_supported =
        native.accelerationStructureSupported ? 1 : 0;
    result.ray_query_supported = native.rayQuerySupported ? 1 : 0;
    result.triangle_count = native.triangleCount;
    result.build_count = native.buildCount;
    result.evaluation_count = native.evaluationCount;
    result.failure_count = native.failureCount;
    std::snprintf(result.reason, sizeof(result.reason), "%s",
                  native.status ? native.status : "Ray query status is unavailable");
    *capabilities = result;
    return 1;
}

int tw_ray_query_scene_begin(void) {
    try {
        return onWorker([] {
            rayQueryBridgeSceneBegin();
            return rayQueryBridgeCapabilities().vulkanAttached ? 1 : 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_ray_query_scene_positions(const float* xyz, uint32_t vertexCount) {
    if (!xyz || vertexCount == 0) return 0;
    try {
        return onWorker([xyz, vertexCount] {
            const bool result = rayQueryBridgeSetPositions(xyz, vertexCount);
            if (!result) setError(rayQueryBridgeCapabilities().status);
            return result ? 1 : 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_ray_query_scene_indices(const uint32_t* indices, uint32_t indexCount) {
    if (!indices || indexCount == 0) return 0;
    try {
        return onWorker([indices, indexCount] {
            const bool result = rayQueryBridgeSetIndices(indices, indexCount);
            if (!result) setError(rayQueryBridgeCapabilities().status);
            return result ? 1 : 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_ray_query_scene_triangle_radiance(const float* rgba,
                                         uint32_t triangleCount) {
    if (!rgba || triangleCount == 0) return 0;
    try {
        return onWorker([rgba, triangleCount] {
            const bool result = rayQueryBridgeSetTriangleRadiance(rgba, triangleCount);
            if (!result) setError(rayQueryBridgeCapabilities().status);
            return result ? 1 : 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_ray_query_scene_triangle_surface(const float* albedoRoughness,
                                        uint32_t triangleCount) {
    if (!albedoRoughness || triangleCount == 0) return 0;
    try {
        return onWorker([albedoRoughness, triangleCount] {
            const bool result = rayQueryBridgeSetTriangleSurface(
                albedoRoughness, triangleCount);
            if (!result) setError(rayQueryBridgeCapabilities().status);
            return result ? 1 : 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_ray_query_scene_lights(const float* lightRecords,
                              uint32_t lightCount) {
    if (!lightRecords || lightCount == 0 || lightCount > 8) return 0;
    try {
        return onWorker([lightRecords, lightCount] {
            const bool result = rayQueryBridgeSetStaticLights(
                lightRecords, lightCount);
            if (!result) setError(rayQueryBridgeCapabilities().status);
            return result ? 1 : 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_ray_query_scene_instance_group(uint32_t id, uint32_t capacity,
                                      uint32_t vertexOffset,
                                      uint32_t vertexCount,
                                      uint32_t indexOffset,
                                      uint32_t indexCount,
                                      uint32_t primitiveBase) {
    if (id == 0u || capacity == 0u || capacity > 1024u ||
        vertexCount == 0u || indexCount == 0u || indexCount % 3u != 0u) {
        return 0;
    }
    try {
        return onWorker([=] {
            const bool result = rayQueryBridgeAddInstanceGroup(
                id, capacity, vertexOffset, vertexCount, indexOffset,
                indexCount, primitiveBase);
            if (!result) setError(rayQueryBridgeCapabilities().status);
            return result ? 1 : 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_ray_query_scene_commit(uint32_t commandEncoderHandle) {
#if !defined(THREEBROWSER_RAY_QUERY)
    (void)commandEncoderHandle;
    return 0;
#else
    try {
        return onWorker([commandEncoderHandle] {
            endPasses();
            WGPUCommandEncoder encoder = g.currentEncoder;
            if (commandEncoderHandle) {
                Slot* slot = getSlot(commandEncoderHandle);
                encoder = slot && slot->kind == Kind::Encoder ? slot->encoder : nullptr;
            }
            if (!encoder) {
                setError("Ray-query scene commit requires an active WebGPU command encoder");
                return 0;
            }
            struct Build {
                bool result{};
            } build{};
            const WGPUStatus status = wgpuCommandEncoderWithNativeVulkanCommandBuffer(
                encoder,
                [](void* commandBuffer, void* userdata) {
                    auto* value = static_cast<Build*>(userdata);
                    value->result = rayQueryBridgeCommit(commandBuffer);
                },
                &build);
            if (status != WGPUStatus_Success || !build.result) {
                const auto rayQuery = rayQueryBridgeCapabilities();
                setError(status != WGPUStatus_Success
                    ? "wgpu-native rejected the Vulkan BLAS/TLAS recording callback"
                    : rayQuery.status);
                return 0;
            }
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
#endif
}

int tw_ray_query_instance_group_update(uint32_t commandEncoderHandle,
                                       uint32_t id,
                                       const float* matrices3x4,
                                       const uint32_t* masks,
                                       uint32_t instanceCount) {
#if !defined(THREEBROWSER_RAY_QUERY)
    (void)commandEncoderHandle;
    (void)id;
    (void)matrices3x4;
    (void)masks;
    (void)instanceCount;
    return 0;
#else
    if (id == 0u || !matrices3x4 || !masks || instanceCount == 0u ||
        instanceCount > 1024u) {
        return 0;
    }
    try {
        return onWorker([=] {
            endPasses();
            WGPUCommandEncoder encoder = g.currentEncoder;
            if (commandEncoderHandle) {
                Slot* slot = getSlot(commandEncoderHandle);
                encoder = slot && slot->kind == Kind::Encoder
                    ? slot->encoder
                    : nullptr;
            }
            if (!encoder) {
                setError("RTX instance-group update requires an active WebGPU command encoder");
                return 0;
            }
            struct Update {
                uint32_t id{};
                const float* matrices{};
                const uint32_t* masks{};
                uint32_t count{};
                bool result{};
            } update{id, matrices3x4, masks, instanceCount, false};
            const WGPUStatus status = wgpuCommandEncoderWithNativeVulkanCommandBuffer(
                encoder,
                [](void* commandBuffer, void* userdata) {
                    auto* value = static_cast<Update*>(userdata);
                    value->result = rayQueryBridgeUpdateInstanceGroup(
                        commandBuffer, value->id, value->matrices,
                        value->masks, value->count);
                },
                &update);
            if (status != WGPUStatus_Success || !update.result) {
                const auto rayQuery = rayQueryBridgeCapabilities();
                setError(status != WGPUStatus_Success
                    ? "wgpu-native rejected the Vulkan TLAS refit recording callback"
                    : rayQuery.status);
                return 0;
            }
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
#endif
}

void tw_ray_query_scene_destroy(void) {
    try {
        onWorker([] { rayQueryBridgeDestroyScene(); });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

int tw_ray_query_lighting_evaluate(const TWRayQueryLightingFrame* frame) {
    static_assert(sizeof(TWRayQueryLightingFrame) == 164u);
    if (!frame || frame->struct_size < sizeof(TWRayQueryLightingFrame)) return 0;
    const TWRayQueryLightingFrame legacy = *frame;
    TWRayQueryLightingFrameV2 upgraded{};
    upgraded.struct_size = sizeof(upgraded);
    upgraded.command_encoder_handle = legacy.command_encoder_handle;
    upgraded.color_texture_handle = legacy.color_texture_handle;
    upgraded.color_vulkan_layout = legacy.color_vulkan_layout;
    upgraded.depth_texture_handle = legacy.depth_texture_handle;
    upgraded.depth_vulkan_layout = legacy.depth_vulkan_layout;
    upgraded.width = legacy.width;
    upgraded.height = legacy.height;
    std::copy_n(legacy.inverse_view_projection, 16, upgraded.inverse_view_projection);
    std::copy_n(legacy.camera_position, 4, upgraded.camera_position);
    std::copy_n(legacy.sun_direction_intensity, 4,
                upgraded.directional_light_direction_intensity);
    upgraded.directional_visibility_strength = legacy.parameters[0];
    upgraded.ao_strength = legacy.parameters[1];
    upgraded.ao_radius = legacy.parameters[2];
    upgraded.directional_angular_radius = 0.0065f;
    upgraded.flags = legacy.flags & 1u;
    upgraded.max_distance = 10000.0f;
    upgraded.ray_bias = std::max(0.002f, legacy.parameters[2] * 0.002f);
    const bool highQuality = (legacy.flags & 2u) != 0u;
    upgraded.directional_sample_count = highQuality ? 4u : 1u;
    upgraded.ao_sample_count = highQuality ? 8u : 2u;
    return tw_ray_query_lighting_evaluate_v2(&upgraded);
}

int tw_ray_query_lighting_evaluate_v2(const TWRayQueryLightingFrameV2* frame) {
    static_assert(sizeof(TWRayQueryLightingFrameV2) == 172u);
    if (!frame || frame->struct_size < sizeof(TWRayQueryLightingFrameV2)) return 0;
#if !defined(THREEBROWSER_RAY_QUERY)
    (void)frame;
    return 0;
#else
    const TWRayQueryLightingFrameV2 copy = *frame;
    const auto acceptedColorLayout = [](uint32_t value) {
        switch (static_cast<VkImageLayout>(value)) {
            case VK_IMAGE_LAYOUT_GENERAL:
            case VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL:
            case VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL:
            case VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL:
            case VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL:
                return true;
            default:
                return false;
        }
    };
    const auto acceptedDepthLayout = [](uint32_t value) {
        switch (static_cast<VkImageLayout>(value)) {
            case VK_IMAGE_LAYOUT_GENERAL:
            case VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL:
            case VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL:
            case VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL:
            case VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL:
            case VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL:
                return true;
            default:
                return false;
        }
    };
    if (!acceptedColorLayout(copy.color_vulkan_layout)) {
        setError("Ray-query lighting received an unsupported color VkImageLayout");
        return 0;
    }
    if (!acceptedDepthLayout(copy.depth_vulkan_layout)) {
        setError("Ray-query lighting received an unsupported depth VkImageLayout");
        return 0;
    }
    try {
        return onWorker([copy] {
            endPasses();
            WGPUCommandEncoder encoder = g.currentEncoder;
            if (copy.command_encoder_handle) {
                Slot* slot = getSlot(copy.command_encoder_handle);
                encoder = slot && slot->kind == Kind::Encoder ? slot->encoder : nullptr;
            }
            Slot* color = getSlot(copy.color_texture_handle);
            Slot* depth = getSlot(copy.depth_texture_handle);
            if (!encoder || !color || color->kind != Kind::Texture ||
                !depth || depth->kind != Kind::Texture) {
                setError("Ray-query lighting received an invalid encoder or texture handle");
                return 0;
            }
            if (color->texFormat != WGPUTextureFormat_RGBA16Float ||
                (color->texUsage & WGPUTextureUsage_StorageBinding) == 0 ||
                depth->texFormat != WGPUTextureFormat_Depth32Float ||
                (depth->texUsage & WGPUTextureUsage_TextureBinding) == 0) {
                setError("Ray-query lighting requires rgba16float STORAGE_BINDING color and depth32float TEXTURE_BINDING depth");
                return 0;
            }
            if (copy.width == 0 || copy.height == 0 ||
                copy.width > color->texW || copy.height > color->texH ||
                copy.width > depth->texW || copy.height > depth->texH) {
                setError("Ray-query lighting extent exceeds its color or depth texture");
                return 0;
            }
            RayQueryLightingFrame native{};
            native.colorImage = wgpuTextureGetNativeVulkanImage(color->texture);
            native.colorLayout = copy.color_vulkan_layout;
            native.depthImage = wgpuTextureGetNativeVulkanImage(depth->texture);
            native.depthLayout = copy.depth_vulkan_layout;
            native.width = copy.width;
            native.height = copy.height;
            std::copy_n(copy.inverse_view_projection, 16, native.inverseViewProjection);
            std::copy_n(copy.camera_position, 4, native.cameraPosition);
            std::copy_n(copy.directional_light_direction_intensity, 4,
                        native.directionalLightDirectionIntensity);
            native.directionalVisibilityStrength =
                copy.directional_visibility_strength;
            native.aoStrength = copy.ao_strength;
            native.aoRadius = copy.ao_radius;
            native.directionalAngularRadius = copy.directional_angular_radius;
            native.maxDistance = copy.max_distance;
            native.rayBias = copy.ray_bias;
            native.directionalSampleCount = copy.directional_sample_count;
            native.aoSampleCount = copy.ao_sample_count;
            native.frameIndex = copy.frame_index;
            native.pipelineHandle = copy.pipeline_handle;
            native.flags = copy.flags;
            struct Evaluation {
                RayQueryLightingFrame* frame;
                bool result{};
            } evaluation{&native, false};
            const WGPUStatus status = wgpuCommandEncoderWithNativeVulkanCommandBuffer(
                encoder,
                [](void* commandBuffer, void* userdata) {
                    auto* value = static_cast<Evaluation*>(userdata);
                    value->frame->commandBuffer = commandBuffer;
                    value->result = rayQueryBridgeEvaluate(*value->frame);
                },
                &evaluation);
            if (status != WGPUStatus_Success || !evaluation.result) {
                const auto rayQuery = rayQueryBridgeCapabilities();
                setError(status != WGPUStatus_Success
                    ? "wgpu-native rejected the Vulkan ray-query lighting callback"
                    : rayQuery.status);
                return 0;
            }
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
#endif
}

int tw_ray_query_reflections_evaluate(const TWRayQueryReflectionFrame* frame) {
    static_assert(sizeof(TWRayQueryReflectionFrame) == 176u);
    if (!frame || frame->struct_size < sizeof(TWRayQueryReflectionFrame)) return 0;
    const TWRayQueryReflectionFrame legacy = *frame;
    TWRayQueryReflectionFrameV2 upgraded{};
    upgraded.struct_size = sizeof(upgraded);
    upgraded.command_encoder_handle = legacy.command_encoder_handle;
    upgraded.source_color_texture_handle = legacy.source_color_texture_handle;
    upgraded.source_color_vulkan_layout = legacy.source_color_vulkan_layout;
    upgraded.output_color_texture_handle = legacy.output_color_texture_handle;
    upgraded.output_color_vulkan_layout = legacy.output_color_vulkan_layout;
    upgraded.depth_texture_handle = legacy.depth_texture_handle;
    upgraded.depth_vulkan_layout = legacy.depth_vulkan_layout;
    upgraded.normal_roughness_texture_handle = legacy.normal_roughness_texture_handle;
    upgraded.normal_roughness_vulkan_layout = legacy.normal_roughness_vulkan_layout;
    upgraded.specular_albedo_texture_handle = legacy.specular_albedo_texture_handle;
    upgraded.specular_albedo_vulkan_layout = legacy.specular_albedo_vulkan_layout;
    upgraded.width = legacy.width;
    upgraded.height = legacy.height;
    std::copy_n(legacy.inverse_view_projection, 16, upgraded.inverse_view_projection);
    std::copy_n(legacy.camera_position, 4, upgraded.camera_position);
    std::copy_n(legacy.parameters, 4, upgraded.parameters);
    std::copy_n(legacy.environment, 4, upgraded.environment);
    upgraded.flags = legacy.flags;
    upgraded.frame_index = legacy.frame_index;
    return tw_ray_query_reflections_evaluate_v2(&upgraded);
}

int tw_ray_query_reflections_evaluate_v2(const TWRayQueryReflectionFrameV2* frame) {
    static_assert(sizeof(TWRayQueryReflectionFrameV2) == 180u);
    if (!frame || frame->struct_size < sizeof(TWRayQueryReflectionFrameV2)) return 0;
    const TWRayQueryReflectionFrameV2 legacy = *frame;
    TWRayQueryReflectionFrameV3 upgraded{};
    upgraded.struct_size = sizeof(upgraded);
    upgraded.command_encoder_handle = legacy.command_encoder_handle;
    upgraded.source_color_texture_handle = legacy.source_color_texture_handle;
    upgraded.source_color_vulkan_layout = legacy.source_color_vulkan_layout;
    upgraded.output_color_texture_handle = legacy.output_color_texture_handle;
    upgraded.output_color_vulkan_layout = legacy.output_color_vulkan_layout;
    upgraded.depth_texture_handle = legacy.depth_texture_handle;
    upgraded.depth_vulkan_layout = legacy.depth_vulkan_layout;
    upgraded.normal_roughness_texture_handle = legacy.normal_roughness_texture_handle;
    upgraded.normal_roughness_vulkan_layout = legacy.normal_roughness_vulkan_layout;
    upgraded.specular_albedo_texture_handle = legacy.specular_albedo_texture_handle;
    upgraded.specular_albedo_vulkan_layout = legacy.specular_albedo_vulkan_layout;
    upgraded.width = legacy.width;
    upgraded.height = legacy.height;
    std::copy_n(legacy.inverse_view_projection, 16, upgraded.inverse_view_projection);
    std::copy_n(legacy.camera_position, 4, upgraded.camera_position);
    std::copy_n(legacy.parameters, 4, upgraded.parameters);
    std::copy_n(legacy.environment, 4, upgraded.environment);
    upgraded.flags = legacy.flags;
    upgraded.frame_index = legacy.frame_index;
    upgraded.pipeline_handle = legacy.pipeline_handle;
    return tw_ray_query_reflections_evaluate_v3(&upgraded);
}

int tw_ray_query_reflections_evaluate_v3(const TWRayQueryReflectionFrameV3* frame) {
    static_assert(sizeof(TWRayQueryReflectionFrameV3) == 188u);
    if (!frame || frame->struct_size < sizeof(TWRayQueryReflectionFrameV3)) return 0;
#if !defined(THREEBROWSER_RAY_QUERY)
    (void)frame;
    return 0;
#else
    const TWRayQueryReflectionFrameV3 copy = *frame;
    const auto acceptedColorLayout = [](uint32_t value) {
        switch (static_cast<VkImageLayout>(value)) {
            case VK_IMAGE_LAYOUT_GENERAL:
            case VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL:
            case VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL:
            case VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL:
            case VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL:
                return true;
            default:
                return false;
        }
    };
    const auto acceptedDepthLayout = [](uint32_t value) {
        switch (static_cast<VkImageLayout>(value)) {
            case VK_IMAGE_LAYOUT_GENERAL:
            case VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL:
            case VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL:
            case VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL:
            case VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL:
            case VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL:
                return true;
            default:
                return false;
        }
    };
    if (!acceptedColorLayout(copy.source_color_vulkan_layout) ||
        !acceptedColorLayout(copy.output_color_vulkan_layout) ||
        !acceptedColorLayout(copy.normal_roughness_vulkan_layout) ||
        !acceptedColorLayout(copy.specular_albedo_vulkan_layout) ||
        (copy.specular_hit_distance_texture_handle != 0u &&
         !acceptedColorLayout(copy.specular_hit_distance_vulkan_layout))) {
        setError("Ray-query reflections received an unsupported color VkImageLayout");
        return 0;
    }
    if (copy.specular_hit_distance_texture_handle == 0u &&
        copy.specular_hit_distance_vulkan_layout != 0u) {
        setError("Ray-query reflections received a hit-distance layout without a texture");
        return 0;
    }
    if (!acceptedDepthLayout(copy.depth_vulkan_layout)) {
        setError("Ray-query reflections received an unsupported depth VkImageLayout");
        return 0;
    }
    try {
        return onWorker([copy] {
            endPasses();
            WGPUCommandEncoder encoder = g.currentEncoder;
            if (copy.command_encoder_handle) {
                Slot* slot = getSlot(copy.command_encoder_handle);
                encoder = slot && slot->kind == Kind::Encoder ? slot->encoder : nullptr;
            }
            Slot* source = getSlot(copy.source_color_texture_handle);
            Slot* output = getSlot(copy.output_color_texture_handle);
            Slot* depth = getSlot(copy.depth_texture_handle);
            Slot* normal = getSlot(copy.normal_roughness_texture_handle);
            Slot* specular = getSlot(copy.specular_albedo_texture_handle);
            Slot* hitDistance = copy.specular_hit_distance_texture_handle
                ? getSlot(copy.specular_hit_distance_texture_handle)
                : nullptr;
            if (!encoder || !source || source->kind != Kind::Texture ||
                !output || output->kind != Kind::Texture ||
                !depth || depth->kind != Kind::Texture ||
                !normal || normal->kind != Kind::Texture ||
                !specular || specular->kind != Kind::Texture ||
                (copy.specular_hit_distance_texture_handle != 0u &&
                 (!hitDistance || hitDistance->kind != Kind::Texture))) {
                setError("Ray-query reflections received an invalid encoder or texture handle");
                return 0;
            }
            const std::array<uint32_t, 6> handles{{
                copy.source_color_texture_handle,
                copy.output_color_texture_handle,
                copy.depth_texture_handle,
                copy.normal_roughness_texture_handle,
                copy.specular_albedo_texture_handle,
                copy.specular_hit_distance_texture_handle,
            }};
            const std::size_t handleCount = hitDistance ? handles.size() : handles.size() - 1u;
            for (std::size_t first = 0; first < handleCount; ++first) {
                for (std::size_t second = first + 1; second < handleCount; ++second) {
                    if (handles[first] == handles[second]) {
                        setError("Ray-query reflection input and output textures must be distinct");
                        return 0;
                    }
                }
            }
            if (source->texFormat != WGPUTextureFormat_RGBA16Float ||
                (source->texUsage & WGPUTextureUsage_TextureBinding) == 0 ||
                output->texFormat != WGPUTextureFormat_RGBA16Float ||
                (output->texUsage & WGPUTextureUsage_StorageBinding) == 0 ||
                depth->texFormat != WGPUTextureFormat_Depth32Float ||
                (depth->texUsage & WGPUTextureUsage_TextureBinding) == 0 ||
                normal->texFormat != WGPUTextureFormat_RGBA16Float ||
                (normal->texUsage & WGPUTextureUsage_TextureBinding) == 0 ||
                specular->texFormat != WGPUTextureFormat_RGBA16Float ||
                (specular->texUsage & WGPUTextureUsage_TextureBinding) == 0 ||
                (hitDistance &&
                 ((hitDistance->texFormat != WGPUTextureFormat_R16Float &&
                   hitDistance->texFormat != WGPUTextureFormat_R32Float) ||
                  (hitDistance->texUsage & WGPUTextureUsage_StorageBinding) == 0))) {
                setError("Ray-query reflections require rgba16float sampled source/guides, rgba16float storage output and sampled depth32float");
                return 0;
            }
            const std::array<Slot*, 6> textures{{source, output, depth, normal, specular, hitDistance}};
            const std::size_t textureCount = hitDistance ? textures.size() : textures.size() - 1u;
            for (std::size_t index = 0; index < textureCount; ++index) {
                const Slot* texture = textures[index];
                if (texture->texD != 1 || texture->texSampleCount != 1 ||
                    texture->texMipLevels != 1 || texture->texW != copy.width ||
                    texture->texH != copy.height) {
                    setError("Ray-query reflection textures must be identical single-sampled 2D extents with one mip and layer");
                    return 0;
                }
            }
            if (copy.width == 0 || copy.height == 0) {
                setError("Ray-query reflection extent must be non-zero");
                return 0;
            }
            RayQueryReflectionFrame native{};
            native.sourceColorImage = wgpuTextureGetNativeVulkanImage(source->texture);
            native.sourceColorLayout = copy.source_color_vulkan_layout;
            native.outputColorImage = wgpuTextureGetNativeVulkanImage(output->texture);
            native.outputColorLayout = copy.output_color_vulkan_layout;
            native.depthImage = wgpuTextureGetNativeVulkanImage(depth->texture);
            native.depthLayout = copy.depth_vulkan_layout;
            native.normalRoughnessImage = wgpuTextureGetNativeVulkanImage(normal->texture);
            native.normalRoughnessLayout = copy.normal_roughness_vulkan_layout;
            native.specularAlbedoImage = wgpuTextureGetNativeVulkanImage(specular->texture);
            native.specularAlbedoLayout = copy.specular_albedo_vulkan_layout;
            if (hitDistance) {
                native.specularHitDistanceImage =
                    wgpuTextureGetNativeVulkanImage(hitDistance->texture);
                native.specularHitDistanceLayout =
                    copy.specular_hit_distance_vulkan_layout;
                native.specularHitDistanceFormat = hitDistance->texFormat == WGPUTextureFormat_R16Float
                    ? static_cast<uint32_t>(VK_FORMAT_R16_SFLOAT)
                    : static_cast<uint32_t>(VK_FORMAT_R32_SFLOAT);
            }
            native.width = copy.width;
            native.height = copy.height;
            std::copy_n(copy.inverse_view_projection, 16, native.inverseViewProjection);
            std::copy_n(copy.camera_position, 4, native.cameraPosition);
            std::copy_n(copy.parameters, 4, native.parameters);
            std::copy_n(copy.environment, 4, native.environment);
            native.flags = copy.flags;
            native.frameIndex = copy.frame_index;
            native.pipelineHandle = copy.pipeline_handle;
            struct Evaluation {
                RayQueryReflectionFrame* frame;
                bool result{};
            } evaluation{&native, false};
            const WGPUStatus status = wgpuCommandEncoderWithNativeVulkanCommandBuffer(
                encoder,
                [](void* commandBuffer, void* userdata) {
                    auto* value = static_cast<Evaluation*>(userdata);
                    value->frame->commandBuffer = commandBuffer;
                    value->result = rayQueryBridgeEvaluateReflections(*value->frame);
                },
                &evaluation);
            if (status != WGPUStatus_Success || !evaluation.result) {
                const auto rayQuery = rayQueryBridgeCapabilities();
                setError(status != WGPUStatus_Success
                    ? "wgpu-native rejected the Vulkan ray-query reflection callback"
                    : rayQuery.status);
                return 0;
            }
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
#endif
}

int tw_ray_query_pipeline_create(uint32_t handle, uint32_t profile,
                                 const uint32_t* spirvWords,
                                 uint32_t spirvByteLength,
                                 const char* entryPoint,
                                 uint32_t entryPointLength) {
    if (handle == 0u || !spirvWords || spirvByteLength < 20u ||
        spirvByteLength > 1024u * 1024u ||
        (spirvByteLength & 3u) != 0u || !entryPoint ||
        entryPointLength == 0u || entryPointLength > 255u ||
        std::memchr(entryPoint, '\0', entryPointLength) ||
        (profile != static_cast<uint32_t>(RayQueryPipelineProfile::LightingV1) &&
         profile != static_cast<uint32_t>(RayQueryPipelineProfile::ReflectionsV1) &&
         profile != static_cast<uint32_t>(RayQueryPipelineProfile::ReflectionsV2))) {
        setError("Invalid custom ray-query pipeline creation request");
        return 0;
    }
    std::vector<uint32_t> code(spirvByteLength / sizeof(uint32_t));
    std::memcpy(code.data(), spirvWords, spirvByteLength);
    std::string entry(entryPoint, entryPointLength);
    try {
        return onWorker([handle, profile, code = std::move(code),
                         entry = std::move(entry)] {
            const bool result = rayQueryBridgeCreatePipeline(
                handle, static_cast<RayQueryPipelineProfile>(profile),
                code.data(), code.size(), entry.c_str());
            if (!result) setError(rayQueryBridgeCapabilities().status);
            return result ? 1 : 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_ray_query_pipeline_create_glsl(uint32_t handle, uint32_t profile,
                                      const char* glslSource,
                                      uint32_t glslSourceByteLength,
                                      const char* entryPoint,
                                      uint32_t entryPointLength) {
    if (handle == 0u || !glslSource || glslSourceByteLength == 0u ||
        glslSourceByteLength > 1024u * 1024u ||
        std::memchr(glslSource, '\0', glslSourceByteLength) || !entryPoint ||
        entryPointLength == 0u || entryPointLength > 255u ||
        std::memchr(entryPoint, '\0', entryPointLength) ||
        (profile != static_cast<uint32_t>(RayQueryPipelineProfile::LightingV1) &&
         profile != static_cast<uint32_t>(RayQueryPipelineProfile::ReflectionsV1) &&
         profile != static_cast<uint32_t>(RayQueryPipelineProfile::ReflectionsV2))) {
        setError("Invalid GLSL ray-query pipeline creation request");
        return 0;
    }

    const std::string profileIdentity =
        "ThreeBrowser.RayQueryPipeline/profile=" + std::to_string(profile) +
        "/abi=1";
    tw::VulkanShaderCompileRequest request{
        std::string_view(glslSource, glslSourceByteLength),
        std::string_view(entryPoint, entryPointLength),
        profileIdentity,
        tw::VulkanShaderStage::Compute};
    tw::VulkanShaderCompileResult result;
    if (!tw::compileVulkanShaderCached(request, result)) {
        setError(result.diagnostic.empty()
            ? "GLSL shader compilation failed"
            : result.diagnostic.c_str());
        return 0;
    }
    return tw_ray_query_pipeline_create(
        handle, profile, result.spirv.data(),
        static_cast<uint32_t>(result.spirv.size() * sizeof(uint32_t)),
        entryPoint, entryPointLength);
}

int tw_ray_query_pipeline_destroy(uint32_t handle) {
    if (handle == 0u) return 0;
    try {
        return onWorker([handle] {
            const bool result = rayQueryBridgeDestroyPipeline(handle);
            if (!result) setError(rayQueryBridgeCapabilities().status);
            return result ? 1 : 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_cmd_submit(const uint8_t* data, int nbytes) {
    try {
        if (!data || nbytes <= 0) {
            return 1;
        }
        std::vector<uint8_t> copy(data, data + nbytes);
        const uint64_t submitIndex = g.statsCmdSubmits.fetch_add(1, std::memory_order_relaxed);
        g.statsCmdBytes.fetch_add(static_cast<uint64_t>(nbytes), std::memory_order_relaxed);
        ensureWorker();
        {
            std::lock_guard<std::mutex> lock(g.mu);
            if (g.stop) {
                return 0;
            }
            const uint64_t generation = g.commandGeneration.load(std::memory_order_relaxed);
            g.pendingCommandSubmits.fetch_add(1, std::memory_order_relaxed);
            g.jobs.emplace_back([buf = std::move(copy), submitIndex, generation] {
                if (generation != g.commandGeneration.load(std::memory_order_relaxed)) {
                    g.pendingCommandSubmits.fetch_sub(1, std::memory_order_relaxed);
                    return;
                }
                try {
                    if (submitIndex == 0) {
                        logLine("native WebGPU command stream received");
                    }
                    execStream(buf.data(), static_cast<int>(buf.size()));
                } catch (...) {
                    g.pendingCommandSubmits.fetch_sub(1, std::memory_order_relaxed);
                    throw;
                }
                g.pendingCommandSubmits.fetch_sub(1, std::memory_order_relaxed);
            });
        }
        g.cv.notify_one();
        return 1;
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tw_map_read(uint32_t buffer_handle, uint64_t offset, uint64_t size, void* dst, int dst_bytes) {
    try {
        return onWorker([buffer_handle, offset, size, dst, dst_bytes] {
            return implMapRead(buffer_handle, offset, size, dst, dst_bytes);
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

}// extern "C"
