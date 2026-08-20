#pragma once

#include "threepp/threepp.hpp"
#include "threepp/animation/AnimationMixer.hpp"
#include "threepp/objects/Skeleton.hpp"

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
    std::vector<std::shared_ptr<AnimationClip>> clips;
};

struct Runtime {
    std::unique_ptr<Canvas> canvas;
    std::unique_ptr<GLRenderer> renderer;
    std::unordered_map<uint32_t, Slot> slots;
    uint32_t next{1};

    std::mutex mu;
    std::condition_variable cv;
    std::deque<std::function<void()>> jobs;
    std::thread worker;
    std::thread::id workerId;
    bool stop{false};
    bool workerStarted{false};
    std::atomic<uint32_t> drawScene{0};
    std::atomic<uint32_t> drawCamera{0};
    std::atomic<bool> sceneDirty{true};
    std::atomic<void*> nativeHwnd{nullptr};

    std::mutex frameMu;
    std::vector<unsigned char> frameRgba;
    int frameW{0};
    int frameH{0};
    uint64_t frameGen{0};

    std::mutex errMu;
    std::string lastError;
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
Object3D* asObject(uint32_t id);
void onWorkerAsync(std::function<void()> fn);

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
    return fut.get();
}

}// namespace tn
