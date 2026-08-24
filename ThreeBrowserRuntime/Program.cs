using System.Diagnostics;
using System.Text.Json;
using ThreeBrowserRuntime;

if (args.Length == 0)
{    
    NativeConsole.Detach();
}

var projectDirectory = AppContext.BaseDirectory;
while (projectDirectory is not null && !File.Exists(Path.Combine(projectDirectory, "ThreeBrowserRuntime.csproj")))
{
    projectDirectory = Directory.GetParent(projectDirectory)?.FullName;
}

if (projectDirectory is null)
{
    var packagedDirectory = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    projectDirectory = File.Exists(Path.Combine(packagedDirectory, "build", "bin", "runtime", "launch.mjs"))
        ? packagedDirectory
        : null;
    if (projectDirectory is null)
    {
        Console.Error.WriteLine("Could not locate the ThreeBrowserRuntime runtime files.");
        return 1;
    }
}

var runtimeDirectory = Path.Combine(projectDirectory, "build", "bin");
var launcher = Path.Combine(runtimeDirectory, "runtime", "launch.mjs");
var sitePuller = Path.Combine(runtimeDirectory, "runtime", "site-puller.mjs");
var bundledNode = Path.Combine(projectDirectory, "node.exe");
var nodeExecutable = File.Exists(bundledNode) ? bundledNode : "node";
if (!File.Exists(launcher))
{
    Console.Error.WriteLine("The native runtime is missing. Run 'dotnet build' first.");
    return 1;
}

if (args.Length > 0 && (args[0].Equals("export", StringComparison.OrdinalIgnoreCase) ||
                        args[0].Equals("bootstrap", StringComparison.OrdinalIgnoreCase)))
{
    return await BootstrapCommand.RunAsync(args.Skip(1).ToArray(), runtimeDirectory, nodeExecutable);
}

if (args.Length == 0)
{
    var uiThread = new Thread(() =>
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new RuntimeLauncherForm(
            runtimeDirectory,
            sitePuller,
            launcher,
            Path.Combine(projectDirectory, "samples"),
            nodeExecutable));
    });
    uiThread.SetApartmentState(ApartmentState.STA);
    uiThread.Start();
    uiThread.Join();
    return 0;
}

if (args.Length > 0 && (args[0].Equals("pull", StringComparison.OrdinalIgnoreCase) ||
                        args[0].Equals("unpack", StringComparison.OrdinalIgnoreCase)))
{
    if (args.Length < 2)
    {
        Console.Error.WriteLine("Usage: dotnet run --project <ThreeBrowserRuntime.csproj> -- pull <https://site> [destination] [--force]");
        return 1;
    }
    if (!File.Exists(sitePuller))
    {
        Console.Error.WriteLine("The site puller is missing. Run 'dotnet build' first.");
        return 1;
    }

    var pull = new ProcessStartInfo(nodeExecutable)
    {
        UseShellExecute = false,
        WorkingDirectory = Environment.CurrentDirectory,
    };
    pull.ArgumentList.Add(sitePuller);
    foreach (var argument in args.Skip(1)) pull.ArgumentList.Add(argument);
    try
    {
        using var process = Process.Start(pull);
        if (process is null) throw new InvalidOperationException("Could not start Node/V8.");
        await process.WaitForExitAsync();
        return process.ExitCode;
    }
    catch (Exception error)
    {
        Console.Error.WriteLine($"Could not pull website: {error.Message}");
        return 1;
    }
}

static void CopyTree(string source, string destination)
{
    Directory.CreateDirectory(destination);
    foreach (var directory in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories))
    {
        Directory.CreateDirectory(Path.Combine(destination, Path.GetRelativePath(source, directory)));
    }
    foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
    {
        var target = Path.Combine(destination, Path.GetRelativePath(source, file));
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        File.Copy(file, target, overwrite: true);
    }
}

static string ImportVirtualPage(string projectDirectory, string address)
{
    if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) ||
        !uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) ||
        !uri.Host.Equals("threebrowser.local", StringComparison.OrdinalIgnoreCase))
    {
        throw new ArgumentException("Import expects an https://threebrowser.local/... URL.");
    }

    var webRoot = Path.GetFullPath(Path.Combine(projectDirectory, "..", "host", "ThreeBrowser", "web"));
    var relativePath = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
    var sourceEntry = Path.GetFullPath(Path.Combine(webRoot, relativePath));
    var webBoundary = webRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    if (!sourceEntry.StartsWith(webBoundary, StringComparison.OrdinalIgnoreCase) || !File.Exists(sourceEntry))
    {
        throw new FileNotFoundException("The virtual page does not exist in the ThreeBrowser web root.", sourceEntry);
    }

    var sourceDirectory = Path.GetDirectoryName(sourceEntry)!;
    var projectName = new DirectoryInfo(sourceDirectory).Name;
    var destination = Path.Combine(projectDirectory, "projects", projectName);
    CopyTree(sourceDirectory, destination);
    var destinationEntry = Path.Combine(destination, Path.GetRelativePath(sourceDirectory, sourceEntry));
    File.WriteAllText(Path.Combine(destination, ".threebrowser-project.json"), JsonSerializer.Serialize(new
    {
        source = address,
        entry = Path.GetRelativePath(destination, destinationEntry).Replace('\\', '/'),
    }, new JsonSerializerOptions { WriteIndented = true }));
    Console.WriteLine($"Imported {address}");
    Console.WriteLine($"Project: {destination}");
    return destinationEntry;
}

string entry;
if (args.Length > 0 && args[0].Equals("import", StringComparison.OrdinalIgnoreCase))
{
    if (args.Length < 2)
    {
        Console.Error.WriteLine("Usage: dotnet run -- import https://threebrowser.local/path/index.html");
        return 1;
    }
    entry = ImportVirtualPage(projectDirectory, args[1]);
}
else if (args.Length > 0 && Uri.TryCreate(args[0], UriKind.Absolute, out var address) &&
         address.Host.Equals("threebrowser.local", StringComparison.OrdinalIgnoreCase))
{
    entry = ImportVirtualPage(projectDirectory, args[0]);
}
else
{
    entry = args.Length > 0
        ? Path.GetFullPath(args[0], Environment.CurrentDirectory)
        : Path.Combine(runtimeDirectory, "demo", "cubes.mjs");
}

var startInfo = new ProcessStartInfo(nodeExecutable)
{
    UseShellExecute = false,
    WorkingDirectory = runtimeDirectory,
};
startInfo.ArgumentList.Add(launcher);
startInfo.ArgumentList.Add(entry);

try
{
    using var runtime = Process.Start(startInfo);
    if (runtime is null)
    {
        Console.Error.WriteLine("Could not start Node/V8.");
        return 1;
    }
    await runtime.WaitForExitAsync();
    return runtime.ExitCode;
}
catch (Exception error)
{
    Console.Error.WriteLine($"Could not launch ThreeBrowserRuntime: {error.Message}");
    return 1;
}
