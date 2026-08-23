#pragma once

#include <cstddef>
#include <cstdint>

// Native Vulkan ray-query bridge owned by the WebGPU runtime.  The bridge does
// not create a second Vulkan device or submit work outside WebGPU.  It borrows
// wgpu-native's Vulkan objects and records all AS builds / lighting dispatches
// into the VkCommandBuffer supplied by
// wgpuCommandEncoderWithNativeVulkanCommandBuffer.

struct RayQueryVulkanContext {
    void* instance{};
    void* physicalDevice{};
    void* device{};
    void* queue{};
    uint32_t queueFamilyIndex{};
    uint32_t queueIndex{};
    bool webgpuRayQueryFeatureEnabled{};
};

struct RayQueryBridgeCapabilities {
    bool vulkanAttached{};
    bool webgpuFeatureEnabled{};
    bool accelerationStructureSupported{};
    bool rayQuerySupported{};
    bool pipelineReady{};
    bool sceneReady{};
    uint32_t triangleCount{};
    uint64_t buildCount{};
    uint64_t evaluationCount{};
    uint64_t failureCount{};
    const char* status{};
};

struct RayQueryLightingFrame {
    void* commandBuffer{};
    void* colorImage{};
    uint32_t colorLayout{};
    void* depthImage{};
    uint32_t depthLayout{};
    uint32_t width{};
    uint32_t height{};
    float inverseViewProjection[16]{};
    float cameraPosition[4]{};
    // xyz points from the shaded surface toward the sun; w is intensity.
    float sunDirectionIntensity[4]{};
    // shadow strength, AO strength, AO radius; fourth input is retained for
    // protocol compatibility (the native pass uses a bounded ray distance).
    float parameters[4]{};
    // bit 0: reverse/inverted depth (background is zero instead of one).
    uint32_t flags{};
    // time, mean surface Y, caustic strength, water index of refraction.
    float water[4]{};
};

struct RayQueryReflectionFrame {
    void* commandBuffer{};
    void* sourceColorImage{};
    uint32_t sourceColorLayout{};
    void* outputColorImage{};
    uint32_t outputColorLayout{};
    void* depthImage{};
    uint32_t depthLayout{};
    void* normalRoughnessImage{};
    uint32_t normalRoughnessLayout{};
    void* specularAlbedoImage{};
    uint32_t specularAlbedoLayout{};
    uint32_t width{};
    uint32_t height{};
    float inverseViewProjection[16]{};
    float cameraPosition[4]{};
    // reflection strength, maximum distance, ray-origin bias, roughness cutoff.
    float parameters[4]{};
    // linear environment RGB and intensity for reflection misses.
    float environment[4]{};
    // bit 0: reverse/inverted depth; bit 1: include frame index in sample jitter.
    uint32_t flags{};
    uint32_t frameIndex{};
};

bool rayQueryBridgeAttachVulkan(const RayQueryVulkanContext& context);
RayQueryBridgeCapabilities rayQueryBridgeCapabilities();

void rayQueryBridgeSceneBegin();
bool rayQueryBridgeSetPositions(const float* xyz, std::size_t vertexCount);
bool rayQueryBridgeSetIndices(const uint32_t* indices, std::size_t indexCount);
bool rayQueryBridgeSetTriangleRadiance(const float* rgba,
                                      std::size_t triangleCount);
bool rayQueryBridgeSetTriangleSurface(const float* albedoRoughness,
                                     std::size_t triangleCount);
bool rayQueryBridgeSetStaticLights(const float* lightRecords,
                                   std::size_t lightCount);
bool rayQueryBridgeCommit(void* commandBuffer);
void rayQueryBridgeDestroyScene();

bool rayQueryBridgeEvaluate(const RayQueryLightingFrame& frame);
bool rayQueryBridgeEvaluateReflections(const RayQueryReflectionFrame& frame);
void rayQueryBridgeForgetImage(void* image);
void rayQueryBridgeShutdown();
