#include "shader_compiler.h"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>

namespace {

constexpr size_t kMaximumShaderBytes = 1024u * 1024u;
constexpr size_t kMaximumCompilerLogBytes = 64u * 1024u;
constexpr DWORD kCompilerTimeoutMilliseconds = 30000u;
constexpr char kCacheAbi[] = "ThreeBrowser.GLSL-SPIRV.Cache/v1";
constexpr char kTargetEnvironment[] = "vulkan1.3";
constexpr char kCompilerFlagsIdentity[] = "-V|--target-env=vulkan1.3|-Os";
constexpr uint32_t kSpirvMagic = 0x07230203u;
constexpr uint16_t kSpirvOpEntryPoint = 15u;
constexpr uint32_t kSpirvExecutionModelGlCompute = 5u;

const int kModuleAnchor = 0;
std::mutex gCompileMutex;

class Sha256 final {
public:
    Sha256() {
        if (BCryptOpenAlgorithmProvider(&algorithm_, BCRYPT_SHA256_ALGORITHM,
                                        nullptr, 0) != 0) {
            return;
        }

        DWORD copied = 0;
        if (BCryptGetProperty(algorithm_, BCRYPT_OBJECT_LENGTH,
                              reinterpret_cast<PUCHAR>(&objectLength_),
                              sizeof(objectLength_), &copied, 0) != 0 ||
            objectLength_ == 0) {
            return;
        }
        if (BCryptGetProperty(algorithm_, BCRYPT_HASH_LENGTH,
                              reinterpret_cast<PUCHAR>(&hashLength_),
                              sizeof(hashLength_), &copied, 0) != 0 ||
            hashLength_ != 32u) {
            return;
        }

        object_.resize(objectLength_);
        if (BCryptCreateHash(algorithm_, &hash_, object_.data(),
                             static_cast<ULONG>(object_.size()), nullptr, 0,
                             0) != 0) {
            hash_ = nullptr;
            return;
        }
        valid_ = true;
    }

    ~Sha256() {
        if (hash_) BCryptDestroyHash(hash_);
        if (algorithm_) BCryptCloseAlgorithmProvider(algorithm_, 0);
    }

    Sha256(const Sha256&) = delete;
    Sha256& operator=(const Sha256&) = delete;

    bool update(const void* bytes, size_t length) {
        if (!valid_ || (!bytes && length != 0)) return false;
        const auto* cursor = static_cast<const uint8_t*>(bytes);
        while (length != 0) {
            const ULONG chunk = static_cast<ULONG>(
                std::min<size_t>(length, static_cast<size_t>(0x7fffffffu)));
            if (BCryptHashData(hash_, const_cast<PUCHAR>(cursor), chunk, 0) != 0) {
                valid_ = false;
                return false;
            }
            cursor += chunk;
            length -= chunk;
        }
        return true;
    }

    bool update(std::string_view text) {
        const uint64_t length = static_cast<uint64_t>(text.size());
        return update(&length, sizeof(length)) && update(text.data(), text.size());
    }

    bool finish(std::array<uint8_t, 32>& digest) {
        if (!valid_ || BCryptFinishHash(hash_, digest.data(),
                                        static_cast<ULONG>(digest.size()),
                                        0) != 0) {
            valid_ = false;
            return false;
        }
        valid_ = false;
        return true;
    }

private:
    BCRYPT_ALG_HANDLE algorithm_{};
    BCRYPT_HASH_HANDLE hash_{};
    DWORD objectLength_{};
    DWORD hashLength_{};
    std::vector<uint8_t> object_;
    bool valid_{false};
};

std::string digestHex(const std::array<uint8_t, 32>& digest) {
    std::ostringstream out;
    out << std::hex << std::setfill('0');
    for (const uint8_t byte : digest) out << std::setw(2) << unsigned(byte);
    return out.str();
}

std::string windowsErrorMessage(DWORD error) {
    wchar_t* buffer = nullptr;
    const DWORD length = FormatMessageW(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
            FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr, error, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
        reinterpret_cast<wchar_t*>(&buffer), 0, nullptr);
    std::string result = "Windows error " + std::to_string(error);
    if (length != 0 && buffer) {
        const int utf8Length = WideCharToMultiByte(CP_UTF8, 0, buffer,
                                                   static_cast<int>(length),
                                                   nullptr, 0, nullptr, nullptr);
        if (utf8Length > 0) {
            result.resize(static_cast<size_t>(utf8Length));
            WideCharToMultiByte(CP_UTF8, 0, buffer, static_cast<int>(length),
                                result.data(), utf8Length, nullptr, nullptr);
            while (!result.empty() &&
                   (result.back() == '\r' || result.back() == '\n' ||
                    result.back() == ' ')) {
                result.pop_back();
            }
        }
    }
    if (buffer) LocalFree(buffer);
    return result;
}

std::filesystem::path moduleDirectory() {
    HMODULE module = nullptr;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                                GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                            reinterpret_cast<LPCWSTR>(&kModuleAnchor),
                            &module)) {
        return {};
    }

    std::vector<wchar_t> path(512u);
    for (;;) {
        const DWORD length = GetModuleFileNameW(module, path.data(),
                                                static_cast<DWORD>(path.size()));
        if (length == 0) return {};
        if (length < path.size() - 1u) {
            return std::filesystem::path(std::wstring(path.data(), length))
                .parent_path();
        }
        if (path.size() >= 32768u) return {};
        path.resize(path.size() * 2u);
    }
}

std::filesystem::path cacheDirectory() {
    std::vector<wchar_t> local(512u);
    DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", local.data(),
                                            static_cast<DWORD>(local.size()));
    if (length >= local.size()) {
        local.resize(static_cast<size_t>(length) + 1u);
        length = GetEnvironmentVariableW(L"LOCALAPPDATA", local.data(),
                                         static_cast<DWORD>(local.size()));
    }
    if (length != 0 && length < local.size()) {
        return std::filesystem::path(std::wstring(local.data(), length)) /
               L"ThreeBrowser" / L"ShaderCache" / L"v1";
    }

    std::vector<wchar_t> temporary(MAX_PATH + 1u);
    length = GetTempPathW(static_cast<DWORD>(temporary.size()), temporary.data());
    if (length != 0 && length < temporary.size()) {
        return std::filesystem::path(std::wstring(temporary.data(), length)) /
               L"ThreeBrowser" / L"ShaderCache" / L"v1";
    }
    return {};
}

bool validEntryPoint(std::string_view entryPoint) {
    if (entryPoint.empty() || entryPoint.size() > 255u) return false;
    const auto validFirst = [](unsigned char value) {
        return std::isalpha(value) != 0 || value == '_';
    };
    const auto validRest = [](unsigned char value) {
        return std::isalnum(value) != 0 || value == '_';
    };
    if (!validFirst(static_cast<unsigned char>(entryPoint.front()))) return false;
    return std::all_of(entryPoint.begin() + 1, entryPoint.end(),
                       [&](char value) {
                           return validRest(static_cast<unsigned char>(value));
                       });
}

const char* stageName(tw::VulkanShaderStage stage) {
    switch (stage) {
        case tw::VulkanShaderStage::Compute: return "comp";
    }
    return nullptr;
}

bool hashFile(const std::filesystem::path& path,
              std::array<uint8_t, 32>& digest,
              std::string& error) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        error = "Could not read bundled shader compiler: " + path.string();
        return false;
    }
    Sha256 hash;
    std::array<char, 64u * 1024u> buffer{};
    while (input) {
        input.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        const std::streamsize count = input.gcount();
        if (count > 0 && !hash.update(buffer.data(), static_cast<size_t>(count))) {
            error = "Could not hash the bundled shader compiler";
            return false;
        }
    }
    if (!input.eof()) {
        error = "Failed while reading the bundled shader compiler";
        return false;
    }
    if (!hash.finish(digest)) {
        error = "Could not finalize the bundled shader compiler identity";
        return false;
    }
    return true;
}

bool readSpirv(const std::filesystem::path& path,
               std::vector<uint32_t>& words) {
    std::error_code fileError;
    const uintmax_t byteLength = std::filesystem::file_size(path, fileError);
    if (fileError || byteLength < 20u || byteLength > kMaximumShaderBytes ||
        (byteLength & 3u) != 0u) {
        return false;
    }
    words.resize(static_cast<size_t>(byteLength / sizeof(uint32_t)));
    std::ifstream input(path, std::ios::binary);
    if (!input || !input.read(reinterpret_cast<char*>(words.data()),
                              static_cast<std::streamsize>(byteLength))) {
        words.clear();
        return false;
    }
    return true;
}

std::string spirvString(const uint32_t* words, size_t wordCount) {
    const char* bytes = reinterpret_cast<const char*>(words);
    const size_t byteCount = wordCount * sizeof(uint32_t);
    size_t length = 0;
    while (length < byteCount && bytes[length] != '\0') ++length;
    if (length == byteCount) return {};
    return std::string(bytes, length);
}

bool validateSpirv(const std::vector<uint32_t>& words,
                   std::string_view entryPoint,
                   std::string& error) {
    if (words.size() < 5u || words[0] != kSpirvMagic || words[3] == 0u ||
        words[4] != 0u) {
        error = "Shader compiler produced an invalid SPIR-V header";
        return false;
    }

    bool foundComputeEntry = false;
    for (size_t offset = 5u; offset < words.size();) {
        const uint32_t instruction = words[offset];
        const uint16_t wordCount = static_cast<uint16_t>(instruction >> 16u);
        const uint16_t opcode = static_cast<uint16_t>(instruction & 0xffffu);
        if (wordCount == 0u || offset + wordCount > words.size()) {
            error = "Shader compiler produced malformed SPIR-V instructions";
            return false;
        }
        if (opcode == kSpirvOpEntryPoint && wordCount >= 4u &&
            words[offset + 1u] == kSpirvExecutionModelGlCompute) {
            const std::string name = spirvString(words.data() + offset + 3u,
                                                 wordCount - 3u);
            if (name == entryPoint) foundComputeEntry = true;
        }
        offset += wordCount;
    }
    if (!foundComputeEntry) {
        error = "SPIR-V does not contain the requested compute entry point '" +
                std::string(entryPoint) + "'";
        return false;
    }
    return true;
}

std::wstring quoteCommandArgument(const std::wstring& argument) {
    if (argument.empty()) return L"\"\"";
    if (argument.find_first_of(L" \t\n\v\"") == std::wstring::npos) {
        return argument;
    }
    std::wstring quoted(1u, L'\"');
    size_t slashCount = 0;
    for (const wchar_t value : argument) {
        if (value == L'\\') {
            ++slashCount;
            continue;
        }
        if (value == L'\"') {
            quoted.append(slashCount * 2u + 1u, L'\\');
            quoted.push_back(L'\"');
            slashCount = 0;
            continue;
        }
        quoted.append(slashCount, L'\\');
        slashCount = 0;
        quoted.push_back(value);
    }
    quoted.append(slashCount * 2u, L'\\');
    quoted.push_back(L'\"');
    return quoted;
}

std::wstring makeCommandLine(const std::vector<std::wstring>& arguments) {
    std::wstring commandLine;
    for (const auto& argument : arguments) {
        if (!commandLine.empty()) commandLine.push_back(L' ');
        commandLine += quoteCommandArgument(argument);
    }
    return commandLine;
}

std::string readCompilerLog(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) return {};
    std::string text;
    text.resize(kMaximumCompilerLogBytes);
    input.read(text.data(), static_cast<std::streamsize>(text.size()));
    text.resize(static_cast<size_t>(input.gcount()));
    while (!text.empty() && (text.back() == '\r' || text.back() == '\n')) {
        text.pop_back();
    }
    return text;
}

struct TemporaryFiles final {
    std::filesystem::path input;
    std::filesystem::path output;
    std::filesystem::path log;

    ~TemporaryFiles() {
        std::error_code ignored;
        std::filesystem::remove(input, ignored);
        std::filesystem::remove(output, ignored);
        std::filesystem::remove(log, ignored);
    }
};

bool runCompiler(const std::filesystem::path& compiler,
                 const std::filesystem::path& workingDirectory,
                 const std::filesystem::path& sourcePath,
                 const std::filesystem::path& outputPath,
                 const std::filesystem::path& logPath,
                 std::string_view entryPoint,
                 const char* stage,
                 std::string& diagnostic) {
    SECURITY_ATTRIBUTES security{};
    security.nLength = sizeof(security);
    security.bInheritHandle = TRUE;
    HANDLE log = CreateFileW(logPath.c_str(), GENERIC_READ | GENERIC_WRITE,
                             FILE_SHARE_READ | FILE_SHARE_WRITE, &security,
                             CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, nullptr);
    if (log == INVALID_HANDLE_VALUE) {
        diagnostic = "Could not create shader compiler log: " +
                     windowsErrorMessage(GetLastError());
        return false;
    }
    HANDLE nullInput = CreateFileW(L"NUL", GENERIC_READ,
                                   FILE_SHARE_READ | FILE_SHARE_WRITE,
                                   &security, OPEN_EXISTING, 0, nullptr);

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = nullInput == INVALID_HANDLE_VALUE ? nullptr : nullInput;
    startup.hStdOutput = log;
    startup.hStdError = log;

    const int wideEntryLength = MultiByteToWideChar(
        CP_UTF8, MB_ERR_INVALID_CHARS, entryPoint.data(),
        static_cast<int>(entryPoint.size()), nullptr, 0);
    if (wideEntryLength <= 0) {
        if (nullInput != INVALID_HANDLE_VALUE) CloseHandle(nullInput);
        CloseHandle(log);
        diagnostic = "Shader entry point is not valid UTF-8";
        return false;
    }
    std::wstring wideEntry(static_cast<size_t>(wideEntryLength), L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, entryPoint.data(),
                        static_cast<int>(entryPoint.size()), wideEntry.data(),
                        wideEntryLength);

    std::wstring wideStage;
    for (const char value : std::string_view(stage)) {
        wideStage.push_back(static_cast<wchar_t>(
            static_cast<unsigned char>(value)));
    }

    std::vector<std::wstring> arguments{
        compiler.wstring(), L"-V", L"--target-env", L"vulkan1.3", L"-Os",
        L"-S", wideStage,
        L"-e", wideEntry, sourcePath.wstring(), L"-o", outputPath.wstring()};
    std::wstring commandLine = makeCommandLine(arguments);
    std::vector<wchar_t> mutableCommand(commandLine.begin(), commandLine.end());
    mutableCommand.push_back(L'\0');

    PROCESS_INFORMATION process{};
    const BOOL created = CreateProcessW(
        compiler.c_str(), mutableCommand.data(), nullptr, nullptr, TRUE,
        CREATE_NO_WINDOW, nullptr, workingDirectory.c_str(), &startup, &process);
    const DWORD createError = created ? ERROR_SUCCESS : GetLastError();
    if (nullInput != INVALID_HANDLE_VALUE) CloseHandle(nullInput);
    if (!created) {
        CloseHandle(log);
        diagnostic = "Could not start bundled glslangValidator.exe: " +
                     windowsErrorMessage(createError);
        return false;
    }

    const DWORD waitResult = WaitForSingleObject(process.hProcess,
                                                  kCompilerTimeoutMilliseconds);
    const DWORD waitError = waitResult == WAIT_FAILED
        ? GetLastError()
        : ERROR_SUCCESS;
    if (waitResult == WAIT_TIMEOUT) {
        TerminateProcess(process.hProcess, ERROR_TIMEOUT);
        WaitForSingleObject(process.hProcess, 5000u);
    }
    DWORD exitCode = ERROR_GEN_FAILURE;
    GetExitCodeProcess(process.hProcess, &exitCode);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    FlushFileBuffers(log);
    CloseHandle(log);

    const std::string compilerLog = readCompilerLog(logPath);
    if (waitResult == WAIT_TIMEOUT) {
        diagnostic = "glslangValidator timed out after 30 seconds";
        if (!compilerLog.empty()) diagnostic += ":\n" + compilerLog;
        return false;
    }
    if (waitResult != WAIT_OBJECT_0) {
        diagnostic = "Could not wait for glslangValidator: " +
                     windowsErrorMessage(waitError);
        return false;
    }
    if (exitCode != 0u) {
        diagnostic = "GLSL compilation failed";
        if (!compilerLog.empty()) diagnostic += ":\n" + compilerLog;
        return false;
    }
    return true;
}

} // namespace

namespace tw {

bool compileVulkanShaderCached(const VulkanShaderCompileRequest& request,
                               VulkanShaderCompileResult& result) {
    result = {};
    const char* stage = stageName(request.stage);
    if (!stage || !validEntryPoint(request.entryPoint) ||
        request.source.empty() || request.source.size() > kMaximumShaderBytes ||
        request.profileIdentity.empty() ||
        std::find(request.source.begin(), request.source.end(), '\0') !=
            request.source.end()) {
        result.diagnostic = "Invalid GLSL shader compilation request";
        return false;
    }

    const std::filesystem::path module = moduleDirectory();
    const std::filesystem::path compiler = module / L"glslangValidator.exe";
    std::error_code pathError;
    if (module.empty() || !std::filesystem::is_regular_file(compiler, pathError)) {
        result.diagnostic =
            "Bundled glslangValidator.exe is missing beside three_webgpu.dll";
        return false;
    }

    std::array<uint8_t, 32> compilerDigest{};
    if (!hashFile(compiler, compilerDigest, result.diagnostic)) return false;

    Sha256 cacheHash;
    const uint32_t stageValue = static_cast<uint32_t>(request.stage);
    if (!cacheHash.update(kCacheAbi) || !cacheHash.update(kTargetEnvironment) ||
        !cacheHash.update(kCompilerFlagsIdentity) ||
        !cacheHash.update(&stageValue, sizeof(stageValue)) ||
        !cacheHash.update(std::string_view(stage)) ||
        !cacheHash.update(request.entryPoint) ||
        !cacheHash.update(request.profileIdentity) ||
        !cacheHash.update(compilerDigest.data(), compilerDigest.size()) ||
        !cacheHash.update(request.source)) {
        result.diagnostic = "Could not hash GLSL shader compilation inputs";
        return false;
    }
    std::array<uint8_t, 32> digest{};
    if (!cacheHash.finish(digest)) {
        result.diagnostic = "Could not finalize GLSL shader cache key";
        return false;
    }
    result.cacheKey = digestHex(digest);

    const std::filesystem::path cache = cacheDirectory();
    if (cache.empty()) {
        result.diagnostic = "Could not locate a writable shader cache directory";
        return false;
    }
    std::filesystem::create_directories(cache, pathError);
    if (pathError) {
        result.diagnostic = "Could not create shader cache directory: " +
                            pathError.message();
        return false;
    }
    const std::filesystem::path cachedSpirv =
        cache / (result.cacheKey + ".spv");

    auto loadCache = [&]() {
        std::vector<uint32_t> words;
        std::string validationError;
        if (!readSpirv(cachedSpirv, words) ||
            !validateSpirv(words, request.entryPoint, validationError)) {
            return false;
        }
        result.spirv = std::move(words);
        result.cacheHit = true;
        result.diagnostic = "Loaded cached SPIR-V " + result.cacheKey;
        return true;
    };
    if (loadCache()) return true;

    std::lock_guard<std::mutex> lock(gCompileMutex);
    if (loadCache()) return true;

    // Remove a stale/corrupt entry before compiling. Its filename is derived
    // solely from trusted hex digits, so this never escapes the cache root.
    std::filesystem::remove(cachedSpirv, pathError);
    pathError.clear();

    const std::string unique = result.cacheKey + "." +
        std::to_string(GetCurrentProcessId()) + "." +
        std::to_string(GetCurrentThreadId());
    TemporaryFiles temporary{
        cache / (unique + ".comp.tmp"),
        cache / (unique + ".spv.tmp"),
        cache / (unique + ".log.tmp")};

    {
        std::ofstream source(temporary.input, std::ios::binary | std::ios::trunc);
        if (!source || !source.write(request.source.data(),
                                     static_cast<std::streamsize>(request.source.size()))) {
            result.diagnostic = "Could not write temporary GLSL source";
            return false;
        }
    }

    if (!runCompiler(compiler, module, temporary.input, temporary.output,
                     temporary.log, request.entryPoint, stage,
                     result.diagnostic)) {
        return false;
    }

    std::vector<uint32_t> compiled;
    if (!readSpirv(temporary.output, compiled) ||
        !validateSpirv(compiled, request.entryPoint, result.diagnostic)) {
        if (result.diagnostic.empty()) {
            result.diagnostic = "glslangValidator did not produce valid SPIR-V";
        }
        return false;
    }

    if (!MoveFileExW(temporary.output.c_str(), cachedSpirv.c_str(),
                     MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        // Another process can legitimately win the same content-addressed
        // cache race. Accept its file only after full SPIR-V validation.
        if (!loadCache()) {
            result.diagnostic = "Could not publish compiled SPIR-V cache entry: " +
                                windowsErrorMessage(GetLastError());
            return false;
        }
        return true;
    }
    temporary.output.clear();
    result.spirv = std::move(compiled);
    result.cacheHit = false;
    result.diagnostic = "Compiled and cached SPIR-V " + result.cacheKey;
    return true;
}

} // namespace tw
