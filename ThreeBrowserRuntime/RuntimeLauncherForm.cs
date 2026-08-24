using System.Diagnostics;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ThreeBrowserRuntime;

internal sealed partial class RuntimeLauncherForm : Form
{
    private readonly string _runtimeDirectory;
    private readonly string _sitePuller;
    private readonly string _launcher;
    private readonly string _samplesDirectory;
    private readonly string _nodeExecutable;
    private readonly WebView2 _view = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(247, 248, 250) };
    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly ConcurrentQueue<(string Text, string Kind)> _pendingLines = new();
    private readonly System.Windows.Forms.Timer _outputTimer = new() { Interval = 32 };
    private Process? _activeProcess;
    private CancellationTokenSource? _operation;
    private string? _destination;
    private bool _running;
    private bool _flushingLines;
    private string _lastErrorOutput = "";

    internal RuntimeLauncherForm(string runtimeDirectory, string sitePuller, string launcher, string samplesDirectory, string nodeExecutable)
    {
        _runtimeDirectory = runtimeDirectory;
        _sitePuller = sitePuller;
        _launcher = launcher;
        _samplesDirectory = samplesDirectory;
        _nodeExecutable = nodeExecutable;
        Text = "ThreeBrowser Runtime";
        Width = 1040;
        Height = 720;
        MinimumSize = new Size(760, 560);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(247, 248, 250);
        AutoScaleMode = AutoScaleMode.Dpi;
        Controls.Add(_view);
        _outputTimer.Tick += async (_, _) => await FlushOutputAsync();
        Shown += async (_, _) => await InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        try
        {
            await _view.EnsureCoreWebView2Async();
            _view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            _view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            _view.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _view.CoreWebView2.Settings.IsZoomControlEnabled = false;
            _view.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            _view.NavigationCompleted += (_, _) =>
            {
                _ready.TrySetResult();
                _outputTimer.Start();
                _ = RestoreHistoryAsync();
                _ = RefreshLibraryAsync();
            };
            _view.NavigateToString(PageHtml);
        }
        catch (Exception error)
        {
            MessageBox.Show(this, $"Could not initialize the launcher UI.\n\n{error.Message}", Text,
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var root = message.RootElement;
            switch (root.GetProperty("action").GetString())
            {
                case "run": await RunAsync(root.GetProperty("url").GetString() ?? ""); break;
                case "stop": StopActiveOperation(); break;
                case "open": OpenProject(); break;
                case "libraryRefresh": await RefreshLibraryAsync(); break;
                case "libraryLaunch": await LaunchLibraryItemAsync(root.GetProperty("id").GetString() ?? "", false); break;
                case "demoLaunch": await LaunchLibraryItemAsync(root.GetProperty("id").GetString() ?? "", true); break;
                case "libraryOpen": OpenLibraryItem(root.GetProperty("id").GetString() ?? "", false); break;
                case "demoOpen": OpenLibraryItem(root.GetProperty("id").GetString() ?? "", true); break;
                case "libraryRename": await RenameLibraryItemAsync(
                    root.GetProperty("id").GetString() ?? "",
                    root.GetProperty("name").GetString() ?? ""); break;
                case "libraryDelete": await DeleteLibraryItemAsync(root.GetProperty("id").GetString() ?? ""); break;
                case "bootstrapOpen": await OpenBootstrapAsync(root.GetProperty("id").GetString() ?? ""); break;
                case "bootstrapOpenCurrent": await OpenCurrentBootstrapAsync(); break;
                case "bootstrapPick": await PickBootstrapAssetAsync(root.GetProperty("kind").GetString() ?? ""); break;
                case "bootstrapBuild": await BuildBootstrapAsync(root); break;
                case "bootstrapReveal": await RevealBootstrapAsync(); break;
                case "bootstrapRun": await RunBootstrapAsync(); break;
            }
        }
        catch (Exception error)
        {
            await AppendAsync($"Launcher message error: {error.Message}", "error");
            await InvokeUiAsync("notify", error.Message, "error");
        }
    }

    private async Task RunAsync(string rawAddress)
    {
        if (_running) return;
        rawAddress = rawAddress.Trim();
        if (!Uri.TryCreate(rawAddress, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            await StatusAsync("Enter a complete HTTP or HTTPS URL.", "error");
            await InvokeUiAsync("focusAddress");
            return;
        }
        if (!File.Exists(_sitePuller))
        {
            await StatusAsync("The site unpacker is missing. Build the project first.", "error");
            return;
        }

        _destination = GetDestination(uri);
        SaveHistory(rawAddress);
        while (_pendingLines.TryDequeue(out _)) { }
        _operation = new CancellationTokenSource();
        SetRunning(true);
        await InvokeUiAsync("begin", rawAddress, _destination);
        await StatusAsync("Unpacking website and resolving dependencies…", "active");
        await AppendAsync($"threebrowser pull \"{rawAddress}\"", "command");
        await AppendAsync($"Project  {_destination}", "muted");

        try
        {
            var exitCode = await RunProcessAsync(_nodeExecutable, _runtimeDirectory,
                [_sitePuller, rawAddress, _destination, "--force"], _operation.Token);
            if (exitCode != 0)
            {
                await AppendAsync($"Unpack failed with exit code {exitCode}.", "error");
                await StatusAsync("Unpack failed — review the console output", "error");
                return;
            }

            var entry = Path.Combine(_destination, "site-entry.mjs");
            if (!File.Exists(entry))
            {
                await AppendAsync("The unpacker completed without producing site-entry.mjs.", "error");
                await StatusAsync("Generated entry point is missing", "error");
                return;
            }

            await InvokeUiAsync("projectReady");
            await RefreshLibraryAsync();
            await AppendAsync("Unpack complete", "success");
            await AppendAsync($"threebrowser launch \"{entry}\"", "command");
            await StatusAsync("Launching native runtime…", "active");
            var launchExit = await RunProcessAsync(_nodeExecutable, _runtimeDirectory, [_launcher, entry], _operation.Token);
            await AppendAsync($"Runtime exited with code {launchExit}.", launchExit == 0 ? "success" : "error");
            if (launchExit != 0)
                await InvokeUiAsync("showError", string.IsNullOrWhiteSpace(_lastErrorOutput)
                    ? $"Runtime exited with code {launchExit}."
                    : _lastErrorOutput);
            await StatusAsync(
                launchExit == 0 ? "Runtime closed — project is ready to launch again" : "Runtime stopped with an error",
                launchExit == 0 ? "ready" : "error");
        }
        catch (OperationCanceledException)
        {
            await AppendAsync("Operation stopped. Files created so far were retained.", "muted");
            await StatusAsync("Stopped — generated project files were retained", "ready");
        }
        catch (Exception error)
        {
            await AppendAsync($"Error: {error.Message}", "error");
            await InvokeUiAsync("showError", error.ToString());
            await StatusAsync("Could not complete the operation", "error");
        }
        finally
        {
            _activeProcess?.Dispose();
            _activeProcess = null;
            _operation?.Dispose();
            _operation = null;
            SetRunning(false);
        }
    }

    private async Task<int> RunProcessAsync(string fileName, string workingDirectory,
        IReadOnlyList<string> arguments, CancellationToken cancellationToken)
    {
        var start = new ProcessStartInfo(fileName)
        {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        _activeProcess = Process.Start(start) ?? throw new InvalidOperationException($"Could not start {fileName}.");
        using var registration = cancellationToken.Register(() =>
        {
            try { if (!_activeProcess.HasExited) _activeProcess.Kill(entireProcessTree: true); }
            catch { }
        });
        var capturedErrors = new List<string>();
        var output = PumpAsync(_activeProcess.StandardOutput, "output", cancellationToken);
        var errors = PumpAsync(_activeProcess.StandardError, "error", cancellationToken, capturedErrors);
        await _activeProcess.WaitForExitAsync(cancellationToken);
        await Task.WhenAll(output, errors);
        _lastErrorOutput = string.Join(Environment.NewLine, capturedErrors);
        return _activeProcess.ExitCode;
    }

    private async Task PumpAsync(StreamReader reader, string kind, CancellationToken cancellationToken, List<string>? capture = null)
    {
        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            var displayLine = line.Length > 4096
                ? $"[omitted bundled source line — {line.Length:N0} characters]"
                : line;
            capture?.Add(displayLine);
            await AppendAsync(displayLine, displayLine.Contains("warning:", StringComparison.OrdinalIgnoreCase) ? "warning" : kind);
        }
    }

    private void SetRunning(bool running)
    {
        _running = running;
        _ = InvokeUiAsync("setBusy", running);
    }

    private void StopActiveOperation() => _operation?.Cancel();

    private void OpenProject()
    {
        if (_destination is null || !Directory.Exists(_destination)) return;
        Process.Start(new ProcessStartInfo("explorer.exe", _destination) { UseShellExecute = true });
    }

    private static string ProjectRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ThreeBrowser", "RuntimeProjects");

    private async Task RefreshLibraryAsync()
    {
        var exports = new List<object>();
        Directory.CreateDirectory(ProjectRoot);
        foreach (var directory in Directory.EnumerateDirectories(ProjectRoot).OrderByDescending(Directory.GetLastWriteTimeUtc))
        {
            var entry = Path.Combine(directory, "site-entry.mjs");
            if (!File.Exists(entry)) continue;
            var id = Path.GetFileName(directory);
            var source = "Imported project";
            var pulledAt = Directory.GetLastWriteTimeUtc(directory);
            var fileCount = 0;
            var requiresWebGpu = false;
            try
            {
                var manifestPath = Path.Combine(directory, "threebrowser.pull.json");
                if (File.Exists(manifestPath))
                {
                    using var manifest = JsonDocument.Parse(File.ReadAllText(manifestPath));
                    var root = manifest.RootElement;
                    if (root.TryGetProperty("source", out var sourceNode)) source = sourceNode.GetString() ?? source;
                    if (root.TryGetProperty("pulledAt", out var dateNode) &&
                        DateTime.TryParse(dateNode.GetString(), out var parsed)) pulledAt = parsed.ToUniversalTime();
                    if (root.TryGetProperty("files", out var filesNode) && filesNode.ValueKind == JsonValueKind.Array)
                        fileCount = filesNode.GetArrayLength();
                    if (root.TryGetProperty("requiresWebGPU", out var gpuNode) && gpuNode.ValueKind is JsonValueKind.True or JsonValueKind.False)
                        requiresWebGpu = gpuNode.GetBoolean();
                }
            }
            catch { }

            var name = DisplayNameFromSource(source, id);
            try
            {
                var metadataPath = Path.Combine(directory, ".threebrowser-library.json");
                if (File.Exists(metadataPath))
                {
                    using var metadata = JsonDocument.Parse(File.ReadAllText(metadataPath));
                    if (metadata.RootElement.TryGetProperty("displayName", out var nameNode) &&
                        !string.IsNullOrWhiteSpace(nameNode.GetString())) name = nameNode.GetString()!.Trim();
                }
            }
            catch { }
            exports.Add(new { id, name, source, pulledAt, fileCount, requiresWebGpu });
        }

        var demos = new List<object>();
        if (Directory.Exists(_samplesDirectory))
        {
            foreach (var directory in Directory.EnumerateDirectories(_samplesDirectory).OrderBy(Path.GetFileName))
            {
                var entry = Path.Combine(directory, "site-entry.mjs");
                if (!File.Exists(entry)) continue;
                var leaf = Path.GetFileName(directory);
                demos.Add(new
                {
                    id = $"sample/{leaf}",
                    name = HumanizeName(leaf),
                    description = "Showcase project",
                    kind = "Sample"
                });
            }
        }
        var builtInDemoDirectory = Path.Combine(_runtimeDirectory, "demo");
        if (Directory.Exists(builtInDemoDirectory))
        {
            foreach (var entry in Directory.EnumerateFiles(builtInDemoDirectory, "*.mjs", SearchOption.TopDirectoryOnly).OrderBy(Path.GetFileName))
            {
                var leaf = Path.GetFileNameWithoutExtension(entry);
                demos.Add(new
                {
                    id = $"demo/{leaf}",
                    name = HumanizeName(leaf),
                    description = "Built-in runtime demo",
                    kind = "Demo"
                });
            }
        }
        await InvokeUiAsync("library", exports, demos);
    }

    private async Task LaunchLibraryItemAsync(string id, bool demo)
    {
        if (_running) return;
        var entry = demo ? ResolveDemoEntry(id) : ResolveExportEntry(id);
        if (entry is null || !File.Exists(entry))
        {
            await InvokeUiAsync("notify", "That project is no longer available.", "error");
            await RefreshLibraryAsync();
            return;
        }

        var directory = Path.GetDirectoryName(entry)!;
        _destination = directory;
        while (_pendingLines.TryDequeue(out _)) { }
        _operation = new CancellationTokenSource();
        SetRunning(true);
        await InvokeUiAsync("beginSaved", Path.GetFileName(directory), directory, !demo);
        await StatusAsync("Launching saved project…", "active");
        await AppendAsync($"threebrowser launch \"{entry}\"", "command");
        try
        {
            var exitCode = await RunProcessAsync(_nodeExecutable, _runtimeDirectory, [_launcher, entry], _operation.Token);
            await AppendAsync($"Runtime exited with code {exitCode}.", exitCode == 0 ? "success" : "error");
            if (exitCode != 0)
                await InvokeUiAsync("showError", string.IsNullOrWhiteSpace(_lastErrorOutput)
                    ? $"Runtime exited with code {exitCode}."
                    : _lastErrorOutput);
            await StatusAsync(exitCode == 0 ? "Runtime closed — ready" : "Runtime stopped with an error",
                exitCode == 0 ? "ready" : "error");
        }
        catch (OperationCanceledException)
        {
            await AppendAsync("Runtime stopped.", "muted");
            await StatusAsync("Stopped", "ready");
        }
        catch (Exception error)
        {
            await AppendAsync($"Error: {error.Message}", "error");
            await InvokeUiAsync("showError", error.ToString());
            await StatusAsync("Could not launch the project", "error");
        }
        finally
        {
            _activeProcess?.Dispose();
            _activeProcess = null;
            _operation?.Dispose();
            _operation = null;
            SetRunning(false);
        }
    }

    private void OpenLibraryItem(string id, bool demo)
    {
        var entry = demo ? ResolveDemoEntry(id) : ResolveExportEntry(id);
        var directory = entry is null ? null : Path.GetDirectoryName(entry);
        if (directory is null || !Directory.Exists(directory)) return;
        Process.Start(new ProcessStartInfo("explorer.exe", directory) { UseShellExecute = true });
    }

    private async Task RenameLibraryItemAsync(string id, string requestedName)
    {
        var entry = ResolveExportEntry(id);
        if (entry is null) return;
        var name = requestedName.Trim();
        if (name.Length is < 1 or > 80 || name.Any(char.IsControl))
        {
            await InvokeUiAsync("notify", "Names must contain 1–80 visible characters.", "error");
            return;
        }
        var metadataPath = Path.Combine(Path.GetDirectoryName(entry)!, ".threebrowser-library.json");
        File.WriteAllText(metadataPath, JsonSerializer.Serialize(new { displayName = name },
            new JsonSerializerOptions { WriteIndented = true }));
        await RefreshLibraryAsync();
        await InvokeUiAsync("notify", "Export renamed.", "success");
    }

    private async Task DeleteLibraryItemAsync(string id)
    {
        if (_running)
        {
            await InvokeUiAsync("notify", "Stop the running project before deleting an export.", "error");
            return;
        }
        var entry = ResolveExportEntry(id);
        if (entry is null) return;
        var directory = Path.GetDirectoryName(entry)!;
        EnsureTreeContainsNoReparsePoints(directory);
        Directory.Delete(directory, recursive: true);
        if (string.Equals(_destination?.TrimEnd(Path.DirectorySeparatorChar), directory.TrimEnd(Path.DirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase))
        {
            _destination = null;
            await InvokeUiAsync("projectRemoved");
        }
        await RefreshLibraryAsync();
        await InvokeUiAsync("notify", "Export deleted.", "success");
    }

    private static void EnsureTreeContainsNoReparsePoints(string root)
    {
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.Count > 0)
        {
            var current = pending.Pop();
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("This export contains a linked directory and cannot be deleted safely.");
            foreach (var file in Directory.EnumerateFiles(current, "*", SearchOption.TopDirectoryOnly))
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("This export contains a linked file and cannot be deleted safely.");
            foreach (var directory in Directory.EnumerateDirectories(current, "*", SearchOption.TopDirectoryOnly))
            {
                if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("This export contains a linked directory and cannot be deleted safely.");
                pending.Push(directory);
            }
        }
    }

    private static string? ResolveExportEntry(string id)
    {
        if (string.IsNullOrWhiteSpace(id) || !string.Equals(id, Path.GetFileName(id), StringComparison.Ordinal)) return null;
        var root = Path.GetFullPath(ProjectRoot);
        var directory = Path.GetFullPath(Path.Combine(root, id));
        if (!IsWithin(root, directory) || !Directory.Exists(directory)) return null;
        return Path.Combine(directory, "site-entry.mjs");
    }

    private string? ResolveDemoEntry(string id)
    {
        if (id.StartsWith("sample/", StringComparison.Ordinal))
        {
            var leaf = id[7..];
            if (!string.Equals(leaf, Path.GetFileName(leaf), StringComparison.Ordinal)) return null;
            var root = Path.GetFullPath(_samplesDirectory);
            var entry = Path.GetFullPath(Path.Combine(root, leaf, "site-entry.mjs"));
            return IsWithin(root, entry) ? entry : null;
        }
        if (id.StartsWith("demo/", StringComparison.Ordinal))
        {
            var leaf = id[5..];
            if (!string.Equals(leaf, Path.GetFileName(leaf), StringComparison.Ordinal)) return null;
            var root = Path.GetFullPath(Path.Combine(_runtimeDirectory, "demo"));
            var entry = Path.GetFullPath(Path.Combine(root, leaf + ".mjs"));
            return IsWithin(root, entry) ? entry : null;
        }
        return null;
    }

    private static bool IsWithin(string root, string path) =>
        path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
            StringComparison.OrdinalIgnoreCase);

    private static string DisplayNameFromSource(string source, string fallback)
    {
        if (!Uri.TryCreate(source, UriKind.Absolute, out var uri)) return HumanizeName(fallback);
        var path = Uri.UnescapeDataString(uri.AbsolutePath).Trim('/');
        return string.IsNullOrWhiteSpace(path) ? uri.Host : $"{uri.Host} / {path}";
    }

    private static string HumanizeName(string value) => string.Join(" ", value
        .Split(['-', '_'], StringSplitOptions.RemoveEmptyEntries)
        .Select(word => char.ToUpperInvariant(word[0]) + word[1..]));

    private Task AppendAsync(string text, string kind)
    {
        _pendingLines.Enqueue((text, kind));
        return Task.CompletedTask;
    }

    private async Task FlushOutputAsync()
    {
        if (_flushingLines || _pendingLines.IsEmpty) return;
        _flushingLines = true;
        try
        {
            var batch = new List<object>(256);
            while (batch.Count < 256 && _pendingLines.TryDequeue(out var line))
                batch.Add(new { text = line.Text, kind = line.Kind });
            if (batch.Count > 0) await InvokeUiAsync("appendMany", batch);
        }
        finally
        {
            _flushingLines = false;
        }
    }

    private Task StatusAsync(string text, string kind) => InvokeUiAsync("status", text, kind);

    private async Task InvokeUiAsync(string method, params object?[] arguments)
    {
        await _ready.Task;
        if (IsDisposed || _view.CoreWebView2 is null) return;
        var json = string.Join(",", arguments.Select(value => JsonSerializer.Serialize(value)));
        try { await _view.CoreWebView2.ExecuteScriptAsync($"window.runtimeUi.{method}({json})"); }
        catch when (IsDisposed) { }
    }

    private async Task RestoreHistoryAsync()
    {
        var history = LoadHistory();
        await InvokeUiAsync("history", history, "");
    }

    private static string GetDestination(Uri address)
    {
        var key = address.GetComponents(UriComponents.SchemeAndServer | UriComponents.Path, UriFormat.Unescaped);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant()[..8];
        var leaf = address.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? "site";
        leaf = Path.GetFileNameWithoutExtension(leaf);
        var safe = string.Concat($"{address.Host}-{leaf}".Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '-')).Trim('-');
        if (safe.Length > 52) safe = safe[..52].TrimEnd('-');
        return Path.Combine(ProjectRoot, $"{safe}-{hash}");
    }

    private static string HistoryPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ThreeBrowser", "runtime-launcher.json");

    private static string[] LoadHistory()
    {
        try { return File.Exists(HistoryPath) ? JsonSerializer.Deserialize<string[]>(File.ReadAllText(HistoryPath)) ?? [] : []; }
        catch { return []; }
    }

    private static void SaveHistory(string address)
    {
        try
        {
            var history = LoadHistory().Prepend(address).Distinct(StringComparer.OrdinalIgnoreCase).Take(12).ToArray();
            Directory.CreateDirectory(Path.GetDirectoryName(HistoryPath)!);
            File.WriteAllText(HistoryPath, JsonSerializer.Serialize(history));
        }
        catch { }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        _outputTimer.Stop();
        StopActiveOperation();
        base.OnFormClosing(e);
    }

    private const string PageHtml = """
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light;--bg:#f6f7f9;--card:#fff;--ink:#151922;--muted:#687182;--line:#dfe3e8;--blue:#1469dc;--blue2:#0b57bd;--terminal:#11161e;--terminal2:#181f2a;--green:#55d68d;--red:#ff7878;--amber:#ffc663}*{box-sizing:border-box}html,body{height:100%;margin:0}body{font-family:"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--ink);font-size:14px;overflow:hidden}button,input{font:inherit}.app{height:100%;display:grid;grid-template-rows:auto 1fr auto}
header{height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:rgba(255,255,255,.9);border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:13px}.logo{width:38px;height:38px;border:1px solid #b9d2f8;background:#eef5ff;border-radius:11px;display:grid;place-items:center;color:var(--blue)}.logo svg{width:21px}.brand h1{font-size:16px;margin:0;font-weight:650;letter-spacing:-.01em}.brand p{font-size:12.5px;color:var(--muted);margin:3px 0 0}.header-actions{display:flex;align-items:center;gap:9px}.library-button{height:38px;padding:0 13px;border:1px solid #ccd5e1;background:#fff;color:#344054;border-radius:9px;font-size:13px;box-shadow:0 2px 7px rgba(25,34,49,.05)}.library-button:hover{border-color:#aebdce;background:#f8faff}.library-button svg{width:17px;height:17px;color:#66758a}.count{min-width:22px;height:20px;padding:0 6px;border-radius:10px;background:#edf3fc;color:#1768cf;display:grid;place-items:center;font-size:11px;font-weight:700}
main{height:100%;min-height:0;overflow:hidden;padding:24px 28px 26px;display:grid;grid-template-rows:auto minmax(0,1fr);gap:20px;max-width:1280px;width:100%;margin:0 auto}.launch-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 19px;box-shadow:0 6px 24px rgba(25,34,49,.055)}.label-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}.label{font-size:11px;letter-spacing:.08em;font-weight:700;color:#566173}.hint{font-size:12px;color:#8a93a2}.input-row{display:grid;grid-template-columns:1fr auto;gap:10px}.address-wrap{height:44px;border:1px solid #cfd5dd;border-radius:9px;display:flex;align-items:center;background:#fff;transition:.16s}.address-wrap:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px rgba(20,105,220,.12)}.globe{color:#778294;margin:0 10px 0 13px}input{width:100%;height:100%;border:0;outline:0;background:transparent;color:var(--ink);font-size:14px;padding:0 12px 0 0}input::placeholder{color:#9ba3af}
button{height:44px;border-radius:9px;border:1px solid transparent;padding:0 19px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-weight:600;transition:.15s;white-space:nowrap}.primary{background:var(--blue);color:#fff;min-width:174px;box-shadow:0 5px 12px rgba(20,105,220,.19)}.primary:hover{background:var(--blue2);transform:translateY(-1px)}button:disabled{cursor:default;opacity:.48;transform:none!important}.project{font:12px "Cascadia Mono","Consolas",monospace;color:#788292;margin-top:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:16px}
.terminal{position:relative;height:100%;min-height:0;max-height:100%;border-radius:14px;overflow:hidden;background:var(--terminal);border:1px solid #252e3b;box-shadow:0 12px 34px rgba(12,17,24,.16);display:grid;grid-template-rows:46px minmax(0,1fr)}.terminal-head{display:flex;align-items:center;padding:0 15px;background:var(--terminal2);border-bottom:1px solid #293241}.lights{display:flex;gap:7px;margin-right:15px}.lights i{width:9px;height:9px;border-radius:50%;background:#445166}.lights i:nth-child(1){background:#ff6f6f}.lights i:nth-child(2){background:#f5bd4f}.lights i:nth-child(3){background:#59c87a}.terminal-title{color:#a7b3c5;font-size:11px;letter-spacing:.09em;font-weight:700}.terminal-meta{margin-left:12px;color:#627087;font-size:11px}.terminal-actions{margin-left:auto;display:flex;gap:7px}.ghost{height:30px;border:1px solid #3a4659;background:#222b38;color:#bcc8d8;border-radius:7px;padding:0 11px;font-size:12px;font-weight:500}.ghost:hover:not(:disabled){background:#2d3848;border-color:#526078}
.console{position:relative;height:100%;min-height:0;overflow:auto;font:13px/21px "Cascadia Mono","Consolas",monospace;color:#cbd5e1;contain:strict}.console::-webkit-scrollbar{width:11px;height:11px}.console::-webkit-scrollbar-thumb{background:#343f4f;border:3px solid var(--terminal);border-radius:9px}.virtual-space{position:relative;min-width:100%;width:max-content}.virtual-window{position:absolute;left:20px;right:20px;top:0;min-width:max-content}.line{height:21px;line-height:21px;white-space:pre;overflow:hidden;text-overflow:ellipsis}.line.command{color:#61c6ff}.line.command:before{content:"❯ ";color:var(--green);font-weight:700}.line.muted{color:#74839a}.line.success{color:var(--green)}.line.success:before{content:"✓ ";font-weight:700}.line.error{color:var(--red)}.line.warning{color:var(--amber)}.welcome{height:100%;display:grid;place-items:center;text-align:center;color:#708096}.welcome svg{width:38px;color:#3e8eff;margin-bottom:10px}.welcome strong{display:block;color:#d7e1ee;font-size:14px;margin-bottom:4px}.welcome span{font-size:12px}
.runtime-error{position:absolute;inset:46px 0 0;z-index:4;background:#11161e;overflow:auto;padding:24px}.error-card{max-width:900px;margin:0 auto;border:1px solid #57343b;background:#1c1b23;border-radius:12px;overflow:hidden;box-shadow:0 12px 30px rgba(0,0,0,.22)}.error-summary{display:grid;grid-template-columns:38px 1fr auto;gap:13px;align-items:start;padding:17px 18px;background:#251c23;border-bottom:1px solid #57343b}.error-icon{width:38px;height:38px;border-radius:9px;display:grid;place-items:center;background:#4a252d;color:#ff8f9b;font-weight:800}.error-kicker{font:700 10px/1.2 "Segoe UI",sans-serif;letter-spacing:.1em;color:#d9818b;margin-bottom:6px}.error-headline{font:600 14px/1.45 "Cascadia Mono","Consolas",monospace;color:#ffadb5;overflow-wrap:anywhere}.error-close{height:30px;padding:0 11px;border:1px solid #69414a;background:#31242b;color:#e7bec3;border-radius:7px;font-size:12px}.error-close:hover{background:#442d35}.error-details{padding:14px 18px 18px}.error-details summary{cursor:pointer;color:#c9d3e1;font:600 12px "Segoe UI",sans-serif;margin-bottom:12px}.error-details pre{margin:0;padding:14px;border-radius:8px;background:#10141b;border:1px solid #303744;color:#d8dee9;font:12px/1.6 "Cascadia Mono","Consolas",monospace;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}.runtime-error::-webkit-scrollbar{width:11px}.runtime-error::-webkit-scrollbar-thumb{background:#46343b;border:3px solid #11161e;border-radius:9px}
.library-backdrop{position:fixed;inset:0;z-index:20;background:rgba(20,28,40,.28);opacity:0;pointer-events:none;transition:opacity .2s;overflow:hidden}.library-backdrop.open{opacity:1;pointer-events:auto}.library-flyout{position:absolute;top:0;right:0;width:min(430px,92vw);max-width:100%;height:100%;min-width:0;overflow:hidden;background:#f8f9fb;border-left:1px solid #d8dde5;box-shadow:-18px 0 48px rgba(25,34,49,.16);transform:translateX(100%);transition:transform .24s cubic-bezier(.2,.8,.2,1);display:grid;grid-template-rows:auto auto minmax(0,1fr)}.open .library-flyout{transform:none}.library-head{height:72px;min-width:0;padding:0 20px;display:flex;align-items:center;border-bottom:1px solid var(--line);background:#fff}.library-head-copy{min-width:0}.library-head h2{font-size:16px;margin:0;font-weight:650}.library-head p{font-size:12px;color:var(--muted);margin:3px 0 0}.icon-button{width:36px;height:36px;padding:0;border:1px solid #d5dbe4;background:#fff;color:#536174;border-radius:9px}.icon-button:hover{background:#f4f7fb;border-color:#bfc9d6}.library-head .icon-button:first-of-type{margin-left:auto;margin-right:7px}.icon-button svg{width:16px;height:16px}.library-tabs{min-width:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:4px;margin:15px 18px 8px;padding:4px;background:#e9edf3;border-radius:10px}.library-tab{min-width:0;height:34px;padding:0 12px;border:0;border-radius:7px;background:transparent;color:#657184;font-size:12.5px}.library-tab.active{background:#fff;color:#172033;box-shadow:0 1px 4px rgba(25,34,49,.11)}.library-scroll{min-width:0;width:100%;overflow-y:auto;overflow-x:hidden;padding:10px 18px 24px}.library-scroll::-webkit-scrollbar{width:10px}.library-scroll::-webkit-scrollbar-thumb{background:#c7ced8;border:3px solid #f8f9fb;border-radius:8px}.library-section-head{min-width:0;display:flex;align-items:center;justify-content:space-between;margin:1px 2px 10px}.library-section-head strong{font-size:11px;letter-spacing:.08em;color:#667085}.library-section-head span{font-size:11px;color:#98a1af}.library-list{min-width:0;width:100%;display:grid;grid-template-columns:minmax(0,1fr);gap:9px}.library-item{min-width:0;width:100%;max-width:100%;overflow:hidden;background:#fff;border:1px solid #dce1e8;border-radius:11px;padding:13px;box-shadow:0 3px 12px rgba(25,34,49,.035);transition:.15s}.library-item:hover{border-color:#c4cedb;box-shadow:0 7px 20px rgba(25,34,49,.075);transform:translateY(-1px)}.item-top{min-width:0;width:100%;display:flex;align-items:flex-start;gap:11px}.item-mark{width:35px;height:35px;border-radius:9px;display:grid;place-items:center;flex:none;background:#edf5ff;color:#1469dc;border:1px solid #d3e5fb}.item-mark.demo{background:#f1edff;color:#6f4ed6;border-color:#ded5fa}.item-mark svg{width:18px;height:18px}.item-copy{min-width:0;max-width:100%;flex:1 1 0}.item-name,.item-source{display:block;width:100%;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item-name{font-size:13.5px;font-weight:650;color:#172033}.item-source{font-size:11.5px;color:#7a8595;margin-top:3px}.item-badges{min-width:0;display:flex;gap:6px;margin-top:8px;overflow:hidden}.badge{flex:none;font-size:10px;line-height:20px;height:20px;padding:0 7px;border-radius:10px;background:#f0f2f5;color:#667085}.badge.gpu{background:#eaf2ff;color:#1463c7}.item-actions{min-width:0;display:flex;gap:6px;margin-top:12px;padding-top:11px;border-top:1px solid #eef0f3}.item-actions button{height:31px;padding:0 10px;border:1px solid #d8dee7;background:#fff;color:#536174;border-radius:7px;font-size:11.5px;font-weight:600}.item-actions button:hover{background:#f5f8fc;border-color:#bfcad8}.item-actions .launch{background:#edf5ff;border-color:#c7ddfb;color:#1264ce}.item-actions .danger{margin-left:auto;color:#b84444}.empty-library{padding:54px 24px;text-align:center;color:#8a94a3}.empty-library .empty-icon{width:46px;height:46px;margin:0 auto 12px;border-radius:13px;background:#edf2f8;display:grid;place-items:center;color:#637188}.empty-library strong{display:block;color:#3d4858;margin-bottom:5px}.empty-library span{font-size:12px;line-height:1.55}.dialog-layer{position:fixed;inset:0;z-index:30;background:rgba(20,28,40,.32);display:none;place-items:center;padding:24px}.dialog-layer.open{display:grid}.dialog{width:min(390px,100%);background:#fff;border:1px solid #d9dee6;border-radius:13px;box-shadow:0 24px 70px rgba(20,28,40,.24);padding:20px}.dialog h3{font-size:16px;margin:0 0 6px}.dialog p{font-size:12.5px;line-height:1.55;color:#697586;margin:0 0 16px}.dialog input{height:41px;border:1px solid #cdd5df;border-radius:8px;padding:0 11px;background:#fff}.dialog input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(20,105,220,.12)}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.dialog-actions button{height:36px;padding:0 14px;border:1px solid #d4dae3;background:#fff;color:#4d596a;border-radius:8px;font-size:12px}.dialog-actions .confirm{background:var(--blue);border-color:var(--blue);color:#fff}.dialog-actions .delete-confirm{background:#c83f48;border-color:#c83f48;color:#fff}.toast{position:fixed;right:22px;bottom:42px;z-index:40;max-width:370px;padding:11px 14px;border-radius:9px;background:#172131;color:#fff;font-size:12px;box-shadow:0 12px 30px rgba(20,28,40,.22);opacity:0;transform:translateY(8px);pointer-events:none;transition:.2s}.toast.show{opacity:1;transform:none}.toast.error{background:#a9323b}.toast.success{background:#176b45}
.busy-line{height:2px;position:absolute;left:0;right:0;top:45px;overflow:hidden;z-index:2}.busy-line:after{content:"";display:none;width:34%;height:100%;background:#3c9cff;animation:load 1.05s ease-in-out infinite}.busy .busy-line:after{display:block}@keyframes load{from{transform:translateX(-100%)}to{transform:translateX(390%)}}footer{height:27px;background:#087dcc;color:#fff;display:flex;align-items:center;padding:0 13px;font-size:11.5px;gap:9px}.state-dot{width:6px;height:6px;background:#d9f0ff;border-radius:50%}.error-footer{background:#bd3535}.active-footer .state-dot{animation:pulse 1s infinite}@keyframes pulse{50%{opacity:.25}}
.item-actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.item-actions button{width:100%}.item-actions .package{background:#f2f7ff;border-color:#cbdcf6;color:#285f9f}.item-secondary-actions{display:flex;gap:5px;margin-top:7px}.item-secondary-actions button{height:28px;padding:0 8px;border:0;background:transparent;color:#687589;border-radius:6px;font-size:11px;font-weight:600}.item-secondary-actions button:hover:not(:disabled){background:#f2f5f9;color:#344054}.item-secondary-actions .danger{margin-left:auto;color:#b84444}
.bootstrap-layer{position:fixed;inset:0;z-index:35;background:rgba(20,28,40,.42);display:none;place-items:center;padding:18px;backdrop-filter:blur(2px)}.bootstrap-layer.open{display:grid}.bootstrap-dialog{width:min(690px,100%);max-height:calc(100vh - 36px);background:#fff;border:1px solid #d7dde6;border-radius:15px;box-shadow:0 28px 80px rgba(20,28,40,.27);overflow:hidden;display:grid;grid-template-rows:auto minmax(0,1fr) auto}.bootstrap-head{min-height:76px;padding:17px 20px 15px 22px;display:flex;align-items:flex-start;border-bottom:1px solid var(--line);background:#fff}.bootstrap-title-mark{width:39px;height:39px;border:1px solid #cfe0f7;background:#eef5ff;border-radius:10px;display:grid;place-items:center;color:var(--blue);flex:none;margin-right:12px}.bootstrap-title-mark svg{width:20px;height:20px}.bootstrap-heading{min-width:0}.bootstrap-heading h2{font-size:16px;line-height:1.25;margin:1px 0 3px;font-weight:680}.bootstrap-heading p{font-size:12px;color:var(--muted);margin:0;line-height:1.45}.bootstrap-head .icon-button{margin-left:auto;flex:none}.bootstrap-scroll{overflow-y:auto;overscroll-behavior:contain;padding:18px 22px 22px;background:#f8f9fb}.bootstrap-scroll::-webkit-scrollbar{width:11px}.bootstrap-scroll::-webkit-scrollbar-thumb{background:#c5ccd7;border:3px solid #f8f9fb;border-radius:9px}.bootstrap-error{display:none;margin:0 0 13px;padding:10px 12px;border:1px solid #edc4c8;background:#fff2f3;color:#9f2f38;border-radius:9px;font-size:12px;line-height:1.45}.bootstrap-error.show{display:block}.bootstrap-section{background:#fff;border:1px solid #dce1e8;border-radius:12px;padding:15px 16px;margin-bottom:12px;box-shadow:0 2px 9px rgba(25,34,49,.025)}.bootstrap-section:last-child{margin-bottom:0}.bootstrap-section-head{display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:12px}.bootstrap-section-head h3{font-size:12px;letter-spacing:.055em;color:#4d596b;margin:0;font-weight:750}.bootstrap-section-head span{font-size:11px;color:#929ba9;text-align:right}.bootstrap-field{display:grid;grid-template-columns:132px minmax(0,1fr);align-items:center;gap:12px;margin-top:10px}.bootstrap-field:first-child{margin-top:0}.bootstrap-field>label,.field-label{font-size:12px;color:#536174;font-weight:600}.bootstrap-control{height:39px;border:1px solid #cdd5df;border-radius:8px;background:#fff;display:flex;align-items:center;transition:.15s;min-width:0}.bootstrap-control:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px rgba(20,105,220,.11)}.bootstrap-control.invalid{border-color:#cf4d56;box-shadow:0 0 0 3px rgba(207,77,86,.09)}.bootstrap-control input{height:100%;padding:0 11px;min-width:0}.bootstrap-control input[readonly]{color:#5f6b7b;cursor:default}.bootstrap-browse{height:39px;padding:0 13px;border:1px solid #cdd5df;background:#f8fafc;color:#4e5b6d;border-radius:8px;font-size:12px;flex:none}.bootstrap-browse:hover:not(:disabled){background:#eef3f8;border-color:#b7c3d1}.bootstrap-with-button{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.choice-card{position:relative;display:flex;align-items:flex-start;gap:10px;min-width:0;padding:12px;border:1px solid #d6dce5;border-radius:10px;background:#fff;cursor:pointer;transition:.15s}.choice-card:hover{border-color:#b8c6d8;background:#fbfcfe}.choice-card:has(input:checked){border-color:#75a9ed;background:#f2f7ff;box-shadow:0 0 0 2px rgba(20,105,220,.08)}.choice-card input,.signing-option input,.check-row input,.show-password input{width:16px;height:16px;padding:0;margin:2px 0 0;accent-color:var(--blue);flex:none}.choice-copy{min-width:0}.choice-copy strong{display:block;font-size:12.5px;color:#253044;margin-bottom:3px}.choice-copy span{display:block;font-size:11.25px;line-height:1.45;color:#738093}.asset-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.asset-picker{min-width:0;height:auto;padding:11px;display:grid;grid-template-columns:51px minmax(0,1fr) auto;gap:10px;text-align:left;border:1px solid #d6dce5;background:#fff;color:inherit;border-radius:10px}.asset-picker:hover:not(:disabled){border-color:#aebed1;background:#fbfcfe}.asset-preview{width:51px;height:51px;border-radius:9px;border:1px solid #d9e0e9;background:#f0f3f7;display:grid;place-items:center;overflow:hidden;color:#7d8999}.asset-preview svg{width:22px;height:22px}.asset-preview img{width:100%;height:100%;object-fit:cover;display:none}.asset-preview.has-image img{display:block}.asset-preview.has-image svg{display:none}.asset-copy{min-width:0;align-self:center}.asset-copy strong{display:block;font-size:12px;margin-bottom:4px}.asset-name{display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#8791a0;font-size:11px;font-weight:500}.asset-choose{align-self:center;font-size:11px;color:#1264ce}.shader-note{display:flex;align-items:flex-start;gap:9px;margin-top:10px;padding:9px 10px;border-radius:8px;background:#f2f6fb;color:#657286;font-size:11.25px;line-height:1.5}.shader-note svg{width:16px;height:16px;flex:none;color:#4e7fb6;margin-top:1px}.signing-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.signing-option{display:flex;align-items:center;justify-content:center;gap:7px;height:37px;border:1px solid #d4dbe5;border-radius:8px;background:#fff;color:#596678;font-size:11.5px;font-weight:650;cursor:pointer}.signing-option:has(input:checked){border-color:#75a9ed;background:#eff6ff;color:#155fbf}.signing-fields{display:none;margin-top:11px;padding-top:1px}.signing-fields.open{display:block}.certificate-picker{width:100%;height:39px;padding:0 11px;display:flex;justify-content:space-between;border:1px solid #cdd5df;background:#fff;color:#536174;border-radius:8px;font-size:12px;font-weight:500;min-width:0}.certificate-picker:hover:not(:disabled){border-color:#aebed1;background:#fbfcfe}.certificate-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.certificate-choose{color:#1264ce;flex:none}.password-wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center}.show-password{height:100%;display:flex;align-items:center;gap:5px;padding:0 10px;color:#667386;font-size:11px;cursor:pointer;border-left:1px solid #e2e6ec}.trust-note{margin-top:11px;padding:9px 11px;border:1px solid #efdca8;background:#fff9e9;border-radius:8px;color:#755d25;font-size:11.25px;line-height:1.5}.trust-note.pfx{border-color:#cbdff8;background:#f2f7ff;color:#456688}.check-row{display:flex;align-items:flex-start;gap:9px;cursor:pointer}.check-row strong{display:block;color:#39465a;font-size:12px;margin-bottom:2px}.check-row span{display:block;color:#7a8594;font-size:11.25px;line-height:1.4}.bootstrap-actions{min-height:66px;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--line);background:#fff}.bootstrap-actions button{height:38px;padding:0 15px;border:1px solid #d2d9e2;background:#fff;color:#536174;border-radius:8px;font-size:12px}.bootstrap-actions .bootstrap-build{min-width:148px;background:var(--blue);border-color:var(--blue);color:#fff;box-shadow:0 4px 10px rgba(20,105,220,.16)}.bootstrap-actions .bootstrap-build:hover:not(:disabled){background:var(--blue2)}.bootstrap-actions-note{margin-right:auto;color:#8a94a3;font-size:11px}.result-action{display:none}.result-action.show{display:flex}
.certificate-picker.invalid,.asset-picker.invalid{border-color:#cf4d56;box-shadow:0 0 0 3px rgba(207,77,86,.09)}
@media(max-width:760px){header{padding:0 18px}main{padding:18px}.input-row{grid-template-columns:1fr}.primary{width:100%}.hint{display:none}.brand p{display:none}.bootstrap-layer{padding:8px}.bootstrap-dialog{max-height:calc(100vh - 16px)}.bootstrap-scroll{padding:14px}.choice-grid,.asset-grid{grid-template-columns:1fr}.bootstrap-field{grid-template-columns:1fr;gap:6px}.signing-grid{grid-template-columns:1fr}.bootstrap-actions-note{display:none}.terminal-actions .ghost{padding:0 8px}}
</style></head><body><div class="app"><header><div class="brand"><div class="logo"><svg viewBox="0 0 24 24" fill="none"><path d="M5 3.8 19 12 5 20.2V3.8Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m9 8.6 5.8 3.4L9 15.4V8.6Z" fill="currentColor" opacity=".2"/></svg></div><div><h1>ThreeBrowser Runtime</h1><p>Import, launch, and export native Three.js projects</p></div></div><div class="header-actions"><button class="library-button" id="library-open"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7.5h16v11H4zM7 4h10v3.5H7z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><span>Projects</span><span class="count" id="library-count">0</span></button></div></header><main><section class="launch-card"><div class="label-row"><span class="label">WEBSITE URL</span><span class="hint">Vite and Three.js projects are detected automatically</span></div><div class="input-row"><div class="address-wrap"><span class="globe">◎</span><input id="address" list="history" placeholder="https://example.com/scene" spellcheck="false" autocomplete="off"><datalist id="history"></datalist></div><button class="primary" id="run"><span>▶</span><span id="run-label">Unpack &amp; launch</span></button></div><div class="project" id="project">A managed project folder will be created for this URL.</div></section>
<section class="terminal" id="terminal"><div class="busy-line"></div><div class="terminal-head"><div class="lights"><i></i><i></i><i></i></div><span class="terminal-title" id="terminal-title">UNPACK CONSOLE</span><span class="terminal-meta" id="terminal-meta">READY</span><div class="terminal-actions"><button class="ghost" id="clear">Clear</button><button class="ghost" id="open" disabled>Open project</button><button class="ghost" id="bootstrap-current" disabled>Export .exe</button><button class="ghost result-action" id="bootstrap-reveal">Show output</button><button class="ghost result-action" id="bootstrap-run">Run app</button><button class="ghost" id="stop" disabled>■&nbsp; Stop</button></div></div><div class="console" id="console"><div class="welcome" id="welcome"><div><svg viewBox="0 0 24 24" fill="none"><path d="m8 9 3 3-3 3M13 15h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.4"/></svg><strong>Ready to unpack</strong><span>Enter a URL to stream the import process here.</span></div></div></div></section></main><footer id="footer"><i class="state-dot"></i><span id="status">Ready · HTTP and HTTPS URLs supported</span></footer></div>
<div class="library-backdrop" id="library-backdrop"><aside class="library-flyout" role="dialog" aria-label="Project library"><div class="library-head"><div class="library-head-copy"><h2>Project library</h2><p>Launch, export, and manage native projects</p></div><button class="icon-button" id="library-refresh" title="Refresh library"><svg viewBox="0 0 24 24" fill="none"><path d="M19 8a7 7 0 1 0 1 5M19 4v4h-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="icon-button" id="library-close" title="Close library"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div><div class="library-tabs"><button class="library-tab active" data-tab="exports">My projects <span id="export-count"></span></button><button class="library-tab" data-tab="demos">Demos <span id="demo-count"></span></button></div><div class="library-scroll"><div class="library-section-head"><strong id="library-section-title">MY PROJECTS</strong><span id="library-section-meta"></span></div><div class="library-list" id="library-list"></div></div></aside></div>
<div class="dialog-layer" id="dialog-layer"><section class="dialog"><h3 id="dialog-title"></h3><p id="dialog-copy"></p><input id="dialog-input" maxlength="80" autocomplete="off"><div class="dialog-actions"><button id="dialog-cancel">Cancel</button><button class="confirm" id="dialog-confirm">Save</button></div></section></div>
<div class="bootstrap-layer" id="bootstrap-layer" aria-hidden="true"><section class="bootstrap-dialog" role="dialog" aria-modal="true" aria-labelledby="bootstrap-title">
<div class="bootstrap-head"><div class="bootstrap-title-mark"><svg viewBox="0 0 24 24" fill="none"><path d="M6 4h8l4 4v12H6zM14 4v5h5M9 14h6M12 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="bootstrap-heading"><h2 id="bootstrap-title">Export Windows application</h2><p>Package this project as a native bootstrap with its runtime and resources.</p></div><button class="icon-button" id="bootstrap-close" title="Close export dialog" aria-label="Close export dialog"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>
<div class="bootstrap-scroll"><div class="bootstrap-error" id="bootstrap-error" role="alert"></div>
<section class="bootstrap-section"><div class="bootstrap-section-head"><h3>APPLICATION</h3><span>Windows x64</span></div><div class="bootstrap-field"><label for="bootstrap-name">Application name</label><div class="bootstrap-control" id="bootstrap-name-wrap"><input id="bootstrap-name" maxlength="80" autocomplete="off" placeholder="My ThreeBrowser App"></div></div><div class="bootstrap-field"><label for="bootstrap-destination">Destination</label><div class="bootstrap-with-button"><div class="bootstrap-control" id="bootstrap-destination-wrap"><input id="bootstrap-destination" readonly placeholder="Choose an output folder"></div><button class="bootstrap-browse" id="bootstrap-output-picker" type="button">Browse…</button></div></div></section>
<section class="bootstrap-section"><div class="bootstrap-section-head"><h3>PACKAGE MODE</h3><span>Choose one output format</span></div><div class="choice-grid"><label class="choice-card"><input type="radio" name="bootstrap-package" value="single" checked><span class="choice-copy"><strong>Single embedded EXE</strong><span>One bootstrap executable containing the project, runtime, resources, and dependencies.</span></span></label><label class="choice-card"><input type="radio" name="bootstrap-package" value="portable"><span class="choice-copy"><strong>Portable EXE folder</strong><span>An executable beside visible runtime and dependency files for easier inspection.</span></span></label></div></section>
<section class="bootstrap-section"><div class="bootstrap-section-head"><h3>BRANDING</h3><span>Optional</span></div><div class="asset-grid"><button class="asset-picker" id="bootstrap-icon-picker" type="button"><span class="asset-preview" id="bootstrap-icon-preview"><svg viewBox="0 0 24 24" fill="none"><path d="M5 4h14v16H5zM8 8h8M8 12h5M8 16h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><img id="bootstrap-icon-image" alt=""></span><span class="asset-copy"><strong>Application icon</strong><span class="asset-name" id="bootstrap-icon-name">Choose ICO, PNG, JPG, or BMP</span></span><span class="asset-choose">Choose</span></button><button class="asset-picker" id="bootstrap-loading-picker" type="button"><span class="asset-preview" id="bootstrap-loading-preview"><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="m6 16 4-4 3 3 2-2 3 3M8 9h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><img id="bootstrap-loading-image" alt=""></span><span class="asset-copy"><strong>Shader loading image</strong><span class="asset-name" id="bootstrap-loading-name">Choose PNG, JPG, BMP, or GIF</span></span><span class="asset-choose">Choose</span></button></div><div class="shader-note"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span>The loading image remains visible until the first scene frame is rendered and its startup shaders are ready. Shader variants created later by project interactions compile when first used.</span></div></section>
<section class="bootstrap-section"><div class="bootstrap-section-head"><h3>CODE SIGNING</h3><span>Optional, but recommended for distribution</span></div><div class="signing-grid"><label class="signing-option"><input type="radio" name="bootstrap-signing" value="unsigned" checked>Unsigned</label><label class="signing-option"><input type="radio" name="bootstrap-signing" value="pfx">Existing PFX / P12</label><label class="signing-option"><input type="radio" name="bootstrap-signing" value="self">Self-signed</label></div><div class="signing-fields" id="bootstrap-pfx-fields"><div class="bootstrap-field"><span class="field-label">Certificate</span><button class="certificate-picker" id="bootstrap-certificate-picker" type="button"><span class="certificate-name" id="bootstrap-certificate-name">Choose a PFX or P12 file</span><span class="certificate-choose">Browse…</span></button></div><div class="bootstrap-field"><label for="bootstrap-password">Password</label><div class="bootstrap-control password-wrap" id="bootstrap-password-wrap"><input id="bootstrap-password" type="password" autocomplete="new-password" placeholder="Leave blank if the certificate has no password"><label class="show-password"><input id="bootstrap-show-password" type="checkbox">Show</label></div></div></div><div class="signing-fields" id="bootstrap-self-fields"><div class="bootstrap-field"><label for="bootstrap-subject">Publisher subject</label><div class="bootstrap-control" id="bootstrap-subject-wrap"><input id="bootstrap-subject" placeholder="CN=Your Company" autocomplete="organization"></div></div></div><div class="signing-fields" id="bootstrap-timestamp-fields"><div class="bootstrap-field"><label for="bootstrap-timestamp">Timestamp URL</label><div class="bootstrap-control" id="bootstrap-timestamp-wrap"><input id="bootstrap-timestamp" type="url" placeholder="https://timestamp.example.com" spellcheck="false"></div></div></div><div class="trust-note" id="bootstrap-trust-note">Unsigned applications can show Unknown publisher and Microsoft Defender SmartScreen warnings. Recipients must decide whether to run them.</div></section>
<section class="bootstrap-section"><label class="check-row"><input id="bootstrap-keep-source" type="checkbox"><span><strong>Keep the generated bootstrap source project</strong><span>Retain the generated .NET project for inspection, debugging, or later customization.</span></span></label></section>
</div><div class="bootstrap-actions"><span class="bootstrap-actions-note">Your original project is not modified.</span><button id="bootstrap-cancel" type="button">Cancel</button><button class="bootstrap-build" id="bootstrap-build" type="button">Create package</button></div></section></div>
<div class="toast" id="toast"></div>
<script>
const $=id=>document.getElementById(id),address=$('address'),run=$('run'),stop=$('stop'),open=$('open'),output=$('console'),footer=$('footer');
const ROW=21,OVERSCAN=14,MAX_LINES=50000,lines=[];
let space=null,windowEl=null,renderFrame=0,libraryExports=[],libraryDemos=[],libraryTab='exports',dialogState=null,toastTimer=0,uiBusy=false,currentProjectReady=false,currentProjectExportable=false,bootstrapState=null,bootstrapSubmitting=false,bootstrapReturnFocus=null;
const send=(action,extra={})=>chrome.webview.postMessage({action,...extra});
const icons={export:'<svg viewBox="0 0 24 24" fill="none"><path d="M6 4h9l3 3v13H6zM15 4v4h4M9 12h6M9 15h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',demo:'<svg viewBox="0 0 24 24" fill="none"><path d="m8 5 11 7-11 7z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'};

function setLibraryOpen(value){$('library-backdrop').classList.toggle('open',value);if(value)send('libraryRefresh')}
function formatDate(value){const date=new Date(value);return Number.isNaN(date.valueOf())?'Saved project':new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(date)}
function emptyLibrary(demo){const empty=document.createElement('div');empty.className='empty-library';empty.innerHTML='<div class="empty-icon">'+(demo?icons.demo:icons.export)+'</div><strong>'+(demo?'No demos found':'No projects yet')+'</strong><span>'+(demo?'Build the bundled samples to make them available here.':'Enter a website URL and unpack it. Completed projects will appear here automatically.')+'</span>';return empty}
function makeAction(label,className,action){const button=document.createElement('button');button.type='button';button.textContent=label;button.className=(className?className+' ':'')+'project-operation';button.disabled=uiBusy;button.onclick=action;return button}
function makeLibraryItem(item,demo){
 const card=document.createElement('article');card.className='library-item';
 const top=document.createElement('div');top.className='item-top';const mark=document.createElement('div');mark.className='item-mark'+(demo?' demo':'');mark.innerHTML=demo?icons.demo:icons.export;
 const copy=document.createElement('div');copy.className='item-copy';const name=document.createElement('div');name.className='item-name';name.textContent=item.name;name.title=item.name;const source=document.createElement('div');source.className='item-source';source.textContent=demo?item.description:item.source;source.title=source.textContent;copy.append(name,source);top.append(mark,copy);
 const badges=document.createElement('div');badges.className='item-badges';const kind=document.createElement('span');kind.className='badge';kind.textContent=demo?item.kind:formatDate(item.pulledAt);badges.append(kind);if(!demo&&item.fileCount){const files=document.createElement('span');files.className='badge';files.textContent=item.fileCount.toLocaleString()+' files';badges.append(files)}if(!demo&&item.requiresWebGpu){const gpu=document.createElement('span');gpu.className='badge gpu';gpu.textContent='WebGPU';badges.append(gpu)}
 const actions=document.createElement('div');actions.className='item-actions';actions.append(makeAction('▶  Launch','launch',()=>send(demo?'demoLaunch':'libraryLaunch',{id:item.id})));
 if(demo){actions.append(makeAction('Open folder','',()=>send('demoOpen',{id:item.id})));card.append(top,badges,actions)}
 else{actions.append(makeAction('Export .exe','package',()=>send('bootstrapOpen',{id:item.id})));const secondary=document.createElement('div');secondary.className='item-secondary-actions';secondary.append(makeAction('Open folder','',()=>send('libraryOpen',{id:item.id})),makeAction('Rename','',()=>showRename(item)),makeAction('Delete','danger',()=>showDelete(item)));card.append(top,badges,actions,secondary)}
 return card
}
function renderLibrary(){const demo=libraryTab==='demos',items=demo?libraryDemos:libraryExports,list=$('library-list');$('library-section-title').textContent=demo?'DEMOS':'MY PROJECTS';$('library-section-meta').textContent=items.length+(items.length===1?' item':' items');document.querySelectorAll('.library-tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.tab===libraryTab));list.replaceChildren(...(items.length?items.map(item=>makeLibraryItem(item,demo)):[emptyLibrary(demo)]))}
function showRename(item){dialogState={type:'rename',item};$('dialog-title').textContent='Rename project';$('dialog-copy').textContent='Choose a library name. The managed project folder and source URL stay unchanged.';$('dialog-input').style.display='block';$('dialog-input').value=item.name;$('dialog-confirm').textContent='Save name';$('dialog-confirm').className='confirm';$('dialog-layer').classList.add('open');setTimeout(()=>{$('dialog-input').focus();$('dialog-input').select()},0)}
function showDelete(item){dialogState={type:'delete',item};$('dialog-title').textContent='Delete project?';$('dialog-copy').textContent='This permanently removes “'+item.name+'” and all files in its managed project folder.';$('dialog-input').style.display='none';$('dialog-confirm').textContent='Delete project';$('dialog-confirm').className='delete-confirm';$('dialog-layer').classList.add('open')}
function closeDialog(){dialogState=null;$('dialog-layer').classList.remove('open')}
function showToast(text,kind='ready'){const toast=$('toast');toast.textContent=text;toast.className='toast show '+kind;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.className='toast',2600)}

function setCurrentProjectReady(value,exportable=value){currentProjectReady=Boolean(value);currentProjectExportable=Boolean(exportable);$('bootstrap-current').disabled=uiBusy||!currentProjectExportable}
function resetResultActions(){$('bootstrap-reveal').classList.remove('show');$('bootstrap-run').classList.remove('show')}
function prepareVirtual(){const welcome=$('welcome');if(welcome)welcome.remove();if(space)return;space=document.createElement('div');space.className='virtual-space';windowEl=document.createElement('div');windowEl.className='virtual-window';space.append(windowEl);output.replaceChildren(space)}
function clearConsole(){document.querySelector('.runtime-error')?.remove();lines.length=0;space=null;windowEl=null;output.replaceChildren()}
function render(forceBottom=false){prepareVirtual();const totalHeight=lines.length*ROW+36;space.style.height=totalHeight+'px';if(forceBottom)output.scrollTop=Math.max(0,totalHeight-output.clientHeight);const start=Math.max(0,Math.floor((output.scrollTop-18)/ROW)-OVERSCAN),count=Math.ceil(output.clientHeight/ROW)+OVERSCAN*2,end=Math.min(lines.length,start+count),fragment=document.createDocumentFragment();for(let i=start;i<end;i++){const item=lines[i],line=document.createElement('div');line.className='line '+item.kind;line.textContent=item.text;fragment.append(line)}windowEl.style.transform=`translateY(${18+start*ROW}px)`;windowEl.replaceChildren(fragment)}
function scheduleRender(){if(renderFrame)return;renderFrame=requestAnimationFrame(()=>{renderFrame=0;render(false)})}

function selectedValue(name){return document.querySelector('input[name="'+name+'"]:checked')?.value||''}
function defaultX500Subject(value){const text=String(value||'ThreeBrowser App').trim();let escaped='';for(let i=0;i<text.length;i++){const character=text[i];if(',+"\\<>;='.includes(character)||(i===0&&(character===' '||character==='#'))||(i===text.length-1&&character===' '))escaped+='\\';escaped+=character}return 'CN='+escaped}
function setBootstrapDisabled(value){document.querySelectorAll('#bootstrap-layer button,#bootstrap-layer input').forEach(control=>control.disabled=value)}
function clearBootstrapValidation(){$('bootstrap-error').classList.remove('show');$('bootstrap-error').textContent='';document.querySelectorAll('#bootstrap-layer .invalid').forEach(control=>control.classList.remove('invalid'))}
function setBootstrapPreview(kind,name,preview){
 if(!bootstrapState)return;
 bootstrapState.assets[kind]={name:String(name||''),preview:String(preview||'')};
 if(kind==='certificate'){$('bootstrap-certificate-name').textContent=name||'Choose a PFX or P12 file';$('bootstrap-certificate-picker').title=name||'';return}
 if(kind!=='icon'&&kind!=='loading')return;
 const label=$(kind==='icon'?'bootstrap-icon-name':'bootstrap-loading-name'),image=$(kind==='icon'?'bootstrap-icon-image':'bootstrap-loading-image'),box=$(kind==='icon'?'bootstrap-icon-preview':'bootstrap-loading-preview');
 label.textContent=name||(kind==='icon'?'Choose ICO, PNG, JPG, or BMP':'Choose PNG, JPG, BMP, or GIF');label.title=name||'';box.classList.toggle('has-image',Boolean(preview));image.src=preview||'';image.alt=preview?(kind==='icon'?'Selected application icon':'Selected shader loading image'):'';image.onerror=()=>box.classList.remove('has-image')
}
function updateSigningUi(){
 const mode=selectedValue('bootstrap-signing');$('bootstrap-pfx-fields').classList.toggle('open',mode==='pfx');$('bootstrap-self-fields').classList.toggle('open',mode==='self');$('bootstrap-timestamp-fields').classList.toggle('open',mode!=='unsigned');
 const note=$('bootstrap-trust-note');note.classList.toggle('pfx',mode==='pfx');note.textContent=mode==='self'?'A self-signed certificate is not publicly trusted. Other PCs will warn until that certificate is explicitly installed as trusted; use this for private testing or managed devices.':mode==='pfx'?'Windows trust still depends on a valid code-signing certificate and publisher reputation. Timestamping is strongly recommended for distributed builds.':'Unsigned applications can show Unknown publisher and Microsoft Defender SmartScreen warnings. Recipients must decide whether to run them.'
}
function openBootstrap(config){
 bootstrapReturnFocus=document.activeElement;bootstrapState={id:String(config?.id||''),assets:{icon:null,loading:null,certificate:null},subjectAutomatic:true};bootstrapSubmitting=false;clearBootstrapValidation();setBootstrapDisabled(false);
 $('bootstrap-name').value=String(config?.name||'').trim();$('bootstrap-destination').value=String(config?.destination||'');$('bootstrap-password').value='';$('bootstrap-subject').value=defaultX500Subject(config?.name);$('bootstrap-timestamp').value='';$('bootstrap-keep-source').checked=false;$('bootstrap-show-password').checked=false;$('bootstrap-password').type='password';
 document.querySelector('input[name="bootstrap-package"][value="single"]').checked=true;document.querySelector('input[name="bootstrap-signing"][value="unsigned"]').checked=true;
 setBootstrapPreview('icon','',null);setBootstrapPreview('loading','',null);setBootstrapPreview('certificate','',null);updateSigningUi();$('bootstrap-layer').classList.add('open');$('bootstrap-layer').setAttribute('aria-hidden','false');setTimeout(()=>{$('bootstrap-name').focus();$('bootstrap-name').select()},0)
}
function closeBootstrap(force=false){if((uiBusy||bootstrapSubmitting)&&!force)return;$('bootstrap-password').value='';bootstrapState=null;$('bootstrap-layer').classList.remove('open');$('bootstrap-layer').setAttribute('aria-hidden','true');clearBootstrapValidation();if(!force)bootstrapReturnFocus?.focus();bootstrapReturnFocus=null}
function hideBootstrapForBuild(){$('bootstrap-layer').classList.remove('open');$('bootstrap-layer').setAttribute('aria-hidden','true')}
function validateBootstrap(){
 clearBootstrapValidation();const errors=[];let first=null;const flag=(control,message)=>{control.classList.add('invalid');errors.push(message);first??=control};
 const name=$('bootstrap-name').value.trim(),destination=$('bootstrap-destination').value.trim(),packageMode=selectedValue('bootstrap-package'),signingMode=selectedValue('bootstrap-signing'),subject=$('bootstrap-subject').value.trim(),timestamp=$('bootstrap-timestamp').value.trim();
 const reserved=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
 if(!name)flag($('bootstrap-name-wrap'),'Enter an application name.');else if(/[<>:"/\\|?*\u0000-\u001f]/.test(name)||/[. ]$/.test(name))flag($('bootstrap-name-wrap'),'Use a Windows-safe application name without \\ / : * ? " < > | or a trailing period.');else if(/\.exe$/i.test(name))flag($('bootstrap-name-wrap'),'Enter the application name without the .exe extension.');else if(reserved.test(name))flag($('bootstrap-name-wrap'),'Choose a name other than a reserved Windows device name.');
 if(!destination)flag($('bootstrap-destination-wrap'),'Choose a destination folder.');
 if(signingMode==='pfx'&&!bootstrapState?.assets.certificate?.name)flag($('bootstrap-certificate-picker'),'Choose a PFX or P12 certificate.');
 if(signingMode==='self'&&(!subject||!/^\s*[A-Za-z][A-Za-z0-9.]*\s*=/.test(subject)))flag($('bootstrap-subject-wrap'),'Enter an X.500 publisher subject such as CN=Your Company.');
 if(signingMode!=='unsigned'&&timestamp){try{const parsed=new URL(timestamp);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error()}catch{flag($('bootstrap-timestamp-wrap'),'Enter a complete HTTP or HTTPS timestamp URL without embedded credentials.')}}
 if(errors.length){const panel=$('bootstrap-error');panel.textContent=errors.join(' ');panel.classList.add('show');first?.scrollIntoView({block:'center',behavior:'smooth'});const target=first?.querySelector?.('input,button')||first;setTimeout(()=>target?.focus(),180);return null}
 return{id:bootstrapState.id,name,packageMode,signingMode,certificatePassword:signingMode==='pfx'?$('bootstrap-password').value:'',selfSignedSubject:signingMode==='self'?subject:'',timestampUrl:signingMode==='unsigned'?'':timestamp,keepGeneratedProject:$('bootstrap-keep-source').checked}
}
function submitBootstrap(){if(uiBusy||bootstrapSubmitting||!bootstrapState)return;const request=validateBootstrap();if(!request)return;bootstrapSubmitting=true;setBootstrapDisabled(true);send('bootstrapBuild',request);setTimeout(()=>{if(bootstrapState&&!uiBusy){bootstrapSubmitting=false;setBootstrapDisabled(false);updateSigningUi()}},1800)}

output.addEventListener('scroll',scheduleRender,{passive:true});new ResizeObserver(scheduleRender).observe(output);
run.onclick=()=>send('run',{url:address.value});stop.onclick=()=>send('stop');open.onclick=()=>send('open');$('bootstrap-current').onclick=()=>send('bootstrapOpenCurrent');$('bootstrap-reveal').onclick=()=>send('bootstrapReveal');$('bootstrap-run').onclick=()=>send('bootstrapRun');$('clear').onclick=()=>{clearConsole();render(false)};address.onkeydown=e=>{if(e.key==='Enter'&&!run.disabled)run.click()};
$('library-open').onclick=()=>setLibraryOpen(true);$('library-close').onclick=()=>setLibraryOpen(false);$('library-refresh').onclick=()=>send('libraryRefresh');$('library-backdrop').onclick=e=>{if(e.target===$('library-backdrop'))setLibraryOpen(false)};document.querySelectorAll('.library-tab').forEach(tab=>tab.onclick=()=>{libraryTab=tab.dataset.tab;renderLibrary()});
$('dialog-cancel').onclick=closeDialog;$('dialog-layer').onclick=e=>{if(e.target===$('dialog-layer'))closeDialog()};$('dialog-confirm').onclick=()=>{if(!dialogState)return;const {type,item}=dialogState;if(type==='rename')send('libraryRename',{id:item.id,name:$('dialog-input').value});else send('libraryDelete',{id:item.id});closeDialog()};$('dialog-input').onkeydown=e=>{if(e.key==='Enter')$('dialog-confirm').click();if(e.key==='Escape')closeDialog()};
$('bootstrap-close').onclick=()=>closeBootstrap();$('bootstrap-cancel').onclick=()=>closeBootstrap();$('bootstrap-layer').onclick=e=>{if(e.target===$('bootstrap-layer'))closeBootstrap()};$('bootstrap-output-picker').onclick=()=>send('bootstrapPick',{kind:'output'});$('bootstrap-icon-picker').onclick=()=>send('bootstrapPick',{kind:'icon'});$('bootstrap-loading-picker').onclick=()=>send('bootstrapPick',{kind:'loading'});$('bootstrap-certificate-picker').onclick=()=>send('bootstrapPick',{kind:'certificate'});$('bootstrap-build').onclick=submitBootstrap;$('bootstrap-show-password').onchange=()=>{$('bootstrap-password').type=$('bootstrap-show-password').checked?'text':'password'};document.querySelectorAll('input[name="bootstrap-signing"]').forEach(input=>input.onchange=updateSigningUi);$('bootstrap-name').oninput=()=>{if(bootstrapState?.subjectAutomatic)$('bootstrap-subject').value=defaultX500Subject($('bootstrap-name').value)};$('bootstrap-subject').oninput=()=>{if(bootstrapState)bootstrapState.subjectAutomatic=false};$('bootstrap-name').onkeydown=e=>{if(e.key==='Enter')submitBootstrap()};
document.addEventListener('keydown',e=>{const bootstrapOpen=$('bootstrap-layer').classList.contains('open');if(bootstrapOpen&&e.key==='Tab'){const focusable=[...$('bootstrap-layer').querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(control=>control.offsetParent!==null);if(focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}if(e.key==='Escape'){if(bootstrapOpen)closeBootstrap();else if($('dialog-layer').classList.contains('open'))closeDialog();else if($('library-backdrop').classList.contains('open'))setLibraryOpen(false)}});

window.runtimeUi={
 history(items,current){$('history').replaceChildren(...items.map(x=>Object.assign(document.createElement('option'),{value:x})));if(current&&!address.value)address.value=current},
 library(exports,demos){libraryExports=Array.isArray(exports)?exports:[];libraryDemos=Array.isArray(demos)?demos:[];$('library-count').textContent=libraryExports.length;$('export-count').textContent='('+libraryExports.length+')';$('demo-count').textContent='('+libraryDemos.length+')';renderLibrary()},
 focusAddress(){address.focus();address.select()},
 begin(url,path){clearConsole();resetResultActions();setCurrentProjectReady(false);$('project').textContent=path;$('terminal-title').textContent='UNPACK CONSOLE';$('terminal-meta').textContent='UNPACKING'},
 beginSaved(name,path,exportable=true){setLibraryOpen(false);clearConsole();resetResultActions();setCurrentProjectReady(true,exportable!==false);$('project').textContent=path;open.disabled=false;$('terminal-title').textContent='RUNTIME CONSOLE';$('terminal-meta').textContent='LAUNCHING'},
 appendMany(items){lines.push(...items);if(lines.length>MAX_LINES)lines.splice(0,lines.length-MAX_LINES);render(true)},
 projectReady(){setCurrentProjectReady(true);open.disabled=false;$('terminal-meta').textContent='LAUNCHING'},
 projectRemoved(){setCurrentProjectReady(false);open.disabled=true;$('project').textContent='A managed project folder will be created for this URL.'},
 bootstrapDialog(config){openBootstrap(config||{})},
 bootstrapAsset(kind,name,preview){setBootstrapPreview(String(kind||''),String(name||''),preview)},
 bootstrapOutput(folder){if(!bootstrapState)return;$('bootstrap-destination').value=String(folder||'');$('bootstrap-destination-wrap').classList.remove('invalid')},
 beginBootstrap(name,path){setLibraryOpen(false);hideBootstrapForBuild();clearConsole();resetResultActions();setCurrentProjectReady(true);$('project').textContent=path;$('terminal-title').textContent='EXPORT CONSOLE';$('terminal-meta').textContent='BUILDING'},
 bootstrapComplete(exePath,certificatePath,generatedProjectPath){closeBootstrap(true);$('terminal-title').textContent='EXPORT CONSOLE';$('terminal-meta').textContent='COMPLETE';$('project').textContent=exePath||'Export complete';const summary=[];if(exePath)summary.push({text:'Executable  '+exePath,kind:'success'});if(certificatePath)summary.push({text:'Certificate '+certificatePath,kind:'muted'});if(generatedProjectPath)summary.push({text:'Source      '+generatedProjectPath,kind:'muted'});if(summary.length){lines.push(...summary);render(true)}$('bootstrap-reveal').classList.add('show');$('bootstrap-run').classList.add('show');$('bootstrap-reveal').disabled=uiBusy;$('bootstrap-run').disabled=uiBusy;$('status').textContent='Export complete · Windows application is ready';footer.className='';showToast('Windows application created','success')},
 bootstrapFailed(message){const text=String(message||'Export failed');const cancelled=/cancel/i.test(text);if(bootstrapState){bootstrapSubmitting=false;setBootstrapDisabled(false);updateSigningUi();const panel=$('bootstrap-error');panel.textContent=text;panel.classList.add('show');$('bootstrap-layer').classList.add('open');$('bootstrap-layer').setAttribute('aria-hidden','false')} $('terminal-title').textContent='EXPORT CONSOLE';$('terminal-meta').textContent=cancelled?'CANCELLED':'FAILED';lines.push({text,kind:cancelled?'muted':'error'});render(true);showToast(text,cancelled?'ready':'error')},
 showError(raw){document.querySelector('.runtime-error')?.remove();const clean=String(raw||'Unknown runtime error').replace(/\x1b\[[0-9;]*m/g,''),rows=clean.split(/\r?\n/),headline=rows.find(x=>/^\s*(?:Uncaught\s+)?(?:Reference|Type|Syntax|Range|URI|Eval|Aggregate)?Error\s*:/i.test(x))||rows.find(x=>/error/i.test(x))||'The native runtime stopped unexpectedly.';const panel=document.createElement('div');panel.className='runtime-error';const card=document.createElement('section');card.className='error-card';const summary=document.createElement('div');summary.className='error-summary';const icon=document.createElement('div');icon.className='error-icon';icon.textContent='!';const copy=document.createElement('div');copy.innerHTML='<div class="error-kicker">RUNTIME ERROR</div>';const title=document.createElement('div');title.className='error-headline';title.textContent=headline.trim();copy.append(title);const close=document.createElement('button');close.className='error-close';close.textContent='Back to console';close.onclick=()=>panel.remove();summary.append(icon,copy,close);const details=document.createElement('details');details.className='error-details';details.open=true;const label=document.createElement('summary');label.textContent='Error and stack trace';const pre=document.createElement('pre');pre.textContent=clean;details.append(label,pre);card.append(summary,details);panel.append(card);$('terminal').append(panel);$('terminal-meta').textContent='FAILED'},
 setBusy(value){uiBusy=Boolean(value);document.body.classList.toggle('busy',uiBusy);address.disabled=uiBusy;run.disabled=uiBusy;stop.disabled=!uiBusy;open.disabled=uiBusy||!currentProjectReady;$('bootstrap-current').disabled=uiBusy||!currentProjectExportable;$('bootstrap-reveal').disabled=uiBusy;$('bootstrap-run').disabled=uiBusy;document.querySelectorAll('.project-operation').forEach(button=>button.disabled=uiBusy);$('run-label').textContent=uiBusy?'Working…':'Unpack & launch';if(!uiBusy&&!['COMPLETE','FAILED','CANCELLED'].includes($('terminal-meta').textContent))$('terminal-meta').textContent='READY'},
 notify(text,kind='ready'){if(bootstrapState&&bootstrapSubmitting){bootstrapSubmitting=false;setBootstrapDisabled(false);updateSigningUi()}showToast(String(text||''),kind)},
 status(text,kind='ready'){$('status').textContent=text;footer.className=kind==='error'?'error-footer':kind==='active'?'active-footer':''}
};
</script></body></html>
""";
}
