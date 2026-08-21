#include <jni.h>

#include <android/log.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>
#include <EGL/egl.h>
#include <GLES3/gl3.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <thread>
#include <vector>

#include "android_runtime.hpp"

namespace {

constexpr const char* TAG = "ThreeBrowserDroid";

class NativeRenderer {
public:
    ~NativeRenderer() { shutdown(); }

    void attach(ANativeWindow* incoming) {
        std::scoped_lock lock(mu_);
        replaceWindowLocked(incoming);
        ensureThreadLocked();
        dirty_ = true;
        cv_.notify_all();
    }

    void detach() {
        std::scoped_lock lock(mu_);
        replaceWindowLocked(nullptr);
        dirty_ = true;
        cv_.notify_all();
    }

    void resize(int width, int height) {
        std::scoped_lock lock(mu_);
        width_ = width;
        height_ = height;
        dirty_ = true;
        cv_.notify_all();
    }

    void setPaused(bool paused) {
        std::scoped_lock lock(mu_);
        paused_ = paused;
        dirty_ = true;
        cv_.notify_all();
    }

    void wake() {
        std::scoped_lock lock(mu_);
        workPending_ = true;
        cv_.notify_one();
    }

    void shutdown() {
        {
            std::scoped_lock lock(mu_);
            if (!thread_.joinable()) {
                replaceWindowLocked(nullptr);
                return;
            }
            stopping_ = true;
            cv_.notify_all();
        }
        thread_.join();
        std::scoped_lock lock(mu_);
        replaceWindowLocked(nullptr);
        stopping_ = false;
    }

private:
    void ensureThreadLocked() {
        if (!thread_.joinable()) thread_ = std::thread([this] { run(); });
    }

    void replaceWindowLocked(ANativeWindow* incoming) {
        if (window_ == incoming) return;
        if (window_) ANativeWindow_release(window_);
        window_ = incoming;
        if (window_) ANativeWindow_acquire(window_);
    }

    void run() {
        EGLDisplay display = EGL_NO_DISPLAY;
        EGLContext context = EGL_NO_CONTEXT;
        EGLSurface surface = EGL_NO_SURFACE;
        ANativeWindow* boundWindow = nullptr;

        auto destroySurface = [&] {
            if (display != EGL_NO_DISPLAY) eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
            if (display != EGL_NO_DISPLAY && surface != EGL_NO_SURFACE) eglDestroySurface(display, surface);
            surface = EGL_NO_SURFACE;
            if (boundWindow) ANativeWindow_release(boundWindow);
            boundWindow = nullptr;
        };

        display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
        EGLint major = 0, minor = 0;
        if (display == EGL_NO_DISPLAY || !eglInitialize(display, &major, &minor)) {
            __android_log_print(ANDROID_LOG_ERROR, TAG, "eglInitialize failed");
            return;
        }
        const EGLint configAttrs[] = {
                EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
                EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
                EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8,
                EGL_ALPHA_SIZE, 8,
                EGL_DEPTH_SIZE, 24,
                EGL_STENCIL_SIZE, 8,
                EGL_NONE};
        EGLConfig config = nullptr;
        EGLint count = 0;
        if (!eglChooseConfig(display, configAttrs, &config, 1, &count) || count == 0) {
            __android_log_print(ANDROID_LOG_ERROR, TAG, "No GLES3 EGL config");
            eglTerminate(display);
            return;
        }
        const EGLint contextAttrs[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE};
        context = eglCreateContext(display, config, EGL_NO_CONTEXT, contextAttrs);
        if (context == EGL_NO_CONTEXT) {
            __android_log_print(ANDROID_LOG_ERROR, TAG, "eglCreateContext failed");
            eglTerminate(display);
            return;
        }

        while (true) {
            ANativeWindow* nextWindow = nullptr;
            int width = 1, height = 1;
            bool paused = false;
            {
                std::unique_lock lock(mu_);
                cv_.wait(lock, [this] { return stopping_ || dirty_ || workPending_; });
                if (stopping_) break;
                dirty_ = false;
                workPending_ = false;
                paused = paused_;
                width = width_;
                height = height_;
                nextWindow = window_;
                if (nextWindow) ANativeWindow_acquire(nextWindow);
            }

            if (nextWindow != boundWindow) {
                destroySurface();
                boundWindow = nextWindow;
                nextWindow = nullptr;
                if (boundWindow) {
                    EGLint nativeFormat = 0;
                    eglGetConfigAttrib(display, config, EGL_NATIVE_VISUAL_ID, &nativeFormat);
                    ANativeWindow_setBuffersGeometry(boundWindow, 0, 0, nativeFormat);
                    surface = eglCreateWindowSurface(display, config, boundWindow, nullptr);
                    if (surface == EGL_NO_SURFACE || !eglMakeCurrent(display, surface, surface, context)) {
                        __android_log_print(ANDROID_LOG_ERROR, TAG, "Could not bind Android window");
                        destroySurface();
                    } else {
                        eglSwapInterval(display, 1);
                        if (!tn_android_context_create(width, height)) {
                            __android_log_print(ANDROID_LOG_ERROR, TAG, "threepp initialization failed: %s", tn_last_error());
                        }
                    }
                }
            }
            if (nextWindow) ANativeWindow_release(nextWindow);
            if (paused || surface == EGL_NO_SURFACE) continue;

            tn_android_context_resize(width, height);
            tn_android_frame();
            eglSwapBuffers(display, surface);
        }

        tn_android_context_destroy();
        destroySurface();
        eglDestroyContext(display, context);
        eglTerminate(display);
    }

    std::mutex mu_;
    std::condition_variable cv_;
    std::thread thread_;
    ANativeWindow* window_ = nullptr;
    int width_ = 1;
    int height_ = 1;
    bool paused_ = true;
    bool dirty_ = false;
    bool workPending_ = false;
    bool stopping_ = false;
};

NativeRenderer renderer;

} // namespace

namespace tn {
void androidWakeWorker() { renderer.wake(); }
}

extern "C" JNIEXPORT void JNICALL
Java_com_threebrowser_droid_NativeRuntime_attachSurface(JNIEnv* env, jobject, jobject surface) {
    ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
    renderer.attach(window);
    if (window) ANativeWindow_release(window);
}

extern "C" JNIEXPORT void JNICALL
Java_com_threebrowser_droid_NativeRuntime_detachSurface(JNIEnv*, jobject) { renderer.detach(); }

extern "C" JNIEXPORT void JNICALL
Java_com_threebrowser_droid_NativeRuntime_resize(JNIEnv*, jobject, jint width, jint height) {
    renderer.resize(width, height);
}

extern "C" JNIEXPORT void JNICALL
Java_com_threebrowser_droid_NativeRuntime_pause(JNIEnv*, jobject) { renderer.setPaused(true); }

extern "C" JNIEXPORT void JNICALL
Java_com_threebrowser_droid_NativeRuntime_resume(JNIEnv*, jobject) { renderer.setPaused(false); }

extern "C" JNIEXPORT void JNICALL
Java_com_threebrowser_droid_NativeRuntime_shutdown(JNIEnv*, jobject) { renderer.shutdown(); }

extern "C" JNIEXPORT void JNICALL
Java_com_threebrowser_droid_NativeRuntime_reset(JNIEnv*, jobject) { tn_runtime_reset(); }

extern "C" JNIEXPORT jstring JNICALL
Java_com_threebrowser_droid_NativeRuntime_backendName(JNIEnv* env, jobject) {
    return env->NewStringUTF("threepp / OpenGL ES 3");
}

extern "C" JNIEXPORT jint JNICALL
Java_com_threebrowser_droid_NativeRuntime_submitCommands(JNIEnv* env, jobject, jbyteArray bytes) {
    if (!bytes) return -1;
    const jsize size = env->GetArrayLength(bytes);
    std::vector<std::uint8_t> copy(static_cast<std::size_t>(size));
    env->GetByteArrayRegion(bytes, 0, size, reinterpret_cast<jbyte*>(copy.data()));
    if (env->ExceptionCheck()) return -1;
    return tn_cmd_submit(copy.data(), static_cast<int>(copy.size()));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_threebrowser_droid_NativeRuntime_submitCommandsAsync(JNIEnv* env, jobject, jbyteArray bytes) {
    if (!bytes) return -1;
    const jsize size = env->GetArrayLength(bytes);
    if (size <= 0) return 1;
    void* data = env->GetPrimitiveArrayCritical(bytes, nullptr);
    if (!data) return -1;
    const int result = tn_cmd_submit_async(static_cast<const std::uint8_t*>(data), size);
    env->ReleasePrimitiveArrayCritical(bytes, data, JNI_ABORT);
    return result;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_threebrowser_droid_NativeRuntime_createBone(JNIEnv*, jobject) {
    return static_cast<jint>(tn_bone_create());
}

extern "C" JNIEXPORT jint JNICALL
Java_com_threebrowser_droid_NativeRuntime_createSkeleton(JNIEnv* env, jobject, jintArray bones) {
    if (!bones) return 0;
    const jsize size = env->GetArrayLength(bones);
    std::vector<jint> source(static_cast<std::size_t>(size));
    env->GetIntArrayRegion(bones, 0, size, source.data());
    if (env->ExceptionCheck()) return 0;
    std::vector<std::uint32_t> ids(source.begin(), source.end());
    return static_cast<jint>(tn_skeleton_create(ids.data(), static_cast<int>(ids.size())));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_threebrowser_droid_NativeRuntime_setSkeletonInverses(JNIEnv* env, jobject, jint skeleton, jbyteArray bytes) {
    if (!bytes) return 0;
    const jsize byteCount = env->GetArrayLength(bytes);
    if (byteCount <= 0 || byteCount % static_cast<jsize>(sizeof(float)) != 0) return 0;
    std::vector<float> values(static_cast<std::size_t>(byteCount) / sizeof(float));
    env->GetByteArrayRegion(bytes, 0, byteCount, reinterpret_cast<jbyte*>(values.data()));
    if (env->ExceptionCheck()) return 0;
    return tn_skeleton_set_inverses(static_cast<std::uint32_t>(skeleton), values.data(),
                                    static_cast<int>(values.size()));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_threebrowser_droid_NativeRuntime_pmremFromObject(JNIEnv*, jobject, jint id, jint objectId) {
    return static_cast<jint>(tn_pmrem_from_object(static_cast<std::uint32_t>(id),
                                                 static_cast<std::uint32_t>(objectId)));
}

extern "C" JNIEXPORT void JNICALL
Java_com_threebrowser_droid_NativeRuntime_sceneSetEnvironment(JNIEnv*, jobject, jint scene, jint texture) {
    tn_scene_set_environment(static_cast<std::uint32_t>(scene),
                             static_cast<std::uint32_t>(texture));
}

namespace {
class UtfChars {
public:
    UtfChars(JNIEnv* env, jstring value): env_(env), value_(value), chars_(value ? env->GetStringUTFChars(value, nullptr) : nullptr) {}
    ~UtfChars() { if (chars_) env_->ReleaseStringUTFChars(value_, chars_); }
    const char* get() const { return chars_ ? chars_ : ""; }
private:
    JNIEnv* env_;
    jstring value_;
    const char* chars_;
};
}

extern "C" JNIEXPORT jint JNICALL
Java_com_threebrowser_droid_NativeRuntime_shaderMaterialCreate(JNIEnv* env, jobject, jstring vertex, jstring fragment) {
    UtfChars vertexChars(env, vertex);
    UtfChars fragmentChars(env, fragment);
    return static_cast<jint>(tn_shader_material_create(vertexChars.get(), fragmentChars.get()));
}

extern "C" JNIEXPORT void JNICALL
Java_com_threebrowser_droid_NativeRuntime_shaderSetFlags(JNIEnv*, jobject, jint material, jint side, jint depthWrite) {
    tn_shader_set_flags(static_cast<std::uint32_t>(material), side, depthWrite);
}

extern "C" JNIEXPORT void JNICALL
Java_com_threebrowser_droid_NativeRuntime_shaderUniformFloat(JNIEnv* env, jobject, jint material, jstring name, jfloat value) {
    UtfChars nameChars(env, name);
    tn_shader_uniform_float(static_cast<std::uint32_t>(material), nameChars.get(), value);
}

extern "C" JNIEXPORT void JNICALL
Java_com_threebrowser_droid_NativeRuntime_shaderUniformVec2(JNIEnv* env, jobject, jint material, jstring name, jfloat x, jfloat y) {
    UtfChars nameChars(env, name);
    tn_shader_uniform_vec2(static_cast<std::uint32_t>(material), nameChars.get(), x, y);
}

extern "C" JNIEXPORT void JNICALL
Java_com_threebrowser_droid_NativeRuntime_shaderUniformVec3(JNIEnv* env, jobject, jint material, jstring name, jfloat x, jfloat y, jfloat z) {
    UtfChars nameChars(env, name);
    tn_shader_uniform_vec3(static_cast<std::uint32_t>(material), nameChars.get(), x, y, z);
}

extern "C" JNIEXPORT void JNICALL
Java_com_threebrowser_droid_NativeRuntime_shaderUniformVec4(JNIEnv* env, jobject, jint material, jstring name, jfloat x, jfloat y, jfloat z, jfloat w) {
    UtfChars nameChars(env, name);
    tn_shader_uniform_vec4(static_cast<std::uint32_t>(material), nameChars.get(), x, y, z, w);
}
