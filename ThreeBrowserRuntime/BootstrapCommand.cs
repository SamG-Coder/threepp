namespace ThreeBrowserRuntime;

internal static class BootstrapCommand
{
    internal static async Task<int> RunAsync(
        IReadOnlyList<string> arguments,
        string runtimeDirectory,
        string nodeExecutable,
        CancellationToken cancellationToken = default)
    {
        if (arguments.Count == 0 || arguments[0] is "--help" or "-h")
        {
            PrintUsage();
            return arguments.Count == 0 ? 1 : 0;
        }

        try
        {
            var project = Path.GetFullPath(arguments[0], Environment.CurrentDirectory);
            var entry = Directory.Exists(project) ? Path.Combine(project, "site-entry.mjs") : project;
            var name = Directory.Exists(project)
                ? new DirectoryInfo(project).Name
                : new DirectoryInfo(Path.GetDirectoryName(project)!).Name;
            var destination = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "ThreeBrowser Exports");
            var mode = BootstrapPackageMode.SingleExecutable;
            string? icon = null;
            string? loading = null;
            var signing = BootstrapSigningMode.Unsigned;
            string? certificate = null;
            string? password = null;
            string? subject = null;
            string? timestamp = null;
            var keepProject = false;

            for (var index = 1; index < arguments.Count; index++)
            {
                string Value(string option)
                {
                    if (++index >= arguments.Count) throw new ArgumentException($"{option} requires a value.");
                    return arguments[index];
                }
                switch (arguments[index])
                {
                    case "--name": name = Value("--name"); break;
                    case "--output": destination = Path.GetFullPath(Value("--output"), Environment.CurrentDirectory); break;
                    case "--mode":
                        mode = Value("--mode").ToLowerInvariant() switch
                        {
                            "single" or "exe" => BootstrapPackageMode.SingleExecutable,
                            "portable" => BootstrapPackageMode.PortableDirectory,
                            var value => throw new ArgumentException($"Unknown export mode: {value}. Use single or portable."),
                        };
                        break;
                    case "--icon": icon = Path.GetFullPath(Value("--icon"), Environment.CurrentDirectory); break;
                    case "--loading-image": loading = Path.GetFullPath(Value("--loading-image"), Environment.CurrentDirectory); break;
                    case "--certificate":
                        if (signing == BootstrapSigningMode.SelfSigned)
                            throw new ArgumentException("Choose either --certificate or --self-signed, not both.");
                        certificate = Path.GetFullPath(Value("--certificate"), Environment.CurrentDirectory);
                        signing = BootstrapSigningMode.PfxCertificate;
                        break;
                    case "--certificate-password-env":
                        var variable = Value("--certificate-password-env");
                        password = Environment.GetEnvironmentVariable(variable)
                            ?? throw new ArgumentException($"Environment variable {variable} is not set.");
                        break;
                    case "--self-signed":
                        if (signing == BootstrapSigningMode.PfxCertificate)
                            throw new ArgumentException("Choose either --certificate or --self-signed, not both.");
                        subject = Value("--self-signed");
                        signing = BootstrapSigningMode.SelfSigned;
                        break;
                    case "--timestamp": timestamp = Value("--timestamp"); break;
                    case "--keep-project": keepProject = true; break;
                    default: throw new ArgumentException($"Unknown export option: {arguments[index]}");
                }
            }

            var options = new BootstrapExportOptions(name, destination, mode, icon, loading, signing,
                certificate, password, subject, timestamp, keepProject);
            var reporter = new ConsoleExportProgress();
            var exporter = new BootstrapExporter(runtimeDirectory, nodeExecutable);
            var result = await exporter.ExportAsync(entry, options, reporter, null, cancellationToken);
            Console.WriteLine($"Executable: {result.ExecutablePath}");
            if (result.CertificatePath is not null) Console.WriteLine($"Certificate: {result.CertificatePath}");
            if (result.GeneratedProjectPath is not null) Console.WriteLine($"Project: {result.GeneratedProjectPath}");
            return 0;
        }
        catch (OperationCanceledException)
        {
            Console.Error.WriteLine("Export cancelled.");
            return 2;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Export failed: {error.Message}");
            return 1;
        }
    }

    private static void PrintUsage()
    {
        Console.WriteLine("""
Usage:
  ThreeBrowserRuntime export <project-folder|site-entry.mjs> [options]

Options:
  --name <name>                       Application and executable name
  --output <folder>                   Export destination
  --mode <single|portable>            Embedded EXE or portable EXE folder
  --icon <ico|png|jpg|bmp>            Application icon
  --loading-image <png|jpg|bmp|gif>   Startup/shader loading image
  --certificate <pfx|p12>             Sign with an existing certificate
  --certificate-password-env <name>   Read the PFX password from an environment variable
  --self-signed <publisher>            Create and apply a self-signed certificate
  --timestamp <http(s)-url>            Optional Authenticode timestamp service
  --keep-project                       Retain the generated bootstrap source project
""");
    }

    private sealed class ConsoleExportProgress : IProgress<BootstrapExportProgress>
    {
        public void Report(BootstrapExportProgress item)
        {
            var prefix = item.Kind switch { "error" => "error: ", "warning" => "warning: ", _ => "" };
            Console.WriteLine(prefix + item.Message);
        }
    }
}
