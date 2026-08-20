using System.Runtime.InteropServices;

namespace ThreeBrowser;

internal static partial class Native
{
    private const string Dll = "three_native.dll";

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr tn_last_error();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr tn_backend_name();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern int tn_runtime_start(int width, int height, string title);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_runtime_is_open();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_runtime_set_size(int width, int height);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_runtime_set_vsync(int enabled);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_runtime_render(uint scene, uint camera);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_runtime_shutdown();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_runtime_reset();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern float tn_runtime_aspect();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_scene_create();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_scene_set_background(uint scene, uint hex);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_perspective_camera_create(float fov, float aspect, float nearPlane, float farPlane);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_camera_set_aspect(uint camera, float aspect);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_box_geometry_create(float width, float height, float depth);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_plane_geometry_create(float width, float height, int widthSegments, int heightSegments);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_sphere_geometry_create(float radius, int widthSegments, int heightSegments);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_cylinder_geometry_create(
        float radiusTop, float radiusBottom, float height, int radialSegments, int heightSegments);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_mesh_standard_material_create(uint color);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_mesh_basic_material_create(uint color);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_mesh_create(uint geometry, uint material);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_group_create();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_hemisphere_light_create();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_point_light_create(uint color, float intensity);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_object_add(uint parent, uint child);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_object_set_position(uint obj, float x, float y, float z);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_object_set_rotation(uint obj, float x, float y, float z);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_runtime_attach_host(IntPtr parentHwnd, int x, int y, int width, int height);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr tn_runtime_hwnd();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_cmd_submit(IntPtr data, int nbytes);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_frame_info(out int width, out int height, out ulong generation);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_frame_copy(
        byte[] dst,
        int maxBytes,
        out int width,
        out int height,
        out ulong generation);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_camera_update_projection_matrix(uint camera);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_object_set_scale(uint obj, float x, float y, float z);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_object_look_at(uint obj, float x, float y, float z);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_object_look_from(
        uint obj, float x, float y, float z, float tx, float ty, float tz);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_ambient_light_create(uint color, float intensity);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_directional_light_create(uint color, float intensity);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_renderer_set_tone_mapping(int mode, float exposure);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern uint tn_gltf_load(string path);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_gltf_clip_count(uint obj);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_mixer_create(uint root);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_mixer_play(uint mixer, int clipIndex);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_mixer_update(uint mixer, float dt);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_torus_knot_geometry_create(
        float radius, float tube, int tubular, int radial, int p, int q);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_material_set_pbr(uint material, float metalness, float roughness);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_instanced_mesh_create(uint geometry, uint material, int count);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_instanced_fill_grid(uint mesh, float spacing);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_buffer_geometry_create(
        float[] pos, int posFloats,
        float[] nrm, int nrmFloats,
        float[] uv, int uvFloats,
        uint[] idx, int idxCount);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_mesh_lambert_material_create(uint color);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_material_set_side(uint material, int side);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_material_set_map(uint material, uint texture);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_material_set_map_slot(uint material, int slot, uint texture);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_texture_from_rgba(int width, int height, byte[] rgba, int nbytes);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_texture_set_filter(uint texture, int mag, int min);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern void tn_shader_uniform_float(uint material, string name, float v);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern void tn_shader_uniform_vec2(uint material, string name, float x, float y);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern void tn_shader_uniform_vec3(uint material, string name, float x, float y, float z);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern void tn_shader_uniform_vec4(uint material, string name, float x, float y, float z, float w);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_shader_set_flags(uint material, int side, int depthWrite);

    public static string LastError()
    {
        var p = tn_last_error();
        return p == IntPtr.Zero ? "" : Marshal.PtrToStringAnsi(p) ?? "";
    }

    public static string BackendName()
    {
        var p = tn_backend_name();
        return p == IntPtr.Zero ? "" : Marshal.PtrToStringAnsi(p) ?? "";
    }
}
