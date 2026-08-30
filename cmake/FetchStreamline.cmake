# NVIDIA Streamline is optional at runtime, but enabled by default for the
# Windows native renderer.  The SDK is fetched into the build tree rather than
# committed because its signed NGX runtime binaries are large.
set(THREEBROWSER_ENABLE_STREAMLINE ON CACHE BOOL "Enable NVIDIA Streamline/DLSS integration")
set(THREEBROWSER_STREAMLINE_SDK "" CACHE PATH "Existing NVIDIA Streamline SDK root")
set(THREEBROWSER_DLSS5_PLUGIN_DIR "" CACHE PATH
    "Directory containing optional sl.dlss_nr.dll and nvngx_dlssnr.dll")
set(THREEBROWSER_DLSS5_MODE "AUTO" CACHE STRING
    "DLSS Neural Rendering support: OFF, AUTO (verified SDK ABI only), or ON (explicit preview opt-in)")
set_property(CACHE THREEBROWSER_DLSS5_MODE PROPERTY STRINGS OFF AUTO ON)
string(TOUPPER "${THREEBROWSER_DLSS5_MODE}" _threebrowser_dlss5_mode)
if (NOT _threebrowser_dlss5_mode MATCHES "^(OFF|AUTO|ON)$")
    message(FATAL_ERROR
        "THREEBROWSER_DLSS5_MODE must be OFF, AUTO, or ON (got '${THREEBROWSER_DLSS5_MODE}')")
endif ()
if (THREEBROWSER_DLSS5_PLUGIN_DIR AND
    NOT _threebrowser_dlss5_mode STREQUAL "ON")
    message(STATUS
        "THREEBROWSER_DLSS5_PLUGIN_DIR is an expert override used only with THREEBROWSER_DLSS5_MODE=ON; AUTO requires one coherent THREEBROWSER_STREAMLINE_SDK root")
endif ()

if (NOT THREEBROWSER_ENABLE_STREAMLINE)
    if (_threebrowser_dlss5_mode STREQUAL "ON")
        message(FATAL_ERROR
            "THREEBROWSER_DLSS5_MODE=ON requires THREEBROWSER_ENABLE_STREAMLINE=ON")
    endif ()
    set(THREEBROWSER_DLSS5_AVAILABLE OFF CACHE INTERNAL
        "Compatible DLSS Neural Rendering plug-in is available" FORCE)
    set(THREEBROWSER_DLSS5_USES_SDK_HEADER OFF CACHE INTERNAL
        "DLSS Neural Rendering uses a verified public SDK header" FORCE)
    set(THREEBROWSER_DLSS5_USES_PREVIEW_ABI OFF CACHE INTERNAL
        "DLSS Neural Rendering uses the explicit preview ABI" FORCE)
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

set(_dlss5_bin_dir "${THREEBROWSER_DLSS5_PLUGIN_DIR}")
if (NOT _dlss5_bin_dir)
    set(_dlss5_bin_dir "${_streamline_root}/bin/x64")
endif ()
set(_dlss5_streamline_dll "${_dlss5_bin_dir}/sl.dlss_nr.dll")
set(_dlss5_ngx_dll "${_dlss5_bin_dir}/nvngx_dlssnr.dll")
set(_dlss5_header "${_streamline_root}/include/sl_dlss_nr.h")
set(_dlss5_dlls_found OFF)
set(_dlss5_bundle_coherent OFF)
if (NOT THREEBROWSER_DLSS5_PLUGIN_DIR)
    set(_dlss5_bundle_coherent ON)
endif ()
if (EXISTS "${_dlss5_streamline_dll}" AND EXISTS "${_dlss5_ngx_dll}")
    set(_dlss5_dlls_found ON)
endif ()

# AUTO must not infer ABI compatibility from two filenames. A future public SDK
# is accepted automatically only after its header compiles with the exact
# feature, option layout, and fields consumed by the bridge.
set(_dlss5_header_abi_compatible OFF)
if (_dlss5_dlls_found AND EXISTS "${_dlss5_header}")
    include(CheckCXXSourceCompiles)
    set(_dlss5_saved_required_includes "${CMAKE_REQUIRED_INCLUDES}")
    set(CMAKE_REQUIRED_INCLUDES "${_streamline_root}/include")
    unset(THREEBROWSER_DLSS5_HEADER_ABI_COMPILES CACHE)
    check_cxx_source_compiles([[#include <sl.h>
#include <sl_dlss_nr.h>
#include <cstdint>
static_assert(static_cast<uint32_t>(sl::kFeatureDLSS_NR) == 1004);
static_assert(sizeof(sl::DLSSNROptions) == 0x48);
int main() {
    sl::DLSSNROptions options{};
    options.mode = static_cast<decltype(options.mode)>(1);
    options.intensity = 1.0f;
    options.localToneStrength = 1.0f;
    options.localStructureStrength = 1.0f;
    options.globalToneStrength = 1.0f;
    options.style = static_cast<decltype(options.style)>(2);
    options.renderPreset = static_cast<decltype(options.renderPreset)>(0);
    options.useAutoMask = static_cast<decltype(options.useAutoMask)>(1);
    options.skinStructureStrength = 1.0f;
    options.performanceMode = static_cast<decltype(options.performanceMode)>(6);
    PFun_slDLSSNRSetOptions* function = nullptr;
    return function || options.intensity == 1.0f ? 0 : 1;
}
]] THREEBROWSER_DLSS5_HEADER_ABI_COMPILES)
    set(CMAKE_REQUIRED_INCLUDES "${_dlss5_saved_required_includes}")
    if (THREEBROWSER_DLSS5_HEADER_ABI_COMPILES)
        set(_dlss5_header_abi_compatible ON)
    endif ()
endif ()

set(_dlss5_available OFF)
set(_dlss5_uses_sdk_header OFF)
set(_dlss5_uses_preview_abi OFF)
if (NOT _threebrowser_dlss5_mode STREQUAL "OFF")
    if (_dlss5_dlls_found AND _dlss5_header_abi_compatible AND
        (_dlss5_bundle_coherent OR _threebrowser_dlss5_mode STREQUAL "ON"))
        set(_dlss5_available ON)
        set(_dlss5_uses_sdk_header ON)
        message(STATUS
            "DLSS Neural Rendering: compatible SDK header and feature DLLs verified")
    elseif (_dlss5_dlls_found AND _threebrowser_dlss5_mode STREQUAL "ON")
        # ON is the deliberate escape hatch for the signed preview bundle whose
        # public header was not shipped. It is never selected by default/AUTO.
        set(_dlss5_available ON)
        set(_dlss5_uses_preview_abi ON)
        message(WARNING
            "DLSS Neural Rendering: ON explicitly selected the isolated 72-byte preview ABI because no compatible sl_dlss_nr.h was found. AUTO would keep this disabled.")
    elseif (_threebrowser_dlss5_mode STREQUAL "ON")
        message(FATAL_ERROR
            "THREEBROWSER_DLSS5_MODE=ON requires both ${_dlss5_streamline_dll} and ${_dlss5_ngx_dll}. "
            "Provide a compatible SDK with -DTHREEBROWSER_STREAMLINE_SDK=<path>, or provide its bin directory with -DTHREEBROWSER_DLSS5_PLUGIN_DIR=<path>.")
    elseif (_dlss5_dlls_found AND _dlss5_header_abi_compatible)
        message(STATUS
            "DLSS Neural Rendering: AUTO requires the compatible header, core Streamline runtime, and NR DLLs to come from one THREEBROWSER_STREAMLINE_SDK root; the separate plug-in directory is being ignored")
    elseif (_dlss5_dlls_found)
        message(STATUS
            "DLSS Neural Rendering: feature DLLs found but no compatible sl_dlss_nr.h ABI was verified; AUTO is keeping support disabled")
    else ()
        message(STATUS
            "DLSS Neural Rendering: unavailable in Streamline ${STREAMLINE_VERSION}; continuing without it")
    endif ()
endif ()

set(STREAMLINE_ROOT "${_streamline_root}" CACHE INTERNAL "NVIDIA Streamline SDK root")
set(STREAMLINE_INCLUDE_DIR "${_streamline_root}/include" CACHE INTERNAL "NVIDIA Streamline headers")
set(STREAMLINE_BIN_DIR "${_streamline_root}/bin/x64" CACHE INTERNAL "NVIDIA Streamline runtime binaries")
set(THREEBROWSER_DLSS5_AVAILABLE ${_dlss5_available} CACHE INTERNAL
    "Compatible DLSS Neural Rendering plug-in is available" FORCE)
set(THREEBROWSER_DLSS5_USES_SDK_HEADER ${_dlss5_uses_sdk_header} CACHE INTERNAL
    "DLSS Neural Rendering uses a verified public SDK header" FORCE)
set(THREEBROWSER_DLSS5_USES_PREVIEW_ABI ${_dlss5_uses_preview_abi} CACHE INTERNAL
    "DLSS Neural Rendering uses the explicit preview ABI" FORCE)
set(THREEBROWSER_DLSS5_BIN_DIR "${_dlss5_bin_dir}" CACHE INTERNAL
    "DLSS Neural Rendering runtime directory" FORCE)
