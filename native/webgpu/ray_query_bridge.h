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

enum class RayQueryPipelineProfile : uint32_t {
    LightingV1 = 1,
    ReflectionsV1 = 2,
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
    // xyz points from the shaded surface toward the directional light; w is
    // the legacy visibility-intensity multiplier.
    float directionalLightDirectionIntensity[4]{};
    float directionalVisibilityStrength{};
    float aoStrength{};
    float aoRadius{};
    float directionalAngularRadius{};
    float maxDistance{};
    float rayBias{};
    uint32_t directionalSampleCount{};
    uint32_t aoSampleCount{};
    uint32_t frameIndex{};
    uint32_t pipelineHandle{};
    // bit 0: reverse/inverted depth (background is zero instead of one).
    uint32_t flags{};
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
    uint32_t pipelineHandle{};
};

bool rayQueryBridgeAttachVulkan(const RayQueryVulkanContext& context);
RayQueryBridgeCapabilities rayQueryBridgeCapabilities();

bool rayQueryBridgeCreatePipeline(uint32_t handle,
                                  RayQueryPipelineProfile profile,
                                  const uint32_t* spirvWords,
                                  std::size_t wordCount,
                                  const char* entryPoint);
bool rayQueryBridgeDestroyPipeline(uint32_t handle);
void rayQueryBridgeResetPipelines();

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
