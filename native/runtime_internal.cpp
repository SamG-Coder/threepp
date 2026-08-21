#include "runtime_internal.hpp"

#include <cstring>
#include <fstream>
#if defined(__ANDROID__)
#include <android/log.h>
#endif

namespace tn {

Runtime g;

void logLine(const char* message) {
#if defined(__ANDROID__)
    __android_log_print(ANDROID_LOG_INFO, "ThreeBrowserNative", "%s", message ? message : "");
#else
    std::ofstream out("C:\\ThreeBrowser\\host\\native.log", std::ios::app);
    if (out) {
        out << message << '\n';
    }
#endif
}

void setError(const char* message) {
    std::lock_guard<std::mutex> lock(g.errMu);
    g.lastError = message ? message : "";
    if (message && message[0] &&
        std::strcmp(message, "invalid handle") != 0 &&
        std::strcmp(message, "handle is not a scene object") != 0) {
        logLine(message);
    }
}

void markDirty() {
    g.sceneDirty.store(true, std::memory_order_relaxed);
    g.cv.notify_one();
}

void ensureWorker() {
    std::lock_guard<std::mutex> lock(g.mu);
    if (g.workerStarted) {
        return;
    }
#if defined(__ANDROID__)
    throw std::runtime_error("Android render context is not attached");
#else
    g.stop = false;
    g.worker = std::thread(workerMain);
    g.workerStarted = true;
#endif
}

void onWorkerAsync(std::function<void()> fn) {
    ensureWorker();
    {
        std::lock_guard<std::mutex> lock(g.mu);
        if (g.stop) {
            return;
        }
        g.jobs.emplace_back([fn = std::move(fn)] {
            fn();
            markDirty();
        });
    }
    g.cv.notify_one();
#if defined(__ANDROID__)
    androidWakeWorker();
#endif
}

void resetIds() {
    g.next = 1;
    g.comNext = Runtime::comIdBase;
}

uint32_t insert(Slot slot) {
    if (g.comNext < Runtime::comIdBase) {
        g.comNext = Runtime::comIdBase;
    }
    while (g.slots.find(g.comNext) != g.slots.end()) {
        ++g.comNext;
    }
    const uint32_t id = g.comNext++;
    g.slots[id] = std::move(slot);
    return id;
}

uint32_t insertAt(uint32_t id, Slot slot) {
    if (id == 0) {
        setError("insertAt id 0");
        return 0;
    }
    g.slots[id] = std::move(slot);
    if (id < Runtime::comIdBase && id >= g.next) {
        g.next = id + 1;
    }
    return id;
}

Slot* findSlot(uint32_t id) {
    auto it = g.slots.find(id);
    if (it == g.slots.end()) {
        return nullptr;
    }
    return &it->second;
}

Slot* getSlot(uint32_t id) {
    Slot* slot = findSlot(id);
    if (!slot) {
        setError("invalid handle");
        return nullptr;
    }
    return slot;
}

void destroySlot(uint32_t id) {
    auto it = g.slots.find(id);
    if (it == g.slots.end()) {
        return;
    }
    Slot& slot = it->second;
    if (slot.object) {
        if (Object3D* parent = slot.object->parent) {
            parent->remove(*slot.object);
        }
    }
    if (slot.geometry) {
        slot.geometry->dispose();
    }
    if (slot.material) {
        slot.material->dispose();
    }
    if (slot.texture) {
        slot.texture->dispose();
    }
    if (slot.renderTarget) {
        slot.renderTarget->dispose();
    }
    g.slots.erase(it);
    markDirty();
}

Object3D* findObject(uint32_t id) {
    Slot* slot = findSlot(id);
    if (!slot || !slot->object) {
        return nullptr;
    }
    return slot->object.get();
}

Object3D* asObject(uint32_t id) {
    Object3D* object = findObject(id);
    if (!object) {
        setError("handle is not a scene object");
        return nullptr;
    }
    return object;
}

}// namespace tn
