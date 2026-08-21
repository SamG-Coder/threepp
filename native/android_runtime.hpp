#pragma once

#include <cstdint>

#if defined(__ANDROID__)
extern "C" {
int tn_android_context_create(int width, int height);
void tn_android_context_resize(int width, int height);
void tn_android_frame(void);
void tn_android_context_destroy(void);
int tn_cmd_submit(const std::uint8_t* data, int nbytes);
int tn_cmd_submit_async(const std::uint8_t* data, int nbytes);
void tn_runtime_reset(void);
const char* tn_last_error(void);
std::uint32_t tn_bone_create(void);
std::uint32_t tn_skeleton_create(const std::uint32_t* bones, int count);
int tn_skeleton_set_inverses(std::uint32_t skeleton, const float* inverses, int inverse_count);
void tn_scene_set_environment(std::uint32_t scene, std::uint32_t texture);
std::uint32_t tn_pmrem_from_object(std::uint32_t id, std::uint32_t object);
std::uint32_t tn_shader_material_create(const char* vertex_src, const char* fragment_src);
void tn_shader_set_flags(std::uint32_t material, int side, int depth_write);
void tn_shader_uniform_float(std::uint32_t material, const char* name, float value);
void tn_shader_uniform_vec2(std::uint32_t material, const char* name, float x, float y);
void tn_shader_uniform_vec3(std::uint32_t material, const char* name, float x, float y, float z);
void tn_shader_uniform_vec4(std::uint32_t material, const char* name, float x, float y, float z, float w);
}
#endif
