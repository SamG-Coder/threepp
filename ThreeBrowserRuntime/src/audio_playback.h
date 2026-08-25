#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace threebrowser::audio {

struct CuePoint {
    std::uint32_t id{};
    std::uint64_t sampleFrame{};
};

struct PlaybackState {
    std::uint64_t cursorFrame{};
    std::uint64_t lengthFrames{};
    std::uint64_t loopIndex{};
    std::uint32_t sampleRate{};
    std::uint32_t channels{};
    bool playing{};
    bool ended{};
    bool looping{};
    float volume{1.0f};
    float playbackRate{1.0f};
    std::string error;
};

struct CueEvent {
    // Unique and monotonically increasing for the lifetime of this handle.
    std::uint64_t sequence{};
    std::uint32_t id{};
    // Cue location inside one loop of the source WAV.
    std::uint64_t sampleFrame{};
    // Current absolute source playhead, including completed loops.
    std::uint64_t playheadSample{};
    // Zero-based loop occurrence containing this cue.
    std::uint64_t loopIndex{};
};

struct OpenResult {
    std::uint32_t handle{};
    PlaybackState state;
    std::vector<CuePoint> cuePoints;
    std::string error;
};

struct CuePollResult {
    std::vector<CueEvent> cues;
    PlaybackState state;
    std::string error;
};

// Paths cross the N-API boundary as UTF-8. On Windows they are converted to a
// wide path before either miniaudio or the RIFF cue parser opens the file.
OpenResult open(const std::string& pathUtf8);

bool play(std::uint32_t handle);
bool pause(std::uint32_t handle);
bool setLooping(std::uint32_t handle, bool looping);
bool setVolume(std::uint32_t handle, float volume);
bool setPlaybackRate(std::uint32_t handle, float rate);
bool seek(std::uint32_t handle, std::uint64_t sampleFrame);

PlaybackState state(std::uint32_t handle);
CuePollResult pollCues(std::uint32_t handle);

void close(std::uint32_t handle);
void closeAll();

} // namespace threebrowser::audio
