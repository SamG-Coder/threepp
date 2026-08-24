cmake_minimum_required(VERSION 3.24)

if (NOT WIN32)
    message(FATAL_ERROR "The first ThreeBrowserRuntime milestone currently targets Windows")
endif ()

find_program(THREEBROWSER_NODE_EXECUTABLE node REQUIRED)
execute_process(
        COMMAND "${THREEBROWSER_NODE_EXECUTABLE}" -p "process.versions.node"
        OUTPUT_VARIABLE THREEBROWSER_NODE_VERSION
        OUTPUT_STRIP_TRAILING_WHITESPACE
        COMMAND_ERROR_IS_FATAL ANY)
execute_process(
        COMMAND "${THREEBROWSER_NODE_EXECUTABLE}" -p "process.arch"
        OUTPUT_VARIABLE THREEBROWSER_NODE_ARCH
        OUTPUT_STRIP_TRAILING_WHITESPACE
        COMMAND_ERROR_IS_FATAL ANY)

if (NOT THREEBROWSER_NODE_ARCH STREQUAL "x64")
    message(FATAL_ERROR "The first runtime build expects x64 Node, found ${THREEBROWSER_NODE_ARCH}")
endif ()

set(_node_cache "${CMAKE_CURRENT_BINARY_DIR}/node-${THREEBROWSER_NODE_VERSION}")
set(_node_headers "${_node_cache}/node-v${THREEBROWSER_NODE_VERSION}/include/node")
set(_node_archive "${_node_cache}/node-headers.tar.gz")
set(_node_lib "${_node_cache}/node.lib")
file(MAKE_DIRECTORY "${_node_cache}")

if (NOT EXISTS "${_node_headers}/node_api.h")
    file(DOWNLOAD
            "https://nodejs.org/dist/v${THREEBROWSER_NODE_VERSION}/node-v${THREEBROWSER_NODE_VERSION}-headers.tar.gz"
            "${_node_archive}"
            TLS_VERIFY ON
            STATUS _download_status)
    list(GET _download_status 0 _download_code)
    if (NOT _download_code EQUAL 0)
        list(GET _download_status 1 _download_message)
        message(FATAL_ERROR "Could not download Node headers: ${_download_message}")
    endif ()
    file(ARCHIVE_EXTRACT INPUT "${_node_archive}" DESTINATION "${_node_cache}")
endif ()

if (NOT EXISTS "${_node_lib}")
    file(DOWNLOAD
            "https://nodejs.org/dist/v${THREEBROWSER_NODE_VERSION}/win-x64/node.lib"
            "${_node_lib}"
            TLS_VERIFY ON
            STATUS _download_status)
    list(GET _download_status 0 _download_code)
    if (NOT _download_code EQUAL 0)
        list(GET _download_status 1 _download_message)
        message(FATAL_ERROR "Could not download node.lib: ${_download_message}")
    endif ()
endif ()

add_library(three_browser_runtime MODULE
        src/addon.cpp
        src/canvas2d.cpp)
target_compile_definitions(three_browser_runtime PRIVATE
        NAPI_VERSION=10 NODE_GYP_MODULE_NAME=three_browser_runtime WIN32_LEAN_AND_MEAN NOMINMAX)
target_include_directories(three_browser_runtime PRIVATE
        "${_node_headers}"
        "${PROJECT_SOURCE_DIR}/native"
        "${PROJECT_SOURCE_DIR}/src/external/stb"
        "${PROJECT_SOURCE_DIR}/src/external/libwebp/src")
target_link_libraries(three_browser_runtime PRIVATE three_native three_webgpu threepp "${_node_lib}" dwmapi user32)
if (CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
    target_compile_options(three_browser_runtime PRIVATE -Wno-stringop-overflow)
endif ()
set_target_properties(three_browser_runtime PROPERTIES
        PREFIX ""
        SUFFIX ".node"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
        LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")

add_custom_command(TARGET three_browser_runtime POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:three_native>" "$<TARGET_FILE_DIR:three_browser_runtime>"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:three_webgpu>" "$<TARGET_FILE_DIR:three_browser_runtime>"
        COMMENT "Stage ThreeBrowserRuntime native libraries")

add_custom_target(three_browser_runtime_stage
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${CMAKE_CURRENT_SOURCE_DIR}/runtime" "$<TARGET_FILE_DIR:three_browser_runtime>/runtime"
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${CMAKE_CURRENT_SOURCE_DIR}/demo" "$<TARGET_FILE_DIR:three_browser_runtime>/demo"
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${PROJECT_SOURCE_DIR}/host/ThreeBrowser/web/three" "$<TARGET_FILE_DIR:three_browser_runtime>/runtime/three"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${PROJECT_SOURCE_DIR}/host/ThreeBrowser/web/three-webgpu-cmd.js"
            "$<TARGET_FILE_DIR:three_browser_runtime>/runtime/three-webgpu-cmd.js"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${PROJECT_SOURCE_DIR}/host/ThreeBrowser/web/three-webgpu-gpu.js"
            "$<TARGET_FILE_DIR:three_browser_runtime>/runtime/three-webgpu-gpu.js"
        DEPENDS three_browser_runtime
        COMMENT "Stage ThreeBrowserRuntime JavaScript host and demo")

if (MINGW)
    get_filename_component(_mingw_bin "${CMAKE_CXX_COMPILER}" DIRECTORY)
    foreach (_runtime_dll libgcc_s_seh-1.dll libstdc++-6.dll libwinpthread-1.dll)
        add_custom_command(TARGET three_browser_runtime POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "${_mingw_bin}/${_runtime_dll}" "$<TARGET_FILE_DIR:three_browser_runtime>")
    endforeach ()
endif ()
