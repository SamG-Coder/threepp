#include "ray_query_bridge.h"

#if defined(THREEBROWSER_RAY_QUERY)

#ifndef NOMINMAX
#define NOMINMAX
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <vulkan/vulkan.h>

#include "threepp/renderers/vulkan/shaders/ray_query_lighting.comp.spv.h"

#include <algorithm>
#include <array>
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

    std::vector<float> pendingPositions;
    std::vector<uint32_t> pendingIndices;
    Buffer vertices{};
    Buffer indices{};
    Buffer blasScratch{};
    Buffer instances{};
    Buffer tlasScratch{};
    AccelerationStructure blas{};
    AccelerationStructure tlas{};
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
           f.destroyImageView && f.cmdPipelineBarrier &&
           f.cmdBindPipeline && f.cmdBindDescriptorSets && f.cmdPushConstants &&
           f.cmdDispatch && f.deviceWaitIdle;
}

void fail(const std::string& message) {
    ++g.failureCount;
    g.status = message;
}

uint16_t floatToHalf(float value) {
    uint32_t bits{};
    std::memcpy(&bits, &value, sizeof(bits));
    const uint32_t sign = (bits >> 16u) & 0x8000u;
    int32_t exponent = static_cast<int32_t>((bits >> 23u) & 0xffu) - 127 + 15;
    uint32_t mantissa = bits & 0x007fffffu;
    if (exponent <= 0) {
        if (exponent < -10) return static_cast<uint16_t>(sign);
        mantissa = (mantissa | 0x00800000u) >> static_cast<uint32_t>(1 - exponent);
        return static_cast<uint16_t>(sign | ((mantissa + 0x00001000u) >> 13u));
    }
    if (exponent >= 31) {
        return static_cast<uint16_t>(sign | 0x7c00u);
    }
    return static_cast<uint16_t>(sign | (static_cast<uint32_t>(exponent) << 10u) |
                                 ((mantissa + 0x00001000u) >> 13u));
}

uint32_t packHalf2(float low, float high) {
    return static_cast<uint32_t>(floatToHalf(low)) |
           (static_cast<uint32_t>(floatToHalf(high)) << 16u);
}

uint32_t findMemoryType(uint32_t bits, VkMemoryPropertyFlags required,
                        VkMemoryPropertyFlags preferred, bool* coherent = nullptr) {
    VkPhysicalDeviceMemoryProperties properties{};
    g.vk.getPhysicalDeviceMemoryProperties(g.physicalDevice, &properties);
    uint32_t fallback = std::numeric_limits<uint32_t>::max();
    for (uint32_t index = 0; index < properties.memoryTypeCount; ++index) {
        if ((bits & (1u << index)) == 0u) continue;
        const auto flags = properties.memoryTypes[index].propertyFlags;
        if ((flags & required) != required) continue;
        if ((flags & preferred) == preferred) {
            if (coherent) *coherent = (flags & VK_MEMORY_PROPERTY_HOST_COHERENT_BIT) != 0;
            return index;
        }
        if (fallback == std::numeric_limits<uint32_t>::max()) fallback = index;
    }
    if (fallback != std::numeric_limits<uint32_t>::max() && coherent) {
        *coherent = (properties.memoryTypes[fallback].propertyFlags &
                     VK_MEMORY_PROPERTY_HOST_COHERENT_BIT) != 0;
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
                                                &output.coherent);
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
    if (!buffer.memory || !data || bytes > buffer.size ||
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
    destroyAccelerationStructure(g.tlas);
    destroyAccelerationStructure(g.blas);
    destroyBuffer(g.tlasScratch);
    destroyBuffer(g.instances);
    destroyBuffer(g.blasScratch);
    destroyBuffer(g.indices);
    destroyBuffer(g.vertices);
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

void destroyPipelineResources() {
    if (!g.device) return;
    resetDescriptorCache();
    if (g.depthSampler) g.vk.destroySampler(g.device, g.depthSampler, nullptr);
    if (g.pipeline) g.vk.destroyPipeline(g.device, g.pipeline, nullptr);
    if (g.pipelineLayout) g.vk.destroyPipelineLayout(g.device, g.pipelineLayout, nullptr);
    if (g.descriptorPool) g.vk.destroyDescriptorPool(g.device, g.descriptorPool, nullptr);
    if (g.descriptorLayout) {
        g.vk.destroyDescriptorSetLayout(g.device, g.descriptorLayout, nullptr);
    }
    g.depthSampler = VK_NULL_HANDLE;
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
        g.pipeline != VK_NULL_HANDLE,
        g.sceneReady,
        g.triangleCount,
        g.buildCount,
        g.evaluationCount,
        g.failureCount,
        status.c_str(),
    };
}

void rayQueryBridgeSceneBegin() {
    std::scoped_lock lock(g.mutex);
    destroySceneResources(true);
    g.pendingPositions.clear();
    g.pendingIndices.clear();
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
    // A direct C-API caller may recommit without a preceding SceneBegin.  Wait
    // before replacing an existing or partially-created scene so no submitted
    // lighting dispatch can still reference its TLAS or descriptor sets.  The
    // usual SceneBegin -> Commit path has already cleared these resources.
    const bool replacingScene =
        g.sceneReady || g.tlas.handle || g.tlas.storage.buffer ||
        g.blas.handle || g.blas.storage.buffer || g.tlasScratch.buffer ||
        g.instances.buffer || g.blasScratch.buffer || g.indices.buffer ||
        g.vertices.buffer;
    destroySceneResources(replacingScene);
    const VkBufferUsageFlags geometryUsage =
        VK_BUFFER_USAGE_ACCELERATION_STRUCTURE_BUILD_INPUT_READ_ONLY_BIT_KHR |
        VK_BUFFER_USAGE_SHADER_DEVICE_ADDRESS_BIT;
    const VkMemoryPropertyFlags uploadRequired = VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT;
    const VkMemoryPropertyFlags uploadPreferred =
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
    if (!createBuffer(g.pendingPositions.size() * sizeof(float), geometryUsage,
                      uploadRequired, uploadPreferred, g.vertices) ||
        !uploadBuffer(g.vertices, g.pendingPositions.data(),
                      g.pendingPositions.size() * sizeof(float)) ||
        !createBuffer(g.pendingIndices.size() * sizeof(uint32_t), geometryUsage,
                      uploadRequired, uploadPreferred, g.indices) ||
        !uploadBuffer(g.indices, g.pendingIndices.data(),
                      g.pendingIndices.size() * sizeof(uint32_t))) {
        destroySceneResources(false);
        return false;
    }

    const uint32_t primitiveCount = static_cast<uint32_t>(g.pendingIndices.size() / 3u);
    VkAccelerationStructureGeometryTrianglesDataKHR triangles{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_GEOMETRY_TRIANGLES_DATA_KHR};
    triangles.vertexFormat = VK_FORMAT_R32G32B32_SFLOAT;
    triangles.vertexData.deviceAddress = g.vertices.address;
    triangles.vertexStride = 3u * sizeof(float);
    triangles.maxVertex = vertexCount - 1u;
    triangles.indexType = VK_INDEX_TYPE_UINT32;
    triangles.indexData.deviceAddress = g.indices.address;
    VkAccelerationStructureGeometryKHR geometry{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_GEOMETRY_KHR};
    geometry.geometryType = VK_GEOMETRY_TYPE_TRIANGLES_KHR;
    geometry.flags = VK_GEOMETRY_OPAQUE_BIT_KHR;
    geometry.geometry.triangles = triangles;
    VkAccelerationStructureBuildGeometryInfoKHR blasBuild{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_BUILD_GEOMETRY_INFO_KHR};
    blasBuild.type = VK_ACCELERATION_STRUCTURE_TYPE_BOTTOM_LEVEL_KHR;
    blasBuild.flags = VK_BUILD_ACCELERATION_STRUCTURE_PREFER_FAST_TRACE_BIT_KHR;
    blasBuild.mode = VK_BUILD_ACCELERATION_STRUCTURE_MODE_BUILD_KHR;
    blasBuild.geometryCount = 1;
    blasBuild.pGeometries = &geometry;
    VkAccelerationStructureBuildSizesInfoKHR blasSizes{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_BUILD_SIZES_INFO_KHR};
    g.vk.getAccelerationStructureBuildSizes(
        g.device, VK_ACCELERATION_STRUCTURE_BUILD_TYPE_DEVICE_KHR,
        &blasBuild, &primitiveCount, &blasSizes);
    if (!createAccelerationStructure(VK_ACCELERATION_STRUCTURE_TYPE_BOTTOM_LEVEL_KHR,
                                     blasSizes.accelerationStructureSize, g.blas) ||
        !createBuffer(blasSizes.buildScratchSize,
                      VK_BUFFER_USAGE_STORAGE_BUFFER_BIT |
                      VK_BUFFER_USAGE_SHADER_DEVICE_ADDRESS_BIT,
                      VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT,
                      VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT,
                      g.blasScratch)) {
        destroySceneResources(false);
        return false;
    }
    blasBuild.dstAccelerationStructure = g.blas.handle;
    blasBuild.scratchData.deviceAddress = g.blasScratch.address;
    VkAccelerationStructureDeviceAddressInfoKHR blasAddressInfo{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_DEVICE_ADDRESS_INFO_KHR};
    blasAddressInfo.accelerationStructure = g.blas.handle;
    g.blas.address = g.vk.getAccelerationStructureDeviceAddress(g.device, &blasAddressInfo);
    if (!g.blas.address) {
        fail("Vulkan returned no address for the static BLAS");
        destroySceneResources(false);
        return false;
    }

    VkAccelerationStructureInstanceKHR instance{};
    instance.transform.matrix[0][0] = 1.0f;
    instance.transform.matrix[1][1] = 1.0f;
    instance.transform.matrix[2][2] = 1.0f;
    instance.mask = 0xffu;
    instance.flags = VK_GEOMETRY_INSTANCE_TRIANGLE_FACING_CULL_DISABLE_BIT_KHR;
    instance.accelerationStructureReference = g.blas.address;
    if (!createBuffer(sizeof(instance), geometryUsage, uploadRequired,
                      uploadPreferred, g.instances) ||
        !uploadBuffer(g.instances, &instance, sizeof(instance))) {
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
    tlasBuild.flags = VK_BUILD_ACCELERATION_STRUCTURE_PREFER_FAST_TRACE_BIT_KHR;
    tlasBuild.mode = VK_BUILD_ACCELERATION_STRUCTURE_MODE_BUILD_KHR;
    tlasBuild.geometryCount = 1;
    tlasBuild.pGeometries = &tlasGeometry;
    const uint32_t instanceCount = 1;
    VkAccelerationStructureBuildSizesInfoKHR tlasSizes{
        VK_STRUCTURE_TYPE_ACCELERATION_STRUCTURE_BUILD_SIZES_INFO_KHR};
    g.vk.getAccelerationStructureBuildSizes(
        g.device, VK_ACCELERATION_STRUCTURE_BUILD_TYPE_DEVICE_KHR,
        &tlasBuild, &instanceCount, &tlasSizes);
    if (!createAccelerationStructure(VK_ACCELERATION_STRUCTURE_TYPE_TOP_LEVEL_KHR,
                                     tlasSizes.accelerationStructureSize, g.tlas) ||
        !createBuffer(tlasSizes.buildScratchSize,
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

    // Do not record either build until every object referenced by both commands
    // has been allocated and uploaded.  From this point onward there are no
    // fallible resource-creation paths that could invalidate the command buffer.
    const VkCommandBuffer commandBuffer = static_cast<VkCommandBuffer>(commandBufferValue);
    VkAccelerationStructureBuildRangeInfoKHR blasRange{};
    blasRange.primitiveCount = primitiveCount;
    const VkAccelerationStructureBuildRangeInfoKHR* blasRangePtr = &blasRange;
    g.vk.cmdBuildAccelerationStructures(commandBuffer, 1, &blasBuild, &blasRangePtr);
    VkMemoryBarrier buildBarrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
    buildBarrier.srcAccessMask = VK_ACCESS_ACCELERATION_STRUCTURE_WRITE_BIT_KHR;
    buildBarrier.dstAccessMask = VK_ACCESS_ACCELERATION_STRUCTURE_READ_BIT_KHR;
    g.vk.cmdPipelineBarrier(commandBuffer,
                            VK_PIPELINE_STAGE_ACCELERATION_STRUCTURE_BUILD_BIT_KHR,
                            VK_PIPELINE_STAGE_ACCELERATION_STRUCTURE_BUILD_BIT_KHR,
                            0, 1, &buildBarrier, 0, nullptr, 0, nullptr);
    VkAccelerationStructureBuildRangeInfoKHR tlasRange{};
    tlasRange.primitiveCount = 1;
    const VkAccelerationStructureBuildRangeInfoKHR* tlasRangePtr = &tlasRange;
    g.vk.cmdBuildAccelerationStructures(commandBuffer, 1, &tlasBuild, &tlasRangePtr);
    g.vk.cmdPipelineBarrier(commandBuffer,
                            VK_PIPELINE_STAGE_ACCELERATION_STRUCTURE_BUILD_BIT_KHR,
                            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                            0, 1, &buildBarrier, 0, nullptr, 0, nullptr);
    g.sceneReady = true;
    g.triangleCount = primitiveCount;
    ++g.buildCount;
    g.status = g.sceneReady
        ? "Static BLAS/TLAS recorded on the WebGPU command buffer"
        : "Vulkan returned no address for the static TLAS";
    g.pendingPositions.clear();
    g.pendingIndices.clear();
    return g.sceneReady;
}

void rayQueryBridgeDestroyScene() {
    std::scoped_lock lock(g.mutex);
    destroySceneResources(true);
    g.pendingPositions.clear();
    g.pendingIndices.clear();
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
    for (float value : frame.water) {
        if (!std::isfinite(value)) {
            fail("Ray-query water parameters must be finite");
            return false;
        }
    }
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
        float cameraPosition[4];
        float sunDirectionIntensity[4];
        float parameters[4];
        uint32_t extentFlags[4];
    } push{};
    static_assert(sizeof(PushConstants) == 128);
    std::copy_n(frame.inverseViewProjection, 16, push.inverseViewProjection);
    std::copy_n(frame.cameraPosition, 4, push.cameraPosition);
    std::copy_n(frame.sunDirectionIntensity, 4, push.sunDirectionIntensity);
    std::copy_n(frame.parameters, 4, push.parameters);
    push.cameraPosition[3] = frame.water[0];
    push.parameters[3] = std::max(0.0f, frame.water[2]);
    push.extentFlags[0] = frame.width;
    push.extentFlags[1] = frame.height;
    push.extentFlags[2] = frame.flags;
    push.extentFlags[3] = packHalf2(frame.water[1],
                                    std::clamp(frame.water[3], 1.0001f, 4.0f));
    g.vk.cmdBindPipeline(commandBuffer, VK_PIPELINE_BIND_POINT_COMPUTE, g.pipeline);
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
    g.status = "Hardware ray-query sun visibility and RTAO dispatched";
    return true;
}

void rayQueryBridgeForgetImage(void* imageValue) {
    std::scoped_lock lock(g.mutex);
    if (!g.device || !imageValue) return;
    const auto image = static_cast<VkImage>(imageValue);
    bool found = false;
    for (const auto& [key, record] : g.descriptors) {
        if (key.color == image || key.depth == image) {
            found = true;
            break;
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
void rayQueryBridgeSceneBegin() {}
bool rayQueryBridgeSetPositions(const float*, std::size_t) { return false; }
bool rayQueryBridgeSetIndices(const uint32_t*, std::size_t) { return false; }
bool rayQueryBridgeCommit(void*) { return false; }
void rayQueryBridgeDestroyScene() {}
bool rayQueryBridgeEvaluate(const RayQueryLightingFrame&) { return false; }
void rayQueryBridgeForgetImage(void*) {}
void rayQueryBridgeShutdown() {}

#endif
