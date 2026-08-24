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
#include "camera_capture.h"
#include "canvas2d.h"

#define STB_IMAGE_STATIC
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"
#include "webp/decode.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <climits>
#include <cmath>
#include <cstring>
#include <cstdint>
#include <limits>
#include <new>
#include <string>
#include <vector>

namespace {

std::atomic_bool runtimeActive{false};
std::atomic_int runtimeMode{0};
std::atomic_bool pointerLocked{false};
std::atomic_int requestedReflexMode{-1};
POINT pointerRestorePosition{};
bool pointerRestorePositionValid{false};
HICON packagedIconBig{};
HICON packagedIconSmall{};

void releasePointerLock();

void resetGpuFeatureRequests() {
    requestedReflexMode.store(-1, std::memory_order_release);
}

bool hasBootstrapReadySignal() {
    return GetEnvironmentVariableW(L"THREEBROWSER_READY_FILE", nullptr, 0) > 1;
}

void applyPackagedIcon(HWND hwnd) {
    if (!hwnd || packagedIconBig || packagedIconSmall) return;
    const DWORD length = GetEnvironmentVariableW(L"THREEBROWSER_APP_ICON", nullptr, 0);
    if (length <= 1) return;
    std::wstring path(length, L'\0');
    const DWORD copied = GetEnvironmentVariableW(L"THREEBROWSER_APP_ICON", path.data(), length);
    if (copied == 0 || copied >= length) return;
    path.resize(copied);
    packagedIconBig = static_cast<HICON>(LoadImageW(nullptr, path.c_str(), IMAGE_ICON,
                                                    GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON),
                                                    LR_LOADFROMFILE));
    packagedIconSmall = static_cast<HICON>(LoadImageW(nullptr, path.c_str(), IMAGE_ICON,
                                                      GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON),
                                                      LR_LOADFROMFILE));
    if (packagedIconBig) SendMessageW(hwnd, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(packagedIconBig));
    if (packagedIconSmall) SendMessageW(hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(packagedIconSmall));
}

void revealRuntimeWindow(HWND hwnd) {
    if (!hwnd || !IsWindow(hwnd)) return;
    applyPackagedIcon(hwnd);
    ShowWindowAsync(hwnd, SW_SHOW);
    SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS);
}

void stopActiveRuntime() {
    releasePointerLock();
    threebrowser::camera::closeAll();
    if (!runtimeActive.exchange(false, std::memory_order_acq_rel)) return;
    const int mode = runtimeMode.exchange(0, std::memory_order_acq_rel);
    if (mode == 2) tw_shutdown();
    else if (mode == 1) tn_runtime_shutdown();
    tw_set_overlay_window(nullptr);
    if (packagedIconBig) DestroyIcon(packagedIconBig);
    if (packagedIconSmall) DestroyIcon(packagedIconSmall);
    packagedIconBig = nullptr;
    packagedIconSmall = nullptr;
    resetGpuFeatureRequests();
}

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

bool namedValue(napi_env env, napi_value object, const char* name, napi_value& value) {
    bool has = false;
    return napi_has_named_property(env, object, name, &has) == napi_ok && has &&
           napi_get_named_property(env, object, name, &value) == napi_ok;
}

double namedNumber(napi_env env, napi_value object, const char* name, double fallback) {
    napi_value value{};
    return namedValue(env, object, name, value) ? argNumber(env, value, fallback) : fallback;
}

std::string namedString(napi_env env, napi_value object, const char* name,
                        const char* fallback = "") {
    napi_value value{};
    return namedValue(env, object, name, value) ? argString(env, value, fallback) : fallback;
}

using threebrowser::canvas2d::CanvasSurface;
using threebrowser::canvas2d::LinearGradient;

constexpr napi_type_tag canvasSurfaceTypeTag{
    0xf024c2e415f844a1ULL, 0x836dc652b278eb4dULL};
constexpr napi_type_tag canvasGradientTypeTag{
    0xa2fb0b221a4a4d88ULL, 0xa85658882e08f52bULL};

void finalizeCanvasSurface(napi_env, void* data, void*) {
    delete static_cast<CanvasSurface*>(data);
}

void finalizeCanvasGradient(napi_env, void* data, void*) {
    delete static_cast<LinearGradient*>(data);
}

template<typename T>
T* canvasExternal(napi_env env, napi_value value, const napi_type_tag& tag, const char* expected) {
    bool matches = false;
    if (napi_check_object_type_tag(env, value, &tag, &matches) != napi_ok || !matches) {
        napi_throw_type_error(env, nullptr, expected);
        return nullptr;
    }
    void* data = nullptr;
    if (napi_get_value_external(env, value, &data) != napi_ok || !data) {
        napi_throw_type_error(env, nullptr, expected);
        return nullptr;
    }
    return static_cast<T*>(data);
}

CanvasSurface* canvasSurface(napi_env env, napi_value value) {
    return canvasExternal<CanvasSurface>(env, value, canvasSurfaceTypeTag,
                                         "Expected a Canvas2D surface");
}

LinearGradient* canvasGradient(napi_env env, napi_value value) {
    return canvasExternal<LinearGradient>(env, value, canvasGradientTypeTag,
                                          "Expected a Canvas2D linear gradient");
}

bool canvasInteger(napi_env env, napi_value value, int& result) {
    napi_valuetype type{};
    double numberValue = 0;
    if (napi_typeof(env, value, &type) != napi_ok || type != napi_number ||
        napi_get_value_double(env, value, &numberValue) != napi_ok ||
        !std::isfinite(numberValue) ||
        numberValue < static_cast<double>(std::numeric_limits<int>::min()) ||
        numberValue > static_cast<double>(std::numeric_limits<int>::max())) {
        napi_throw_range_error(env, nullptr, "Expected a finite 32-bit integer");
        return false;
    }
    result = static_cast<int>(numberValue);
    return true;
}

bool canvasBytes(napi_env env, napi_value value, const std::uint8_t*& data,
                 std::size_t& byteLength) {
    bool isBuffer = false;
    if (napi_is_buffer(env, value, &isBuffer) == napi_ok && isBuffer) {
        void* raw = nullptr;
        if (napi_get_buffer_info(env, value, &raw, &byteLength) == napi_ok) {
            data = static_cast<const std::uint8_t*>(raw);
            return true;
        }
    }

    bool isTypedArray = false;
    if (napi_is_typedarray(env, value, &isTypedArray) != napi_ok || !isTypedArray) {
        napi_throw_type_error(env, nullptr, "Expected Uint8Array or Uint8ClampedArray pixels");
        return false;
    }
    napi_typedarray_type type{};
    std::size_t length = 0;
    void* raw = nullptr;
    napi_value arrayBuffer{};
    std::size_t offset = 0;
    if (napi_get_typedarray_info(env, value, &type, &length, &raw, &arrayBuffer, &offset) != napi_ok ||
        (type != napi_uint8_array && type != napi_uint8_clamped_array)) {
        napi_throw_type_error(env, nullptr, "Expected Uint8Array or Uint8ClampedArray pixels");
        return false;
    }
    data = static_cast<const std::uint8_t*>(raw);
    byteLength = length;
    return true;
}

napi_value canvasByteArray(napi_env env, const std::vector<std::uint8_t>& bytes,
                           napi_typedarray_type type) {
    void* output = nullptr;
    napi_value arrayBuffer{};
    if (napi_create_arraybuffer(env, bytes.size(), &output, &arrayBuffer) != napi_ok) return nullptr;
    if (!bytes.empty()) std::memcpy(output, bytes.data(), bytes.size());
    napi_value result{};
    if (napi_create_typedarray(env, type, bytes.size(), arrayBuffer, 0, &result) != napi_ok) return nullptr;
    return result;
}
napi_value canvas2dCreate(napi_env env, napi_callback_info info) {
    std::array<napi_value, 3> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    if (argc < 2) {
        napi_throw_type_error(env, nullptr, "canvas2dCreate requires width and height");
        return nullptr;
    }
    int width = 0;
    int height = 0;
    if (!canvasInteger(env, argv[0], width) || !canvasInteger(env, argv[1], height)) return nullptr;
    if (width < 0 || height < 0) {
        napi_throw_range_error(env, nullptr, "Canvas dimensions cannot be negative");
        return nullptr;
    }

    CanvasSurface* surface = nullptr;
    try {
        surface = new CanvasSurface(width, height);
        if (argc >= 3) {
            const std::uint8_t* pixels = nullptr;
            std::size_t byteLength = 0;
            if (!canvasBytes(env, argv[2], pixels, byteLength)) {
                delete surface;
                return nullptr;
            }
            if (!surface->writePixels(0, 0, width, height,
                                      std::span<const std::uint8_t>(pixels, byteLength))) {
                delete surface;
                napi_throw_range_error(env, nullptr, "Initial Canvas2D pixel buffer is too small");
                return nullptr;
            }
        }
    } catch (const std::exception& error) {
        delete surface;
        napi_throw_error(env, nullptr, error.what());
        return nullptr;
    } catch (...) {
        delete surface;
        napi_throw_error(env, nullptr, "Could not create Canvas2D surface");
        return nullptr;
    }

    napi_value result{};
    if (napi_create_external(env, surface, finalizeCanvasSurface, nullptr, &result) != napi_ok) {
        delete surface;
        return nullptr;
    }
    if (napi_type_tag_object(env, result, &canvasSurfaceTypeTag) != napi_ok) return nullptr;
    return result;
}

napi_value canvas2dResize(napi_env env, napi_callback_info info) {
    std::array<napi_value, 3> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    if (argc < 3) {
        napi_throw_type_error(env, nullptr, "canvas2dResize requires a surface, width and height");
        return nullptr;
    }
    auto* surface = canvasSurface(env, argv[0]);
    int width = 0;
    int height = 0;
    if (!surface || !canvasInteger(env, argv[1], width) || !canvasInteger(env, argv[2], height)) return nullptr;
    return boolean(env, surface->resize(width, height));
}

napi_value canvas2dSet(napi_env env, napi_callback_info info) {
    std::array<napi_value, 3> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    if (argc < 3) {
        napi_throw_type_error(env, nullptr, "canvas2dSet requires a surface, property and value");
        return nullptr;
    }
    auto* surface = canvasSurface(env, argv[0]);
    if (!surface) return nullptr;
    napi_valuetype propertyType{};
    if (napi_typeof(env, argv[1], &propertyType) != napi_ok || propertyType != napi_string) {
        napi_throw_type_error(env, nullptr, "Canvas2D property name must be a string");
        return nullptr;
    }
    const std::string property = argString(env, argv[1], "");
    napi_valuetype valueType{};
    napi_typeof(env, argv[2], &valueType);
    if (valueType == napi_number) {
        double value = 0;
        napi_get_value_double(env, argv[2], &value);
        return boolean(env, surface->setNumber(property, value));
    }
    if (valueType == napi_string) {
        return boolean(env, surface->setString(property, argString(env, argv[2], "")));
    }
    if (valueType == napi_boolean) {
        bool value = false;
        napi_get_value_bool(env, argv[2], &value);
        return boolean(env, surface->setNumber(property, value ? 1.0 : 0.0));
    }
    napi_throw_type_error(env, nullptr, "Canvas2D property value must be a number or string");
    return nullptr;
}

napi_value canvas2dGradientCreate(napi_env env, napi_callback_info info) {
    std::array<napi_value, 5> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    const bool hasSurface = argc >= 5;
    const std::size_t offset = hasSurface ? 1 : 0;
    if (argc < offset + 4) {
        napi_throw_type_error(env, nullptr, "canvas2dGradientCreate requires four coordinates");
        return nullptr;
    }
    CanvasSurface* surface = nullptr;
    if (hasSurface && !(surface = canvasSurface(env, argv[0]))) return nullptr;
    std::array<double, 4> coordinates{};
    for (std::size_t i = 0; i < coordinates.size(); ++i) {
        napi_valuetype type{};
        if (napi_typeof(env, argv[offset + i], &type) != napi_ok || type != napi_number ||
            napi_get_value_double(env, argv[offset + i], &coordinates[i]) != napi_ok) {
            napi_throw_type_error(env, nullptr, "Canvas2D gradient coordinates must be numbers");
            return nullptr;
        }
    }

    LinearGradient* gradient = nullptr;
    try {
        gradient = new LinearGradient(surface
            ? surface->createLinearGradient(coordinates[0], coordinates[1], coordinates[2], coordinates[3])
            : LinearGradient(coordinates[0], coordinates[1], coordinates[2], coordinates[3]));
    } catch (const std::exception& error) {
        napi_throw_error(env, nullptr, error.what());
        return nullptr;
    } catch (...) {
        napi_throw_error(env, nullptr, "Could not create Canvas2D gradient");
        return nullptr;
    }
    napi_value result{};
    if (napi_create_external(env, gradient, finalizeCanvasGradient, nullptr, &result) != napi_ok) {
        delete gradient;
        return nullptr;
    }
    if (napi_type_tag_object(env, result, &canvasGradientTypeTag) != napi_ok) return nullptr;
    return result;
}

napi_value canvas2dGradientAddColorStop(napi_env env, napi_callback_info info) {
    std::array<napi_value, 3> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    if (argc < 3) {
        napi_throw_type_error(env, nullptr,
                              "canvas2dGradientAddColorStop requires a gradient, offset and color");
        return nullptr;
    }
    auto* gradient = canvasGradient(env, argv[0]);
    if (!gradient) return nullptr;
    double offset = 0;
    napi_valuetype offsetType{};
    napi_valuetype colorType{};
    if (napi_typeof(env, argv[1], &offsetType) != napi_ok || offsetType != napi_number ||
        napi_get_value_double(env, argv[1], &offset) != napi_ok ||
        napi_typeof(env, argv[2], &colorType) != napi_ok || colorType != napi_string) {
        napi_throw_type_error(env, nullptr, "Color stop offset must be a number and color must be a string");
        return nullptr;
    }
    return boolean(env, gradient->addColorStop(offset, argString(env, argv[2], "")));
}

napi_value canvas2dSetGradient(napi_env env, napi_callback_info info) {
    std::array<napi_value, 3> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    if (argc < 3) {
        napi_throw_type_error(env, nullptr,
                              "canvas2dSetGradient requires a surface, property and gradient");
        return nullptr;
    }
    auto* surface = canvasSurface(env, argv[0]);
    auto* gradient = canvasGradient(env, argv[2]);
    if (!surface || !gradient) return nullptr;
    napi_valuetype type{};
    if (napi_typeof(env, argv[1], &type) != napi_ok || type != napi_string) {
        napi_throw_type_error(env, nullptr, "Canvas2D property name must be a string");
        return nullptr;
    }
    return boolean(env, surface->setGradient(argString(env, argv[1], ""), *gradient));
}
napi_value canvas2dCall(napi_env env, napi_callback_info info) {
    std::array<napi_value, 16> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    if (argc < 2) {
        napi_throw_type_error(env, nullptr, "canvas2dCall requires a surface and operation");
        return nullptr;
    }
    auto* surface = canvasSurface(env, argv[0]);
    if (!surface) return nullptr;
    napi_valuetype operationType{};
    if (napi_typeof(env, argv[1], &operationType) != napi_ok || operationType != napi_string) {
        napi_throw_type_error(env, nullptr, "Canvas2D operation must be a string");
        return nullptr;
    }
    const std::string operation = argString(env, argv[1], "");
    std::vector<double> numbers;
    numbers.reserve(argc > 2 ? argc - 2 : 0);
    std::string textValue;
    bool hasText = false;
    for (std::size_t i = 2; i < argc; ++i) {
        napi_valuetype type{};
        napi_typeof(env, argv[i], &type);
        if (type == napi_number) {
            double value = 0;
            napi_get_value_double(env, argv[i], &value);
            numbers.push_back(value);
        } else if (type == napi_string && !hasText) {
            textValue = argString(env, argv[i], "");
            hasText = true;
        } else {
            napi_throw_type_error(env, nullptr, "Canvas2D operation arguments must be numbers or one string");
            return nullptr;
        }
    }
    return boolean(env, surface->call(operation, numbers, textValue));
}

napi_value canvas2dReadPixels(napi_env env, napi_callback_info info) {
    std::array<napi_value, 5> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    if (argc < 1) {
        napi_throw_type_error(env, nullptr, "canvas2dReadPixels requires a surface");
        return nullptr;
    }
    auto* surface = canvasSurface(env, argv[0]);
    if (!surface) return nullptr;
    int x = 0;
    int y = 0;
    int width = -1;
    int height = -1;
    int* values[] = {&x, &y, &width, &height};
    for (std::size_t i = 1; i < argc; ++i) {
        if (!canvasInteger(env, argv[i], *values[i - 1])) return nullptr;
    }
    try {
        return canvasByteArray(env, surface->readPixels(x, y, width, height), napi_uint8_clamped_array);
    } catch (const std::exception& error) {
        napi_throw_error(env, nullptr, error.what());
        return nullptr;
    }
}

napi_value canvas2dWritePixels(napi_env env, napi_callback_info info) {
    std::array<napi_value, 10> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    if (argc < 6) {
        napi_throw_type_error(env, nullptr,
                              "canvas2dWritePixels requires surface, pixels, width, height, dx and dy");
        return nullptr;
    }
    auto* surface = canvasSurface(env, argv[0]);
    if (!surface) return nullptr;
    const std::uint8_t* pixels = nullptr;
    std::size_t byteLength = 0;
    if (!canvasBytes(env, argv[1], pixels, byteLength)) return nullptr;
    int width = 0;
    int height = 0;
    int destinationX = 0;
    int destinationY = 0;
    int sourceX = 0;
    int sourceY = 0;
    int copyWidth = -1;
    int copyHeight = -1;
    int* values[] = {&width, &height, &destinationX, &destinationY,
                     &sourceX, &sourceY, &copyWidth, &copyHeight};
    for (std::size_t i = 2; i < argc; ++i) {
        if (!canvasInteger(env, argv[i], *values[i - 2])) return nullptr;
    }
    return boolean(env, surface->writePixels(destinationX, destinationY, width, height,
                                              std::span<const std::uint8_t>(pixels, byteLength),
                                              sourceX, sourceY, copyWidth, copyHeight));
}

napi_value canvas2dDrawImage(napi_env env, napi_callback_info info) {
    std::array<napi_value, 10> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    if (argc < 4) {
        napi_throw_type_error(env, nullptr,
                              "canvas2dDrawImage requires destination, source and at least dx and dy");
        return nullptr;
    }
    auto* destination = canvasSurface(env, argv[0]);
    auto* source = canvasSurface(env, argv[1]);
    if (!destination || !source) return nullptr;
    std::vector<double> numbers;
    numbers.reserve(argc - 2);
    for (std::size_t i = 2; i < argc; ++i) {
        napi_valuetype type{};
        double value = 0;
        if (napi_typeof(env, argv[i], &type) != napi_ok || type != napi_number ||
            napi_get_value_double(env, argv[i], &value) != napi_ok) {
            napi_throw_type_error(env, nullptr, "Canvas2D drawImage arguments must be numbers");
            return nullptr;
        }
        numbers.push_back(value);
    }
    return boolean(env, destination->drawImage(*source, numbers));
}
napi_value canvas2dMeasureText(napi_env env, napi_callback_info info) {
    std::array<napi_value, 2> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    if (argc < 2) {
        napi_throw_type_error(env, nullptr, "canvas2dMeasureText requires a surface and text");
        return nullptr;
    }
    auto* surface = canvasSurface(env, argv[0]);
    if (!surface) return nullptr;
    napi_valuetype type{};
    if (napi_typeof(env, argv[1], &type) != napi_ok || type != napi_string) {
        napi_throw_type_error(env, nullptr, "Canvas2D text must be a string");
        return nullptr;
    }
    const auto metrics = surface->measureText(argString(env, argv[1], ""));
    napi_value result{};
    napi_create_object(env, &result);
    set(env, result, "width", number(env, metrics.width));
    set(env, result, "actualBoundingBoxLeft", number(env, metrics.actualBoundingBoxLeft));
    set(env, result, "actualBoundingBoxRight", number(env, metrics.actualBoundingBoxRight));
    set(env, result, "actualBoundingBoxAscent", number(env, metrics.actualBoundingBoxAscent));
    set(env, result, "actualBoundingBoxDescent", number(env, metrics.actualBoundingBoxDescent));
    set(env, result, "fontBoundingBoxAscent", number(env, metrics.fontBoundingBoxAscent));
    set(env, result, "fontBoundingBoxDescent", number(env, metrics.fontBoundingBoxDescent));
    return result;
}

napi_value canvas2dEncodePng(napi_env env, napi_callback_info info) {
    napi_value argv[1]{};
    std::size_t argc = 1;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc < 1) {
        napi_throw_type_error(env, nullptr, "canvas2dEncodePng requires a surface");
        return nullptr;
    }
    auto* surface = canvasSurface(env, argv[0]);
    if (!surface) return nullptr;
    try {
        return canvasByteArray(env, surface->encodePng(), napi_uint8_array);
    } catch (const std::exception& error) {
        napi_throw_error(env, nullptr, error.what());
        return nullptr;
    }
}
napi_value start(napi_env env, napi_callback_info info) {
    std::array<napi_value, 3> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    const int width = argc > 0 ? static_cast<int>(argNumber(env, argv[0], 1280)) : 1280;
    const int height = argc > 1 ? static_cast<int>(argNumber(env, argv[1], 720)) : 720;
    const std::string title = argc > 2 ? argString(env, argv[2], "ThreeBrowser Runtime") : "ThreeBrowser Runtime";
    if (runtimeActive.load(std::memory_order_acquire)) {
        if (runtimeMode.load(std::memory_order_acquire) == 1) return boolean(env, true);
        stopActiveRuntime();
    }
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    tn_runtime_set_standalone(1);
    tn_runtime_set_vsync(0);
    const bool ok = tn_runtime_start(width, height, title.c_str()) != 0;
    runtimeActive.store(ok, std::memory_order_release);
    runtimeMode.store(ok ? 1 : 0, std::memory_order_release);
    if (ok) {
        tn_runtime_set_loading(1, "Loading project assets");
        if (auto hwnd = static_cast<HWND>(tn_runtime_hwnd())) {
            tw_set_overlay_window(hwnd);
            applyPackagedIcon(hwnd);
            if (!hasBootstrapReadySignal()) revealRuntimeWindow(hwnd);
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
    if (runtimeActive.load(std::memory_order_acquire)) {
        if (runtimeMode.load(std::memory_order_acquire) == 2) return boolean(env, true);
        stopActiveRuntime();
    }
    resetGpuFeatureRequests();
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    tw_set_standalone_ui(1);
    tw_set_vsync(0);
    const bool ok = tw_start(nullptr, 0, 0, width, height) != 0;
    runtimeActive.store(ok, std::memory_order_release);
    runtimeMode.store(ok ? 2 : 0, std::memory_order_release);
    if (ok) {
        tw_set_loading(1, "Loading project assets");
        if (auto hwnd = static_cast<HWND>(tw_hwnd())) {
            tw_set_overlay_window(hwnd);
            applyPackagedIcon(hwnd);
            if (!hasBootstrapReadySignal()) revealRuntimeWindow(hwnd);
        }
    }
    return boolean(env, ok);
}

napi_value reveal(napi_env env, napi_callback_info) {
    const HWND hwnd = runtimeHwnd();
    revealRuntimeWindow(hwnd);
    return boolean(env, hwnd && IsWindow(hwnd));
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

napi_value render(napi_env env, napi_callback_info info) {
    if (!runtimeActive.load(std::memory_order_acquire)) return boolean(env, false);
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc < 2) return boolean(env, false);
    return boolean(env, tn_runtime_render(
        static_cast<std::uint32_t>(argNumber(env, argv[0], 0)),
        static_cast<std::uint32_t>(argNumber(env, argv[1], 0))) != 0);
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
    bool webpPixels = false;
    if (!pixels) {
        pixels = reinterpret_cast<stbi_uc*>(WebPDecodeRGBA(static_cast<const std::uint8_t*>(data), size,
                                                           &width, &height));
        webpPixels = pixels != nullptr;
    }
    if (!pixels || width <= 0 || height <= 0) {
        if (pixels) {
            if (webpPixels) WebPFree(pixels);
            else stbi_image_free(pixels);
        }
        return undefined(env);
    }
    const std::size_t pixelBytes = static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4;
    void* output = nullptr;
    napi_value arrayBuffer{};
    napi_create_arraybuffer(env, pixelBytes, &output, &arrayBuffer);
    std::memcpy(output, pixels, pixelBytes);
    if (webpPixels) WebPFree(pixels);
    else stbi_image_free(pixels);

    napi_value typedPixels{};
    napi_create_typedarray(env, napi_uint8_clamped_array, pixelBytes, arrayBuffer, 0, &typedPixels);
    napi_value result{};
    napi_create_object(env, &result);
    set(env, result, "width", number(env, width));
    set(env, result, "height", number(env, height));
    set(env, result, "pixels", typedPixels);
    return result;
}

napi_value cameraDevices(napi_env env, napi_callback_info) {
    std::string error;
    const auto devices = threebrowser::camera::enumerate(error);
    if (!error.empty()) {
        napi_throw_error(env, nullptr, error.c_str());
        return undefined(env);
    }
    napi_value result{};
    napi_create_array_with_length(env, devices.size(), &result);
    for (std::size_t index = 0; index < devices.size(); ++index) {
        napi_value device{};
        napi_create_object(env, &device);
        set(env, device, "deviceId", string(env, devices[index].id.c_str()));
        set(env, device, "label", string(env, devices[index].label.c_str()));
        napi_set_element(env, result, index, device);
    }
    return result;
}

napi_value cameraOpen(napi_env env, napi_callback_info info) {
    napi_value argv[1]{};
    std::size_t argc = 1;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    threebrowser::camera::OpenRequest request;
    if (argc > 0) {
        napi_valuetype type{};
        if (napi_typeof(env, argv[0], &type) == napi_ok && type == napi_object) {
            request.deviceId = namedString(env, argv[0], "deviceId");
            request.width = static_cast<std::uint32_t>(std::clamp(
                namedNumber(env, argv[0], "width", 0), 0.0, 16384.0));
            request.height = static_cast<std::uint32_t>(std::clamp(
                namedNumber(env, argv[0], "height", 0), 0.0, 16384.0));
            request.frameRate = std::clamp(namedNumber(env, argv[0], "frameRate", 0), 0.0, 240.0);
        }
    }

    const auto opened = threebrowser::camera::open(request);
    napi_value result{};
    napi_create_object(env, &result);
    set(env, result, "handle", number(env, opened.handle));
    set(env, result, "deviceId", string(env, opened.deviceId.c_str()));
    set(env, result, "label", string(env, opened.label.c_str()));
    set(env, result, "width", number(env, opened.width));
    set(env, result, "height", number(env, opened.height));
    set(env, result, "frameRate", number(env, opened.frameRate));
    set(env, result, "error", string(env, opened.error.c_str()));
    return result;
}

bool cameraDestination(napi_env env, napi_value value, std::uint8_t*& data,
                       std::size_t& byteLength) {
    data = nullptr;
    byteLength = 0;
    napi_valuetype valueType{};
    if (napi_typeof(env, value, &valueType) != napi_ok ||
        valueType == napi_null || valueType == napi_undefined) {
        return true;
    }
    bool isBuffer = false;
    if (napi_is_buffer(env, value, &isBuffer) == napi_ok && isBuffer) {
        void* raw = nullptr;
        if (napi_get_buffer_info(env, value, &raw, &byteLength) != napi_ok) return false;
        data = static_cast<std::uint8_t*>(raw);
        return true;
    }
    bool isTypedArray = false;
    if (napi_is_typedarray(env, value, &isTypedArray) != napi_ok || !isTypedArray) return false;
    napi_typedarray_type type{};
    std::size_t length = 0;
    void* raw = nullptr;
    napi_value arrayBuffer{};
    std::size_t offset = 0;
    if (napi_get_typedarray_info(env, value, &type, &length, &raw, &arrayBuffer, &offset) != napi_ok ||
        (type != napi_uint8_array && type != napi_uint8_clamped_array)) {
        return false;
    }
    data = static_cast<std::uint8_t*>(raw);
    byteLength = length;
    return true;
}

napi_value cameraRead(napi_env env, napi_callback_info info) {
    napi_value argv[3]{};
    std::size_t argc = 3;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc == 0) {
        napi_throw_type_error(env, nullptr, "cameraRead requires a camera handle");
        return undefined(env);
    }
    const auto handle = static_cast<std::uint32_t>(std::max(0.0, argNumber(env, argv[0], 0)));
    const auto afterSequence = argc > 1
        ? static_cast<std::uint64_t>(std::max(0.0, argNumber(env, argv[1], 0)))
        : 0;
    std::uint8_t* destination = nullptr;
    std::size_t destinationSize = 0;
    if (argc > 2 && !cameraDestination(env, argv[2], destination, destinationSize)) {
        napi_throw_type_error(env, nullptr,
                              "cameraRead destination must be a Uint8Array, Uint8ClampedArray or Buffer");
        return undefined(env);
    }
    threebrowser::camera::ReadResult read;
    std::string error;
    if (!threebrowser::camera::read(handle, afterSequence, destination, destinationSize, read, error)) {
        napi_throw_error(env, nullptr, error.c_str());
        return undefined(env);
    }
    napi_value result{};
    napi_create_object(env, &result);
    set(env, result, "sequence", number(env, static_cast<double>(read.sequence)));
    set(env, result, "timestampUs", number(env, static_cast<double>(read.timestampUs)));
    set(env, result, "width", number(env, read.width));
    set(env, result, "height", number(env, read.height));
    set(env, result, "byteLength", number(env, static_cast<double>(read.byteLength)));
    set(env, result, "hasNewFrame", boolean(env, read.hasNewFrame));
    set(env, result, "copied", boolean(env, read.copied));
    set(env, result, "ended", boolean(env, read.ended));
    set(env, result, "error", string(env, read.error.c_str()));
    return result;
}

napi_value cameraClose(napi_env env, napi_callback_info info) {
    napi_value argv[1]{};
    std::size_t argc = 1;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc > 0) {
        const auto handle = static_cast<std::uint32_t>(std::max(0.0, argNumber(env, argv[0], 0)));
        threebrowser::camera::close(handle);
    }
    return undefined(env);
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
    stopActiveRuntime();
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
    if (enabled) releasePointerLock();
    if (runtimeMode.load(std::memory_order_acquire) == 2) tw_set_overlay(enabled ? 1 : 0);
    else tn_runtime_set_overlay(enabled ? 1 : 0);
    return boolean(env, true);
}

napi_value setLoading(napi_env env, napi_callback_info info) {
    std::array<napi_value, 2> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    bool enabled = false;
    if (argc > 0) napi_get_value_bool(env, argv[0], &enabled);
    const std::string stage = argc > 1 ? argString(env, argv[1], "") : "";
    if (runtimeMode.load(std::memory_order_acquire) == 2) tw_set_loading(enabled ? 1 : 0, stage.c_str());
    else if (runtimeMode.load(std::memory_order_acquire) == 1) tn_runtime_set_loading(enabled ? 1 : 0, stage.c_str());
    return boolean(env, runtimeActive.load(std::memory_order_acquire));
}

napi_value overlayOpen(napi_env env, napi_callback_info) {
    return boolean(env, runtimeMode.load(std::memory_order_acquire) == 2
        ? tw_overlay_open() != 0
        : tn_runtime_overlay_open() != 0);
}

napi_value overlayClick(napi_env env, napi_callback_info info) {
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc == 2) {
        const int x = static_cast<int>(argNumber(env, argv[0], 0));
        const int y = static_cast<int>(argNumber(env, argv[1], 0));
        if (runtimeMode.load(std::memory_order_acquire) == 2) tw_overlay_click(x, y);
        else tn_runtime_overlay_click(x, y);
        int mode = 0, width = 0, height = 0, refreshHz = 0;
        if (tw_take_display_command(&mode, &width, &height, &refreshHz)) {
            releasePointerLock();
            if (runtimeMode.load(std::memory_order_acquire) == 2) {
                tw_set_fullscreen(mode, width, height, refreshHz);
            } else if (runtimeMode.load(std::memory_order_acquire) == 1) {
                tn_runtime_set_fullscreen(mode, width, height, refreshHz);
            }
        }
    }
    return undefined(env);
}

napi_value overlayPointerMove(napi_env env, napi_callback_info info) {
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc == 2) {
        tw_overlay_pointer_move(static_cast<int>(argNumber(env, argv[0], 0)),
                                static_cast<int>(argNumber(env, argv[1], 0)));
    }
    return undefined(env);
}

napi_value overlayWheel(napi_env env, napi_callback_info info) {
    napi_value argv[1]{};
    std::size_t argc = 1;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc == 1) tw_overlay_wheel(static_cast<int>(argNumber(env, argv[0], 0)));
    return undefined(env);
}

napi_value toggleFpsOverlay(napi_env env, napi_callback_info) {
    if (runtimeMode.load(std::memory_order_acquire) == 2) tw_toggle_fps_overlay();
    else tn_runtime_toggle_fps_overlay();
    return undefined(env);
}

napi_value isOpen(napi_env env, napi_callback_info) {
    if (!runtimeActive.load(std::memory_order_acquire)) return boolean(env, false);
    const auto hwnd = runtimeHwnd();
    const bool open = runtimeMode.load(std::memory_order_acquire) == 2 ? tw_is_open() != 0 : tn_runtime_is_open() != 0;
    return boolean(env, open && hwnd && IsWindow(hwnd));
}

napi_value waitFrame(napi_env env, napi_callback_info) {
    // threepp submissions wait for their native presentation. A second,
    // unrelated DwmFlush here can land on the following compositor tick and
    // makes frame pacing alternate between short and long intervals.
    return undefined(env);
}

napi_value pressure(napi_env env, napi_callback_info) {
    return number(env, runtimeMode.load(std::memory_order_acquire) == 2 ? tw_backlog() : 0);
}

napi_value backendName(napi_env env, napi_callback_info) {
    return string(env, runtimeMode.load(std::memory_order_acquire) == 2 ? tw_backend_name() : tn_backend_name());
}

bool readGpuCapabilities(TWGpuCapabilities& capabilities) {
    capabilities = {};
    capabilities.struct_size = sizeof(capabilities);
    return runtimeMode.load(std::memory_order_acquire) == 2 &&
           tw_gpu_capabilities(&capabilities) != 0;
}

napi_value gpuCapabilitiesObject(napi_env env, const TWGpuCapabilities& capabilities, bool available) {
    napi_value object{};
    napi_create_object(env, &object);
    if (!available) return object;
    set(env, object, "vendorId", number(env, capabilities.vendor_id));
    set(env, object, "deviceId", number(env, capabilities.device_id));
    set(env, object, "rtx", boolean(env, capabilities.is_rtx != 0));
    set(env, object, "streamlinePresent", boolean(env, capabilities.streamline_present != 0));
    set(env, object, "streamlineInitialized", boolean(env, capabilities.streamline_initialized != 0));
    set(env, object, "vulkanAttached", boolean(env, capabilities.vulkan_attached != 0));
    set(env, object, "dlssSuperResolution", boolean(env, capabilities.dlss_super_resolution != 0));
    set(env, object, "dlssFrameGeneration", boolean(env, capabilities.dlss_frame_generation != 0));
    set(env, object, "dlssRayReconstruction", boolean(env, capabilities.dlss_ray_reconstruction != 0));
    set(env, object, "reflex", boolean(env, capabilities.reflex != 0));
    set(env, object, "nativeRayTracing", boolean(env, capabilities.native_ray_tracing != 0));
    set(env, object, "rayQuery", boolean(env, capabilities.ray_query != 0));
    set(env, object, "adapterName", string(env, capabilities.adapter_name));
    set(env, object, "status", string(env, capabilities.status));
    return object;
}

napi_value gpuCapabilities(napi_env env, napi_callback_info) {
    TWGpuCapabilities capabilities{};
    const bool available = readGpuCapabilities(capabilities);
    return gpuCapabilitiesObject(env, capabilities, available);
}

napi_value makeFeatureState(napi_env env, bool supported, int requested,
                            bool configured, bool active, const char* reason) {
    napi_value object{};
    napi_create_object(env, &object);
    set(env, object, "supported", boolean(env, supported));
    set(env, object, "requested", boolean(env, requested > 0));
    set(env, object, "requestSpecified", boolean(env, requested >= 0));
    set(env, object, "configured", boolean(env, configured));
    set(env, object, "active", boolean(env, active));
    set(env, object, "reason", string(env, reason));
    return object;
}

bool readGpuFeatureStatus(TWGpuFeatureStatus& status) {
    status = {};
    status.struct_size = sizeof(status);
    return runtimeMode.load(std::memory_order_acquire) == 2 &&
           tw_gpu_feature_status(&status) != 0;
}

bool readFrameGenerationStatus(TWFrameGenerationStatus& status) {
    status = {};
    status.struct_size = sizeof(status);
    return runtimeMode.load(std::memory_order_acquire) == 2 &&
           tw_frame_generation_status(&status) != 0;
}

const char* dlssModeName(uint32_t mode) {
    switch (mode) {
        case TW_DLSS_MAX_PERFORMANCE: return "max-performance";
        case TW_DLSS_BALANCED: return "balanced";
        case TW_DLSS_MAX_QUALITY: return "quality";
        case TW_DLSS_ULTRA_PERFORMANCE: return "ultra-performance";
        case TW_DLSS_ULTRA_QUALITY: return "ultra-quality";
        case TW_DLSS_DLAA: return "dlaa";
        default: return "off";
    }
}

napi_value gpuFeatureStatusObject(napi_env env) {
    TWGpuCapabilities capabilities{};
    const bool available = readGpuCapabilities(capabilities);
    TWGpuFeatureStatus nativeStatus{};
    const bool statusAvailable = readGpuFeatureStatus(nativeStatus);
    TWFrameGenerationStatus nativeFrameGeneration{};
    const bool frameGenerationStatusAvailable =
        readFrameGenerationStatus(nativeFrameGeneration);
    const int reflexRequest = requestedReflexMode.load(std::memory_order_acquire);
    const int activeReflexMode = available ? tw_reflex_mode() : 0;
    const bool reflexSupported = available && capabilities.reflex != 0;
    const bool reflexConfigured = reflexRequest >= 0 && reflexSupported &&
                                  activeReflexMode == reflexRequest;

    const char* reflexReason = !available
        ? "The native WebGPU capability surface is not available."
        : !reflexSupported
            ? "NVIDIA Reflex is not supported by the active Streamline context."
            : reflexRequest < 0
                ? (activeReflexMode > 0
                    ? "Enabled by the native runtime default; no page request has been made."
                    : "Supported, but no page request has been made.")
                : reflexConfigured
                    ? (activeReflexMode > 0
                        ? "The requested Reflex mode is configured and active."
                        : "Reflex is configured off as requested.")
                    : "The requested Reflex mode was not accepted by the native runtime.";

    napi_value object{};
    napi_create_object(env, &object);
    set(env, object, "apiVersion", number(env, 1));
    set(env, object, "available", boolean(env, available));
    set(env, object, "backend", string(env, available ? tw_backend_name() : ""));
    set(env, object, "capabilities", gpuCapabilitiesObject(env, capabilities, available));

    napi_value features{};
    napi_create_object(env, &features);
    napi_value reflex = makeFeatureState(env, reflexSupported, reflexRequest,
                                         reflexConfigured, reflexSupported && activeReflexMode > 0,
                                         reflexReason);
    set(env, reflex, "requestedMode", number(env, reflexRequest));
    set(env, reflex, "activeMode", number(env, activeReflexMode));
    set(env, features, "reflex", reflex);

    const bool dlssSupported = statusAvailable
        ? nativeStatus.dlss_supported != 0
        : available && capabilities.dlss_super_resolution != 0;
    const bool frameGenerationSupported = frameGenerationStatusAvailable
        ? nativeFrameGeneration.supported != 0
        : statusAvailable
        ? nativeStatus.frame_generation_supported != 0
        : available && capabilities.dlss_frame_generation != 0;
    const bool rayReconstructionSupported = statusAvailable
        ? nativeStatus.ray_reconstruction_supported != 0
        : available && capabilities.dlss_ray_reconstruction != 0;
    const char* unavailableStatus = "The native feature-state query is not available.";

    napi_value dlss = makeFeatureState(
        env, dlssSupported,
        statusAvailable && nativeStatus.dlss_requested ? 1 : (statusAvailable ? 0 : -1),
        statusAvailable && nativeStatus.dlss_configured != 0,
        statusAvailable && nativeStatus.dlss_active != 0,
        statusAvailable ? nativeStatus.dlss_reason : unavailableStatus);
    set(env, dlss, "apiLoaded", boolean(env, statusAvailable && nativeStatus.dlss_api_loaded != 0));
    set(env, dlss, "mode", number(env, statusAvailable ? nativeStatus.dlss_mode : TW_DLSS_OFF));
    set(env, dlss, "modeName", string(env, dlssModeName(statusAvailable ? nativeStatus.dlss_mode : TW_DLSS_OFF)));
    set(env, dlss, "renderWidth", number(env, statusAvailable ? nativeStatus.render_width : 0));
    set(env, dlss, "renderHeight", number(env, statusAvailable ? nativeStatus.render_height : 0));
    set(env, dlss, "outputWidth", number(env, statusAvailable ? nativeStatus.output_width : 0));
    set(env, dlss, "outputHeight", number(env, statusAvailable ? nativeStatus.output_height : 0));
    set(env, dlss, "estimatedVramBytes", number(env, statusAvailable ? static_cast<double>(nativeStatus.estimated_vram_bytes) : 0));
    set(env, dlss, "evaluationCount", number(env, statusAvailable ? static_cast<double>(nativeStatus.dlss_evaluation_count) : 0));
    set(env, dlss, "failureCount", number(env, statusAvailable ? static_cast<double>(nativeStatus.dlss_failure_count) : 0));
    set(env, dlss, "lastResult", number(env, statusAvailable ? nativeStatus.dlss_last_result : 0));
    set(env, features, "dlssSuperResolution", dlss);

    napi_value frameGeneration = makeFeatureState(
        env, frameGenerationSupported,
        frameGenerationStatusAvailable && nativeFrameGeneration.requested
            ? 1 : (frameGenerationStatusAvailable ? 0 : -1),
        frameGenerationStatusAvailable && nativeFrameGeneration.configured != 0,
        frameGenerationStatusAvailable && nativeFrameGeneration.active != 0,
        frameGenerationStatusAvailable ? nativeFrameGeneration.reason : unavailableStatus);
    set(env, frameGeneration, "apiLoaded",
        boolean(env, frameGenerationStatusAvailable && nativeFrameGeneration.api_loaded != 0));
    set(env, frameGeneration, "framesToGenerate",
        number(env, frameGenerationStatusAvailable
            ? nativeFrameGeneration.frames_to_generate : 0));
    set(env, frameGeneration, "framesToGenerateMax",
        number(env, frameGenerationStatusAvailable
            ? nativeFrameGeneration.frames_to_generate_max : 0));
    set(env, frameGeneration, "lastFramesPresented",
        number(env, frameGenerationStatusAvailable
            ? nativeFrameGeneration.last_frames_presented : 0));
    set(env, frameGeneration, "generatedFrameCount",
        number(env, frameGenerationStatusAvailable
            ? static_cast<double>(nativeFrameGeneration.generated_frame_count) : 0));
    set(env, frameGeneration, "failureCount",
        number(env, frameGenerationStatusAvailable
            ? static_cast<double>(nativeFrameGeneration.failure_count) : 0));
    set(env, frameGeneration, "estimatedVramBytes",
        number(env, frameGenerationStatusAvailable
            ? static_cast<double>(nativeFrameGeneration.estimated_vram_bytes) : 0));
    set(env, frameGeneration, "lastResult",
        number(env, frameGenerationStatusAvailable
            ? nativeFrameGeneration.last_result : 0));
    set(env, frameGeneration, "lastStatus",
        number(env, frameGenerationStatusAvailable
            ? nativeFrameGeneration.last_status : 0));
    set(env, features, "dlssFrameGeneration", frameGeneration);

    napi_value rayReconstruction = makeFeatureState(
        env, rayReconstructionSupported,
        statusAvailable && nativeStatus.ray_reconstruction_requested ? 1 : (statusAvailable ? 0 : -1),
        statusAvailable && nativeStatus.ray_reconstruction_configured != 0,
        statusAvailable && nativeStatus.ray_reconstruction_active != 0,
        statusAvailable ? nativeStatus.ray_reconstruction_reason : unavailableStatus);
    set(env, rayReconstruction, "apiLoaded",
        boolean(env, statusAvailable && nativeStatus.ray_reconstruction_api_loaded != 0));
    set(env, rayReconstruction, "evaluationCount",
        number(env, statusAvailable
            ? static_cast<double>(nativeStatus.ray_reconstruction_evaluation_count) : 0));
    set(env, rayReconstruction, "failureCount",
        number(env, statusAvailable
            ? static_cast<double>(nativeStatus.ray_reconstruction_failure_count) : 0));
    set(env, rayReconstruction, "estimatedVramBytes",
        number(env, statusAvailable
            ? static_cast<double>(nativeStatus.ray_reconstruction_estimated_vram_bytes) : 0));
    set(env, rayReconstruction, "lastResult",
        number(env, statusAvailable ? nativeStatus.ray_reconstruction_last_result : 0));
    set(env, features, "dlssRayReconstruction", rayReconstruction);
    const bool nativeRayTracingSupported = statusAvailable
        ? nativeStatus.native_ray_tracing_supported != 0
        : available && capabilities.native_ray_tracing != 0;
    napi_value nativeRayTracing = makeFeatureState(
        env, nativeRayTracingSupported, -1,
        statusAvailable && nativeStatus.native_ray_tracing_configured != 0,
        statusAvailable && nativeStatus.native_ray_tracing_active != 0,
        statusAvailable ? nativeStatus.native_ray_tracing_reason : unavailableStatus);
    set(env, features, "nativeRayTracing", nativeRayTracing);
    set(env, features, "rayQuery", nativeRayTracing);
    set(env, object, "features", features);
    return object;
}

napi_value gpuFeatureStatus(napi_env env, napi_callback_info) {
    return gpuFeatureStatusObject(env);
}

napi_value requestGpuFeatures(napi_env env, napi_callback_info info) {
    std::array<napi_value, 11> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    const int reflex = argc > 0 ? static_cast<int>(argNumber(env, argv[0], -1)) : -1;
    const int dlssMode = argc > 1 ? static_cast<int>(argNumber(env, argv[1], -1)) : -1;
    const int outputWidth = argc > 2 ? static_cast<int>(argNumber(env, argv[2], 0)) : 0;
    const int outputHeight = argc > 3 ? static_cast<int>(argNumber(env, argv[3], 0)) : 0;
    const float preExposure = argc > 4 ? static_cast<float>(argNumber(env, argv[4], 1.0)) : 1.0f;
    const float exposureScale = argc > 5 ? static_cast<float>(argNumber(env, argv[5], 1.0)) : 1.0f;
    const int colorBuffersHdr = argc > 6 ? static_cast<int>(argNumber(env, argv[6], 1)) : 1;
    const int autoExposure = argc > 7 ? static_cast<int>(argNumber(env, argv[7], 0)) : 0;
    const int alphaUpscaling = argc > 8 ? static_cast<int>(argNumber(env, argv[8], 0)) : 0;
    const int frameGeneration = argc > 9 ? static_cast<int>(argNumber(env, argv[9], -1)) : -1;
    const int rayReconstruction = argc > 10 ? static_cast<int>(argNumber(env, argv[10], -1)) : -1;

    if (reflex >= 0) {
        const int normalized = std::max(0, std::min(2, reflex));
        requestedReflexMode.store(normalized, std::memory_order_release);
        if (runtimeMode.load(std::memory_order_acquire) == 2) tw_set_reflex_mode(normalized);
    }
    if (dlssMode >= 0 || frameGeneration >= 0 || rayReconstruction >= 0) {
        TWGpuFeatureRequest request{};
        request.struct_size = sizeof(request);
        request.dlss_mode = static_cast<uint32_t>(std::max(0, std::min(6, dlssMode)));
        request.output_width = static_cast<uint32_t>(std::max(0, outputWidth));
        request.output_height = static_cast<uint32_t>(std::max(0, outputHeight));
        request.pre_exposure = preExposure;
        request.exposure_scale = exposureScale;
        request.color_buffers_hdr = colorBuffersHdr != 0;
        request.auto_exposure = autoExposure != 0;
        request.alpha_upscaling = alphaUpscaling != 0;
        request.frame_generation = frameGeneration > 0;
        request.ray_reconstruction = rayReconstruction > 0;
        if (runtimeMode.load(std::memory_order_acquire) == 2) tw_request_gpu_features(&request);
    }
    return gpuFeatureStatusObject(env);
}

napi_value dlssOptimalSettings(napi_env env, napi_callback_info info) {
    std::array<napi_value, 8> argv{};
    std::size_t argc = argv.size();
    napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr);
    TWGpuFeatureRequest request{};
    request.struct_size = sizeof(request);
    request.dlss_mode = static_cast<uint32_t>(std::max(0, std::min(6,
        argc > 0 ? static_cast<int>(argNumber(env, argv[0], TW_DLSS_OFF)) : TW_DLSS_OFF)));
    request.output_width = static_cast<uint32_t>(std::max(0,
        argc > 1 ? static_cast<int>(argNumber(env, argv[1], 0)) : 0));
    request.output_height = static_cast<uint32_t>(std::max(0,
        argc > 2 ? static_cast<int>(argNumber(env, argv[2], 0)) : 0));
    request.pre_exposure = argc > 3 ? static_cast<float>(argNumber(env, argv[3], 1.0)) : 1.0f;
    request.exposure_scale = argc > 4 ? static_cast<float>(argNumber(env, argv[4], 1.0)) : 1.0f;
    request.color_buffers_hdr = argc > 5 ? argNumber(env, argv[5], 1) != 0 : 1;
    request.auto_exposure = argc > 6 ? argNumber(env, argv[6], 0) != 0 : 0;
    request.alpha_upscaling = argc > 7 ? argNumber(env, argv[7], 0) != 0 : 0;

    TWDLSSOptimalSettings settings{};
    settings.struct_size = sizeof(settings);
    if (runtimeMode.load(std::memory_order_acquire) != 2 ||
        tw_dlss_optimal_settings(&request, &settings) == 0) {
        napi_value result{};
        napi_get_null(env, &result);
        return result;
    }

    napi_value result{};
    napi_create_object(env, &result);
    set(env, result, "optimalRenderWidth", number(env, settings.optimal_render_width));
    set(env, result, "optimalRenderHeight", number(env, settings.optimal_render_height));
    set(env, result, "renderWidthMin", number(env, settings.render_width_min));
    set(env, result, "renderHeightMin", number(env, settings.render_height_min));
    set(env, result, "renderWidthMax", number(env, settings.render_width_max));
    set(env, result, "renderHeightMax", number(env, settings.render_height_max));
    set(env, result, "optimalSharpness", number(env, settings.optimal_sharpness));
    return result;
}

napi_value dlssReleaseViewport(napi_env env, napi_callback_info info) {
    napi_value argv[1]{};
    std::size_t argc = 1;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeMode.load(std::memory_order_acquire) == 2 && argc > 0) {
        tw_dlss_release_viewport(static_cast<uint32_t>(std::max(0,
            static_cast<int>(argNumber(env, argv[0], 0)))));
    }
    return undefined(env);
}

napi_value setReflexMode(napi_env env, napi_callback_info info) {
    napi_value argv[1]{};
    std::size_t argc = 1;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    const int mode = std::max(0, std::min(2,
        argc > 0 ? static_cast<int>(argNumber(env, argv[0], 1)) : 1));
    requestedReflexMode.store(mode, std::memory_order_release);
    return boolean(env, runtimeMode.load(std::memory_order_acquire) == 2 &&
                            tw_set_reflex_mode(mode) != 0);
}

napi_value reflexMode(napi_env env, napi_callback_info) {
    return number(env, runtimeMode.load(std::memory_order_acquire) == 2
                           ? tw_reflex_mode()
                           : 0);
}

napi_value lastError(napi_env env, napi_callback_info) {
    return string(env, runtimeMode.load(std::memory_order_acquire) == 2 ? tw_last_error() : tn_last_error());
}

napi_value debugScene(napi_env env, napi_callback_info) {
    return string(env, runtimeMode.load(std::memory_order_acquire) == 1 ? tn_debug_scene() : "");
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

napi_value shaderMaterialCreate(napi_env env, napi_callback_info info) {
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (!runtimeActive.load(std::memory_order_acquire) || runtimeMode.load(std::memory_order_acquire) != 1 || argc != 2) {
        return number(env, 0);
    }
    const std::string vertex = argString(env, argv[0], "");
    const std::string fragment = argString(env, argv[1], "");
    return number(env, tn_shader_material_create(vertex.c_str(), fragment.c_str()));
}

napi_value shaderMaterialSetSource(napi_env env, napi_callback_info info) {
    napi_value argv[3]{};
    std::size_t argc = 3;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (!runtimeActive.load(std::memory_order_acquire) || runtimeMode.load(std::memory_order_acquire) != 1 || argc != 3) {
        return undefined(env);
    }
    const std::string vertex = argString(env, argv[1], "");
    const std::string fragment = argString(env, argv[2], "");
    tn_shader_material_set_source(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)),
                                  vertex.c_str(), fragment.c_str());
    return undefined(env);
}

napi_value shaderUniformFloat(napi_env env, napi_callback_info info) {
    napi_value argv[3]{};
    std::size_t argc = 3;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && runtimeMode.load(std::memory_order_acquire) == 1 && argc == 3) {
        const std::string name = argString(env, argv[1], "");
        tn_shader_uniform_float(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)), name.c_str(),
                                static_cast<float>(argNumber(env, argv[2], 0)));
    }
    return undefined(env);
}

napi_value shaderUniformInt(napi_env env, napi_callback_info info) {
    napi_value argv[3]{};
    std::size_t argc = 3;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && runtimeMode.load(std::memory_order_acquire) == 1 && argc == 3) {
        const std::string name = argString(env, argv[1], "");
        tn_shader_uniform_int(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)), name.c_str(),
                              static_cast<int>(argNumber(env, argv[2], 0)));
    }
    return undefined(env);
}

napi_value shaderUniformVec2(napi_env env, napi_callback_info info) {
    napi_value argv[4]{};
    std::size_t argc = 4;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && runtimeMode.load(std::memory_order_acquire) == 1 && argc == 4) {
        const std::string name = argString(env, argv[1], "");
        tn_shader_uniform_vec2(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)), name.c_str(),
                               static_cast<float>(argNumber(env, argv[2], 0)),
                               static_cast<float>(argNumber(env, argv[3], 0)));
    }
    return undefined(env);
}

napi_value shaderUniformVec3(napi_env env, napi_callback_info info) {
    napi_value argv[5]{};
    std::size_t argc = 5;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && runtimeMode.load(std::memory_order_acquire) == 1 && argc == 5) {
        const std::string name = argString(env, argv[1], "");
        tn_shader_uniform_vec3(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)), name.c_str(),
                               static_cast<float>(argNumber(env, argv[2], 0)),
                               static_cast<float>(argNumber(env, argv[3], 0)),
                               static_cast<float>(argNumber(env, argv[4], 0)));
    }
    return undefined(env);
}

napi_value shaderUniformVec4(napi_env env, napi_callback_info info) {
    napi_value argv[6]{};
    std::size_t argc = 6;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && runtimeMode.load(std::memory_order_acquire) == 1 && argc == 6) {
        const std::string name = argString(env, argv[1], "");
        tn_shader_uniform_vec4(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)), name.c_str(),
                               static_cast<float>(argNumber(env, argv[2], 0)),
                               static_cast<float>(argNumber(env, argv[3], 0)),
                               static_cast<float>(argNumber(env, argv[4], 0)),
                               static_cast<float>(argNumber(env, argv[5], 0)));
    }
    return undefined(env);
}

napi_value shaderUniformMat3(napi_env env, napi_callback_info info) {
    napi_value argv[11]{};
    std::size_t argc = 11;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && runtimeMode.load(std::memory_order_acquire) == 1 && argc == 11) {
        const std::string name = argString(env, argv[1], "");
        std::array<float, 9> elements{};
        for (std::size_t i = 0; i < elements.size(); ++i) {
            elements[i] = static_cast<float>(argNumber(env, argv[i + 2], i % 4 == 0 ? 1 : 0));
        }
        tn_shader_uniform_mat3(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)), name.c_str(), elements.data());
    }
    return undefined(env);
}

napi_value shaderUniformMat4(napi_env env, napi_callback_info info) {
    napi_value argv[18]{};
    std::size_t argc = 18;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && runtimeMode.load(std::memory_order_acquire) == 1 && argc == 18) {
        const std::string name = argString(env, argv[1], "");
        std::array<float, 16> elements{};
        for (std::size_t i = 0; i < elements.size(); ++i) {
            elements[i] = static_cast<float>(argNumber(env, argv[i + 2], i % 5 == 0 ? 1 : 0));
        }
        tn_shader_uniform_mat4(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)), name.c_str(), elements.data());
    }
    return undefined(env);
}

napi_value shaderUniformTexture(napi_env env, napi_callback_info info) {
    napi_value argv[3]{};
    std::size_t argc = 3;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && argc == 3) {
        const auto material = static_cast<std::uint32_t>(argNumber(env, argv[0], 0));
        const auto name = argString(env, argv[1], "");
        const auto texture = static_cast<std::uint32_t>(argNumber(env, argv[2], 0));
        tn_shader_uniform_texture(material, name.c_str(), texture);
    }
    return undefined(env);
}

napi_value shaderSetFlags(napi_env env, napi_callback_info info) {
    napi_value argv[4]{};
    std::size_t argc = 4;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && runtimeMode.load(std::memory_order_acquire) == 1 && argc >= 3) {
        tn_shader_set_flags(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)),
                            static_cast<int>(argNumber(env, argv[1], 0)),
                            static_cast<int>(argNumber(env, argv[2], 1)),
                            argc >= 4 ? static_cast<int>(argNumber(env, argv[3], 0)) : 0);
    }
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

napi_value pmremFromSky(napi_env env, napi_callback_info info) {
    napi_value argv[7]{};
    std::size_t argc = 7;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (!runtimeActive.load(std::memory_order_acquire) || argc != 7) return number(env, 0);
    return number(env, tn_pmrem_from_sky(
        static_cast<std::uint32_t>(argNumber(env, argv[0], 0)),
        static_cast<float>(argNumber(env, argv[1], 1)),
        static_cast<float>(argNumber(env, argv[2], 0.45)),
        static_cast<float>(argNumber(env, argv[3], 0.25)),
        static_cast<float>(argNumber(env, argv[4], 2)),
        static_cast<float>(argNumber(env, argv[5], 1)),
        0.005f,
        static_cast<float>(argNumber(env, argv[6], 0.8))));
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

napi_value renderTargetCreate(napi_env env, napi_callback_info info) {
    napi_value argv[6]{};
    std::size_t argc = 6;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (!runtimeActive.load(std::memory_order_acquire) || argc != 6) return number(env, 0);
    return number(env, tn_render_target_create(
        static_cast<std::uint32_t>(argNumber(env, argv[0], 0)),
        static_cast<int>(argNumber(env, argv[1], 1)),
        static_cast<int>(argNumber(env, argv[2], 1)),
        static_cast<int>(argNumber(env, argv[3], 0)),
        static_cast<int>(argNumber(env, argv[4], 1)),
        static_cast<int>(argNumber(env, argv[5], 0))));
}

napi_value renderTargetSet(napi_env env, napi_callback_info info) {
    napi_value argv[3]{};
    std::size_t argc = 3;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (!runtimeActive.load(std::memory_order_acquire) || argc != 3) return boolean(env, false);
    return boolean(env, tn_render_target_set(
        static_cast<std::uint32_t>(argNumber(env, argv[0], 0)),
        static_cast<int>(argNumber(env, argv[1], 0)),
        static_cast<int>(argNumber(env, argv[2], 0))) != 0);
}

napi_value renderTargetResize(napi_env env, napi_callback_info info) {
    napi_value argv[3]{};
    std::size_t argc = 3;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (runtimeActive.load(std::memory_order_acquire) && argc == 3) {
        tn_render_target_resize(
            static_cast<std::uint32_t>(argNumber(env, argv[0], 0)),
            static_cast<int>(argNumber(env, argv[1], 1)),
            static_cast<int>(argNumber(env, argv[2], 1)));
    }
    return undefined(env);
}

napi_value boneCreate(napi_env env, napi_callback_info) {
    return number(env, runtimeActive.load(std::memory_order_acquire) ? tn_bone_create() : 0);
}

napi_value skeletonCreate(napi_env env, napi_callback_info info) {
    napi_value argv[1]{};
    std::size_t argc = 1;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (!runtimeActive.load(std::memory_order_acquire) || argc != 1) return number(env, 0);
    void* data = nullptr;
    std::size_t length = 0;
    napi_typedarray_type type{};
    napi_value arrayBuffer{};
    std::size_t offset = 0;
    if (napi_get_typedarray_info(env, argv[0], &type, &length, &data, &arrayBuffer, &offset) != napi_ok ||
        type != napi_uint32_array) return number(env, 0);
    return number(env, tn_skeleton_create(static_cast<const std::uint32_t*>(data), static_cast<int>(length)));
}

napi_value skeletonSetInverses(napi_env env, napi_callback_info info) {
    napi_value argv[2]{};
    std::size_t argc = 2;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (!runtimeActive.load(std::memory_order_acquire) || argc != 2) return boolean(env, false);
    void* data = nullptr;
    std::size_t length = 0;
    napi_typedarray_type type{};
    napi_value arrayBuffer{};
    std::size_t offset = 0;
    if (napi_get_typedarray_info(env, argv[1], &type, &length, &data, &arrayBuffer, &offset) != napi_ok ||
        type != napi_float32_array) return boolean(env, false);
    return boolean(env, tn_skeleton_set_inverses(static_cast<std::uint32_t>(argNumber(env, argv[0], 0)),
                                                  static_cast<const float*>(data), static_cast<int>(length)) != 0);
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
    RECT client{};
    if (const HWND hwnd = runtimeHwnd(); hwnd && GetClientRect(hwnd, &client)) {
        const int clientWidth = static_cast<int>(client.right - client.left);
        const int clientHeight = static_cast<int>(client.bottom - client.top);
        if (clientWidth > 0 && clientHeight > 0) {
            width = clientWidth;
            height = clientHeight;
        }
    }
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
                case TW_INPUT_POINTER_CANCEL: type = "pointercancel"; break;
                case TW_INPUT_POINTER_LEAVE: type = "pointerleave"; break;
                case TW_INPUT_HORIZONTAL_WHEEL: type = "wheelhorizontal"; break;
                case TW_INPUT_POINTER_DOUBLE_CLICK: type = "pointerdoubleclick"; break;
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

    std::array<TNInputEvent, 256> nativeEvents{};
    const int count = tn_poll_input(nativeEvents.data(), static_cast<int>(nativeEvents.size()));
    for (int i = 0; i < count; ++i) {
        const TNInputEvent& source = nativeEvents[static_cast<std::size_t>(i)];
        const char* type = "";
        switch (source.type) {
            case TN_INPUT_POINTER_MOVE: type = "pointermove"; break;
            case TN_INPUT_POINTER_DOWN: type = "pointerdown"; break;
            case TN_INPUT_POINTER_UP: type = "pointerup"; break;
            case TN_INPUT_WHEEL: type = "wheel"; break;
            case TN_INPUT_KEY_DOWN: type = "keydown"; break;
            case TN_INPUT_KEY_UP: type = "keyup"; break;
            default: continue;
        }
        if ((source.type == TN_INPUT_KEY_DOWN || source.type == TN_INPUT_KEY_UP) && source.code == 0) continue;
        napi_set_element(env, events, index++, inputEvent(env, type, source.code, source.x, source.y,
                                                          source.movement_x, source.movement_y,
                                                          source.modifiers));
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
        {"render", nullptr, render, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"decodeImage", nullptr, decodeImage, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"cameraDevices", nullptr, cameraDevices, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"cameraOpen", nullptr, cameraOpen, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"cameraRead", nullptr, cameraRead, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"cameraClose", nullptr, cameraClose, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"canvas2dCreate", nullptr, canvas2dCreate, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"canvas2dResize", nullptr, canvas2dResize, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"canvas2dSet", nullptr, canvas2dSet, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"canvas2dGradientCreate", nullptr, canvas2dGradientCreate, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"canvas2dGradientAddColorStop", nullptr, canvas2dGradientAddColorStop, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"canvas2dSetGradient", nullptr, canvas2dSetGradient, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"canvas2dCall", nullptr, canvas2dCall, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"canvas2dReadPixels", nullptr, canvas2dReadPixels, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"canvas2dWritePixels", nullptr, canvas2dWritePixels, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"canvas2dDrawImage", nullptr, canvas2dDrawImage, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"canvas2dMeasureText", nullptr, canvas2dMeasureText, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"canvas2dEncodePng", nullptr, canvas2dEncodePng, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"resize", nullptr, resize, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"shutdown", nullptr, shutdown, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"isOpen", nullptr, isOpen, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"reveal", nullptr, reveal, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"waitFrame", nullptr, waitFrame, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"pressure", nullptr, pressure, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"backendName", nullptr, backendName, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"lastError", nullptr, lastError, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"debugScene", nullptr, debugScene, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setToneMapping", nullptr, setToneMapping, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"shaderMaterialCreate", nullptr, shaderMaterialCreate, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"shaderMaterialSetSource", nullptr, shaderMaterialSetSource, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"shaderUniformFloat", nullptr, shaderUniformFloat, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"shaderUniformInt", nullptr, shaderUniformInt, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"shaderUniformVec2", nullptr, shaderUniformVec2, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"shaderUniformVec3", nullptr, shaderUniformVec3, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"shaderUniformVec4", nullptr, shaderUniformVec4, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"shaderUniformMat3", nullptr, shaderUniformMat3, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"shaderUniformMat4", nullptr, shaderUniformMat4, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"shaderUniformTexture", nullptr, shaderUniformTexture, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"shaderSetFlags", nullptr, shaderSetFlags, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setSceneBackgroundTexture", nullptr, setSceneBackgroundTexture, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setSceneEnvironment", nullptr, setSceneEnvironment, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"pmremFromEquirect", nullptr, pmremFromEquirect, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"pmremFromSky", nullptr, pmremFromSky, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"pmremFromCubemap", nullptr, pmremFromCubemap, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"pmremFromObject", nullptr, pmremFromObject, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"renderTargetCreate", nullptr, renderTargetCreate, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"renderTargetSet", nullptr, renderTargetSet, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"renderTargetResize", nullptr, renderTargetResize, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"boneCreate", nullptr, boneCreate, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"skeletonCreate", nullptr, skeletonCreate, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"skeletonSetInverses", nullptr, skeletonSetInverses, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"destroySlot", nullptr, destroySlot, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"stats", nullptr, stats, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"pollInput", nullptr, pollInput, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setPointerLock", nullptr, setPointerLock, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setLoading", nullptr, setLoading, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setOverlay", nullptr, setOverlay, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"overlayOpen", nullptr, overlayOpen, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"overlayClick", nullptr, overlayClick, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"overlayPointerMove", nullptr, overlayPointerMove, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"overlayWheel", nullptr, overlayWheel, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"toggleFpsOverlay", nullptr, toggleFpsOverlay, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"gpuCapabilities", nullptr, gpuCapabilities, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"gpuFeatureStatus", nullptr, gpuFeatureStatus, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"requestGpuFeatures", nullptr, requestGpuFeatures, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"dlssOptimalSettings", nullptr, dlssOptimalSettings, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"dlssReleaseViewport", nullptr, dlssReleaseViewport, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setReflexMode", nullptr, setReflexMode, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"reflexMode", nullptr, reflexMode, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, std::size(properties), properties);
    return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
