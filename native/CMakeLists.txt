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
        cmd_batch.cpp
)
target_include_directories(three_native PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}"
        PRIVATE "${CMAKE_SOURCE_DIR}/src/external/glfw/include")
target_link_libraries(three_native PRIVATE threepp::threepp)
target_compile_definitions(three_native PRIVATE THREE_NATIVE_EXPORT)
set_target_properties(three_native PROPERTIES
        PREFIX ""
        OUTPUT_NAME "three_native"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
        LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)
if (MINGW)
    target_link_options(three_native PRIVATE -static -static-libgcc -static-libstdc++)
endif ()

add_executable(three_native_smoke three_native_smoke.cpp)
target_link_libraries(three_native_smoke PRIVATE three_native)
set_target_properties(three_native_smoke PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)
if (MINGW)
    target_link_options(three_native_smoke PRIVATE -static -static-libgcc -static-libstdc++)
endif ()
