# cmake/FetchWebGPU.cmake
# Pins gfx-rs/wgpu-native v29.0.1.1 Windows GNU x86_64 (MinGW). Headers +
# wgpu_native.dll + import lib only — no Dawn, no MSVC archive.
#
# Override with -DFETCHCONTENT_SOURCE_DIR_WGPU_NATIVE=<extracted dir>
# or drop the zip contents in third_party/wgpu-native/.

include(FetchContent)

set(WGPU_NATIVE_VERSION "v29.0.1.1" CACHE STRING "gfx-rs/wgpu-native release tag")
set(_wgpu_zip "wgpu-windows-x86_64-gnu-release.zip")
set(_wgpu_url
    "https://github.com/gfx-rs/wgpu-native/releases/download/${WGPU_NATIVE_VERSION}/${_wgpu_zip}")
# SHA256 of the v29.0.1.1 GNU x64 release asset.
set(_wgpu_sha256 "d471e3614733c1d4ddd61bfd19868356477d0d37bf531bf8c6cb64a7f579bd2a")

set(_wgpu_vendor "${CMAKE_SOURCE_DIR}/third_party/wgpu-native")

if (EXISTS "${_wgpu_vendor}/include/webgpu.h" OR EXISTS "${_wgpu_vendor}/webgpu.h"
        OR EXISTS "${_wgpu_vendor}/include/webgpu/webgpu.h")
    set(wgpu_native_SOURCE_DIR "${_wgpu_vendor}")
    message(STATUS "wgpu-native: using vendored ${_wgpu_vendor}")
else ()
    message(STATUS "wgpu-native: fetching ${WGPU_NATIVE_VERSION} GNU x64 (${_wgpu_zip})")
    FetchContent_Declare(
        wgpu_native
        URL "${_wgpu_url}"
        URL_HASH "SHA256=${_wgpu_sha256}"
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    )
    cmake_policy(SET CMP0169 OLD)
    FetchContent_GetProperties(wgpu_native)
    if (NOT wgpu_native_POPULATED)
        FetchContent_Populate(wgpu_native)
    endif ()
endif ()

function(_wgpu_pick_file out_var)
    set(_found "")
    foreach (_cand IN LISTS ARGN)
        if (EXISTS "${_cand}")
            set(_found "${_cand}")
            break()
        endif ()
    endforeach ()
    set(${out_var} "${_found}" PARENT_SCOPE)
endfunction()

set(_root "${wgpu_native_SOURCE_DIR}")

# Headers: zip layouts vary between include/ and include/webgpu/.
_wgpu_pick_file(_wgpu_h
    "${_root}/include/webgpu.h"
    "${_root}/include/webgpu/webgpu.h"
    "${_root}/webgpu.h"
    "${_root}/webgpu/webgpu.h")
if (NOT _wgpu_h)
    file(GLOB_RECURSE _wgpu_h_glob "${_root}/webgpu.h")
    if (_wgpu_h_glob)
        list(GET _wgpu_h_glob 0 _wgpu_h)
    endif ()
endif ()
if (NOT _wgpu_h)
    message(FATAL_ERROR
        "wgpu-native: webgpu.h not found under ${_root}. URL was: ${_wgpu_url}")
endif ()
get_filename_component(WGPU_INCLUDE_DIR "${_wgpu_h}" DIRECTORY)

_wgpu_pick_file(_wgpu_wh
    "${WGPU_INCLUDE_DIR}/wgpu.h"
    "${_root}/include/wgpu.h"
    "${_root}/wgpu.h")
if (NOT _wgpu_wh)
    file(GLOB_RECURSE _wgpu_wh_glob "${_root}/wgpu.h")
    if (_wgpu_wh_glob)
        list(GET _wgpu_wh_glob 0 _wgpu_wh)
        get_filename_component(_wh_dir "${_wgpu_wh}" DIRECTORY)
        if (NOT _wh_dir STREQUAL WGPU_INCLUDE_DIR)
            set(WGPU_INCLUDE_DIR2 "${_wh_dir}")
        endif ()
    endif ()
endif ()

# Runtime DLL + GNU import lib (MinGW). Fall back to linking the DLL directly.
_wgpu_pick_file(WGPU_NATIVE_DLL
    "${_root}/lib/wgpu_native.dll"
    "${_root}/bin/wgpu_native.dll"
    "${_root}/wgpu_native.dll")
if (NOT WGPU_NATIVE_DLL)
    file(GLOB_RECURSE _wgpu_dlls "${_root}/wgpu_native.dll")
    if (_wgpu_dlls)
        list(GET _wgpu_dlls 0 WGPU_NATIVE_DLL)
    endif ()
endif ()
if (NOT WGPU_NATIVE_DLL)
    message(FATAL_ERROR
        "wgpu-native: wgpu_native.dll not found under ${_root}. URL was: ${_wgpu_url}")
endif ()

_wgpu_pick_file(WGPU_NATIVE_LIB
    "${_root}/lib/libwgpu_native.dll.a"
    "${_root}/lib/wgpu_native.dll.a"
    "${_root}/lib/libwgpu_native.a"
    "${_root}/libwgpu_native.dll.a"
    "${_root}/wgpu_native.dll.a")
if (NOT WGPU_NATIVE_LIB)
    get_filename_component(_dll_dir "${WGPU_NATIVE_DLL}" DIRECTORY)
    _wgpu_pick_file(WGPU_NATIVE_LIB
        "${_dll_dir}/libwgpu_native.dll.a"
        "${_dll_dir}/wgpu_native.dll.a"
        "${_dll_dir}/libwgpu_native.a")
endif ()
if (NOT WGPU_NATIVE_LIB)
    # g++ can link a DLL without an import lib.
    set(WGPU_NATIVE_LIB "${WGPU_NATIVE_DLL}")
endif ()

set(WGPU_INCLUDE_DIR "${WGPU_INCLUDE_DIR}" CACHE INTERNAL "wgpu-native include dir")
set(WGPU_NATIVE_LIB "${WGPU_NATIVE_LIB}" CACHE INTERNAL "wgpu-native import library")
set(WGPU_NATIVE_DLL "${WGPU_NATIVE_DLL}" CACHE INTERNAL "wgpu-native runtime DLL")
if (DEFINED WGPU_INCLUDE_DIR2)
    set(WGPU_INCLUDE_DIR2 "${WGPU_INCLUDE_DIR2}" CACHE INTERNAL "extra wgpu-native include dir")
endif ()

message(STATUS "wgpu-native: include = ${WGPU_INCLUDE_DIR}")
message(STATUS "wgpu-native: lib     = ${WGPU_NATIVE_LIB}")
message(STATUS "wgpu-native: dll     = ${WGPU_NATIVE_DLL}")
