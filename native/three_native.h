#pragma once

#include <stdint.h>

#ifdef _WIN32
#ifdef THREE_NATIVE_EXPORT
#define TN_API __declspec(dllexport)
#else
#define TN_API __declspec(dllimport)
#endif
#else
#define TN_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

TN_API const char* tn_last_error(void);
TN_API const char* tn_backend_name(void);
TN_API int tn_runtime_has_vulkan(void);
TN_API void tn_runtime_set_backend(int vulkan);

TN_API int tn_runtime_start(int width, int height, const char* title);
TN_API int tn_runtime_is_open(void);
TN_API void tn_runtime_set_size(int width, int height);
TN_API void tn_runtime_set_vsync(int enabled);
TN_API void tn_runtime_set_standalone(int enabled);
TN_API void tn_runtime_stats(int* fps, int* frame_us, int* width, int* height, int* vsync, uint64_t* presents);
TN_API int tn_runtime_render(uint32_t scene, uint32_t camera);
TN_API void tn_runtime_shutdown(void);
TN_API void tn_runtime_reset(void);
TN_API float tn_runtime_aspect(void);
TN_API int tn_runtime_attach_host(void* parent_hwnd, int x, int y, int width, int height);
TN_API void* tn_runtime_hwnd(void);
TN_API int tn_cmd_submit(const uint8_t* data, int nbytes);
TN_API int tn_cmd_submit_async(const uint8_t* data, int nbytes);
TN_API int tn_frame_info(int* width, int* height, uint64_t* generation);
TN_API int tn_frame_copy(uint8_t* dst, int max_bytes, int* width, int* height, uint64_t* generation);

TN_API uint32_t tn_scene_create(void);
TN_API void tn_scene_set_background(uint32_t scene, uint32_t hex);

TN_API uint32_t tn_perspective_camera_create(float fov, float aspect, float near_plane, float far_plane);
TN_API void tn_camera_update_projection_matrix(uint32_t camera);
TN_API void tn_camera_set_aspect(uint32_t camera, float aspect);

TN_API uint32_t tn_box_geometry_create(float width, float height, float depth);
TN_API uint32_t tn_plane_geometry_create(float width, float height, int width_segments, int height_segments);
TN_API uint32_t tn_sphere_geometry_create(float radius, int width_segments, int height_segments);
TN_API uint32_t tn_cylinder_geometry_create(
    float radius_top, float radius_bottom, float height, int radial_segments, int height_segments);
TN_API uint32_t tn_mesh_standard_material_create(uint32_t color);
TN_API uint32_t tn_mesh_basic_material_create(uint32_t color);
TN_API uint32_t tn_mesh_create(uint32_t geometry, uint32_t material);
TN_API uint32_t tn_group_create(void);
TN_API uint32_t tn_hemisphere_light_create(void);
TN_API uint32_t tn_point_light_create(uint32_t color, float intensity);

TN_API int tn_object_add(uint32_t parent, uint32_t child);
TN_API void tn_object_remove(uint32_t parent, uint32_t child);
TN_API void tn_slot_destroy(uint32_t id);
TN_API int tn_object_set_visible(uint32_t object, int visible);
TN_API int tn_object_set_position(uint32_t object, float x, float y, float z);
TN_API int tn_object_get_position(uint32_t object, float* x, float* y, float* z);
TN_API int tn_object_set_rotation(uint32_t object, float x, float y, float z);
TN_API int tn_object_get_rotation(uint32_t object, float* x, float* y, float* z);
TN_API int tn_object_set_scale(uint32_t object, float x, float y, float z);
TN_API int tn_object_look_at(uint32_t object, float x, float y, float z);
TN_API void tn_object_look_from(uint32_t object, float x, float y, float z, float tx, float ty, float tz);

TN_API uint32_t tn_ambient_light_create(uint32_t color, float intensity);
TN_API uint32_t tn_directional_light_create(uint32_t color, float intensity);
TN_API void tn_renderer_set_tone_mapping(int mode, float exposure);

TN_API uint32_t tn_gltf_load(const char* path);
TN_API int tn_gltf_clip_count(uint32_t object);
TN_API uint32_t tn_mixer_create(uint32_t root);
TN_API int tn_mixer_play(uint32_t mixer, int clip_index);
TN_API void tn_mixer_update(uint32_t mixer, float dt);

TN_API uint32_t tn_torus_knot_geometry_create(float radius, float tube, int tubular, int radial, int p, int q);
TN_API void tn_material_set_pbr(uint32_t material, float metalness, float roughness);
TN_API uint32_t tn_instanced_mesh_create(uint32_t geometry, uint32_t material, int count);
TN_API int tn_instanced_fill_grid(uint32_t mesh, float spacing);

TN_API uint32_t tn_buffer_geometry_create(
    const float* pos, int pos_floats,
    const float* nrm, int nrm_floats,
    const float* uv, int uv_floats,
    const uint32_t* idx, int idx_count);
TN_API void tn_buffer_geometry_set_attr(
    uint32_t geometry, const char* name, int item_size, const float* data, int float_count);
TN_API uint32_t tn_mesh_lambert_material_create(uint32_t color);
TN_API uint32_t tn_mesh_normal_material_create(void);
TN_API void tn_material_set_side(uint32_t material, int side);
TN_API void tn_material_set_visible(uint32_t material, int visible);
TN_API void tn_material_set_map(uint32_t material, uint32_t texture);
TN_API void tn_material_set_map_slot(uint32_t material, int slot, uint32_t texture);
TN_API uint32_t tn_texture_from_rgba(int width, int height, const uint8_t* rgba, int nbytes);
TN_API void tn_texture_set_filter(uint32_t texture, int mag, int min);

TN_API uint32_t tn_line_create(uint32_t geometry, uint32_t material);
TN_API uint32_t tn_line_segments_create(uint32_t geometry, uint32_t material);
TN_API uint32_t tn_line_loop_create(uint32_t geometry, uint32_t material);
TN_API uint32_t tn_line_basic_material_create(uint32_t color, float linewidth);

TN_API uint32_t tn_points_create(uint32_t geometry, uint32_t material);
TN_API uint32_t tn_points_material_create(uint32_t color, float size);

TN_API uint32_t tn_sprite_create(uint32_t material);
TN_API uint32_t tn_sprite_material_create(uint32_t color);

TN_API uint32_t tn_bone_create(void);
TN_API uint32_t tn_skeleton_create(const uint32_t* bones, int count);
TN_API int tn_skeleton_set_inverses(uint32_t skeleton, const float* inverses, int inverse_count);
TN_API uint32_t tn_skinned_mesh_create(uint32_t geometry, uint32_t material);
TN_API int tn_skinned_bind(uint32_t mesh, uint32_t skeleton);
TN_API int tn_mesh_set_material(uint32_t mesh, uint32_t material);

TN_API uint32_t tn_cube_rt_create(uint32_t id, int size);
TN_API void tn_cube_rt_update(
    uint32_t cubeRt, uint32_t scene, float x, float y, float z, float near_plane, float far_plane);

TN_API uint32_t tn_axes_helper_create(float size);
TN_API uint32_t tn_grid_helper_create(float size, int divisions, uint32_t color1, uint32_t color2);
TN_API uint32_t tn_box_helper_create(uint32_t object);
TN_API uint32_t tn_arrow_helper_create(float dx, float dy, float dz, float length, uint32_t color);

TN_API uint32_t tn_orthographic_camera_create(
    float left, float right, float top, float bottom, float near_plane, float far_plane);
TN_API void tn_orthographic_camera_update(
    uint32_t camera, float left, float right, float top, float bottom,
    float near_plane, float far_plane, float zoom);
TN_API uint32_t tn_spot_light_create(
    uint32_t color, float intensity, float distance, float angle, float penumbra, float decay);
TN_API void tn_scene_set_fog(uint32_t scene, uint32_t color, float near_plane, float far_plane);
TN_API void tn_scene_set_fog_exp2(uint32_t scene, uint32_t color, float density);

TN_API int tn_instanced_set_matrix_at(uint32_t mesh, int index, const float* elements16);
TN_API int tn_instanced_set_color_at(uint32_t mesh, int index, uint32_t hex);
TN_API int tn_instanced_set_count(uint32_t mesh, int count);

TN_API uint32_t tn_lod_create(void);
TN_API int tn_lod_add_level(uint32_t lod, uint32_t object, float distance);
TN_API void tn_lod_update(uint32_t lod, uint32_t camera);

TN_API uint32_t tn_shader_material_create(const char* vertex_src, const char* fragment_src);
TN_API void tn_shader_material_set_source(uint32_t material, const char* vertex_src, const char* fragment_src);
TN_API void tn_shader_uniform_float(uint32_t material, const char* name, float v);
TN_API void tn_shader_uniform_vec2(uint32_t material, const char* name, float x, float y);
TN_API void tn_shader_uniform_vec3(uint32_t material, const char* name, float x, float y, float z);
TN_API void tn_shader_uniform_vec4(uint32_t material, const char* name, float x, float y, float z, float w);
TN_API void tn_shader_set_flags(uint32_t material, int side, int depth_write);

TN_API void tn_scene_set_environment(uint32_t scene, uint32_t texture);
TN_API uint32_t tn_pmrem_from_sky(
    uint32_t id,
    float sun_x, float sun_y, float sun_z,
    float turbidity, float rayleigh,
    float mie_coefficient, float mie_directional_g);
TN_API uint32_t tn_pmrem_from_equirect(uint32_t id, uint32_t texture);
TN_API uint32_t tn_pmrem_from_cubemap(uint32_t id, uint32_t texture);
TN_API uint32_t tn_pmrem_from_object(uint32_t id, uint32_t object);

#ifdef __cplusplus
}
#endif
