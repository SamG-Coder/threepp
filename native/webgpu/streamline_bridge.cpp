#include "streamline_bridge.h"

#if defined(THREEBROWSER_STREAMLINE)
#include <windows.h>

#include <array>
#include <filesystem>
#include <mutex>
#include <string_view>

#include <vulkan/vulkan.h>
#include <sl.h>
#include <sl_helpers_vk.h>
#include <sl_pcl.h>
#include <sl_reflex.h>

namespace {

struct Bridge {
    std::mutex mutex;
    HMODULE module{};
    PFun_slInit* init{};
    PFun_slShutdown* shutdown{};
    PFun_slSetVulkanInfo* setVulkanInfo{};
    PFun_slIsFeatureSupported* isFeatureSupported{};
    PFun_slGetFeatureFunction* getFeatureFunction{};
    PFun_slGetNewFrameToken* getNewFrameToken{};
    PFun_slReflexSetOptions* reflexSetOptions{};
    PFun_slReflexSleep* reflexSleep{};
    PFun_slPCLSetMarker* pclSetMarker{};
    sl::FrameToken* frameToken{};
    int reflexMode{1};
    StreamlineCapabilities capabilities{};
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
    if (!g.init || !g.shutdown || !g.setVulkanInfo || !g.isFeatureSupported ||
        !g.getFeatureFunction || !g.getNewFrameToken) {
        g.capabilities.status = "Streamline core exports are incomplete";
        FreeLibrary(g.module);
        g.module = nullptr;
        return false;
    }

    static const std::array<sl::Feature, 5> features{
        sl::kFeatureDLSS, sl::kFeatureDLSS_G, sl::kFeatureDLSS_RR,
        sl::kFeatureReflex, sl::kFeaturePCL};
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
    const sl::Result reflex = supportResult(sl::kFeatureReflex, context.physicalDevice);
    g.capabilities.dlssSuperResolution = dlss == sl::Result::eOk;
    g.capabilities.dlssFrameGeneration = frameGeneration == sl::Result::eOk;
    g.capabilities.dlssRayReconstruction = rayReconstruction == sl::Result::eOk;
    g.capabilities.reflex = reflex == sl::Result::eOk;
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
        std::to_string(static_cast<int>(rayReconstruction)) + " · Reflex " +
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

void streamlineFrameBegin(uint32_t frameIndex) {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (!g.capabilities.reflex || !g.getNewFrameToken) return;
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
    g.reflexSetOptions = nullptr;
    g.reflexSleep = nullptr;
    g.pclSetMarker = nullptr;
    g.frameToken = nullptr;
    g.reflexMode = 1;
    g.capabilities = {};
}

#else

bool streamlinePrepare() { return false; }
bool streamlineAttachVulkan(const StreamlineVulkanContext&) { return false; }
StreamlineCapabilities streamlineCapabilities() {
    return StreamlineCapabilities{false, false, false, false, false, false, false,
                                  "Streamline support was disabled at build time"};
}
bool streamlineSetReflexMode(int) { return false; }
int streamlineReflexMode() { return 0; }
void streamlineFrameBegin(uint32_t) {}
void streamlineSimulationEnd() {}
void streamlineRenderSubmitBegin() {}
void streamlineRenderSubmitEnd() {}
void streamlinePresentBegin() {}
void streamlinePresentEnd() {}
void streamlineShutdown() {}

#endif
