#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include "camera_capture.h"

#include <windows.h>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mfobjects.h>
#include <mfreadwrite.h>
#include <objbase.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <sstream>
#include <thread>
#include <unordered_map>
#include <utility>

namespace threebrowser::camera {
namespace {

template<typename T>
class ComOwner {
public:
    ComOwner() = default;
    ComOwner(const ComOwner&) = delete;
    ComOwner& operator=(const ComOwner&) = delete;
    ComOwner(ComOwner&& other) noexcept: value_(std::exchange(other.value_, nullptr)) {}
    ComOwner& operator=(ComOwner&& other) noexcept {
        if (this != &other) {
            reset();
            value_ = std::exchange(other.value_, nullptr);
        }
        return *this;
    }
    ~ComOwner() { reset(); }

    T* get() const { return value_; }
    T* operator->() const { return value_; }
    explicit operator bool() const { return value_ != nullptr; }
    T** put() {
        reset();
        return &value_;
    }
    void reset(T* next = nullptr) {
        if (value_) value_->Release();
        value_ = next;
    }

private:
    T* value_{};
};

std::string hresultMessage(const char* operation, HRESULT result) {
    char systemMessage[512]{};
    const DWORD length = FormatMessageA(
        FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr, static_cast<DWORD>(result), 0, systemMessage,
        static_cast<DWORD>(std::size(systemMessage)), nullptr);
    std::ostringstream message;
    message << operation << " failed (0x" << std::hex << static_cast<unsigned long>(result) << ')';
    if (length) {
        std::string detail(systemMessage, length);
        while (!detail.empty() && (detail.back() == '\r' || detail.back() == '\n')) detail.pop_back();
        if (!detail.empty()) message << ": " << detail;
    }
    return message.str();
}

std::string utf8(const wchar_t* text, std::size_t length) {
    if (!text || length == 0) return {};
    const int required = WideCharToMultiByte(CP_UTF8, 0, text, static_cast<int>(length),
                                              nullptr, 0, nullptr, nullptr);
    if (required <= 0) return {};
    std::string output(static_cast<std::size_t>(required), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text, static_cast<int>(length), output.data(), required,
                        nullptr, nullptr);
    return output;
}

std::string activationString(IMFActivate* activation, REFGUID key) {
    wchar_t* value = nullptr;
    UINT32 length = 0;
    const HRESULT result = activation->GetAllocatedString(key, &value, &length);
    if (FAILED(result) || !value) return {};
    std::string output = utf8(value, length);
    CoTaskMemFree(value);
    return output;
}

bool startFoundation(bool& uninitializeCom, std::string& error) {
    const HRESULT com = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    uninitializeCom = SUCCEEDED(com);
    if (FAILED(com) && com != RPC_E_CHANGED_MODE) {
        error = hresultMessage("CoInitializeEx", com);
        return false;
    }
    const HRESULT media = MFStartup(MF_VERSION, MFSTARTUP_FULL);
    if (FAILED(media)) {
        error = hresultMessage("MFStartup", media);
        if (uninitializeCom) CoUninitialize();
        uninitializeCom = false;
        return false;
    }
    return true;
}

void stopFoundation(bool uninitializeCom) {
    MFShutdown();
    if (uninitializeCom) CoUninitialize();
}

bool deviceActivations(std::vector<IMFActivate*>& activations,
                       std::vector<DeviceInfo>& descriptions, std::string& error) {
    ComOwner<IMFAttributes> attributes;
    HRESULT result = MFCreateAttributes(attributes.put(), 1);
    if (FAILED(result)) {
        error = hresultMessage("MFCreateAttributes", result);
        return false;
    }
    result = attributes->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                                 MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
    if (FAILED(result)) {
        error = hresultMessage("Selecting video capture devices", result);
        return false;
    }

    IMFActivate** raw = nullptr;
    UINT32 count = 0;
    result = MFEnumDeviceSources(attributes.get(), &raw, &count);
    if (FAILED(result)) {
        error = hresultMessage("Enumerating video capture devices", result);
        return false;
    }
    activations.reserve(count);
    descriptions.reserve(count);
    for (UINT32 index = 0; index < count; ++index) {
        IMFActivate* activation = raw[index];
        if (!activation) continue;
        activations.push_back(activation);
        descriptions.push_back({
            activationString(activation, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK),
            activationString(activation, MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME),
        });
    }
    CoTaskMemFree(raw);
    return true;
}

void releaseActivations(std::vector<IMFActivate*>& activations) {
    for (IMFActivate* activation : activations) {
        if (activation) activation->Release();
    }
    activations.clear();
}

class CameraSession {
public:
    explicit CameraSession(OpenRequest request): request_(std::move(request)) {}
    ~CameraSession() { stop(); }

    bool start(OpenResult& result) {
        worker_ = std::thread([this] { capture(); });
        std::unique_lock lock(mutex_);
        const bool initialized = readyCondition_.wait_for(
            lock, std::chrono::seconds(12), [this] { return initialized_; });
        if (!initialized) {
            error_ = "Timed out while opening the Windows camera";
            lock.unlock();
            stop();
            result.error = error_;
            return false;
        }
        if (!ready_) {
            result.error = error_.empty() ? "The Windows camera could not be opened" : error_;
            lock.unlock();
            stop();
            return false;
        }
        result.deviceId = device_.id;
        result.label = device_.label;
        result.width = width_;
        result.height = height_;
        result.frameRate = frameRate_;
        return true;
    }

    void stop() {
        if (stopped_.exchange(true, std::memory_order_acq_rel)) return;
        stopRequested_.store(true, std::memory_order_release);
        IMFSourceReader* reader = nullptr;
        IMFMediaSource* source = nullptr;
        {
            std::scoped_lock lock(mutex_);
            reader = reader_;
            if (reader) reader->AddRef();
            source = source_;
            if (source) source->AddRef();
        }
        if (reader) {
            // Synchronous ReadSample blocks. Flush is the Source Reader API
            // that cancels pending sample requests and lets the capture thread
            // observe stopRequested_ without waiting on another camera frame.
            reader->Flush(MF_SOURCE_READER_ALL_STREAMS);
            reader->Release();
        } else if (source) {
            // Initialization may not have produced a reader yet.
            source->Shutdown();
        }
        if (source) source->Release();
        if (worker_.joinable()) worker_.join();
    }

    ReadResult read(std::uint64_t afterSequence, std::uint8_t* destination,
                    std::size_t destinationSize) const {
        std::scoped_lock lock(mutex_);
        ReadResult result;
        result.sequence = sequence_;
        result.timestampUs = timestampUs_;
        result.width = width_;
        result.height = height_;
        result.byteLength = pixels_.size();
        result.ended = ended_;
        result.error = error_;
        result.hasNewFrame = sequence_ > afterSequence && !pixels_.empty();
        if (result.hasNewFrame && destination && destinationSize >= pixels_.size()) {
            std::copy(pixels_.begin(), pixels_.end(), destination);
            result.copied = true;
        }
        return result;
    }

private:
    void signalInitialization(bool ready, std::string error = {}) {
        {
            std::scoped_lock lock(mutex_);
            ready_ = ready;
            initialized_ = true;
            if (!error.empty()) error_ = std::move(error);
        }
        readyCondition_.notify_all();
    }

    bool configureReader(IMFSourceReader* reader, std::string& error) {
        ComOwner<IMFMediaType> type;
        HRESULT result = MFCreateMediaType(type.put());
        if (SUCCEEDED(result)) result = type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        if (SUCCEEDED(result)) result = type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
        if (SUCCEEDED(result)) result = type->SetUINT32(MF_MT_INTERLACE_MODE,
                                                       MFVideoInterlace_Progressive);
        if (SUCCEEDED(result) && request_.width && request_.height) {
            result = MFSetAttributeSize(type.get(), MF_MT_FRAME_SIZE, request_.width, request_.height);
        }
        if (SUCCEEDED(result) && request_.frameRate > 0) {
            const UINT32 numerator = static_cast<UINT32>(std::clamp(request_.frameRate, 1.0, 240.0) * 1000.0 + 0.5);
            result = MFSetAttributeRatio(type.get(), MF_MT_FRAME_RATE, numerator, 1000);
        }
        if (SUCCEEDED(result)) {
            result = reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM, nullptr,
                                                 type.get());
        }
        if (FAILED(result) && (request_.width || request_.height || request_.frameRate > 0)) {
            type.reset();
            result = MFCreateMediaType(type.put());
            if (SUCCEEDED(result)) result = type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
            if (SUCCEEDED(result)) result = type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
            if (SUCCEEDED(result)) {
                result = reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM, nullptr,
                                                     type.get());
            }
        }
        if (FAILED(result)) {
            error = hresultMessage("Configuring RGB32 camera output", result);
            return false;
        }

        ComOwner<IMFMediaType> current;
        result = reader->GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM, current.put());
        UINT32 width = 0;
        UINT32 height = 0;
        if (FAILED(result) || FAILED(MFGetAttributeSize(current.get(), MF_MT_FRAME_SIZE, &width, &height)) ||
            width == 0 || height == 0) {
            error = hresultMessage("Reading the camera output size", FAILED(result) ? result : E_FAIL);
            return false;
        }
        UINT32 frameNumerator = 0;
        UINT32 frameDenominator = 0;
        MFGetAttributeRatio(current.get(), MF_MT_FRAME_RATE, &frameNumerator, &frameDenominator);
        UINT32 strideBits = 0;
        LONG defaultStride = 0;
        if (SUCCEEDED(current->GetUINT32(MF_MT_DEFAULT_STRIDE, &strideBits))) {
            // MF_MT_DEFAULT_STRIDE is stored as UINT32 but explicitly defined
            // by Media Foundation as a signed 32-bit value.
            defaultStride = static_cast<LONG>(strideBits);
        } else {
            // Media Foundation explicitly requires this calculation when an
            // uncompressed media type omits MF_MT_DEFAULT_STRIDE. In
            // particular, assuming width * 4 here loses the orientation sign
            // of bottom-up RGB surfaces in the contiguous-buffer fallback.
            GUID subtype = GUID_NULL;
            result = current->GetGUID(MF_MT_SUBTYPE, &subtype);
            if (FAILED(result) || FAILED(MFGetStrideForBitmapInfoHeader(
                    subtype.Data1, width, &defaultStride))) {
                error = "The RGB32 camera output did not provide a usable default row stride";
                return false;
            }
        }
        const auto strideMagnitude = defaultStride < 0
            ? static_cast<std::uint64_t>(-static_cast<std::int64_t>(defaultStride))
            : static_cast<std::uint64_t>(defaultStride);
        if (defaultStride == 0 || strideMagnitude < static_cast<std::uint64_t>(width) * 4u) {
            error = "The RGB32 camera output reported an invalid row stride";
            return false;
        }
        {
            std::scoped_lock lock(mutex_);
            width_ = width;
            height_ = height;
            defaultStride_ = defaultStride;
            frameRate_ = frameDenominator ? static_cast<double>(frameNumerator) / frameDenominator : 0.0;
            pixels_.resize(static_cast<std::size_t>(width) * height * 4);
        }
        scratchPixels_.resize(static_cast<std::size_t>(width) * height * 4);
        return true;
    }

    bool publishSample(IMFSample* sample, LONGLONG sampleTime, std::string& error) {
        ComOwner<IMFMediaBuffer> buffer;
        HRESULT result = sample->ConvertToContiguousBuffer(buffer.put());
        if (FAILED(result)) {
            error = hresultMessage("Reading a camera sample", result);
            return false;
        }

        UINT32 width = 0;
        UINT32 height = 0;
        LONG defaultStride = 0;
        {
            std::scoped_lock lock(mutex_);
            width = width_;
            height = height_;
            defaultStride = defaultStride_;
        }
        const std::size_t rowBytes = static_cast<std::size_t>(width) * 4;
        scratchPixels_.resize(rowBytes * height);
        auto& rgba = scratchPixels_;
        BYTE* firstRow = nullptr;
        LONG stride = 0;
        ComOwner<IMF2DBuffer> twoDimensional;
        result = buffer->QueryInterface(IID_IMF2DBuffer,
                                        reinterpret_cast<void**>(twoDimensional.put()));
        if (SUCCEEDED(result) && twoDimensional) {
            result = twoDimensional->Lock2D(&firstRow, &stride);
            if (FAILED(result)) {
                error = hresultMessage("Locking a camera frame", result);
                return false;
            }
            const auto strideMagnitude = stride < 0
                ? static_cast<std::uint64_t>(-static_cast<std::int64_t>(stride))
                : static_cast<std::uint64_t>(stride);
            if (!firstRow || strideMagnitude < rowBytes) {
                twoDimensional->Unlock2D();
                error = "The camera frame reported an invalid 2D row stride";
                return false;
            }
            for (UINT32 y = 0; y < height; ++y) {
                const BYTE* source = firstRow + static_cast<std::ptrdiff_t>(y) * stride;
                std::uint8_t* destination = rgba.data() + static_cast<std::size_t>(y) * rowBytes;
                for (UINT32 x = 0; x < width; ++x) {
                    destination[x * 4] = source[x * 4 + 2];
                    destination[x * 4 + 1] = source[x * 4 + 1];
                    destination[x * 4 + 2] = source[x * 4];
                    destination[x * 4 + 3] = 255;
                }
            }
            twoDimensional->Unlock2D();
        } else {
            BYTE* data = nullptr;
            DWORD maximum = 0;
            DWORD current = 0;
            result = buffer->Lock(&data, &maximum, &current);
            const auto strideMagnitude = defaultStride < 0
                ? static_cast<std::uint64_t>(-static_cast<std::int64_t>(defaultStride))
                : static_cast<std::uint64_t>(defaultStride);
            const std::uint64_t requiredBytes = height == 0
                ? 0
                : (static_cast<std::uint64_t>(height) - 1u) * strideMagnitude + rowBytes;
            if (FAILED(result) || !data || defaultStride == 0 ||
                strideMagnitude < rowBytes || current < requiredBytes) {
                if (SUCCEEDED(result)) buffer->Unlock();
                error = hresultMessage("Locking a contiguous camera frame",
                                       FAILED(result) ? result : E_UNEXPECTED);
                return false;
            }
            // IMFMediaBuffer::Lock returns the start of the contiguous
            // allocation. For a negative (bottom-up) default stride, advance
            // to the display's top row before walking with that signed pitch.
            const BYTE* firstContiguousRow = defaultStride < 0
                ? data + (static_cast<std::size_t>(height) - 1u) *
                    static_cast<std::size_t>(strideMagnitude)
                : data;
            for (UINT32 y = 0; y < height; ++y) {
                const BYTE* source = firstContiguousRow +
                    static_cast<std::ptrdiff_t>(y) * defaultStride;
                std::uint8_t* destination = rgba.data() + static_cast<std::size_t>(y) * rowBytes;
                for (UINT32 x = 0; x < width; ++x) {
                    destination[x * 4] = source[x * 4 + 2];
                    destination[x * 4 + 1] = source[x * 4 + 1];
                    destination[x * 4 + 2] = source[x * 4];
                    destination[x * 4 + 3] = 255;
                }
            }
            buffer->Unlock();
        }

        std::scoped_lock lock(mutex_);
        pixels_.swap(scratchPixels_);
        timestampUs_ = sampleTime > 0 ? static_cast<std::uint64_t>(sampleTime / 10) : 0;
        ++sequence_;
        return true;
    }

    void capture() {
        bool uninitializeCom = false;
        std::string error;
        if (!startFoundation(uninitializeCom, error)) {
            signalInitialization(false, std::move(error));
            return;
        }

        std::vector<IMFActivate*> activations;
        std::vector<DeviceInfo> devices;
        if (!deviceActivations(activations, devices, error) || activations.empty()) {
            if (error.empty()) error = "No Windows video capture devices are available";
            releaseActivations(activations);
            signalInitialization(false, std::move(error));
            stopFoundation(uninitializeCom);
            return;
        }
        std::size_t selected = 0;
        if (!request_.deviceId.empty()) {
            const auto match = std::find_if(devices.begin(), devices.end(), [this](const DeviceInfo& device) {
                return device.id == request_.deviceId;
            });
            if (match == devices.end()) {
                releaseActivations(activations);
                signalInitialization(false, "The requested video capture device is unavailable");
                stopFoundation(uninitializeCom);
                return;
            }
            selected = static_cast<std::size_t>(std::distance(devices.begin(), match));
        }
        device_ = devices[selected];

        ComOwner<IMFMediaSource> source;
        HRESULT result = activations[selected]->ActivateObject(
            IID_IMFMediaSource, reinterpret_cast<void**>(source.put()));
        releaseActivations(activations);
        if (FAILED(result)) {
            signalInitialization(false, hresultMessage("Opening the Windows camera", result));
            stopFoundation(uninitializeCom);
            return;
        }
        {
            std::scoped_lock lock(mutex_);
            source_ = source.get();
            source_->AddRef();
        }

        ComOwner<IMFSourceReader> reader;
        ComOwner<IMFAttributes> readerAttributes;
        const auto createReader = [&](bool advancedProcessing) {
            reader.reset();
            readerAttributes.reset();
            HRESULT attempt = MFCreateAttributes(readerAttributes.put(), 2);
            if (SUCCEEDED(attempt) && advancedProcessing) {
                // Advanced processing includes RGB conversion, resizing and
                // frame-rate conversion. Do not also enable the legacy video
                // processor: real camera stacks can reject that combination
                // with E_INVALIDARG when the source reader is created.
                attempt = readerAttributes->SetUINT32(
                    MF_READWRITE_DISABLE_CONVERTERS, FALSE);
                if (SUCCEEDED(attempt)) {
                    attempt = readerAttributes->SetUINT32(
                        MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, TRUE);
                }
            } else if (SUCCEEDED(attempt)) {
                attempt = readerAttributes->SetUINT32(
                    MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, TRUE);
            }
            if (SUCCEEDED(attempt)) {
                attempt = MFCreateSourceReaderFromMediaSource(
                    source.get(), readerAttributes.get(), reader.put());
            }
            return attempt;
        };
        result = createReader(true);
        if (FAILED(result)) result = createReader(false);
        if (FAILED(result)) {
            signalInitialization(false, hresultMessage("Creating the Windows camera reader", result));
        } else {
            {
                std::scoped_lock lock(mutex_);
                reader_ = reader.get();
                reader_->AddRef();
            }
            reader->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS, FALSE);
            reader->SetStreamSelection(MF_SOURCE_READER_FIRST_VIDEO_STREAM, TRUE);
            if (!configureReader(reader.get(), error)) signalInitialization(false, std::move(error));
            else signalInitialization(true);
        }

        bool initializedReady = false;
        {
            std::scoped_lock lock(mutex_);
            initializedReady = ready_;
        }
        while (initializedReady && !stopRequested_.load(std::memory_order_acquire)) {
            DWORD actualStream = 0;
            DWORD flags = 0;
            LONGLONG sampleTime = 0;
            ComOwner<IMFSample> sample;
            result = reader->ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0, &actualStream,
                                        &flags, &sampleTime, sample.put());
            if (FAILED(result)) {
                error = hresultMessage("Capturing a Windows camera frame", result);
                break;
            }
            if ((flags & MF_SOURCE_READERF_ENDOFSTREAM) != 0) {
                error = "The Windows camera stream ended";
                break;
            }
            if ((flags & MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED) != 0) {
                if (!configureReader(reader.get(), error)) break;
            }
            if (sample && !publishSample(sample.get(), sampleTime, error)) break;
        }

        source->Shutdown();
        {
            std::scoped_lock lock(mutex_);
            if (reader_) {
                reader_->Release();
                reader_ = nullptr;
            }
            if (source_) {
                source_->Release();
                source_ = nullptr;
            }
            ended_ = true;
            if (!stopRequested_.load(std::memory_order_acquire) && !error.empty()) error_ = std::move(error);
        }
        reader.reset();
        readerAttributes.reset();
        source.reset();
        stopFoundation(uninitializeCom);
    }

    OpenRequest request_;
    DeviceInfo device_;
    mutable std::mutex mutex_;
    std::condition_variable readyCondition_;
    std::thread worker_;
    std::atomic_bool stopRequested_{false};
    std::atomic_bool stopped_{false};
    IMFSourceReader* reader_{};
    IMFMediaSource* source_{};
    bool initialized_{};
    bool ready_{};
    bool ended_{};
    std::uint32_t width_{};
    std::uint32_t height_{};
    LONG defaultStride_{};
    double frameRate_{};
    std::uint64_t sequence_{};
    std::uint64_t timestampUs_{};
    std::vector<std::uint8_t> pixels_;
    std::vector<std::uint8_t> scratchPixels_;
    std::string error_;
};

std::mutex sessionsMutex;
std::unordered_map<std::uint32_t, std::shared_ptr<CameraSession>> sessions;
std::atomic_uint32_t nextHandle{1};

} // namespace

std::vector<DeviceInfo> enumerate(std::string& error) {
    bool uninitializeCom = false;
    if (!startFoundation(uninitializeCom, error)) return {};
    std::vector<IMFActivate*> activations;
    std::vector<DeviceInfo> devices;
    deviceActivations(activations, devices, error);
    releaseActivations(activations);
    stopFoundation(uninitializeCom);
    return devices;
}

OpenResult open(const OpenRequest& request) {
    OpenResult result;
    auto session = std::make_shared<CameraSession>(request);
    if (!session->start(result)) return result;
    std::uint32_t handle = nextHandle.fetch_add(1, std::memory_order_relaxed);
    if (handle == 0) handle = nextHandle.fetch_add(1, std::memory_order_relaxed);
    {
        std::scoped_lock lock(sessionsMutex);
        sessions.emplace(handle, std::move(session));
    }
    result.handle = handle;
    return result;
}

bool read(std::uint32_t handle, std::uint64_t afterSequence, std::uint8_t* destination,
          std::size_t destinationSize, ReadResult& result, std::string& error) {
    std::shared_ptr<CameraSession> session;
    {
        std::scoped_lock lock(sessionsMutex);
        const auto found = sessions.find(handle);
        if (found == sessions.end()) {
            error = "Unknown or stopped camera handle";
            return false;
        }
        session = found->second;
    }
    result = session->read(afterSequence, destination, destinationSize);
    return true;
}

void close(std::uint32_t handle) {
    std::shared_ptr<CameraSession> session;
    {
        std::scoped_lock lock(sessionsMutex);
        const auto found = sessions.find(handle);
        if (found == sessions.end()) return;
        session = std::move(found->second);
        sessions.erase(found);
    }
    session->stop();
}

void closeAll() {
    std::unordered_map<std::uint32_t, std::shared_ptr<CameraSession>> closing;
    {
        std::scoped_lock lock(sessionsMutex);
        closing.swap(sessions);
    }
    for (auto& [handle, session] : closing) {
        (void)handle;
        session->stop();
    }
}

} // namespace threebrowser::camera
