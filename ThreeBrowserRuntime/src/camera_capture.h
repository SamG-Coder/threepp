#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace threebrowser::camera {

struct DeviceInfo {
    std::string id;
    std::string label;
};

struct OpenRequest {
    std::string deviceId;
    std::uint32_t width{};
    std::uint32_t height{};
    double frameRate{};
};

struct OpenResult {
    std::uint32_t handle{};
    std::string deviceId;
    std::string label;
    std::uint32_t width{};
    std::uint32_t height{};
    double frameRate{};
    std::string error;
};

struct ReadResult {
    std::uint64_t sequence{};
    std::uint64_t timestampUs{};
    std::uint32_t width{};
    std::uint32_t height{};
    std::size_t byteLength{};
    bool hasNewFrame{};
    bool copied{};
    bool ended{};
    std::string error;
};

std::vector<DeviceInfo> enumerate(std::string& error);
OpenResult open(const OpenRequest& request);
bool read(std::uint32_t handle, std::uint64_t afterSequence, std::uint8_t* destination,
          std::size_t destinationSize, ReadResult& result, std::string& error);
void close(std::uint32_t handle);
void closeAll();

} // namespace threebrowser::camera
