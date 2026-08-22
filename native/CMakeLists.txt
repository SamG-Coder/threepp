add_library(three_native SHARED
        three_native.cpp
        runtime_internal.cpp
        gpu_line.cpp
        gpu_points.cpp
        gpu_sprite.cpp
        gpu_skin.cpp
        gpu_helpers.cpp
        gpu_camera_light.cpp
        gpu_instance.cpp
        gpu_lod.cpp
        gpu_shader.cpp
        gpu_env.cpp
        cmd_batch.cpp
)
target_include_directories(three_native PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}"
        PRIVATE "${CMAKE_SOURCE_DIR}/src/external/glfw/include"
                "${CMAKE_SOURCE_DIR}/src/external/glad"
                "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(three_native PRIVATE threepp::threepp)
if (WIN32)
    target_link_libraries(three_native PRIVATE gdi32)
endif ()
target_compile_definitions(three_native PRIVATE THREE_NATIVE_EXPORT)
if (THREEPP_WITH_VULKAN)
    target_compile_definitions(three_native PRIVATE THREEPP_WITH_VULKAN=1)
endif ()
set_target_properties(three_native PROPERTIES
        PREFIX ""
        OUTPUT_NAME "three_native"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
        LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)
if (MINGW)
    target_compile_options(threepp PRIVATE -g)
    target_compile_options(three_native PRIVATE -g)
    target_link_options(three_native PRIVATE -g)
    target_link_options(three_native PRIVATE -static -static-libgcc -static-libstdc++)
endif ()

add_executable(three_native_smoke three_native_smoke.cpp)
target_link_libraries(three_native_smoke PRIVATE three_native)
set_target_properties(three_native_smoke PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)

add_executable(three_native_cubes cmd_interactive_cubes_test.cpp)
target_link_libraries(three_native_cubes PRIVATE three_native)
set_target_properties(three_native_cubes PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)
if (THREEPP_BUILD_TESTS)
    add_test(NAME three_native_cubes COMMAND three_native_cubes)
endif ()

if (MINGW)
    target_link_options(three_native_smoke PRIVATE -static -static-libgcc -static-libstdc++)
    target_link_options(three_native_cubes PRIVATE -static -static-libgcc -static-libstdc++)
endif ()

# Sibling WebGPU present DLL. Independent of three_native / threepp GL.
if (WIN32)
    include("${CMAKE_SOURCE_DIR}/cmake/FetchWebGPU.cmake")
    include("${CMAKE_SOURCE_DIR}/cmake/FetchStreamline.cmake")
    add_library(three_webgpu SHARED
            webgpu/three_webgpu.cpp
            webgpu/streamline_bridge.cpp
    )
    target_include_directories(three_webgpu PUBLIC
            "${CMAKE_CURRENT_SOURCE_DIR}/webgpu"
            PRIVATE
            "${WGPU_INCLUDE_DIR}"
    )
    if (DEFINED WGPU_INCLUDE_DIR2)
        target_include_directories(three_webgpu PRIVATE "${WGPU_INCLUDE_DIR2}")
    endif ()
    target_compile_definitions(three_webgpu PRIVATE THREE_WEBGPU_EXPORT WGPU_SHARED_LIBRARY)
    if (THREEBROWSER_ENABLE_STREAMLINE)
        find_package(Vulkan REQUIRED)
        target_compile_definitions(three_webgpu PRIVATE THREEBROWSER_STREAMLINE=1)
        target_include_directories(three_webgpu PRIVATE
            "${STREAMLINE_INCLUDE_DIR}"
            "${Vulkan_INCLUDE_DIRS}")
    endif ()
    target_link_libraries(three_webgpu PRIVATE "${WGPU_NATIVE_LIB}" user32 gdi32)
    target_link_libraries(three_native PRIVATE three_webgpu)
    set_target_properties(three_webgpu PROPERTIES
            PREFIX ""
            OUTPUT_NAME "three_webgpu"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
            LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    )
    if (MINGW)
        target_link_options(three_webgpu PRIVATE -static -static-libgcc -static-libstdc++)
    endif ()
    add_custom_command(TARGET three_webgpu POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${WGPU_NATIVE_DLL}" "$<TARGET_FILE_DIR:three_webgpu>/wgpu_native.dll"
            COMMENT "Copy wgpu_native.dll next to three_webgpu.dll")
    if (THREEBROWSER_ENABLE_STREAMLINE)
        foreach (_sl_runtime
                sl.interposer.dll sl.common.dll sl.dlss.dll sl.dlss_g.dll sl.dlss_d.dll
                sl.reflex.dll sl.pcl.dll NvLowLatencyVk.dll nvngx_dlss.dll nvngx_dlssg.dll
                nvngx_dlssd.dll)
            add_custom_command(TARGET three_webgpu POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "${STREAMLINE_BIN_DIR}/${_sl_runtime}" "$<TARGET_FILE_DIR:three_webgpu>/${_sl_runtime}")
        endforeach ()
    endif ()

    add_executable(three_webgpu_smoke webgpu/three_webgpu_smoke.cpp)
    target_include_directories(three_webgpu_smoke PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/webgpu")
    target_link_libraries(three_webgpu_smoke PRIVATE three_webgpu)
    set_target_properties(three_webgpu_smoke PROPERTIES
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    )
    if (MINGW)
        target_link_options(three_webgpu_smoke PRIVATE -static -static-libgcc -static-libstdc++)
    endif ()
endif ()
