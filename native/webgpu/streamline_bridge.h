#pragma once

#include <cstdint>
#include <array>
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
    bool dlssNeuralRendering{};
    bool dlssNeuralRenderingFunctionsLoaded{};
    bool reflex{};
    std::string status;
};

enum class StreamlineDLSSMode : uint32_t {
    Off = 0,
    MaxPerformance = 1,
    Balanced = 2,
    MaxQuality = 3,
    UltraPerformance = 4,
    UltraQuality = 5,
    DLAA = 6,
};

struct StreamlineDLSSOptions {
    StreamlineDLSSMode mode{StreamlineDLSSMode::Off};
    uint32_t outputWidth{};
    uint32_t outputHeight{};
    float preExposure{1.0f};
    float exposureScale{1.0f};
    bool colorBuffersHDR{true};
    bool useAutoExposure{};
    bool alphaUpscaling{};
};

struct StreamlineDLSSOptimalSettings {
    uint32_t optimalRenderWidth{};
    uint32_t optimalRenderHeight{};
    uint32_t renderWidthMin{};
    uint32_t renderHeightMin{};
    uint32_t renderWidthMax{};
    uint32_t renderHeightMax{};
    float optimalSharpness{};
};

struct StreamlineVulkanResource {
    void* image{};
    uint32_t width{};
    uint32_t height{};
    uint32_t format{};
    uint32_t layout{};
    uint32_t usage{};
    uint32_t aspectMask{};
    uint32_t mipLevels{1};
    uint32_t arrayLayers{1};
    uint32_t left{};
    uint32_t top{};
    uint32_t extentWidth{};
    uint32_t extentHeight{};
};

struct StreamlineFrameConstants {
    std::array<float, 16> cameraViewToClip{};
    std::array<float, 16> clipToCameraView{};
    std::array<float, 16> clipToLensClip{};
    std::array<float, 16> clipToPrevClip{};
    std::array<float, 16> prevClipToClip{};
    std::array<float, 2> jitterOffset{};
    std::array<float, 2> motionVectorScale{1.0f, 1.0f};
    std::array<float, 2> cameraPinholeOffset{};
    std::array<float, 3> cameraPosition{};
    std::array<float, 3> cameraUp{0.0f, 1.0f, 0.0f};
    std::array<float, 3> cameraRight{1.0f, 0.0f, 0.0f};
    std::array<float, 3> cameraForward{0.0f, 0.0f, -1.0f};
    float cameraNear{0.1f};
    float cameraFar{1000.0f};
    float cameraFov{1.0471975512f};
    float cameraAspectRatio{1.0f};
    bool depthInverted{};
    bool cameraMotionIncluded{true};
    bool motionVectors3D{};
    bool reset{};
    bool orthographicProjection{};
    bool motionVectorsDilated{};
    bool motionVectorsJittered{};
};

struct StreamlineDLSSFrame {
    uint32_t viewport{};
    void* commandBuffer{};
    StreamlineVulkanResource colorInput;
    StreamlineVulkanResource colorOutput;
    StreamlineVulkanResource depth;
    StreamlineVulkanResource motionVectors;
    StreamlineVulkanResource exposure;
    bool hasExposure{};
    StreamlineFrameConstants constants;
};

// DLSS Neural Rendering consumes full-resolution HDR color, depth, dense
// motion vectors, and an optional per-pixel control mask. Input and output
// images must be distinct and remain valid through evaluation.
struct StreamlineDLSSNROptions {
    bool enabled{true};
    float intensity{1.0f};
    float localToneStrength{1.0f};
    float localStructureStrength{1.0f};
    float globalToneStrength{1.0f};
    uint32_t style{};
    uint32_t renderPreset{};
    bool useAutoMask{};
    float skinStructureStrength{1.0f};
    StreamlineDLSSMode performanceMode{StreamlineDLSSMode::DLAA};
};

struct StreamlineDLSSNRFrame {
    uint32_t viewport{};
    void* commandBuffer{};
    StreamlineVulkanResource colorInput;
    StreamlineVulkanResource colorOutput;
    StreamlineVulkanResource depth;
    StreamlineVulkanResource motionVectors;
    StreamlineVulkanResource controlMask;
    bool hasControlMask{};
    StreamlineDLSSNROptions options;
    StreamlineFrameConstants constants;
};

// DLSS Ray Reconstruction is a denoising/upscaling pass, not a ray tracer.
// The caller must provide genuine noisy ray-traced lighting plus the complete
// material/geometry guides required by Streamline.  normalRoughness contains
// packed normal.xyz + linear roughness.w when normalRoughnessPacked is true;
// otherwise it contains normals and the separate roughness resource is used.
// Exactly one of specularMotionVectors and specularHitDistance must be present.
struct StreamlineRayReconstructionFrame {
    uint32_t viewport{};
    void* commandBuffer{};
    StreamlineVulkanResource noisyColor;
    StreamlineVulkanResource colorOutput;
    StreamlineVulkanResource depth;
    StreamlineVulkanResource motionVectors;
    StreamlineVulkanResource diffuseAlbedo;
    StreamlineVulkanResource specularAlbedo;
    StreamlineVulkanResource normalRoughness;
    StreamlineVulkanResource roughness;
    bool normalRoughnessPacked{true};
    bool hasRoughness{};
    StreamlineVulkanResource specularMotionVectors;
    StreamlineVulkanResource specularHitDistance;
    bool hasSpecularMotionVectors{};
    bool hasSpecularHitDistance{};
    std::array<float, 16> worldToCameraView{};
    std::array<float, 16> cameraViewToWorld{};
    StreamlineFrameConstants constants;
};

// DLSS Frame Generation consumes the rendered scene before UI composition at
// Present time.  These resources must remain valid until that Present has
// completed; unlike D3D, Streamline cannot retain Vulkan images for the host.
struct StreamlineFrameGenerationFrame {
    uint32_t viewport{};
    void* commandBuffer{};
    StreamlineVulkanResource hudlessColor;
    StreamlineVulkanResource depth;
    StreamlineVulkanResource motionVectors;
    StreamlineVulkanResource ui;
    bool hasUi{};
    bool uiAlphaOnly{};
    uint32_t backbufferWidth{};
    uint32_t backbufferHeight{};
    uint32_t backbufferFormat{};
    uint32_t framesToGenerate{1};
    StreamlineFrameConstants constants;
};

struct StreamlineFeatureState {
    bool dlssSupported{};
    bool dlssFunctionsLoaded{};
    bool dlssRequested{};
    bool dlssConfigured{};
    bool dlssActive{};
    StreamlineDLSSMode dlssMode{StreamlineDLSSMode::Off};
    uint32_t renderWidth{};
    uint32_t renderHeight{};
    uint32_t outputWidth{};
    uint32_t outputHeight{};
    uint64_t estimatedVramBytes{};
    uint64_t dlssEvaluationCount{};
    uint64_t dlssFailureCount{};
    int32_t dlssLastResult{};
    std::string dlssReason;
    bool frameGenerationSupported{};
    bool frameGenerationFunctionsLoaded{};
    bool frameGenerationRequested{};
    bool frameGenerationConfigured{};
    bool frameGenerationActive{};
    uint32_t frameGenerationFramesToGenerate{};
    uint32_t frameGenerationFramesToGenerateMax{};
    uint32_t frameGenerationLastFramesPresented{};
    uint64_t frameGenerationPresentedFrameCount{};
    uint64_t frameGenerationFailureCount{};
    uint64_t frameGenerationEstimatedVramBytes{};
    int32_t frameGenerationLastResult{};
    uint32_t frameGenerationLastStatus{};
    std::string frameGenerationReason;
    bool rayReconstructionSupported{};
    bool rayReconstructionFunctionsLoaded{};
    bool rayReconstructionRequested{};
    bool rayReconstructionConfigured{};
    bool rayReconstructionActive{};
    uint64_t rayReconstructionEvaluationCount{};
    uint64_t rayReconstructionFailureCount{};
    uint64_t rayReconstructionEstimatedVramBytes{};
    int32_t rayReconstructionLastResult{};
    std::string rayReconstructionReason;
    bool neuralRenderingSupported{};
    bool neuralRenderingFunctionsLoaded{};
    bool neuralRenderingRequested{};
    bool neuralRenderingConfigured{};
    bool neuralRenderingActive{};
    uint64_t neuralRenderingEvaluationCount{};
    uint64_t neuralRenderingFailureCount{};
    int32_t neuralRenderingLastResult{};
    std::string neuralRenderingReason;
};

bool streamlinePrepare();
bool streamlineAttachVulkan(const StreamlineVulkanContext& context);
StreamlineCapabilities streamlineCapabilities();
bool streamlineSetReflexMode(int mode);
int streamlineReflexMode();
bool streamlineRequestFeatures(const StreamlineDLSSOptions& dlss,
                               bool requestFrameGeneration,
                               bool requestRayReconstruction);
bool streamlineDLSSGetOptimalSettings(const StreamlineDLSSOptions& options,
                                      StreamlineDLSSOptimalSettings& settings);
bool streamlineDLSSEvaluate(const StreamlineDLSSFrame& frame);
bool streamlineDLSSNREvaluate(const StreamlineDLSSNRFrame& frame);
bool streamlineRayReconstructionEvaluate(const StreamlineRayReconstructionFrame& frame);
bool streamlineFrameGenerationTag(const StreamlineFrameGenerationFrame& frame);
void streamlineFrameGenerationBeforePresent(bool inputsMayBePresented);
void streamlineFrameGenerationAfterPresent();
void streamlineSuspendFrameGeneration(const char* reason, bool releaseResources);
void streamlineReleaseViewport(uint32_t viewport);
void streamlineForgetVulkanImage(void* image);
StreamlineFeatureState streamlineFeatureState();
void streamlineFrameBegin(uint32_t frameIndex);
void streamlineSimulationEnd();
void streamlineRenderSubmitBegin();
void streamlineRenderSubmitEnd();
void streamlinePresentBegin();
void streamlinePresentEnd();
void streamlineShutdown();
