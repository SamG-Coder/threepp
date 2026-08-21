using System.Runtime.InteropServices;

namespace ThreeBrowser;

internal static partial class Native
{
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_line_create(uint geometry, uint material);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_line_segments_create(uint geometry, uint material);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_line_loop_create(uint geometry, uint material);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_line_basic_material_create(uint color, float linewidth);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_points_create(uint geometry, uint material);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_points_material_create(uint color, float size);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_sprite_create(uint material);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_sprite_material_create(uint color);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_bone_create();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_skeleton_create(uint[] bones, int count);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_skeleton_set_inverses(uint skeleton, float[] inverses, int inverseCount);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_skinned_mesh_create(uint geometry, uint material);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_skinned_bind(uint mesh, uint skeleton);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_mesh_set_material(uint mesh, uint material);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_cube_rt_create(uint id, int size);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_cube_rt_update(
        uint cubeRt, uint scene, float x, float y, float z, float nearPlane, float farPlane);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_axes_helper_create(float size);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_grid_helper_create(float size, int divisions, uint color1, uint color2);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_box_helper_create(uint obj);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_arrow_helper_create(float dx, float dy, float dz, float length, uint color);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_orthographic_camera_create(
        float left, float right, float top, float bottom, float nearPlane, float farPlane);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_orthographic_camera_update(
        uint camera, float left, float right, float top, float bottom,
        float nearPlane, float farPlane, float zoom);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_spot_light_create(
        uint color, float intensity, float distance, float angle, float penumbra, float decay);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_scene_set_fog(uint scene, uint color, float nearPlane, float farPlane);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_scene_set_fog_exp2(uint scene, uint color, float density);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_instanced_set_matrix_at(uint mesh, int index, float[] elements16);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_instanced_set_color_at(uint mesh, int index, uint hex);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_instanced_set_count(uint mesh, int count);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_lod_create();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tn_lod_add_level(uint lod, uint obj, float distance);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_lod_update(uint lod, uint camera);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern uint tn_shader_material_create(string vertexSrc, string fragmentSrc);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern void tn_shader_material_set_source(uint material, string vertexSrc, string fragmentSrc);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tn_scene_set_environment(uint scene, uint texture);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_pmrem_from_sky(
        uint id,
        float sunX, float sunY, float sunZ,
        float turbidity, float rayleigh,
        float mieCoefficient, float mieDirectionalG);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_pmrem_from_equirect(uint id, uint texture);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_pmrem_from_cubemap(uint id, uint texture);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern uint tn_pmrem_from_object(uint id, uint obj);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern void tn_buffer_geometry_set_attr(
        uint geometry, string name, int itemSize, float[] data, int floatCount);
}
