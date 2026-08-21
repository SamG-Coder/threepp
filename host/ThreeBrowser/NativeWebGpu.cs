using System.Runtime.InteropServices;

namespace ThreeBrowser;

internal static class NativeWebGpu
{
    private const string Dll = "three_webgpu.dll";

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tw_start(IntPtr parentHwnd, int x, int y, int w, int h);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tw_attach_host(IntPtr parentHwnd, int x, int y, int w, int h);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tw_set_size(int w, int h);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tw_set_vsync(int on);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr tw_hwnd();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tw_stats(
        out int fps, out int frameUs, out int width, out int height, out int vsync, out ulong presents);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tw_is_open();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tw_shutdown();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern void tw_reset();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr tw_last_error();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr tw_backend_name();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    public static extern int tw_cmd_submit(IntPtr data, int nbytes);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    private static extern int tw_map_read(
        uint handle, ulong offset, ulong size, IntPtr dst, int dstBytes);

    public static bool IsOpen()
    {
        try
        {
            return tw_is_open() != 0;
        }
        catch (DllNotFoundException)
        {
            return false;
        }
        catch (EntryPointNotFoundException)
        {
            return false;
        }
    }

    public static string BackendName()
    {
        try
        {
            var p = tw_backend_name();
            return p == IntPtr.Zero ? "" : (Marshal.PtrToStringAnsi(p) ?? "");
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

    public static string LastError()
    {
        try
        {
            var p = tw_last_error();
            return p == IntPtr.Zero ? "" : (Marshal.PtrToStringAnsi(p) ?? "");
        }
        catch
        {
            return "";
        }
    }

    public static int tw_map_read(int handle, ulong offset, ulong size, byte[] dst, int dstBytes)
    {
        if (dst == null || dstBytes <= 0)
        {
            return 0;
        }
        var pin = GCHandle.Alloc(dst, GCHandleType.Pinned);
        try
        {
            return tw_map_read((uint)handle, offset, size, pin.AddrOfPinnedObject(), dstBytes);
        }
        finally
        {
            pin.Free();
        }
    }
}
