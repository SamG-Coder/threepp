#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include "audio_playback.h"

#if defined(__GNUC__) || defined(__clang__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wall"
#pragma GCC diagnostic ignored "-Wextra"
#pragma GCC diagnostic ignored "-Wpedantic"
#endif
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#if defined(__GNUC__) || defined(__clang__)
#pragma GCC diagnostic pop
#endif

#if defined(_WIN32)
#include <windows.h>
#endif

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <limits>
#include <memory>
#include <mutex>
#include <sstream>
#include <unordered_map>
#include <utility>

namespace threebrowser::audio {
namespace {

constexpr std::uint32_t kEngineSampleRate = 48'000;

std::string miniaudioError(const char* operation, ma_result result) {
    std::ostringstream message;
    message << operation << " failed (" << static_cast<int>(result) << ')';
    if (const char* description = ma_result_description(result); description && *description) {
        message << ": " << description;
    }
    return message.str();
}

#if defined(_WIN32)
std::wstring widePath(const std::string& utf8) {
    if (utf8.empty()) return {};
    const int required = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8.data(),
                                              static_cast<int>(utf8.size()), nullptr, 0);
    if (required <= 0) return {};
    std::wstring result(static_cast<std::size_t>(required), L'\0');
    if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8.data(),
                            static_cast<int>(utf8.size()), result.data(), required) != required) {
        return {};
    }
    return result;
}
#endif

std::uint32_t little32(const unsigned char* bytes) {
    return static_cast<std::uint32_t>(bytes[0]) |
           (static_cast<std::uint32_t>(bytes[1]) << 8U) |
           (static_cast<std::uint32_t>(bytes[2]) << 16U) |
           (static_cast<std::uint32_t>(bytes[3]) << 24U);
}

bool readExact(std::istream& input, void* destination, std::size_t bytes) {
    if (bytes == 0) return true;
    input.read(static_cast<char*>(destination), static_cast<std::streamsize>(bytes));
    return input.good() || static_cast<std::size_t>(input.gcount()) == bytes;
}

std::vector<CuePoint> readWaveCuePoints(const std::filesystem::path& path) {
    std::vector<CuePoint> result;
    std::ifstream input(path, std::ios::binary);
    if (!input) return result;

    std::array<unsigned char, 12> riff{};
    if (!readExact(input, riff.data(), riff.size()) ||
        std::equal(riff.begin(), riff.begin() + 4, reinterpret_cast<const unsigned char*>("RIFF")) == false ||
        std::equal(riff.begin() + 8, riff.end(), reinterpret_cast<const unsigned char*>("WAVE")) == false) {
        return result;
    }

    for (;;) {
        std::array<unsigned char, 8> header{};
        if (!readExact(input, header.data(), header.size())) break;
        const std::uint32_t chunkBytes = little32(header.data() + 4);
        const std::streampos payload = input.tellg();
        if (payload == std::streampos(-1)) break;

        if (std::equal(header.begin(), header.begin() + 4,
                       reinterpret_cast<const unsigned char*>("cue "))) {
            std::array<unsigned char, 4> countBytes{};
            if (chunkBytes < countBytes.size() || !readExact(input, countBytes.data(), countBytes.size())) break;
            const std::uint32_t declaredCount = little32(countBytes.data());
            const std::uint64_t availableRecords = (static_cast<std::uint64_t>(chunkBytes) - 4U) / 24U;
            const std::uint64_t recordCount = std::min<std::uint64_t>(declaredCount, availableRecords);
            result.reserve(result.size() + static_cast<std::size_t>(recordCount));
            for (std::uint64_t index = 0; index < recordCount; ++index) {
                std::array<unsigned char, 24> record{};
                if (!readExact(input, record.data(), record.size())) break;
                result.push_back({little32(record.data()), little32(record.data() + 20)});
            }
        }

        const std::uint64_t paddedBytes = static_cast<std::uint64_t>(chunkBytes) + (chunkBytes & 1U);
        if (paddedBytes > static_cast<std::uint64_t>(std::numeric_limits<std::streamoff>::max())) break;
        input.clear();
        input.seekg(payload + static_cast<std::streamoff>(paddedBytes));
        if (!input) break;
    }

    std::stable_sort(result.begin(), result.end(), [](const CuePoint& left, const CuePoint& right) {
        if (left.sampleFrame != right.sampleFrame) return left.sampleFrame < right.sampleFrame;
        return left.id < right.id;
    });
    return result;
}

class EngineOwner {
public:
    EngineOwner() = default;
    EngineOwner(const EngineOwner&) = delete;
    EngineOwner& operator=(const EngineOwner&) = delete;
    ~EngineOwner() {
        if (initialized_) ma_engine_uninit(&engine_);
    }

    bool initialize(std::string& error) {
        ma_engine_config config = ma_engine_config_init();
        // The mercury solver is 240 Hz, so 48 kHz maps exactly to 200 source
        // samples per simulation tick. The output device is resampled by the
        // WASAPI backend when its native mix rate differs.
        config.sampleRate = kEngineSampleRate;
        const ma_result result = ma_engine_init(&config, &engine_);
        if (result != MA_SUCCESS) {
            error = miniaudioError("Opening the default audio output", result);
            return false;
        }
        initialized_ = true;
        return true;
    }

    ma_engine* get() { return initialized_ ? &engine_ : nullptr; }
private:
    ma_engine engine_{};
    bool initialized_{};
};

struct Session {
    ~Session() {
        if (initialized) ma_sound_uninit(&sound);
    }

    void resetTimeline(std::uint64_t cursor, bool includeCursorCue) {
        lastCursor = cursor;
        absoluteCursor = cursor;
        loopIndex = 0;
        timelineClock = std::chrono::steady_clock::now();
        timelineClockRunning = playing;
        cueScanAbsolute = cursor;
        includeCueScanFrame = includeCursorCue;
        timelineInitialized = true;
    }

    void refreshTimeline(std::uint64_t cursor) {
        const auto now = std::chrono::steady_clock::now();
        if (!timelineInitialized) {
            resetTimeline(cursor, cursor == 0);
            return;
        }

        if (lengthFrames == 0) {
            absoluteCursor = cursor;
            loopIndex = 0;
            lastCursor = cursor;
            timelineClock = now;
            return;
        }

        std::uint64_t occurrence = loopIndex;
        if (looping) {
            const std::uint64_t cursorAdvance = cursor >= lastCursor
                ? cursor - lastCursor
                : (lengthFrames - lastCursor) + cursor;
            std::uint64_t occurrenceAdvance = cursor < lastCursor ? 1 : 0;

            // Normally pollCues runs every rendered frame and the cursor wrap
            // above is exact. This steady-clock estimate only recovers whole
            // loops after a long main-thread stall; it never supplies phase.
            if (timelineClockRunning) {
                const long double elapsedSeconds =
                    std::chrono::duration<long double>(now - timelineClock).count();
                const long double expectedAdvance = elapsedSeconds *
                    static_cast<long double>(sampleRate) *
                    static_cast<long double>(playbackRate);
                const long double unexplained = expectedAdvance -
                    static_cast<long double>(cursorAdvance);
                if (unexplained > static_cast<long double>(lengthFrames) * 0.5L) {
                    const auto extraLoops = static_cast<std::uint64_t>(std::llround(
                        unexplained / static_cast<long double>(lengthFrames)));
                    occurrenceAdvance += extraLoops;
                }
            }

            occurrence = occurrence > std::numeric_limits<std::uint64_t>::max() - occurrenceAdvance
                ? std::numeric_limits<std::uint64_t>::max()
                : occurrence + occurrenceAdvance;
        }

        const std::uint64_t maximumOccurrence =
            (std::numeric_limits<std::uint64_t>::max() - cursor) / lengthFrames;
        occurrence = std::min(occurrence, maximumOccurrence);
        loopIndex = occurrence;
        absoluteCursor = loopIndex * lengthFrames + cursor;
        lastCursor = cursor;
        timelineClock = now;
    }

    ma_sound sound{};
    bool initialized{};
    std::uint32_t sampleRate{};
    std::uint32_t channels{};
    std::uint64_t lengthFrames{};
    std::vector<CuePoint> cues;
    bool looping{};
    bool playing{};
    float volume{1.0f};
    float playbackRate{1.0f};

    bool timelineInitialized{};
    std::uint64_t lastCursor{};
    std::uint64_t absoluteCursor{};
    std::uint64_t loopIndex{};
    std::chrono::steady_clock::time_point timelineClock{};
    bool timelineClockRunning{};

    std::uint64_t cueScanAbsolute{};
    bool includeCueScanFrame{true};
    std::uint64_t nextCueSequence{1};
};

std::mutex sessionsMutex;
std::unordered_map<std::uint32_t, std::unique_ptr<Session>> sessions;
std::unique_ptr<EngineOwner> engine;
std::uint32_t nextHandle{1};

Session* findSession(std::uint32_t handle) {
    const auto found = sessions.find(handle);
    return found == sessions.end() ? nullptr : found->second.get();
}

bool ensureEngine(std::string& error) {
    if (engine && engine->get()) return true;
    auto candidate = std::make_unique<EngineOwner>();
    if (!candidate->initialize(error)) return false;
    engine = std::move(candidate);
    return true;
}

std::uint32_t allocateHandle() {
    for (std::uint64_t attempt = 0; attempt < std::numeric_limits<std::uint32_t>::max(); ++attempt) {
        const std::uint32_t candidate = nextHandle++;
        if (nextHandle == 0) nextHandle = 1;
        if (candidate != 0 && !sessions.contains(candidate)) return candidate;
    }
    return 0;
}

PlaybackState sessionState(Session& session) {
    ma_uint64 cursor = 0;
    const ma_result cursorResult = ma_sound_get_cursor_in_pcm_frames(&session.sound, &cursor);
    if (cursorResult != MA_SUCCESS) {
        PlaybackState failed;
        failed.error = miniaudioError("Reading the audio playhead", cursorResult);
        return failed;
    }

    const bool currentlyPlaying = ma_sound_is_playing(&session.sound) != MA_FALSE;
    session.looping = ma_sound_is_looping(&session.sound) != MA_FALSE;
    session.refreshTimeline(cursor);
    session.playing = currentlyPlaying;
    session.timelineClockRunning = currentlyPlaying;

    PlaybackState result;
    result.cursorFrame = cursor;
    result.lengthFrames = session.lengthFrames;
    result.loopIndex = session.loopIndex;
    result.sampleRate = session.sampleRate;
    result.channels = session.channels;
    result.playing = session.playing;
    result.ended = !session.looping && ma_sound_at_end(&session.sound) != MA_FALSE;
    result.looping = session.looping;
    result.volume = session.volume;
    result.playbackRate = session.playbackRate;
    return result;
}

PlaybackState unknownHandleState() {
    PlaybackState result;
    result.error = "Unknown or closed audio handle";
    return result;
}

} // namespace

OpenResult open(const std::string& pathUtf8) {
    std::scoped_lock lock(sessionsMutex);
    OpenResult result;
    if (pathUtf8.empty()) {
        result.error = "Audio path is empty";
        result.state.error = result.error;
        return result;
    }

    std::string engineError;
    if (!ensureEngine(engineError)) {
        result.error = std::move(engineError);
        result.state.error = result.error;
        return result;
    }

    auto session = std::make_unique<Session>();
    const ma_uint32 flags = MA_SOUND_FLAG_DECODE | MA_SOUND_FLAG_NO_SPATIALIZATION;
    ma_result soundResult = MA_ERROR;
    std::filesystem::path filePath;
#if defined(_WIN32)
    const std::wstring pathWide = widePath(pathUtf8);
    if (pathWide.empty()) {
        result.error = "Audio path is not valid UTF-8";
        result.state.error = result.error;
        if (sessions.empty()) engine.reset();
        return result;
    }
    filePath = std::filesystem::path(pathWide);
    soundResult = ma_sound_init_from_file_w(engine->get(), pathWide.c_str(), flags,
                                             nullptr, nullptr, &session->sound);
#else
    filePath = std::filesystem::u8path(pathUtf8);
    soundResult = ma_sound_init_from_file(engine->get(), pathUtf8.c_str(), flags,
                                          nullptr, nullptr, &session->sound);
#endif
    if (soundResult != MA_SUCCESS) {
        result.error = miniaudioError("Opening the WAV file", soundResult);
        result.state.error = result.error;
        if (sessions.empty()) engine.reset();
        return result;
    }
    session->initialized = true;

    ma_format format = ma_format_unknown;
    ma_uint32 channels = 0;
    ma_uint32 sampleRate = 0;
    ma_uint64 lengthFrames = 0;
    ma_result metadataResult = ma_sound_get_data_format(
        &session->sound, &format, &channels, &sampleRate, nullptr, 0);
    if (metadataResult == MA_SUCCESS) {
        metadataResult = ma_sound_get_length_in_pcm_frames(&session->sound, &lengthFrames);
    }
    if (metadataResult != MA_SUCCESS || sampleRate == 0 || channels == 0 || lengthFrames == 0) {
        result.error = metadataResult == MA_SUCCESS
                           ? "The WAV file has no playable PCM frames"
                           : miniaudioError("Reading WAV metadata", metadataResult);
        result.state.error = result.error;
        session.reset();
        if (sessions.empty()) engine.reset();
        return result;
    }

    session->sampleRate = sampleRate;
    session->channels = channels;
    session->lengthFrames = lengthFrames;
    session->cues = readWaveCuePoints(filePath);
    session->cues.erase(std::remove_if(session->cues.begin(), session->cues.end(),
                                      [lengthFrames](const CuePoint& cue) {
                                          return cue.sampleFrame >= lengthFrames;
                                      }),
                        session->cues.end());
    ma_sound_set_looping(&session->sound, MA_FALSE);
    ma_sound_set_volume(&session->sound, 1.0f);
    ma_sound_set_pitch(&session->sound, 1.0f);
    session->resetTimeline(0, true);

    const std::uint32_t handle = allocateHandle();
    if (handle == 0) {
        result.error = "No native audio handles are available";
        result.state.error = result.error;
        session.reset();
        if (sessions.empty()) engine.reset();
        return result;
    }

    result.handle = handle;
    result.cuePoints = session->cues;
    result.state = sessionState(*session);
    sessions.emplace(handle, std::move(session));
    return result;
}

bool play(std::uint32_t handle) {
    std::scoped_lock lock(sessionsMutex);
    Session* session = findSession(handle);
    if (!session) return false;
    if (!session->looping && ma_sound_at_end(&session->sound) != MA_FALSE) {
        if (ma_sound_seek_to_pcm_frame(&session->sound, 0) != MA_SUCCESS) return false;
        session->resetTimeline(0, true);
    }
    const ma_result result = ma_sound_start(&session->sound);
    if (result != MA_SUCCESS) return false;
    session->playing = true;
    session->timelineClock = std::chrono::steady_clock::now();
    session->timelineClockRunning = true;
    return true;
}

bool pause(std::uint32_t handle) {
    std::scoped_lock lock(sessionsMutex);
    Session* session = findSession(handle);
    if (!session) return false;
    (void)sessionState(*session);
    const ma_result result = ma_sound_stop(&session->sound);
    if (result != MA_SUCCESS) return false;
    session->playing = false;
    session->timelineClock = std::chrono::steady_clock::now();
    session->timelineClockRunning = false;
    return true;
}

bool setLooping(std::uint32_t handle, bool looping) {
    std::scoped_lock lock(sessionsMutex);
    Session* session = findSession(handle);
    if (!session) return false;
    (void)sessionState(*session);
    ma_sound_set_looping(&session->sound, looping ? MA_TRUE : MA_FALSE);
    session->looping = looping;
    return true;
}

bool setVolume(std::uint32_t handle, float volume) {
    if (!std::isfinite(volume) || volume < 0.0f || volume > 1.0f) return false;
    std::scoped_lock lock(sessionsMutex);
    Session* session = findSession(handle);
    if (!session) return false;
    ma_sound_set_volume(&session->sound, volume);
    session->volume = volume;
    return true;
}

bool setPlaybackRate(std::uint32_t handle, float rate) {
    if (!std::isfinite(rate) || rate <= 0.0f || rate > 16.0f) return false;
    std::scoped_lock lock(sessionsMutex);
    Session* session = findSession(handle);
    if (!session) return false;
    (void)sessionState(*session);
    ma_sound_set_pitch(&session->sound, rate);
    session->playbackRate = rate;
    session->timelineClock = std::chrono::steady_clock::now();
    return true;
}

bool seek(std::uint32_t handle, std::uint64_t sampleFrame) {
    std::scoped_lock lock(sessionsMutex);
    Session* session = findSession(handle);
    if (!session) return false;
    const std::uint64_t clamped = std::min(sampleFrame, session->lengthFrames);
    const ma_result result = ma_sound_seek_to_pcm_frame(&session->sound, clamped);
    if (result != MA_SUCCESS) return false;
    session->resetTimeline(clamped, clamped == 0);
    return true;
}

PlaybackState state(std::uint32_t handle) {
    std::scoped_lock lock(sessionsMutex);
    Session* session = findSession(handle);
    return session ? sessionState(*session) : unknownHandleState();
}

CuePollResult pollCues(std::uint32_t handle) {
    std::scoped_lock lock(sessionsMutex);
    CuePollResult result;
    Session* session = findSession(handle);
    if (!session) {
        result.error = "Unknown or closed audio handle";
        result.state.error = result.error;
        return result;
    }

    result.state = sessionState(*session);
    if (!result.state.error.empty()) {
        result.error = result.state.error;
        return result;
    }
    if (session->cues.empty() || session->lengthFrames == 0) {
        session->cueScanAbsolute = session->absoluteCursor;
        session->includeCueScanFrame = false;
        return result;
    }

    const std::uint64_t from = session->cueScanAbsolute;
    const std::uint64_t through = session->absoluteCursor;
    if (through < from) {
        session->cueScanAbsolute = through;
        session->includeCueScanFrame = through == 0;
        return result;
    }
    if (through == from && !session->includeCueScanFrame) return result;
    // Do not deliver a frame-zero marker simply because a paused sound was
    // opened or rewound. It becomes due as soon as playback starts.
    if (through == from && !session->playing && !result.state.ended) return result;

    const std::uint64_t firstLoop = from / session->lengthFrames;
    const std::uint64_t lastLoop = through / session->lengthFrames;
    for (std::uint64_t occurrence = firstLoop; occurrence <= lastLoop; ++occurrence) {
        if (occurrence > (std::numeric_limits<std::uint64_t>::max() /
                          session->lengthFrames)) break;
        const std::uint64_t loopBase = occurrence * session->lengthFrames;
        for (const CuePoint& cue : session->cues) {
            if (cue.sampleFrame > std::numeric_limits<std::uint64_t>::max() - loopBase) break;
            const std::uint64_t absoluteCue = loopBase + cue.sampleFrame;
            const bool afterFloor = absoluteCue > from ||
                                    (session->includeCueScanFrame && absoluteCue == from);
            if (!afterFloor) continue;
            if (absoluteCue > through) break;
            const std::uint64_t sequence = session->nextCueSequence++;
            if (session->nextCueSequence == 0) session->nextCueSequence = 1;
            result.cues.push_back({sequence, cue.id, cue.sampleFrame,
                                   session->absoluteCursor, occurrence});
        }
        if (occurrence == std::numeric_limits<std::uint64_t>::max()) break;
    }

    session->cueScanAbsolute = through;
    session->includeCueScanFrame = false;
    return result;
}

void close(std::uint32_t handle) {
    std::scoped_lock lock(sessionsMutex);
    const auto found = sessions.find(handle);
    if (found == sessions.end()) return;
    sessions.erase(found);
    if (sessions.empty()) engine.reset();
}

void closeAll() {
    std::scoped_lock lock(sessionsMutex);
    sessions.clear();
    engine.reset();
}

} // namespace threebrowser::audio
