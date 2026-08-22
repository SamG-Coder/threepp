using System.Runtime.InteropServices;
namespace ThreeBrowserRuntime;

internal static class NativeConsole
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeConsole();

    internal static void Detach() => FreeConsole();
}
