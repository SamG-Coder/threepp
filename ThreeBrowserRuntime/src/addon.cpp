#include <node_api.h>

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <dwmapi.h>
#include <windows.h>

#include "three_native.h"
#include "three_webgpu.h"

#define STB_IMAGE_STATIC
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

#include <array>
#include <atomic>
#include <climits>
#include <cstring>
#include <cstdint>
#include <string>
#include <vector>

namespace {

std::atomic_bool runtimeActive{false};
std::atomic_int runtimeMode{0};
std::atomic_bool pointerLocked{false};
POINT pointerRestorePosition{};
bool pointerRestorePositionValid{false};

HWND runtimeHwnd() {
    return static_cast<HWND>(runtimeMode.load(std::memory_order_acquire) == 2 ? tw_hwnd() : tn_runtime_hwnd());
}

POINT pointerLockCenter(HWND hwnd) {
    RECT client{};
    GetClientRect(hwnd, &client);
    const int contentTop = runtimeMode.load(std::memory_order_acquire) == 2 ? tw_content_offset_y() : 0;
    POINT center{(client.left + client.right) / 2, (contentTop + client.bottom) / 2};
    ClientToScreen(hwnd, &center);
    return center;
}

void releasePointerLock() {
    if (!pointerLocked.exchange(false, std::memory_order_acq_rel)) return;
    if (runtimeMode.load(std::memory_order_acquire) == 2) {
        tw_set_pointer_lock(0);
        pointerRestorePositionValid = false;
        return;
    }
    ClipCursor(nullptr);
    while (ShowCursor(TRUE) < 0) {}
    if (pointerRestorePositionValid) SetCursorPos(pointerRestorePosition.x, pointerRestorePosition.y);
    pointerRestorePositionValid = false;
}

bool acquirePointerLock() {
    const HWND hwnd = runtimeHwnd();
    if (!hwnd || !IsWindow(hwnd)) return false;
    if (pointerLocked.load(std::memory_order_acquire)) return true;
    if (runtimeMode.load(std::memory_order_acquire) == 2) {
        const bool locked = tw_set_pointer_lock(1) != 0;
        pointerLocked.store(locked, std::memory_order_release);
        return locked;
    }

    pointerRestorePositionValid = GetCursorPos(&pointerRestorePosition) != FALSE;
    RECT clip{};
    GetClientRect(hwnd, &clip);
    clip.top += runtimeMode.load(std::memory_order_acquire) == 2 ? tw_content_offset_y() : 0;
    POINT topLeft{clip.left, clip.top};
    POINT bottomRight{clip.right, clip.bottom};
    ClientToScreen(hwnd, &topLeft);
    ClientToScreen(hwnd, &bottomRight);
    clip = RECT{topLeft.x, topLeft.y, bottomRight.x, bottomRight.y};
    if (!ClipCursor(&clip)) return false;

    SetForegroundWindow(hwnd);
    SetFocus(hwnd);
    const POINT center = pointerLockCenter(hwnd);
    SetCursorPos(center.x, center.y);
    while (ShowCursor(FALSE) >= 0) {}
    pointerLocked.store(true, std::memory_order_release);
    return true;
}

napi_value undefined(napi_env env) {
    napi_value value;
    napi_get_undefined(env, &value);
    return value;
}

napi_value boolean(napi_env env, bool value) {
    napi_value result;
    napi_get_boolean(env, value, &result);
    return result;
}

napi_value number(napi_env env, double value) {
    napi_value result;
    napi_create_double(env, value, &result);
    return result;
}

napi_value string(napi_env env, const char* value) {
    napi_value result;
    napi_create_string_utf8(env, value ? value : "", NAPI_AUTO_LENGTH, &result);
    return result;
}

double argNumber(napi_env env, napi_value value, double fallback) {
    double result = fallback;
    napi_get_value_double(env, value, &result);
    return result;
}

std::string argString(napi_env env, napi_value value, const char* fallback) {
    std::size_t size = 0;
    if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok) return fallback;
    std::string result(size, '\0');
    napi_get_value_string_utf8(env, value, result.data(), result.size() + 1, &size);
    return result;
}

void set(napi_env env, napi_value object, const char* name, napi_value value) {
    napi_set_named_property(env, object, name, value);
}

napi_value start(napi_env env, napi_callback_info info) {
    std::array<napi_value, 3> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    const int width = argc > 0 ? static_cast<int>(argNumber(env, argv[0], 1280)) : 1280;
    const int height = argc > 1 ? static_cast<int>(argNumber(env, argv[1], 720)) : 720;
    const std::string title = argc > 2 ? argString(env, argv[2], "ThreeBrowser Runtime") : "ThreeBrowser Runtime";
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    tn_runtime_set_standalone(1);
    tn_runtime_set_vsync(1);
    const bool ok = tn_runtime_start(width, height, title.c_str()) != 0;
    runtimeActive.store(ok, std::memory_order_release);
    runtimeMode.store(ok ? 1 : 0, std::memory_order_release);
    if (ok) {
        if (auto hwnd = static_cast<HWND>(tn_runtime_hwnd())) {
            ShowWindowAsync(hwnd, SW_SHOW);
            SetWindowPos(hwnd, HWND_TOP, 0, 0, width, height,
                         SWP_NOMOVE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS);
        }
    }
    return boolean(env, ok);
}

napi_value webGpuStart(napi_env env, napi_callback_info info) {
    std::array<napi_value, 2> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    const int width = argc > 0 ? static_cast<int>(argNumber(env, argv[0], 1280)) : 1280;
    const int height = argc > 1 ? static_cast<int>(argNumber(env, argv[1], 720)) : 720;
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    tw_set_standalone_ui(1);
    tw_set_vsync(0);
    const bool ok = tw_start(nullptr, 0, 0, width, height) != 0;
    runtimeActive.store(ok, std::memory_order_release);
    runtimeMode.store(ok ? 2 : 0, std::memory_order_release);
    if (ok) {
        if (auto hwnd = static_cast<HWND>(tw_hwnd())) {
            ShowWindowAsync(hwnd, SW_SHOW);
            SetWindowPos(hwnd, HWND_TOP, 0, 0, width, height,
                         SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS);
        }
    }
    return boolean(env, ok);
}

napi_value submit(napi_env env, napi_callback_info info) {
    if (!runtimeActive.load(std::memory_order_acquire)) return boolean(env, false);
    napi_value argv[1]{};
    std::size_t argc = 1;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc == 0) return boolean(env, false);
    void* data = nullptr;
    std::size_t size = 0;
    bool isArrayBuffer = false;
    napi_is_arraybuffer(env, argv[0], &isArrayBuffer);
    if (isArrayBuffer) {
        napi_get_arraybuffer_info(env, argv[0], &data, &size);
    } else {
        napi_typedarray_type type{};
        std::size_t length = 0;
        napi_value buffer{};
        std::size_t offset = 0;
        if (napi_get_typedarray_info(env, argv[0], &type, &length, &data, &buffer, &offset) != napi_ok) {
            return boolean(env, false);
        }
        size = length;
        if (type == napi_uint16_array || type == napi_int16_array) size *= 2;
        else if (type == napi_uint32_array || type == napi_int32_array || type == napi_float32_array) size *= 4;
        else if (type == napi_float64_array || type == napi_bigint64_array || type == napi_biguint64_array) size *= 8;
    }
    return boolean(env, tn_cmd_submit(static_cast<const std::uint8_t*>(data), static_cast<int>(size)) != 0);
}

napi_value decodeImage(napi_env env, napi_callback_info info) {
    napi_value argv[1]{};
    std::size_t argc = 1;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc == 0) return undefined(env);

    void* data = nullptr;
    std::size_t size = 0;
    bool isArrayBuffer = false;
    napi_is_arraybuffer(env, argv[0], &isArrayBuffer);
    if (isArrayBuffer) {
        if (napi_get_arraybuffer_info(env, argv[0], &data, &size) != napi_ok) return undefined(env);
    } else {
        napi_typedarray_type type{};
        std::size_t length = 0;
        napi_value buffer{};
        std::size_t offset = 0;
        if (napi_get_typedarray_info(env, argv[0], &type, &length, &data, &buffer, &offset) != napi_ok ||
            (type != napi_uint8_array && type != napi_uint8_clamped_array)) {
            return undefined(env);
        }
        size = length;
    }
    if (!data || size == 0 || size > static_cast<std::size_t>(INT32_MAX)) return undefined(env);

    int width = 0;
    int height = 0;
    int channels = 0;
    stbi_uc* pixels = stbi_load_from_memory(static_cast<const stbi_uc*>(data), static_cast<int>(size),
                                            &width, &height, &channels, 4);
    if (!pixels || width <= 0 || height <= 0) {
        if (pixels) stbi_image_free(pixels);
        return undefined(env);
    }
    const std::size_t pixelBytes = static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4;
    void* output = nullptr;
    napi_value arrayBuffer{};
    napi_create_arraybuffer(env, pixelBytes, &output, &arrayBuffer);
    std::memcpy(output, pixels, pixelBytes);
    stbi_image_free(pixels);

    napi_value typedPixels{};
    napi_create_typedarray(env, napi_uint8_clamped_array, pixelBytes, arrayBuffer, 0, &typedPixels);
    napi_value result{};
    napi_create_object(env, &result);
    set(env, result, "width", number(env, width));
    set(env, result, "height", number(env, height));
    set(env, result, "pixels", typedPixels);
    return result;
}

napi_value resize(napi_env env, napi_callback_info info) {
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && argc == 2) {
        const int width = static_cast<int>(argNumber(env, argv[0], 1));
        const int height = static_cast<int>(argNumber(env, argv[1], 1));
        if (runtimeMode.load(std::memory_order_acquire) == 2) tw_set_size(width, height);
        else tn_runtime_set_size(width, height);
    }
    return undefined(env);
}

napi_value shutdown(napi_env env, napi_callback_info) {
    releasePointerLock();
    if (runtimeActive.exchange(false, std::memory_order_acq_rel)) {
        if (runtimeMode.exchange(0, std::memory_order_acq_rel) == 2) tw_shutdown();
        else tn_runtime_shutdown();
    }
    return undefined(env);
}

napi_value setPointerLock(napi_env env, napi_callback_info info) {
    napi_value argv[1]{};
    std::size_t argc = 1;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    bool enabled = false;
    if (argc > 0) napi_get_value_bool(env, argv[0], &enabled);
    if (!enabled) {
        releasePointerLock();
        return boolean(env, true);
    }
    return boolean(env, runtimeActive.load(std::memory_order_acquire) && acquirePointerLock());
}

napi_value setOverlay(napi_env env, napi_callback_info info) {
    napi_value argv[1]{};
    std::size_t argc = 1;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    bool enabled = false;
    if (argc > 0) napi_get_value_bool(env, argv[0], &enabled);
    if (runtimeMode.load(std::memory_order_acquire) != 2) return boolean(env, false);
    if (enabled) releasePointerLock();
    tw_set_overlay(enabled ? 1 : 0);
    return boolean(env, true);
}

napi_value overlayOpen(napi_env env, napi_callback_info) {
    return boolean(env, runtimeMode.load(std::memory_order_acquire) == 2 && tw_overlay_open() != 0);
}

napi_value overlayClick(napi_env env, napi_callback_info info) {
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeMode.load(std::memory_order_acquire) == 2 && argc == 2) {
        tw_overlay_click(static_cast<int>(argNumber(env, argv[0], 0)),
                         static_cast<int>(argNumber(env, argv[1], 0)));
    }
    return undefined(env);
}

napi_value toggleFpsOverlay(napi_env env, napi_callback_info) {
    if (runtimeMode.load(std::memory_order_acquire) == 2) tw_toggle_fps_overlay();
    return undefined(env);
}

napi_value isOpen(napi_env env, napi_callback_info) {
    if (!runtimeActive.load(std::memory_order_acquire)) return boolean(env, false);
    const auto hwnd = runtimeHwnd();
    const bool open = runtimeMode.load(std::memory_order_acquire) == 2 ? tw_is_open() != 0 : tn_runtime_is_open() != 0;
    return boolean(env, open && hwnd && IsWindow(hwnd));
}

napi_value waitFrame(napi_env env, napi_callback_info) {
    if (runtimeMode.load(std::memory_order_acquire) != 2) DwmFlush();
    return undefined(env);
}

napi_value pressure(napi_env env, napi_callback_info) {
    return number(env, runtimeMode.load(std::memory_order_acquire) == 2 ? tw_backlog() : 0);
}

napi_value backendName(napi_env env, napi_callback_info) {
    return string(env, runtimeMode.load(std::memory_order_acquire) == 2 ? tw_backend_name() : tn_backend_name());
}

napi_value lastError(napi_env env, napi_callback_info) {
    return string(env, runtimeMode.load(std::memory_order_acquire) == 2 ? tw_last_error() : tn_last_error());
}

napi_value webGpuSubmit(napi_env env, napi_callback_info info) {
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (!runtimeActive.load(std::memory_order_acquire) || runtimeMode.load(std::memory_order_acquire) != 2 || argc < 2) {
        return boolean(env, false);
    }
    void* data = nullptr;
    std::size_t capacity = 0;
    if (napi_get_arraybuffer_info(env, argv[0], &data, &capacity) != napi_ok) return boolean(env, false);
    const auto used = static_cast<std::size_t>(argNumber(env, argv[1], 0));
    if (used == 0 || used > capacity) return boolean(env, false);
    return boolean(env, tw_cmd_submit(static_cast<const std::uint8_t*>(data), static_cast<int>(used)) != 0);
}

napi_value webGpuMapRead(napi_env env, napi_callback_info info) {
    napi_value argv[3]{};
    std::size_t argc = 3;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc < 3) return undefined(env);
    const auto handle = static_cast<std::uint32_t>(argNumber(env, argv[0], 0));
    const auto offset = static_cast<std::uint64_t>(argNumber(env, argv[1], 0));
    const auto size = static_cast<std::size_t>(argNumber(env, argv[2], 0));
    if (!handle || !size || size > 64u * 1024u * 1024u) return undefined(env);
    void* data = nullptr;
    napi_value buffer;
    napi_create_arraybuffer(env, size, &data, &buffer);
    const int read = tw_map_read(handle, offset, size, data, static_cast<int>(size));
    if (read <= 0) return undefined(env);
    return buffer;
}

napi_value setToneMapping(napi_env env, napi_callback_info info) {
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && argc == 2) tn_renderer_set_tone_mapping(static_cast<int>(argNumber(env, argv[0], 0)),
                                                static_cast<float>(argNumber(env, argv[1], 1)));
    return undefined(env);
}

napi_value setSceneBackgroundTexture(napi_env env, napi_callback_info info) {
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && argc == 2) {
        tn_scene_set_background_texture(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)),
                                        static_cast<std::uint32_t>(argNumber(env, argv[1], 0)));
    }
    return undefined(env);
}

napi_value setSceneEnvironment(napi_env env, napi_callback_info info) {
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && argc == 2) {
        tn_scene_set_environment(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)),
                                 static_cast<std::uint32_t>(argNumber(env, argv[1], 0)));
    }
    return undefined(env);
}

napi_value pmremFromEquirect(napi_env env, napi_callback_info info) {
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (!runtimeActive.load(std::memory_order_acquire) || argc != 2) return number(env, 0);
    return number(env, tn_pmrem_from_equirect(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)),
                                              static_cast<std::uint32_t>(argNumber(env, argv[1], 0))));
}

napi_value pmremFromCubemap(napi_env env, napi_callback_info info) {
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (!runtimeActive.load(std::memory_order_acquire) || argc != 2) return number(env, 0);
    return number(env, tn_pmrem_from_cubemap(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)),
                                             static_cast<std::uint32_t>(argNumber(env, argv[1], 0))));
}

napi_value pmremFromObject(napi_env env, napi_callback_info info) {
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (!runtimeActive.load(std::memory_order_acquire) || argc != 2) return number(env, 0);
    return number(env, tn_pmrem_from_object(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)),
                                            static_cast<std::uint32_t>(argNumber(env, argv[1], 0))));
}

napi_value destroySlot(napi_env env, napi_callback_info info) {
    napi_value argv[1]{};
    std::size_t argc = 1;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && argc == 1) {
        tn_slot_destroy(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)));
    }
    return undefined(env);
}

napi_value stats(napi_env env, napi_callback_info) {
    int fps = 0, frameUs = 0, width = 0, height = 0, vsync = 0;
    std::uint64_t presents = 0;
    if (runtimeMode.load(std::memory_order_acquire) == 2) tw_stats(&fps, &frameUs, &width, &height, &vsync, &presents);
    else tn_runtime_stats(&fps, &frameUs, &width, &height, &vsync, &presents);
    napi_value result;
    napi_create_object(env, &result);
    set(env, result, "fps", number(env, fps));
    set(env, result, "frameUs", number(env, frameUs));
    set(env, result, "width", number(env, width));
    set(env, result, "height", number(env, height));
    set(env, result, "vsync", boolean(env, vsync != 0));
    set(env, result, "presents", number(env, static_cast<double>(presents)));
    return result;
}

struct InputSnapshot {
    POINT cursor{-1, -1};
    std::array<bool, 256> keys{};
};

InputSnapshot input;

napi_value inputEvent(napi_env env, const char* type, int code, double x, double y, double movementX = 0,
                      double movementY = 0, int modifiers = -1) {
    napi_value event;
    napi_create_object(env, &event);
    set(env, event, "type", string(env, type));
    set(env, event, "code", number(env, code));
    set(env, event, "x", number(env, x));
    set(env, event, "y", number(env, y));
    set(env, event, "movementX", number(env, movementX));
    set(env, event, "movementY", number(env, movementY));
    const bool shift = modifiers >= 0 ? (modifiers & 1) != 0 : (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
    const bool control = modifiers >= 0 ? (modifiers & 2) != 0 : (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
    const bool alt = modifiers >= 0 ? (modifiers & 4) != 0 : (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
    set(env, event, "shiftKey", boolean(env, shift));
    set(env, event, "ctrlKey", boolean(env, control));
    set(env, event, "altKey", boolean(env, alt));
    return event;
}

napi_value pollInput(napi_env env, napi_callback_info) {
    napi_value events;
    napi_create_array(env, &events);
    std::uint32_t index = 0;
    if (!runtimeActive.load(std::memory_order_acquire)) return events;
    if (runtimeMode.load(std::memory_order_acquire) == 2) {
        std::array<TWInputEvent, 256> nativeEvents{};
        const int count = tw_poll_input(nativeEvents.data(), static_cast<int>(nativeEvents.size()));
        for (int i = 0; i < count; ++i) {
            const TWInputEvent& source = nativeEvents[static_cast<size_t>(i)];
            const char* type = "";
            switch (source.type) {
                case TW_INPUT_POINTER_MOVE: type = "pointermove"; break;
                case TW_INPUT_POINTER_DOWN: type = "pointerdown"; break;
                case TW_INPUT_POINTER_UP: type = "pointerup"; break;
                case TW_INPUT_WHEEL: type = "wheel"; break;
                case TW_INPUT_KEY_DOWN: type = "keydown"; break;
                case TW_INPUT_KEY_UP: type = "keyup"; break;
                case TW_INPUT_POINTER_LOCK_LOST:
                    type = "pointerlocklost";
                    pointerLocked.store(false, std::memory_order_release);
                    break;
                default: continue;
            }
            napi_set_element(env, events, index++, inputEvent(env, type, source.code, source.x, source.y,
                                                              source.movement_x, source.movement_y,
                                                              source.modifiers));
        }
        return events;
    }
    const auto hwnd = runtimeHwnd();
    if (!hwnd) return events;
    if (GetForegroundWindow() != hwnd) {
        if (pointerLocked.load(std::memory_order_acquire)) {
            releasePointerLock();
            napi_set_element(env, events, index++, inputEvent(env, "pointerlocklost", 0, 0, 0));
        }
        return events;
    }

    POINT screenCursor{};
    GetCursorPos(&screenCursor);
    POINT cursor = screenCursor;
    ScreenToClient(hwnd, &cursor);
    if (pointerLocked.load(std::memory_order_acquire)) {
        const POINT center = pointerLockCenter(hwnd);
        const int movementX = screenCursor.x - center.x;
        const int movementY = screenCursor.y - center.y;
        POINT clientCenter = center;
        ScreenToClient(hwnd, &clientCenter);
        cursor = clientCenter;
        input.cursor = cursor;
        if (movementX != 0 || movementY != 0) {
            napi_set_element(env, events, index++, inputEvent(env, "pointermove", 0, cursor.x, cursor.y, movementX, movementY));
            SetCursorPos(center.x, center.y);
        }
    } else {
        if (runtimeMode.load(std::memory_order_acquire) == 2 && cursor.y < tw_content_offset_y()) return events;
        if (cursor.x != input.cursor.x || cursor.y != input.cursor.y) {
            const int movementX = input.cursor.x < 0 ? 0 : cursor.x - input.cursor.x;
            const int movementY = input.cursor.y < 0 ? 0 : cursor.y - input.cursor.y;
            napi_set_element(env, events, index++, inputEvent(env, "pointermove", 0, cursor.x, cursor.y, movementX, movementY));
            input.cursor = cursor;
        }
    }

    for (int key = 1; key < 256; ++key) {
        const bool down = (GetAsyncKeyState(key) & 0x8000) != 0;
        if (down == input.keys[static_cast<std::size_t>(key)]) continue;
        input.keys[static_cast<std::size_t>(key)] = down;
        const bool mouse = key == VK_LBUTTON || key == VK_RBUTTON || key == VK_MBUTTON;
        napi_set_element(env, events, index++, inputEvent(
                env, mouse ? (down ? "pointerdown" : "pointerup") : (down ? "keydown" : "keyup"),
                key, cursor.x, cursor.y));
    }
    if (runtimeMode.load(std::memory_order_acquire) == 2) {
        const int wheel = tw_take_wheel_delta();
        if (wheel != 0) napi_set_element(env, events, index++, inputEvent(env, "wheel", wheel, cursor.x, cursor.y));
    }
    return events;
}

napi_value init(napi_env env, napi_value exports) {
    const napi_property_descriptor properties[] = {
        {"start", nullptr, start, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"webGpuStart", nullptr, webGpuStart, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"webGpuSubmit", nullptr, webGpuSubmit, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"webGpuMapRead", nullptr, webGpuMapRead, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"submit", nullptr, submit, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"decodeImage", nullptr, decodeImage, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"resize", nullptr, resize, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"shutdown", nullptr, shutdown, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"isOpen", nullptr, isOpen, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"waitFrame", nullptr, waitFrame, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"pressure", nullptr, pressure, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"backendName", nullptr, backendName, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"lastError", nullptr, lastError, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setToneMapping", nullptr, setToneMapping, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setSceneBackgroundTexture", nullptr, setSceneBackgroundTexture, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setSceneEnvironment", nullptr, setSceneEnvironment, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"pmremFromEquirect", nullptr, pmremFromEquirect, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"pmremFromCubemap", nullptr, pmremFromCubemap, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"pmremFromObject", nullptr, pmremFromObject, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"destroySlot", nullptr, destroySlot, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"stats", nullptr, stats, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"pollInput", nullptr, pollInput, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setPointerLock", nullptr, setPointerLock, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setOverlay", nullptr, setOverlay, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"overlayOpen", nullptr, overlayOpen, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"overlayClick", nullptr, overlayClick, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"toggleFpsOverlay", nullptr, toggleFpsOverlay, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, std::size(properties), properties);
    return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
