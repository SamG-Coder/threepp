using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ThreeBrowser;

[ComVisible(true)]
[ClassInterface(ClassInterfaceType.AutoDual)]
public partial class NativeBridge
{
    private readonly MainForm _form;

    public NativeBridge(MainForm form)
    {
        _form = form;
    }

    public string BackendName() => Native.BackendName();

    public string LastError() => Native.LastError();

    public int RuntimeStart(int width, int height, string title)
    {
        var ok = Native.tn_runtime_start(width, height, title ?? "ThreeBrowser");
        if (ok != 0)
        {
            _form.ApplyNativeVsync();
            _form.BeginInvoke((MethodInvoker)(() =>
            {
                _form.SyncBackendFromNative();
                _form.EmbedNativeSurface();
            }));
        }
        return ok;
    }

    // three/webgpu: prefer three_webgpu.dll command-ring present. If the DLL is
    // missing or tw_start fails, stock WebGPURenderer still presents through
    // Chromium Dawn. The GL HWND overlay stays off in both cases.
    public int RuntimeStartWebGpu()
    {
        var native = false;
        try
        {
            native = _form.TryStartNativeWebGpu();
        }
        catch (DllNotFoundException)
        {
        }
        catch (EntryPointNotFoundException)
        {
        }

        _form.BeginWebGpuBypass(native);
        if (native)
        {
            _form.ApplyNativeVsync();
            _form.BeginInvoke((MethodInvoker)(() => _form.EmbedNativeSurface()));
        }
        return 1;
    }

    public void WebGpuFrame(int fps, int width, int height)
    {
        _form.NoteWebGpuFrame(fps, width, height);
    }

    public int WebGpuIsNative() => NativeWebGpu.IsOpen() ? 1 : 0;

    public int WebGpuCmdSubmit(int nbytes) => _form.SubmitWebGpuCmd(nbytes);

    public string WebGpuMapRead(int handle, double offset, double size)
    {
        if (handle == 0 ||
            double.IsNaN(offset) || double.IsInfinity(offset) || offset < 0 ||
            double.IsNaN(size) || double.IsInfinity(size) || size <= 0)
        {
            return "";
        }
        var n = (long)size;
        if (n <= 0 || n > 64L * 1024 * 1024)
        {
            return "";
        }
        var buf = new byte[(int)n];
        try
        {
            var got = NativeWebGpu.tw_map_read(handle, (ulong)offset, (ulong)n, buf, buf.Length);
            if (got <= 0)
            {
                return "";
            }
            if (got > 0 && got < buf.Length)
            {
                return Convert.ToBase64String(buf, 0, got);
            }
            return Convert.ToBase64String(buf);
        }
        catch (DllNotFoundException)
        {
            return "";
        }
        catch (EntryPointNotFoundException)
        {
            return "";
        }
    }

    public void WebGpuSetSize(int w, int h)
    {
        try
        {
            NativeWebGpu.tw_set_size(Math.Max(1, w), Math.Max(1, h));
        }
        catch (DllNotFoundException)
        {
        }
        catch (EntryPointNotFoundException)
        {
        }
    }

    public string WebGpuBackendName() => NativeWebGpu.BackendName();

    public int RuntimeIsOpen() => Native.tn_runtime_is_open();

    public void RuntimeSetSize(int width, int height) =>
        Native.tn_runtime_set_size(width, height);

    public int RuntimeRender(int scene, int camera) =>
        Native.tn_runtime_render((uint)scene, (uint)camera);

    public void RuntimeShutdown() => _form.BeginInvoke(_form.ShutdownNative);

    public void RuntimeReset() => _form.BeginInvoke(_form.ResetNative);

    public double RuntimeAspect() => Native.tn_runtime_aspect();

    public int SceneCreate() => (int)Native.tn_scene_create();

    public void SceneSetBackground(int scene, int hex) =>
        Native.tn_scene_set_background((uint)scene, (uint)hex);

    public int PerspectiveCameraCreate(double fov, double aspect, double nearPlane, double farPlane) =>
        (int)Native.tn_perspective_camera_create((float)fov, (float)aspect, (float)nearPlane, (float)farPlane);

    public void CameraSetAspect(int camera, double aspect) =>
        Native.tn_camera_set_aspect((uint)camera, (float)aspect);

    public int BoxGeometryCreate(double width, double height, double depth) =>
        (int)Native.tn_box_geometry_create((float)width, (float)height, (float)depth);

    public int PlaneGeometryCreate(double width, double height, int widthSegments, int heightSegments) =>
        (int)Native.tn_plane_geometry_create((float)width, (float)height, widthSegments, heightSegments);

    public int SphereGeometryCreate(double radius, int widthSegments, int heightSegments) =>
        (int)Native.tn_sphere_geometry_create((float)radius, widthSegments, heightSegments);

    public int CylinderGeometryCreate(
        double radiusTop, double radiusBottom, double height, int radialSegments, int heightSegments) =>
        (int)Native.tn_cylinder_geometry_create(
            (float)radiusTop, (float)radiusBottom, (float)height, radialSegments, heightSegments);

    public int MeshStandardMaterialCreate(int color) =>
        (int)Native.tn_mesh_standard_material_create((uint)color);

    public int MeshBasicMaterialCreate(int color) =>
        (int)Native.tn_mesh_basic_material_create((uint)color);

    public int MeshNormalMaterialCreate() =>
        (int)Native.tn_mesh_normal_material_create();

    public int MeshCreate(int geometry, int material) =>
        (int)Native.tn_mesh_create((uint)geometry, (uint)material);

    public int GroupCreate() => (int)Native.tn_group_create();

    public int HemisphereLightCreate() => (int)Native.tn_hemisphere_light_create();

    public int PointLightCreate(int color, double intensity) =>
        (int)Native.tn_point_light_create((uint)color, (float)intensity);

    public int ObjectAdd(int parent, int child) =>
        Native.tn_object_add((uint)parent, (uint)child);

    public void ObjectRemove(int parent, int child) =>
        Native.tn_object_remove((uint)parent, (uint)child);

    public void SlotDestroy(int id) => Native.tn_slot_destroy((uint)id);

    public int ObjectSetVisible(int obj, int visible) =>
        Native.tn_object_set_visible((uint)obj, visible);

    public void MaterialSetVisible(int material, int visible) =>
        Native.tn_material_set_visible((uint)material, visible);

    public int ObjectSetPosition(int obj, double x, double y, double z) =>
        Native.tn_object_set_position((uint)obj, (float)x, (float)y, (float)z);

    public int ObjectSetRotation(int obj, double x, double y, double z) =>
        Native.tn_object_set_rotation((uint)obj, (float)x, (float)y, (float)z);

    public int ObjectSetScale(int obj, double x, double y, double z) =>
        Native.tn_object_set_scale((uint)obj, (float)x, (float)y, (float)z);

    public int ObjectLookAt(int obj, double x, double y, double z) =>
        Native.tn_object_look_at((uint)obj, (float)x, (float)y, (float)z);

    public void ObjectLookFrom(int obj, double x, double y, double z, double tx, double ty, double tz) =>
        Native.tn_object_look_from((uint)obj, (float)x, (float)y, (float)z, (float)tx, (float)ty, (float)tz);

    public void CameraUpdateProjectionMatrix(int camera) =>
        Native.tn_camera_update_projection_matrix((uint)camera);

    public int AmbientLightCreate(int color, double intensity) =>
        (int)Native.tn_ambient_light_create((uint)color, (float)intensity);

    public int DirectionalLightCreate(int color, double intensity) =>
        (int)Native.tn_directional_light_create((uint)color, (float)intensity);

    public void RendererSetToneMapping(int mode, double exposure) =>
        Native.tn_renderer_set_tone_mapping(mode, (float)exposure);

    public int TorusKnotGeometryCreate(
        double radius, double tube, int tubular, int radial, int p, int q) =>
        (int)Native.tn_torus_knot_geometry_create(
            (float)radius, (float)tube, tubular, radial, p, q);

    public void MaterialSetPbr(int material, double metalness, double roughness) =>
        Native.tn_material_set_pbr((uint)material, (float)metalness, (float)roughness);

    public int InstancedMeshCreate(int geometry, int material, int count) =>
        (int)Native.tn_instanced_mesh_create((uint)geometry, (uint)material, count);

    public int BufferGeometryCreate(string posB64, string nrmB64, string uvB64, string idxB64)
    {
        var pos = FromBase64Floats(posB64);
        var nrm = FromBase64Floats(nrmB64);
        var uv = FromBase64Floats(uvB64);
        var idx = FromBase64Uints(idxB64);
        return (int)Native.tn_buffer_geometry_create(
            pos, pos.Length, nrm, nrm.Length, uv, uv.Length, idx, idx.Length);
    }

    public int MeshLambertMaterialCreate(int color) =>
        (int)Native.tn_mesh_lambert_material_create((uint)color);

    public void MaterialSetSide(int material, int side) =>
        Native.tn_material_set_side((uint)material, side);

    public void MaterialSetMap(int material, int texture) =>
        Native.tn_material_set_map((uint)material, (uint)texture);

    public int TextureFromRgba(int width, int height, string rgbaB64)
    {
        var bytes = string.IsNullOrEmpty(rgbaB64) ? [] : Convert.FromBase64String(rgbaB64);
        return (int)Native.tn_texture_from_rgba(width, height, bytes, bytes.Length);
    }

    public void TextureSetFilter(int texture, int mag, int min) =>
        Native.tn_texture_set_filter((uint)texture, mag, min);

    public int InstancedFillGrid(int mesh, double spacing) =>
        Native.tn_instanced_fill_grid((uint)mesh, (float)spacing);

    private static float[] FromBase64Floats(string? b64)
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

    private static uint[] FromBase64Uints(string? b64)
    {
        if (string.IsNullOrEmpty(b64))
        {
            return [];
        }
        var bytes = Convert.FromBase64String(b64);
        var ints = new uint[bytes.Length / 4];
        Buffer.BlockCopy(bytes, 0, ints, 0, ints.Length * 4);
        return ints;
    }
}
