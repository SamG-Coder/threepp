#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace tw {

enum class VulkanShaderStage : uint32_t {
    Compute = 1,
};

// The caller supplies profileIdentity as part of the shader ABI.  It is not a
// glslang command-line option; it prevents two consumers with different
// descriptor/push-constant contracts from sharing a cached binary merely
// because their source text happens to match.
struct VulkanShaderCompileRequest {
    std::string_view source;
    std::string_view entryPoint;
    std::string_view profileIdentity;
    VulkanShaderStage stage{VulkanShaderStage::Compute};
};

struct VulkanShaderCompileResult {
    std::vector<uint32_t> spirv;
    bool cacheHit{false};
    std::string cacheKey;
    std::string diagnostic;
};

// Compiles GLSL with the glslangValidator executable shipped beside
// three_webgpu.dll.  The cache is content-addressed and includes the exact
// compiler binary identity, source, entry point, target, stage, profile ABI,
// flags and ThreeBrowser cache ABI.
bool compileVulkanShaderCached(const VulkanShaderCompileRequest& request,
                               VulkanShaderCompileResult& result);

} // namespace tw
