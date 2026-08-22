# NVIDIA Streamline is optional at runtime, but enabled by default for the
# Windows native renderer.  The SDK is fetched into the build tree rather than
# committed because its signed NGX runtime binaries are large.
set(THREEBROWSER_ENABLE_STREAMLINE ON CACHE BOOL "Enable NVIDIA Streamline/DLSS integration")
set(THREEBROWSER_STREAMLINE_SDK "" CACHE PATH "Existing NVIDIA Streamline SDK root")

if (NOT THREEBROWSER_ENABLE_STREAMLINE)
    return()
endif ()

set(STREAMLINE_VERSION "2.12.0" CACHE STRING "NVIDIA Streamline SDK version")
set(_streamline_root "${THREEBROWSER_STREAMLINE_SDK}")
if (NOT _streamline_root)
    set(_streamline_cache "${CMAKE_BINARY_DIR}/_deps/streamline-sdk-v${STREAMLINE_VERSION}")
    set(_streamline_zip "${CMAKE_BINARY_DIR}/_deps/streamline-sdk-v${STREAMLINE_VERSION}.zip")
    if (NOT EXISTS "${_streamline_cache}/include/sl.h")
        file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/_deps")
        file(DOWNLOAD
            "https://github.com/NVIDIAGameWorks/Streamline/releases/download/v${STREAMLINE_VERSION}/streamline-sdk-v${STREAMLINE_VERSION}.zip"
            "${_streamline_zip}"
            EXPECTED_HASH "SHA256=F5C0A3D870707DDDC3570FB4BCD3655CF48A8A68C3A9D342910CFA21B77DCF48"
            TLS_VERIFY ON
            SHOW_PROGRESS
            STATUS _streamline_download)
        list(GET _streamline_download 0 _streamline_code)
        if (NOT _streamline_code EQUAL 0)
            list(GET _streamline_download 1 _streamline_message)
            message(FATAL_ERROR "Unable to download NVIDIA Streamline: ${_streamline_message}")
        endif ()
        file(MAKE_DIRECTORY "${_streamline_cache}")
        file(ARCHIVE_EXTRACT INPUT "${_streamline_zip}" DESTINATION "${_streamline_cache}")
    endif ()
    set(_streamline_root "${_streamline_cache}")
endif ()

if (NOT EXISTS "${_streamline_root}/include/sl.h" OR
    NOT EXISTS "${_streamline_root}/bin/x64/sl.interposer.dll")
    message(FATAL_ERROR "Invalid Streamline SDK root: ${_streamline_root}")
endif ()

set(STREAMLINE_ROOT "${_streamline_root}" CACHE INTERNAL "NVIDIA Streamline SDK root")
set(STREAMLINE_INCLUDE_DIR "${_streamline_root}/include" CACHE INTERNAL "NVIDIA Streamline headers")
set(STREAMLINE_BIN_DIR "${_streamline_root}/bin/x64" CACHE INTERNAL "NVIDIA Streamline runtime binaries")
