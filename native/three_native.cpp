#include "three_native.h"
#include "webgpu/three_webgpu.h"

#include "threepp/threepp.hpp"
#include "threepp/animation/AnimationMixer.hpp"
#include "threepp/geometries/TorusKnotGeometry.hpp"
#include "threepp/loaders/GLTFLoader.hpp"
#include "threepp/materials/ShaderMaterial.hpp"
#include "threepp/objects/InstancedMesh.hpp"
#ifdef THREEPP_WITH_VULKAN
#include "threepp/renderers/VulkanRenderer.hpp"
#endif

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#define GLFW_INCLUDE_NONE
#define GLFW_EXPOSE_NATIVE_WIN32
#define GLFW_NATIVE_INCLUDE_NONE
#include <GLFW/glfw3.h>
#include <GLFW/glfw3native.h>
#include <glad/glad.h>
#endif

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <exception>
#include <fstream>
#include <functional>
#include <future>
#include <memory>
#include <algorithm>
#include <cmath>
#include <mutex>
#include <random>
#include <string>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

#include "runtime_internal.hpp"

#include <iostream>

using namespace threepp;
using tn::g;

#if defined(_WIN32)
namespace { void releaseGlOverlayGpu(); }
#endif

namespace tn {

void destroySurface() {
    g.open.store(false, std::memory_order_release);
#if defined(_WIN32)
    if (g.canvas) {
        releaseGlOverlayGpu();
        if (auto* glfwWindow = static_cast<GLFWwindow*>(g.canvas->windowPtr())) {
            if (HWND child = glfwGetWin32Window(glfwWindow)) {
                ShowWindow(child, SW_HIDE);
                SetParent(child, nullptr);
            }
        }
    }
#endif
    g.nativeHwnd.store(nullptr);
    g.renderer.reset();
    g.canvas.reset();
}

}// namespace tn

using tn::destroySurface;
using tn::Kind;
using tn::Slot;
using tn::asObject;
using tn::destroySlot;
using tn::ensureWorker;
using tn::findSlot;
using tn::getSlot;
using tn::insert;
using tn::logLine;
using tn::markDirty;
using tn::onWorker;
using tn::onWorkerAsync;
using tn::setError;

#if defined(_WIN32)
namespace {

GLuint glOverlayProgram{};
GLuint glOverlayTexture{};
GLuint glOverlayVao{};
int glOverlayWidth{};
int glOverlayHeight{};
uint64_t glOverlayUploadedRevision{};

GLuint compileOverlayShader(GLenum type, const char* source) {
    const GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &source, nullptr);
    glCompileShader(shader);
    GLint ok = GL_FALSE;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char message[1024]{};
        glGetShaderInfoLog(shader, sizeof(message), nullptr, message);
        setError((std::string("overlay shader compile failed: ") + message).c_str());
        glDeleteShader(shader);
        return 0;
    }
    return shader;
}

bool ensureGlOverlayGpu() {
    if (glOverlayProgram && glOverlayTexture && glOverlayVao) return true;
    static constexpr const char* vertexSource = R"GLSL(#version 330 core
out vec2 uv;
void main() {
    const vec2 positions[6] = vec2[6](
        vec2(-1.0,-1.0), vec2( 1.0,-1.0), vec2( 1.0, 1.0),
        vec2(-1.0,-1.0), vec2( 1.0, 1.0), vec2(-1.0, 1.0));
    const vec2 texcoords[6] = vec2[6](
        vec2(0.0,1.0), vec2(1.0,1.0), vec2(1.0,0.0),
        vec2(0.0,1.0), vec2(1.0,0.0), vec2(0.0,0.0));
    gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
    uv = texcoords[gl_VertexID];
})GLSL";
    static constexpr const char* fragmentSource = R"GLSL(#version 330 core
in vec2 uv;
out vec4 color;
uniform sampler2D overlayTexture;
void main() { color = texture(overlayTexture, uv); }
)GLSL";
    const GLuint vertex = compileOverlayShader(GL_VERTEX_SHADER, vertexSource);
    const GLuint fragment = compileOverlayShader(GL_FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) {
        if (vertex) glDeleteShader(vertex);
        if (fragment) glDeleteShader(fragment);
        return false;
    }
    glOverlayProgram = glCreateProgram();
    glAttachShader(glOverlayProgram, vertex);
    glAttachShader(glOverlayProgram, fragment);
    glLinkProgram(glOverlayProgram);
    glDeleteShader(vertex);
    glDeleteShader(fragment);
    GLint ok = GL_FALSE;
    glGetProgramiv(glOverlayProgram, GL_LINK_STATUS, &ok);
    if (!ok) {
        glDeleteProgram(glOverlayProgram);
        glOverlayProgram = 0;
        setError("overlay shader link failed");
        return false;
    }
    glGenVertexArrays(1, &glOverlayVao);
    glGenTextures(1, &glOverlayTexture);
    glBindTexture(GL_TEXTURE_2D, glOverlayTexture);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    return true;
}

void releaseGlOverlayGpu() {
    if (glOverlayTexture) glDeleteTextures(1, &glOverlayTexture);
    if (glOverlayVao) glDeleteVertexArrays(1, &glOverlayVao);
    if (glOverlayProgram) glDeleteProgram(glOverlayProgram);
    glOverlayTexture = glOverlayVao = glOverlayProgram = 0;
    glOverlayWidth = glOverlayHeight = 0;
    glOverlayUploadedRevision = 0;
}

void renderGlOverlay() {
    if (!tw_overlay_visible()) return;
    const int width = std::max(1, g.statsW.load(std::memory_order_relaxed));
    const int height = std::max(1, g.statsH.load(std::memory_order_relaxed));
    const int fps = g.statsFps.load(std::memory_order_relaxed);
    const int frameUs = g.statsFrameUs.load(std::memory_order_relaxed);
    if (!ensureGlOverlayGpu()) return;
    int rowBytes = 0;
    const uint8_t* pixels = tw_overlay_raster(
        width, height, fps, frameUs, tn_backend_name(), 0,
        g.statsPresents.load(std::memory_order_relaxed), &rowBytes);
    if (!pixels || rowBytes < width * 4) return;
    const uint64_t revision = tw_overlay_revision();
    const bool sizeChanged = glOverlayWidth != width || glOverlayHeight != height;
    const bool uploadNeeded = sizeChanged || glOverlayUploadedRevision != revision;
    if (uploadNeeded) {
        glBindTexture(GL_TEXTURE_2D, glOverlayTexture);
        glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
        glPixelStorei(GL_UNPACK_ROW_LENGTH, rowBytes / 4);
        if (sizeChanged) {
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_BGRA, GL_UNSIGNED_BYTE, pixels);
        } else {
            glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, width, height, GL_BGRA, GL_UNSIGNED_BYTE, pixels);
        }
        glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
        glOverlayWidth = width;
        glOverlayHeight = height;
        glOverlayUploadedRevision = revision;
    }

    GLint oldProgram{}, oldVao{}, oldActiveTexture{}, oldTexture{}, viewport[4]{}, scissorBox[4]{};
    glGetIntegerv(GL_CURRENT_PROGRAM, &oldProgram);
    glGetIntegerv(GL_VERTEX_ARRAY_BINDING, &oldVao);
    glGetIntegerv(GL_ACTIVE_TEXTURE, &oldActiveTexture);
    glActiveTexture(GL_TEXTURE0);
    glGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTexture);
    glGetIntegerv(GL_VIEWPORT, viewport);
    const GLboolean blend = glIsEnabled(GL_BLEND);
    const GLboolean depth = glIsEnabled(GL_DEPTH_TEST);
    const GLboolean cull = glIsEnabled(GL_CULL_FACE);
    const GLboolean scissor = glIsEnabled(GL_SCISSOR_TEST);
    if (scissor) glGetIntegerv(GL_SCISSOR_BOX, scissorBox);

    glViewport(0, 0, width, height);
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_CULL_FACE);
    const bool fpsOnly = !tw_loading_visible() && !tw_overlay_open();
    if (fpsOnly) {
        const int left = std::max(0, width - 142);
        const int right = std::max(0, width - 14);
        const int top = 14;
        const int bottom = std::min(height, 58);
        glEnable(GL_SCISSOR_TEST);
        glScissor(left, height - bottom, std::max(0, right - left), std::max(0, bottom - top));
    } else {
        glDisable(GL_SCISSOR_TEST);
    }
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glUseProgram(glOverlayProgram);
    glUniform1i(glGetUniformLocation(glOverlayProgram, "overlayTexture"), 0);
    glBindTexture(GL_TEXTURE_2D, glOverlayTexture);
    glBindVertexArray(glOverlayVao);
    glDrawArrays(GL_TRIANGLES, 0, 6);

    glBindVertexArray(oldVao);
    glBindTexture(GL_TEXTURE_2D, oldTexture);
    glActiveTexture(oldActiveTexture);
    glUseProgram(oldProgram);
    if (blend) glEnable(GL_BLEND); else glDisable(GL_BLEND);
    if (depth) glEnable(GL_DEPTH_TEST); else glDisable(GL_DEPTH_TEST);
    if (cull) glEnable(GL_CULL_FACE); else glDisable(GL_CULL_FACE);
    if (scissor) {
        glEnable(GL_SCISSOR_TEST);
        glScissor(scissorBox[0], scissorBox[1], scissorBox[2], scissorBox[3]);
    } else {
        glDisable(GL_SCISSOR_TEST);
    }
    glViewport(viewport[0], viewport[1], viewport[2], viewport[3]);
}

}// namespace
#endif

void tn::renderPendingFrame() {
#if defined(_WIN32)
    // Command-buffer renderers publish their backbuffer scene through
    // OP_RENDER rather than tn_runtime_render(). Treat that pending scene as
    // the first real application frame so the startup overlay cannot mask a
    // fully running page forever.
    const bool applicationFramePending = g.sceneDirty.load(std::memory_order_relaxed) &&
                                         g.drawScene.load(std::memory_order_relaxed) != 0 &&
                                         g.drawCamera.load(std::memory_order_relaxed) != 0;
    if (tw_loading_visible() && applicationFramePending) {
        tn_runtime_set_loading(0, nullptr);
    }
    if (tw_loading_visible() && g.renderer && g.canvas) {
        static thread_local auto lastLoadingFrame = std::chrono::steady_clock::time_point{};
        const auto now = std::chrono::steady_clock::now();
        if (lastLoadingFrame.time_since_epoch().count() != 0 &&
            now - lastLoadingFrame < std::chrono::milliseconds(16)) {
            return;
        }
        lastLoadingFrame = now;
        g.canvas->animateOnce([&] {
            glDisable(GL_SCISSOR_TEST);
            glClearColor(246.f / 255.f, 247.f / 255.f, 249.f / 255.f, 1.f);
            glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
            renderGlOverlay();
        });
        return;
    }
#endif
    tn::applyPendingEnvironment();
    const uint32_t sceneHandle = g.drawScene.load();
    const uint32_t cameraHandle = g.drawCamera.load();
    if (!g.renderer || sceneHandle == 0 || cameraHandle == 0) {
        if (sceneHandle != 0 || cameraHandle != 0) {
            setError(("render skipped: renderer=" + std::to_string(g.renderer ? 1 : 0) +
                      " scene=" + std::to_string(sceneHandle) +
                      " camera=" + std::to_string(cameraHandle)).c_str());
        }
        g.sceneDirty.store(false, std::memory_order_relaxed);
        return;
    }
    Slot* sceneSlot = getSlot(sceneHandle);
    Slot* cameraSlot = getSlot(cameraHandle);
    if (!sceneSlot || sceneSlot->kind != Kind::Scene || !sceneSlot->object ||
        !cameraSlot || cameraSlot->kind != Kind::Camera || !cameraSlot->object) {
        setError(("render skipped: invalid scene/camera handles " +
                  std::to_string(sceneHandle) + "/" + std::to_string(cameraHandle)).c_str());
        g.sceneDirty.store(false, std::memory_order_relaxed);
        return;
    }
    auto* scene = dynamic_cast<Scene*>(sceneSlot->object.get());
    auto* camera = dynamic_cast<Camera*>(cameraSlot->object.get());
    if (!scene || !camera) {
        setError("render skipped: scene/camera type conversion failed");
        g.sceneDirty.store(false, std::memory_order_relaxed);
        return;
    }
    if (!g.sceneDirty.exchange(false, std::memory_order_acq_rel)) {
        return;
    }
    const auto t0 = std::chrono::steady_clock::now();
#if defined(__ANDROID__)
    g.renderer->render(*scene, *camera);
#else
    std::vector<Object3D*> debugHidden;
    static bool meshTraceDone = false;
    const bool traceMeshes = !meshTraceDone && std::getenv("THREEBROWSER_NATIVE_MESH_TRACE") != nullptr;
    int meshIndex = 0;
    if (const char* value = std::getenv("THREEBROWSER_NATIVE_MESH_LIMIT")) {
        const int limit = std::max(0, std::atoi(value));
        int visible = 0;
        scene->traverse([&](Object3D& object) {
            if (auto* mesh = dynamic_cast<Mesh*>(&object); mesh && object.visible) {
                if (traceMeshes) {
                    const auto material = mesh->material();
                    std::cerr << "[native mesh " << meshIndex << "] name=\"" << object.name
                              << "\" object=" << object.type()
                              << " material=" << (material ? material->type() : "null");
                    if (const auto geometry = mesh->geometry()) {
                        std::cerr << " attributes=";
                        bool first = true;
                        for (const auto& [attributeName, attribute] : geometry->getAttributes()) {
                            if (!first) std::cerr << ',';
                            first = false;
                            std::cerr << attributeName << ':' << attribute->itemSize() << 'x' << attribute->count();
                        }
                    }
                    if (const auto* shader = material ? material->as<ShaderMaterial>() : nullptr) {
                        std::cerr << " materialPtr=" << shader
                                  << " vertexHash=" << std::hash<std::string>{}(shader->vertexShader)
                                  << " fragmentHash=" << std::hash<std::string>{}(shader->fragmentShader)
                                  << " uniforms=" << shader->uniforms.size();
                    }
                    std::cerr << std::endl;
                }
                ++meshIndex;
                if (visible++ >= limit) {
                    object.visible = false;
                    debugHidden.push_back(&object);
                }
            }
        });
        if (traceMeshes) meshTraceDone = true;
    }
    g.canvas->animateOnce([&] {
        g.renderer->render(*scene, *camera);
#if defined(_WIN32)
        renderGlOverlay();
#endif
    });
    for (auto* object : debugHidden) object->visible = true;
#endif
    const auto t1 = std::chrono::steady_clock::now();
    g.statsFrameUs.store(
            static_cast<int>(std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count()),
            std::memory_order_relaxed);
    g.statsPresents.fetch_add(1, std::memory_order_relaxed);
    static thread_local auto windowStart = t1;
    static thread_local int windowFrames = 0;
    windowFrames++;
    const double elapsed = std::chrono::duration<double>(t1 - windowStart).count();
    if (elapsed >= 0.5) {
        g.statsFps.store(static_cast<int>(std::lround(windowFrames / elapsed)), std::memory_order_relaxed);
        windowFrames = 0;
        windowStart = t1;
    }
}

void tn::workerMain() {
    g.workerId = std::this_thread::get_id();
    logLine("worker started");
    // Keep large scene uploads from monopolising the thread which owns the
    // GLFW window.  Production Vite scenes can enqueue thousands of object,
    // material and transform updates before their first render.
    constexpr std::size_t maxJobsPerTurn = 64;
#if !defined(__ANDROID__)
    auto pumpRuntimeWindow = [] {
        if (!g.canvas) return;
        try {
            glfwPollEvents();
            if (!g.canvas->isOpen()) {
                g.open.store(false, std::memory_order_release);
#if defined(_WIN32)
                tw_set_loading(0, nullptr);
                if (HWND hwnd = static_cast<HWND>(g.nativeHwnd.load(std::memory_order_acquire))) {
                    ShowWindow(hwnd, SW_HIDE);
                }
#endif
            }
        } catch (const std::exception& ex) {
            setError(ex.what());
        } catch (...) {
            setError("native worker: event pump exception");
        }
    };
#endif
    while (true) {
#if !defined(__ANDROID__)
        pumpRuntimeWindow();
#endif
        std::vector<std::function<void()>> batch;
        bool stopping = false;
        {
            std::unique_lock<std::mutex> lock(g.mu);
            if (g.jobs.empty() && !g.stop && !g.sceneDirty.load(std::memory_order_relaxed)) {
#if defined(_WIN32)
                if (tw_loading_visible()) {
                    g.cv.wait_for(lock, std::chrono::milliseconds(16), [] {
                        return g.stop || !g.jobs.empty() || g.sceneDirty.load(std::memory_order_relaxed);
                    });
                } else
#endif
                {
                    g.cv.wait(lock, [] {
                        return g.stop || !g.jobs.empty() || g.sceneDirty.load(std::memory_order_relaxed);
                    });
                }
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
                setError("native worker: unknown exception");
            }
#if !defined(__ANDROID__)
            if ((index & 7u) == 7u) pumpRuntimeWindow();
#endif
        }
        try {
            renderPendingFrame();
        } catch (const std::exception& ex) {
            setError(ex.what());
        } catch (...) {
            setError("native worker: render exception");
        }
#if !defined(__ANDROID__)
        // Rendering may fail while a page is still constructing or compiling
        // its scene. Keep servicing the window regardless so close and resize
        // remain responsive and a later valid frame can recover normally.
        pumpRuntimeWindow();
#endif
        if (g.stop) {
            break;
        }
    }
    destroySurface();
    g.slots.clear();
    logLine("worker stopped");
}

namespace {

#if !defined(__ANDROID__)
std::mutex inputMutex;
std::deque<TNInputEvent> inputEvents;

void queueInput(TNInputEvent event) {
    if (std::getenv("THREEBROWSER_TRACE_INPUT")) {
        logLine(("input glfw type=" + std::to_string(event.type) +
                 " code=" + std::to_string(event.code) +
                 " xy=" + std::to_string(event.x) + "," + std::to_string(event.y) +
                 " move=" + std::to_string(event.movement_x) + "," + std::to_string(event.movement_y)).c_str());
    }
    std::lock_guard<std::mutex> lock(inputMutex);
    if (event.type == TN_INPUT_POINTER_MOVE && !inputEvents.empty() &&
        inputEvents.back().type == TN_INPUT_POINTER_MOVE) {
        inputEvents.back().movement_x += event.movement_x;
        inputEvents.back().movement_y += event.movement_y;
        inputEvents.back().x = event.x;
        inputEvents.back().y = event.y;
        return;
    }
    if (inputEvents.size() >= 2048) inputEvents.pop_front();
    inputEvents.push_back(event);
}

int keyToBrowserCode(Key key) {
    if (key >= Key::NUM_0 && key <= Key::NUM_9) return '0' + (static_cast<int>(key) - static_cast<int>(Key::NUM_0));
    if (key >= Key::A && key <= Key::Z) return 'A' + (static_cast<int>(key) - static_cast<int>(Key::A));
    if (key >= Key::F1 && key <= Key::F12) return 112 + (static_cast<int>(key) - static_cast<int>(Key::F1));
    switch (key) {
        case Key::SPACE: return 32;
        case Key::APOSTROPHE: return 222;
        case Key::COMMA: return 188;
        case Key::MINUS: return 189;
        case Key::PERIOD: return 190;
        case Key::SLASH: return 191;
        case Key::SEMICOLON: return 186;
        case Key::EQUAL: return 187;
        case Key::LEFT_BRACKET: return 219;
        case Key::BACKSLASH: return 220;
        case Key::RIGHT_BRACKET: return 221;
        case Key::GRAVE_ACCENT: return 192;
        case Key::ESCAPE: return 27;
        case Key::ENTER: return 13;
        case Key::TAB: return 9;
        case Key::BACKSPACE: return 8;
        case Key::INSERT: return 45;
        case Key::DEL: return 46;
        case Key::RIGHT: return 39;
        case Key::LEFT: return 37;
        case Key::DOWN: return 40;
        case Key::UP: return 38;
        case Key::PAGE_UP: return 33;
        case Key::PAGE_DOWN: return 34;
        case Key::HOME: return 36;
        case Key::END: return 35;
        case Key::CAPS_LOCK: return 20;
        case Key::SCROLL_LOCK: return 145;
        case Key::NUM_LOCK: return 144;
        case Key::PRINT_SCREEN: return 44;
        case Key::PAUSE: return 19;
        case Key::LEFT_SHIFT: return 16;
        case Key::LEFT_CONTROL: return 17;
        case Key::LEFT_ALT: return 18;
        default: return 0;
    }
}

struct RuntimeInputListener final: MouseListener, KeyListener {
    int lastX{0};
    int lastY{0};
    bool hasPosition{false};

    static int mouseCode(int button) {
        return button == 0 ? 1 : button == 1 ? 2 : button == 2 ? 4 : button == 3 ? 5 : button == 4 ? 6 : 0;
    }

    void onMouseDown(int button, const Vector2& position) override {
        queueInput({TN_INPUT_POINTER_DOWN, mouseCode(button), static_cast<int>(position.x), static_cast<int>(position.y), 0, 0, -1});
    }

    void onMouseUp(int button, const Vector2& position) override {
        queueInput({TN_INPUT_POINTER_UP, mouseCode(button), static_cast<int>(position.x), static_cast<int>(position.y), 0, 0, -1});
    }

    void onMouseMove(const Vector2& position) override {
        const int x = static_cast<int>(position.x);
        const int y = static_cast<int>(position.y);
        queueInput({TN_INPUT_POINTER_MOVE, 0, x, y, hasPosition ? x - lastX : 0, hasPosition ? y - lastY : 0, -1});
        lastX = x;
        lastY = y;
        hasPosition = true;
    }

    void onMouseWheel(const Vector2& delta) override {
        queueInput({TN_INPUT_WHEEL, static_cast<int>(delta.y * 120.f), lastX, lastY, 0, 0, -1});
    }

    void onKeyPressed(KeyEvent event) override {
        queueInput({TN_INPUT_KEY_DOWN, keyToBrowserCode(event.key), lastX, lastY, 0, 0, event.mods});
    }

    void onKeyReleased(KeyEvent event) override {
        queueInput({TN_INPUT_KEY_UP, keyToBrowserCode(event.key), lastX, lastY, 0, 0, event.mods});
    }

    void onKeyRepeat(KeyEvent event) override {
        queueInput({TN_INPUT_KEY_DOWN, keyToBrowserCode(event.key), lastX, lastY, 0, 0, event.mods});
    }

    void reset() {
        lastX = 0;
        lastY = 0;
        hasPosition = false;
        std::lock_guard<std::mutex> lock(inputMutex);
        inputEvents.clear();
    }
};

RuntimeInputListener runtimeInputListener;
#endif

#if defined(_WIN32)
LONG WINAPI nativeCrashTrace(EXCEPTION_POINTERS* exception) {
    const auto code = exception && exception->ExceptionRecord
            ? exception->ExceptionRecord->ExceptionCode
            : 0;
    const auto address = exception && exception->ExceptionRecord
            ? exception->ExceptionRecord->ExceptionAddress
            : nullptr;
    const auto module = reinterpret_cast<std::uintptr_t>(GetModuleHandleA("three_native.dll"));
    std::cerr << "[native crash] code=0x" << std::hex << code
              << " address=" << address << " module=" << reinterpret_cast<void*>(module)
              << std::dec << std::endl;
    void* frames[64]{};
    const USHORT count = CaptureStackBackTrace(0, 64, frames, nullptr);
    for (USHORT i = 0; i < count; ++i) {
        const auto frame = reinterpret_cast<std::uintptr_t>(frames[i]);
        std::cerr << "[native crash frame " << i << "] " << frames[i];
        if (module && frame >= module) std::cerr << " rva=0x" << std::hex << (frame - module) << std::dec;
        std::cerr << std::endl;
    }
    return EXCEPTION_CONTINUE_SEARCH;
}
#endif

int impl_runtime_start(int width, int height, const char* title) {
    setError("");
    if (g.renderer) {
        return 1;
    }
#if defined(__ANDROID__)
    (void) title;
    const int w = width > 0 ? width : 1;
    const int h = height > 0 ? height : 1;
    g.renderer = std::make_unique<GLRenderer>(WindowSize{w, h});
#else
    if (std::getenv("THREEBROWSER_NATIVE_CRASH_TRACE")) {
        SetUnhandledExceptionFilter(nativeCrashTrace);
    }
    const bool wantVulkan = g.backend.load(std::memory_order_relaxed) != 0;
#ifndef THREEPP_WITH_VULKAN
    if (wantVulkan) {
        setError("Vulkan is not available in this build");
        g.backend.store(0, std::memory_order_relaxed);
    }
#endif
    Canvas::Parameters params;
    params.title(title ? title : "ThreeBrowser")
            .size(width > 0 ? width : 800, height > 0 ? height : 600)
            .antialiasing(2)
            .vsync(g.vsync.load(std::memory_order_relaxed))
            .headless(!g.standalone.load(std::memory_order_relaxed))
            .exitOnKeyEscape(false);
    g.canvas = std::make_unique<Canvas>(params);
#ifdef THREEPP_WITH_VULKAN
    if (wantVulkan) {
        try {
            // Window surface (not EXT_headless): the HWND is parented into the
            // host, so present must hit that window or vsync/display are no-ops.
            auto vk = std::make_unique<VulkanRenderer>(*g.canvas, false);
            vk->setProbeGI(false);
            vk->setRestirDIEnabled(false);
            vk->setDeferredAO(false);
            vk->setDenoise(false);
            vk->setBloomIntensity(0.f);
            vk->setAutoExposure(false);
            vk->setAutoLod(false);
            vk->setMotionBlur(0.f);
            vk->setDepthOfField(false);
            vk->setClouds(std::nullopt);
            vk->setVsync(g.vsync.load(std::memory_order_relaxed));
            g.renderer = std::move(vk);
        } catch (const std::exception& ex) {
            destroySurface();
            setError(ex.what());
            g.backend.store(0, std::memory_order_relaxed);
            g.canvas = std::make_unique<Canvas>(params);
            g.renderer = std::make_unique<GLRenderer>(*g.canvas);
        }
    } else
#endif
    {
        g.renderer = std::make_unique<GLRenderer>(*g.canvas);
    }
#if !defined(__ANDROID__)
    runtimeInputListener.reset();
    g.canvas->addMouseListener(runtimeInputListener);
    g.canvas->addKeyListener(runtimeInputListener);
    g.canvas->onWindowResize([](WindowSize size) {
        const int resizedWidth = std::max(1, size.width());
        const int resizedHeight = std::max(1, size.height());
        g.statsW.store(resizedWidth, std::memory_order_relaxed);
        g.statsH.store(resizedHeight, std::memory_order_relaxed);
        if (g.renderer) g.renderer->setSize({resizedWidth, resizedHeight});
        markDirty();
    });
#endif
    g.renderer->sortObjects = false;
    g.renderer->checkShaderErrors = true;
    g.renderer->onShaderError = [](const std::string& msg) { logLine(msg.c_str()); };
    g.renderer->toneMapping = ToneMapping::None;
    g.renderer->toneMappingExposure = 1.f;
    g.renderer->setClearColor(Color(0x000000));
    if (auto* glfwWindow = static_cast<GLFWwindow*>(g.canvas->windowPtr())) {
        g.nativeHwnd.store(glfwGetWin32Window(glfwWindow));
    }
    const int w = width > 0 ? width : 800;
    const int h = height > 0 ? height : 600;
#endif
    g.statsW.store(w, std::memory_order_relaxed);
    g.statsH.store(h, std::memory_order_relaxed);
    g.open.store(true, std::memory_order_release);
    logLine("runtime started");
    return 1;
}

}// namespace

extern "C" {

#if defined(__ANDROID__)
int tn_android_context_create(int width, int height) {
    std::lock_guard<std::mutex> lock(g.mu);
    g.stop = false;
    g.workerStarted = true;
    g.workerId = std::this_thread::get_id();
    return impl_runtime_start(width, height, "ThreeBrowserDroid");
}

using tn::renderPendingFrame;

void tn_android_context_resize(int width, int height) {
    width = std::max(1, width);
    height = std::max(1, height);
    g.statsW.store(width, std::memory_order_relaxed);
    g.statsH.store(height, std::memory_order_relaxed);
    if (g.renderer) g.renderer->setSize({width, height});
}

void tn_android_frame(void) {
    std::vector<std::function<void()>> jobs;
    {
        std::lock_guard<std::mutex> lock(g.mu);
        while (!g.jobs.empty()) {
            jobs.push_back(std::move(g.jobs.front()));
            g.jobs.pop_front();
        }
    }
    for (auto& job : jobs) {
        try {
            job();
        } catch (const std::exception& ex) {
            setError(ex.what());
        } catch (...) {
            setError("Android native job failed");
        }
    }
    try {
        renderPendingFrame();
    } catch (const std::exception& ex) {
        setError(ex.what());
    } catch (...) {
        setError("Android native render failed");
    }
}

void tn_android_context_destroy(void) {
    tn_android_frame();
    g.drawScene.store(0);
    g.drawCamera.store(0);
    g.slots.clear();
    g.pendingEnvironment.clear();
    g.envHemi.reset();
    g.envSun.reset();
    destroySurface();
    std::lock_guard<std::mutex> lock(g.mu);
    g.workerStarted = false;
    g.workerId = {};
    tn::resetIds();
}
#endif

const char* tn_last_error(void) {
    thread_local std::string copy;
    std::lock_guard<std::mutex> lock(g.errMu);
    copy = g.lastError;
    return copy.c_str();
}

const char* tn_backend_name(void) {
    return g.backend.load(std::memory_order_relaxed) != 0 ? "Vulkan" : "OpenGL";
}

int tn_runtime_has_vulkan(void) {
#ifdef THREEPP_WITH_VULKAN
    return 1;
#else
    return 0;
#endif
}

void tn_runtime_set_backend(int vulkan) {
#if defined(__ANDROID__)
    if (vulkan != 0) setError("Vulkan is not available in the Android build");
    g.backend.store(0, std::memory_order_relaxed);
    return;
#else
#ifdef THREEPP_WITH_VULKAN
    const int want = vulkan != 0 ? 1 : 0;
#else
    if (vulkan != 0) {
        setError("Vulkan is not available in this build");
        return;
    }
    const int want = 0;
#endif
    g.backend.store(want, std::memory_order_relaxed);
    try {
        onWorker([want] {
            if (!g.canvas) {
                return 0;
            }
            const bool isVk = g.canvas->graphicsApi() == GraphicsAPI::Vulkan;
            if (isVk == (want != 0)) {
                return 0;
            }
            destroySurface();
            g.slots.clear();
            g.pendingEnvironment.clear();
            g.envHemi.reset();
            g.envSun.reset();
            g.drawScene.store(0);
            g.drawCamera.store(0);
            tn::resetIds();
            return 0;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
#endif
}

const char* tn_debug_scene(void) {
    thread_local std::string result;
    result = onWorker([] {
        const auto sceneHandle = g.drawScene.load();
        const auto cameraHandle = g.drawCamera.load();
        Slot* sceneSlot = getSlot(sceneHandle);
        Slot* cameraSlot = getSlot(cameraHandle);
        auto* scene = sceneSlot && sceneSlot->object ? dynamic_cast<Scene*>(sceneSlot->object.get()) : nullptr;
        auto* camera = cameraSlot && cameraSlot->object ? dynamic_cast<Camera*>(cameraSlot->object.get()) : nullptr;
        std::size_t nodes = 0, meshes = 0, visibleMeshes = 0, materials = 0;
        if (scene) {
            scene->traverse([&](Object3D& object) {
                ++nodes;
                if (auto* mesh = dynamic_cast<Mesh*>(&object)) {
                    ++meshes;
                    if (mesh->visible) ++visibleMeshes;
                    if (mesh->material()) ++materials;
                }
            });
        }
        return std::string("scene=") + std::to_string(sceneHandle) +
               " camera=" + std::to_string(cameraHandle) +
               " sceneOk=" + std::to_string(scene != nullptr) +
               " cameraOk=" + std::to_string(camera != nullptr) +
               " nodes=" + std::to_string(nodes) +
               " meshes=" + std::to_string(meshes) +
               " visibleMeshes=" + std::to_string(visibleMeshes) +
               " materials=" + std::to_string(materials);
    });
    return result.c_str();
}

int tn_runtime_start(int width, int height, const char* title) {
    try {
        std::string titleCopy = title ? title : "ThreeBrowser";
        return onWorker([width, height, titleCopy] {
            return impl_runtime_start(width, height, titleCopy.c_str());
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tn_runtime_is_open(void) {
    return g.open.load(std::memory_order_acquire) ? 1 : 0;
}

int tn_poll_input(TNInputEvent* events, int capacity) {
#if defined(__ANDROID__)
    (void) events;
    (void) capacity;
    return 0;
#else
    if (!events || capacity <= 0) return 0;
    std::lock_guard<std::mutex> lock(inputMutex);
    int count = 0;
    while (count < capacity && !inputEvents.empty()) {
        events[count++] = inputEvents.front();
        inputEvents.pop_front();
    }
    return count;
#endif
}

void tn_runtime_set_size(int width, int height) {
    try {
        width = std::max(1, width);
        height = std::max(1, height);
        g.statsW.store(width, std::memory_order_relaxed);
        g.statsH.store(height, std::memory_order_relaxed);
        onWorkerAsync([width, height] {
            if (!g.renderer) {
                return;
            }
#if !defined(__ANDROID__)
            g.canvas->setSize({width, height});
#endif
            g.renderer->setSize({width, height});
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

void tn_runtime_stats(int* fps, int* frameUs, int* width, int* height, int* vsync, uint64_t* presents) {
    if (fps) {
        *fps = g.statsFps.load(std::memory_order_relaxed);
    }
    if (frameUs) {
        *frameUs = g.statsFrameUs.load(std::memory_order_relaxed);
    }
    if (width) {
        *width = g.statsW.load(std::memory_order_relaxed);
    }
    if (height) {
        *height = g.statsH.load(std::memory_order_relaxed);
    }
    if (vsync) {
        *vsync = g.vsync.load(std::memory_order_relaxed) ? 1 : 0;
    }
    if (presents) {
        *presents = g.statsPresents.load(std::memory_order_relaxed);
    }
}

void tn_runtime_set_vsync(int enabled) {
    try {
        const bool on = enabled != 0;
        g.vsync.store(on, std::memory_order_relaxed);
#if defined(_WIN32)
        onWorkerAsync([on] {
            if (!g.canvas) {
                return;
            }
#ifdef THREEPP_WITH_VULKAN
            if (auto* vk = dynamic_cast<VulkanRenderer*>(g.renderer.get())) {
                vk->setVsync(on);
                return;
            }
#endif
            if (g.canvas->graphicsApi() != GraphicsAPI::OpenGL) {
                return;
            }
            auto* glfwWindow = static_cast<GLFWwindow*>(g.canvas->windowPtr());
            if (!glfwWindow) {
                return;
            }
            glfwMakeContextCurrent(glfwWindow);
            glfwSwapInterval(on ? 1 : 0);
        });
#endif
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

void tn_runtime_set_standalone(int enabled) {
    g.standalone.store(enabled != 0, std::memory_order_relaxed);
}

int tn_runtime_render(uint32_t sceneHandle, uint32_t cameraHandle) {
#if defined(_WIN32)
    if (tw_loading_visible()) tw_set_loading(0, nullptr);
#endif
    g.drawScene.store(sceneHandle);
    g.drawCamera.store(cameraHandle);
    markDirty();
    return 1;
}

int tn_frame_info(int* width, int* height, uint64_t* generation) {
    std::lock_guard<std::mutex> lock(g.frameMu);
    if (width) *width = g.frameW;
    if (height) *height = g.frameH;
    if (generation) *generation = g.frameGen;
    return g.frameGen > 0 && g.frameW > 0 && g.frameH > 0 ? 1 : 0;
}

int tn_frame_copy(uint8_t* dst, int maxBytes, int* width, int* height, uint64_t* generation) {
    std::lock_guard<std::mutex> lock(g.frameMu);
    if (g.frameRgba.empty() || g.frameW <= 0 || g.frameH <= 0) {
        return 0;
    }
    const int needed = g.frameW * g.frameH * 4;
    if (!dst || maxBytes < needed) {
        return 0;
    }
    std::memcpy(dst, g.frameRgba.data(), static_cast<size_t>(needed));
    if (width) *width = g.frameW;
    if (height) *height = g.frameH;
    if (generation) *generation = g.frameGen;
    return needed;
}

int tn_runtime_attach_host(void* parentHwnd, int x, int y, int width, int height) {
#if defined(_WIN32)
    try {
        if (!parentHwnd) {
            setError("invalid hwnd");
            return 0;
        }
        width = std::max(1, width);
        height = std::max(1, height);
        g.statsW.store(width, std::memory_order_relaxed);
        g.statsH.store(height, std::memory_order_relaxed);
        // GLFW created the window on this worker. All hwnd ops stay here —
        // SetParent from the UI thread deadlocks against glfwPollEvents.
        onWorkerAsync([parentHwnd, x, y, width, height] {
            if (!g.canvas || !parentHwnd) {
                setError("runtime not started");
                return;
            }
            auto* glfwWindow = static_cast<GLFWwindow*>(g.canvas->windowPtr());
            if (!glfwWindow) {
                setError("no glfw window");
                return;
            }
            HWND child = glfwGetWin32Window(glfwWindow);
            HWND parent = static_cast<HWND>(parentHwnd);
            if (!child || !parent) {
                setError("invalid hwnd");
                return;
            }
            g.nativeHwnd.store(child);
            glfwSetWindowAttrib(glfwWindow, GLFW_DECORATED, GLFW_FALSE);
            LONG_PTR style = GetWindowLongPtrW(child, GWL_STYLE);
            style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU |
                       WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_BORDER | WS_DLGFRAME);
            style |= WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN;
            SetWindowLongPtrW(child, GWL_STYLE, style);
            LONG_PTR ex = GetWindowLongPtrW(child, GWL_EXSTYLE);
            ex &= ~(WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME |
                    WS_EX_STATICEDGE | WS_EX_OVERLAPPEDWINDOW);
            ex |= WS_EX_NOACTIVATE | WS_EX_TRANSPARENT;
            SetWindowLongPtrW(child, GWL_EXSTYLE, ex);
            if (GetParent(child) != parent) {
                SetParent(child, parent);
            }
            SetWindowPos(child, HWND_BOTTOM, x, y, width, height,
                         SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED);
            // GLFW may still report a caption inset. Shift the outer HWND so
            // the GL *client* fills (x,y,w,h) in the parent — otherwise a black
            // title-bar block sits at the top of the WebView and raycasts miss.
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
            if (g.renderer) {
                g.renderer->setSize({width, height});
            }
            logLine("attached host hwnd");
        });
        return 1;
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
#else
    (void) parentHwnd;
    (void) x;
    (void) y;
    (void) width;
    (void) height;
    setError("host HWND attachment is only available on Windows");
    return 0;
#endif
}

void* tn_runtime_hwnd(void) {
    return g.nativeHwnd.load();
}

void tn_runtime_set_loading(int enabled, const char* stage) {
#if defined(_WIN32)
    tw_set_loading(enabled, stage);
    markDirty();
    try {
        onWorkerAsync([enabled] {
            if (!g.canvas) return;
            auto* glfwWindow = static_cast<GLFWwindow*>(g.canvas->windowPtr());
            HWND hwnd = glfwWindow ? glfwGetWin32Window(glfwWindow) : nullptr;
            if (!hwnd) return;
            HCURSOR cursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(enabled ? 32514 : 32512));
            SetClassLongPtrW(hwnd, GCLP_HCURSOR, reinterpret_cast<LONG_PTR>(cursor));
            SetCursor(cursor);
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
#else
    (void) enabled;
    (void) stage;
#endif
}

void tn_runtime_set_overlay(int enabled) {
#if defined(_WIN32)
    tw_set_overlay(enabled);
    markDirty();
#else
    (void) enabled;
#endif
}

int tn_runtime_overlay_open(void) {
#if defined(_WIN32)
    return tw_overlay_open();
#else
    return 0;
#endif
}

void tn_runtime_overlay_click(int x, int y) {
#if defined(_WIN32)
    tw_overlay_click(x, y);
    markDirty();
#else
    (void) x;
    (void) y;
#endif
}

void tn_runtime_toggle_fps_overlay(void) {
#if defined(_WIN32)
    tw_toggle_fps_overlay();
    markDirty();
#endif
}

void tn_runtime_shutdown(void) {
    g.open.store(false, std::memory_order_release);
#if defined(_WIN32)
    tw_set_loading(0, nullptr);
#endif
    {
        std::lock_guard<std::mutex> lock(g.mu);
        if (!g.workerStarted) {
            return;
        }
        g.stop = true;
    }
    g.cv.notify_one();
    if (g.worker.joinable() && std::this_thread::get_id() != g.worker.get_id()) {
        g.worker.join();
    }
    std::lock_guard<std::mutex> lock(g.mu);
    g.workerStarted = false;
    tn::resetIds();
}

void tn_runtime_reset(void) {
    try {
        {
            std::lock_guard<std::mutex> lock(g.mu);
            if (!g.workerStarted || g.stop) {
                return;
            }
        }
        onWorker([] {
            g.drawScene.store(0);
            g.drawCamera.store(0);
            g.slots.clear();
            g.pendingEnvironment.clear();
            g.envHemi.reset();
            g.envSun.reset();
            tn::resetIds();
            if (g.renderer) {
                g.renderer->toneMapping = ToneMapping::None;
                g.renderer->toneMappingExposure = 1.f;
                g.renderer->setClearColor(Color(0x000000));
            }
            markDirty();
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

float tn_runtime_aspect(void) {
    try {
        return onWorker([] {
#if defined(__ANDROID__)
            const int h = std::max(1, g.statsH.load(std::memory_order_relaxed));
            return static_cast<float>(g.statsW.load(std::memory_order_relaxed)) / static_cast<float>(h);
#else
            return g.canvas ? g.canvas->aspect() : 1.f;
#endif
        });
    } catch (...) {
        return 1.f;
    }
}

uint32_t tn_scene_create(void) {
    try {
        return onWorker([] {
            auto scene = Scene::create();
            scene->background = Background(Color(0x000000));
            Slot slot;
            slot.kind = Kind::Scene;
            slot.object = scene;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tn_scene_set_background(uint32_t sceneHandle, uint32_t hex) {
    try {
        onWorker([sceneHandle, hex] {
            Slot* slot = getSlot(sceneHandle);
            if (!slot || slot->kind != Kind::Scene) {
                return;
            }
            if (auto* scene = dynamic_cast<Scene*>(slot->object.get())) {
                scene->background = Background(static_cast<int>(hex));
            }
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

void tn_scene_set_background_texture(uint32_t sceneHandle, uint32_t textureHandle) {
    try {
        onWorker([sceneHandle, textureHandle] {
            Slot* sceneSlot = getSlot(sceneHandle);
            Slot* textureSlot = getSlot(textureHandle);
            if (!sceneSlot || sceneSlot->kind != Kind::Scene ||
                !textureSlot || textureSlot->kind != Kind::Texture || !textureSlot->texture) {
                return;
            }
            if (auto* scene = dynamic_cast<Scene*>(sceneSlot->object.get())) {
                textureSlot->texture->mapping = Mapping::EquirectangularReflection;
                textureSlot->texture->wrapS = TextureWrapping::Repeat;
                scene->background = Background(textureSlot->texture);
                markDirty();
            }
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

uint32_t tn_perspective_camera_create(float fov, float aspect, float nearPlane, float farPlane) {
    try {
        return onWorker([=] {
            auto camera = PerspectiveCamera::create(fov, aspect, nearPlane, farPlane);
            Slot slot;
            slot.kind = Kind::Camera;
            slot.object = camera;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tn_camera_update_projection_matrix(uint32_t cameraHandle) {
    try {
        onWorker([cameraHandle] {
            Slot* slot = getSlot(cameraHandle);
            if (!slot || slot->kind != Kind::Camera) {
                return;
            }
            if (auto* camera = dynamic_cast<Camera*>(slot->object.get())) {
                camera->updateProjectionMatrix();
            }
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

void tn_camera_set_aspect(uint32_t cameraHandle, float aspect) {
    try {
        onWorker([cameraHandle, aspect] {
            Slot* slot = getSlot(cameraHandle);
            if (!slot || slot->kind != Kind::Camera) {
                return;
            }
            if (auto* camera = dynamic_cast<PerspectiveCamera*>(slot->object.get())) {
                camera->aspect = aspect;
                camera->updateProjectionMatrix();
            }
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

uint32_t tn_box_geometry_create(float width, float height, float depth) {
    try {
        return onWorker([=] {
            Slot slot;
            slot.kind = Kind::Geometry;
            slot.geometry = BoxGeometry::create(width, height, depth);
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_plane_geometry_create(float width, float height, int widthSegments, int heightSegments) {
    try {
        return onWorker([=] {
            Slot slot;
            slot.kind = Kind::Geometry;
            slot.geometry = PlaneGeometry::create(
                    width,
                    height,
                    static_cast<unsigned>(std::max(1, widthSegments)),
                    static_cast<unsigned>(std::max(1, heightSegments)));
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_sphere_geometry_create(float radius, int widthSegments, int heightSegments) {
    try {
        return onWorker([=] {
            Slot slot;
            slot.kind = Kind::Geometry;
            slot.geometry = SphereGeometry::create(
                    radius,
                    static_cast<unsigned>(std::max(3, widthSegments)),
                    static_cast<unsigned>(std::max(2, heightSegments)));
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_cylinder_geometry_create(
        float radiusTop, float radiusBottom, float height, int radialSegments, int heightSegments) {
    try {
        return onWorker([=] {
            Slot slot;
            slot.kind = Kind::Geometry;
            slot.geometry = CylinderGeometry::create(
                    radiusTop,
                    radiusBottom,
                    height,
                    static_cast<unsigned>(std::max(3, radialSegments)),
                    static_cast<unsigned>(std::max(1, heightSegments)));
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_mesh_standard_material_create(uint32_t color) {
    try {
        return onWorker([color] {
            auto material = MeshStandardMaterial::create(
                    MeshStandardMaterial::Params{}.color(Color(color)));
            Slot slot;
            slot.kind = Kind::Material;
            slot.material = material;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_mesh_basic_material_create(uint32_t color) {
    try {
        return onWorker([color] {
            auto material = MeshBasicMaterial::create(
                    MeshBasicMaterial::Params{}.color(Color(color)));
            Slot slot;
            slot.kind = Kind::Material;
            slot.material = material;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_group_create(void) {
    try {
        return onWorker([] {
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = Group::create();
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_mesh_create(uint32_t geometryHandle, uint32_t materialHandle) {
    try {
        return onWorker([geometryHandle, materialHandle] {
            Slot* geo = getSlot(geometryHandle);
            Slot* mat = getSlot(materialHandle);
            if (!geo || geo->kind != Kind::Geometry || !geo->geometry) {
                setError("mesh needs a geometry");
                return 0u;
            }
            if (!mat || mat->kind != Kind::Material || !mat->material) {
                setError("mesh needs a material");
                return 0u;
            }
            auto mesh = Mesh::create(geo->geometry, mat->material);
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = mesh;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_hemisphere_light_create(void) {
    try {
        return onWorker([] {
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = HemisphereLight::create();
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_point_light_create(uint32_t color, float intensity) {
    try {
        return onWorker([color, intensity] {
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = PointLight::create(Color(color), intensity);
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tn_object_add(uint32_t parentHandle, uint32_t childHandle) {
    try {
        return onWorker([parentHandle, childHandle] {
            Slot* parent = getSlot(parentHandle);
            Slot* child = getSlot(childHandle);
            if (!parent || !parent->object || !child || !child->object) {
                setError("add() needs two scene objects");
                return 0;
            }
            parent->object->add(child->object);
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tn_object_remove(uint32_t parentHandle, uint32_t childHandle) {
    try {
        onWorker([parentHandle, childHandle] {
            Slot* parent = findSlot(parentHandle);
            Slot* child = findSlot(childHandle);
            if (!parent || !parent->object || !child || !child->object) {
                return;
            }
            parent->object->remove(*child->object);
            markDirty();
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

void tn_slot_destroy(uint32_t id) {
    try {
        onWorker([id] { destroySlot(id); });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

int tn_object_set_visible(uint32_t objectHandle, int visible) {
    onWorkerAsync([objectHandle, visible] {
        Object3D* object = asObject(objectHandle);
        if (object) {
            object->visible = visible != 0;
        }
    });
    return 1;
}

int tn_object_set_position(uint32_t objectHandle, float x, float y, float z) {
    onWorkerAsync([objectHandle, x, y, z] {
        Object3D* object = asObject(objectHandle);
        if (object) {
            object->position.set(x, y, z);
        }
    });
    return 1;
}

int tn_object_get_position(uint32_t objectHandle, float* x, float* y, float* z) {
    try {
        float px = 0, py = 0, pz = 0;
        const int ok = onWorker([objectHandle, &px, &py, &pz] {
            Object3D* object = asObject(objectHandle);
            if (!object) {
                return 0;
            }
            px = object->position.x;
            py = object->position.y;
            pz = object->position.z;
            return 1;
        });
        if (ok) {
            if (x) *x = px;
            if (y) *y = py;
            if (z) *z = pz;
        }
        return ok;
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tn_object_set_rotation(uint32_t objectHandle, float x, float y, float z) {
    onWorkerAsync([objectHandle, x, y, z] {
        Object3D* object = asObject(objectHandle);
        if (object) {
            object->rotation.set(x, y, z);
        }
    });
    return 1;
}

int tn_object_get_rotation(uint32_t objectHandle, float* x, float* y, float* z) {
    try {
        float rx = 0, ry = 0, rz = 0;
        const int ok = onWorker([objectHandle, &rx, &ry, &rz] {
            Object3D* object = asObject(objectHandle);
            if (!object) {
                return 0;
            }
            rx = static_cast<float>(object->rotation.x);
            ry = static_cast<float>(object->rotation.y);
            rz = static_cast<float>(object->rotation.z);
            return 1;
        });
        if (ok) {
            if (x) *x = rx;
            if (y) *y = ry;
            if (z) *z = rz;
        }
        return ok;
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tn_object_set_scale(uint32_t objectHandle, float x, float y, float z) {
    onWorkerAsync([objectHandle, x, y, z] {
        Object3D* object = asObject(objectHandle);
        if (object) {
            object->scale.set(x, y, z);
        }
    });
    return 1;
}

int tn_object_look_at(uint32_t objectHandle, float x, float y, float z) {
    onWorkerAsync([objectHandle, x, y, z] {
        Object3D* object = asObject(objectHandle);
        if (object) {
            object->lookAt(x, y, z);
        }
    });
    return 1;
}

void tn_object_look_from(uint32_t objectHandle, float x, float y, float z, float tx, float ty, float tz) {
    onWorkerAsync([objectHandle, x, y, z, tx, ty, tz] {
        Object3D* object = asObject(objectHandle);
        if (!object) {
            return;
        }
        object->position.set(x, y, z);
        object->lookAt(tx, ty, tz);
    });
}

uint32_t tn_ambient_light_create(uint32_t color, float intensity) {
    try {
        return onWorker([color, intensity] {
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = AmbientLight::create(Color(color), intensity);
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_directional_light_create(uint32_t color, float intensity) {
    try {
        return onWorker([color, intensity] {
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = DirectionalLight::create(Color(color), intensity);
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tn_renderer_set_tone_mapping(int mode, float exposure) {
    try {
        onWorker([mode, exposure] {
            if (!g.renderer) {
                return;
            }
            g.renderer->toneMapping = static_cast<ToneMapping>(mode);
            g.renderer->toneMappingExposure = exposure;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

uint32_t tn_gltf_load(const char* path) {
    try {
        std::string pathCopy = path ? path : "";
        return onWorker([pathCopy] {
            GLTFLoader loader;
            auto result = loader.load(pathCopy);
            if (!result || !result->scene) {
                setError("GLTFLoader failed");
                return 0u;
            }
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = result->scene;
            slot.clips = std::move(result->animations);
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tn_gltf_clip_count(uint32_t objectHandle) {
    try {
        return onWorker([objectHandle] {
            Slot* slot = getSlot(objectHandle);
            if (!slot) {
                return 0;
            }
            return static_cast<int>(slot->clips.size());
        });
    } catch (...) {
        return 0;
    }
}

uint32_t tn_mixer_create(uint32_t rootHandle) {
    try {
        return onWorker([rootHandle] {
            Slot* root = getSlot(rootHandle);
            if (!root || !root->object) {
                setError("mixer needs a scene object");
                return 0u;
            }
            Slot slot;
            slot.kind = Kind::Mixer;
            slot.object = root->object;
            slot.clips = root->clips;
            slot.mixer = std::make_unique<AnimationMixer>(*root->object);
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

int tn_mixer_play(uint32_t mixerHandle, int clipIndex) {
    try {
        return onWorker([mixerHandle, clipIndex] {
            Slot* slot = getSlot(mixerHandle);
            if (!slot || !slot->mixer) {
                setError("invalid mixer");
                return 0;
            }
            if (clipIndex < 0 || clipIndex >= static_cast<int>(slot->clips.size())) {
                setError("clip index out of range");
                return 0;
            }
            auto* action = slot->mixer->clipAction(slot->clips[static_cast<size_t>(clipIndex)]);
            if (!action) {
                setError("clipAction failed");
                return 0;
            }
            action->play();
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tn_mixer_update(uint32_t mixerHandle, float dt) {
    try {
        onWorker([mixerHandle, dt] {
            Slot* slot = getSlot(mixerHandle);
            if (!slot || !slot->mixer) {
                return;
            }
            slot->mixer->update(dt);
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

uint32_t tn_torus_knot_geometry_create(float radius, float tube, int tubular, int radial, int p, int q) {
    try {
        return onWorker([=] {
            Slot slot;
            slot.kind = Kind::Geometry;
            slot.geometry = TorusKnotGeometry::create(
                    radius, tube,
                    static_cast<unsigned>(std::max(3, tubular)),
                    static_cast<unsigned>(std::max(3, radial)),
                    static_cast<unsigned>(std::max(1, p)),
                    static_cast<unsigned>(std::max(1, q)));
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tn_material_set_pbr(uint32_t materialHandle, float metalness, float roughness) {
    try {
        onWorker([materialHandle, metalness, roughness] {
            Slot* slot = getSlot(materialHandle);
            if (!slot || !slot->material) {
                return;
            }
            if (auto mat = std::dynamic_pointer_cast<MeshStandardMaterial>(slot->material)) {
                mat->metalness = metalness;
                mat->roughness = roughness;
            }
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

uint32_t tn_instanced_mesh_create(uint32_t geometryHandle, uint32_t materialHandle, int count) {
    try {
        return onWorker([geometryHandle, materialHandle, count] {
            Slot* geo = getSlot(geometryHandle);
            Slot* mat = getSlot(materialHandle);
            if (!geo || !geo->geometry || !mat || !mat->material) {
                setError("instanced mesh needs geometry and material");
                return 0u;
            }
            const int n = std::max(1, count);
            auto mesh = InstancedMesh::create(geo->geometry, mat->material, static_cast<size_t>(n));
            Slot slot;
            slot.kind = Kind::Object;
            slot.object = mesh;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_buffer_geometry_create(
        const float* pos, int posFloats,
        const float* nrm, int nrmFloats,
        const float* uv, int uvFloats,
        const uint32_t* idx, int idxCount) {
    try {
        std::vector<float> posCopy;
        std::vector<float> nrmCopy;
        std::vector<float> uvCopy;
        std::vector<unsigned int> idxCopy;
        if (pos && posFloats > 0) posCopy.assign(pos, pos + posFloats);
        if (nrm && nrmFloats > 0) nrmCopy.assign(nrm, nrm + nrmFloats);
        if (uv && uvFloats > 0) uvCopy.assign(uv, uv + uvFloats);
        if (idx && idxCount > 0) idxCopy.assign(idx, idx + idxCount);
        return onWorker([posCopy = std::move(posCopy),
                         nrmCopy = std::move(nrmCopy),
                         uvCopy = std::move(uvCopy),
                         idxCopy = std::move(idxCopy)]() mutable {
            if (posCopy.size() < 3) {
                setError("buffer geometry needs positions");
                return 0u;
            }
            auto geo = BufferGeometry::create();
            geo->setAttribute("position", std::shared_ptr<BufferAttribute>(
                    FloatBufferAttribute::create(std::move(posCopy), 3)));
            if (nrmCopy.size() >= 3 && (nrmCopy.size() % 3) == 0) {
                geo->setAttribute("normal", std::shared_ptr<BufferAttribute>(
                        FloatBufferAttribute::create(std::move(nrmCopy), 3)));
            }
            if (uvCopy.size() >= 2 && (uvCopy.size() % 2) == 0) {
                geo->setAttribute("uv", std::shared_ptr<BufferAttribute>(
                        FloatBufferAttribute::create(std::move(uvCopy), 2)));
            }
            if (!idxCopy.empty()) {
                geo->setIndex(std::move(idxCopy));
            }
            geo->computeBoundingSphere();
            Slot slot;
            slot.kind = Kind::Geometry;
            slot.geometry = std::move(geo);
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tn_buffer_geometry_set_attr(
        uint32_t geometryHandle, const char* name, int itemSize, const float* data, int floatCount) {
    try {
        if (!name || !name[0] || itemSize <= 0 || !data || floatCount < itemSize) {
            setError("buffer attr needs name, itemSize and floats");
            return;
        }
        std::string attrName(name);
        std::vector<float> copy(data, data + floatCount);
        onWorker([geometryHandle, attrName = std::move(attrName), itemSize, copy = std::move(copy)]() mutable {
            Slot* slot = getSlot(geometryHandle);
            if (!slot || slot->kind != Kind::Geometry || !slot->geometry) {
                setError("buffer attr needs a geometry");
                return;
            }
            if (copy.size() % static_cast<size_t>(itemSize) != 0) {
                setError("buffer attr length is not a multiple of itemSize");
                return;
            }
            slot->geometry->setAttribute(
                    attrName, std::shared_ptr<BufferAttribute>(FloatBufferAttribute::create(std::move(copy), itemSize)));
            markDirty();
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

uint32_t tn_mesh_lambert_material_create(uint32_t color) {
    try {
        return onWorker([color] {
            auto material = MeshLambertMaterial::create(
                    MeshLambertMaterial::Params{}.color(Color(color)));
            Slot slot;
            slot.kind = Kind::Material;
            slot.material = material;
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

uint32_t tn_mesh_normal_material_create(void) {
    try {
        return onWorker([] {
            Slot slot;
            slot.kind = Kind::Material;
            slot.material = MeshNormalMaterial::create();
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tn_material_set_side(uint32_t materialHandle, int side) {
    try {
        onWorker([materialHandle, side] {
            Slot* slot = getSlot(materialHandle);
            if (!slot || !slot->material) {
                return;
            }
            slot->material->side = side <= 0 ? Side::Front : side == 1 ? Side::Back : Side::Double;
            slot->material->needsUpdate();
            markDirty();
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

void tn_material_set_visible(uint32_t materialHandle, int visible) {
    try {
        onWorker([materialHandle, visible] {
            Slot* slot = getSlot(materialHandle);
            if (!slot || !slot->material) {
                return;
            }
            slot->material->visible = visible != 0;
            slot->material->needsUpdate();
            markDirty();
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

namespace {

void applyMaterialMapSlot(Material* material, const std::shared_ptr<Texture>& texture, int slot) {
    if (!material || !texture) {
        return;
    }
    switch (slot) {
        case 1:
            if (auto* m = dynamic_cast<MaterialWithNormalMap*>(material)) {
                m->normalMap = texture;
            }
            break;
        case 2:
            if (auto* m = dynamic_cast<MaterialWithRoughness*>(material)) {
                m->roughnessMap = texture;
            }
            break;
        case 3:
            if (auto* m = dynamic_cast<MaterialWithMetalness*>(material)) {
                m->metalnessMap = texture;
            }
            break;
        case 4:
            if (auto* m = dynamic_cast<MaterialWithAoMap*>(material)) {
                m->aoMap = texture;
            }
            break;
        case 5:
            if (auto* m = dynamic_cast<MaterialWithEmissive*>(material)) {
                m->emissiveMap = texture;
            }
            break;
        case 6:
            if (auto* m = dynamic_cast<MaterialWithEnvMap*>(material)) {
                m->envMap = texture;
            }
            break;
        case 7:
            if (auto* m = dynamic_cast<MaterialWithLightMap*>(material)) {
                m->lightMap = texture;
            }
            break;
        default:
            if (auto* m = dynamic_cast<MaterialWithMap*>(material)) {
                m->map = texture;
            }
            break;
    }
    material->needsUpdate();
    markDirty();
}

}// namespace

void tn_material_set_map(uint32_t materialHandle, uint32_t textureHandle) {
    tn_material_set_map_slot(materialHandle, 0, textureHandle);
}

void tn_material_set_map_slot(uint32_t materialHandle, int slot, uint32_t textureHandle) {
    try {
        onWorker([materialHandle, slot, textureHandle] {
            Slot* matSlot = getSlot(materialHandle);
            Slot* texSlot = getSlot(textureHandle);
            if (!matSlot || !matSlot->material || !texSlot || !texSlot->texture) {
                setError("material set map needs material and texture");
                return;
            }
            applyMaterialMapSlot(matSlot->material.get(), texSlot->texture, slot);
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

uint32_t tn_texture_from_rgba(int width, int height, const uint8_t* rgba, int nbytes) {
    try {
        if (!rgba || width <= 0 || height <= 0 || nbytes <= 0) {
            setError("texture needs rgba pixels");
            return 0;
        }
        std::vector<unsigned char> pixels(rgba, rgba + nbytes);
        return onWorker([width, height, pixels = std::move(pixels)]() mutable {
            Image image(std::move(pixels), static_cast<unsigned>(width), static_cast<unsigned>(height));
            auto tex = Texture::create(image);
            tex->format = Format::RGBA;
            tex->colorSpace = ColorSpace::sRGB;
            tex->magFilter = Filter::Linear;
            tex->minFilter = Filter::LinearMipmapLinear;
            tex->generateMipmaps = true;
            tex->needsUpdate();
            Slot slot;
            slot.kind = Kind::Texture;
            slot.texture = std::move(tex);
            return insert(std::move(slot));
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

void tn_texture_set_filter(uint32_t textureHandle, int mag, int minFilter) {
    try {
        onWorker([textureHandle, mag, minFilter] {
            Slot* slot = getSlot(textureHandle);
            if (!slot || !slot->texture) {
                return;
            }
            slot->texture->magFilter = static_cast<Filter>(mag);
            slot->texture->minFilter = static_cast<Filter>(minFilter);
            const auto minF = slot->texture->minFilter;
            slot->texture->generateMipmaps =
                    minF == Filter::NearestMipmapNearest ||
                    minF == Filter::NearestMipmapLinear ||
                    minF == Filter::LinearMipmapNearest ||
                    minF == Filter::LinearMipmapLinear;
            slot->texture->needsUpdate();
            markDirty();
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
    }
}

int tn_instanced_fill_grid(uint32_t meshHandle, float spacing) {
    try {
        return onWorker([meshHandle, spacing] {
            Slot* slot = getSlot(meshHandle);
            if (!slot || !slot->object) {
                setError("invalid instanced mesh");
                return 0;
            }
            auto mesh = std::dynamic_pointer_cast<InstancedMesh>(slot->object);
            if (!mesh) {
                setError("handle is not InstancedMesh");
                return 0;
            }
            const auto count = mesh->count();
            const auto sqrtCount = static_cast<size_t>(std::ceil(std::sqrt(static_cast<double>(count))));
            const float size = spacing > 0.f ? spacing : 5.5f;
            const float start = (static_cast<float>(sqrtCount) / -2.f * size) + (size / 2.f);
            std::mt19937 rng{42};
            std::uniform_real_distribution<float> dist(0.f, 1.f);
            Matrix4 matrix;
            Vector3 position;
            Vector3 scale{1, 1, 1};
            Quaternion quaternion;
            Color color;
            for (size_t i = 0; i < count; ++i) {
                const auto row = i / sqrtCount;
                const auto col = i % sqrtCount;
                position.set(static_cast<float>(col) * size + start, 0, static_cast<float>(row) * size + start);
                quaternion.setFromEuler(Euler(dist(rng) * 6.2831853f, dist(rng) * 6.2831853f, dist(rng) * 6.2831853f));
                matrix.compose(position, quaternion, scale);
                mesh->setMatrixAt(i, matrix);
                color.setHSL(dist(rng), 0.6f, 0.5f);
                mesh->setColorAt(i, color);
            }
            mesh->instanceMatrix()->needsUpdate();
            if (auto* instanceColor = mesh->instanceColor()) {
                instanceColor->needsUpdate();
            }
            mesh->computeBoundingSphere();
            mesh->frustumCulled = true;
            return 1;
        });
    } catch (const std::exception& ex) {
        setError(ex.what());
        return 0;
    }
}

}// extern "C"
