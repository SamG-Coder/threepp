using System.Text;

namespace ThreeBrowserRuntime;

internal static class BootstrapRuntimeTemplate
{
    internal static string Create(
        string applicationName,
        string applicationId,
        string payloadHash,
        string manifestHash,
        bool embeddedPayload)
    {
        return Source
            .Replace("__APP_NAME_BASE64__", Convert.ToBase64String(Encoding.UTF8.GetBytes(applicationName)), StringComparison.Ordinal)
            .Replace("__APP_ID_BASE64__", Convert.ToBase64String(Encoding.UTF8.GetBytes(applicationId)), StringComparison.Ordinal)
            .Replace("__PAYLOAD_HASH__", payloadHash, StringComparison.Ordinal)
            .Replace("__MANIFEST_HASH__", manifestHash, StringComparison.Ordinal)
            .Replace("__EMBEDDED_PAYLOAD__", embeddedPayload ? "true" : "false", StringComparison.Ordinal);
    }

    private const string Source = """
using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        if (args.Any(value => value.Equals("--verify-package", StringComparison.OrdinalIgnoreCase)))
        {
            try
            {
                PackageStore.Prepare(null, CancellationToken.None);
                return 0;
            }
            catch (Exception error)
            {
                var log = Environment.GetEnvironmentVariable("THREEBROWSER_VERIFY_LOG");
                if (!string.IsNullOrWhiteSpace(log))
                {
                    try { File.WriteAllText(log, error.ToString()); } catch { }
                }
                return 2;
            }
        }

        using var context = new BootstrapContext();
        Application.Run(context);
        return Environment.ExitCode;
    }
}

internal sealed class BootstrapContext : ApplicationContext
{
    private readonly SplashForm _splash = new();
    private readonly CancellationTokenSource _cancellation = new();
    private Process? _runtime;
    private bool _finished;

    internal BootstrapContext()
    {
        _splash.CancelRequested += Cancel;
        _splash.Shown += (_, _) => _ = RunAsync();
        _splash.Show();
    }

    private async Task RunAsync()
    {
        var ready = false;
        var errors = new OutputTail(32_000);
        string? readyFile = null;
        try
        {
            _splash.SetStatus("Preparing embedded project and runtime…");
            var packageRoot = await Task.Run(
                () => PackageStore.Prepare(_splash.SetStatus, _cancellation.Token),
                _cancellation.Token);

            _cancellation.Token.ThrowIfCancellationRequested();
            _splash.SetStatus("Loading project and compiling startup shaders…");
            readyFile = Path.Combine(Path.GetTempPath(), "ThreeBrowser", "ready-" + Guid.NewGuid().ToString("N") + ".signal");
            Directory.CreateDirectory(Path.GetDirectoryName(readyFile)!);

            var start = new ProcessStartInfo(Path.Combine(packageRoot, "node.exe"))
            {
                WorkingDirectory = packageRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            foreach (var variable in start.Environment.Keys
                         .Where(name => name.StartsWith("NODE_", StringComparison.OrdinalIgnoreCase) ||
                                        name.StartsWith("THREEBROWSER_", StringComparison.OrdinalIgnoreCase))
                         .ToArray())
                start.Environment.Remove(variable);
            start.ArgumentList.Add(Path.Combine(packageRoot, "runtime", "launch.mjs"));
            start.ArgumentList.Add(Path.Combine(packageRoot, "project", "site-entry.mjs"));
            start.Environment["THREEBROWSER_READY_FILE"] = readyFile;
            start.Environment["THREEBROWSER_BOOTSTRAP_APP_NAME"] = PackageStore.ApplicationName;
            start.Environment["THREEBROWSER_APP_ICON"] = Path.Combine(packageRoot, "bootstrap", "app.ico");
            start.Environment["THREEBROWSER_PACKAGED_READ_ONLY"] = "1";
            start.Environment["PATH"] = packageRoot + Path.PathSeparator +
                (start.Environment.TryGetValue("PATH", out var path) ? path : Environment.GetEnvironmentVariable("PATH"));

            _runtime = Process.Start(start) ?? throw new InvalidOperationException("Could not start the embedded ThreeBrowser runtime.");
            using var registration = _cancellation.Token.Register(() =>
            {
                try
                {
                    if (_runtime is { HasExited: false }) _runtime.Kill(entireProcessTree: true);
                }
                catch { }
            });
            var outputTask = CaptureAsync(_runtime.StandardOutput, errors, _cancellation.Token);
            var errorTask = CaptureAsync(_runtime.StandardError, errors, _cancellation.Token);

            while (!_runtime.HasExited)
            {
                if (File.Exists(readyFile))
                {
                    ready = true;
                    _splash.AllowClose();
                    _splash.Hide();
                    break;
                }
                await Task.Delay(50, _cancellation.Token);
            }

            await _runtime.WaitForExitAsync(_cancellation.Token);
            await Task.WhenAll(outputTask, errorTask);
            if (_runtime.ExitCode != 0 && !_cancellation.IsCancellationRequested)
            {
                var detail = errors.ToString();
                throw new InvalidOperationException(string.IsNullOrWhiteSpace(detail)
                    ? $"The runtime exited with code {_runtime.ExitCode}."
                    : $"The runtime exited with code {_runtime.ExitCode}.\n\n{detail}");
            }
            Environment.ExitCode = _runtime.ExitCode;
        }
        catch (OperationCanceledException)
        {
            Environment.ExitCode = 1;
        }
        catch (Exception error)
        {
            Environment.ExitCode = 1;
            if (!ready) _splash.SetStatus("The project could not be started.");
            MessageBox.Show(ready ? null : _splash, error.Message, PackageStore.ApplicationName,
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            if (readyFile is not null)
            {
                try { File.Delete(readyFile); } catch { }
            }
            _runtime?.Dispose();
            Finish();
        }
    }

    private static async Task CaptureAsync(StreamReader reader, OutputTail output, CancellationToken cancellationToken)
    {
        while (await reader.ReadLineAsync(cancellationToken) is { } line) output.Append(line);
    }

    private void Cancel()
    {
        if (_finished) return;
        _splash.SetStatus("Stopping…");
        _cancellation.Cancel();
    }

    private void Finish()
    {
        if (_finished) return;
        _finished = true;
        _splash.AllowClose();
        _splash.Close();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _cancellation.Cancel();
            _cancellation.Dispose();
            _splash.Dispose();
        }
        base.Dispose(disposing);
    }
}

internal sealed class SplashForm : Form
{
    private readonly Label _status;
    private bool _allowClose;
    internal event Action? CancelRequested;

    internal SplashForm()
    {
        Text = PackageStore.ApplicationName;
        ClientSize = new Size(960, 540);
        MinimumSize = new Size(640, 360);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.None;
        BackColor = Color.FromArgb(8, 10, 14);
        TopMost = true;
        ShowInTaskbar = true;
        AutoScaleMode = AutoScaleMode.Dpi;

        try
        {
            if (Environment.ProcessPath is { } executable) Icon = Icon.ExtractAssociatedIcon(executable);
        }
        catch { }

        var image = new PictureBox
        {
            Dock = DockStyle.Fill,
            BackColor = BackColor,
            SizeMode = PictureBoxSizeMode.Zoom,
            Image = LoadImage(),
        };
        var footer = new Panel
        {
            Dock = DockStyle.Bottom,
            Height = 82,
            Padding = new Padding(28, 15, 28, 13),
            BackColor = Color.FromArgb(22, 25, 32),
        };
        var title = new Label
        {
            Dock = DockStyle.Top,
            Height = 24,
            Text = PackageStore.ApplicationName,
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 12f, FontStyle.Bold),
            AutoEllipsis = true,
        };
        _status = new Label
        {
            Dock = DockStyle.Top,
            Height = 21,
            Text = "Starting…",
            ForeColor = Color.FromArgb(201, 209, 221),
            Font = new Font("Segoe UI", 9f),
            AutoEllipsis = true,
        };
        var progress = new ProgressBar
        {
            Dock = DockStyle.Bottom,
            Height = 3,
            Style = ProgressBarStyle.Marquee,
            MarqueeAnimationSpeed = 28,
        };
        footer.Controls.Add(progress);
        footer.Controls.Add(_status);
        footer.Controls.Add(title);
        Controls.Add(image);
        Controls.Add(footer);
    }

    internal void SetStatus(string value)
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            try { BeginInvoke(() => SetStatus(value)); } catch { }
            return;
        }
        _status.Text = value;
    }

    internal void AllowClose() => _allowClose = true;

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_allowClose && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            CancelRequested?.Invoke();
        }
        base.OnFormClosing(e);
    }

    private static Image? LoadImage()
    {
        try
        {
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("ThreeBrowser.LoadingImage");
            if (stream is null) return null;
            using var image = Image.FromStream(stream, useEmbeddedColorManagement: true, validateImageData: true);
            return new Bitmap(image);
        }
        catch { return null; }
    }
}

internal static class PackageStore
{
    internal static readonly string ApplicationName = Encoding.UTF8.GetString(Convert.FromBase64String("__APP_NAME_BASE64__"));
    private static readonly string ApplicationId = Encoding.UTF8.GetString(Convert.FromBase64String("__APP_ID_BASE64__"));
    private const string CacheLeaseFileName = ".lease-v1";
    private static FileStream? ActiveCacheLease;
    private const string PayloadHash = "__PAYLOAD_HASH__";
    private const string ManifestHash = "__MANIFEST_HASH__";
    private static readonly bool EmbeddedPayload = __EMBEDDED_PAYLOAD__;

    internal static string Prepare(Action<string>? progress, CancellationToken cancellationToken)
    {
        if (!EmbeddedPayload)
        {
            var portable = Path.Combine(AppContext.BaseDirectory, "payload");
            progress?.Invoke("Verifying portable project files…");
            VerifyPayload(portable, verifyHashes: true, cancellationToken);
            return portable;
        }

        var cacheOverride = Environment.GetEnvironmentVariable("THREEBROWSER_BOOTSTRAP_CACHE");
        var cacheRoot = string.IsNullOrWhiteSpace(cacheOverride)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ThreeBrowser", "BootstrapCache", ApplicationId)
            : Path.Combine(Path.GetFullPath(cacheOverride), ApplicationId);
        Directory.CreateDirectory(cacheRoot);
        // An exclusive file handle coordinates console, RDP, and other Windows
        // sessions against the exact case-insensitive cache path.
        using (var cacheLock = AcquireCacheRootLock(cacheRoot, cancellationToken))
        {
            foreach (var cached in Directory.EnumerateDirectories(cacheRoot, ManifestHash + "*", SearchOption.TopDirectoryOnly)
                         .Where(IsComplete))
            {
                try
                {
                    progress?.Invoke("Verifying cached project files…");
                    VerifyPayload(cached, verifyHashes: true, cancellationToken);
                    AcquireCacheLease(cached);
                    TouchCompletionMarker(cached);
                    PruneCaches(cacheRoot, cached);
                    return cached;
                }
                catch (OperationCanceledException) { throw; }
                catch
                {
                    // Never launch a damaged or modified cache. Removing the
                    // completion marker also prevents it being selected later
                    // if the directory itself is locked by another process.
                    try { File.Delete(Path.Combine(cached, ".complete")); } catch { }
                    progress?.Invoke("Refreshing a damaged cached package…");
                }
            }

            var desired = Path.Combine(cacheRoot, ManifestHash);
            var destination = Directory.Exists(desired)
                ? desired + "-recovered-" + Guid.NewGuid().ToString("N")
                : desired;
            Directory.CreateDirectory(destination);
            try
            {
                using var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("ThreeBrowser.Payload")
                    ?? throw new InvalidDataException("The embedded ThreeBrowser payload is missing.");
                if (!payload.CanSeek)
                    throw new InvalidDataException("The embedded ThreeBrowser payload cannot be verified.");
                var embeddedHash = Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant();
                if (!embeddedHash.Equals(PayloadHash, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("The embedded ThreeBrowser payload failed integrity verification.");
                payload.Position = 0;
                using var archive = new ZipArchive(payload, ZipArchiveMode.Read, leaveOpen: false);
                var boundary = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                var completed = 0;
                foreach (var entry in archive.Entries)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                    var target = Path.GetFullPath(Path.Combine(destination, relative));
                    if (!target.StartsWith(boundary, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("The embedded payload contains an unsafe path.");
                    if (string.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(target);
                    }
                    else
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                        entry.ExtractToFile(target, overwrite: false);
                    }
                    if (++completed % 25 == 0)
                        progress?.Invoke($"Preparing embedded resources… {completed:N0} / {archive.Entries.Count:N0}");
                }
                progress?.Invoke("Verifying embedded project files…");
                VerifyPayload(destination, verifyHashes: true, cancellationToken);
                File.WriteAllText(Path.Combine(destination, ".complete"), ManifestHash, Encoding.ASCII);
                File.WriteAllText(Path.Combine(destination, CacheLeaseFileName), ManifestHash, Encoding.ASCII);
                AcquireCacheLease(destination);
                PruneCaches(cacheRoot, destination);
                return destination;
            }
            catch
            {
                try { Directory.Delete(destination, recursive: true); } catch { }
                throw;
            }
        }
    }

    private static FileStream AcquireCacheRootLock(string cacheRoot, CancellationToken cancellationToken)
    {
        var lockPath = Path.Combine(cacheRoot, ".cache-lock-v1");
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                return new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            }
            catch (IOException)
            {
                if (cancellationToken.WaitHandle.WaitOne(100)) cancellationToken.ThrowIfCancellationRequested();
            }
        }
    }

    private static bool IsComplete(string directory)
    {
        try
        {
            return File.ReadAllText(Path.Combine(directory, ".complete"), Encoding.ASCII) == ManifestHash;
        }
        catch { return false; }
    }

    private static void TouchCompletionMarker(string directory)
    {
        try { File.SetLastWriteTimeUtc(Path.Combine(directory, ".complete"), DateTime.UtcNow); }
        catch { }
    }

    private static void AcquireCacheLease(string directory)
    {
        var leasePath = Path.Combine(directory, CacheLeaseFileName);
        if (!File.Exists(leasePath)) return; // A cache from an older launcher is never pruned.
        if (!File.ReadAllText(leasePath, Encoding.ASCII).Equals(ManifestHash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The package cache lease is invalid.");
        ActiveCacheLease?.Dispose();
        // Multiple launchers may read the same package. Cleanup requires a
        // no-share write handle and therefore cannot pass while any is alive.
        ActiveCacheLease = new FileStream(leasePath, FileMode.Open, FileAccess.Read, FileShare.Read);
    }

    private static void PruneCaches(string cacheRoot, string activeDirectory)
    {
        // Retain the current package plus the two most recently used older
        // exporter-managed versions. Legacy, incomplete, linked, and unrelated
        // directories are deliberately left untouched.
        try
        {
            if ((File.GetAttributes(cacheRoot) & FileAttributes.ReparsePoint) != 0) return;
            var active = Path.GetFullPath(activeDirectory).TrimEnd(Path.DirectorySeparatorChar);
            var completed = new List<(string Path, DateTime LastUsed)>();
            foreach (var directory in Directory.EnumerateDirectories(cacheRoot, "*", SearchOption.TopDirectoryOnly))
            {
                var full = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar);
                if (full.Equals(active, StringComparison.OrdinalIgnoreCase)) continue;
                if (TryReadOwnedCache(full, out var lastUsed)) completed.Add((full, lastUsed));
            }
            foreach (var stale in completed.OrderByDescending(item => item.LastUsed).Skip(2))
                TryDeleteCache(stale.Path);
        }
        catch
        {
            // Cache cleanup must never prevent a verified application launch.
        }
    }

    private static bool TryReadOwnedCache(string directory, out DateTime lastUsed)
    {
        lastUsed = default;
        try
        {
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) return false;
            var name = Path.GetFileName(directory);
            var separator = name.IndexOf("-recovered-", StringComparison.Ordinal);
            var hash = separator < 0 ? name : name[..separator];
            if (hash.Length != 64 || !hash.All(Uri.IsHexDigit)) return false;
            if (separator >= 0)
            {
                var recoveryId = name[(separator + "-recovered-".Length)..];
                if (separator != 64 || recoveryId.Length != 32 || !recoveryId.All(Uri.IsHexDigit)) return false;
            }
            var marker = Path.Combine(directory, ".complete");
            var lease = Path.Combine(directory, CacheLeaseFileName);
            if (!File.Exists(marker) || !File.Exists(lease)) return false;
            var completedHash = File.ReadAllText(marker, Encoding.ASCII);
            var leaseHash = File.ReadAllText(lease, Encoding.ASCII);
            if (!completedHash.Equals(hash, StringComparison.OrdinalIgnoreCase) ||
                !leaseHash.Equals(hash, StringComparison.OrdinalIgnoreCase)) return false;
            lastUsed = File.GetLastWriteTimeUtc(marker);
            return true;
        }
        catch { return false; }
    }

    private static void TryDeleteCache(string directory)
    {
        try
        {
            var leasePath = Path.Combine(directory, CacheLeaseFileName);
            // The cache-root lock prevents a new launcher from taking a
            // lease between this exclusive probe and deletion.
            using (new FileStream(leasePath, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
            Directory.Delete(directory, recursive: true);
        }
        catch { }
    }

    private static void VerifyPayload(string root, bool verifyHashes, CancellationToken cancellationToken)
    {
        VerifyRequiredFiles(root);
        var manifestPath = Path.Combine(root, "bootstrap.manifest.json");
        var manifestBytes = File.ReadAllBytes(manifestPath);
        var actualManifestHash = Convert.ToHexString(SHA256.HashData(manifestBytes)).ToLowerInvariant();
        if (!actualManifestHash.Equals(ManifestHash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The package manifest failed integrity verification.");
        using var manifest = JsonDocument.Parse(manifestBytes);
        if (!manifest.RootElement.TryGetProperty("files", out var files) || files.ValueKind != JsonValueKind.Array)
            throw new InvalidDataException("The package manifest is invalid.");
        var expectedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "bootstrap.manifest.json",
        };
        foreach (var file in files.EnumerateArray())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var relative = file.GetProperty("path").GetString() ?? throw new InvalidDataException("A package path is missing.");
            relative = relative.Replace('\\', '/').TrimStart('/');
            if (!expectedFiles.Add(relative))
                throw new InvalidDataException($"The package manifest contains a duplicate path: {relative}");
            var expectedSize = file.GetProperty("size").GetInt64();
            var expectedHash = file.GetProperty("sha256").GetString();
            var path = SafePayloadPath(root, relative);
            var info = new FileInfo(path);
            if (!info.Exists || info.Length != expectedSize)
                throw new InvalidDataException($"Packaged file is missing or damaged: {relative}");
            if (verifyHashes)
            {
                using var stream = File.OpenRead(path);
                var actualHash = Convert.ToHexString(SHA256.HashData(stream));
                if (!actualHash.Equals(expectedHash, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException($"Packaged file failed integrity verification: {relative}");
            }
        }
        VerifyNoUnexpectedFiles(root, expectedFiles, cancellationToken);
    }

    private static void VerifyNoUnexpectedFiles(
        string root,
        HashSet<string> expectedFiles,
        CancellationToken cancellationToken)
    {
        var pending = new Stack<string>();
        pending.Push(Path.GetFullPath(root));
        while (pending.Count > 0)
        {
            var directory = pending.Pop();
            foreach (var entry in Directory.EnumerateFileSystemEntries(directory))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var attributes = File.GetAttributes(entry);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException("The package contains an unsafe linked file or directory.");
                if ((attributes & FileAttributes.Directory) != 0)
                {
                    pending.Push(entry);
                    continue;
                }
                var relative = Path.GetRelativePath(root, entry).Replace('\\', '/');
                if (EmbeddedPayload && (relative.Equals(".complete", StringComparison.OrdinalIgnoreCase) ||
                                        relative.Equals(CacheLeaseFileName, StringComparison.OrdinalIgnoreCase))) continue;
                if (!expectedFiles.Contains(relative))
                    throw new InvalidDataException($"The package contains an undeclared file: {relative}");
            }
        }
    }

    private static string SafePayloadPath(string root, string relative)
    {
        var fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var target = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!target.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The package manifest contains an unsafe path.");
        return target;
    }

    private static void VerifyRequiredFiles(string root)
    {
        string[] required =
        [
            "node.exe",
            "runtime/launch.mjs",
            "three_browser_runtime.node",
            "three_native.dll",
            "three_webgpu.dll",
            "wgpu_native.dll",
            "glslangValidator.exe",
            "node_modules/three/package.json",
            "project/site-entry.mjs",
            "bootstrap.manifest.json",
        ];
        foreach (var relative in required)
            if (!File.Exists(SafePayloadPath(root, relative)))
                throw new InvalidDataException($"Required packaged dependency is missing: {relative}");
    }
}

internal sealed class OutputTail(int maximumCharacters)
{
    private readonly StringBuilder _text = new();
    private readonly object _gate = new();

    internal void Append(string line)
    {
        lock (_gate)
        {
            _text.AppendLine(line);
            if (_text.Length > maximumCharacters) _text.Remove(0, _text.Length - maximumCharacters);
        }
    }

    public override string ToString()
    {
        lock (_gate) return _text.ToString().Trim();
    }
}
""";
}
