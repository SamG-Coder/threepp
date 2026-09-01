#pragma once

#include <stdint.h>

#ifdef _WIN32
#ifdef THREE_WEBGPU_EXPORT
#define TW_API __declspec(dllexport)
#else
#define TW_API __declspec(dllimport)
#endif
#else
#define TW_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

enum {
    TW_INPUT_POINTER_MOVE = 1,
    TW_INPUT_POINTER_DOWN = 2,
    TW_INPUT_POINTER_UP = 3,
    TW_INPUT_WHEEL = 4,
    TW_INPUT_KEY_DOWN = 5,
    TW_INPUT_KEY_UP = 6,
    TW_INPUT_POINTER_LOCK_LOST = 7,
    TW_INPUT_POINTER_CANCEL = 8,
    TW_INPUT_POINTER_LEAVE = 9,
    TW_INPUT_HORIZONTAL_WHEEL = 10,
    TW_INPUT_POINTER_DOUBLE_CLICK = 11
};

typedef struct TWInputEvent {
    int type;
    int code;
    int x;
    int y;
    int movement_x;
    int movement_y;
    int modifiers;
} TWInputEvent;

typedef struct TWGpuCapabilities {
    uint32_t struct_size;
    uint32_t vendor_id;
    uint32_t device_id;
    int is_rtx;
    int streamline_present;
    int streamline_initialized;
    int vulkan_attached;
    int dlss_super_resolution;
    int dlss_frame_generation;
    int dlss_ray_reconstruction;
    int reflex;
    char adapter_name[128];
    char status[256];
    int native_ray_tracing;
    int ray_query;
    int dlss_neural_rendering;
    int dlss_neural_rendering_api_loaded;
} TWGpuCapabilities;

enum {
    TW_DLSS_OFF = 0,
    TW_DLSS_MAX_PERFORMANCE = 1,
    TW_DLSS_BALANCED = 2,
    TW_DLSS_MAX_QUALITY = 3,
    TW_DLSS_ULTRA_PERFORMANCE = 4,
    TW_DLSS_ULTRA_QUALITY = 5,
    TW_DLSS_DLAA = 6
};

typedef struct TWGpuFeatureRequest {
    uint32_t struct_size;
    uint32_t dlss_mode;
    uint32_t output_width;
    uint32_t output_height;
    float pre_exposure;
    float exposure_scale;
    int color_buffers_hdr;
    int auto_exposure;
    int alpha_upscaling;
    int frame_generation;
    int ray_reconstruction;
} TWGpuFeatureRequest;

typedef struct TWGpuFeatureStatus {
    uint32_t struct_size;
    int dlss_supported;
    int dlss_api_loaded;
    int dlss_requested;
    int dlss_configured;
    int dlss_active;
    uint32_t dlss_mode;
    uint32_t render_width;
    uint32_t render_height;
    uint32_t output_width;
    uint32_t output_height;
    uint64_t estimated_vram_bytes;
    uint64_t dlss_evaluation_count;
    uint64_t dlss_failure_count;
    int32_t dlss_last_result;
    int frame_generation_supported;
    int frame_generation_api_loaded;
    int frame_generation_requested;
    int frame_generation_configured;
    int frame_generation_active;
    int ray_reconstruction_supported;
    int ray_reconstruction_api_loaded;
    int ray_reconstruction_requested;
    int ray_reconstruction_configured;
    int ray_reconstruction_active;
    uint64_t ray_reconstruction_evaluation_count;
    uint64_t ray_reconstruction_failure_count;
    uint64_t ray_reconstruction_estimated_vram_bytes;
    int32_t ray_reconstruction_last_result;
    char dlss_reason[256];
    char frame_generation_reason[256];
    char ray_reconstruction_reason[256];
    int native_ray_tracing_supported;
    int native_ray_tracing_configured;
    int native_ray_tracing_active;
    char native_ray_tracing_reason[256];
    int neural_rendering_supported;
    int neural_rendering_api_loaded;
    int neural_rendering_requested;
    int neural_rendering_configured;
    int neural_rendering_active;
    uint64_t neural_rendering_evaluation_count;
    uint64_t neural_rendering_failure_count;
    int32_t neural_rendering_last_result;
    char neural_rendering_reason[256];
} TWGpuFeatureStatus;

typedef struct TWDLSSOptimalSettings {
    uint32_t struct_size;
    uint32_t optimal_render_width;
    uint32_t optimal_render_height;
    uint32_t render_width_min;
    uint32_t render_height_min;
    uint32_t render_width_max;
    uint32_t render_height_max;
    float optimal_sharpness;
} TWDLSSOptimalSettings;

typedef struct TWDLSSResource {
    uint32_t texture_handle;
    uint32_t vulkan_layout;
    uint32_t left;
    uint32_t top;
    uint32_t width;
    uint32_t height;
} TWDLSSResource;

typedef struct TWDLSSFrameConstants {
    float camera_view_to_clip[16];
    float clip_to_camera_view[16];
    float clip_to_lens_clip[16];
    float clip_to_prev_clip[16];
    float prev_clip_to_clip[16];
    float jitter_offset[2];
    float motion_vector_scale[2];
    float camera_pinhole_offset[2];
    float camera_position[3];
    float camera_up[3];
    float camera_right[3];
    float camera_forward[3];
    float camera_near;
    float camera_far;
    float camera_fov;
    float camera_aspect_ratio;
    int depth_inverted;
    int camera_motion_included;
    int motion_vectors_3d;
    int reset;
    int orthographic_projection;
    int motion_vectors_dilated;
    int motion_vectors_jittered;
} TWDLSSFrameConstants;

typedef struct TWDLSSFrame {
    uint32_t struct_size;
    uint32_t viewport;
    uint32_t command_encoder_handle;
    TWDLSSResource color_input;
    TWDLSSResource color_output;
    TWDLSSResource depth;
    TWDLSSResource motion_vectors;
    TWDLSSResource exposure;
    int has_exposure;
    TWDLSSFrameConstants constants;
} TWDLSSFrame;

typedef struct TWDLSSNRFrame {
    uint32_t struct_size;
    uint32_t viewport;
    uint32_t command_encoder_handle;
    TWDLSSResource color_input;
    TWDLSSResource color_output;
    TWDLSSResource depth;
    TWDLSSResource motion_vectors;
    TWDLSSResource control_mask;
    int has_control_mask;
    int enabled;
    float intensity;
    float local_tone_strength;
    float local_structure_strength;
    float global_tone_strength;
    uint32_t style;
    uint32_t render_preset;
    int use_auto_mask;
    float skin_structure_strength;
    uint32_t performance_mode;
    TWDLSSFrameConstants constants;
} TWDLSSNRFrame;

typedef struct TWRayReconstructionFrame {
    uint32_t struct_size;
    uint32_t viewport;
    uint32_t command_encoder_handle;
    TWDLSSResource noisy_color;
    TWDLSSResource color_output;
    TWDLSSResource depth;
    TWDLSSResource motion_vectors;
    TWDLSSResource diffuse_albedo;
    TWDLSSResource specular_albedo;
    TWDLSSResource normal_roughness;
    TWDLSSResource roughness;
    TWDLSSResource specular_motion_vectors;
    TWDLSSResource specular_hit_distance;
    int normal_roughness_packed;
    int has_roughness;
    int has_specular_motion_vectors;
    int has_specular_hit_distance;
    float world_to_camera_view[16];
    float camera_view_to_world[16];
    TWDLSSFrameConstants constants;
} TWRayReconstructionFrame;

typedef struct TWFrameGenerationFrame {
    uint32_t struct_size;
    uint32_t viewport;
    uint32_t command_encoder_handle;
    TWDLSSResource hudless_color;
    TWDLSSResource depth;
    TWDLSSResource motion_vectors;
    TWDLSSResource ui;
    int has_ui;
    int ui_alpha_only;
    uint32_t frames_to_generate;
    TWDLSSFrameConstants constants;
} TWFrameGenerationFrame;

typedef struct TWFrameGenerationStatus {
    uint32_t struct_size;
    int supported;
    int api_loaded;
    int requested;
    int configured;
    int active;
    uint32_t frames_to_generate;
    uint32_t frames_to_generate_max;
    uint32_t last_frames_presented;
    uint64_t generated_frame_count;
    uint64_t failure_count;
    uint64_t estimated_vram_bytes;
    int32_t last_result;
    uint32_t last_status;
    char reason[256];
} TWFrameGenerationStatus;

// Truthful native ray-query state. "supported" means the active adapter and
// requested wgpu-native device feature both expose Vulkan ray query;
// "configured" means the native compute pipeline is ready; "active" means a
// static TLAS is ready for evaluation.
typedef struct TWRayQueryCapabilities {
    uint32_t struct_size;
    int supported;
    int configured;
    int active;
    int webgpu_feature_enabled;
    int acceleration_structure_supported;
    int ray_query_supported;
    uint32_t triangle_count;
    uint64_t build_count;
    uint64_t evaluation_count;
    uint64_t failure_count;
    char reason[256];
} TWRayQueryCapabilities;

// Generic fixed-topology deformable mesh input. positions_texture_handle must
// name a single-layer rgba32float WebGPU texture created with COPY_SRC and
// STORAGE_BINDING. Each texel supplies xyz for one vertex; w is ignored.
typedef struct TWRayQueryDynamicTriangleMeshFrame {
    uint32_t struct_size;
    uint32_t command_encoder_handle;
    uint32_t mesh_handle;
    uint32_t positions_texture_handle;
    uint32_t positions_vulkan_layout;
    uint32_t width;
    uint32_t height;
    uint32_t vertex_count;
    // Refit: bit 0 requests a full BLAS rebuild for large deformation.
    // Create: bit 1 declares the appended uniform reflection material.
    uint32_t flags;
    // Optional additive create ABI. Legacy callers may pass struct_size == 36;
    // these values are read only when struct_size covers the complete fields
    // and flags bit 1 is set.
    float reflection_radiance[4];
    // Linear metallic F0 RGB and perceptual roughness.
    float reflection_surface[4];
} TWRayQueryDynamicTriangleMeshFrame;

enum {
    TW_RAY_QUERY_PIPELINE_PROFILE_LIGHTING_V1 = 1,
    TW_RAY_QUERY_PIPELINE_PROFILE_REFLECTIONS_V1 = 2
};

typedef struct TWRayQueryLightingFrame {
    uint32_t struct_size;
    uint32_t command_encoder_handle;
    uint32_t color_texture_handle;
    uint32_t color_vulkan_layout;
    uint32_t depth_texture_handle;
    uint32_t depth_vulkan_layout;
    uint32_t width;
    uint32_t height;
    float inverse_view_projection[16];
    float camera_position[4];
    float sun_direction_intensity[4];
    float parameters[4];
    uint32_t flags;
    // Deprecated v1 payload retained solely for source/binary ABI stability.
    // Generic ray lighting does not interpret these values.
    float water[4];
} TWRayQueryLightingFrame;

// Version 2 is additive and leaves TWRayQueryLightingFrame's original ABI
// untouched. The direction points from the shaded surface toward the
// directional light. Angular radius is in radians; sample counts are explicit.
typedef struct TWRayQueryLightingFrameV2 {
    uint32_t struct_size;
    uint32_t command_encoder_handle;
    uint32_t color_texture_handle;
    uint32_t color_vulkan_layout;
    uint32_t depth_texture_handle;
    uint32_t depth_vulkan_layout;
    uint32_t width;
    uint32_t height;
    float inverse_view_projection[16];
    float camera_position[4];
    float directional_light_direction_intensity[4];
    float directional_visibility_strength;
    float ao_strength;
    float ao_radius;
    float directional_angular_radius;
    uint32_t flags;
    float max_distance;
    float ray_bias;
    uint32_t directional_sample_count;
    uint32_t ao_sample_count;
    uint32_t frame_index;
    uint32_t pipeline_handle;
} TWRayQueryLightingFrameV2;

// Additive reflection ABI. Keep separate from TWRayQueryLightingFrame so
// callers compiled against the original OP82 contract remain compatible.
typedef struct TWRayQueryReflectionFrame {
    uint32_t struct_size;
    uint32_t command_encoder_handle;
    uint32_t source_color_texture_handle;
    uint32_t source_color_vulkan_layout;
    uint32_t output_color_texture_handle;
    uint32_t output_color_vulkan_layout;
    uint32_t depth_texture_handle;
    uint32_t depth_vulkan_layout;
    uint32_t normal_roughness_texture_handle;
    uint32_t normal_roughness_vulkan_layout;
    uint32_t specular_albedo_texture_handle;
    uint32_t specular_albedo_vulkan_layout;
    uint32_t width;
    uint32_t height;
    float inverse_view_projection[16];
    float camera_position[4];
    // reflection strength, maximum distance, ray-origin bias, roughness cutoff.
    float parameters[4];
    // linear environment RGB and intensity for reflection misses.
    float environment[4];
    // bit 0: reverse/inverted depth; bit 1: include frame index in sample jitter.
    uint32_t flags;
    uint32_t frame_index;
} TWRayQueryReflectionFrame;

typedef struct TWRayQueryReflectionFrameV2 {
    uint32_t struct_size;
    uint32_t command_encoder_handle;
    uint32_t source_color_texture_handle;
    uint32_t source_color_vulkan_layout;
    uint32_t output_color_texture_handle;
    uint32_t output_color_vulkan_layout;
    uint32_t depth_texture_handle;
    uint32_t depth_vulkan_layout;
    uint32_t normal_roughness_texture_handle;
    uint32_t normal_roughness_vulkan_layout;
    uint32_t specular_albedo_texture_handle;
    uint32_t specular_albedo_vulkan_layout;
    uint32_t width;
    uint32_t height;
    float inverse_view_projection[16];
    float camera_position[4];
    float parameters[4];
    float environment[4];
    uint32_t flags;
    uint32_t frame_index;
    uint32_t pipeline_handle;
} TWRayQueryReflectionFrameV2;

// Additive reflection ABI with an optional storage texture containing the
// linear world-space primary specular-ray hit distance. A zero handle keeps
// the reflections-v1 descriptor contract and behavior.
typedef struct TWRayQueryReflectionFrameV3 {
    uint32_t struct_size;
    uint32_t command_encoder_handle;
    uint32_t source_color_texture_handle;
    uint32_t source_color_vulkan_layout;
    uint32_t output_color_texture_handle;
    uint32_t output_color_vulkan_layout;
    uint32_t depth_texture_handle;
    uint32_t depth_vulkan_layout;
    uint32_t normal_roughness_texture_handle;
    uint32_t normal_roughness_vulkan_layout;
    uint32_t specular_albedo_texture_handle;
    uint32_t specular_albedo_vulkan_layout;
    uint32_t width;
    uint32_t height;
    float inverse_view_projection[16];
    float camera_position[4];
    float parameters[4];
    float environment[4];
    uint32_t flags;
    uint32_t frame_index;
    uint32_t pipeline_handle;
    uint32_t specular_hit_distance_texture_handle;
    uint32_t specular_hit_distance_vulkan_layout;
} TWRayQueryReflectionFrameV3;

TW_API int tw_start(void* parent_hwnd, int x, int y, int w, int h);
TW_API void tw_set_standalone_ui(int on);
TW_API int tw_attach_host(void* parent_hwnd, int x, int y, int w, int h);
TW_API void tw_set_size(int w, int h);
TW_API void tw_set_vsync(int on);
TW_API void* tw_hwnd(void);
TW_API int tw_take_wheel_delta(void);
TW_API int tw_backlog(void);
TW_API int tw_content_offset_y(void);
TW_API void tw_set_overlay_window(void* hwnd);
TW_API void tw_set_overlay(int on);
TW_API void tw_set_loading(int on, const char* stage);
TW_API int tw_loading_visible(void);
TW_API int tw_overlay_open(void);
TW_API void tw_overlay_click(int x, int y);
TW_API void tw_overlay_pointer_move(int x, int y);
TW_API void tw_overlay_wheel(int delta);
TW_API int tw_take_display_command(int* enabled, int* width, int* height, int* refresh_hz);
TW_API void tw_set_fullscreen_state(int mode, int width, int height, int refresh_hz);
TW_API void tw_toggle_fps_overlay(void);
TW_API int tw_overlay_visible(void);
TW_API void tw_overlay_bounds(int canvas_width, int canvas_height,
                              int* left, int* top, int* width, int* height);
TW_API const uint8_t* tw_overlay_raster(int width, int height, int fps, int frame_us,
                                        const char* backend, int backlog, uint64_t packets,
                                        int* row_bytes);
TW_API uint64_t tw_overlay_revision(void);
// Present one caller-owned RGBA8 bitmap through the bounded native overlay
// texture. The bitmap is copied; pass visible=0 to release it.
TW_API int tw_canvas_overlay_set(int visible, int left, int top,
                                 int display_width, int display_height,
                                 int source_width, int source_height,
                                 const uint8_t* rgba_pixels, int row_bytes);
TW_API int tw_set_pointer_lock(int on);
TW_API int tw_poll_input(TWInputEvent* events, int capacity);
TW_API void tw_stats(int* fps, int* frame_us, int* width, int* height, int* vsync, uint64_t* presents);
TW_API int tw_is_open(void);
TW_API int tw_set_fullscreen(int mode, int width, int height, int refresh_hz);
TW_API void tw_shutdown(void);
TW_API void tw_reset(void);
TW_API const char* tw_last_error(void);
TW_API const char* tw_backend_name(void);
TW_API int tw_gpu_capabilities(TWGpuCapabilities* capabilities);
TW_API int tw_request_gpu_features(const TWGpuFeatureRequest* request);
TW_API int tw_gpu_feature_status(TWGpuFeatureStatus* status);
TW_API int tw_dlss_optimal_settings(const TWGpuFeatureRequest* request,
                                    TWDLSSOptimalSettings* settings);
TW_API int tw_dlss_evaluate(const TWDLSSFrame* frame);
TW_API int tw_dlss_nr_evaluate(const TWDLSSNRFrame* frame);
TW_API int tw_ray_reconstruction_evaluate(const TWRayReconstructionFrame* frame);
TW_API int tw_frame_generation_tag(const TWFrameGenerationFrame* frame);
TW_API int tw_frame_generation_status(TWFrameGenerationStatus* status);
TW_API void tw_dlss_release_viewport(uint32_t viewport);
TW_API int tw_set_reflex_mode(int mode);
TW_API int tw_reflex_mode(void);
TW_API int tw_ray_query_capabilities(TWRayQueryCapabilities* capabilities);
TW_API int tw_ray_query_scene_begin(void);
TW_API int tw_ray_query_scene_positions(const float* xyz, uint32_t vertex_count);
TW_API int tw_ray_query_scene_indices(const uint32_t* indices, uint32_t index_count);
TW_API int tw_ray_query_scene_triangle_radiance(const float* rgba,
                                                uint32_t triangle_count);
TW_API int tw_ray_query_scene_triangle_surface(const float* albedo_roughness,
                                               uint32_t triangle_count);
TW_API int tw_ray_query_scene_lights(const float* light_records,
                                     uint32_t light_count);
TW_API int tw_ray_query_scene_instance_group(uint32_t id, uint32_t capacity,
                                             uint32_t vertex_offset,
                                             uint32_t vertex_count,
                                             uint32_t index_offset,
                                             uint32_t index_count,
                                             uint32_t primitive_base);
TW_API int tw_ray_query_scene_commit(uint32_t command_encoder_handle);
TW_API int tw_ray_query_instance_group_update(uint32_t command_encoder_handle,
                                              uint32_t id,
                                              const float* matrices_3x4,
                                              const uint32_t* masks,
                                              uint32_t instance_count);
TW_API int tw_ray_query_dynamic_triangle_mesh_create(
    const TWRayQueryDynamicTriangleMeshFrame* frame,
    const uint32_t* indices, uint32_t index_count);
TW_API int tw_ray_query_dynamic_triangle_mesh_refit(
    const TWRayQueryDynamicTriangleMeshFrame* frame);
TW_API int tw_ray_query_dynamic_triangle_mesh_destroy(
    uint32_t command_encoder_handle, uint32_t mesh_handle);
TW_API void tw_ray_query_scene_destroy(void);
TW_API int tw_ray_query_lighting_evaluate(const TWRayQueryLightingFrame* frame);
TW_API int tw_ray_query_lighting_evaluate_v2(const TWRayQueryLightingFrameV2* frame);
TW_API int tw_ray_query_reflections_evaluate(const TWRayQueryReflectionFrame* frame);
TW_API int tw_ray_query_reflections_evaluate_v2(const TWRayQueryReflectionFrameV2* frame);
TW_API int tw_ray_query_reflections_evaluate_v3(const TWRayQueryReflectionFrameV3* frame);
TW_API int tw_ray_query_pipeline_create(uint32_t handle, uint32_t profile,
                                        const uint32_t* spirv_words,
                                        uint32_t spirv_byte_length,
                                        const char* entry_point,
                                        uint32_t entry_point_length);
TW_API int tw_ray_query_pipeline_create_glsl(uint32_t handle, uint32_t profile,
                                             const char* glsl_source,
                                             uint32_t glsl_source_byte_length,
                                             const char* entry_point,
                                             uint32_t entry_point_length);
TW_API int tw_ray_query_pipeline_destroy(uint32_t handle);
TW_API int tw_cmd_submit(const uint8_t* data, int nbytes);
TW_API int tw_map_read(uint32_t buffer_handle, uint64_t offset, uint64_t size, void* dst, int dst_bytes);

#ifdef __cplusplus
}
#endif
