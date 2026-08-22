#pragma once

#include <cstdint>
#include <string>

struct StreamlineVulkanContext {
    void* instance{};
    void* physicalDevice{};
    void* device{};
    void* queue{};
    uint32_t queueFamilyIndex{};
    uint32_t queueIndex{};
};

struct StreamlineCapabilities {
    bool runtimePresent{};
    bool initialized{};
    bool vulkanAttached{};
    bool dlssSuperResolution{};
    bool dlssFrameGeneration{};
    bool dlssRayReconstruction{};
    bool reflex{};
    std::string status;
};

bool streamlinePrepare();
bool streamlineAttachVulkan(const StreamlineVulkanContext& context);
StreamlineCapabilities streamlineCapabilities();
bool streamlineSetReflexMode(int mode);
int streamlineReflexMode();
void streamlineFrameBegin(uint32_t frameIndex);
void streamlineSimulationEnd();
void streamlineRenderSubmitBegin();
void streamlineRenderSubmitEnd();
void streamlinePresentBegin();
void streamlinePresentEnd();
void streamlineShutdown();
