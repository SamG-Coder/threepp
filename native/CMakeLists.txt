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
    # Release must not embed DWARF. A previous unconditional -g made
    # three_native.dll ~176 MB; the same binary strips to ~10 MB.
    if (CMAKE_BUILD_TYPE MATCHES "^(Debug|RelWithDebInfo)$")
        target_compile_options(threepp PRIVATE -g)
        target_compile_options(three_native PRIVATE -g)
        target_link_options(three_native PRIVATE -g)
    endif ()
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
    option(THREEBROWSER_ENABLE_RAY_QUERY
           "Enable the Vulkan ray-query bridge used by the WebGPU runtime" ON)
    add_library(three_webgpu SHARED
            webgpu/three_webgpu.cpp
            webgpu/streamline_bridge.cpp
            webgpu/ray_query_bridge.cpp
            webgpu/shader_compiler.cpp
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
    if (THREEBROWSER_ENABLE_STREAMLINE OR THREEBROWSER_ENABLE_RAY_QUERY)
        find_package(Vulkan REQUIRED)
        target_include_directories(three_webgpu PRIVATE "${Vulkan_INCLUDE_DIRS}")
    endif ()
    if (THREEBROWSER_ENABLE_STREAMLINE)
        target_compile_definitions(three_webgpu PRIVATE THREEBROWSER_STREAMLINE=1)
        if (THREEBROWSER_DLSS5_AVAILABLE)
            target_compile_definitions(three_webgpu PRIVATE
                THREEBROWSER_DLSS_NEURAL_RENDERING=1)
            if (THREEBROWSER_DLSS5_USES_SDK_HEADER)
                target_compile_definitions(three_webgpu PRIVATE
                    THREEBROWSER_DLSS_NR_SDK_HEADER=1)
            elseif (THREEBROWSER_DLSS5_USES_PREVIEW_ABI)
                target_compile_definitions(three_webgpu PRIVATE
                    THREEBROWSER_DLSS_NR_PREVIEW_ABI=1)
            endif ()
        endif ()
        target_include_directories(three_webgpu PRIVATE
            "${STREAMLINE_INCLUDE_DIR}")
    endif ()
    if (THREEBROWSER_ENABLE_RAY_QUERY)
        include("${CMAKE_SOURCE_DIR}/cmake/CompileVulkanShaders.cmake")
        target_compile_definitions(three_webgpu PRIVATE THREEBROWSER_RAY_QUERY=1)
        compile_vulkan_shader(three_webgpu
            "${CMAKE_CURRENT_SOURCE_DIR}/webgpu/shaders/ray_query_lighting.comp"
            kRayQueryLightingCompSpv
            _ray_query_lighting_spv_h)
        compile_vulkan_shader(three_webgpu
            "${CMAKE_CURRENT_SOURCE_DIR}/webgpu/shaders/ray_query_reflections.comp"
            kRayQueryReflectionsCompSpv
            _ray_query_reflections_spv_h)
        compile_vulkan_shader(three_webgpu
            "${CMAKE_CURRENT_SOURCE_DIR}/webgpu/shaders/ray_query_reflections.comp"
            kRayQueryReflectionsV2R16CompSpv
            _ray_query_reflections_v2_r16_spv_h
            VARIANT_SUFFIX reflections_v2_r16
            DEFINES THREEBROWSER_REFLECTIONS_V2=1)
        compile_vulkan_shader(three_webgpu
            "${CMAKE_CURRENT_SOURCE_DIR}/webgpu/shaders/ray_query_reflections.comp"
            kRayQueryReflectionsV2R32CompSpv
            _ray_query_reflections_v2_r32_spv_h
            VARIANT_SUFFIX reflections_v2_r32
            DEFINES THREEBROWSER_REFLECTIONS_V2=1 THREEBROWSER_HIT_DISTANCE_R32=1)
    endif ()
    target_link_libraries(three_webgpu PRIVATE "${WGPU_NATIVE_LIB}" user32 gdi32 bcrypt)
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
    if (THREEBROWSER_ENABLE_RAY_QUERY)
        add_custom_command(TARGET three_webgpu POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${GLSLANG_VALIDATOR}"
                "$<TARGET_FILE_DIR:three_webgpu>/glslangValidator.exe"
                COMMENT "Copy glslangValidator.exe next to three_webgpu.dll")
    endif ()
    if (THREEBROWSER_ENABLE_STREAMLINE)
        foreach (_sl_runtime
                sl.interposer.dll sl.common.dll sl.dlss.dll sl.dlss_g.dll sl.dlss_d.dll
                sl.reflex.dll sl.pcl.dll NvLowLatencyVk.dll nvngx_dlss.dll nvngx_dlssg.dll
                nvngx_dlssd.dll)
            add_custom_command(TARGET three_webgpu POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "${STREAMLINE_BIN_DIR}/${_sl_runtime}" "$<TARGET_FILE_DIR:three_webgpu>/${_sl_runtime}")
        endforeach ()
        if (THREEBROWSER_DLSS5_AVAILABLE)
            foreach (_dlss5_runtime sl.dlss_nr.dll nvngx_dlssnr.dll)
                add_custom_command(TARGET three_webgpu POST_BUILD
                    COMMAND ${CMAKE_COMMAND} -E copy_if_different
                        "${THREEBROWSER_DLSS5_BIN_DIR}/${_dlss5_runtime}"
                        "$<TARGET_FILE_DIR:three_webgpu>/${_dlss5_runtime}")
            endforeach ()
        endif ()
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
