#include "three_webgpu.h"
#include "cmd_ops_webgpu.hpp"

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

#include <algorithm>
#include <cctype>
#include <atomic>
#include <chrono>
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
    WGPUTextureFormat texFormat{WGPUTextureFormat_Undefined};
    WGPUBufferUsage bufUsage{WGPUBufferUsage_None};
    uint64_t bufSize{0};
    std::string wgsl;
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

    std::atomic<void*> nativeHwnd{nullptr};
    std::atomic<int> statsFps{0};
    std::atomic<int> statsFrameUs{0};
    std::atomic<int> statsW{0};
    std::atomic<int> statsH{0};
    std::atomic<uint64_t> statsPresents{0};
    std::atomic<uint64_t> statsCmdSubmits{0};
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
    std::atomic<int> pointerLocked{0};
    std::mutex inputMu;
    std::deque<TWInputEvent> inputEvents;
    POINT pointerRestore{};
    bool pointerRestoreValid{false};

    HWND hwnd{nullptr};
    HWND parent{nullptr};
    bool classRegistered{false};
    bool started{false};

    WGPUTexture overlayTexture{};
    WGPUTextureView overlayView{};
    WGPUSampler overlaySampler{};
    WGPUShaderModule overlayShader{};
    WGPURenderPipeline overlayPipeline{};
    WGPUBindGroup overlayBindGroup{};
    int overlayWidth{0};
    int overlayHeight{0};
    int overlayRenderedFps{-1};
    std::vector<uint8_t> overlayPixels;

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
void requestSurfaceResize(int w, int h);

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
            ShowWindow(hwnd, SW_HIDE);
            g.open.store(0, std::memory_order_relaxed);
            return 0;
        case WM_DESTROY:
            g.open.store(0, std::memory_order_relaxed);
            return 0;
        case WM_SETFOCUS:
            return 0;
        case WM_KILLFOCUS:
            setPointerLockOnWindowThread(false, true);
            return 0;
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
                queueInput(TW_INPUT_POINTER_MOVE, 0, GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            }
            return 0;
        case WM_LBUTTONDOWN:
        case WM_RBUTTONDOWN:
        case WM_MBUTTONDOWN:
            SetFocus(hwnd);
            queueInput(TW_INPUT_POINTER_DOWN,
                       msg == WM_LBUTTONDOWN ? VK_LBUTTON : msg == WM_RBUTTONDOWN ? VK_RBUTTON : VK_MBUTTON,
                       GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            return 0;
        case WM_LBUTTONUP:
        case WM_RBUTTONUP:
        case WM_MBUTTONUP:
            queueInput(TW_INPUT_POINTER_UP,
                       msg == WM_LBUTTONUP ? VK_LBUTTON : msg == WM_RBUTTONUP ? VK_RBUTTON : VK_MBUTTON,
                       GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            return 0;
        case WM_MOUSEWHEEL:
            g.wheelDelta.fetch_add(GET_WHEEL_DELTA_WPARAM(wp), std::memory_order_relaxed);
            {
                POINT point{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
                ScreenToClient(hwnd, &point);
                queueInput(TW_INPUT_WHEEL, GET_WHEEL_DELTA_WPARAM(wp), point.x, point.y);
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
            return DefWindowProcW(hwnd, msg, wp, lp);
    }
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
    if (message.data && message.length) {
        const size_t n = message.length == WGPU_STRLEN ? std::strlen(message.data) : message.length;
        std::string s(message.data, n);
        setError(s.c_str());
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
}

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
        wgpuRenderPassEncoderEnd(g.renderPass);
        wgpuRenderPassEncoderRelease(g.renderPass);
        g.renderPass = nullptr;
    }
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
            if (s.texture) wgpuTextureRelease(s.texture);
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
        wc.style = CS_OWNDC;
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
    g.statsW.store(w, std::memory_order_relaxed);
    g.statsH.store(h, std::memory_order_relaxed);
    return true;
}

void requestSurfaceResize(int w, int h) {
    g.pendingResizeW = std::max(1, w);
    g.pendingResizeH = std::max(1, h);
    g.resizeHoldFrames = 3;
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
    g.queue = wgpuDeviceGetQueue(g.device);
    if (!g.queue) {
        setError("no WebGPU queue");
        return false;
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

RECT overlayFpsButtonRect(int width) {
    return RECT{std::max(40, width - 300), 214, std::max(280, width - 60), 266};
}

RECT overlayDebugButtonRect(int width) {
    return RECT{std::max(40, width - 300), 278, std::max(280, width - 60), 330};
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
    g.overlayPixels.clear();
}

bool createOverlayGpu(int width, int height) {
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
    pipelineDesc.multisample.count = 1;
    pipelineDesc.multisample.mask = 0xffffffffu;
    pipelineDesc.fragment = &fragment;
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
    g.overlayDirty.store(1, std::memory_order_relaxed);
    return g.overlayBindGroup != nullptr;
}

void buildOverlayPixels(int width, int height) {
    const int rowBytes = width * 4;
    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = width;
    info.bmiHeader.biHeight = -height;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    void* bits = nullptr;
    HDC dc = CreateCompatibleDC(nullptr);
    HBITMAP bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &bits, nullptr, 0);
    HGDIOBJ oldBitmap = SelectObject(dc, bitmap);
    std::memset(bits, 0, static_cast<size_t>(rowBytes) * height);
    SetBkMode(dc, TRANSPARENT);

    const bool menu = g.overlayOpen.load(std::memory_order_relaxed) != 0;
    if (menu) {
        RECT full{0, 0, width, height};
        HBRUSH shade = CreateSolidBrush(RGB(9, 12, 18));
        FillRect(dc, &full, shade);
        DeleteObject(shade);

        HFONT title = CreateFontW(-26, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                  OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
        HFONT body = CreateFontW(-17, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                 OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
        HFONT label = CreateFontW(-14, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                  OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
        HGDIOBJ oldFont = SelectObject(dc, title);
        SetTextColor(dc, RGB(243, 247, 252));
        RECT titleRect{72, 48, width - 300, 86};
        DrawTextW(dc, L"ThreeBrowser", -1, &titleRect, DT_LEFT | DT_VCENTER | DT_SINGLELINE);
        SelectObject(dc, body);
        SetTextColor(dc, RGB(117, 137, 164));
        RECT hintRect{72, 84, width - 340, 112};
        DrawTextW(dc, L"IN-GAME OVERLAY", -1, &hintRect, DT_LEFT | DT_SINGLELINE);

        RECT keycap{width - 214, 55, width - 72, 93};
        HBRUSH keyFill = CreateSolidBrush(RGB(29, 36, 48));
        HPEN keyBorder = CreatePen(PS_SOLID, 1, RGB(66, 80, 101));
        HGDIOBJ previousBrush = SelectObject(dc, keyFill);
        HGDIOBJ previousPen = SelectObject(dc, keyBorder);
        RoundRect(dc, keycap.left, keycap.top, keycap.right, keycap.bottom, 10, 10);
        SelectObject(dc, previousBrush);
        SelectObject(dc, previousPen);
        DeleteObject(keyFill);
        DeleteObject(keyBorder);
        SelectObject(dc, label);
        SetTextColor(dc, RGB(186, 199, 217));
        DrawTextW(dc, L"SHIFT + TAB", -1, &keycap, DT_CENTER | DT_VCENTER | DT_SINGLELINE);

        HPEN divider = CreatePen(PS_SOLID, 1, RGB(39, 48, 62));
        HGDIOBJ oldPen = SelectObject(dc, divider);
        MoveToEx(dc, 72, 126, nullptr);
        LineTo(dc, width - 72, 126);
        SelectObject(dc, oldPen);
        DeleteObject(divider);

        auto drawCard = [&](RECT rect) {
            HBRUSH fill = CreateSolidBrush(RGB(23, 29, 39));
            HPEN border = CreatePen(PS_SOLID, 1, RGB(48, 59, 76));
            HGDIOBJ priorBrush = SelectObject(dc, fill);
            HGDIOBJ priorPen = SelectObject(dc, border);
            RoundRect(dc, rect.left, rect.top, rect.right, rect.bottom, 14, 14);
            SelectObject(dc, priorBrush);
            SelectObject(dc, priorPen);
            DeleteObject(fill);
            DeleteObject(border);
        };

        const int rightColumnLeft = std::max(520, width - 360);
        RECT performanceCard{72, 154, rightColumnLeft - 24, 350};
        drawCard(performanceCard);
        SelectObject(dc, label);
        SetTextColor(dc, RGB(112, 202, 255));
        RECT performanceLabel{96, 176, performanceCard.right - 20, 200};
        DrawTextW(dc, L"PERFORMANCE", -1, &performanceLabel, DT_LEFT | DT_SINGLELINE);

        SelectObject(dc, title);
        SetTextColor(dc, RGB(245, 248, 252));
        wchar_t fpsValue[32]{};
        std::swprintf(fpsValue, std::size(fpsValue), L"%d", g.statsFps.load(std::memory_order_relaxed));
        RECT fpsValueRect{96, 218, 210, 260};
        DrawTextW(dc, fpsValue, -1, &fpsValueRect, DT_LEFT | DT_SINGLELINE);
        RECT frameValueRect{240, 218, 390, 260};
        wchar_t frameValue[32]{};
        std::swprintf(frameValue, std::size(frameValue), L"%.2f ms", g.statsFrameUs.load(std::memory_order_relaxed) / 1000.0);
        DrawTextW(dc, frameValue, -1, &frameValueRect, DT_LEFT | DT_SINGLELINE);
        SelectObject(dc, label);
        SetTextColor(dc, RGB(124, 140, 163));
        RECT fpsCaption{96, 264, 210, 286};
        RECT frameCaption{240, 264, 390, 286};
        DrawTextW(dc, L"FRAMES / SEC", -1, &fpsCaption, DT_LEFT | DT_SINGLELINE);
        DrawTextW(dc, L"FRAME TIME", -1, &frameCaption, DT_LEFT | DT_SINGLELINE);
        SelectObject(dc, body);
        SetTextColor(dc, RGB(178, 190, 207));
        std::wstring backend(g.backendName.begin(), g.backendName.end());
        wchar_t detail[256]{};
        std::swprintf(detail, std::size(detail), L"%ls renderer   |   queue %d   |   %llu frame packets",
                      backend.c_str(), g.pendingCommandSubmits.load(std::memory_order_relaxed),
                      static_cast<unsigned long long>(g.statsCmdSubmits.load(std::memory_order_relaxed)));
        RECT detailRect{96, 312, performanceCard.right - 20, 338};
        DrawTextW(dc, detail, -1, &detailRect, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);

        const RECT fpsRect = overlayFpsButtonRect(width);
        const RECT debugRect = overlayDebugButtonRect(width);
        RECT settingsCard{rightColumnLeft, 154, width - 72, 350};
        drawCard(settingsCard);
        SelectObject(dc, label);
        SetTextColor(dc, RGB(112, 202, 255));
        RECT settingsLabel{settingsCard.left + 24, 176, settingsCard.right - 20, 200};
        DrawTextW(dc, L"OVERLAY SETTINGS", -1, &settingsLabel, DT_LEFT | DT_SINGLELINE);
        auto drawToggle = [&](RECT rect, bool active, const wchar_t* text) {
            HBRUSH fill = CreateSolidBrush(active ? RGB(31, 90, 154) : RGB(31, 38, 50));
            HPEN border = CreatePen(PS_SOLID, 1, active ? RGB(72, 151, 234) : RGB(55, 67, 85));
            HGDIOBJ priorBrush = SelectObject(dc, fill);
            HGDIOBJ priorPen = SelectObject(dc, border);
            RoundRect(dc, rect.left, rect.top, rect.right, rect.bottom, 10, 10);
            SelectObject(dc, priorBrush);
            SelectObject(dc, priorPen);
            DeleteObject(fill);
            DeleteObject(border);
            SelectObject(dc, body);
            SetTextColor(dc, RGB(245, 248, 252));
            RECT textRect{rect.left + 18, rect.top, rect.right - 52, rect.bottom};
            DrawTextW(dc, text, -1, &textRect, DT_LEFT | DT_VCENTER | DT_SINGLELINE);
            HBRUSH stateFill = CreateSolidBrush(active ? RGB(114, 203, 255) : RGB(87, 99, 117));
            HGDIOBJ priorStateBrush = SelectObject(dc, stateFill);
            HPEN noBorder = CreatePen(PS_NULL, 0, 0);
            HGDIOBJ priorStatePen = SelectObject(dc, noBorder);
            Ellipse(dc, rect.right - 36, rect.top + 18, rect.right - 22, rect.top + 32);
            SelectObject(dc, priorStateBrush);
            SelectObject(dc, priorStatePen);
            DeleteObject(stateFill);
            DeleteObject(noBorder);
        };
        drawToggle(fpsRect, g.fpsOverlay.load(std::memory_order_relaxed) != 0, L"FPS counter");
        drawToggle(debugRect, g.debugOverlay.load(std::memory_order_relaxed) != 0, L"Diagnostic log");

        RECT inputCard{72, 374, width - 72, 460};
        drawCard(inputCard);
        SelectObject(dc, label);
        SetTextColor(dc, RGB(112, 202, 255));
        RECT inputLabel{96, 394, 220, 418};
        DrawTextW(dc, L"GAME INPUT", -1, &inputLabel, DT_LEFT | DT_SINGLELINE);
        SelectObject(dc, body);
        SetTextColor(dc, RGB(178, 190, 207));
        RECT inputText{96, 424, width - 96, 448};
        DrawTextW(dc, L"Mouse capture is released while this overlay is open and restored when the game requests pointer lock.", -1,
                  &inputText, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);

        SelectObject(dc, label);
        SetTextColor(dc, RGB(104, 122, 148));
        RECT footer{72, height - 58, width - 72, height - 34};
        DrawTextW(dc, L"SHIFT + TAB  OVERLAY      F3  FPS COUNTER      ESC  RELEASE MOUSE", -1,
                  &footer, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);
        SelectObject(dc, oldFont);
        DeleteObject(title);
        DeleteObject(body);
        DeleteObject(label);
    } else if (g.fpsOverlay.load(std::memory_order_relaxed)) {
        RECT badge{width - 138, 18, width - 18, 54};
        HBRUSH fill = CreateSolidBrush(RGB(22, 27, 35));
        HPEN border = CreatePen(PS_SOLID, 1, RGB(65, 77, 96));
        HGDIOBJ oldBrush = SelectObject(dc, fill);
        HGDIOBJ oldPen = SelectObject(dc, border);
        RoundRect(dc, badge.left, badge.top, badge.right, badge.bottom, 10, 10);
        SelectObject(dc, oldBrush);
        SelectObject(dc, oldPen);
        DeleteObject(fill);
        DeleteObject(border);
        HFONT font = CreateFontW(-18, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                 OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
        HGDIOBJ oldFont = SelectObject(dc, font);
        SetTextColor(dc, RGB(112, 202, 255));
        wchar_t fps[32]{};
        std::swprintf(fps, std::size(fps), L"%d FPS", g.statsFps.load(std::memory_order_relaxed));
        DrawTextW(dc, fps, -1, &badge, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        SelectObject(dc, oldFont);
        DeleteObject(font);
    }

    const int paddedRowBytes = (rowBytes + 255) & ~255;
    g.overlayPixels.assign(static_cast<size_t>(paddedRowBytes) * height, 0);
    const auto* source = static_cast<const uint8_t*>(bits);
    for (int y = 0; y < height; ++y) {
        auto* destination = g.overlayPixels.data() + static_cast<size_t>(y) * paddedRowBytes;
        std::memcpy(destination, source + static_cast<size_t>(y) * rowBytes, rowBytes);
        for (int x = 0; x < width; ++x) {
            uint8_t* pixel = destination + x * 4;
            const int brightness = pixel[0] + pixel[1] + pixel[2];
            pixel[3] = menu ? static_cast<uint8_t>(brightness > 500 ? 255 : 232)
                            : static_cast<uint8_t>(brightness == 0 ? 0 : (brightness > 500 ? 255 : 232));
        }
    }
    SelectObject(dc, oldBitmap);
    DeleteObject(bitmap);
    DeleteDC(dc);
}

void renderOverlay() {
    const bool visible = g.overlayOpen.load(std::memory_order_relaxed) != 0 ||
                         g.fpsOverlay.load(std::memory_order_relaxed) != 0;
    if (!visible || !g.currentView || !g.device || !g.queue) return;
    const int width = g.statsW.load(std::memory_order_relaxed);
    const int height = g.statsH.load(std::memory_order_relaxed);
    if (width < 1 || height < 1) return;
    if (!g.overlayPipeline || g.overlayWidth != width || g.overlayHeight != height) {
        if (!createOverlayGpu(width, height)) return;
    }
    const int fps = g.statsFps.load(std::memory_order_relaxed);
    if (g.overlayDirty.exchange(0, std::memory_order_acq_rel) || fps != g.overlayRenderedFps) {
        buildOverlayPixels(width, height);
        const int rowBytes = (width * 4 + 255) & ~255;
        WGPUTexelCopyTextureInfo destination{};
        destination.texture = g.overlayTexture;
        WGPUTexelCopyBufferLayout layout{};
        layout.bytesPerRow = static_cast<uint32_t>(rowBytes);
        layout.rowsPerImage = static_cast<uint32_t>(height);
        WGPUExtent3D extent{static_cast<uint32_t>(width), static_cast<uint32_t>(height), 1};
        wgpuQueueWriteTexture(g.queue, &destination, g.overlayPixels.data(), g.overlayPixels.size(), &layout, &extent);
        g.overlayRenderedFps = fps;
    }

    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(g.device, nullptr);
    WGPURenderPassColorAttachment color{};
    color.view = g.currentView;
    color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    color.loadOp = WGPULoadOp_Load;
    color.storeOp = WGPUStoreOp_Store;
    WGPURenderPassDescriptor passDesc{};
    passDesc.colorAttachmentCount = 1;
    passDesc.colorAttachments = &color;
    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &passDesc);
    wgpuRenderPassEncoderSetPipeline(pass, g.overlayPipeline);
    wgpuRenderPassEncoderSetBindGroup(pass, 0, g.overlayBindGroup, 0, nullptr);
    wgpuRenderPassEncoderDraw(pass, 3, 1, 0, 0);
    wgpuRenderPassEncoderEnd(pass);
    wgpuRenderPassEncoderRelease(pass);
    WGPUCommandBuffer command = wgpuCommandEncoderFinish(encoder, nullptr);
    wgpuQueueSubmit(g.queue, 1, &command);
    wgpuCommandBufferRelease(command);
    wgpuCommandEncoderRelease(encoder);
}

void destroyGpu() {
    dropCurrentTexture();
    clearSlots();
    releaseOverlayGpu();
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
}

void destroyHwnd() {
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
        configureSurface(g.statsW.load(), g.statsH.load());
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
            configureSurface(g.statsW.load(), g.statsH.load());
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
    renderOverlay();
    const bool firstPresent = g.statsPresents.load(std::memory_order_relaxed) == 0;
    wgpuSurfacePresent(g.surface);
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
    if (firstPresent) {
        logLine("native Vulkan surface presented first frame");
    }
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
    std::string found = findWgslEntry(src, stage);
    if (!found.empty()) {
        return found;
    }
    if (!want.empty() && hasWgslFn(src, want)) {
        return want;
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
    WGPUCommandBufferDescriptor cbd{};
    WGPUCommandBuffer cmd = wgpuCommandEncoderFinish(g.currentEncoder, &cbd);
    if (cmd) {
        wgpuQueueSubmit(g.queue, 1, &cmd);
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
            if (g.hwnd) {
                setHwndClientSize(g.hwnd, w, h);
            }
            // Command streams can split one encoder across several submits.
            // Never invalidate its acquired surface texture mid-encoder.
            requestSurfaceResize(w, h);
            return;
        }
        case OP_PRESENT:
            implPresent();
            return;
        case OP_SET_VSYNC: {
            const int on = static_cast<int>(r.u32());
            g.vsync.store(on != 0 ? 1 : 0, std::memory_order_relaxed);
            configureSurface(g.statsW.load(), g.statsH.load());
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
            s.texFormat = tdsc.format;
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
            (void)viewDim;
            Slot* ts = getSlot(tex);
            if (!ts || ts->kind != Kind::Texture || !ts->texture) {
                setError("tex view: bad texture");
                return;
            }
            WGPUTextureViewDescriptor vd{};
            vd.format = format ? static_cast<WGPUTextureFormat>(format) : ts->texFormat;
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
            s.texFormat = vd.format;
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
            (void)compare;
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
                const uint32_t front = r.u32();
                const uint32_t strip = r.u32();
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
                (void)front;
                (void)strip;
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
            pd.primitive.frontFace = WGPUFrontFace_CCW;
            pd.multisample.count = sampleCount;
            pd.multisample.mask = 0xFFFFFFFFu;
            if (hasDepth && depthFmt) {
                pd.depthStencil = &ds;
            }
            Slot s;
            s.kind = Kind::RenderPipeline;
            s.rpipe = wgpuDeviceCreateRenderPipeline(g.device, &pd);
            if (g.device) {
                wgpuDevicePoll(g.device, 0, nullptr);
            }
            if (!s.rpipe) {
                setError("render pipeline failed");
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
            s.bg = wgpuDeviceCreateBindGroup(g.device, &bd);
            if (!s.bg) {
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
            }
            WGPUCommandEncoderDescriptor ed{};
            Slot s;
            s.kind = Kind::Encoder;
            s.encoder = wgpuDeviceCreateCommandEncoder(g.device, &ed);
            g.currentEncoder = s.encoder;
            g.currentEncoderHandle = handle;
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
            uint32_t colorView = 0;
            uint32_t resolveView = 0xffffffffu;
            uint32_t depthView = 0;
            float cr = 0.f, cg = 0.f, cb = 0.f, ca = 1.f;
            uint32_t load = 2;
            uint32_t store = 1;
            endPasses();
            if (r.remaining() >= 40) {
                // JS: encoder, colorCount, depthView, depthLoad, depthStore,
                // depthClear, stencilLoad, stencilStore, stencilClear, hasDepth,
                // then colors: view, resolve, load, store, r,g,b,a
                r.u32(); // encoder
                const uint32_t colorCount = r.u32();
                depthView = r.u32();
                r.u32();
                r.u32();
                r.f32();
                r.u32();
                r.u32();
                r.u32();
                r.u32();
                if (colorCount > 0 && colorCount < 8) {
                    colorView = r.u32();
                    resolveView = r.u32();
                    load = r.u32();
                    store = r.u32();
                    cr = r.f32();
                    cg = r.f32();
                    cb = r.f32();
                    ca = r.f32();
                }
            } else {
                colorView = r.u32();
                depthView = r.u32();
                cr = r.f32();
                cg = r.f32();
                cb = r.f32();
                ca = r.f32();
                load = r.has(4) ? r.u32() : 0;
            }
            if (g.resizeHoldFrames > 0) {
                // A page may record several passes before its next present.
                // Hold all of them until complete animation frames have
                // elapsed with a stable canvas size.
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
            uint32_t colorW = 0, colorH = 0;
            const bool hasOffscreenColorSize = colorView != 0 && viewSize(colorView, colorW, colorH);
            uint32_t frameW = hasOffscreenColorSize ? colorW : (hasDepthSize ? depthW : 0);
            uint32_t frameH = hasOffscreenColorSize ? colorH : (hasDepthSize ? depthH : 0);
            if (frameW == 0 || frameH == 0) {
                frameW = g.pendingResizeW > 0 ? static_cast<uint32_t>(g.pendingResizeW) : g.config.width;
                frameH = g.pendingResizeH > 0 ? static_cast<uint32_t>(g.pendingResizeH) : g.config.height;
            }
            const bool usesSwapchain = colorView == 0 ||
                                       (colorView != 0 && resolveView == 0);
            if (usesSwapchain && frameW != 0 && frameH != 0 &&
                (g.config.width != frameW || g.config.height != frameH)) {
                configureSurface(static_cast<int>(frameW), static_cast<int>(frameH));
            }
            if (g.pendingResizeW == static_cast<int>(frameW) &&
                g.pendingResizeH == static_cast<int>(frameH)) {
                g.pendingResizeW = 0;
                g.pendingResizeH = 0;
            }
            if (colorView == 0) {
                colorW = g.config.width;
                colorH = g.config.height;
            } else if (!hasOffscreenColorSize) {
                colorW = g.config.width;
                colorH = g.config.height;
            }
            uint32_t resolveW = 0, resolveH = 0;
            const bool hasResolveSize = colorView != 0 && resolveView != 0xffffffffu &&
                                        viewSize(resolveView, resolveW, resolveH);
            if ((hasDepthSize && (depthW != colorW || depthH != colorH)) ||
                (hasResolveSize && (resolveW != colorW || resolveH != colorH))) {
                // A resize can occur between the page rebuilding attachments
                // and acquiring the swapchain texture. Skip only this frame;
                // passing mismatched views to wgpu aborts at encoder finish.
                g.skipRenderPass = true;
                return;
            }
            WGPUTextureView cv = viewFromHandle(colorView, colorView == 0);
            WGPUTextureView rv = nullptr;
            if (colorView != 0 && resolveView != 0xffffffffu) {
                rv = viewFromHandle(resolveView, true);
                if (rv && cv) {
                    Slot* colorSlot = getSlot(colorView);
                    const int sw = g.statsW.load(std::memory_order_relaxed);
                    const int sh = g.statsH.load(std::memory_order_relaxed);
                    if (colorSlot && colorSlot->texW && colorSlot->texH &&
                        (static_cast<int>(colorSlot->texW) != sw ||
                         static_cast<int>(colorSlot->texH) != sh)) {
                        rv = nullptr;
                    }
                }
            }
            if (!cv) {
                cv = viewFromHandle(0, true);
                rv = nullptr;
            }
            if (!cv) {
                setError("render begin: no color view");
                return;
            }
            WGPURenderPassColorAttachment caa{};
            caa.view = cv;
            caa.resolveTarget = rv;
            caa.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
            caa.loadOp = loadOpFrom(load);
            caa.storeOp = rv ? WGPUStoreOp_Discard : (store ? WGPUStoreOp_Store : WGPUStoreOp_Discard);
            caa.clearValue.r = cr;
            caa.clearValue.g = cg;
            caa.clearValue.b = cb;
            caa.clearValue.a = ca;
            WGPURenderPassDepthStencilAttachment da{};
            WGPUTextureView dv = viewFromHandle(depthView, false);
            if (dv) {
                da.view = dv;
                da.depthLoadOp = WGPULoadOp_Clear;
                da.depthStoreOp = WGPUStoreOp_Store;
                da.depthClearValue = 1.f;
                da.stencilLoadOp = WGPULoadOp_Undefined;
                da.stencilStoreOp = WGPUStoreOp_Undefined;
            }
            WGPURenderPassDescriptor rd{};
            rd.colorAttachmentCount = 1;
            rd.colorAttachments = &caa;
            if (dv) {
                rd.depthStencilAttachment = &da;
            }
            g.renderPass = wgpuCommandEncoderBeginRenderPass(encoder, &rd);
            if (!g.renderPass) {
                char buf[128];
                std::snprintf(buf, sizeof(buf),
                              "render begin failed color=%u resolve=%u depth=%u",
                              colorView, resolveView, depthView);
                setError(buf);
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
            if (!g.renderPass || !s || s->kind != Kind::BindGroup) {
                setError("render bg: bad state");
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
                wgpuRenderPassEncoderEnd(g.renderPass);
                wgpuRenderPassEncoderRelease(g.renderPass);
                g.renderPass = nullptr;
            }
            g.renderPipelineSet = false;
            g.skipRenderPass = false;
            return;
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
            const uint32_t src = r.u32();
            const uint32_t dst = r.u32();
            const uint32_t sx = r.has(4) ? r.u32() : 0;
            const uint32_t sy = r.has(4) ? r.u32() : 0;
            const uint32_t sz = r.has(4) ? r.u32() : 0;
            const uint32_t dx = r.has(4) ? r.u32() : 0;
            const uint32_t dy = r.has(4) ? r.u32() : 0;
            const uint32_t dz = r.has(4) ? r.u32() : 0;
            const uint32_t cw = r.has(4) ? r.u32() : 0;
            const uint32_t ch = r.has(4) ? r.u32() : 0;
            const uint32_t cd = r.has(4) ? r.u32() : 1;
            const uint32_t smip = r.has(4) ? r.u32() : 0;
            const uint32_t dmip = r.has(4) ? r.u32() : 0;
            Slot* ss = getSlot(src);
            Slot* ds = getSlot(dst);
            if (!ss || ss->kind != Kind::Texture || !ds || ds->kind != Kind::Texture) {
                setError("copy tex: bad handle");
                return;
            }
            WGPUCommandEncoder enc = ensureEncoder();
            if (!enc) {
                return;
            }
            WGPUTexelCopyTextureInfo srcI{};
            srcI.texture = ss->texture;
            srcI.mipLevel = smip;
            srcI.origin.x = sx;
            srcI.origin.y = sy;
            srcI.origin.z = sz;
            WGPUTexelCopyTextureInfo dstI{};
            dstI.texture = ds->texture;
            dstI.mipLevel = dmip;
            dstI.origin.x = dx;
            dstI.origin.y = dy;
            dstI.origin.z = dz;
            WGPUExtent3D extent{};
            extent.width = cw ? cw : ss->texW;
            extent.height = ch ? ch : ss->texH;
            extent.depthOrArrayLayers = cd ? cd : 1;
            wgpuCommandEncoderCopyTextureToTexture(enc, &srcI, &dstI, &extent);
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
    destroyGpu();
    destroyHwnd();
    g.started = false;
    g.statsPresents.store(0, std::memory_order_relaxed);
    g.statsFps.store(0, std::memory_order_relaxed);
}

void implReset() {
    dropCurrentTexture();
    clearSlots();
}

void workerMain() {
    g.workerId = std::this_thread::get_id();
    logLine("worker started");
    while (true) {
        std::vector<std::function<void()>> batch;
        bool stopping = false;
        {
            std::unique_lock<std::mutex> lock(g.mu);
            if (g.jobs.empty() && !g.stop) {
                g.cv.wait_for(lock, std::chrono::milliseconds(16), [] {
                    return g.stop || !g.jobs.empty();
                });
            }
            while (!g.jobs.empty()) {
                batch.push_back(std::move(g.jobs.front()));
                g.jobs.pop_front();
            }
            stopping = g.stop && batch.empty();
        }
        if (stopping) {
            break;
        }
        for (auto& job : batch) {
            try {
                job();
            } catch (const std::exception& ex) {
                setError(ex.what());
            } catch (...) {
                setError("webgpu worker: unknown exception");
            }
        }
        pumpHwnd();
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
                configureSurface(g.statsW.load(), g.statsH.load());
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

void tw_set_overlay(int on) {
    g.overlayOpen.store(on != 0 ? 1 : 0, std::memory_order_relaxed);
    g.overlayDirty.store(1, std::memory_order_release);
}

int tw_overlay_open(void) {
    return g.overlayOpen.load(std::memory_order_relaxed);
}

void tw_overlay_click(int x, int y) {
    if (!g.overlayOpen.load(std::memory_order_relaxed)) return;
    const int width = g.statsW.load(std::memory_order_relaxed);
    POINT point{x, y};
    const RECT fps = overlayFpsButtonRect(width);
    const RECT debug = overlayDebugButtonRect(width);
    if (PtInRect(&fps, point)) {
        g.fpsOverlay.store(!g.fpsOverlay.load(std::memory_order_relaxed), std::memory_order_relaxed);
    } else if (PtInRect(&debug, point)) {
        const bool enabled = !g.debugOverlay.load(std::memory_order_relaxed);
        g.debugOverlay.store(enabled, std::memory_order_relaxed);
        g.statsLog.store(enabled, std::memory_order_relaxed);
    }
    g.overlayDirty.store(1, std::memory_order_release);
}

void tw_toggle_fps_overlay(void) {
    g.fpsOverlay.store(!g.fpsOverlay.load(std::memory_order_relaxed), std::memory_order_relaxed);
    g.overlayDirty.store(1, std::memory_order_release);
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
