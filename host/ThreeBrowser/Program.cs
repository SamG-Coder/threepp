namespace ThreeBrowser;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        var log = Path.Combine(Path.GetTempPath(), "ThreeBrowser-crash.log");
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => File.WriteAllText(log, e.Exception.ToString());
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            File.WriteAllText(log, e.ExceptionObject?.ToString() ?? "unknown");
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
