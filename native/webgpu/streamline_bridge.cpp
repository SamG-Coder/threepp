#include "streamline_bridge.h"

#if defined(THREEBROWSER_STREAMLINE)
#include <windows.h>

#include <algorithm>
#include <array>
#include <cstring>
#include <filesystem>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <unordered_set>
#include <string_view>
#include <vector>

#include <vulkan/vulkan.h>
#include <sl.h>
#include <sl_dlss.h>
#include <sl_dlss_g.h>
#include <sl_dlss_d.h>
#if defined(THREEBROWSER_DLSS_NR_SDK_HEADER)
#include <sl_dlss_nr.h>
#endif
#include <sl_helpers_vk.h>
#include <sl_pcl.h>
#include <sl_reflex.h>

namespace {

#if defined(THREEBROWSER_DLSS_NEURAL_RENDERING)
#if defined(THREEBROWSER_DLSS_NR_SDK_HEADER)
constexpr sl::Feature kFeatureDLSSNR = sl::kFeatureDLSS_NR;
using DLSSNeuralRenderingOptions = sl::DLSSNROptions;
#elif defined(THREEBROWSER_DLSS_NR_PREVIEW_ABI)
// The signed preview plug-in identifies Neural Rendering as feature 1004. This
// ABI is compiled only for an explicit THREEBROWSER_DLSS5_MODE=ON build; AUTO
// requires a compatible public SDK header and never reaches this definition.
constexpr sl::Feature kFeatureDLSSNR = 1004;

struct DLSSNeuralRenderingOptions : sl::BaseStructure {
    DLSSNeuralRenderingOptions()
        : sl::BaseStructure(
              sl::StructType({0x29dfdfe0, 0x273a, 0x4e72,
                              {0xb4, 0x92, 0x2d, 0xc8, 0x23, 0xd5, 0xb1, 0xad}}),
              sl::kStructVersion3) {}

    uint32_t mode{1};
    float intensity{1.0f};
    float localToneStrength{1.0f};
    float localStructureStrength{1.0f};
    float globalToneStrength{1.0f};
    uint32_t style{};
    uint32_t renderPreset{};
    bool useAutoMask{};
    float skinStructureStrength{1.0f};
    uint32_t performanceMode{static_cast<uint32_t>(StreamlineDLSSMode::DLAA)};
};

using PFun_slDLSSNRSetOptions = sl::Result(
    const sl::ViewportHandle&, const DLSSNeuralRenderingOptions&);
#else
#error "DLSS Neural Rendering requires a verified SDK header or explicit preview ABI"
#endif

static_assert(sizeof(DLSSNeuralRenderingOptions) == 0x48,
              "DLSS Neural Rendering options ABI must remain 72 bytes");
#endif

struct Bridge {
    std::mutex mutex;
    HMODULE module{};
    PFun_slInit* init{};
    PFun_slShutdown* shutdown{};
    PFun_slSetVulkanInfo* setVulkanInfo{};
    PFun_slIsFeatureSupported* isFeatureSupported{};
    PFun_slGetFeatureFunction* getFeatureFunction{};
    PFun_slGetNewFrameToken* getNewFrameToken{};
    PFun_slEvaluateFeature* evaluateFeature{};
    PFun_slAllocateResources* allocateResources{};
    PFun_slFreeResources* freeResources{};
    PFun_slSetTagForFrame* setTagForFrame{};
    PFun_slSetConstants* setConstants{};
    PFun_slDLSSGetOptimalSettings* dlssGetOptimalSettings{};
    PFun_slDLSSGetState* dlssGetState{};
    PFun_slDLSSSetOptions* dlssSetOptions{};
    PFun_slDLSSGGetState* dlssGGetState{};
    PFun_slDLSSGSetOptions* dlssGSetOptions{};
    PFun_slDLSSDGetOptimalSettings* dlssDGetOptimalSettings{};
    PFun_slDLSSDGetState* dlssDGetState{};
    PFun_slDLSSDSetOptions* dlssDSetOptions{};
#if defined(THREEBROWSER_DLSS_NEURAL_RENDERING)
    PFun_slDLSSNRSetOptions* dlssNRSetOptions{};
#endif
    PFun_slReflexSetOptions* reflexSetOptions{};
    PFun_slReflexSleep* reflexSleep{};
    PFun_slPCLSetMarker* pclSetMarker{};
    sl::FrameToken* frameToken{};
    VkDevice vkDevice{};
    PFN_vkCreateImageView vkCreateImageView{};
    PFN_vkDestroyImageView vkDestroyImageView{};
    PFN_vkDeviceWaitIdle vkDeviceWaitIdle{};
    std::unordered_map<void*, VkImageView> imageViews;
    std::unordered_set<void*> frameGenerationImages;
    std::unordered_set<uint32_t> rayReconstructionViewports;
#if defined(THREEBROWSER_DLSS_NEURAL_RENDERING)
    std::unordered_set<uint32_t> neuralRenderingViewports;
    std::unordered_set<uint32_t> neuralRenderingActiveViewports;
#endif
    int reflexMode{1};
    StreamlineCapabilities capabilities{};
    StreamlineFeatureState features{};
    StreamlineDLSSOptions dlssOptions{};
    sl::DLSSDOptions rayReconstructionOptions{};
    sl::DLSSGOptions frameGenerationOptions{};
    uint32_t frameGenerationViewport{};
    bool frameGenerationTaggedForPresent{};
    bool constantsSetForFrame{};
    uint32_t constantsViewport{};
};

Bridge g;

std::filesystem::path moduleDirectory() {
    HMODULE self{};
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                           GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       reinterpret_cast<LPCWSTR>(&streamlinePrepare), &self);
    std::array<wchar_t, 32768> path{};
    const DWORD length = GetModuleFileNameW(self, path.data(), static_cast<DWORD>(path.size()));
    if (!length) return {};

    // Node loads native addons through an extended-length path. Streamline's
    // embedded NVIDIA signature verifier expects a regular absolute Win32 path
    // and rejects otherwise valid signed plugins when given the `\\?\` form.
    std::wstring normalized(path.data(), length);
    constexpr std::wstring_view extendedUnc = L"\\\\?\\UNC\\";
    constexpr std::wstring_view extendedLocal = L"\\\\?\\";
    if (normalized.starts_with(extendedUnc)) {
        normalized = L"\\\\" + normalized.substr(extendedUnc.size());
    } else if (normalized.starts_with(extendedLocal)) {
        normalized.erase(0, extendedLocal.size());
    }
    return std::filesystem::path(normalized).parent_path();
}

template <typename T>
T* importFunction(HMODULE module, const char* name) {
    return reinterpret_cast<T*>(GetProcAddress(module, name));
}

sl::Result supportResult(sl::Feature feature, void* physicalDevice) {
    sl::AdapterInfo adapter{};
    adapter.vkPhysicalDevice = physicalDevice;
    return g.isFeatureSupported ? g.isFeatureSupported(feature, adapter)
                                : sl::Result::eErrorMissingProxy;
}

template <typename T>
bool importFeatureFunction(sl::Feature feature, const char* name, T*& function) {
    void* raw{};
    if (!g.getFeatureFunction ||
        g.getFeatureFunction(feature, name, raw) != sl::Result::eOk || !raw) {
        function = nullptr;
        return false;
    }
    function = reinterpret_cast<T*>(raw);
    return true;
}

void setMarker(sl::PCLMarker marker) {
    if (g.frameToken && g.pclSetMarker) g.pclSetMarker(marker, *g.frameToken);
}

sl::Boolean boolean(bool value) {
    return value ? sl::Boolean::eTrue : sl::Boolean::eFalse;
}

sl::DLSSMode dlssMode(StreamlineDLSSMode mode) {
    const uint32_t value = static_cast<uint32_t>(mode);
    return value < static_cast<uint32_t>(sl::DLSSMode::eCount)
               ? static_cast<sl::DLSSMode>(value)
               : sl::DLSSMode::eOff;
}

void copyMatrix(sl::float4x4& target, const std::array<float, 16>& source);

sl::DLSSOptions makeDLSSOptions(const StreamlineDLSSOptions& options) {
    sl::DLSSOptions out{};
    out.mode = dlssMode(options.mode);
    out.outputWidth = options.outputWidth;
    out.outputHeight = options.outputHeight;
    out.preExposure = options.preExposure;
    out.exposureScale = options.exposureScale;
    out.colorBuffersHDR = boolean(options.colorBuffersHDR);
    out.useAutoExposure = boolean(options.useAutoExposure);
    out.alphaUpscalingEnabled = boolean(options.alphaUpscaling);
    return out;
}

sl::DLSSDOptions makeRayReconstructionOptions(
    const StreamlineDLSSOptions& options,
    const StreamlineRayReconstructionFrame& frame) {
    sl::DLSSDOptions out{};
    out.mode = dlssMode(options.mode);
    out.outputWidth = options.outputWidth;
    out.outputHeight = options.outputHeight;
    out.preExposure = options.preExposure;
    out.exposureScale = options.exposureScale;
    // DLSS-RR only accepts noisy HDR input.  This is deliberately forced on
    // after streamlineRequestFeatures has rejected non-HDR requests.
    out.colorBuffersHDR = sl::Boolean::eTrue;
    out.normalRoughnessMode = frame.normalRoughnessPacked
        ? sl::DLSSDNormalRoughnessMode::ePacked
        : sl::DLSSDNormalRoughnessMode::eUnpacked;
    out.alphaUpscalingEnabled = boolean(options.alphaUpscaling);
    copyMatrix(out.worldToCameraView, frame.worldToCameraView);
    copyMatrix(out.cameraViewToWorld, frame.cameraViewToWorld);
    return out;
}

void copyMatrix(sl::float4x4& target, const std::array<float, 16>& source) {
    static_assert(sizeof(target) == sizeof(float) * 16);
    std::memcpy(&target, source.data(), sizeof(target));
}

sl::Constants makeConstants(const StreamlineFrameConstants& source) {
    sl::Constants out{};
    copyMatrix(out.cameraViewToClip, source.cameraViewToClip);
    copyMatrix(out.clipToCameraView, source.clipToCameraView);
    copyMatrix(out.clipToLensClip, source.clipToLensClip);
    copyMatrix(out.clipToPrevClip, source.clipToPrevClip);
    copyMatrix(out.prevClipToClip, source.prevClipToClip);
    out.jitterOffset = {source.jitterOffset[0], source.jitterOffset[1]};
    out.mvecScale = {source.motionVectorScale[0], source.motionVectorScale[1]};
    out.cameraPinholeOffset = {source.cameraPinholeOffset[0], source.cameraPinholeOffset[1]};
    out.cameraPos = {source.cameraPosition[0], source.cameraPosition[1], source.cameraPosition[2]};
    out.cameraUp = {source.cameraUp[0], source.cameraUp[1], source.cameraUp[2]};
    out.cameraRight = {source.cameraRight[0], source.cameraRight[1], source.cameraRight[2]};
    out.cameraFwd = {source.cameraForward[0], source.cameraForward[1], source.cameraForward[2]};
    out.cameraNear = source.cameraNear;
    out.cameraFar = source.cameraFar;
    out.cameraFOV = source.cameraFov;
    out.cameraAspectRatio = source.cameraAspectRatio;
    out.depthInverted = boolean(source.depthInverted);
    out.cameraMotionIncluded = boolean(source.cameraMotionIncluded);
    out.motionVectors3D = boolean(source.motionVectors3D);
    out.reset = boolean(source.reset);
    out.orthographicProjection = boolean(source.orthographicProjection);
    out.motionVectorsDilated = boolean(source.motionVectorsDilated);
    out.motionVectorsJittered = boolean(source.motionVectorsJittered);
    return out;
}

VkImageView imageView(const StreamlineVulkanResource& resource, std::string& reason) {
    if (!resource.image || !resource.width || !resource.height || !resource.format ||
        !resource.aspectMask || !resource.mipLevels || !resource.arrayLayers) {
        reason = "DLSS resource metadata is incomplete";
        return VK_NULL_HANDLE;
    }
    if (!g.vkDevice || !g.vkCreateImageView) {
        reason = "Vulkan image-view functions are unavailable";
        return VK_NULL_HANDLE;
    }
    const auto existing = g.imageViews.find(resource.image);
    if (existing != g.imageViews.end()) return existing->second;

    VkImageViewCreateInfo info{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
    info.image = reinterpret_cast<VkImage>(resource.image);
    info.viewType = resource.arrayLayers > 1 ? VK_IMAGE_VIEW_TYPE_2D_ARRAY : VK_IMAGE_VIEW_TYPE_2D;
    info.format = static_cast<VkFormat>(resource.format);
    info.components = {VK_COMPONENT_SWIZZLE_IDENTITY, VK_COMPONENT_SWIZZLE_IDENTITY,
                       VK_COMPONENT_SWIZZLE_IDENTITY, VK_COMPONENT_SWIZZLE_IDENTITY};
    info.subresourceRange.aspectMask = resource.aspectMask;
    info.subresourceRange.baseMipLevel = 0;
    info.subresourceRange.levelCount = resource.mipLevels;
    info.subresourceRange.baseArrayLayer = 0;
    info.subresourceRange.layerCount = resource.arrayLayers;
    VkImageView view{};
    const VkResult result = g.vkCreateImageView(g.vkDevice, &info, nullptr, &view);
    if (result != VK_SUCCESS || !view) {
        reason = "vkCreateImageView failed (" + std::to_string(static_cast<int>(result)) + ")";
        return VK_NULL_HANDLE;
    }
    g.imageViews.emplace(resource.image, view);
    return view;
}

struct TaggedResource {
    sl::Resource resource;
    sl::SubresourceRange range{};
    sl::Extent extent{};
    sl::ResourceTag tag;

    TaggedResource(const StreamlineVulkanResource& source, VkImageView view,
                   sl::BufferType type,
                   sl::ResourceLifecycle lifecycle =
                       sl::ResourceLifecycle::eValidUntilEvaluate)
        : resource(sl::ResourceType::eTex2d, source.image, nullptr,
                   reinterpret_cast<void*>(view), source.layout),
          tag(&resource, type, lifecycle, &extent) {
        resource.width = source.width;
        resource.height = source.height;
        resource.nativeFormat = source.format;
        resource.mipLevels = source.mipLevels;
        resource.arrayLayers = source.arrayLayers;
        resource.flags = 0;
        resource.usage = source.usage;
        range.aspectMask = source.aspectMask;
        range.baseMipLevel = 0;
        range.levelCount = source.mipLevels;
        range.baseArrayLayer = 0;
        range.layerCount = source.arrayLayers;
        resource.next = &range;
        extent.left = source.left;
        extent.top = source.top;
        extent.width = source.extentWidth ? source.extentWidth : source.width;
        extent.height = source.extentHeight ? source.extentHeight : source.height;
    }
};

void setDLSSFailure(sl::Result result, std::string reason) {
    g.features.dlssActive = false;
    g.features.dlssLastResult = static_cast<int32_t>(result);
    ++g.features.dlssFailureCount;
    g.features.dlssReason = std::move(reason);
}

void setRayReconstructionFailure(sl::Result result, std::string reason) {
    g.features.rayReconstructionActive = false;
    g.features.rayReconstructionLastResult = static_cast<int32_t>(result);
    ++g.features.rayReconstructionFailureCount;
    g.features.rayReconstructionReason = std::move(reason);
}

#if defined(THREEBROWSER_DLSS_NEURAL_RENDERING)
void setNeuralRenderingFailure(uint32_t viewport, sl::Result result,
                               std::string reason) {
    g.neuralRenderingActiveViewports.erase(viewport);
    g.features.neuralRenderingActive =
        !g.neuralRenderingActiveViewports.empty();
    g.features.neuralRenderingLastResult = static_cast<int32_t>(result);
    ++g.features.neuralRenderingFailureCount;
    g.features.neuralRenderingReason = std::move(reason);
}
#endif

sl::Result setConstantsForFrame(const StreamlineFrameConstants& source,
                                uint32_t viewportValue) {
    if (!g.setConstants || !g.frameToken) return sl::Result::eErrorMissingInputParameter;
    if (g.constantsSetForFrame) {
        return g.constantsViewport == viewportValue
            ? sl::Result::eOk
            : sl::Result::eErrorInvalidParameter;
    }
    const sl::Result result = g.setConstants(
        makeConstants(source), *g.frameToken, sl::ViewportHandle(viewportValue));
    if (result == sl::Result::eOk) {
        g.constantsSetForFrame = true;
        g.constantsViewport = viewportValue;
    }
    return result;
}

void setFrameGenerationFailure(sl::Result result, uint32_t status, std::string reason) {
    g.features.frameGenerationConfigured = false;
    g.features.frameGenerationActive = false;
    g.features.frameGenerationLastResult = static_cast<int32_t>(result);
    g.features.frameGenerationLastStatus = status;
    ++g.features.frameGenerationFailureCount;
    g.features.frameGenerationReason = std::move(reason);
}

void suspendFrameGenerationLocked(const char* reason, bool releaseResources) {
    const sl::ViewportHandle viewport(g.frameGenerationViewport);
    sl::Result result = sl::Result::eOk;
    const bool hadFrameGenerationState = g.features.frameGenerationRequested ||
        g.features.frameGenerationConfigured || g.frameGenerationTaggedForPresent;
    if (hadFrameGenerationState && g.features.frameGenerationFunctionsLoaded &&
        g.dlssGSetOptions) {
        sl::DLSSGOptions options = g.frameGenerationOptions;
        options.mode = sl::DLSSGMode::eOff;
        options.flags = releaseResources
            ? sl::DLSSGFlags{}
            : sl::DLSSGFlags::eRetainResourcesWhenOff;
        result = g.dlssGSetOptions(viewport, options);
        if (releaseResources && g.freeResources) {
            g.freeResources(sl::kFeatureDLSS_G, viewport);
        }
    }
    if (g.vkDeviceWaitIdle && g.vkDevice &&
        (g.features.frameGenerationConfigured || g.frameGenerationTaggedForPresent)) {
        g.vkDeviceWaitIdle(g.vkDevice);
    }
    g.features.frameGenerationConfigured = false;
    g.features.frameGenerationActive = false;
    g.features.frameGenerationFramesToGenerate = 0;
    g.features.frameGenerationLastResult = static_cast<int32_t>(result);
    g.frameGenerationTaggedForPresent = false;
    g.frameGenerationImages.clear();
    if (result == sl::Result::eOk) {
        g.features.frameGenerationReason = reason ? reason : "Frame Generation is suspended";
    } else {
        ++g.features.frameGenerationFailureCount;
        g.features.frameGenerationReason = "slDLSSGSetOptions(eOff) failed (" +
            std::to_string(static_cast<int>(result)) + ")";
    }
}

} // namespace

bool streamlinePrepare() {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (g.capabilities.initialized) return true;

    const auto directory = moduleDirectory();
    const auto interposer = directory / L"sl.interposer.dll";
    g.module = LoadLibraryExW(interposer.c_str(), nullptr,
                              LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR |
                                  LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    g.capabilities.runtimePresent = g.module != nullptr;
    if (!g.module) {
        g.capabilities.status = "Streamline runtime is not installed beside three_webgpu.dll";
        return false;
    }

    g.init = importFunction<PFun_slInit>(g.module, "slInit");
    g.shutdown = importFunction<PFun_slShutdown>(g.module, "slShutdown");
    g.setVulkanInfo = importFunction<PFun_slSetVulkanInfo>(g.module, "slSetVulkanInfo");
    g.isFeatureSupported =
        importFunction<PFun_slIsFeatureSupported>(g.module, "slIsFeatureSupported");
    g.getFeatureFunction =
        importFunction<PFun_slGetFeatureFunction>(g.module, "slGetFeatureFunction");
    g.getNewFrameToken =
        importFunction<PFun_slGetNewFrameToken>(g.module, "slGetNewFrameToken");
    g.evaluateFeature =
        importFunction<PFun_slEvaluateFeature>(g.module, "slEvaluateFeature");
    g.allocateResources =
        importFunction<PFun_slAllocateResources>(g.module, "slAllocateResources");
    g.freeResources =
        importFunction<PFun_slFreeResources>(g.module, "slFreeResources");
    g.setTagForFrame =
        importFunction<PFun_slSetTagForFrame>(g.module, "slSetTagForFrame");
    g.setConstants =
        importFunction<PFun_slSetConstants>(g.module, "slSetConstants");
    if (!g.init || !g.shutdown || !g.setVulkanInfo || !g.isFeatureSupported ||
        !g.getFeatureFunction || !g.getNewFrameToken || !g.evaluateFeature ||
        !g.freeResources || !g.setTagForFrame || !g.setConstants) {
        g.capabilities.status = "Streamline core exports are incomplete";
        FreeLibrary(g.module);
        g.module = nullptr;
        return false;
    }

#if defined(THREEBROWSER_DLSS_NEURAL_RENDERING)
    static const std::array<sl::Feature, 6> features{
        sl::kFeatureDLSS, sl::kFeatureDLSS_G, sl::kFeatureDLSS_RR,
        kFeatureDLSSNR, sl::kFeatureReflex, sl::kFeaturePCL};
#else
    static const std::array<sl::Feature, 5> features{
        sl::kFeatureDLSS, sl::kFeatureDLSS_G, sl::kFeatureDLSS_RR,
        sl::kFeatureReflex, sl::kFeaturePCL};
#endif
    const std::wstring pluginPath = directory.wstring();
    const wchar_t* pluginPaths[] = {pluginPath.c_str()};
    sl::Preferences preferences{};
    preferences.pathsToPlugins = pluginPaths;
    preferences.numPathsToPlugins = 1;
    preferences.featuresToLoad = features.data();
    preferences.numFeaturesToLoad = static_cast<uint32_t>(features.size());
    preferences.flags = sl::PreferenceFlags::eDisableCLStateTracking |
                        sl::PreferenceFlags::eDisableDebugText |
                        sl::PreferenceFlags::eUseManualHooking |
                        sl::PreferenceFlags::eUseFrameBasedResourceTagging;
    preferences.engine = sl::EngineType::eCustom;
    preferences.engineVersion = "1.0";
    preferences.projectId = "6de62b87-219a-4c61-a73d-793bd79a7ed3";
    preferences.renderAPI = sl::RenderAPI::eVulkan;

    const sl::Result result = g.init(preferences, sl::kSDKVersion);
    if (result != sl::Result::eOk) {
        g.capabilities.status = "Streamline initialization failed (" +
                                std::to_string(static_cast<int>(result)) + ")";
        FreeLibrary(g.module);
        g.module = nullptr;
        return false;
    }
    g.capabilities.initialized = true;
    SetEnvironmentVariableW(L"THREEBROWSER_STREAMLINE_VULKAN", L"1");
    g.capabilities.status = "Streamline initialized; waiting for the Vulkan device";
    return true;
}

bool streamlineAttachVulkan(const StreamlineVulkanContext& context) {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (!g.capabilities.initialized) {
        if (g.capabilities.status.empty()) {
            g.capabilities.status = "Streamline was not initialized before Vulkan attachment";
        }
        return false;
    }
    if (!g.setVulkanInfo) {
        g.capabilities.status = "Streamline is missing slSetVulkanInfo";
        return false;
    }
    if (!context.instance || !context.physicalDevice || !context.device || !context.queue) {
        g.capabilities.status = "Native Vulkan handles missing:";
        if (!context.instance) g.capabilities.status += " instance";
        if (!context.physicalDevice) g.capabilities.status += " physical-device";
        if (!context.device) g.capabilities.status += " device";
        if (!context.queue) g.capabilities.status += " queue";
        return false;
    }

    sl::VulkanInfo info{};
    info.instance = reinterpret_cast<VkInstance>(context.instance);
    info.physicalDevice = reinterpret_cast<VkPhysicalDevice>(context.physicalDevice);
    info.device = reinterpret_cast<VkDevice>(context.device);
    info.computeQueueFamily = context.queueFamilyIndex;
    info.computeQueueIndex = context.queueIndex;
    info.graphicsQueueFamily = context.queueFamilyIndex;
    info.graphicsQueueIndex = context.queueIndex;
    info.opticalFlowQueueFamily = context.queueFamilyIndex;
    info.opticalFlowQueueIndex = context.queueIndex;

    // wgpu-native loads Vulkan through sl.interposer.dll when Streamline is active.
    // In that mode Streamline already owns instance/device creation and explicitly
    // requires integrations to skip slSetVulkanInfo.
    const bool usingVulkanProxies =
        GetEnvironmentVariableW(L"THREEBROWSER_STREAMLINE_VULKAN", nullptr, 0) != 0;
    if (!usingVulkanProxies) {
        const sl::Result result = g.setVulkanInfo(info);
        if (result != sl::Result::eOk) {
            g.capabilities.status = "Streamline rejected the Vulkan device (" +
                                    std::to_string(static_cast<int>(result)) + ")";
            return false;
        }
    }

    g.capabilities.vulkanAttached = true;
    const sl::Result dlss = supportResult(sl::kFeatureDLSS, context.physicalDevice);
    const sl::Result frameGeneration = supportResult(sl::kFeatureDLSS_G, context.physicalDevice);
    const sl::Result rayReconstruction = supportResult(sl::kFeatureDLSS_RR, context.physicalDevice);
#if defined(THREEBROWSER_DLSS_NEURAL_RENDERING)
    const sl::Result neuralRendering =
        supportResult(kFeatureDLSSNR, context.physicalDevice);
#else
    const sl::Result neuralRendering = sl::Result::eErrorFeatureNotSupported;
#endif
    const sl::Result reflex = supportResult(sl::kFeatureReflex, context.physicalDevice);
    g.capabilities.dlssSuperResolution = dlss == sl::Result::eOk;
    g.capabilities.dlssFrameGeneration = frameGeneration == sl::Result::eOk;
    g.capabilities.dlssRayReconstruction = rayReconstruction == sl::Result::eOk;
#if defined(THREEBROWSER_DLSS_NEURAL_RENDERING)
    g.capabilities.dlssNeuralRendering = neuralRendering == sl::Result::eOk;
    if (g.capabilities.dlssNeuralRendering) {
        g.capabilities.dlssNeuralRenderingFunctionsLoaded =
            importFeatureFunction(kFeatureDLSSNR, "slDLSSNRSetOptions",
                                  g.dlssNRSetOptions);
    }
#endif
    g.capabilities.reflex = reflex == sl::Result::eOk;
    g.features.dlssSupported = g.capabilities.dlssSuperResolution;
    g.features.frameGenerationSupported = g.capabilities.dlssFrameGeneration;
    g.features.rayReconstructionSupported = g.capabilities.dlssRayReconstruction;
    g.features.neuralRenderingSupported =
        g.capabilities.dlssNeuralRendering;
    g.features.neuralRenderingFunctionsLoaded =
        g.capabilities.dlssNeuralRenderingFunctionsLoaded;
#if defined(THREEBROWSER_DLSS_NEURAL_RENDERING)
    g.features.neuralRenderingReason =
        g.features.neuralRenderingSupported &&
                g.features.neuralRenderingFunctionsLoaded
            ? "DLSS Neural Rendering is available; no frame has been evaluated"
            : "DLSS Neural Rendering is unavailable on this adapter/runtime or its API is incomplete";
#else
    g.features.neuralRenderingReason =
        "DLSS Neural Rendering was not included in this build";
#endif

    if (g.capabilities.dlssSuperResolution) {
        g.features.dlssFunctionsLoaded =
            importFeatureFunction(sl::kFeatureDLSS, "slDLSSGetOptimalSettings",
                                  g.dlssGetOptimalSettings) &&
            importFeatureFunction(sl::kFeatureDLSS, "slDLSSGetState", g.dlssGetState) &&
            importFeatureFunction(sl::kFeatureDLSS, "slDLSSSetOptions", g.dlssSetOptions);
        g.features.dlssReason = g.features.dlssFunctionsLoaded
            ? "DLSS Super Resolution is available; no frame resources have been evaluated"
            : "DLSS Super Resolution plugin exports are incomplete";
    } else {
        g.features.dlssReason = "DLSS Super Resolution is not supported by this adapter/runtime";
    }
    if (g.capabilities.dlssFrameGeneration) {
        g.features.frameGenerationFunctionsLoaded =
            importFeatureFunction(sl::kFeatureDLSS_G, "slDLSSGGetState", g.dlssGGetState) &&
            importFeatureFunction(sl::kFeatureDLSS_G, "slDLSSGSetOptions", g.dlssGSetOptions);
    }
    g.features.frameGenerationReason = g.features.frameGenerationFunctionsLoaded
        ? "Frame Generation requires HUD-less color, motion/depth, UI and Reflex inputs"
        : "Frame Generation is unavailable or its plugin exports are incomplete";
    if (g.capabilities.dlssRayReconstruction) {
        g.features.rayReconstructionFunctionsLoaded =
            importFeatureFunction(sl::kFeatureDLSS_RR, "slDLSSDGetOptimalSettings",
                                  g.dlssDGetOptimalSettings) &&
            importFeatureFunction(sl::kFeatureDLSS_RR, "slDLSSDGetState", g.dlssDGetState) &&
            importFeatureFunction(sl::kFeatureDLSS_RR, "slDLSSDSetOptions", g.dlssDSetOptions);
    }
    g.features.rayReconstructionReason = g.features.rayReconstructionFunctionsLoaded
        ? "Ray Reconstruction requires the full denoiser and ray-tracing buffer set"
        : "Ray Reconstruction is unavailable or its plugin exports are incomplete";

    g.vkDevice = reinterpret_cast<VkDevice>(context.device);
    auto getDeviceProcAddr = reinterpret_cast<PFN_vkGetDeviceProcAddr>(
        GetProcAddress(g.module, "vkGetDeviceProcAddr"));
    if (getDeviceProcAddr && g.vkDevice) {
        g.vkCreateImageView = reinterpret_cast<PFN_vkCreateImageView>(
            getDeviceProcAddr(g.vkDevice, "vkCreateImageView"));
        g.vkDestroyImageView = reinterpret_cast<PFN_vkDestroyImageView>(
            getDeviceProcAddr(g.vkDevice, "vkDestroyImageView"));
        g.vkDeviceWaitIdle = reinterpret_cast<PFN_vkDeviceWaitIdle>(
            getDeviceProcAddr(g.vkDevice, "vkDeviceWaitIdle"));
    }
    if (g.capabilities.reflex) {
        const bool reflexFunctions =
            importFeatureFunction(sl::kFeatureReflex, "slReflexSetOptions", g.reflexSetOptions) &&
            importFeatureFunction(sl::kFeatureReflex, "slReflexSleep", g.reflexSleep) &&
            importFeatureFunction(sl::kFeaturePCL, "slPCLSetMarker", g.pclSetMarker);
        sl::ReflexOptions options{};
        options.mode = sl::ReflexMode::eLowLatency;
        if (!reflexFunctions || g.reflexSetOptions(options) != sl::Result::eOk) {
            g.capabilities.reflex = false;
            g.reflexMode = 0;
        }
    }
    g.capabilities.status = "Streamline connected · SR " +
        std::to_string(static_cast<int>(dlss)) + " · FG " +
        std::to_string(static_cast<int>(frameGeneration)) + " · RR " +
        std::to_string(static_cast<int>(rayReconstruction)) + " · NR " +
        std::to_string(static_cast<int>(neuralRendering)) + " · Reflex " +
        std::to_string(static_cast<int>(reflex));
    return true;
}

bool streamlineSetReflexMode(int mode) {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (!g.capabilities.reflex || !g.reflexSetOptions) return false;
    mode = mode < 0 ? 0 : mode > 2 ? 2 : mode;
    sl::ReflexOptions options{};
    options.mode = mode == 2 ? sl::ReflexMode::eLowLatencyWithBoost
                             : mode == 1 ? sl::ReflexMode::eLowLatency
                                         : sl::ReflexMode::eOff;
    if (g.reflexSetOptions(options) != sl::Result::eOk) return false;
    g.reflexMode = mode;
    return true;
}

int streamlineReflexMode() {
    std::lock_guard<std::mutex> lock(g.mutex);
    return g.reflexMode;
}

bool streamlineDLSSGetOptimalSettings(const StreamlineDLSSOptions& options,
                                      StreamlineDLSSOptimalSettings& settings) {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (!g.features.dlssSupported || !g.features.dlssFunctionsLoaded ||
        !g.dlssGetOptimalSettings || options.mode == StreamlineDLSSMode::Off ||
        !options.outputWidth || !options.outputHeight) {
        return false;
    }
    const sl::DLSSOptions nativeOptions = makeDLSSOptions(options);
    sl::DLSSOptimalSettings nativeSettings{};
    const sl::Result result = g.dlssGetOptimalSettings(nativeOptions, nativeSettings);
    if (result != sl::Result::eOk) {
        g.features.dlssLastResult = static_cast<int32_t>(result);
        g.features.dlssReason = "slDLSSGetOptimalSettings failed (" +
                                std::to_string(static_cast<int>(result)) + ")";
        return false;
    }
    settings.optimalRenderWidth = nativeSettings.optimalRenderWidth;
    settings.optimalRenderHeight = nativeSettings.optimalRenderHeight;
    settings.renderWidthMin = nativeSettings.renderWidthMin;
    settings.renderHeightMin = nativeSettings.renderHeightMin;
    settings.renderWidthMax = nativeSettings.renderWidthMax;
    settings.renderHeightMax = nativeSettings.renderHeightMax;
    settings.optimalSharpness = nativeSettings.optimalSharpness;
    return true;
}

bool streamlineRequestFeatures(const StreamlineDLSSOptions& dlss,
                               bool requestFrameGeneration,
                               bool requestRayReconstruction) {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (g.features.frameGenerationConfigured || g.frameGenerationTaggedForPresent ||
        (g.features.frameGenerationRequested && !requestFrameGeneration)) {
        suspendFrameGenerationLocked(
            requestFrameGeneration
                ? "Frame Generation configuration changed; waiting for fresh frame inputs"
                : "Frame Generation is off",
            !requestFrameGeneration);
    }
    const bool rayReconstructionWasRequested = g.features.rayReconstructionRequested;
    g.features.dlssRequested = dlss.mode != StreamlineDLSSMode::Off;
    g.features.frameGenerationRequested = requestFrameGeneration;
    g.features.rayReconstructionRequested = requestRayReconstruction;
    if (rayReconstructionWasRequested &&
        (!requestRayReconstruction ||
         dlss.mode != g.dlssOptions.mode ||
         dlss.outputWidth != g.dlssOptions.outputWidth ||
         dlss.outputHeight != g.dlssOptions.outputHeight)) {
        if (g.dlssDSetOptions) {
            sl::DLSSDOptions off = g.rayReconstructionOptions;
            off.mode = sl::DLSSMode::eOff;
            for (uint32_t viewportValue : g.rayReconstructionViewports) {
                const sl::ViewportHandle viewport(viewportValue);
                g.dlssDSetOptions(viewport, off);
                if (g.freeResources) g.freeResources(sl::kFeatureDLSS_RR, viewport);
            }
        }
        g.rayReconstructionViewports.clear();
        g.features.rayReconstructionConfigured = false;
        g.features.rayReconstructionActive = false;
    }
    if (requestFrameGeneration) {
        g.features.frameGenerationReason = g.features.frameGenerationFunctionsLoaded
            ? "Requested; waiting for HUD-less color, depth and dense motion-vector inputs"
            : "Requested, but Frame Generation is unsupported or its plugin is unavailable";
    } else {
        g.features.frameGenerationReason = "Frame Generation is off";
    }
    if (requestRayReconstruction) {
        if (!g.features.rayReconstructionSupported ||
            !g.features.rayReconstructionFunctionsLoaded || !g.dlssDSetOptions) {
            g.features.rayReconstructionReason =
                "Requested, but Ray Reconstruction is unsupported or its plugin is unavailable";
        } else if (!g.features.dlssRequested) {
            g.features.rayReconstructionReason =
                "Ray Reconstruction requires an enabled DLSS performance-quality mode";
        } else if (!dlss.colorBuffersHDR) {
            g.features.rayReconstructionReason =
                "Ray Reconstruction requires noisy HDR color input";
        } else {
            g.features.rayReconstructionReason =
                "Requested; waiting for noisy HDR color, depth, dense motion, material guides, and specular reflection motion inputs";
        }
    } else {
        g.features.rayReconstructionConfigured = false;
        g.features.rayReconstructionActive = false;
        g.features.rayReconstructionReason = "Ray Reconstruction is off";
    }

    const sl::ViewportHandle viewport(0u);
    if (!g.features.dlssRequested) {
        if (g.features.dlssFunctionsLoaded && g.dlssSetOptions) {
            sl::DLSSOptions nativeOptions = makeDLSSOptions(dlss);
            nativeOptions.mode = sl::DLSSMode::eOff;
            g.dlssSetOptions(viewport, nativeOptions);
            if (g.freeResources) g.freeResources(sl::kFeatureDLSS, viewport);
        }
        g.features.dlssConfigured = false;
        g.features.dlssActive = false;
        g.features.dlssMode = StreamlineDLSSMode::Off;
        g.features.dlssReason = "DLSS Super Resolution is off";
        g.dlssOptions = dlss;
        return true;
    }
    if (!g.features.dlssSupported || !g.features.dlssFunctionsLoaded || !g.dlssSetOptions) {
        g.features.dlssConfigured = false;
        g.features.dlssActive = false;
        g.features.dlssReason = "DLSS Super Resolution was requested but is unavailable";
        return false;
    }
    if (!dlss.outputWidth || !dlss.outputHeight) {
        g.features.dlssConfigured = false;
        g.features.dlssActive = false;
        g.features.dlssReason = "DLSS output width and height must be non-zero";
        return false;
    }

    const sl::DLSSOptions nativeOptions = makeDLSSOptions(dlss);
    const sl::Result result = g.dlssSetOptions(viewport, nativeOptions);
    g.features.dlssLastResult = static_cast<int32_t>(result);
    if (result != sl::Result::eOk) {
        g.features.dlssConfigured = false;
        g.features.dlssActive = false;
        g.features.dlssReason = "slDLSSSetOptions failed (" +
                                std::to_string(static_cast<int>(result)) + ")";
        return false;
    }

    sl::DLSSOptimalSettings nativeSettings{};
    const sl::Result settingsResult = g.dlssGetOptimalSettings(nativeOptions, nativeSettings);
    if (settingsResult != sl::Result::eOk) {
        g.features.dlssConfigured = false;
        g.features.dlssReason = "DLSS settings query failed (" +
                                std::to_string(static_cast<int>(settingsResult)) + ")";
        return false;
    }
    g.dlssOptions = dlss;
    g.features.dlssConfigured = true;
    g.features.dlssActive = false;
    g.features.dlssMode = dlss.mode;
    g.features.renderWidth = nativeSettings.optimalRenderWidth;
    g.features.renderHeight = nativeSettings.optimalRenderHeight;
    g.features.outputWidth = dlss.outputWidth;
    g.features.outputHeight = dlss.outputHeight;
    g.features.dlssReason = "Configured; waiting for color, output, depth and motion-vector resources";
    return true;
}

bool streamlineDLSSEvaluate(const StreamlineDLSSFrame& frame) {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (!g.features.dlssConfigured || !g.frameToken || !g.evaluateFeature ||
        !g.setTagForFrame || !g.setConstants) {
        setDLSSFailure(sl::Result::eErrorMissingInputParameter,
                       !g.frameToken ? "No Streamline frame token is active"
                                     : "DLSS is not configured or core evaluation APIs are missing");
        return false;
    }
    if (!frame.commandBuffer) {
        setDLSSFailure(sl::Result::eErrorMissingInputParameter,
                       "DLSS evaluation requires a Vulkan command buffer");
        return false;
    }
    std::string reason;
    const VkImageView colorInputView = imageView(frame.colorInput, reason);
    const VkImageView colorOutputView = imageView(frame.colorOutput, reason);
    const VkImageView depthView = imageView(frame.depth, reason);
    const VkImageView motionView = imageView(frame.motionVectors, reason);
    const VkImageView exposureView = frame.hasExposure ? imageView(frame.exposure, reason)
                                                       : VK_NULL_HANDLE;
    if (!colorInputView || !colorOutputView || !depthView || !motionView ||
        (frame.hasExposure && !exposureView)) {
        setDLSSFailure(sl::Result::eErrorMissingInputParameter,
                       reason.empty() ? "A mandatory DLSS image view could not be created" : reason);
        return false;
    }

    TaggedResource colorInput(frame.colorInput, colorInputView,
                              sl::kBufferTypeScalingInputColor);
    TaggedResource colorOutput(frame.colorOutput, colorOutputView,
                               sl::kBufferTypeScalingOutputColor);
    TaggedResource depth(frame.depth, depthView, sl::kBufferTypeDepth);
    TaggedResource motion(frame.motionVectors, motionView, sl::kBufferTypeMotionVectors);
    std::vector<sl::ResourceTag> tags{
        colorInput.tag, colorOutput.tag, depth.tag, motion.tag};
    // Keep the optional exposure resource alive for the duration of tagging/evaluation.
    std::unique_ptr<TaggedResource> exposure;
    if (frame.hasExposure) {
        exposure = std::make_unique<TaggedResource>(frame.exposure, exposureView,
                                                    sl::kBufferTypeExposure);
        tags.push_back(exposure->tag);
    }

    const sl::ViewportHandle viewport(frame.viewport);
    sl::CommandBuffer* commandBuffer =
        reinterpret_cast<sl::CommandBuffer*>(frame.commandBuffer);
    sl::Result result = g.setTagForFrame(*g.frameToken, viewport, tags.data(),
                                        static_cast<uint32_t>(tags.size()), commandBuffer);
    if (result == sl::Result::eOk) {
        result = setConstantsForFrame(frame.constants, frame.viewport);
    }
    if (result == sl::Result::eOk) {
        const sl::BaseStructure* inputs[] = {&viewport};
        result = g.evaluateFeature(sl::kFeatureDLSS, *g.frameToken, inputs, 1,
                                   commandBuffer);
    }
    g.features.dlssLastResult = static_cast<int32_t>(result);
    if (result != sl::Result::eOk) {
        setDLSSFailure(result, "DLSS evaluation failed (" +
                               std::to_string(static_cast<int>(result)) + ")");
        return false;
    }
    ++g.features.dlssEvaluationCount;
    g.features.dlssActive = true;
    g.features.dlssReason = "DLSS Super Resolution evaluated on the current frame";
    if (g.dlssGetState) {
        sl::DLSSState state{};
        if (g.dlssGetState(viewport, state) == sl::Result::eOk) {
            g.features.estimatedVramBytes = state.estimatedVRAMUsageInBytes;
        }
    }
    return true;
}

bool streamlineDLSSNREvaluate(const StreamlineDLSSNRFrame& frame) {
#if !defined(THREEBROWSER_DLSS_NEURAL_RENDERING)
    (void)frame;
    return false;
#else
    std::lock_guard<std::mutex> lock(g.mutex);
    if (frame.options.enabled) {
        g.features.neuralRenderingRequested = true;
    }

    const sl::ViewportHandle viewport(frame.viewport);
    if (!frame.options.enabled) {
        if (g.features.neuralRenderingFunctionsLoaded && g.dlssNRSetOptions) {
            DLSSNeuralRenderingOptions off{};
            off.mode = static_cast<decltype(off.mode)>(0);
            const sl::Result result = g.dlssNRSetOptions(viewport, off);
            g.features.neuralRenderingLastResult =
                static_cast<int32_t>(result);
            if (result != sl::Result::eOk) {
                setNeuralRenderingFailure(
                    frame.viewport, result,
                    "Disabling DLSS Neural Rendering failed (" +
                                std::to_string(static_cast<int>(result)) + ")");
                return false;
            }
            if (g.freeResources) g.freeResources(kFeatureDLSSNR, viewport);
        }
        g.neuralRenderingViewports.erase(frame.viewport);
        g.neuralRenderingActiveViewports.erase(frame.viewport);
        g.features.neuralRenderingRequested =
            !g.neuralRenderingViewports.empty();
        g.features.neuralRenderingConfigured =
            !g.neuralRenderingViewports.empty();
        g.features.neuralRenderingActive =
            !g.neuralRenderingActiveViewports.empty();
        g.features.neuralRenderingReason = g.neuralRenderingViewports.empty()
            ? "DLSS Neural Rendering is off"
            : "DLSS Neural Rendering is off for this viewport; other viewports remain configured";
        return true;
    }

    if (!g.features.neuralRenderingSupported ||
        !g.features.neuralRenderingFunctionsLoaded || !g.dlssNRSetOptions ||
        !g.frameToken || !g.evaluateFeature || !g.setTagForFrame ||
        !g.setConstants) {
        setNeuralRenderingFailure(
            frame.viewport, sl::Result::eErrorMissingInputParameter,
            !g.frameToken
                ? "No Streamline frame token is active for DLSS Neural Rendering"
                : "DLSS Neural Rendering is unsupported or its API is unavailable");
        return false;
    }
    if (!frame.commandBuffer) {
        setNeuralRenderingFailure(
            frame.viewport, sl::Result::eErrorMissingInputParameter,
            "DLSS Neural Rendering requires a Vulkan command buffer");
        return false;
    }
    if (frame.options.style > 2) {
        setNeuralRenderingFailure(
            frame.viewport, sl::Result::eErrorInvalidParameter,
            "DLSS Neural Rendering style must be 0, 1, or 2");
        return false;
    }
    const uint32_t performanceMode =
        static_cast<uint32_t>(frame.options.performanceMode);
    if (performanceMode != 6) {
        setNeuralRenderingFailure(
            frame.viewport, sl::Result::eErrorInvalidParameter,
            "The same-resolution DLSS Neural Rendering path requires DLAA mode (6)");
        return false;
    }
    if (frame.colorInput.image == frame.colorOutput.image) {
        setNeuralRenderingFailure(
            frame.viewport, sl::Result::eErrorInvalidParameter,
            "DLSS Neural Rendering input and output must be distinct images");
        return false;
    }
    const auto extent = [](const StreamlineVulkanResource& resource) {
        return std::array<uint32_t, 2>{
            resource.extentWidth ? resource.extentWidth : resource.width,
            resource.extentHeight ? resource.extentHeight : resource.height};
    };
    const auto inputExtent = extent(frame.colorInput);
    if (extent(frame.colorOutput) != inputExtent ||
        extent(frame.depth) != inputExtent ||
        extent(frame.motionVectors) != inputExtent ||
        (frame.hasControlMask && extent(frame.controlMask) != inputExtent)) {
        setNeuralRenderingFailure(
            frame.viewport, sl::Result::eErrorInvalidParameter,
            "DLSS Neural Rendering resource regions must have matching extents");
        return false;
    }
    if (frame.hasControlMask &&
        frame.controlMask.format != static_cast<uint32_t>(VK_FORMAT_R8_UNORM)) {
        setNeuralRenderingFailure(
            frame.viewport, sl::Result::eErrorInvalidParameter,
            "DLSS Neural Rendering control mask must use VK_FORMAT_R8_UNORM");
        return false;
    }

    DLSSNeuralRenderingOptions options{};
    options.mode = static_cast<decltype(options.mode)>(1);
    options.intensity = frame.options.intensity;
    options.localToneStrength = frame.options.localToneStrength;
    options.localStructureStrength = frame.options.localStructureStrength;
    options.globalToneStrength = frame.options.globalToneStrength;
    options.style = static_cast<decltype(options.style)>(frame.options.style);
    options.renderPreset =
        static_cast<decltype(options.renderPreset)>(frame.options.renderPreset);
    options.useAutoMask = static_cast<decltype(options.useAutoMask)>(
        frame.hasControlMask ? 0 : (frame.options.useAutoMask ? 1 : 0));
    options.skinStructureStrength = frame.options.skinStructureStrength;
    options.performanceMode =
        static_cast<decltype(options.performanceMode)>(performanceMode);

    sl::Result result = g.dlssNRSetOptions(viewport, options);
    g.features.neuralRenderingLastResult = static_cast<int32_t>(result);
    if (result != sl::Result::eOk) {
        setNeuralRenderingFailure(
            frame.viewport, result, "slDLSSNRSetOptions failed (" +
                        std::to_string(static_cast<int>(result)) + ")");
        return false;
    }
    // Track the configured viewport immediately. Any later view/tag/evaluate
    // failure can then be recovered by releaseViewport or shutdown.
    g.neuralRenderingViewports.insert(frame.viewport);
    g.features.neuralRenderingConfigured = true;

    std::string reason;
    const VkImageView colorInputView = imageView(frame.colorInput, reason);
    const VkImageView colorOutputView = imageView(frame.colorOutput, reason);
    const VkImageView depthView = imageView(frame.depth, reason);
    const VkImageView motionView = imageView(frame.motionVectors, reason);
    const VkImageView controlMaskView = frame.hasControlMask
        ? imageView(frame.controlMask, reason)
        : VK_NULL_HANDLE;
    if (!colorInputView || !colorOutputView || !depthView || !motionView ||
        (frame.hasControlMask && !controlMaskView)) {
        setNeuralRenderingFailure(
            frame.viewport, sl::Result::eErrorMissingInputParameter,
            reason.empty()
                ? "A mandatory DLSS Neural Rendering image view could not be created"
                : reason);
        return false;
    }

    TaggedResource colorInput(frame.colorInput, colorInputView,
                              sl::kBufferTypeReserved70);
    TaggedResource colorOutput(frame.colorOutput, colorOutputView,
                               sl::kBufferTypeReserved71);
    TaggedResource motion(frame.motionVectors, motionView,
                          sl::kBufferTypeMotionVectors);
    TaggedResource depth(frame.depth, depthView, sl::kBufferTypeDepth);
    std::vector<sl::ResourceTag> tags{
        colorInput.tag, colorOutput.tag, motion.tag, depth.tag};
    std::unique_ptr<TaggedResource> controlMask;
    if (frame.hasControlMask) {
        controlMask = std::make_unique<TaggedResource>(
            frame.controlMask, controlMaskView, sl::kBufferTypeReserved72);
        tags.push_back(controlMask->tag);
    }

    auto* commandBuffer =
        reinterpret_cast<sl::CommandBuffer*>(frame.commandBuffer);
    result = g.setTagForFrame(*g.frameToken, viewport, tags.data(),
                              static_cast<uint32_t>(tags.size()), commandBuffer);
    if (result == sl::Result::eOk) {
        result = setConstantsForFrame(frame.constants, frame.viewport);
    }
    if (result == sl::Result::eOk) {
        const sl::BaseStructure* inputs[] = {&viewport};
        result = g.evaluateFeature(kFeatureDLSSNR, *g.frameToken, inputs, 1,
                                   commandBuffer);
    }
    g.features.neuralRenderingLastResult = static_cast<int32_t>(result);
    if (result != sl::Result::eOk) {
        setNeuralRenderingFailure(
            frame.viewport, result,
            "DLSS Neural Rendering evaluation failed (" +
                        std::to_string(static_cast<int>(result)) + ")");
        return false;
    }

    g.neuralRenderingActiveViewports.insert(frame.viewport);
    ++g.features.neuralRenderingEvaluationCount;
    g.features.neuralRenderingConfigured = true;
    g.features.neuralRenderingActive =
        !g.neuralRenderingActiveViewports.empty();
    g.features.neuralRenderingReason =
        "DLSS Neural Rendering evaluated on the current frame";
    return true;
#endif
}

bool streamlineRayReconstructionEvaluate(
    const StreamlineRayReconstructionFrame& frame) {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (!g.features.rayReconstructionRequested ||
        !g.features.rayReconstructionSupported ||
        !g.features.rayReconstructionFunctionsLoaded || !g.dlssDSetOptions ||
        !g.dlssDGetState || !g.frameToken || !g.evaluateFeature ||
        !g.setTagForFrame || !g.setConstants) {
        setRayReconstructionFailure(
            sl::Result::eErrorMissingInputParameter,
            !g.features.rayReconstructionRequested
                ? "Ray Reconstruction inputs were supplied without an active request"
                : !g.frameToken
                    ? "No Streamline frame token is active"
                    : "Ray Reconstruction is unsupported or its native API is unavailable");
        return false;
    }
    if (!frame.commandBuffer) {
        setRayReconstructionFailure(sl::Result::eErrorMissingInputParameter,
                                    "Ray Reconstruction requires a Vulkan command buffer");
        return false;
    }
    if (g.dlssOptions.mode == StreamlineDLSSMode::Off ||
        !g.dlssOptions.outputWidth || !g.dlssOptions.outputHeight ||
        !g.dlssOptions.colorBuffersHDR) {
        setRayReconstructionFailure(
            sl::Result::eErrorInvalidParameter,
            "Ray Reconstruction requires an enabled DLSS mode, fixed output size, and noisy HDR color");
        return false;
    }
    if (frame.normalRoughnessPacked == frame.hasRoughness) {
        setRayReconstructionFailure(
            sl::Result::eErrorInvalidParameter,
            "Provide packed normal.xyz/roughness.w or separate normal and roughness textures, not both");
        return false;
    }
    if (frame.hasSpecularMotionVectors == frame.hasSpecularHitDistance) {
        setRayReconstructionFailure(
            sl::Result::eErrorInvalidParameter,
            "Provide exactly one reflection guide: specular motion vectors or specular hit distance with matrices");
        return false;
    }

    std::string reason;
    const VkImageView noisyColorView = imageView(frame.noisyColor, reason);
    const VkImageView colorOutputView = imageView(frame.colorOutput, reason);
    const VkImageView depthView = imageView(frame.depth, reason);
    const VkImageView motionView = imageView(frame.motionVectors, reason);
    const VkImageView diffuseAlbedoView = imageView(frame.diffuseAlbedo, reason);
    const VkImageView specularAlbedoView = imageView(frame.specularAlbedo, reason);
    const VkImageView normalRoughnessView = imageView(frame.normalRoughness, reason);
    const VkImageView roughnessView = frame.hasRoughness
        ? imageView(frame.roughness, reason) : VK_NULL_HANDLE;
    const VkImageView specularMotionView = frame.hasSpecularMotionVectors
        ? imageView(frame.specularMotionVectors, reason) : VK_NULL_HANDLE;
    const VkImageView specularHitDistanceView = frame.hasSpecularHitDistance
        ? imageView(frame.specularHitDistance, reason) : VK_NULL_HANDLE;
    if (!noisyColorView || !colorOutputView || !depthView || !motionView ||
        !diffuseAlbedoView || !specularAlbedoView || !normalRoughnessView ||
        (frame.hasRoughness && !roughnessView) ||
        (frame.hasSpecularMotionVectors && !specularMotionView) ||
        (frame.hasSpecularHitDistance && !specularHitDistanceView)) {
        setRayReconstructionFailure(
            sl::Result::eErrorMissingInputParameter,
            reason.empty() ? "A mandatory Ray Reconstruction image view could not be created"
                           : reason);
        return false;
    }

    TaggedResource noisyColor(frame.noisyColor, noisyColorView,
                              sl::kBufferTypeScalingInputColor);
    TaggedResource colorOutput(frame.colorOutput, colorOutputView,
                               sl::kBufferTypeScalingOutputColor);
    TaggedResource depth(frame.depth, depthView, sl::kBufferTypeDepth);
    TaggedResource motion(frame.motionVectors, motionView,
                          sl::kBufferTypeMotionVectors);
    TaggedResource diffuseAlbedo(frame.diffuseAlbedo, diffuseAlbedoView,
                                 sl::kBufferTypeAlbedo);
    TaggedResource specularAlbedo(frame.specularAlbedo, specularAlbedoView,
                                  sl::kBufferTypeSpecularAlbedo);
    TaggedResource normalRoughness(
        frame.normalRoughness, normalRoughnessView,
        frame.normalRoughnessPacked ? sl::kBufferTypeNormalRoughness
                                    : sl::kBufferTypeNormals);
    std::vector<sl::ResourceTag> tags{
        noisyColor.tag, colorOutput.tag, depth.tag, motion.tag,
        diffuseAlbedo.tag, specularAlbedo.tag, normalRoughness.tag};

    std::unique_ptr<TaggedResource> roughness;
    if (frame.hasRoughness) {
        roughness = std::make_unique<TaggedResource>(
            frame.roughness, roughnessView, sl::kBufferTypeRoughness);
        tags.push_back(roughness->tag);
    }
    std::unique_ptr<TaggedResource> reflectionGuide;
    if (frame.hasSpecularMotionVectors) {
        reflectionGuide = std::make_unique<TaggedResource>(
            frame.specularMotionVectors, specularMotionView,
            sl::kBufferTypeSpecularMotionVectors);
    } else {
        reflectionGuide = std::make_unique<TaggedResource>(
            frame.specularHitDistance, specularHitDistanceView,
            sl::kBufferTypeSpecularHitDistance);
    }
    tags.push_back(reflectionGuide->tag);

    const sl::ViewportHandle viewport(frame.viewport);
    const sl::DLSSDOptions nativeOptions =
        makeRayReconstructionOptions(g.dlssOptions, frame);
    sl::Result result = g.dlssDSetOptions(viewport, nativeOptions);
    g.features.rayReconstructionLastResult = static_cast<int32_t>(result);
    if (result != sl::Result::eOk) {
        setRayReconstructionFailure(
            result, "slDLSSDSetOptions failed (" +
                        std::to_string(static_cast<int>(result)) + ")");
        return false;
    }
    g.rayReconstructionOptions = nativeOptions;
    g.rayReconstructionViewports.insert(frame.viewport);
    g.features.rayReconstructionConfigured = true;

    sl::CommandBuffer* commandBuffer =
        reinterpret_cast<sl::CommandBuffer*>(frame.commandBuffer);
    result = g.setTagForFrame(*g.frameToken, viewport, tags.data(),
                              static_cast<uint32_t>(tags.size()), commandBuffer);
    if (result == sl::Result::eOk) {
        result = setConstantsForFrame(frame.constants, frame.viewport);
    }
    if (result == sl::Result::eOk) {
        const sl::BaseStructure* inputs[] = {&viewport};
        result = g.evaluateFeature(sl::kFeatureDLSS_RR, *g.frameToken, inputs, 1,
                                   commandBuffer);
    }
    g.features.rayReconstructionLastResult = static_cast<int32_t>(result);
    if (result != sl::Result::eOk) {
        setRayReconstructionFailure(
            result, "Ray Reconstruction evaluation failed (" +
                        std::to_string(static_cast<int>(result)) + ")");
        return false;
    }

    ++g.features.rayReconstructionEvaluationCount;
    g.features.rayReconstructionActive = true;
    g.features.rayReconstructionReason =
        "DLSS Ray Reconstruction evaluated genuine denoiser inputs on the current frame";
    // Ray Reconstruction replaces Super Resolution for this viewport/frame.
    g.features.dlssActive = false;
    if (g.dlssDGetState) {
        sl::DLSSDState state{};
        if (g.dlssDGetState(viewport, state) == sl::Result::eOk) {
            g.features.rayReconstructionEstimatedVramBytes =
                state.estimatedVRAMUsageInBytes;
        }
    }
    return true;
}

bool streamlineFrameGenerationTag(const StreamlineFrameGenerationFrame& frame) {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (!g.features.frameGenerationRequested ||
        !g.features.frameGenerationSupported ||
        !g.features.frameGenerationFunctionsLoaded || !g.dlssGSetOptions ||
        !g.dlssGGetState || !g.setTagForFrame || !g.setConstants) {
        setFrameGenerationFailure(
            sl::Result::eErrorMissingInputParameter, 0,
            g.features.frameGenerationRequested
                ? "Frame Generation is unsupported or its native API is unavailable"
                : "Frame Generation inputs were supplied without an active request");
        return false;
    }
    if (!g.capabilities.reflex || !g.reflexSetOptions || g.reflexMode == 0) {
        setFrameGenerationFailure(sl::Result::eErrorMissingInputParameter,
                                  static_cast<uint32_t>(
                                      sl::DLSSGStatus::eFailReflexNotDetectedAtRuntime),
                                  "Frame Generation requires NVIDIA Reflex to be active");
        return false;
    }
    if (!g.frameToken || !frame.commandBuffer) {
        setFrameGenerationFailure(sl::Result::eErrorMissingInputParameter, 0,
                                  !g.frameToken
                                      ? "No Streamline frame token is active"
                                      : "Frame Generation tagging requires a Vulkan command buffer");
        return false;
    }
    if (!frame.backbufferWidth || !frame.backbufferHeight ||
        !frame.backbufferFormat) {
        setFrameGenerationFailure(sl::Result::eErrorMissingInputParameter, 0,
                                  "Frame Generation backbuffer metadata is incomplete");
        return false;
    }
    auto resourceWidth = [](const StreamlineVulkanResource& resource) {
        return resource.extentWidth ? resource.extentWidth : resource.width;
    };
    auto resourceHeight = [](const StreamlineVulkanResource& resource) {
        return resource.extentHeight ? resource.extentHeight : resource.height;
    };
    if (resourceWidth(frame.hudlessColor) != frame.backbufferWidth ||
        resourceHeight(frame.hudlessColor) != frame.backbufferHeight ||
        (frame.hasUi &&
         (resourceWidth(frame.ui) != frame.backbufferWidth ||
          resourceHeight(frame.ui) != frame.backbufferHeight))) {
        setFrameGenerationFailure(
            sl::Result::eErrorInvalidParameter, 0,
            "HUD-less color and UI extents must exactly match the backbuffer");
        return false;
    }
    if (g.features.frameGenerationConfigured &&
        g.frameGenerationViewport != frame.viewport) {
        suspendFrameGenerationLocked(
            "Frame Generation viewport changed; waiting for fresh inputs", false);
    }

    std::string reason;
    const VkImageView hudlessView = imageView(frame.hudlessColor, reason);
    const VkImageView depthView = imageView(frame.depth, reason);
    const VkImageView motionView = imageView(frame.motionVectors, reason);
    const VkImageView uiView = frame.hasUi ? imageView(frame.ui, reason) : VK_NULL_HANDLE;
    if (!hudlessView || !depthView || !motionView || (frame.hasUi && !uiView)) {
        setFrameGenerationFailure(
            sl::Result::eErrorMissingInputParameter, 0,
            reason.empty() ? "A mandatory Frame Generation image view could not be created"
                           : reason);
        return false;
    }

    constexpr auto lifecycle = sl::ResourceLifecycle::eValidUntilPresent;
    TaggedResource hudless(frame.hudlessColor, hudlessView,
                            sl::kBufferTypeHUDLessColor, lifecycle);
    TaggedResource depth(frame.depth, depthView, sl::kBufferTypeDepth, lifecycle);
    TaggedResource motion(frame.motionVectors, motionView,
                           sl::kBufferTypeMotionVectors, lifecycle);
    std::vector<sl::ResourceTag> tags{hudless.tag, depth.tag, motion.tag};
    std::unique_ptr<TaggedResource> ui;
    if (frame.hasUi) {
        ui = std::make_unique<TaggedResource>(
            frame.ui, uiView,
            frame.uiAlphaOnly ? sl::kBufferTypeUIAlpha
                              : sl::kBufferTypeUIColorAndAlpha,
            lifecycle);
        tags.push_back(ui->tag);
    }

    const sl::ViewportHandle viewport(frame.viewport);
    auto* commandBuffer = reinterpret_cast<sl::CommandBuffer*>(frame.commandBuffer);
    sl::Result result = g.setTagForFrame(*g.frameToken, viewport, tags.data(),
                                        static_cast<uint32_t>(tags.size()),
                                        commandBuffer);
    if (result == sl::Result::eOk) {
        result = setConstantsForFrame(frame.constants, frame.viewport);
    }
    if (result != sl::Result::eOk) {
        setFrameGenerationFailure(
            result, 0, "Frame Generation input tagging failed (" +
                           std::to_string(static_cast<int>(result)) + ")");
        return false;
    }

    sl::DLSSGOptions options{};
    options.mode = sl::DLSSGMode::eOn;
    const uint32_t knownMaximum = g.features.frameGenerationFramesToGenerateMax;
    options.numFramesToGenerate = std::max(
        1u, std::min(frame.framesToGenerate ? frame.framesToGenerate : 1u,
                     knownMaximum ? knownMaximum : 1u));
    const bool requestVramEstimate =
        g.features.frameGenerationEstimatedVramBytes == 0;
    options.flags = requestVramEstimate
        ? sl::DLSSGFlags::eRetainResourcesWhenOff |
              sl::DLSSGFlags::eRequestVRAMEstimate
        : sl::DLSSGFlags::eRetainResourcesWhenOff;
    options.mvecDepthWidth = resourceWidth(frame.depth);
    options.mvecDepthHeight = resourceHeight(frame.depth);
    options.colorWidth = frame.backbufferWidth;
    options.colorHeight = frame.backbufferHeight;
    options.colorBufferFormat = frame.backbufferFormat;
    options.mvecBufferFormat = frame.motionVectors.format;
    options.depthBufferFormat = frame.depth.format;
    options.hudLessBufferFormat = frame.hudlessColor.format;
    options.uiBufferFormat = frame.hasUi ? frame.ui.format : 0;
    options.queueParallelismMode =
        sl::DLSSGQueueParallelismMode::eBlockPresentingClientQueue;
    options.enableUserInterfaceRecomposition =
        frame.hasUi ? sl::Boolean::eTrue : sl::Boolean::eFalse;

    result = g.dlssGSetOptions(viewport, options);
    if (result != sl::Result::eOk) {
        setFrameGenerationFailure(
            result, 0, "slDLSSGSetOptions failed (" +
                           std::to_string(static_cast<int>(result)) + ")");
        return false;
    }
    sl::DLSSGState state{};
    const sl::Result stateResult = g.dlssGGetState(
        viewport, state, requestVramEstimate ? &options : nullptr);
    const uint32_t status = static_cast<uint32_t>(state.status);
    if (stateResult != sl::Result::eOk || state.status != sl::DLSSGStatus::eOk) {
        sl::DLSSGOptions off = options;
        off.mode = sl::DLSSGMode::eOff;
        g.dlssGSetOptions(viewport, off);
        setFrameGenerationFailure(
            stateResult, status,
            stateResult != sl::Result::eOk
                ? "slDLSSGGetState failed (" +
                      std::to_string(static_cast<int>(stateResult)) + ")"
                : "DLSS Frame Generation rejected the current inputs/status (" +
                      std::to_string(status) + ")");
        return false;
    }

    g.frameGenerationOptions = options;
    g.frameGenerationViewport = frame.viewport;
    g.frameGenerationTaggedForPresent = true;
    g.frameGenerationImages = {frame.hudlessColor.image, frame.depth.image,
                               frame.motionVectors.image};
    if (frame.hasUi) g.frameGenerationImages.insert(frame.ui.image);
    g.features.frameGenerationConfigured = true;
    g.features.frameGenerationActive = false;
    g.features.frameGenerationFramesToGenerate = options.numFramesToGenerate;
    g.features.frameGenerationFramesToGenerateMax = state.numFramesToGenerateMax;
    g.features.frameGenerationLastFramesPresented = 0;
    g.features.frameGenerationEstimatedVramBytes = state.estimatedVRAMUsageInBytes;
    g.features.frameGenerationLastResult = static_cast<int32_t>(stateResult);
    g.features.frameGenerationLastStatus = status;
    g.features.frameGenerationReason =
        "Configured by slDLSSGSetOptions/state; waiting for an interpolated Present";
    return true;
}

void streamlineFrameGenerationBeforePresent(bool inputsMayBePresented) {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (!g.features.frameGenerationConfigured) return;
    if (!inputsMayBePresented || !g.frameGenerationTaggedForPresent) {
        suspendFrameGenerationLocked(
            inputsMayBePresented
                ? "Frame Generation suspended because this frame has no valid inputs"
                : "Frame Generation suspended while loading or runtime controls are visible",
            false);
    }
}

void streamlineFrameGenerationAfterPresent() {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (!g.features.frameGenerationConfigured ||
        !g.frameGenerationTaggedForPresent) {
        g.frameGenerationImages.clear();
        g.frameGenerationTaggedForPresent = false;
        return;
    }
    const sl::ViewportHandle viewport(g.frameGenerationViewport);
    sl::DLSSGState state{};
    const sl::Result result = g.dlssGGetState
        ? g.dlssGGetState(viewport, state, nullptr)
        : sl::Result::eErrorMissingInputParameter;
    const uint32_t status = static_cast<uint32_t>(state.status);
    g.features.frameGenerationLastResult = static_cast<int32_t>(result);
    g.features.frameGenerationLastStatus = status;
    g.features.frameGenerationLastFramesPresented = state.numFramesActuallyPresented;
    g.features.frameGenerationFramesToGenerateMax = state.numFramesToGenerateMax;
    g.features.frameGenerationEstimatedVramBytes = state.estimatedVRAMUsageInBytes;
    g.frameGenerationImages.clear();
    g.frameGenerationTaggedForPresent = false;
    if (result != sl::Result::eOk || state.status != sl::DLSSGStatus::eOk) {
        sl::DLSSGOptions off = g.frameGenerationOptions;
        off.mode = sl::DLSSGMode::eOff;
        if (g.dlssGSetOptions) g.dlssGSetOptions(viewport, off);
        setFrameGenerationFailure(
            result, status,
            result != sl::Result::eOk
                ? "Post-present slDLSSGGetState failed (" +
                      std::to_string(static_cast<int>(result)) + ")"
                : "DLSS Frame Generation reported a post-present failure/status (" +
                      std::to_string(status) + ")");
        return;
    }
    g.features.frameGenerationConfigured = true;
    g.features.frameGenerationActive = state.numFramesActuallyPresented > 1;
    if (g.features.frameGenerationActive) {
        g.features.frameGenerationPresentedFrameCount +=
            static_cast<uint64_t>(state.numFramesActuallyPresented - 1);
        g.features.frameGenerationReason =
            "Active; Streamline confirmed " +
            std::to_string(state.numFramesActuallyPresented - 1) +
            " generated frame(s) in the last Present";
    } else {
        g.features.frameGenerationReason =
            "Configured, but Streamline did not report an interpolated frame";
    }
}

void streamlineSuspendFrameGeneration(const char* reason, bool releaseResources) {
    std::lock_guard<std::mutex> lock(g.mutex);
    suspendFrameGenerationLocked(reason, releaseResources);
}

void streamlineReleaseViewport(uint32_t viewportValue) {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (viewportValue == g.frameGenerationViewport &&
        (g.features.frameGenerationConfigured || g.frameGenerationTaggedForPresent)) {
        suspendFrameGenerationLocked(
            "Frame Generation viewport resources were released", true);
    }
    if (g.freeResources && g.features.dlssFunctionsLoaded) {
        g.freeResources(sl::kFeatureDLSS, sl::ViewportHandle(viewportValue));
    }
    if (g.rayReconstructionViewports.erase(viewportValue) != 0) {
        const sl::ViewportHandle viewport(viewportValue);
        if (g.dlssDSetOptions) {
            sl::DLSSDOptions off = g.rayReconstructionOptions;
            off.mode = sl::DLSSMode::eOff;
            g.dlssDSetOptions(viewport, off);
        }
        if (g.freeResources) g.freeResources(sl::kFeatureDLSS_RR, viewport);
        if (g.rayReconstructionViewports.empty()) {
            g.features.rayReconstructionConfigured = false;
            g.features.rayReconstructionActive = false;
            g.features.rayReconstructionReason =
                "Ray Reconstruction viewport resources were released";
        }
    }
#if defined(THREEBROWSER_DLSS_NEURAL_RENDERING)
    if (g.neuralRenderingViewports.erase(viewportValue) != 0) {
        g.neuralRenderingActiveViewports.erase(viewportValue);
        const sl::ViewportHandle viewport(viewportValue);
        if (g.dlssNRSetOptions) {
            DLSSNeuralRenderingOptions off{};
            off.mode = static_cast<decltype(off.mode)>(0);
            g.dlssNRSetOptions(viewport, off);
        }
        if (g.freeResources) g.freeResources(kFeatureDLSSNR, viewport);
        g.features.neuralRenderingRequested =
            !g.neuralRenderingViewports.empty();
        g.features.neuralRenderingConfigured =
            !g.neuralRenderingViewports.empty();
        g.features.neuralRenderingActive =
            !g.neuralRenderingActiveViewports.empty();
        if (g.neuralRenderingViewports.empty()) {
            g.features.neuralRenderingReason =
                "DLSS Neural Rendering viewport resources were released";
        }
    }
#endif
    if (viewportValue == 0) {
        g.features.dlssConfigured = false;
        g.features.dlssActive = false;
        g.features.dlssReason = "DLSS viewport resources were released";
    }
}

void streamlineForgetVulkanImage(void* image) {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (g.frameGenerationImages.find(image) != g.frameGenerationImages.end()) {
        suspendFrameGenerationLocked(
            "Frame Generation suspended before a tagged Vulkan image was destroyed",
            false);
    }
    const auto found = g.imageViews.find(image);
    if (found == g.imageViews.end()) return;
    if (g.vkDeviceWaitIdle && g.vkDevice) g.vkDeviceWaitIdle(g.vkDevice);
    if (g.vkDestroyImageView && g.vkDevice && found->second) {
        g.vkDestroyImageView(g.vkDevice, found->second, nullptr);
    }
    g.imageViews.erase(found);
}

StreamlineFeatureState streamlineFeatureState() {
    std::lock_guard<std::mutex> lock(g.mutex);
    return g.features;
}

void streamlineFrameBegin(uint32_t frameIndex) {
    std::lock_guard<std::mutex> lock(g.mutex);
    g.constantsSetForFrame = false;
    g.constantsViewport = 0;
    g.frameGenerationTaggedForPresent = false;
    g.frameGenerationImages.clear();
    if (!g.getNewFrameToken || (!g.capabilities.reflex && !g.features.dlssConfigured &&
                                !g.features.frameGenerationConfigured &&
                                !g.features.rayReconstructionConfigured &&
                                !g.features.neuralRenderingRequested &&
                                !g.features.neuralRenderingConfigured)) return;
    g.frameToken = nullptr;
    if (g.getNewFrameToken(g.frameToken, &frameIndex) != sl::Result::eOk || !g.frameToken) return;
    if (g.reflexSleep) g.reflexSleep(*g.frameToken);
    setMarker(sl::PCLMarker::eSimulationStart);
}

void streamlineSimulationEnd() {
    std::lock_guard<std::mutex> lock(g.mutex);
    setMarker(sl::PCLMarker::eSimulationEnd);
}

void streamlineRenderSubmitBegin() {
    std::lock_guard<std::mutex> lock(g.mutex);
    setMarker(sl::PCLMarker::eRenderSubmitStart);
}

void streamlineRenderSubmitEnd() {
    std::lock_guard<std::mutex> lock(g.mutex);
    setMarker(sl::PCLMarker::eRenderSubmitEnd);
}

void streamlinePresentBegin() {
    std::lock_guard<std::mutex> lock(g.mutex);
    setMarker(sl::PCLMarker::ePresentStart);
}

void streamlinePresentEnd() {
    std::lock_guard<std::mutex> lock(g.mutex);
    setMarker(sl::PCLMarker::ePresentEnd);
}

StreamlineCapabilities streamlineCapabilities() {
    std::lock_guard<std::mutex> lock(g.mutex);
    return g.capabilities;
}

void streamlineShutdown() {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (g.features.frameGenerationFunctionsLoaded) {
        suspendFrameGenerationLocked("Frame Generation stopped during shutdown", true);
    }
#if defined(THREEBROWSER_DLSS_NEURAL_RENDERING)
    if (g.dlssNRSetOptions) {
        for (uint32_t viewportValue : g.neuralRenderingViewports) {
            const sl::ViewportHandle viewport(viewportValue);
            DLSSNeuralRenderingOptions off{};
            off.mode = static_cast<decltype(off.mode)>(0);
            g.dlssNRSetOptions(viewport, off);
            if (g.freeResources) g.freeResources(kFeatureDLSSNR, viewport);
        }
    }
#endif
    if (g.vkDeviceWaitIdle && g.vkDevice) g.vkDeviceWaitIdle(g.vkDevice);
    if (g.vkDestroyImageView && g.vkDevice) {
        for (const auto& [image, view] : g.imageViews) {
            (void)image;
            if (view) g.vkDestroyImageView(g.vkDevice, view, nullptr);
        }
    }
    g.imageViews.clear();
    g.frameGenerationImages.clear();
    g.rayReconstructionViewports.clear();
#if defined(THREEBROWSER_DLSS_NEURAL_RENDERING)
    g.neuralRenderingViewports.clear();
    g.neuralRenderingActiveViewports.clear();
#endif
    if (g.capabilities.initialized && g.shutdown) g.shutdown();
    if (g.module) FreeLibrary(g.module);
    SetEnvironmentVariableW(L"THREEBROWSER_STREAMLINE_VULKAN", nullptr);
    g.module = nullptr;
    g.init = nullptr;
    g.shutdown = nullptr;
    g.setVulkanInfo = nullptr;
    g.isFeatureSupported = nullptr;
    g.getFeatureFunction = nullptr;
    g.getNewFrameToken = nullptr;
    g.evaluateFeature = nullptr;
    g.allocateResources = nullptr;
    g.freeResources = nullptr;
    g.setTagForFrame = nullptr;
    g.setConstants = nullptr;
    g.dlssGetOptimalSettings = nullptr;
    g.dlssGetState = nullptr;
    g.dlssSetOptions = nullptr;
    g.dlssGGetState = nullptr;
    g.dlssGSetOptions = nullptr;
    g.dlssDGetOptimalSettings = nullptr;
    g.dlssDGetState = nullptr;
    g.dlssDSetOptions = nullptr;
#if defined(THREEBROWSER_DLSS_NEURAL_RENDERING)
    g.dlssNRSetOptions = nullptr;
#endif
    g.reflexSetOptions = nullptr;
    g.reflexSleep = nullptr;
    g.pclSetMarker = nullptr;
    g.frameToken = nullptr;
    g.vkDevice = nullptr;
    g.vkCreateImageView = nullptr;
    g.vkDestroyImageView = nullptr;
    g.vkDeviceWaitIdle = nullptr;
    g.reflexMode = 1;
    g.capabilities = {};
    g.features = {};
    g.dlssOptions = {};
    g.rayReconstructionOptions = {};
    g.frameGenerationOptions = {};
    g.frameGenerationViewport = 0;
    g.frameGenerationTaggedForPresent = false;
    g.constantsSetForFrame = false;
    g.constantsViewport = 0;
}

#else

bool streamlinePrepare() { return false; }
bool streamlineAttachVulkan(const StreamlineVulkanContext&) { return false; }
StreamlineCapabilities streamlineCapabilities() {
    StreamlineCapabilities capabilities{};
    capabilities.status = "Streamline support was disabled at build time";
    return capabilities;
}
bool streamlineSetReflexMode(int) { return false; }
int streamlineReflexMode() { return 0; }
bool streamlineRequestFeatures(const StreamlineDLSSOptions&, bool, bool) { return false; }
bool streamlineDLSSGetOptimalSettings(const StreamlineDLSSOptions&,
                                      StreamlineDLSSOptimalSettings&) { return false; }
bool streamlineDLSSEvaluate(const StreamlineDLSSFrame&) { return false; }
bool streamlineDLSSNREvaluate(const StreamlineDLSSNRFrame&) { return false; }
bool streamlineRayReconstructionEvaluate(
    const StreamlineRayReconstructionFrame&) { return false; }
bool streamlineFrameGenerationTag(const StreamlineFrameGenerationFrame&) { return false; }
void streamlineFrameGenerationBeforePresent(bool) {}
void streamlineFrameGenerationAfterPresent() {}
void streamlineSuspendFrameGeneration(const char*, bool) {}
void streamlineReleaseViewport(uint32_t) {}
void streamlineForgetVulkanImage(void*) {}
StreamlineFeatureState streamlineFeatureState() {
    StreamlineFeatureState state{};
    state.dlssReason = "Streamline support was disabled at build time";
    state.frameGenerationReason = state.dlssReason;
    state.rayReconstructionReason = state.dlssReason;
    state.neuralRenderingReason = state.dlssReason;
    return state;
}
void streamlineFrameBegin(uint32_t) {}
void streamlineSimulationEnd() {}
void streamlineRenderSubmitBegin() {}
void streamlineRenderSubmitEnd() {}
void streamlinePresentBegin() {}
void streamlinePresentEnd() {}
void streamlineShutdown() {}

#endif
