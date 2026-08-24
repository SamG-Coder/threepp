using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Text.Json;

namespace ThreeBrowserRuntime;

internal sealed partial class RuntimeLauncherForm
{
    private BootstrapDraft? _bootstrapDraft;
    private BootstrapExportResult? _lastBootstrapExport;

    private async Task OpenBootstrapAsync(string id)
    {
        if (_running)
        {
            await InvokeUiAsync("notify", "Stop the current operation before exporting.", "error");
            return;
        }
        var entry = ResolveExportEntry(id);
        if (entry is null || !File.Exists(entry))
        {
            await InvokeUiAsync("notify", "That project is no longer available.", "error");
            await RefreshLibraryAsync();
            return;
        }

        var directory = Path.GetDirectoryName(entry)!;
        var name = BootstrapExporter.SanitizeFileName(ReadBootstrapDisplayName(directory, id));
        var destination = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "ThreeBrowser Exports");
        _bootstrapDraft = new BootstrapDraft(id, entry, name, destination);
        await InvokeUiAsync("bootstrapDialog", new { id, name, destination });
    }

    private async Task OpenCurrentBootstrapAsync()
    {
        if (_destination is null)
        {
            await InvokeUiAsync("notify", "Unpack or select a project first.", "error");
            return;
        }
        var id = Path.GetFileName(_destination.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        var entry = ResolveExportEntry(id);
        if (entry is null || !Path.GetDirectoryName(entry)!.Equals(
                Path.GetFullPath(_destination).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
        {
            await InvokeUiAsync("notify", "Only managed projects can be exported.", "error");
            return;
        }
        await OpenBootstrapAsync(id);
    }

    private async Task PickBootstrapAssetAsync(string kind)
    {
        if (_bootstrapDraft is null || _running) return;
        switch (kind)
        {
            case "output":
            {
                using var picker = new FolderBrowserDialog
                {
                    Description = "Choose where the ThreeBrowser app will be exported",
                    InitialDirectory = Directory.Exists(_bootstrapDraft.DestinationDirectory)
                        ? _bootstrapDraft.DestinationDirectory
                        : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                    UseDescriptionForTitle = true,
                    ShowNewFolderButton = true,
                };
                if (picker.ShowDialog(this) != DialogResult.OK) return;
                _bootstrapDraft.DestinationDirectory = Path.GetFullPath(picker.SelectedPath);
                await InvokeUiAsync("bootstrapOutput", _bootstrapDraft.DestinationDirectory);
                return;
            }
            case "icon":
            case "loading":
            case "certificate":
                break;
            default:
                return;
        }

        using var dialog = new OpenFileDialog
        {
            CheckFileExists = true,
            Multiselect = false,
            RestoreDirectory = true,
            Title = kind switch
            {
                "icon" => "Choose application icon",
                "loading" => "Choose shader loading image",
                _ => "Choose code-signing certificate",
            },
            Filter = kind switch
            {
                "icon" => "Icon or image|*.ico;*.png;*.jpg;*.jpeg;*.bmp|Windows icon|*.ico|Images|*.png;*.jpg;*.jpeg;*.bmp",
                "loading" => "Images|*.png;*.jpg;*.jpeg;*.bmp;*.gif|All files|*.*",
                _ => "Code-signing certificate|*.pfx;*.p12",
            },
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        var path = Path.GetFullPath(dialog.FileName);
        string? preview = null;
        if (kind is "icon" or "loading")
        {
            try { preview = CreateImagePreview(path, kind == "icon" ? new Size(160, 160) : new Size(480, 270)); }
            catch (Exception error)
            {
                await InvokeUiAsync("notify", $"Could not read that image: {error.Message}", "error");
                return;
            }
        }
        if (kind == "icon") _bootstrapDraft.IconPath = path;
        else if (kind == "loading") _bootstrapDraft.LoadingImagePath = path;
        else _bootstrapDraft.CertificatePath = path;
        await InvokeUiAsync("bootstrapAsset", kind, Path.GetFileName(path), preview);
    }

    private async Task BuildBootstrapAsync(JsonElement request)
    {
        if (_running || _bootstrapDraft is null) return;
        var draft = _bootstrapDraft;
        var id = request.TryGetProperty("id", out var idNode) ? idNode.GetString() : null;
        if (!string.Equals(id, draft.Id, StringComparison.Ordinal))
        {
            await InvokeUiAsync("notify", "The selected project changed. Reopen the export dialog.", "error");
            return;
        }
        var entry = ResolveExportEntry(draft.Id);
        if (entry is null || !entry.Equals(draft.Entry, StringComparison.OrdinalIgnoreCase))
        {
            await InvokeUiAsync("notify", "That project is no longer available.", "error");
            return;
        }

        var name = GetString(request, "name").Trim();
        var packageMode = GetString(request, "packageMode") == "portable"
            ? BootstrapPackageMode.PortableDirectory
            : BootstrapPackageMode.SingleExecutable;
        var signingMode = GetString(request, "signingMode") switch
        {
            "pfx" => BootstrapSigningMode.PfxCertificate,
            "self" => BootstrapSigningMode.SelfSigned,
            _ => BootstrapSigningMode.Unsigned,
        };
        if (signingMode == BootstrapSigningMode.PfxCertificate && string.IsNullOrWhiteSpace(draft.CertificatePath))
        {
            await InvokeUiAsync("notify", "Choose a .pfx or .p12 signing certificate.", "error");
            return;
        }
        var options = new BootstrapExportOptions(
            name,
            draft.DestinationDirectory,
            packageMode,
            draft.IconPath,
            draft.LoadingImagePath,
            signingMode,
            draft.CertificatePath,
            GetString(request, "certificatePassword"),
            GetString(request, "selfSignedSubject"),
            GetString(request, "timestampUrl"),
            request.TryGetProperty("keepGeneratedProject", out var keepNode) && keepNode.ValueKind == JsonValueKind.True);

        _lastBootstrapExport = null;
        while (_pendingLines.TryDequeue(out _)) { }
        _operation = new CancellationTokenSource();
        SetRunning(true);
        await InvokeUiAsync("beginBootstrap", name, draft.DestinationDirectory);
        await StatusAsync("Building self-contained Windows export…", "active");
        await AppendAsync($"threebrowser export \"{entry}\"", "command");
        try
        {
            var reporter = new Progress<BootstrapExportProgress>(item => _ = AppendAsync(item.Message, item.Kind));
            var exporter = new BootstrapExporter(_runtimeDirectory, _nodeExecutable);
            var result = await Task.Run(
                () => exporter.ExportAsync(entry, options, reporter,
                    process => _activeProcess = process, _operation.Token),
                _operation.Token);
            _lastBootstrapExport = result;
            await InvokeUiAsync("bootstrapComplete", result.ExecutablePath, result.CertificatePath, result.GeneratedProjectPath);
            await StatusAsync($"Export ready · {Path.GetFileName(result.ExecutablePath)}", "ready");
        }
        catch (OperationCanceledException)
        {
            await AppendAsync("Export cancelled. No incomplete output was retained.", "muted");
            await InvokeUiAsync("bootstrapFailed", "Export cancelled");
            await StatusAsync("Export cancelled", "ready");
        }
        catch (Exception error)
        {
            await AppendAsync($"Export failed: {error.Message}", "error");
            await InvokeUiAsync("bootstrapFailed", error.Message);
            await StatusAsync("Could not build the Windows export", "error");
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

    private async Task RevealBootstrapAsync()
    {
        var executable = _lastBootstrapExport?.ExecutablePath;
        if (executable is null || !File.Exists(executable))
        {
            await InvokeUiAsync("notify", "The exported executable is no longer available.", "error");
            return;
        }
        var start = new ProcessStartInfo("explorer.exe") { UseShellExecute = true };
        start.ArgumentList.Add("/select,");
        start.ArgumentList.Add(executable);
        Process.Start(start);
    }

    private async Task RunBootstrapAsync()
    {
        var executable = _lastBootstrapExport?.ExecutablePath;
        if (executable is null || !File.Exists(executable))
        {
            await InvokeUiAsync("notify", "The exported executable is no longer available.", "error");
            return;
        }
        Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(executable)! });
    }

    private static string ReadBootstrapDisplayName(string directory, string fallback)
    {
        try
        {
            var metadataPath = Path.Combine(directory, ".threebrowser-library.json");
            if (File.Exists(metadataPath))
            {
                using var metadata = JsonDocument.Parse(File.ReadAllText(metadataPath));
                if (metadata.RootElement.TryGetProperty("displayName", out var node) && !string.IsNullOrWhiteSpace(node.GetString()))
                    return node.GetString()!.Trim();
            }
            var manifestPath = Path.Combine(directory, "threebrowser.pull.json");
            if (File.Exists(manifestPath))
            {
                using var manifest = JsonDocument.Parse(File.ReadAllText(manifestPath));
                if (manifest.RootElement.TryGetProperty("source", out var node) && !string.IsNullOrWhiteSpace(node.GetString()))
                    return DisplayNameFromSource(node.GetString()!, fallback);
            }
        }
        catch { }
        return HumanizeName(fallback);
    }

    private static string CreateImagePreview(string path, Size bounds)
    {
        using Image source = Path.GetExtension(path).Equals(".ico", StringComparison.OrdinalIgnoreCase)
            ? new Icon(path, bounds.Width, bounds.Height).ToBitmap()
            : Image.FromFile(path);
        using var preview = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(preview);
        graphics.Clear(Color.Transparent);
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        graphics.SmoothingMode = SmoothingMode.HighQuality;
        var scale = Math.Min((double)bounds.Width / source.Width, (double)bounds.Height / source.Height);
        var width = Math.Max(1, (int)Math.Round(source.Width * scale));
        var height = Math.Max(1, (int)Math.Round(source.Height * scale));
        graphics.DrawImage(source, (bounds.Width - width) / 2, (bounds.Height - height) / 2, width, height);
        using var stream = new MemoryStream();
        preview.Save(stream, ImageFormat.Png);
        return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
    }

    private static string GetString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";

    private sealed class BootstrapDraft(string id, string entry, string suggestedName, string destinationDirectory)
    {
        internal string Id { get; } = id;
        internal string Entry { get; } = entry;
        internal string SuggestedName { get; } = suggestedName;
        internal string DestinationDirectory { get; set; } = destinationDirectory;
        internal string? IconPath { get; set; }
        internal string? LoadingImagePath { get; set; }
        internal string? CertificatePath { get; set; }
    }
}
