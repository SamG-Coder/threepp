#include "ray_query_bridge.h"

#if defined(THREEBROWSER_RAY_QUERY)

#ifndef NOMINMAX
#define NOMINMAX
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <vulkan/vulkan.h>

#include "threepp/renderers/vulkan/shaders/ray_query_lighting.comp.spv.h"
#include "threepp/renderers/vulkan/shaders/ray_query_reflections.comp.spv.h"
#include "threepp/renderers/vulkan/shaders/ray_query_reflections.comp.reflections_v2_r16.spv.h"
#include "threepp/renderers/vulkan/shaders/ray_query_reflections.comp.reflections_v2_r32.spv.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstring>
#include <limits>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

struct VulkanFunctions {
    PFN_vkGetPhysicalDeviceFeatures2 getPhysicalDeviceFeatures2{};
    PFN_vkGetPhysicalDeviceMemoryProperties getPhysicalDeviceMemoryProperties{};
    PFN_vkCreateBuffer createBuffer{};
    PFN_vkDestroyBuffer destroyBuffer{};
    PFN_vkGetBufferMemoryRequirements getBufferMemoryRequirements{};
    PFN_vkAllocateMemory allocateMemory{};
    PFN_vkFreeMemory freeMemory{};
    PFN_vkBindBufferMemory bindBufferMemory{};
    PFN_vkMapMemory mapMemory{};
    PFN_vkUnmapMemory unmapMemory{};
    PFN_vkFlushMappedMemoryRanges flushMappedMemoryRanges{};
    PFN_vkGetBufferDeviceAddress getBufferDeviceAddress{};
    PFN_vkCreateAccelerationStructureKHR createAccelerationStructure{};
    PFN_vkDestroyAccelerationStructureKHR destroyAccelerationStructure{};
    PFN_vkGetAccelerationStructureBuildSizesKHR getAccelerationStructureBuildSizes{};
    PFN_vkCmdBuildAccelerationStructuresKHR cmdBuildAccelerationStructures{};
    PFN_vkGetAccelerationStructureDeviceAddressKHR getAccelerationStructureDeviceAddress{};
    PFN_vkCreateDescriptorSetLayout createDescriptorSetLayout{};
    PFN_vkDestroyDescriptorSetLayout destroyDescriptorSetLayout{};
    PFN_vkCreateDescriptorPool createDescriptorPool{};
    PFN_vkDestroyDescriptorPool destroyDescriptorPool{};
    PFN_vkResetDescriptorPool resetDescriptorPool{};
    PFN_vkFreeDescriptorSets freeDescriptorSets{};
    PFN_vkAllocateDescriptorSets allocateDescriptorSets{};
    PFN_vkUpdateDescriptorSets updateDescriptorSets{};
    PFN_vkCreatePipelineLayout createPipelineLayout{};
    PFN_vkDestroyPipelineLayout destroyPipelineLayout{};
    PFN_vkCreateShaderModule createShaderModule{};
    PFN_vkDestroyShaderModule destroyShaderModule{};
    PFN_vkCreateComputePipelines createComputePipelines{};
    PFN_vkDestroyPipeline destroyPipeline{};
    PFN_vkCreateSampler createSampler{};
    PFN_vkDestroySampler destroySampler{};
    PFN_vkCreateImageView createImageView{};
    PFN_vkDestroyImageView destroyImageView{};
    PFN_vkCmdCopyBuffer cmdCopyBuffer{};
    PFN_vkCmdUpdateBuffer cmdUpdateBuffer{};
    PFN_vkCmdPipelineBarrier cmdPipelineBarrier{};
    PFN_vkCmdBindPipeline cmdBindPipeline{};
    PFN_vkCmdBindDescriptorSets cmdBindDescriptorSets{};
    PFN_vkCmdPushConstants cmdPushConstants{};
    PFN_vkCmdDispatch cmdDispatch{};
    PFN_vkDeviceWaitIdle deviceWaitIdle{};
};

struct Buffer {
    VkBuffer buffer{VK_NULL_HANDLE};
    VkDeviceMemory memory{VK_NULL_HANDLE};
    VkDeviceSize size{};
    VkDeviceSize allocationSize{};
    VkDeviceAddress address{};
    VkMemoryPropertyFlags memoryProperties{};
    bool coherent{};
};

struct AccelerationStructure {
    Buffer storage{};
    VkAccelerationStructureKHR handle{VK_NULL_HANDLE};
    VkDeviceAddress address{};
};

struct DescriptorKey {
    VkImage color{VK_NULL_HANDLE};
    VkImage depth{VK_NULL_HANDLE};

    bool operator==(const DescriptorKey&) const = default;
};

struct DescriptorKeyHash {
    std::size_t operator()(const DescriptorKey& key) const noexcept {
        const auto a = reinterpret_cast<std::uintptr_t>(key.color);
        const auto b = reinterpret_cast<std::uintptr_t>(key.depth);
        return (a >> 4u) ^ (b + 0x9e3779b97f4a7c15ull + (a << 6u) + (a >> 2u));
    }
};

struct DescriptorRecord {
    VkDescriptorSet set{VK_NULL_HANDLE};
    VkImageView colorView{VK_NULL_HANDLE};
    VkImageView depthView{VK_NULL_HANDLE};
};

struct ReflectionDescriptorKey {
    VkImage sourceColor{VK_NULL_HANDLE};
    VkImage outputColor{VK_NULL_HANDLE};
    VkImage depth{VK_NULL_HANDLE};
    VkImage normalRoughness{VK_NULL_HANDLE};
    VkImage specularAlbedo{VK_NULL_HANDLE};
    VkImage specularHitDistance{VK_NULL_HANDLE};
    VkFormat specularHitDistanceFormat{VK_FORMAT_UNDEFINED};

    bool operator==(const ReflectionDescriptorKey&) const = default;
};

struct ReflectionDescriptorKeyHash {
    std::size_t operator()(const ReflectionDescriptorKey& key) const noexcept {
        std::size_t value = 0x9e3779b97f4a7c15ull;
        const auto combine = [&value](VkImage image) {
            const auto part = reinterpret_cast<std::uintptr_t>(image);
            value ^= part + 0x9e3779b97f4a7c15ull + (value << 6u) + (value >> 2u);
        };
        combine(key.sourceColor);
        combine(key.outputColor);
        combine(key.depth);
        combine(key.normalRoughness);
        combine(key.specularAlbedo);
        combine(key.specularHitDistance);
        value ^= static_cast<std::size_t>(key.specularHitDistanceFormat) +
                 0x9e3779b97f4a7c15ull + (value << 6u) + (value >> 2u);
        return value;
    }
};

struct ReflectionDescriptorRecord {
    VkDescriptorSet set{VK_NULL_HANDLE};
    VkImageView sourceColorView{VK_NULL_HANDLE};
    VkImageView outputColorView{VK_NULL_HANDLE};
    VkImageView depthView{VK_NULL_HANDLE};
    VkImageView normalRoughnessView{VK_NULL_HANDLE};
    VkImageView specularAlbedoView{VK_NULL_HANDLE};
    VkImageView specularHitDistanceView{VK_NULL_HANDLE};
};

struct CustomPipeline {
    RayQueryPipelineProfile profile{RayQueryPipelineProfile::LightingV1};
    VkPipeline pipeline{VK_NULL_HANDLE};
};

struct PendingInstanceGroup {
    uint32_t id{};
    uint32_t capacity{};
    uint32_t vertexOffset{};
    uint32_t vertexCount{};
    uint32_t indexOffset{};
    uint32_t indexCount{};
    uint32_t primitiveBase{};
};

struct InstanceGroup {
    PendingInstanceGroup descriptor{};
    uint32_t firstInstance{};
    AccelerationStructure blas{};
    Buffer blasScratch{};
};

struct State {
    std::mutex mutex;
    VkInstance instance{VK_NULL_HANDLE};
    VkPhysicalDevice physicalDevice{VK_NULL_HANDLE};
    VkDevice device{VK_NULL_HANDLE};
    VkQueue queue{VK_NULL_HANDLE};
    uint32_t queueFamily{};
    VulkanFunctions vk{};
    bool attached{};
    bool webgpuFeatureEnabled{};
    bool accelerationStructureSupported{};
    bool rayQuerySupported{};

    VkDescriptorSetLayout descriptorLayout{VK_NULL_HANDLE};
    VkDescriptorPool descriptorPool{VK_NULL_HANDLE};
    VkPipelineLayout pipelineLayout{VK_NULL_HANDLE};
    VkPipeline pipeline{VK_NULL_HANDLE};
    VkSampler depthSampler{VK_NULL_HANDLE};
    std::unordered_map<DescriptorKey, DescriptorRecord, DescriptorKeyHash> descriptors;

    VkDescriptorSetLayout reflectionDescriptorLayout{VK_NULL_HANDLE};
    VkDescriptorPool reflectionDescriptorPool{VK_NULL_HANDLE};
    VkPipelineLayout reflectionPipelineLayout{VK_NULL_HANDLE};
    VkPipeline reflectionPipeline{VK_NULL_HANDLE};
    VkPipeline reflectionPipelineV2R16{VK_NULL_HANDLE};
    VkPipeline reflectionPipelineV2R32{VK_NULL_HANDLE};
    std::unordered_map<ReflectionDescriptorKey, ReflectionDescriptorRecord,
                       ReflectionDescriptorKeyHash> reflectionDescriptors;
    std::unordered_map<uint32_t, CustomPipeline> customPipelines;

    std::vector<float> pendingPositions;
    std::vector<uint32_t> pendingIndices;
    std::vector<float> pendingTriangleRadiance;
    std::vector<float> pendingTriangleSurface;
    std::vector<float> pendingStaticLights;
    std::vector<PendingInstanceGroup> pendingInstanceGroups;
    Buffer vertices{};
    Buffer indices{};
    Buffer triangleRadiance{};
    Buffer triangleSurface{};
    Buffer staticLights{};
    std::vector<Buffer> sceneUploadStaging;
    Buffer blasScratch{};
    Buffer instances{};
    Buffer tlasScratch{};
    AccelerationStructure blas{};
    AccelerationStructure tlas{};
    std::vector<InstanceGroup> instanceGroups;
    std::vector<VkAccelerationStructureInstanceKHR> instanceRecords;
    uint32_t tlasInstanceCount{};
    bool sceneReady{};
    uint32_t triangleCount{};
    uint64_t buildCount{};
    uint64_t evaluationCount{};
    uint64_t failureCount{};
    std::string status{"Ray query bridge is not attached"};
};

State g;

template<class T>
T loadInstanceProc(PFN_vkGetInstanceProcAddr getInstanceProc, VkInstance instance,
                   const char* name) {
    return reinterpret_cast<T>(getInstanceProc(instance, name));
}

template<class T>
T loadDeviceProc(PFN_vkGetDeviceProcAddr getDeviceProc, VkDevice device,
                 const char* name) {
    return reinterpret_cast<T>(getDeviceProc(device, name));
}

bool loadFunctions() {
    HMODULE module = GetModuleHandleW(L"sl.interposer.dll");
    if (!module) module = GetModuleHandleW(L"vulkan-1.dll");
    if (!module) module = LoadLibraryW(L"vulkan-1.dll");
    if (!module) return false;
    const auto getInstanceProc = reinterpret_cast<PFN_vkGetInstanceProcAddr>(
        GetProcAddress(module, "vkGetInstanceProcAddr"));
    const auto getDeviceProc = reinterpret_cast<PFN_vkGetDeviceProcAddr>(
        GetProcAddress(module, "vkGetDeviceProcAddr"));
    if (!getInstanceProc || !getDeviceProc) return false;

    auto& f = g.vk;
    f.getPhysicalDeviceFeatures2 = loadInstanceProc<PFN_vkGetPhysicalDeviceFeatures2>(
        getInstanceProc, g.instance, "vkGetPhysicalDeviceFeatures2");
    f.getPhysicalDeviceMemoryProperties =
        loadInstanceProc<PFN_vkGetPhysicalDeviceMemoryProperties>(
            getInstanceProc, g.instance, "vkGetPhysicalDeviceMemoryProperties");
#define LOAD_DEVICE(field, symbol) \
    f.field = loadDeviceProc<PFN_##symbol>(getDeviceProc, g.device, #symbol)
    LOAD_DEVICE(createBuffer, vkCreateBuffer);
    LOAD_DEVICE(destroyBuffer, vkDestroyBuffer);
    LOAD_DEVICE(getBufferMemoryRequirements, vkGetBufferMemoryRequirements);
    LOAD_DEVICE(allocateMemory, vkAllocateMemory);
    LOAD_DEVICE(freeMemory, vkFreeMemory);
    LOAD_DEVICE(bindBufferMemory, vkBindBufferMemory);
    LOAD_DEVICE(mapMemory, vkMapMemory);
    LOAD_DEVICE(unmapMemory, vkUnmapMemory);
    LOAD_DEVICE(flushMappedMemoryRanges, vkFlushMappedMemoryRanges);
    LOAD_DEVICE(getBufferDeviceAddress, vkGetBufferDeviceAddress);
    LOAD_DEVICE(createAccelerationStructure, vkCreateAccelerationStructureKHR);
    LOAD_DEVICE(destroyAccelerationStructure, vkDestroyAccelerationStructureKHR);
    LOAD_DEVICE(getAccelerationStructureBuildSizes, vkGetAccelerationStructureBuildSizesKHR);
    LOAD_DEVICE(cmdBuildAccelerationStructures, vkCmdBuildAccelerationStructuresKHR);
    LOAD_DEVICE(getAccelerationStructureDeviceAddress, vkGetAccelerationStructureDeviceAddressKHR);
    LOAD_DEVICE(createDescriptorSetLayout, vkCreateDescriptorSetLayout);
    LOAD_DEVICE(destroyDescriptorSetLayout, vkDestroyDescriptorSetLayout);
    LOAD_DEVICE(createDescriptorPool, vkCreateDescriptorPool);
    LOAD_DEVICE(destroyDescriptorPool, vkDestroyDescriptorPool);
    LOAD_DEVICE(resetDescriptorPool, vkResetDescriptorPool);
    LOAD_DEVICE(freeDescriptorSets, vkFreeDescriptorSets);
    LOAD_DEVICE(allocateDescriptorSets, vkAllocateDescriptorSets);
    LOAD_DEVICE(updateDescriptorSets, vkUpdateDescriptorSets);
    LOAD_DEVICE(createPipelineLayout, vkCreatePipelineLayout);
    LOAD_DEVICE(destroyPipelineLayout, vkDestroyPipelineLayout);
    LOAD_DEVICE(createShaderModule, vkCreateShaderModule);
    LOAD_DEVICE(destroyShaderModule, vkDestroyShaderModule);
    LOAD_DEVICE(createComputePipelines, vkCreateComputePipelines);
    LOAD_DEVICE(destroyPipeline, vkDestroyPipeline);
    LOAD_DEVICE(createSampler, vkCreateSampler);
    LOAD_DEVICE(destroySampler, vkDestroySampler);
    LOAD_DEVICE(createImageView, vkCreateImageView);
    LOAD_DEVICE(destroyImageView, vkDestroyImageView);
    LOAD_DEVICE(cmdCopyBuffer, vkCmdCopyBuffer);
    LOAD_DEVICE(cmdUpdateBuffer, vkCmdUpdateBuffer);
    LOAD_DEVICE(cmdPipelineBarrier, vkCmdPipelineBarrier);
    LOAD_DEVICE(cmdBindPipeline, vkCmdBindPipeline);
    LOAD_DEVICE(cmdBindDescriptorSets, vkCmdBindDescriptorSets);
    LOAD_DEVICE(cmdPushConstants, vkCmdPushConstants);
    LOAD_DEVICE(cmdDispatch, vkCmdDispatch);
    LOAD_DEVICE(deviceWaitIdle, vkDeviceWaitIdle);
#undef LOAD_DEVICE

    return f.getPhysicalDeviceFeatures2 && f.getPhysicalDeviceMemoryProperties &&
           f.createBuffer && f.destroyBuffer && f.getBufferMemoryRequirements &&
           f.allocateMemory && f.freeMemory && f.bindBufferMemory && f.mapMemory &&
           f.unmapMemory && f.flushMappedMemoryRanges && f.getBufferDeviceAddress &&
           f.createAccelerationStructure && f.destroyAccelerationStructure &&
           f.getAccelerationStructureBuildSizes && f.cmdBuildAccelerationStructures &&
           f.getAccelerationStructureDeviceAddress && f.createDescriptorSetLayout &&
           f.createDescriptorPool && f.destroyDescriptorPool && f.resetDescriptorPool &&
           f.freeDescriptorSets &&
           f.allocateDescriptorSets && f.updateDescriptorSets &&
           f.createPipelineLayout && f.createShaderModule && f.createComputePipelines &&
           f.destroyPipelineLayout && f.destroyShaderModule && f.destroyPipeline &&
           f.createSampler && f.destroySampler && f.createImageView &&
           f.destroyImageView && f.cmdCopyBuffer && f.cmdUpdateBuffer &&
           f.cmdPipelineBarrier &&
           f.cmdBindPipeline && f.cmdBindDescriptorSets && f.cmdPushConstants &&
           f.cmdDispatch && f.deviceWaitIdle;
}

void fail(const std::string& message) {
    ++g.failureCount;
    g.status = message;
}

constexpr uint32_t kSpirvMagic = 0x07230203u;
constexpr std::size_t kMaximumCustomSpirvWords = (1024u * 1024u) / 4u;
constexpr std::size_t kMaximumCustomPipelines = 256u;
constexpr std::size_t kMaximumEntryPointBytes = 255u;
constexpr uint16_t kSpirvOpEntryPoint = 15u;
constexpr uint16_t kSpirvOpExecutionMode = 16u;
constexpr uint32_t kSpirvExecutionModelGlCompute = 5u;
constexpr uint32_t kSpirvExecutionModeLocalSize = 17u;
constexpr std::array<uint32_t, 3> kProfileWorkgroupSize{{8u, 8u, 1u}};

bool validEntryPointName(const char* entryPoint) {
    if (!entryPoint) return false;
    const std::size_t length = std::strlen(entryPoint);
    if (length == 0 || length > kMaximumEntryPointBytes) return false;
    const auto first = static_cast<unsigned char>(entryPoint[0]);
    if (!(std::isalpha(first) || entryPoint[0] == '_')) return false;
    for (std::size_t index = 1; index < length; ++index) {
        const auto value = static_cast<unsigned char>(entryPoint[index]);
        if (!(std::isalnum(value) || entryPoint[index] == '_')) return false;
    }
    return true;
}

bool hasComputeEntryPoint(const uint32_t* words, std::size_t wordCount,
                          const char* entryPoint) {
    if (!words || wordCount < 5u || words[0] != kSpirvMagic || words[3] == 0u ||
        !validEntryPointName(entryPoint)) {
        return false;
    }
    const std::size_t wantedLength = std::strlen(entryPoint);
    uint32_t matchingEntryPointId = 0u;
    for (std::size_t offset = 5u; offset < wordCount;) {
        const uint32_t instruction = words[offset];
        const uint16_t instructionWords = static_cast<uint16_t>(instruction >> 16u);
        const uint16_t opcode = static_cast<uint16_t>(instruction & 0xffffu);
        if (instructionWords == 0u || offset + instructionWords > wordCount) return false;
        if (opcode == kSpirvOpEntryPoint && instructionWords >= 4u &&
            words[offset + 1u] == kSpirvExecutionModelGlCompute) {
            const char* encodedName = reinterpret_cast<const char*>(words + offset + 3u);
            const std::size_t encodedCapacity =
                static_cast<std::size_t>(instructionWords - 3u) * sizeof(uint32_t);
            const void* terminator = std::memchr(encodedName, '\0', encodedCapacity);
            if (!terminator) return false;
            const auto* end = static_cast<const char*>(terminator);
            const std::size_t encodedLength = static_cast<std::size_t>(end - encodedName);
            if (encodedLength == wantedLength &&
                std::memcmp(encodedName, entryPoint, wantedLength) == 0) {
                const uint32_t entryPointId = words[offset + 2u];
                if (matchingEntryPointId != 0u && matchingEntryPointId != entryPointId) {
                    return false;
                }
                matchingEntryPointId = entryPointId;
            }
        }
        offset += instructionWords;
    }
    if (matchingEntryPointId == 0u) return false;

    for (std::size_t offset = 5u; offset < wordCount;) {
        const uint32_t instruction = words[offset];
        const uint16_t instructionWords = static_cast<uint16_t>(instruction >> 16u);
        const uint16_t opcode = static_cast<uint16_t>(instruction & 0xffffu);
        if (instructionWords == 0u || offset + instructionWords > wordCount) return false;
        if (opcode == kSpirvOpExecutionMode && instructionWords == 6u &&
            words[offset + 1u] == matchingEntryPointId &&
            words[offset + 2u] == kSpirvExecutionModeLocalSize) {
            return words[offset + 3u] == kProfileWorkgroupSize[0] &&
                   words[offset + 4u] == kProfileWorkgroupSize[1] &&
                   words[offset + 5u] == kProfileWorkgroupSize[2];
        }
        offset += instructionWords;
    }
    return false;
}

uint32_t findMemoryType(uint32_t bits, VkMemoryPropertyFlags required,
                        VkMemoryPropertyFlags preferred, bool* coherent = nullptr,
                        VkMemoryPropertyFlags* selectedProperties = nullptr) {
    VkPhysicalDeviceMemoryProperties properties{};
    g.vk.getPhysicalDeviceMemoryProperties(g.physicalDevice, &properties);
    uint32_t fallback = std::numeric_limits<uint32_t>::max();
    for (uint32_t index = 0; index < properties.memoryTypeCount; ++index) {
        if ((bits & (1u << index)) == 0u) continue;
        const auto flags = properties.memoryTypes[index].propertyFlags;
        if ((flags & required) != required) continue;
        if ((flags & preferred) == preferred) {
            if (coherent) *coherent = (flags & VK_MEMORY_PROPERTY_HOST_COHERENT_BIT) != 0;
            if (selectedProperties) *selectedProperties = flags;
            return index;
        }
        if (fallback == std::numeric_limits<uint32_t>::max()) fallback = index;
    }
    if (fallback != std::numeric_limits<uint32_t>::max() && coherent) {
        *coherent = (properties.memoryTypes[fallback].propertyFlags &
                     VK_MEMORY_PROPERTY_HOST_COHERENT_BIT) != 0;
    }
    if (fallback != std::numeric_limits<uint32_t>::max() && selectedProperties) {
        *selectedProperties = properties.memoryTypes[fallback].propertyFlags;
    }
    return fallback;
}

void destroyBuffer(Buffer& buffer) {
    if (buffer.buffer) g.vk.destroyBuffer(g.device, buffer.buffer, nullptr);
    if (buffer.memory) g.vk.freeMemory(g.device, buffer.memory, nullptr);
    buffer = {};
}

bool createBuffer(VkDeviceSize size, VkBufferUsageFlags usage,
                  VkMemoryPropertyFlags requiredMemory,
                  VkMemoryPropertyFlags preferredMemory, Buffer& output) {
    output = {};
    output.size = std::max<VkDeviceSize>(size, 16);
    VkBufferCreateInfo create{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    create.size = output.size;
    create.usage = usage;
    create.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    if (g.vk.createBuffer(g.device, &create, nullptr, &output.buffer) != VK_SUCCESS) {
        fail("vkCreateBuffer failed for the ray-query bridge");
        return false;
    }
    VkMemoryRequirements requirements{};
    g.vk.getBufferMemoryRequirements(g.device, output.buffer, &requirements);
    const uint32_t memoryType = findMemoryType(requirements.memoryTypeBits,
                                                 requiredMemory, preferredMemory,
                                                 &output.coherent,
                                                 &output.memoryProperties);
    if (memoryType == std::numeric_limits<uint32_t>::max()) {
        fail("No compatible Vulkan memory type exists for ray-query resources");
        destroyBuffer(output);
        return false;
    }
    VkMemoryAllocateFlagsInfo flags{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_FLAGS_INFO};
    flags.flags = VK_MEMORY_ALLOCATE_DEVICE_ADDRESS_BIT;
    VkMemoryAllocateInfo allocate{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    allocate.pNext = &flags;
    allocate.allocationSize = requirements.size;
    allocate.memoryTypeIndex = memoryType;
    if (g.vk.allocateMemory(g.device, &allocate, nullptr, &output.memory) != VK_SUCCESS ||
        g.vk.bindBufferMemory(g.device, output.buffer, output.memory, 0) != VK_SUCCESS) {
        fail("Allocating Vulkan ray-query buffer memory failed");
        destroyBuffer(output);
        return false;
    }
    output.allocationSize = requirements.size;
    if ((usage & VK_BUFFER_USAGE_SHADER_DEVICE_ADDRESS_BIT) != 0u) {
        VkBufferDeviceAddressInfo address{VK_STRUCTURE_TYPE_BUFFER_DEVICE_ADDRESS_INFO};
        address.buffer = output.buffer;
        output.address = g.vk.getBufferDeviceAddress(g.device, &address);
        if (!output.address) {
            fail("Vulkan returned no device address for a ray-query buffer");
            destroyBuffer(output);
            return false;
        }
    }
    return true;
}

bool uploadBuffer(Buffer& buffer, const void* data, VkDeviceSize bytes) {
    if (!buffer.memory || !data ||
        (buffer.memoryProperties & VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT) == 0u ||
        bytes > buffer.size ||
        buffer.allocationSize < buffer.size) {
        fail("Invalid ray-query upload buffer range");
        return false;
    }
    void* mapped = nullptr;
    // Mapping the complete allocation lets VK_WHOLE_SIZE describe a valid
    // non-coherent flush without depending on nonCoherentAtomSize rounding.
    if (g.vk.mapMemory(g.device, buffer.memory, 0, buffer.allocationSize, 0, &mapped) != VK_SUCCESS || !mapped) {
        fail("Mapping a ray-query upload buffer failed");
        return false;
    }
    std::memcpy(mapped, data, static_cast<std::size_t>(bytes));
    if (!buffer.coherent) {
        VkMappedMemoryRange range{VK_STRUCTURE_TYPE_MAPPED_MEMORY_RANGE};
        range.memory = buffer.memory;
        range.offset = 0;
        range.size = VK_WHOLE_SIZE;
        if (g.vk.flushMappedMemoryRanges(g.device, 1, &range) != VK_SUCCESS) {
            g.vk.unmapMemory(g.device, buffer.memory);
            fail("Flushing a non-coherent ray-query upload buffer failed");
            return false;
        }
    }
    g.vk.unmapMemory(g.device, buffer.memory);
    return true;
}

struct PendingBufferCopy {
    VkBuffer source{VK_NULL_HANDLE};
    VkBuffer destination{VK_NULL_HANDLE};
    VkDeviceSize size{};
};

bool createImmutableSceneBuffer(VkDeviceSize size, VkBufferUsageFlags usage,
                                const void* data, Buffer& output,
                                std::vector<PendingBufferCopy>& pendingCopies) {
    // Prefer device-local storage so ray-query shader reads and AS traversal do
    // not repeatedly cross PCIe. Integrated/ReBAR memory may also be host
    // visible, in which case a direct upload is both valid and cheaper.
    if (!createBuffer(size, usage | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
                      0, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, output)) {
        return false;
    }
    if ((output.memoryProperties & VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT) != 0u) {
        return uploadBuffer(output, data, size);
    }

    Buffer staging{};
    if (!createBuffer(size, VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                      VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT,
                      VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                          VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                      staging) ||
        !uploadBuffer(staging, data, size)) {
        destroyBuffer(staging);
        return false;
    }
    pendingCopies.push_back({staging.buffer, output.buffer, size});
    g.sceneUploadStaging.push_back(staging);
    return true;
}

void destroyAccelerationStructure(AccelerationStructure& structure) {
    if (structure.handle) {
        g.vk.destroyAccelerationStructure(g.device, structure.handle, nullptr);
    }
    destroyBuffer(structure.storage);
    structure = {};
}

void resetDescriptorCache() {
    if (!g.device) return;
    for (auto& [key, record] : g.descriptors) {
        (void)key;
        if (record.colorView) g.vk.destroyImageView(g.device, record.colorView, nullptr);
        if (record.depthView) g.vk.destroyImageView(g.device, record.depthView, nullptr);
    }
    g.descriptors.clear();
    if (g.descriptorPool && g.vk.resetDescriptorPool) {
        g.vk.resetDescriptorPool(g.device, g.descriptorPool, 0);
    }
}

void destroyReflectionViews(ReflectionDescriptorRecord& record) {
    if (record.sourceColorView) {
        g.vk.destroyImageView(g.device, record.sourceColorView, nullptr);
    }
    if (record.outputColorView) {
        g.vk.destroyImageView(g.device, record.outputColorView, nullptr);
    }
    if (record.depthView) g.vk.destroyImageView(g.device, record.depthView, nullptr);
    if (record.normalRoughnessView) {
        g.vk.destroyImageView(g.device, record.normalRoughnessView, nullptr);
    }
    if (record.specularAlbedoView) {
        g.vk.destroyImageView(g.device, record.specularAlbedoView, nullptr);
    }
    if (record.specularHitDistanceView) {
        g.vk.destroyImageView(g.device, record.specularHitDistanceView, nullptr);
    }
    record.sourceColorView = VK_NULL_HANDLE;
    record.outputColorView = VK_NULL_HANDLE;
    record.depthView = VK_NULL_HANDLE;
    record.normalRoughnessView = VK_NULL_HANDLE;
    record.specularAlbedoView = VK_NULL_HANDLE;
    record.specularHitDistanceView = VK_NULL_HANDLE;
}

void resetReflectionDescriptorCache() {
    if (!g.device) return;
    for (auto& [key, record] : g.reflectionDescriptors) {
        (void)key;
        destroyReflectionViews(record);
    }
    g.reflectionDescriptors.clear();
    if (g.reflectionDescriptorPool && g.vk.resetDescriptorPool) {
        g.vk.resetDescriptorPool(g.device, g.reflectionDescriptorPool, 0);
    }
}

bool createAccelerationStructure(VkAccelerationStructureTypeKHR type,
                                 VkDeviceSize size,
                                 AccelerationStructure& output) {
    if (!createBuffer(size,
                      VK_BUFFER_USAGE_ACCELERATION_STRUCTURE_STORAGE_BIT_KHR |
                      VK_BUFFER_USAGE_SHADER_DEVICE_ADDRESS_BIT,
                      VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT,
                      VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT,
                      output.storage)) {
        return false;
    }
    VkAccelerationStructureCreateInfoKHR create{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_CREATE_INFO_KHR};
    create.buffer = output.storage.buffer;
    create.size = size;
    create.type = type;
    if (g.vk.createAccelerationStructure(g.device, &create, nullptr,
                                         &output.handle) != VK_SUCCESS) {
        fail("vkCreateAccelerationStructureKHR failed");
        destroyAccelerationStructure(output);
        return false;
    }
    return true;
}

void destroySceneResources(bool wait) {
    if (!g.device) return;
    if (wait && g.vk.deviceWaitIdle) g.vk.deviceWaitIdle(g.device);
    // Every cached set contains the TLAS handle. It must not survive a scene
    // rebuild, even when the borrowed color/depth images are unchanged.
    resetDescriptorCache();
    resetReflectionDescriptorCache();
    destroyAccelerationStructure(g.tlas);
    for (auto& group : g.instanceGroups) {
        destroyAccelerationStructure(group.blas);
        destroyBuffer(group.blasScratch);
    }
    g.instanceGroups.clear();
    g.instanceRecords.clear();
    g.tlasInstanceCount = 0u;
    destroyAccelerationStructure(g.blas);
    destroyBuffer(g.tlasScratch);
    destroyBuffer(g.instances);
    destroyBuffer(g.blasScratch);
    destroyBuffer(g.indices);
    destroyBuffer(g.vertices);
    destroyBuffer(g.triangleRadiance);
    destroyBuffer(g.triangleSurface);
    destroyBuffer(g.staticLights);
    for (auto& staging : g.sceneUploadStaging) destroyBuffer(staging);
    g.sceneUploadStaging.clear();
    g.sceneReady = false;
    g.triangleCount = 0;
}

bool createPipeline() {
    const std::array<VkDescriptorSetLayoutBinding, 3> bindings{{
        {0, VK_DESCRIPTOR_TYPE_ACCELERATION_STRUCTURE_KHR, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {2, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
    }};
    VkDescriptorSetLayoutCreateInfo descriptorLayout{
        VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
    descriptorLayout.bindingCount = static_cast<uint32_t>(bindings.size());
    descriptorLayout.pBindings = bindings.data();
    if (g.vk.createDescriptorSetLayout(g.device, &descriptorLayout, nullptr,
                                       &g.descriptorLayout) != VK_SUCCESS) {
        fail("Creating the ray-query descriptor layout failed");
        return false;
    }
    const std::array<VkDescriptorPoolSize, 3> poolSizes{{
        {VK_DESCRIPTOR_TYPE_ACCELERATION_STRUCTURE_KHR, 256},
        {VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 256},
        {VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 256},
    }};
    VkDescriptorPoolCreateInfo pool{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
    pool.flags = VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT;
    pool.maxSets = 256;
    pool.poolSizeCount = static_cast<uint32_t>(poolSizes.size());
    pool.pPoolSizes = poolSizes.data();
    if (g.vk.createDescriptorPool(g.device, &pool, nullptr, &g.descriptorPool) != VK_SUCCESS) {
        fail("Creating the ray-query descriptor pool failed");
        return false;
    }
    VkPushConstantRange push{};
    push.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    push.size = 128;
    VkPipelineLayoutCreateInfo pipelineLayout{
        VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    pipelineLayout.setLayoutCount = 1;
    pipelineLayout.pSetLayouts = &g.descriptorLayout;
    pipelineLayout.pushConstantRangeCount = 1;
    pipelineLayout.pPushConstantRanges = &push;
    if (g.vk.createPipelineLayout(g.device, &pipelineLayout, nullptr,
                                  &g.pipelineLayout) != VK_SUCCESS) {
        fail("Creating the ray-query pipeline layout failed");
        return false;
    }
    VkShaderModuleCreateInfo shader{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    shader.codeSize = sizeof(kRayQueryLightingCompSpv);
    shader.pCode = kRayQueryLightingCompSpv;
    VkShaderModule shaderModule{VK_NULL_HANDLE};
    if (g.vk.createShaderModule(g.device, &shader, nullptr, &shaderModule) != VK_SUCCESS) {
        fail("Creating the ray-query compute shader failed");
        return false;
    }
    VkPipelineShaderStageCreateInfo stage{VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
    stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    stage.module = shaderModule;
    stage.pName = "main";
    VkComputePipelineCreateInfo pipeline{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
    pipeline.stage = stage;
    pipeline.layout = g.pipelineLayout;
    const VkResult pipelineResult = g.vk.createComputePipelines(
        g.device, VK_NULL_HANDLE, 1, &pipeline, nullptr, &g.pipeline);
    g.vk.destroyShaderModule(g.device, shaderModule, nullptr);
    if (pipelineResult != VK_SUCCESS) {
        fail("Creating the ray-query compute pipeline failed");
        return false;
    }
    VkSamplerCreateInfo sampler{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
    sampler.magFilter = VK_FILTER_NEAREST;
    sampler.minFilter = VK_FILTER_NEAREST;
    sampler.mipmapMode = VK_SAMPLER_MIPMAP_MODE_NEAREST;
    sampler.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    sampler.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    sampler.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    sampler.maxLod = 0.0f;
    if (g.vk.createSampler(g.device, &sampler, nullptr, &g.depthSampler) != VK_SUCCESS) {
        fail("Creating the ray-query depth sampler failed");
        return false;
    }
    return true;
}

bool createReflectionPipeline() {
    const std::array<VkDescriptorSetLayoutBinding, 12> bindings{{
        {0, VK_DESCRIPTOR_TYPE_ACCELERATION_STRUCTURE_KHR, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {2, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {3, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {4, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {5, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {7, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {9, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {10, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {11, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1,
         VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
    }};
    VkDescriptorSetLayoutCreateInfo descriptorLayout{
        VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
    descriptorLayout.bindingCount = static_cast<uint32_t>(bindings.size());
    descriptorLayout.pBindings = bindings.data();
    if (g.vk.createDescriptorSetLayout(g.device, &descriptorLayout, nullptr,
                                       &g.reflectionDescriptorLayout) != VK_SUCCESS) {
        fail("Creating the ray-query reflection descriptor layout failed");
        return false;
    }
    const std::array<VkDescriptorPoolSize, 4> poolSizes{{
        {VK_DESCRIPTOR_TYPE_ACCELERATION_STRUCTURE_KHR, 256},
        {VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 512},
        {VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1024},
        {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1280},
    }};
    VkDescriptorPoolCreateInfo pool{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
    pool.flags = VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT;
    pool.maxSets = 256;
    pool.poolSizeCount = static_cast<uint32_t>(poolSizes.size());
    pool.pPoolSizes = poolSizes.data();
    if (g.vk.createDescriptorPool(g.device, &pool, nullptr,
                                  &g.reflectionDescriptorPool) != VK_SUCCESS) {
        fail("Creating the ray-query reflection descriptor pool failed");
        return false;
    }
    VkPushConstantRange push{};
    push.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    push.size = 128;
    VkPipelineLayoutCreateInfo pipelineLayout{
        VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    pipelineLayout.setLayoutCount = 1;
    pipelineLayout.pSetLayouts = &g.reflectionDescriptorLayout;
    pipelineLayout.pushConstantRangeCount = 1;
    pipelineLayout.pPushConstantRanges = &push;
    if (g.vk.createPipelineLayout(g.device, &pipelineLayout, nullptr,
                                  &g.reflectionPipelineLayout) != VK_SUCCESS) {
        fail("Creating the ray-query reflection pipeline layout failed");
        return false;
    }
    VkShaderModuleCreateInfo shader{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    shader.codeSize = sizeof(kRayQueryReflectionsCompSpv);
    shader.pCode = kRayQueryReflectionsCompSpv;
    VkShaderModule shaderModule{VK_NULL_HANDLE};
    if (g.vk.createShaderModule(g.device, &shader, nullptr, &shaderModule) != VK_SUCCESS) {
        fail("Creating the ray-query reflection compute shader failed");
        return false;
    }
    VkPipelineShaderStageCreateInfo stage{VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
    stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    stage.module = shaderModule;
    stage.pName = "main";
    VkComputePipelineCreateInfo pipeline{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
    pipeline.stage = stage;
    pipeline.layout = g.reflectionPipelineLayout;
    const VkResult pipelineResult = g.vk.createComputePipelines(
        g.device, VK_NULL_HANDLE, 1, &pipeline, nullptr, &g.reflectionPipeline);
    g.vk.destroyShaderModule(g.device, shaderModule, nullptr);
    if (pipelineResult != VK_SUCCESS) {
        fail("Creating the ray-query reflection compute pipeline failed");
        return false;
    }
    const auto createVariant = [](const uint32_t* code, std::size_t codeSize,
                                  VkPipeline& output) {
        VkShaderModuleCreateInfo moduleCreate{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
        moduleCreate.codeSize = codeSize;
        moduleCreate.pCode = code;
        VkShaderModule module{VK_NULL_HANDLE};
        if (g.vk.createShaderModule(g.device, &moduleCreate, nullptr, &module) != VK_SUCCESS) {
            return false;
        }
        VkPipelineShaderStageCreateInfo variantStage{
            VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
        variantStage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        variantStage.module = module;
        variantStage.pName = "main";
        VkComputePipelineCreateInfo variantCreate{
            VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
        variantCreate.stage = variantStage;
        variantCreate.layout = g.reflectionPipelineLayout;
        const VkResult result = g.vk.createComputePipelines(
            g.device, VK_NULL_HANDLE, 1, &variantCreate, nullptr, &output);
        g.vk.destroyShaderModule(g.device, module, nullptr);
        return result == VK_SUCCESS && output != VK_NULL_HANDLE;
    };
    if (!createVariant(kRayQueryReflectionsV2R16CompSpv,
                       sizeof(kRayQueryReflectionsV2R16CompSpv),
                       g.reflectionPipelineV2R16) ||
        !createVariant(kRayQueryReflectionsV2R32CompSpv,
                       sizeof(kRayQueryReflectionsV2R32CompSpv),
                       g.reflectionPipelineV2R32)) {
        fail("Creating a reflections-v2 hit-distance compute pipeline failed");
        return false;
    }
    return true;
}

VkPipelineLayout pipelineLayoutForProfile(RayQueryPipelineProfile profile) {
    switch (profile) {
        case RayQueryPipelineProfile::LightingV1:
            return g.pipelineLayout;
        case RayQueryPipelineProfile::ReflectionsV1:
        case RayQueryPipelineProfile::ReflectionsV2:
            return g.reflectionPipelineLayout;
    }
    return VK_NULL_HANDLE;
}

bool createCustomPipeline(uint32_t handle, RayQueryPipelineProfile profile,
                          const uint32_t* spirvWords, std::size_t wordCount,
                          const char* entryPoint) {
    if (!g.attached || !g.device || handle == 0u ||
        wordCount < 5u || wordCount > kMaximumCustomSpirvWords ||
        g.customPipelines.size() >= kMaximumCustomPipelines ||
        (reinterpret_cast<std::uintptr_t>(spirvWords) &
         (alignof(uint32_t) - 1u)) != 0u ||
        !hasComputeEntryPoint(spirvWords, wordCount, entryPoint)) {
        fail("Invalid custom ray-query compute pipeline payload");
        return false;
    }
    if (g.customPipelines.contains(handle)) {
        fail("Custom ray-query pipeline handle is already in use");
        return false;
    }
    const VkPipelineLayout layout = pipelineLayoutForProfile(profile);
    if (!layout) {
        fail("Custom ray-query pipeline profile is unsupported");
        return false;
    }

    VkShaderModuleCreateInfo shader{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    shader.codeSize = wordCount * sizeof(uint32_t);
    shader.pCode = spirvWords;
    VkShaderModule shaderModule{VK_NULL_HANDLE};
    if (g.vk.createShaderModule(g.device, &shader, nullptr, &shaderModule) != VK_SUCCESS) {
        fail("Creating a custom ray-query shader module failed");
        return false;
    }
    VkPipelineShaderStageCreateInfo stage{VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
    stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    stage.module = shaderModule;
    stage.pName = entryPoint;
    VkComputePipelineCreateInfo create{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
    create.stage = stage;
    create.layout = layout;
    VkPipeline pipeline{VK_NULL_HANDLE};
    const VkResult result = g.vk.createComputePipelines(
        g.device, VK_NULL_HANDLE, 1, &create, nullptr, &pipeline);
    g.vk.destroyShaderModule(g.device, shaderModule, nullptr);
    if (result != VK_SUCCESS || !pipeline) {
        fail("Creating a custom ray-query compute pipeline failed");
        return false;
    }
    g.customPipelines.emplace(handle, CustomPipeline{profile, pipeline});
    g.status = "Custom ray-query compute pipeline created";
    return true;
}

void destroyCustomPipelines(bool wait) {
    if (!g.device) {
        g.customPipelines.clear();
        return;
    }
    if (wait && g.vk.deviceWaitIdle) g.vk.deviceWaitIdle(g.device);
    for (const auto& [handle, record] : g.customPipelines) {
        (void)handle;
        if (record.pipeline) g.vk.destroyPipeline(g.device, record.pipeline, nullptr);
    }
    g.customPipelines.clear();
}

VkPipeline customPipeline(uint32_t handle, RayQueryPipelineProfile requiredProfile) {
    const auto iterator = g.customPipelines.find(handle);
    if (iterator == g.customPipelines.end()) {
        fail("Ray-query evaluation references an unknown custom pipeline handle");
        return VK_NULL_HANDLE;
    }
    if (iterator->second.profile != requiredProfile) {
        fail("Custom ray-query pipeline profile does not match the evaluation pass");
        return VK_NULL_HANDLE;
    }
    return iterator->second.pipeline;
}

void destroyPipelineResources() {
    if (!g.device) return;
    resetDescriptorCache();
    resetReflectionDescriptorCache();
    destroyCustomPipelines(false);
    if (g.depthSampler) g.vk.destroySampler(g.device, g.depthSampler, nullptr);
    if (g.reflectionPipeline) {
        g.vk.destroyPipeline(g.device, g.reflectionPipeline, nullptr);
    }
    if (g.reflectionPipelineV2R16) {
        g.vk.destroyPipeline(g.device, g.reflectionPipelineV2R16, nullptr);
    }
    if (g.reflectionPipelineV2R32) {
        g.vk.destroyPipeline(g.device, g.reflectionPipelineV2R32, nullptr);
    }
    if (g.reflectionPipelineLayout) {
        g.vk.destroyPipelineLayout(g.device, g.reflectionPipelineLayout, nullptr);
    }
    if (g.reflectionDescriptorPool) {
        g.vk.destroyDescriptorPool(g.device, g.reflectionDescriptorPool, nullptr);
    }
    if (g.reflectionDescriptorLayout) {
        g.vk.destroyDescriptorSetLayout(g.device, g.reflectionDescriptorLayout, nullptr);
    }
    if (g.pipeline) g.vk.destroyPipeline(g.device, g.pipeline, nullptr);
    if (g.pipelineLayout) g.vk.destroyPipelineLayout(g.device, g.pipelineLayout, nullptr);
    if (g.descriptorPool) g.vk.destroyDescriptorPool(g.device, g.descriptorPool, nullptr);
    if (g.descriptorLayout) {
        g.vk.destroyDescriptorSetLayout(g.device, g.descriptorLayout, nullptr);
    }
    g.depthSampler = VK_NULL_HANDLE;
    g.reflectionPipeline = VK_NULL_HANDLE;
    g.reflectionPipelineV2R16 = VK_NULL_HANDLE;
    g.reflectionPipelineV2R32 = VK_NULL_HANDLE;
    g.reflectionPipelineLayout = VK_NULL_HANDLE;
    g.reflectionDescriptorPool = VK_NULL_HANDLE;
    g.reflectionDescriptorLayout = VK_NULL_HANDLE;
    g.pipeline = VK_NULL_HANDLE;
    g.pipelineLayout = VK_NULL_HANDLE;
    g.descriptorPool = VK_NULL_HANDLE;
    g.descriptorLayout = VK_NULL_HANDLE;
}

VkImageView createImageView(VkImage image, VkFormat format,
                            VkImageAspectFlags aspect) {
    VkImageViewCreateInfo create{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
    create.image = image;
    create.viewType = VK_IMAGE_VIEW_TYPE_2D;
    create.format = format;
    create.subresourceRange.aspectMask = aspect;
    create.subresourceRange.levelCount = 1;
    create.subresourceRange.layerCount = 1;
    VkImageView view{VK_NULL_HANDLE};
    if (g.vk.createImageView(g.device, &create, nullptr, &view) != VK_SUCCESS) {
        return VK_NULL_HANDLE;
    }
    return view;
}

VkDescriptorSet descriptorFor(VkImage color, VkImage depth) {
    const DescriptorKey key{color, depth};
    if (const auto found = g.descriptors.find(key); found != g.descriptors.end()) {
        return found->second.set;
    }
    DescriptorRecord record{};
    record.colorView = createImageView(color, VK_FORMAT_R16G16B16A16_SFLOAT,
                                       VK_IMAGE_ASPECT_COLOR_BIT);
    record.depthView = createImageView(depth, VK_FORMAT_D32_SFLOAT,
                                       VK_IMAGE_ASPECT_DEPTH_BIT);
    if (!record.colorView || !record.depthView) {
        if (record.colorView) g.vk.destroyImageView(g.device, record.colorView, nullptr);
        if (record.depthView) g.vk.destroyImageView(g.device, record.depthView, nullptr);
        fail("Creating borrowed WebGPU image views for ray-query lighting failed");
        return VK_NULL_HANDLE;
    }
    VkDescriptorSetAllocateInfo allocate{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
    allocate.descriptorPool = g.descriptorPool;
    allocate.descriptorSetCount = 1;
    allocate.pSetLayouts = &g.descriptorLayout;
    if (g.vk.allocateDescriptorSets(g.device, &allocate, &record.set) != VK_SUCCESS) {
        g.vk.destroyImageView(g.device, record.colorView, nullptr);
        g.vk.destroyImageView(g.device, record.depthView, nullptr);
        fail("Allocating a ray-query descriptor set failed");
        return VK_NULL_HANDLE;
    }
    VkWriteDescriptorSetAccelerationStructureKHR asWrite{
        VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET_ACCELERATION_STRUCTURE_KHR};
    asWrite.accelerationStructureCount = 1;
    asWrite.pAccelerationStructures = &g.tlas.handle;
    VkDescriptorImageInfo colorInfo{};
    colorInfo.imageView = record.colorView;
    colorInfo.imageLayout = VK_IMAGE_LAYOUT_GENERAL;
    VkDescriptorImageInfo depthInfo{};
    depthInfo.sampler = g.depthSampler;
    depthInfo.imageView = record.depthView;
    depthInfo.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    std::array<VkWriteDescriptorSet, 3> writes{};
    writes[0] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
    writes[0].pNext = &asWrite;
    writes[0].dstSet = record.set;
    writes[0].dstBinding = 0;
    writes[0].descriptorCount = 1;
    writes[0].descriptorType = VK_DESCRIPTOR_TYPE_ACCELERATION_STRUCTURE_KHR;
    writes[1] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
    writes[1].dstSet = record.set;
    writes[1].dstBinding = 1;
    writes[1].descriptorCount = 1;
    writes[1].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
    writes[1].pImageInfo = &colorInfo;
    writes[2] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
    writes[2].dstSet = record.set;
    writes[2].dstBinding = 2;
    writes[2].descriptorCount = 1;
    writes[2].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    writes[2].pImageInfo = &depthInfo;
    g.vk.updateDescriptorSets(g.device, static_cast<uint32_t>(writes.size()),
                              writes.data(), 0, nullptr);
    g.descriptors.emplace(key, record);
    return record.set;
}

VkDescriptorSet reflectionDescriptorFor(const ReflectionDescriptorKey& key) {
    if (const auto found = g.reflectionDescriptors.find(key);
        found != g.reflectionDescriptors.end()) {
        return found->second.set;
    }
    if (!g.triangleRadiance.buffer || !g.vertices.buffer || !g.indices.buffer ||
        !g.triangleSurface.buffer || !g.staticLights.buffer ||
        g.triangleRadiance.size < sizeof(float) * 4u ||
        g.triangleSurface.size < sizeof(float) * 4u ||
        g.staticLights.size < sizeof(float) * 16u) {
        fail("Ray-query reflections require scene geometry, radiance, surfaces and a static-light buffer");
        return VK_NULL_HANDLE;
    }
    ReflectionDescriptorRecord record{};
    record.sourceColorView = createImageView(
        key.sourceColor, VK_FORMAT_R16G16B16A16_SFLOAT, VK_IMAGE_ASPECT_COLOR_BIT);
    record.outputColorView = createImageView(
        key.outputColor, VK_FORMAT_R16G16B16A16_SFLOAT, VK_IMAGE_ASPECT_COLOR_BIT);
    record.depthView = createImageView(
        key.depth, VK_FORMAT_D32_SFLOAT, VK_IMAGE_ASPECT_DEPTH_BIT);
    record.normalRoughnessView = createImageView(
        key.normalRoughness, VK_FORMAT_R16G16B16A16_SFLOAT,
        VK_IMAGE_ASPECT_COLOR_BIT);
    record.specularAlbedoView = createImageView(
        key.specularAlbedo, VK_FORMAT_R16G16B16A16_SFLOAT,
        VK_IMAGE_ASPECT_COLOR_BIT);
    if (key.specularHitDistance) {
        if (key.specularHitDistanceFormat != VK_FORMAT_R16_SFLOAT &&
            key.specularHitDistanceFormat != VK_FORMAT_R32_SFLOAT) {
            destroyReflectionViews(record);
            fail("Ray-query reflection hit distance must use R16_SFLOAT or R32_SFLOAT");
            return VK_NULL_HANDLE;
        }
        record.specularHitDistanceView = createImageView(
            key.specularHitDistance, key.specularHitDistanceFormat,
            VK_IMAGE_ASPECT_COLOR_BIT);
    }
    if (!record.sourceColorView || !record.outputColorView || !record.depthView ||
        !record.normalRoughnessView || !record.specularAlbedoView ||
        (key.specularHitDistance && !record.specularHitDistanceView)) {
        destroyReflectionViews(record);
        fail("Creating borrowed WebGPU image views for ray-query reflections failed");
        return VK_NULL_HANDLE;
    }
    VkDescriptorSetAllocateInfo allocate{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
    allocate.descriptorPool = g.reflectionDescriptorPool;
    allocate.descriptorSetCount = 1;
    allocate.pSetLayouts = &g.reflectionDescriptorLayout;
    if (g.vk.allocateDescriptorSets(g.device, &allocate, &record.set) != VK_SUCCESS) {
        destroyReflectionViews(record);
        fail("Allocating a ray-query reflection descriptor set failed");
        return VK_NULL_HANDLE;
    }

    VkWriteDescriptorSetAccelerationStructureKHR asWrite{
        VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET_ACCELERATION_STRUCTURE_KHR};
    asWrite.accelerationStructureCount = 1;
    asWrite.pAccelerationStructures = &g.tlas.handle;
    VkDescriptorImageInfo outputInfo{};
    outputInfo.imageView = record.outputColorView;
    outputInfo.imageLayout = VK_IMAGE_LAYOUT_GENERAL;
    VkDescriptorImageInfo hitDistanceInfo{};
    hitDistanceInfo.imageView = record.specularHitDistanceView;
    hitDistanceInfo.imageLayout = VK_IMAGE_LAYOUT_GENERAL;
    const auto sampledInfo = [](VkSampler sampler, VkImageView view) {
        VkDescriptorImageInfo info{};
        info.sampler = sampler;
        info.imageView = view;
        info.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        return info;
    };
    const VkDescriptorImageInfo sourceInfo = sampledInfo(g.depthSampler,
                                                         record.sourceColorView);
    const VkDescriptorImageInfo depthInfo = sampledInfo(g.depthSampler,
                                                        record.depthView);
    const VkDescriptorImageInfo normalInfo = sampledInfo(g.depthSampler,
                                                         record.normalRoughnessView);
    const VkDescriptorImageInfo specularInfo = sampledInfo(g.depthSampler,
                                                           record.specularAlbedoView);
    VkDescriptorBufferInfo radianceInfo{};
    radianceInfo.buffer = g.triangleRadiance.buffer;
    radianceInfo.offset = 0;
    radianceInfo.range = g.triangleRadiance.size;
    VkDescriptorBufferInfo vertexInfo{};
    vertexInfo.buffer = g.vertices.buffer;
    vertexInfo.offset = 0;
    vertexInfo.range = g.vertices.size;
    VkDescriptorBufferInfo indexInfo{};
    indexInfo.buffer = g.indices.buffer;
    indexInfo.offset = 0;
    indexInfo.range = g.indices.size;
    VkDescriptorBufferInfo surfaceInfo{};
    surfaceInfo.buffer = g.triangleSurface.buffer;
    surfaceInfo.offset = 0;
    surfaceInfo.range = g.triangleSurface.size;
    VkDescriptorBufferInfo lightsInfo{};
    lightsInfo.buffer = g.staticLights.buffer;
    lightsInfo.offset = 0;
    lightsInfo.range = g.staticLights.size;

    std::array<VkWriteDescriptorSet, 12> writes{};
    writes[0] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
    writes[0].pNext = &asWrite;
    writes[0].dstSet = record.set;
    writes[0].dstBinding = 0;
    writes[0].descriptorCount = 1;
    writes[0].descriptorType = VK_DESCRIPTOR_TYPE_ACCELERATION_STRUCTURE_KHR;
    writes[1] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
    writes[1].dstSet = record.set;
    writes[1].dstBinding = 1;
    writes[1].descriptorCount = 1;
    writes[1].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
    writes[1].pImageInfo = &outputInfo;
    const std::array<const VkDescriptorImageInfo*, 4> sampledInfos{{
        &sourceInfo, &depthInfo, &normalInfo, &specularInfo,
    }};
    for (uint32_t index = 0; index < sampledInfos.size(); ++index) {
        writes[2u + index] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
        writes[2u + index].dstSet = record.set;
        writes[2u + index].dstBinding = 2u + index;
        writes[2u + index].descriptorCount = 1;
        writes[2u + index].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        writes[2u + index].pImageInfo = sampledInfos[index];
    }
    writes[6] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
    writes[6].dstSet = record.set;
    writes[6].dstBinding = 6;
    writes[6].descriptorCount = 1;
    writes[6].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    writes[6].pBufferInfo = &radianceInfo;
    const std::array<const VkDescriptorBufferInfo*, 4> sceneBuffers{{
        &vertexInfo, &indexInfo, &surfaceInfo, &lightsInfo,
    }};
    for (uint32_t index = 0; index < sceneBuffers.size(); ++index) {
        writes[7u + index] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
        writes[7u + index].dstSet = record.set;
        writes[7u + index].dstBinding = 7u + index;
        writes[7u + index].descriptorCount = 1;
        writes[7u + index].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        writes[7u + index].pBufferInfo = sceneBuffers[index];
    }
    uint32_t writeCount = 11u;
    if (record.specularHitDistanceView) {
        writes[11] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
        writes[11].dstSet = record.set;
        writes[11].dstBinding = 11;
        writes[11].descriptorCount = 1;
        writes[11].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
        writes[11].pImageInfo = &hitDistanceInfo;
        writeCount = 12u;
    }
    g.vk.updateDescriptorSets(g.device, writeCount,
                              writes.data(), 0, nullptr);
    g.reflectionDescriptors.emplace(key, record);
    return record.set;
}

void imageBarrier(VkCommandBuffer commandBuffer, VkImage image,
                  VkImageAspectFlags aspect, VkImageLayout oldLayout,
                  VkImageLayout newLayout, VkAccessFlags srcAccess,
                  VkAccessFlags dstAccess, VkPipelineStageFlags srcStage,
                  VkPipelineStageFlags dstStage) {
    VkImageMemoryBarrier barrier{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    barrier.srcAccessMask = srcAccess;
    barrier.dstAccessMask = dstAccess;
    barrier.oldLayout = oldLayout;
    barrier.newLayout = newLayout;
    barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.image = image;
    barrier.subresourceRange.aspectMask = aspect;
    barrier.subresourceRange.levelCount = 1;
    barrier.subresourceRange.layerCount = 1;
    g.vk.cmdPipelineBarrier(commandBuffer, srcStage, dstStage, 0,
                            0, nullptr, 0, nullptr, 1, &barrier);
}

} // namespace

bool rayQueryBridgeAttachVulkan(const RayQueryVulkanContext& context) {
    std::scoped_lock lock(g.mutex);
    if (!context.instance || !context.physicalDevice || !context.device) {
        fail("wgpu-native did not provide a complete Vulkan context for ray queries");
        return false;
    }
    g.instance = static_cast<VkInstance>(context.instance);
    g.physicalDevice = static_cast<VkPhysicalDevice>(context.physicalDevice);
    g.device = static_cast<VkDevice>(context.device);
    g.queue = static_cast<VkQueue>(context.queue);
    g.queueFamily = context.queueFamilyIndex;
    g.webgpuFeatureEnabled = context.webgpuRayQueryFeatureEnabled;
    if (!loadFunctions()) {
        fail("The Vulkan ray-query entry points are unavailable on the WebGPU device");
        return false;
    }
    VkPhysicalDeviceRayQueryFeaturesKHR rayQuery{
        VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_RAY_QUERY_FEATURES_KHR};
    VkPhysicalDeviceAccelerationStructureFeaturesKHR accelerationStructure{
        VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ACCELERATION_STRUCTURE_FEATURES_KHR};
    accelerationStructure.pNext = &rayQuery;
    VkPhysicalDeviceFeatures2 features{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2};
    features.pNext = &accelerationStructure;
    g.vk.getPhysicalDeviceFeatures2(g.physicalDevice, &features);
    g.accelerationStructureSupported = accelerationStructure.accelerationStructure == VK_TRUE;
    g.rayQuerySupported = rayQuery.rayQuery == VK_TRUE;
    if (!g.webgpuFeatureEnabled || !g.accelerationStructureSupported ||
        !g.rayQuerySupported) {
        g.status = !g.webgpuFeatureEnabled
            ? "wgpu-native did not enable WGPUNativeFeature_RayQuery"
            : "The active Vulkan adapter does not expose acceleration structures and ray query";
        return false;
    }
    if (!createPipeline()) return false;
    if (!createReflectionPipeline()) {
        destroyPipelineResources();
        return false;
    }
    g.attached = true;
    g.status = "Vulkan ray query attached; waiting for static world geometry";
    return true;
}

RayQueryBridgeCapabilities rayQueryBridgeCapabilities() {
    std::scoped_lock lock(g.mutex);
    static thread_local std::string status;
    status = g.status;
    return {
        g.attached,
        g.webgpuFeatureEnabled,
        g.accelerationStructureSupported,
        g.rayQuerySupported,
        g.pipeline != VK_NULL_HANDLE && g.reflectionPipeline != VK_NULL_HANDLE,
        g.sceneReady,
        g.triangleCount,
        g.buildCount,
        g.evaluationCount,
        g.failureCount,
        status.c_str(),
    };
}

bool rayQueryBridgeCreatePipeline(uint32_t handle,
                                  RayQueryPipelineProfile profile,
                                  const uint32_t* spirvWords,
                                  std::size_t wordCount,
                                  const char* entryPoint) {
    std::scoped_lock lock(g.mutex);
    return createCustomPipeline(handle, profile, spirvWords, wordCount, entryPoint);
}

bool rayQueryBridgeDestroyPipeline(uint32_t handle) {
    std::scoped_lock lock(g.mutex);
    if (!g.attached || !g.device || handle == 0u) {
        fail("Invalid custom ray-query pipeline handle");
        return false;
    }
    const auto iterator = g.customPipelines.find(handle);
    if (iterator == g.customPipelines.end()) {
        fail("Custom ray-query pipeline handle does not exist");
        return false;
    }
    if (g.vk.deviceWaitIdle) g.vk.deviceWaitIdle(g.device);
    if (iterator->second.pipeline) {
        g.vk.destroyPipeline(g.device, iterator->second.pipeline, nullptr);
    }
    g.customPipelines.erase(iterator);
    g.status = "Custom ray-query compute pipeline destroyed";
    return true;
}

void rayQueryBridgeResetPipelines() {
    std::scoped_lock lock(g.mutex);
    destroyCustomPipelines(true);
}

void rayQueryBridgeSceneBegin() {
    std::scoped_lock lock(g.mutex);
    destroySceneResources(true);
    g.pendingPositions.clear();
    g.pendingIndices.clear();
    g.pendingTriangleRadiance.clear();
    g.pendingTriangleSurface.clear();
    g.pendingStaticLights.clear();
    g.pendingInstanceGroups.clear();
    g.status = g.attached
        ? "Collecting static world-space triangles"
        : "Ray query bridge is unavailable";
}

bool rayQueryBridgeSetPositions(const float* xyz, std::size_t vertexCount) {
    std::scoped_lock lock(g.mutex);
    if (!g.attached || !xyz || vertexCount == 0 ||
        vertexCount > (std::numeric_limits<std::size_t>::max() / 3u)) {
        fail("Invalid static ray-query position chunk");
        return false;
    }
    const std::size_t scalarCount = vertexCount * 3u;
    for (std::size_t index = 0; index < scalarCount; ++index) {
        if (!std::isfinite(xyz[index])) {
            fail("Static ray-query positions must be finite world-space floats");
            return false;
        }
    }
    g.pendingPositions.insert(g.pendingPositions.end(), xyz, xyz + scalarCount);
    return true;
}

bool rayQueryBridgeSetIndices(const uint32_t* indices, std::size_t indexCount) {
    std::scoped_lock lock(g.mutex);
    if (!g.attached || !indices || indexCount == 0 || indexCount % 3u != 0u) {
        fail("Ray-query index chunks must contain complete uint32 triangles");
        return false;
    }
    g.pendingIndices.insert(g.pendingIndices.end(), indices, indices + indexCount);
    return true;
}

bool rayQueryBridgeSetTriangleRadiance(const float* rgba,
                                      std::size_t triangleCount) {
    std::scoped_lock lock(g.mutex);
    if (!g.attached || !rgba || triangleCount == 0 ||
        triangleCount > (std::numeric_limits<std::size_t>::max() / 4u)) {
        fail("Invalid static ray-query triangle-radiance chunk");
        return false;
    }
    const std::size_t scalarCount = triangleCount * 4u;
    for (std::size_t index = 0; index < scalarCount; ++index) {
        if (!std::isfinite(rgba[index]) || rgba[index] < 0.0f) {
            fail("Static ray-query triangle radiance must be finite and non-negative");
            return false;
        }
    }
    g.pendingTriangleRadiance.insert(g.pendingTriangleRadiance.end(), rgba,
                                     rgba + scalarCount);
    return true;
}

bool rayQueryBridgeSetTriangleSurface(const float* albedoRoughness,
                                     std::size_t triangleCount) {
    std::scoped_lock lock(g.mutex);
    if (!g.attached || !albedoRoughness || triangleCount == 0 ||
        triangleCount > (std::numeric_limits<std::size_t>::max() / 4u)) {
        fail("Invalid static ray-query triangle-surface chunk");
        return false;
    }
    const std::size_t scalarCount = triangleCount * 4u;
    for (std::size_t offset = 0; offset < scalarCount; offset += 4u) {
        if (!std::isfinite(albedoRoughness[offset + 0u]) ||
            !std::isfinite(albedoRoughness[offset + 1u]) ||
            !std::isfinite(albedoRoughness[offset + 2u]) ||
            !std::isfinite(albedoRoughness[offset + 3u]) ||
            albedoRoughness[offset + 0u] < 0.0f ||
            albedoRoughness[offset + 1u] < 0.0f ||
            albedoRoughness[offset + 2u] < 0.0f ||
            albedoRoughness[offset + 3u] < 0.0f ||
            albedoRoughness[offset + 3u] > 1.0f) {
            fail("Static ray-query triangle surfaces require non-negative linear albedo and roughness in [0, 1]");
            return false;
        }
    }
    g.pendingTriangleSurface.insert(g.pendingTriangleSurface.end(),
                                    albedoRoughness,
                                    albedoRoughness + scalarCount);
    return true;
}

bool rayQueryBridgeSetStaticLights(const float* lightRecords,
                                   std::size_t lightCount) {
    std::scoped_lock lock(g.mutex);
    if (!g.attached || !lightRecords || lightCount == 0u || lightCount > 8u) {
        fail("Static ray-query lighting accepts between one and eight lights");
        return false;
    }
    constexpr std::size_t kScalarsPerLight = 16u;
    const std::size_t scalarCount = lightCount * kScalarsPerLight;
    for (std::size_t offset = 0; offset < scalarCount; offset += kScalarsPerLight) {
        for (std::size_t field = 0; field < kScalarsPerLight; ++field) {
            if (!std::isfinite(lightRecords[offset + field])) {
                fail("Static ray-query lights must contain only finite values");
                return false;
            }
        }
        const float range = lightRecords[offset + 3u];
        const float outerCos = lightRecords[offset + 7u];
        const float intensity = lightRecords[offset + 11u];
        const float innerCos = lightRecords[offset + 12u];
        const float type = lightRecords[offset + 13u];
        const float decay = lightRecords[offset + 14u];
        if (range < 0.0f || outerCos < -1.0f || outerCos > 1.0f ||
            lightRecords[offset + 8u] < 0.0f ||
            lightRecords[offset + 9u] < 0.0f ||
            lightRecords[offset + 10u] < 0.0f || intensity < 0.0f ||
            innerCos < -1.0f || innerCos > 1.0f ||
            (type != 0.0f && type != 1.0f) || decay < 0.0f) {
            fail("Static ray-query light ranges, colors, intensity, cones, type and decay are invalid");
            return false;
        }
        if (type == 1.0f) {
            const float x = lightRecords[offset + 4u];
            const float y = lightRecords[offset + 5u];
            const float z = lightRecords[offset + 6u];
            if (x * x + y * y + z * z <= 1e-12f || innerCos < outerCos) {
                fail("Static spot lights require a direction and innerCos >= outerCos");
                return false;
            }
        }
    }
    g.pendingStaticLights.assign(lightRecords, lightRecords + scalarCount);
    return true;
}

bool rayQueryBridgeAddInstanceGroup(uint32_t id, uint32_t capacity,
                                    uint32_t vertexOffset, uint32_t vertexCount,
                                    uint32_t indexOffset, uint32_t indexCount,
                                    uint32_t primitiveBase) {
    std::scoped_lock lock(g.mutex);
    if (!g.attached || id == 0u || capacity == 0u || capacity > 1024u ||
        vertexCount == 0u || indexCount == 0u || indexCount % 3u != 0u ||
        primitiveBase > 0x00ffffffu) {
        fail("Invalid dynamic ray-query instance-group descriptor");
        return false;
    }
    const auto duplicate = std::find_if(
        g.pendingInstanceGroups.begin(), g.pendingInstanceGroups.end(),
        [id](const PendingInstanceGroup& group) { return group.id == id; });
    if (duplicate != g.pendingInstanceGroups.end()) {
        fail("Dynamic ray-query instance-group IDs must be unique");
        return false;
    }
    g.pendingInstanceGroups.push_back({id, capacity, vertexOffset, vertexCount,
                                       indexOffset, indexCount, primitiveBase});
    return true;
}

bool rayQueryBridgeCommit(void* commandBufferValue) {
    std::scoped_lock lock(g.mutex);
    if (!g.attached || !commandBufferValue || g.pendingPositions.empty() ||
        g.pendingIndices.empty() || g.pendingPositions.size() % 3u != 0u ||
        g.pendingIndices.size() % 3u != 0u) {
        fail("Ray-query scene commit requires positions, triangles and a WebGPU command encoder");
        return false;
    }
    const uint32_t vertexCount = static_cast<uint32_t>(g.pendingPositions.size() / 3u);
    for (const uint32_t index : g.pendingIndices) {
        if (index >= vertexCount) {
            fail("Ray-query scene contains an out-of-range triangle index");
            return false;
        }
    }
    const uint32_t primitiveCount = static_cast<uint32_t>(g.pendingIndices.size() / 3u);
    uint32_t staticPrimitiveCount = primitiveCount;
    uint32_t expectedVertexOffset = vertexCount;
    uint32_t expectedIndexOffset = static_cast<uint32_t>(g.pendingIndices.size());
    if (!g.pendingInstanceGroups.empty()) {
        expectedVertexOffset = g.pendingInstanceGroups.front().vertexOffset;
        expectedIndexOffset = g.pendingInstanceGroups.front().indexOffset;
        if (expectedIndexOffset == 0u || expectedIndexOffset % 3u != 0u ||
            expectedVertexOffset == 0u) {
            fail("Dynamic instance-group geometry must follow a non-empty static scene");
            return false;
        }
        staticPrimitiveCount = expectedIndexOffset / 3u;
        uint32_t nextVertex = expectedVertexOffset;
        uint32_t nextIndex = expectedIndexOffset;
        for (const PendingInstanceGroup& group : g.pendingInstanceGroups) {
            if (group.vertexOffset != nextVertex || group.indexOffset != nextIndex ||
                group.primitiveBase != group.indexOffset / 3u ||
                group.vertexOffset > vertexCount ||
                group.vertexCount > vertexCount - group.vertexOffset ||
                group.indexOffset > g.pendingIndices.size() ||
                group.indexCount > g.pendingIndices.size() - group.indexOffset ||
                static_cast<uint64_t>(group.primitiveBase) +
                    static_cast<uint64_t>(group.indexCount / 3u) > 0x01000000ull) {
                fail("Dynamic instance-group geometry ranges must be contiguous and match primitiveBase");
                return false;
            }
            const uint32_t vertexEnd = group.vertexOffset + group.vertexCount;
            for (uint32_t offset = 0u; offset < group.indexCount; ++offset) {
                const uint32_t index = g.pendingIndices[group.indexOffset + offset];
                if (index < group.vertexOffset || index >= vertexEnd) {
                    fail("Dynamic instance-group indices must reference only their shared geometry");
                    return false;
                }
            }
            nextVertex = vertexEnd;
            nextIndex += group.indexCount;
        }
        if (nextVertex != vertexCount || nextIndex != g.pendingIndices.size()) {
            fail("Dynamic instance-group geometry must form the final scene suffix");
            return false;
        }
    }
    if (!g.pendingTriangleRadiance.empty() &&
        g.pendingTriangleRadiance.size() != static_cast<std::size_t>(primitiveCount) * 4u) {
        fail("Ray-query triangle radiance must contain exactly one vec4 per primitive");
        return false;
    }
    if (!g.pendingTriangleSurface.empty() &&
        g.pendingTriangleSurface.size() != static_cast<std::size_t>(primitiveCount) * 4u) {
        fail("Ray-query triangle surface data must contain exactly one vec4 per primitive");
        return false;
    }
    if (!g.pendingStaticLights.empty() &&
        (g.pendingStaticLights.size() % 16u != 0u ||
         g.pendingStaticLights.size() > 8u * 16u)) {
        fail("Ray-query static lights must contain at most eight 4xvec4 records");
        return false;
    }
    std::vector<float> defaultTriangleRadiance;
    const std::vector<float>* triangleRadiance = &g.pendingTriangleRadiance;
    if (triangleRadiance->empty()) {
        // Descriptor plumbing requires a buffer even when JS provides no
        // authored terminal radiance. A single neutral record is sufficient;
        // the shader clamps primitive indices to the available record count.
        defaultTriangleRadiance.resize(4u, 0.0f);
        triangleRadiance = &defaultTriangleRadiance;
    }
    std::vector<float> defaultTriangleSurface;
    const std::vector<float>* triangleSurface = &g.pendingTriangleSurface;
    if (triangleSurface->empty()) {
        defaultTriangleSurface.resize(4u, 0.0f);
        triangleSurface = &defaultTriangleSurface;
    }
    std::array<float, 16> defaultStaticLight{};
    const float* staticLights = g.pendingStaticLights.empty()
        ? defaultStaticLight.data()
        : g.pendingStaticLights.data();
    const std::size_t staticLightScalarCount = g.pendingStaticLights.empty()
        ? defaultStaticLight.size()
        : g.pendingStaticLights.size();
    // A direct C-API caller may recommit without a preceding SceneBegin.  Wait
    // before replacing an existing or partially-created scene so no submitted
    // lighting dispatch can still reference its TLAS or descriptor sets.  The
    // usual SceneBegin -> Commit path has already cleared these resources.
    const bool replacingScene =
        g.sceneReady || g.tlas.handle || g.tlas.storage.buffer ||
        g.blas.handle || g.blas.storage.buffer || !g.instanceGroups.empty() ||
        g.tlasScratch.buffer ||
        g.instances.buffer || g.blasScratch.buffer || g.indices.buffer ||
        g.vertices.buffer || g.triangleRadiance.buffer ||
        g.triangleSurface.buffer || g.staticLights.buffer ||
        !g.sceneUploadStaging.empty();
    destroySceneResources(replacingScene);
    const VkBufferUsageFlags geometryUsage =
        VK_BUFFER_USAGE_ACCELERATION_STRUCTURE_BUILD_INPUT_READ_ONLY_BIT_KHR |
        VK_BUFFER_USAGE_SHADER_DEVICE_ADDRESS_BIT |
        VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;
    std::vector<PendingBufferCopy> pendingCopies;
    if (!createImmutableSceneBuffer(
            g.pendingPositions.size() * sizeof(float), geometryUsage,
            g.pendingPositions.data(), g.vertices, pendingCopies) ||
        !createImmutableSceneBuffer(
            g.pendingIndices.size() * sizeof(uint32_t), geometryUsage,
            g.pendingIndices.data(), g.indices, pendingCopies) ||
        !createImmutableSceneBuffer(
            triangleRadiance->size() * sizeof(float),
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, triangleRadiance->data(),
            g.triangleRadiance, pendingCopies) ||
        !createImmutableSceneBuffer(
            triangleSurface->size() * sizeof(float),
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, triangleSurface->data(),
            g.triangleSurface, pendingCopies) ||
        !createImmutableSceneBuffer(
            staticLightScalarCount * sizeof(float),
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, staticLights,
            g.staticLights, pendingCopies)) {
        destroySceneResources(false);
        return false;
    }

    const std::size_t blasCount = 1u + g.pendingInstanceGroups.size();
    std::vector<VkAccelerationStructureGeometryKHR> blasGeometries(blasCount);
    std::vector<VkAccelerationStructureBuildGeometryInfoKHR> blasBuilds(blasCount);
    std::vector<VkAccelerationStructureBuildRangeInfoKHR> blasRanges(blasCount);
    std::vector<const VkAccelerationStructureBuildRangeInfoKHR*> blasRangePointers(blasCount);
    g.instanceGroups.resize(g.pendingInstanceGroups.size());

    const auto configureBlas = [&](std::size_t slot, uint32_t indexOffset,
                                   uint32_t buildPrimitiveCount,
                                   AccelerationStructure& accelerationStructure,
                                   Buffer& scratch) -> bool {
        VkAccelerationStructureGeometryTrianglesDataKHR triangles{
            VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_GEOMETRY_TRIANGLES_DATA_KHR};
        triangles.vertexFormat = VK_FORMAT_R32G32B32_SFLOAT;
        triangles.vertexData.deviceAddress = g.vertices.address;
        triangles.vertexStride = 3u * sizeof(float);
        triangles.maxVertex = vertexCount - 1u;
        triangles.indexType = VK_INDEX_TYPE_UINT32;
        triangles.indexData.deviceAddress =
            g.indices.address + static_cast<VkDeviceAddress>(indexOffset) * sizeof(uint32_t);
        auto& geometry = blasGeometries[slot];
        geometry = {VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_GEOMETRY_KHR};
        geometry.geometryType = VK_GEOMETRY_TYPE_TRIANGLES_KHR;
        geometry.flags = VK_GEOMETRY_OPAQUE_BIT_KHR;
        geometry.geometry.triangles = triangles;
        auto& build = blasBuilds[slot];
        build = {VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_BUILD_GEOMETRY_INFO_KHR};
        build.type = VK_ACCELERATION_STRUCTURE_TYPE_BOTTOM_LEVEL_KHR;
        build.flags = VK_BUILD_ACCELERATION_STRUCTURE_PREFER_FAST_TRACE_BIT_KHR;
        build.mode = VK_BUILD_ACCELERATION_STRUCTURE_MODE_BUILD_KHR;
        build.geometryCount = 1u;
        build.pGeometries = &geometry;
        VkAccelerationStructureBuildSizesInfoKHR sizes{
            VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_BUILD_SIZES_INFO_KHR};
        g.vk.getAccelerationStructureBuildSizes(
            g.device, VK_ACCELERATION_STRUCTURE_BUILD_TYPE_DEVICE_KHR,
            &build, &buildPrimitiveCount, &sizes);
        if (!createAccelerationStructure(VK_ACCELERATION_STRUCTURE_TYPE_BOTTOM_LEVEL_KHR,
                                         sizes.accelerationStructureSize,
                                         accelerationStructure) ||
            !createBuffer(sizes.buildScratchSize,
                          VK_BUFFER_USAGE_STORAGE_BUFFER_BIT |
                              VK_BUFFER_USAGE_SHADER_DEVICE_ADDRESS_BIT,
                          VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT,
                          VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, scratch)) {
            return false;
        }
        build.dstAccelerationStructure = accelerationStructure.handle;
        build.scratchData.deviceAddress = scratch.address;
        VkAccelerationStructureDeviceAddressInfoKHR addressInfo{
            VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_DEVICE_ADDRESS_INFO_KHR};
        addressInfo.accelerationStructure = accelerationStructure.handle;
        accelerationStructure.address =
            g.vk.getAccelerationStructureDeviceAddress(g.device, &addressInfo);
        if (!accelerationStructure.address) return false;
        blasRanges[slot].primitiveCount = buildPrimitiveCount;
        blasRangePointers[slot] = &blasRanges[slot];
        return true;
    };

    if (!configureBlas(0u, 0u, staticPrimitiveCount, g.blas, g.blasScratch)) {
        fail("Creating the static ray-query BLAS failed");
        destroySceneResources(false);
        return false;
    }
    for (std::size_t index = 0u; index < g.pendingInstanceGroups.size(); ++index) {
        auto& group = g.instanceGroups[index];
        group.descriptor = g.pendingInstanceGroups[index];
        if (!configureBlas(index + 1u, group.descriptor.indexOffset,
                           group.descriptor.indexCount / 3u,
                           group.blas, group.blasScratch)) {
            fail("Creating a shared dynamic instance-group BLAS failed");
            destroySceneResources(false);
            return false;
        }
    }

    uint32_t totalInstanceCount = 1u;
    for (const PendingInstanceGroup& group : g.pendingInstanceGroups) {
        if (group.capacity > std::numeric_limits<uint32_t>::max() - totalInstanceCount) {
            fail("Dynamic instance-group capacity overflowed the TLAS");
            destroySceneResources(false);
            return false;
        }
        totalInstanceCount += group.capacity;
    }
    g.instanceRecords.assign(totalInstanceCount, {});
    auto& staticInstance = g.instanceRecords[0];
    staticInstance.transform.matrix[0][0] = 1.0f;
    staticInstance.transform.matrix[1][1] = 1.0f;
    staticInstance.transform.matrix[2][2] = 1.0f;
    staticInstance.mask = 0xffu;
    staticInstance.flags = VK_GEOMETRY_INSTANCE_TRIANGLE_FACING_CULL_DISABLE_BIT_KHR;
    staticInstance.accelerationStructureReference = g.blas.address;
    uint32_t nextInstance = 1u;
    for (auto& group : g.instanceGroups) {
        group.firstInstance = nextInstance;
        for (uint32_t slot = 0u; slot < group.descriptor.capacity; ++slot) {
            auto& instance = g.instanceRecords[nextInstance + slot];
            instance.transform.matrix[0][0] = 1.0f;
            instance.transform.matrix[1][1] = 1.0f;
            instance.transform.matrix[2][2] = 1.0f;
            instance.instanceCustomIndex = group.descriptor.primitiveBase;
            instance.mask = 0u;
            instance.flags = VK_GEOMETRY_INSTANCE_TRIANGLE_FACING_CULL_DISABLE_BIT_KHR;
            instance.accelerationStructureReference = group.blas.address;
        }
        nextInstance += group.descriptor.capacity;
    }
    if (!createImmutableSceneBuffer(
            static_cast<VkDeviceSize>(g.instanceRecords.size()) *
                sizeof(VkAccelerationStructureInstanceKHR),
            geometryUsage | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
            g.instanceRecords.data(), g.instances, pendingCopies)) {
        destroySceneResources(false);
        return false;
    }
    VkAccelerationStructureGeometryInstancesDataKHR instancesData{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_GEOMETRY_INSTANCES_DATA_KHR};
    instancesData.data.deviceAddress = g.instances.address;
    VkAccelerationStructureGeometryKHR tlasGeometry{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_GEOMETRY_KHR};
    tlasGeometry.geometryType = VK_GEOMETRY_TYPE_INSTANCES_KHR;
    tlasGeometry.geometry.instances = instancesData;
    VkAccelerationStructureBuildGeometryInfoKHR tlasBuild{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_BUILD_GEOMETRY_INFO_KHR};
    tlasBuild.type = VK_ACCELERATION_STRUCTURE_TYPE_TOP_LEVEL_KHR;
    tlasBuild.flags = VK_BUILD_ACCELERATION_STRUCTURE_PREFER_FAST_TRACE_BIT_KHR |
                      VK_BUILD_ACCELERATION_STRUCTURE_ALLOW_UPDATE_BIT_KHR;
    tlasBuild.mode = VK_BUILD_ACCELERATION_STRUCTURE_MODE_BUILD_KHR;
    tlasBuild.geometryCount = 1;
    tlasBuild.pGeometries = &tlasGeometry;
    const uint32_t instanceCount = totalInstanceCount;
    VkAccelerationStructureBuildSizesInfoKHR tlasSizes{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_BUILD_SIZES_INFO_KHR};
    g.vk.getAccelerationStructureBuildSizes(
        g.device, VK_ACCELERATION_STRUCTURE_BUILD_TYPE_DEVICE_KHR,
        &tlasBuild, &instanceCount, &tlasSizes);
    if (!createAccelerationStructure(VK_ACCELERATION_STRUCTURE_TYPE_TOP_LEVEL_KHR,
                                     tlasSizes.accelerationStructureSize, g.tlas) ||
        !createBuffer(std::max(tlasSizes.buildScratchSize,
                               tlasSizes.updateScratchSize),
                      VK_BUFFER_USAGE_STORAGE_BUFFER_BIT |
                      VK_BUFFER_USAGE_SHADER_DEVICE_ADDRESS_BIT,
                      VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT,
                      VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT,
                      g.tlasScratch)) {
        destroySceneResources(false);
        return false;
    }
    tlasBuild.dstAccelerationStructure = g.tlas.handle;
    tlasBuild.scratchData.deviceAddress = g.tlasScratch.address;
    VkAccelerationStructureDeviceAddressInfoKHR tlasAddressInfo{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_DEVICE_ADDRESS_INFO_KHR};
    tlasAddressInfo.accelerationStructure = g.tlas.handle;
    g.tlas.address = g.vk.getAccelerationStructureDeviceAddress(g.device, &tlasAddressInfo);
    if (!g.tlas.address) {
        fail("Vulkan returned no address for the static TLAS");
        destroySceneResources(false);
        return false;
    }

    // Do not record copies or either build until every object referenced by the
    // commands has been allocated and uploaded. From this point onward there
    // are no fallible resource-creation paths that could invalidate the command
    // buffer. Staging buffers remain alive with the scene until GPU completion.
    const VkCommandBuffer commandBuffer = static_cast<VkCommandBuffer>(commandBufferValue);
    for (const PendingBufferCopy& copy : pendingCopies) {
        VkBufferCopy region{};
        region.size = copy.size;
        g.vk.cmdCopyBuffer(commandBuffer, copy.source, copy.destination, 1, &region);
    }
    VkMemoryBarrier uploadBarrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
    uploadBarrier.srcAccessMask = VK_ACCESS_HOST_WRITE_BIT |
                                  VK_ACCESS_TRANSFER_WRITE_BIT;
    uploadBarrier.dstAccessMask = VK_ACCESS_ACCELERATION_STRUCTURE_READ_BIT_KHR |
                                  VK_ACCESS_SHADER_READ_BIT;
    g.vk.cmdPipelineBarrier(
        commandBuffer,
        VK_PIPELINE_STAGE_HOST_BIT | VK_PIPELINE_STAGE_TRANSFER_BIT,
        VK_PIPELINE_STAGE_ACCELERATION_STRUCTURE_BUILD_BIT_KHR |
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        0, 1, &uploadBarrier, 0, nullptr, 0, nullptr);
    g.vk.cmdBuildAccelerationStructures(
        commandBuffer, static_cast<uint32_t>(blasBuilds.size()),
        blasBuilds.data(), blasRangePointers.data());
    VkMemoryBarrier buildBarrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
    buildBarrier.srcAccessMask = VK_ACCESS_ACCELERATION_STRUCTURE_WRITE_BIT_KHR;
    buildBarrier.dstAccessMask = VK_ACCESS_ACCELERATION_STRUCTURE_READ_BIT_KHR;
    g.vk.cmdPipelineBarrier(commandBuffer,
                            VK_PIPELINE_STAGE_ACCELERATION_STRUCTURE_BUILD_BIT_KHR,
                            VK_PIPELINE_STAGE_ACCELERATION_STRUCTURE_BUILD_BIT_KHR,
                            0, 1, &buildBarrier, 0, nullptr, 0, nullptr);
    VkAccelerationStructureBuildRangeInfoKHR tlasRange{};
    tlasRange.primitiveCount = instanceCount;
    const VkAccelerationStructureBuildRangeInfoKHR* tlasRangePtr = &tlasRange;
    g.vk.cmdBuildAccelerationStructures(commandBuffer, 1, &tlasBuild, &tlasRangePtr);
    g.vk.cmdPipelineBarrier(commandBuffer,
                            VK_PIPELINE_STAGE_ACCELERATION_STRUCTURE_BUILD_BIT_KHR,
                            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                            0, 1, &buildBarrier, 0, nullptr, 0, nullptr);
    g.sceneReady = true;
    g.triangleCount = primitiveCount;
    g.tlasInstanceCount = instanceCount;
    ++g.buildCount;
    g.status = g.sceneReady
        ? (g.instanceGroups.empty()
               ? "Static BLAS/TLAS recorded on the WebGPU command buffer"
               : "Static scene and dynamic instance-group BLAS/TLAS recorded")
        : "Vulkan returned no address for the static TLAS";
    g.pendingPositions.clear();
    g.pendingIndices.clear();
    g.pendingTriangleRadiance.clear();
    g.pendingTriangleSurface.clear();
    g.pendingStaticLights.clear();
    g.pendingInstanceGroups.clear();
    return g.sceneReady;
}

bool rayQueryBridgeUpdateInstanceGroup(void* commandBufferValue, uint32_t id,
                                       const float* matrices3x4,
                                       const uint32_t* masks,
                                       std::size_t instanceCount) {
    std::scoped_lock lock(g.mutex);
    if (!g.attached || !g.sceneReady || !commandBufferValue || id == 0u ||
        !matrices3x4 || !masks) {
        fail("Dynamic instance-group update requires a ready scene and command encoder");
        return false;
    }
    const auto iterator = std::find_if(
        g.instanceGroups.begin(), g.instanceGroups.end(),
        [id](const InstanceGroup& group) { return group.descriptor.id == id; });
    if (iterator == g.instanceGroups.end() ||
        instanceCount != iterator->descriptor.capacity) {
        fail("Dynamic instance-group update must match its registered fixed capacity");
        return false;
    }
    const VkDeviceSize byteOffset =
        static_cast<VkDeviceSize>(iterator->firstInstance) *
        sizeof(VkAccelerationStructureInstanceKHR);
    const VkDeviceSize byteSize =
        static_cast<VkDeviceSize>(instanceCount) *
        sizeof(VkAccelerationStructureInstanceKHR);
    if (byteSize == 0u || byteSize > 65536u ||
        byteOffset + byteSize > g.instances.size) {
        fail("Dynamic instance-group update exceeds the Vulkan instance buffer");
        return false;
    }
    std::vector<VkAccelerationStructureInstanceKHR> records(instanceCount);
    for (std::size_t index = 0u; index < instanceCount; ++index) {
        auto& record = records[index];
        const float* matrix = matrices3x4 + index * 12u;
        for (uint32_t row = 0u; row < 3u; ++row) {
            for (uint32_t column = 0u; column < 4u; ++column) {
                const float value = matrix[row * 4u + column];
                if (!std::isfinite(value)) {
                    fail("Dynamic instance-group transforms must be finite row-major 3x4 matrices");
                    return false;
                }
                record.transform.matrix[row][column] = value;
            }
        }
        record.instanceCustomIndex = iterator->descriptor.primitiveBase;
        record.mask = masks[index] & 0xffu;
        record.flags = VK_GEOMETRY_INSTANCE_TRIANGLE_FACING_CULL_DISABLE_BIT_KHR;
        record.accelerationStructureReference = iterator->blas.address;
    }

    const VkCommandBuffer commandBuffer = static_cast<VkCommandBuffer>(commandBufferValue);
    g.vk.cmdUpdateBuffer(commandBuffer, g.instances.buffer, byteOffset, byteSize,
                         records.data());
    VkBufferMemoryBarrier instanceBarrier{VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER};
    instanceBarrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    instanceBarrier.dstAccessMask = VK_ACCESS_ACCELERATION_STRUCTURE_READ_BIT_KHR;
    instanceBarrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    instanceBarrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    instanceBarrier.buffer = g.instances.buffer;
    instanceBarrier.offset = byteOffset;
    instanceBarrier.size = byteSize;
    g.vk.cmdPipelineBarrier(commandBuffer, VK_PIPELINE_STAGE_TRANSFER_BIT,
                            VK_PIPELINE_STAGE_ACCELERATION_STRUCTURE_BUILD_BIT_KHR,
                            0u, 0u, nullptr, 1u, &instanceBarrier, 0u, nullptr);

    VkAccelerationStructureGeometryInstancesDataKHR instancesData{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_GEOMETRY_INSTANCES_DATA_KHR};
    instancesData.data.deviceAddress = g.instances.address;
    VkAccelerationStructureGeometryKHR geometry{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_GEOMETRY_KHR};
    geometry.geometryType = VK_GEOMETRY_TYPE_INSTANCES_KHR;
    geometry.geometry.instances = instancesData;
    VkAccelerationStructureBuildGeometryInfoKHR build{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_BUILD_GEOMETRY_INFO_KHR};
    build.type = VK_ACCELERATION_STRUCTURE_TYPE_TOP_LEVEL_KHR;
    build.flags = VK_BUILD_ACCELERATION_STRUCTURE_PREFER_FAST_TRACE_BIT_KHR |
                  VK_BUILD_ACCELERATION_STRUCTURE_ALLOW_UPDATE_BIT_KHR;
    build.mode = VK_BUILD_ACCELERATION_STRUCTURE_MODE_UPDATE_KHR;
    build.srcAccelerationStructure = g.tlas.handle;
    build.dstAccelerationStructure = g.tlas.handle;
    build.geometryCount = 1u;
    build.pGeometries = &geometry;
    build.scratchData.deviceAddress = g.tlasScratch.address;
    VkAccelerationStructureBuildRangeInfoKHR range{};
    range.primitiveCount = g.tlasInstanceCount;
    const VkAccelerationStructureBuildRangeInfoKHR* rangePointer = &range;
    g.vk.cmdBuildAccelerationStructures(commandBuffer, 1u, &build, &rangePointer);
    VkMemoryBarrier buildBarrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
    buildBarrier.srcAccessMask = VK_ACCESS_ACCELERATION_STRUCTURE_WRITE_BIT_KHR;
    buildBarrier.dstAccessMask = VK_ACCESS_ACCELERATION_STRUCTURE_READ_BIT_KHR |
                                 VK_ACCESS_SHADER_READ_BIT;
    g.vk.cmdPipelineBarrier(commandBuffer,
                            VK_PIPELINE_STAGE_ACCELERATION_STRUCTURE_BUILD_BIT_KHR,
                            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0u,
                            1u, &buildBarrier, 0u, nullptr, 0u, nullptr);
    std::copy(records.begin(), records.end(),
              g.instanceRecords.begin() + iterator->firstInstance);
    g.status = "Dynamic ray-query instance group updated and TLAS refit recorded";
    return true;
}

void rayQueryBridgeDestroyScene() {
    std::scoped_lock lock(g.mutex);
    destroySceneResources(true);
    g.pendingPositions.clear();
    g.pendingIndices.clear();
    g.pendingTriangleRadiance.clear();
    g.pendingTriangleSurface.clear();
    g.pendingStaticLights.clear();
    g.pendingInstanceGroups.clear();
    g.status = g.attached
        ? "Static ray-query scene destroyed"
        : "Ray query bridge is unavailable";
}

bool rayQueryBridgeEvaluate(const RayQueryLightingFrame& frame) {
    std::scoped_lock lock(g.mutex);
    if (!g.attached || !g.sceneReady || !frame.commandBuffer || !frame.colorImage ||
        !frame.depthImage || frame.width == 0 || frame.height == 0 ||
        frame.colorLayout == VK_IMAGE_LAYOUT_UNDEFINED ||
        frame.depthLayout == VK_IMAGE_LAYOUT_UNDEFINED) {
        fail("Ray-query lighting requires a ready TLAS, command encoder, rgba16f color and depth32f");
        return false;
    }
    for (float value : frame.inverseViewProjection) {
        if (!std::isfinite(value)) {
            fail("Ray-query lighting inverseViewProjection must be finite");
            return false;
        }
    }
    for (float value : frame.cameraPosition) {
        if (!std::isfinite(value)) {
            fail("Ray-query lighting cameraPosition must be finite");
            return false;
        }
    }
    for (float value : frame.directionalLightDirectionIntensity) {
        if (!std::isfinite(value)) {
            fail("Ray-query directional-light data must be finite");
            return false;
        }
    }
    const float directionLength = std::sqrt(
        frame.directionalLightDirectionIntensity[0] *
            frame.directionalLightDirectionIntensity[0] +
        frame.directionalLightDirectionIntensity[1] *
            frame.directionalLightDirectionIntensity[1] +
        frame.directionalLightDirectionIntensity[2] *
            frame.directionalLightDirectionIntensity[2]);
    const std::array<float, 6> configuration{{
        frame.directionalVisibilityStrength, frame.aoStrength, frame.aoRadius,
        frame.directionalAngularRadius, frame.maxDistance, frame.rayBias,
    }};
    if (std::any_of(configuration.begin(), configuration.end(),
                    [](float value) { return !std::isfinite(value); }) ||
        directionLength <= 1e-6f || frame.directionalLightDirectionIntensity[3] < 0.0f ||
        frame.directionalVisibilityStrength < 0.0f || frame.aoStrength < 0.0f ||
        frame.aoRadius <= 0.0f || frame.directionalAngularRadius < 0.0f ||
        frame.directionalAngularRadius >= 1.57079632679f || frame.maxDistance <= 0.0f ||
        frame.rayBias <= 0.0f || frame.rayBias >= frame.maxDistance ||
        frame.directionalSampleCount == 0u || frame.directionalSampleCount > 64u ||
        frame.aoSampleCount == 0u || frame.aoSampleCount > 64u) {
        fail("Ray-query lighting configuration is outside the generic profile limits");
        return false;
    }
    const VkPipeline pipeline = frame.pipelineHandle
        ? customPipeline(frame.pipelineHandle, RayQueryPipelineProfile::LightingV1)
        : g.pipeline;
    if (!pipeline) return false;
    const auto color = static_cast<VkImage>(frame.colorImage);
    const auto depth = static_cast<VkImage>(frame.depthImage);
    const VkDescriptorSet descriptor = descriptorFor(color, depth);
    if (!descriptor) return false;
    const VkCommandBuffer commandBuffer = static_cast<VkCommandBuffer>(frame.commandBuffer);
    const auto colorLayout = static_cast<VkImageLayout>(frame.colorLayout);
    const auto depthLayout = static_cast<VkImageLayout>(frame.depthLayout);
    imageBarrier(commandBuffer, color, VK_IMAGE_ASPECT_COLOR_BIT,
                 colorLayout, VK_IMAGE_LAYOUT_GENERAL,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
    imageBarrier(commandBuffer, depth, VK_IMAGE_ASPECT_DEPTH_BIT,
                 depthLayout, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_ACCESS_SHADER_READ_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);

    struct PushConstants {
        float inverseViewProjection[16];
        // xyz camera position, w directional maximum distance.
        float cameraPositionMaximumDistance[4];
        // xyz normalized direction, w angular radius in radians.
        float directionalLightDirectionAngularRadius[4];
        // directional visibility strength, AO strength/radius and ray bias.
        float lightingParameters[4];
        uint32_t extentFlags[4];
    } push{};
    static_assert(sizeof(PushConstants) == 128);
    std::copy_n(frame.inverseViewProjection, 16, push.inverseViewProjection);
    std::copy_n(frame.cameraPosition, 3, push.cameraPositionMaximumDistance);
    push.cameraPositionMaximumDistance[3] = frame.maxDistance;
    for (std::size_t axis = 0; axis < 3u; ++axis) {
        push.directionalLightDirectionAngularRadius[axis] =
            frame.directionalLightDirectionIntensity[axis] / directionLength;
    }
    push.directionalLightDirectionAngularRadius[3] = frame.directionalAngularRadius;
    push.lightingParameters[0] = frame.directionalVisibilityStrength *
                                 frame.directionalLightDirectionIntensity[3];
    push.lightingParameters[1] = frame.aoStrength;
    push.lightingParameters[2] = frame.aoRadius;
    push.lightingParameters[3] = frame.rayBias;
    push.extentFlags[0] = frame.width;
    push.extentFlags[1] = frame.height;
    push.extentFlags[2] = (frame.flags & 1u) |
                          (frame.directionalSampleCount << 8u) |
                          (frame.aoSampleCount << 16u);
    push.extentFlags[3] = frame.frameIndex;
    g.vk.cmdBindPipeline(commandBuffer, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline);
    g.vk.cmdBindDescriptorSets(commandBuffer, VK_PIPELINE_BIND_POINT_COMPUTE,
                               g.pipelineLayout, 0, 1, &descriptor, 0, nullptr);
    g.vk.cmdPushConstants(commandBuffer, g.pipelineLayout,
                          VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(push), &push);
    g.vk.cmdDispatch(commandBuffer, (frame.width + 7u) / 8u,
                     (frame.height + 7u) / 8u, 1);

    imageBarrier(commandBuffer, color, VK_IMAGE_ASPECT_COLOR_BIT,
                 VK_IMAGE_LAYOUT_GENERAL, colorLayout,
                 VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT);
    imageBarrier(commandBuffer, depth, VK_IMAGE_ASPECT_DEPTH_BIT,
                 VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, depthLayout,
                 VK_ACCESS_SHADER_READ_BIT,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT);
    ++g.evaluationCount;
    g.status = "Hardware ray-query directional-light visibility and RTAO dispatched";
    return true;
}

bool rayQueryBridgeEvaluateReflections(const RayQueryReflectionFrame& frame) {
    std::scoped_lock lock(g.mutex);
    const bool hasSpecularHitDistance = frame.specularHitDistanceImage != nullptr;
    if (!g.attached || !g.sceneReady || !g.reflectionPipeline ||
        !frame.commandBuffer || !frame.sourceColorImage || !frame.outputColorImage ||
        !frame.depthImage || !frame.normalRoughnessImage ||
        !frame.specularAlbedoImage || frame.width == 0 || frame.height == 0 ||
        frame.sourceColorLayout == VK_IMAGE_LAYOUT_UNDEFINED ||
        frame.outputColorLayout == VK_IMAGE_LAYOUT_UNDEFINED ||
        frame.depthLayout == VK_IMAGE_LAYOUT_UNDEFINED ||
        frame.normalRoughnessLayout == VK_IMAGE_LAYOUT_UNDEFINED ||
        frame.specularAlbedoLayout == VK_IMAGE_LAYOUT_UNDEFINED ||
        (hasSpecularHitDistance &&
         frame.specularHitDistanceLayout == VK_IMAGE_LAYOUT_UNDEFINED)) {
        fail("Ray-query reflections require a ready TLAS, an encoder and five valid images");
        return false;
    }
    const auto hitDistanceFormat =
        static_cast<VkFormat>(frame.specularHitDistanceFormat);
    if (hasSpecularHitDistance &&
        hitDistanceFormat != VK_FORMAT_R16_SFLOAT &&
        hitDistanceFormat != VK_FORMAT_R32_SFLOAT) {
        fail("Ray-query reflection hit distance must use R16_SFLOAT or R32_SFLOAT");
        return false;
    }
    for (float value : frame.inverseViewProjection) {
        if (!std::isfinite(value)) {
            fail("Ray-query reflection inverseViewProjection must be finite");
            return false;
        }
    }
    for (float value : frame.cameraPosition) {
        if (!std::isfinite(value)) {
            fail("Ray-query reflection cameraPosition must be finite");
            return false;
        }
    }
    for (float value : frame.parameters) {
        if (!std::isfinite(value)) {
            fail("Ray-query reflection parameters must be finite");
            return false;
        }
    }
    for (float value : frame.environment) {
        if (!std::isfinite(value)) {
            fail("Ray-query reflection environment must be finite");
            return false;
        }
    }
    if (frame.parameters[0] < 0.0f || frame.parameters[1] <= 0.0f ||
        frame.parameters[2] <= 0.0f || frame.parameters[3] <= 0.0f ||
        frame.parameters[3] > 1.0f || frame.environment[0] < 0.0f ||
        frame.environment[1] < 0.0f || frame.environment[2] < 0.0f ||
        frame.environment[3] < 0.0f) {
        fail("Ray-query reflection strengths, distances, bias, cutoff and environment must be valid");
        return false;
    }
    const RayQueryPipelineProfile requiredProfile = hasSpecularHitDistance
        ? RayQueryPipelineProfile::ReflectionsV2
        : RayQueryPipelineProfile::ReflectionsV1;
    const VkPipeline defaultPipeline = !hasSpecularHitDistance
        ? g.reflectionPipeline
        : (hitDistanceFormat == VK_FORMAT_R16_SFLOAT
            ? g.reflectionPipelineV2R16
            : g.reflectionPipelineV2R32);
    const VkPipeline pipeline = frame.pipelineHandle
        ? customPipeline(frame.pipelineHandle, requiredProfile)
        : defaultPipeline;
    if (!pipeline) return false;

    const ReflectionDescriptorKey key{
        static_cast<VkImage>(frame.sourceColorImage),
        static_cast<VkImage>(frame.outputColorImage),
        static_cast<VkImage>(frame.depthImage),
        static_cast<VkImage>(frame.normalRoughnessImage),
        static_cast<VkImage>(frame.specularAlbedoImage),
        static_cast<VkImage>(frame.specularHitDistanceImage),
        hasSpecularHitDistance ? hitDistanceFormat : VK_FORMAT_UNDEFINED,
    };
    const std::array<VkImage, 6> images{{
        key.sourceColor, key.outputColor, key.depth,
        key.normalRoughness, key.specularAlbedo, key.specularHitDistance,
    }};
    const std::size_t imageCount = hasSpecularHitDistance
        ? images.size() : images.size() - 1u;
    for (std::size_t first = 0; first < imageCount; ++first) {
        for (std::size_t second = first + 1; second < imageCount; ++second) {
            if (images[first] == images[second]) {
                fail("Ray-query reflection input and output images must be distinct");
                return false;
            }
        }
    }
    const VkDescriptorSet descriptor = reflectionDescriptorFor(key);
    if (!descriptor) return false;

    const VkCommandBuffer commandBuffer = static_cast<VkCommandBuffer>(frame.commandBuffer);
    const auto sourceLayout = static_cast<VkImageLayout>(frame.sourceColorLayout);
    const auto outputLayout = static_cast<VkImageLayout>(frame.outputColorLayout);
    const auto depthLayout = static_cast<VkImageLayout>(frame.depthLayout);
    const auto normalLayout = static_cast<VkImageLayout>(frame.normalRoughnessLayout);
    const auto specularLayout = static_cast<VkImageLayout>(frame.specularAlbedoLayout);
    const auto hitDistanceLayout =
        static_cast<VkImageLayout>(frame.specularHitDistanceLayout);
    imageBarrier(commandBuffer, key.outputColor, VK_IMAGE_ASPECT_COLOR_BIT,
                 outputLayout, VK_IMAGE_LAYOUT_GENERAL,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_ACCESS_SHADER_WRITE_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
    imageBarrier(commandBuffer, key.sourceColor, VK_IMAGE_ASPECT_COLOR_BIT,
                 sourceLayout, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_ACCESS_SHADER_READ_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
    imageBarrier(commandBuffer, key.depth, VK_IMAGE_ASPECT_DEPTH_BIT,
                 depthLayout, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_ACCESS_SHADER_READ_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
    imageBarrier(commandBuffer, key.normalRoughness, VK_IMAGE_ASPECT_COLOR_BIT,
                 normalLayout, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_ACCESS_SHADER_READ_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
    imageBarrier(commandBuffer, key.specularAlbedo, VK_IMAGE_ASPECT_COLOR_BIT,
                 specularLayout, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_ACCESS_SHADER_READ_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
    if (hasSpecularHitDistance) {
        imageBarrier(commandBuffer, key.specularHitDistance,
                     VK_IMAGE_ASPECT_COLOR_BIT,
                     hitDistanceLayout, VK_IMAGE_LAYOUT_GENERAL,
                     VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                     VK_ACCESS_SHADER_WRITE_BIT,
                     VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
                     VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
    }

    struct PushConstants {
        float inverseViewProjection[16];
        float cameraPosition[4];
        float parameters[4];
        float environment[4];
        uint32_t extentFlags[4];
    } push{};
    static_assert(sizeof(PushConstants) == 128);
    std::copy_n(frame.inverseViewProjection, 16, push.inverseViewProjection);
    std::copy_n(frame.cameraPosition, 4, push.cameraPosition);
    std::copy_n(frame.parameters, 4, push.parameters);
    std::copy_n(frame.environment, 4, push.environment);
    push.extentFlags[0] = frame.width;
    push.extentFlags[1] = frame.height;
    push.extentFlags[2] = frame.flags;
    push.extentFlags[3] = frame.frameIndex;
    g.vk.cmdBindPipeline(commandBuffer, VK_PIPELINE_BIND_POINT_COMPUTE,
                         pipeline);
    g.vk.cmdBindDescriptorSets(commandBuffer, VK_PIPELINE_BIND_POINT_COMPUTE,
                               g.reflectionPipelineLayout, 0, 1, &descriptor,
                               0, nullptr);
    g.vk.cmdPushConstants(commandBuffer, g.reflectionPipelineLayout,
                          VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(push), &push);
    g.vk.cmdDispatch(commandBuffer, (frame.width + 7u) / 8u,
                     (frame.height + 7u) / 8u, 1);

    if (hasSpecularHitDistance) {
        imageBarrier(commandBuffer, key.specularHitDistance,
                     VK_IMAGE_ASPECT_COLOR_BIT,
                     VK_IMAGE_LAYOUT_GENERAL, hitDistanceLayout,
                     VK_ACCESS_SHADER_WRITE_BIT,
                     VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                     VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                     VK_PIPELINE_STAGE_ALL_COMMANDS_BIT);
    }
    imageBarrier(commandBuffer, key.specularAlbedo, VK_IMAGE_ASPECT_COLOR_BIT,
                 VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, specularLayout,
                 VK_ACCESS_SHADER_READ_BIT,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT);
    imageBarrier(commandBuffer, key.normalRoughness, VK_IMAGE_ASPECT_COLOR_BIT,
                 VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, normalLayout,
                 VK_ACCESS_SHADER_READ_BIT,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT);
    imageBarrier(commandBuffer, key.depth, VK_IMAGE_ASPECT_DEPTH_BIT,
                 VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, depthLayout,
                 VK_ACCESS_SHADER_READ_BIT,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT);
    imageBarrier(commandBuffer, key.sourceColor, VK_IMAGE_ASPECT_COLOR_BIT,
                 VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, sourceLayout,
                 VK_ACCESS_SHADER_READ_BIT,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT);
    imageBarrier(commandBuffer, key.outputColor, VK_IMAGE_ASPECT_COLOR_BIT,
                 VK_IMAGE_LAYOUT_GENERAL, outputLayout,
                 VK_ACCESS_SHADER_WRITE_BIT,
                 VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT,
                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                 VK_PIPELINE_STAGE_ALL_COMMANDS_BIT);
    ++g.evaluationCount;
    g.status = hasSpecularHitDistance
        ? "Hardware reflections and a linear specular hit-distance guide dispatched"
        : "Hardware one-bounce roughness-aware reflections dispatched";
    return true;
}

void rayQueryBridgeForgetImage(void* imageValue) {
    std::scoped_lock lock(g.mutex);
    if (!g.device || !imageValue) return;
    const auto image = static_cast<VkImage>(imageValue);
    bool found = false;
    for (const auto& [key, record] : g.descriptors) {
        (void)record;
        if (key.color == image || key.depth == image) {
            found = true;
            break;
        }
    }
    if (!found) {
        for (const auto& [key, record] : g.reflectionDescriptors) {
            (void)record;
            if (key.sourceColor == image || key.outputColor == image ||
                key.depth == image || key.normalRoughness == image ||
                key.specularAlbedo == image || key.specularHitDistance == image) {
                found = true;
                break;
            }
        }
    }
    if (!found) return;
    g.vk.deviceWaitIdle(g.device);
    for (auto iterator = g.descriptors.begin(); iterator != g.descriptors.end();) {
        if (iterator->first.color == image || iterator->first.depth == image) {
            if (iterator->second.set && g.descriptorPool) {
                g.vk.freeDescriptorSets(g.device, g.descriptorPool, 1,
                                        &iterator->second.set);
            }
            if (iterator->second.colorView) {
                g.vk.destroyImageView(g.device, iterator->second.colorView, nullptr);
            }
            if (iterator->second.depthView) {
                g.vk.destroyImageView(g.device, iterator->second.depthView, nullptr);
            }
            iterator = g.descriptors.erase(iterator);
        } else {
            ++iterator;
        }
    }
    for (auto iterator = g.reflectionDescriptors.begin();
         iterator != g.reflectionDescriptors.end();) {
        const auto& key = iterator->first;
        if (key.sourceColor == image || key.outputColor == image ||
            key.depth == image || key.normalRoughness == image ||
            key.specularAlbedo == image || key.specularHitDistance == image) {
            if (iterator->second.set && g.reflectionDescriptorPool) {
                g.vk.freeDescriptorSets(g.device, g.reflectionDescriptorPool, 1,
                                        &iterator->second.set);
            }
            destroyReflectionViews(iterator->second);
            iterator = g.reflectionDescriptors.erase(iterator);
        } else {
            ++iterator;
        }
    }
}

void rayQueryBridgeShutdown() {
    std::scoped_lock lock(g.mutex);
    if (g.device && g.vk.deviceWaitIdle) g.vk.deviceWaitIdle(g.device);
    destroySceneResources(false);
    destroyPipelineResources();
    g.instance = VK_NULL_HANDLE;
    g.physicalDevice = VK_NULL_HANDLE;
    g.device = VK_NULL_HANDLE;
    g.queue = VK_NULL_HANDLE;
    g.vk = {};
    g.attached = false;
    g.webgpuFeatureEnabled = false;
    g.accelerationStructureSupported = false;
    g.rayQuerySupported = false;
    g.status = "Ray query bridge is shut down";
}

#else

bool rayQueryBridgeAttachVulkan(const RayQueryVulkanContext&) { return false; }
RayQueryBridgeCapabilities rayQueryBridgeCapabilities() {
    return {false, false, false, false, false, false, 0, 0, 0, 0,
             "Ray query bridge was not compiled"};
}
bool rayQueryBridgeCreatePipeline(uint32_t, RayQueryPipelineProfile,
                                  const uint32_t*, std::size_t,
                                  const char*) { return false; }
bool rayQueryBridgeDestroyPipeline(uint32_t) { return false; }
void rayQueryBridgeResetPipelines() {}
void rayQueryBridgeSceneBegin() {}
bool rayQueryBridgeSetPositions(const float*, std::size_t) { return false; }
bool rayQueryBridgeSetIndices(const uint32_t*, std::size_t) { return false; }
bool rayQueryBridgeSetTriangleRadiance(const float*, std::size_t) { return false; }
bool rayQueryBridgeSetTriangleSurface(const float*, std::size_t) { return false; }
bool rayQueryBridgeSetStaticLights(const float*, std::size_t) { return false; }
bool rayQueryBridgeAddInstanceGroup(uint32_t, uint32_t, uint32_t, uint32_t,
                                    uint32_t, uint32_t, uint32_t) {
    return false;
}
bool rayQueryBridgeCommit(void*) { return false; }
bool rayQueryBridgeUpdateInstanceGroup(void*, uint32_t, const float*,
                                       const uint32_t*, std::size_t) {
    return false;
}
void rayQueryBridgeDestroyScene() {}
bool rayQueryBridgeEvaluate(const RayQueryLightingFrame&) { return false; }
bool rayQueryBridgeEvaluateReflections(const RayQueryReflectionFrame&) { return false; }
void rayQueryBridgeForgetImage(void*) {}
void rayQueryBridgeShutdown() {}

#endif
