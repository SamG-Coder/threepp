cmake_minimum_required(VERSION 3.22.1)
project(threebrowser_droid LANGUAGES CXX)

set(THREEPP_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(THREEPP_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(THREEPP_BUILD_EDITOR OFF CACHE BOOL "" FORCE)
set(THREEPP_BUILD_EXAMPLE_PROJECTS OFF CACHE BOOL "" FORCE)
set(THREEPP_WITH_AUDIO OFF CACHE BOOL "" FORCE)
set(THREEPP_WITH_GLFW OFF CACHE BOOL "" FORCE)
set(THREEPP_WITH_JS_HOST OFF CACHE BOOL "" FORCE)
set(THREEPP_WITH_VULKAN OFF CACHE BOOL "" FORCE)
add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../../../../../" threepp-core)

add_library(threebrowser_droid SHARED
        native_runtime.cpp
        ../../../../../native/three_native.cpp
        ../../../../../native/runtime_internal.cpp
        ../../../../../native/cmd_batch.cpp
        ../../../../../native/gpu_env.cpp
        ../../../../../native/gpu_shader.cpp
        ../../../../../native/gpu_skin.cpp)

target_compile_features(threebrowser_droid PRIVATE cxx_std_20)
target_include_directories(threebrowser_droid PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../native"
        "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../src")
target_link_libraries(threebrowser_droid PRIVATE
        threepp::threepp
        android
        EGL
        GLESv3
        log)
