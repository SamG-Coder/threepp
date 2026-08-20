namespace ThreeBrowser;

public partial class NativeBridge
{
    public int LineCreate(int geometry, int material) =>
        (int)Native.tn_line_create((uint)geometry, (uint)material);

    public int LineSegmentsCreate(int geometry, int material) =>
        (int)Native.tn_line_segments_create((uint)geometry, (uint)material);

    public int LineLoopCreate(int geometry, int material) =>
        (int)Native.tn_line_loop_create((uint)geometry, (uint)material);

    public int LineBasicMaterialCreate(int color, double linewidth) =>
        (int)Native.tn_line_basic_material_create((uint)color, (float)linewidth);

    public int PointsCreate(int geometry, int material) =>
        (int)Native.tn_points_create((uint)geometry, (uint)material);

    public int PointsMaterialCreate(int color, double size) =>
        (int)Native.tn_points_material_create((uint)color, (float)size);

    public int SpriteCreate(int material) =>
        (int)Native.tn_sprite_create((uint)material);

    public int SpriteMaterialCreate(int color) =>
        (int)Native.tn_sprite_material_create((uint)color);

    public int BoneCreate() => (int)Native.tn_bone_create();

    public int SkeletonCreate(string boneCsv)
    {
        var bones = ParseBoneCsv(boneCsv);
        return (int)Native.tn_skeleton_create(bones, bones.Length);
    }

    public int SkeletonSetInverses(int skeleton, string inversesB64)
    {
        var inverses = DecodeBase64Floats(inversesB64);
        return Native.tn_skeleton_set_inverses((uint)skeleton, inverses, inverses.Length);
    }

    public int SkinnedMeshCreate(int geometry, int material) =>
        (int)Native.tn_skinned_mesh_create((uint)geometry, (uint)material);

    public int SkinnedBind(int mesh, int skeleton) =>
        Native.tn_skinned_bind((uint)mesh, (uint)skeleton);

    public int MeshSetMaterial(int mesh, int material) =>
        Native.tn_mesh_set_material((uint)mesh, (uint)material);

    public int CubeRtCreate(int id, int size) =>
        (int)Native.tn_cube_rt_create((uint)id, size);

    public void CubeRtUpdate(
        int cubeRt, int scene, double x, double y, double z, double nearPlane, double farPlane) =>
        Native.tn_cube_rt_update(
            (uint)cubeRt,
            (uint)scene,
            (float)x,
            (float)y,
            (float)z,
            (float)nearPlane,
            (float)farPlane);

    public int AxesHelperCreate(double size) =>
        (int)Native.tn_axes_helper_create((float)size);

    public int GridHelperCreate(double size, int divisions, int color1, int color2) =>
        (int)Native.tn_grid_helper_create((float)size, divisions, (uint)color1, (uint)color2);

    public int BoxHelperCreate(int obj) =>
        (int)Native.tn_box_helper_create((uint)obj);

    public int ArrowHelperCreate(double dx, double dy, double dz, double length, int color) =>
        (int)Native.tn_arrow_helper_create((float)dx, (float)dy, (float)dz, (float)length, (uint)color);

    public int OrthographicCameraCreate(
        double left, double right, double top, double bottom, double nearPlane, double farPlane) =>
        (int)Native.tn_orthographic_camera_create(
            (float)left, (float)right, (float)top, (float)bottom, (float)nearPlane, (float)farPlane);

    public void OrthographicCameraUpdate(
        int camera, double left, double right, double top, double bottom,
        double nearPlane, double farPlane, double zoom) =>
        Native.tn_orthographic_camera_update(
            (uint)camera, (float)left, (float)right, (float)top, (float)bottom,
            (float)nearPlane, (float)farPlane, (float)zoom);

    public int SpotLightCreate(
        int color, double intensity, double distance, double angle, double penumbra, double decay) =>
        (int)Native.tn_spot_light_create(
            (uint)color, (float)intensity, (float)distance, (float)angle, (float)penumbra, (float)decay);

    public void SceneSetFog(int scene, int color, double nearPlane, double farPlane) =>
        Native.tn_scene_set_fog((uint)scene, (uint)color, (float)nearPlane, (float)farPlane);

    public void SceneSetFogExp2(int scene, int color, double density) =>
        Native.tn_scene_set_fog_exp2((uint)scene, (uint)color, (float)density);

    public int InstancedSetMatrixAt(int mesh, int index, string elementsB64)
    {
        var elements = DecodeBase64Floats(elementsB64);
        return Native.tn_instanced_set_matrix_at((uint)mesh, index, elements);
    }

    public int InstancedSetColorAt(int mesh, int index, int hex) =>
        Native.tn_instanced_set_color_at((uint)mesh, index, (uint)hex);

    public int LodCreate() => (int)Native.tn_lod_create();

    public int LodAddLevel(int lod, int obj, double distance) =>
        Native.tn_lod_add_level((uint)lod, (uint)obj, (float)distance);

    public void LodUpdate(int lod, int camera) =>
        Native.tn_lod_update((uint)lod, (uint)camera);

    public int ShaderMaterialCreate(string vertexSrc, string fragmentSrc) =>
        (int)Native.tn_shader_material_create(vertexSrc ?? "", fragmentSrc ?? "");

    public void ShaderMaterialSetSource(int material, string vertexSrc, string fragmentSrc) =>
        Native.tn_shader_material_set_source((uint)material, vertexSrc ?? "", fragmentSrc ?? "");

    public void MaterialSetMapSlot(int material, int slot, int texture) =>
        Native.tn_material_set_map_slot((uint)material, slot, (uint)texture);

    public void BufferGeometrySetAttr(int geometry, string name, int itemSize, string f32B64)
    {
        var data = DecodeBase64Floats(f32B64);
        Native.tn_buffer_geometry_set_attr((uint)geometry, name ?? "", itemSize, data, data.Length);
    }

    public void ShaderUniformFloat(int material, string name, double v) =>
        Native.tn_shader_uniform_float((uint)material, name ?? "", (float)v);

    public void ShaderUniformVec2(int material, string name, double x, double y) =>
        Native.tn_shader_uniform_vec2((uint)material, name ?? "", (float)x, (float)y);

    public void ShaderUniformVec3(int material, string name, double x, double y, double z) =>
        Native.tn_shader_uniform_vec3((uint)material, name ?? "", (float)x, (float)y, (float)z);

    public void ShaderUniformVec4(int material, string name, double x, double y, double z, double w) =>
        Native.tn_shader_uniform_vec4((uint)material, name ?? "", (float)x, (float)y, (float)z, (float)w);

    public void ShaderSetFlags(int material, int side, int depthWrite) =>
        Native.tn_shader_set_flags((uint)material, side, depthWrite);

    public void SceneSetEnvironment(int scene, int texture) =>
        Native.tn_scene_set_environment((uint)scene, (uint)texture);

    public int PmremFromSky(
        int id,
        double sunX, double sunY, double sunZ,
        double turbidity, double rayleigh,
        double mieCoefficient, double mieDirectionalG) =>
        (int)Native.tn_pmrem_from_sky(
            (uint)id,
            (float)sunX, (float)sunY, (float)sunZ,
            (float)turbidity, (float)rayleigh,
            (float)mieCoefficient, (float)mieDirectionalG);

    public int PmremFromEquirect(int id, int texture) =>
        (int)Native.tn_pmrem_from_equirect((uint)id, (uint)texture);

    public int PmremFromCubemap(int id, int texture) =>
        (int)Native.tn_pmrem_from_cubemap((uint)id, (uint)texture);

    public int PmremFromObject(int id, int obj) =>
        (int)Native.tn_pmrem_from_object((uint)id, (uint)obj);

    private static float[] DecodeBase64Floats(string? b64)
    {
        if (string.IsNullOrEmpty(b64))
        {
            return [];
        }
        var bytes = Convert.FromBase64String(b64);
        var floats = new float[bytes.Length / 4];
        Buffer.BlockCopy(bytes, 0, floats, 0, floats.Length * 4);
        return floats;
    }

    private static uint[] ParseBoneCsv(string? boneCsv)
    {
        if (string.IsNullOrWhiteSpace(boneCsv))
        {
            return [];
        }
        var parts = boneCsv.Split(',');
        var bones = new uint[parts.Length];
        for (var i = 0; i < parts.Length; i++)
        {
            bones[i] = uint.TryParse(parts[i].Trim(), out var id) ? id : 0;
        }
        return bones;
    }
}
