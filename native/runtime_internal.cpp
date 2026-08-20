#include "runtime_internal.hpp"

#include <fstream>

namespace tn {

Runtime g;

void logLine(const char* message) {
    std::ofstream out("C:\\ThreeBrowser\\host\\native.log", std::ios::app);
    if (out) {
        out << message << '\n';
    }
}

void setError(const char* message) {
    std::lock_guard<std::mutex> lock(g.errMu);
    g.lastError = message ? message : "";
    if (message && message[0]) {
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
    g.stop = false;
    g.worker = std::thread(workerMain);
    g.workerStarted = true;
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
}

uint32_t insert(Slot slot) {
    const uint32_t id = g.next++;
    g.slots[id] = std::move(slot);
    return id;
}

uint32_t insertAt(uint32_t id, Slot slot) {
    if (id == 0) {
        setError("insertAt id 0");
        return 0;
    }
    g.slots[id] = std::move(slot);
    if (id >= g.next) {
        g.next = id + 1;
    }
    return id;
}

Slot* getSlot(uint32_t id) {
    auto it = g.slots.find(id);
    if (it == g.slots.end()) {
        setError("invalid handle");
        return nullptr;
    }
    return &it->second;
}

Object3D* asObject(uint32_t id) {
    Slot* slot = getSlot(id);
    if (!slot || !slot->object) {
        setError("handle is not a scene object");
        return nullptr;
    }
    return slot->object.get();
}

}// namespace tn
