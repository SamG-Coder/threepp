#pragma once

#include "threepp/threepp.hpp"
#include "threepp/animation/AnimationMixer.hpp"
#include "threepp/objects/Skeleton.hpp"
#include "threepp/renderers/RenderTarget.hpp"

#include <atomic>
#include <condition_variable>
#include <deque>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace tn {

using namespace threepp;

enum class Kind {
    None,
    Scene,
    Camera,
    Object,
    Geometry,
    Material,
    Mixer,
    Texture,
    Skeleton
};

struct Slot {
    Kind kind{Kind::None};
    std::shared_ptr<Object3D> object;
    std::shared_ptr<BufferGeometry> geometry;
    std::shared_ptr<Material> material;
    std::shared_ptr<Texture> texture;
    std::shared_ptr<Skeleton> skeleton;
    std::unique_ptr<AnimationMixer> mixer;
    std::unique_ptr<RenderTarget> renderTarget;
    std::vector<std::shared_ptr<AnimationClip>> clips;
};

struct Runtime {
    std::unique_ptr<Canvas> canvas;
    std::unique_ptr<Renderer> renderer;
    std::atomic<int> backend{0}; // 0 OpenGL, 1 Vulkan
    std::unordered_map<uint32_t, Slot> slots;
    // Cmd-ring ids are allocated in JS (1 .. comIdBase-1) and claimed with
    // insertAt. COM insert() must not pick those numbers — GLTF parse queues
    // hundreds of Object3D groups before submit, then BoneCreate/TextureFromRgba
    // used to steal the same ids. Mixer SET_POSE then hit Texture/Geometry
    // slots every frame and drowned the GL thread in native.log writes.
    uint32_t next{1};
    uint32_t comNext{0x80000000u};
    static constexpr uint32_t comIdBase{0x80000000u};

    std::mutex mu;
    std::condition_variable cv;
    std::deque<std::function<void()>> jobs;
    std::thread worker;
    std::thread::id workerId;
    bool stop{false};
    bool workerStarted{false};
    std::atomic<uint32_t> drawScene{0};
    std::atomic<uint32_t> drawCamera{0};
    std::atomic<bool> sceneDirty{false};
    std::atomic<bool> vsync{false};
    std::atomic<bool> standalone{false};
    std::atomic<void*> nativeHwnd{nullptr};
    std::atomic<int> statsFps{0};
    std::atomic<int> statsFrameUs{0};
    std::atomic<int> statsW{0};
    std::atomic<int> statsH{0};
    std::atomic<uint64_t> statsPresents{0};

    std::mutex frameMu;
    std::vector<unsigned char> frameRgba;
    int frameW{0};
    int frameH{0};
    uint64_t frameGen{0};

    std::mutex errMu;
    std::string lastError;

    // scene handle -> env texture handle, applied once the Scene slot exists.
    std::unordered_map<uint32_t, uint32_t> pendingEnvironment;
    std::shared_ptr<Object3D> envHemi;
    std::shared_ptr<Object3D> envSun;
};

extern Runtime g;

void workerMain();
void logLine(const char* message);
void setError(const char* message);
void markDirty();
void ensureWorker();
uint32_t insert(Slot slot);
uint32_t insertAt(uint32_t id, Slot slot);
Slot* getSlot(uint32_t id);
Slot* findSlot(uint32_t id);
Object3D* asObject(uint32_t id);
Object3D* findObject(uint32_t id);
void resetIds();
void onWorkerAsync(std::function<void()> fn);
void renderPendingFrame();
void applyPendingEnvironment();
void destroySlot(uint32_t id);
#if defined(__ANDROID__)
void androidWakeWorker();
#endif

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
            throw std::runtime_error("native runtime is shutting down");
        }
        g.jobs.emplace_back([task] { (*task)(); });
    }
    g.cv.notify_one();
#if defined(__ANDROID__)
    androidWakeWorker();
#endif
    return fut.get();
}

}// namespace tn
