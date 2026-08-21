using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ThreeBrowser;

internal sealed class SandboxEditorForm : Form
{
    private readonly WebView2 _editor = new();
    private readonly CoreWebView2Environment _environment;
    private readonly string _webRoot;
    private readonly Label _identity = new();
    private readonly Label _status = new();
    private readonly ChromeButton _aiButton;
    private readonly HttpClient _ollama = new()
    {
        BaseAddress = new Uri("http://127.0.0.1:11434/"),
        Timeout = Timeout.InfiniteTimeSpan,
    };
    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private CancellationTokenSource? _generation;
    private bool _detectingModels;
    private bool _promptVisible;
    private readonly List<string> _modelNames = new();
    private string _ollamaStatusText = "Open the AI panel to detect local Ollama.";
    private IReadOnlyList<SandboxPageSummary> _savedPages = [];
    private Guid? _sandboxId;
    private string _filePath = "index.html";
    private string _pendingHtml = "";
    private string _eol = "CRLF";

    internal event EventHandler? SaveRequested;
    internal event EventHandler? NavigateRequested;
    internal event EventHandler? NewRequested;
    internal event Action<object?, Guid, string>? FileOpenRequested;
    internal event Action<object?, Guid>? DeleteRequested;
    internal event Action<object?, IReadOnlyList<SandboxImportFile>>? ImportRequested;

    internal bool IsDirty { get; private set; }

    internal SandboxEditorForm(Icon? icon, CoreWebView2Environment environment, string webRoot)
    {
        _environment = environment;
        _webRoot = webRoot;
        Text = "ThreeBrowser Sandbox";
        Width = 1100;
        Height = 760;
        MinimumSize = new Size(760, 520);
        StartPosition = FormStartPosition.CenterParent;
        BackColor = Color.White;
        Font = new Font("Segoe UI", 9f);
        KeyPreview = true;
        if (icon != null)
        {
            Icon = icon;
            ShowIcon = true;
        }

        var toolbar = new Panel
        {
            Dock = DockStyle.Top,
            Height = 52,
            BackColor = BrowserChrome.Bar,
            Padding = new Padding(12, 0, 6, 0),
        };
        var heading = new Label
        {
            Dock = DockStyle.Left,
            Width = 210,
            Text = "⚗  Sandbox",
            Font = new Font("Segoe UI Semibold", 11f),
            ForeColor = BrowserChrome.Ink,
            TextAlign = ContentAlignment.MiddleLeft,
        };
        _identity.Dock = DockStyle.Fill;
        _identity.ForeColor = BrowserChrome.Mute;
        _identity.TextAlign = ContentAlignment.MiddleLeft;
        _identity.AutoEllipsis = true;

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Right,
            Width = 144,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            Padding = new Padding(0, 10, 0, 10),
            Margin = new Padding(0),
            BackColor = BrowserChrome.Bar,
        };
        _aiButton = MakeButton('✦', false, "AI website generator", symbolFont: true);
        var newButton = MakeButton('\uE710', false, "New sandbox");
        var saveButton = MakeButton('\uE74E', false, "Save (Ctrl+S)");
        var navigateButton = MakeButton('\uE72A', true, "Navigate (Ctrl+Enter)");
        _aiButton.Click += async (_, _) => await TogglePromptPanelAsync();
        newButton.Click += (_, _) => NewRequested?.Invoke(this, EventArgs.Empty);
        saveButton.Click += (_, _) => SaveRequested?.Invoke(this, EventArgs.Empty);
        navigateButton.Click += (_, _) => NavigateRequested?.Invoke(this, EventArgs.Empty);
        actions.Controls.Add(_aiButton);
        actions.Controls.Add(newButton);
        actions.Controls.Add(saveButton);
        actions.Controls.Add(navigateButton);

        toolbar.Controls.Add(_identity);
        toolbar.Controls.Add(actions);
        toolbar.Controls.Add(heading);

        var rule = new Panel
        {
            Dock = DockStyle.Top,
            Height = 1,
            BackColor = BrowserChrome.Line,
        };
        _status.Dock = DockStyle.Bottom;
        _status.Height = 24;
        _status.Padding = new Padding(12, 0, 8, 0);
        _status.BackColor = Color.FromArgb(0, 122, 204);
        _status.ForeColor = Color.White;
        _status.Font = new Font("Segoe UI", 8.5f);
        _status.TextAlign = ContentAlignment.MiddleLeft;
        _status.AutoEllipsis = true;

        _editor.Dock = DockStyle.Fill;
        _editor.DefaultBackgroundColor = Color.White;
        Controls.Add(_editor);
        Controls.Add(_status);
        Controls.Add(rule);
        Controls.Add(toolbar);
        UpdateLabels();
        _ = InitializeEditorAsync();
    }

    internal void LoadSandbox(Guid? id, string filePath, string html)
    {
        _sandboxId = id;
        _filePath = filePath;
        _pendingHtml = html;
        IsDirty = false;
        _eol = html.Contains("\r\n", StringComparison.Ordinal) ? "CRLF" : "LF";
        UpdateLabels();
        if (_ready.Task.IsCompletedSuccessfully)
        {
            _ = SetEditorTextAsync(html);
        }
    }

    internal async Task<string> GetHtmlAsync()
    {
        await _ready.Task;
        var json = await _editor.CoreWebView2.ExecuteScriptAsync("window.sandboxEditor.getValue()");
        return JsonSerializer.Deserialize<string>(json) ?? "";
    }

    internal void MarkSaved(Guid id, string filePath)
    {
        _sandboxId = id;
        _filePath = filePath;
        IsDirty = false;
        UpdateLabels();
    }

    internal void SetSavedPages(
        IReadOnlyList<SandboxPageSummary> pages,
        Guid? activeId,
        string activeFilePath)
    {
        _savedPages = pages;
        _sandboxId = activeId;
        _filePath = activeFilePath;
        if (_ready.Task.IsCompletedSuccessfully)
        {
            _ = PushSavedPagesAsync();
        }
    }

    internal void ReportImport(int fileCount)
    {
        if (_ready.Task.IsCompletedSuccessfully)
        {
            _ = _editor.CoreWebView2.ExecuteScriptAsync(
                $"window.sandboxEditor.finishImport({fileCount})");
        }
    }

    internal void ReportImportError(string message)
    {
        if (_ready.Task.IsCompletedSuccessfully)
        {
            var json = JsonSerializer.Serialize(message);
            _ = _editor.CoreWebView2.ExecuteScriptAsync($"window.sandboxEditor.failImport({json})");
        }
    }

    internal void ReportExternalChange(string path)
    {
        _status.Text = $"Agent changed {path} on disk — reopen the file to load it without discarding your edits";
    }

    internal void ReportExternalDeletion(string path)
    {
        _status.Text = $"Agent deleted {path} on disk — your open editor content has been preserved";
    }

    internal void ApplyExternalRename(string path)
    {
        _filePath = path;
        UpdateLabels();
        if (IsDirty)
        {
            _status.Text = $"Agent renamed the open file to {path} — your unsaved edits are still open";
        }
    }

    internal static string SandboxUrl(Guid id, string path = "index.html") =>
        $"https://sandbox.threebrowser.local/{id:D}/{EscapeUrlPath(path)}";

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (_ready.Task.IsCompletedSuccessfully)
        {
            _ = _editor.CoreWebView2.ExecuteScriptAsync("window.sandboxEditor.focus()");
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing)
        {
            _generation?.Cancel();
            e.Cancel = true;
            Hide();
            return;
        }
        base.OnFormClosing(e);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _generation?.Cancel();
            _generation?.Dispose();
            _ollama.Dispose();
        }
        base.Dispose(disposing);
    }

    private async Task TogglePromptPanelAsync()
    {
        await _ready.Task;
        _promptVisible = !_promptVisible;
        _aiButton.BackColor = _promptVisible ? BrowserChrome.NativeFill : Color.Transparent;
        _aiButton.ForeColor = _promptVisible ? BrowserChrome.NativeInk : BrowserChrome.Ink;
        await _editor.CoreWebView2.ExecuteScriptAsync(
            $"window.sandboxEditor.setPromptVisible({(_promptVisible ? "true" : "false")})");
        if (!_promptVisible)
        {
            return;
        }
        await PushPromptStateAsync();
        if (_modelNames.Count == 0)
        {
            await DetectModelsAsync(force: false);
        }
    }

    private async Task DetectModelsAsync(bool force)
    {
        if (_detectingModels || _generation != null || (!force && _modelNames.Count > 0))
        {
            return;
        }
        _detectingModels = true;
        _ollamaStatusText = "Detecting local Ollama…";
        if (force)
        {
            _modelNames.Clear();
        }
        await PushPromptStateAsync();

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        try
        {
            using var response = await _ollama.GetAsync("api/tags", timeout.Token);
            response.EnsureSuccessStatusCode();
            await using var content = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var json = await JsonDocument.ParseAsync(content, cancellationToken: timeout.Token);
            if (json.RootElement.TryGetProperty("models", out var models))
            {
                foreach (var model in models.EnumerateArray())
                {
                    var name = model.TryGetProperty("name", out var value) ? value.GetString() : null;
                    if (!string.IsNullOrWhiteSpace(name))
                    {
                        _modelNames.Add(name);
                    }
                }
            }
            if (_modelNames.Count == 0)
            {
                _ollamaStatusText = "Ollama is running, but no models are installed.";
                return;
            }
            _ollamaStatusText = $"{_modelNames.Count} local model{(_modelNames.Count == 1 ? "" : "s")} found";
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _ollamaStatusText = "Ollama was not detected. Start Ollama, then retry.";
        }
        finally
        {
            _detectingModels = false;
            await PushPromptStateAsync();
        }
    }

    private async Task GenerateAsync(string requestText, string model)
    {
        if (_generation != null || !_modelNames.Contains(model, StringComparer.Ordinal))
        {
            return;
        }
        requestText = requestText.Trim();
        if (requestText.Length == 0)
        {
            return;
        }

        var currentHtml = await GetHtmlAsync();
        if (IsDirty && MessageBox.Show(
                this,
                "Replace the current unsaved HTML with the generated page?",
                "Generate website",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question) != DialogResult.Yes)
        {
            return;
        }

        _generation = new CancellationTokenSource();
        var cancellationToken = _generation.Token;
        await SetGeneratingAsync(true);
        IsDirty = true;
        UpdateLabels();
        var generatedChars = 0;
        try
        {
            await BeginStreamAsync(_eol);
            var payload = new
            {
                model,
                stream = true,
                think = false,
                options = new { temperature = 0.35 },
                messages = new object[]
                {
                    new
                    {
                        role = "system",
                        content = HtmlSystemPrompt,
                    },
                    new
                    {
                        role = "user",
                        content = "Website request:\n" + requestText +
                                  "\n\nCurrent HTML (reuse it when the request is a modification):\n" + currentHtml,
                    },
                },
            };
            using var request = new HttpRequestMessage(HttpMethod.Post, "api/chat")
            {
                Content = JsonContent.Create(payload),
            };
            using var response = await _ollama.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
            response.EnsureSuccessStatusCode();
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var reader = new StreamReader(stream, Encoding.UTF8);
            while (await reader.ReadLineAsync(cancellationToken) is { } line)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (line.Length == 0)
                {
                    continue;
                }
                using var chunk = JsonDocument.Parse(line);
                var root = chunk.RootElement;
                if (root.TryGetProperty("message", out var message) &&
                    message.TryGetProperty("content", out var content))
                {
                    var text = content.GetString();
                    if (!string.IsNullOrEmpty(text))
                    {
                        generatedChars += text.Length;
                        await AppendStreamAsync(text);
                        if (generatedChars % 64 < text.Length)
                        {
                            _ollamaStatusText = $"Generating with {model}… {generatedChars:N0} characters";
                            await PushPromptStateAsync();
                        }
                    }
                }
                if (root.TryGetProperty("done", out var done) && done.GetBoolean())
                {
                    break;
                }
            }
            await FinishStreamAsync();
            var generated = await GetHtmlAsync();
            var cleaned = StripMarkdownFence(generated);
            if (!string.Equals(generated, cleaned, StringComparison.Ordinal))
            {
                await SetEditorTextAsync(cleaned);
            }
            _ollamaStatusText = $"Generated {cleaned.Length:N0} characters with {model}";
        }
        catch (OperationCanceledException)
        {
            await FinishStreamAsync();
            _ollamaStatusText = "Generation stopped. Partial HTML was kept.";
        }
        catch (Exception ex)
        {
            await FinishStreamAsync();
            _ollamaStatusText = "Generation failed: " + ex.Message;
        }
        finally
        {
            _generation.Dispose();
            _generation = null;
            await SetGeneratingAsync(false);
        }
    }

    private async Task SetGeneratingAsync(bool generating)
    {
        await PushPromptStateAsync(generating);
    }

    private Task PushPromptStateAsync(bool? generating = null)
    {
        if (!_ready.Task.IsCompletedSuccessfully)
        {
            return Task.CompletedTask;
        }
        var state = new
        {
            status = _ollamaStatusText,
            models = _modelNames,
            detecting = _detectingModels,
            generating = generating ?? _generation != null,
        };
        var json = JsonSerializer.Serialize(state);
        return _editor.CoreWebView2.ExecuteScriptAsync($"window.sandboxEditor.setOllamaState({json})");
    }

    private async Task BeginStreamAsync(string eol)
    {
        await _ready.Task;
        var json = JsonSerializer.Serialize(eol);
        await _editor.CoreWebView2.ExecuteScriptAsync($"window.sandboxEditor.beginStream({json})");
    }

    private Task AppendStreamAsync(string text)
    {
        var json = JsonSerializer.Serialize(text);
        return _editor.CoreWebView2.ExecuteScriptAsync($"window.sandboxEditor.appendChunk({json})");
    }

    private Task FinishStreamAsync() =>
        _editor.CoreWebView2.ExecuteScriptAsync("window.sandboxEditor.finishStream()");

    private static string StripMarkdownFence(string html)
    {
        var trimmed = html.Trim();
        if (!trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            return html;
        }
        var firstLine = trimmed.IndexOf('\n');
        if (firstLine < 0)
        {
            return html;
        }
        var body = trimmed[(firstLine + 1)..];
        if (body.EndsWith("```", StringComparison.Ordinal))
        {
            body = body[..^3].TrimEnd();
        }
        var eol = html.Contains("\r\n", StringComparison.Ordinal) ? "\r\n" : "\n";
        return body.Replace("\r\n", "\n", StringComparison.Ordinal)
                   .Replace("\r", "\n", StringComparison.Ordinal)
                   .Replace("\n", eol, StringComparison.Ordinal);
    }

    private const string HtmlSystemPrompt = """
        You are the HTML generator inside ThreeBrowser Sandbox.
        Return only one complete, runnable HTML5 document. Begin with <!doctype html>.
        Never use Markdown fences. Never include commentary, explanations, or text outside the HTML document.
        Put CSS in <style> and JavaScript in <script> so the result is a self-contained single HTML file.
        Create a polished, accessible, responsive page that directly follows the user's request.
        Do not use external assets, packages, or network requests unless the user explicitly asks for them.
        When asked to modify an existing document, return the entire updated HTML document, not a patch.
        """;

    private async Task InitializeEditorAsync()
    {
        try
        {
            await _editor.EnsureCoreWebView2Async(_environment);
            _editor.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            _editor.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            _editor.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "threebrowser.local",
                _webRoot,
                CoreWebView2HostResourceAccessKind.Allow);
            _editor.CoreWebView2.WebMessageReceived += OnEditorMessage;
            _editor.CoreWebView2.Navigate("https://threebrowser.local/sandbox-editor/index.html");
        }
        catch (Exception ex)
        {
            _ready.TrySetException(ex);
            MessageBox.Show(this, ex.Message, "Sandbox editor failed to start");
        }
    }

    private async void OnEditorMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var root = message.RootElement;
            var type = root.TryGetProperty("type", out var typeValue) ? typeValue.GetString() : "";
            if (root.TryGetProperty("eol", out var eolValue))
            {
                _eol = eolValue.GetString() == "CRLF" ? "CRLF" : "LF";
            }
            switch (type)
            {
                case "ready":
                    _ready.TrySetResult();
                    await SetEditorTextAsync(_pendingHtml);
                    await PushPromptStateAsync();
                    await PushSavedPagesAsync();
                    break;
                case "changed":
                    IsDirty = true;
                    UpdateLabels();
                    break;
                case "save":
                    SaveRequested?.Invoke(this, EventArgs.Empty);
                    break;
                case "navigate":
                    NavigateRequested?.Invoke(this, EventArgs.Empty);
                    break;
                case "new":
                    NewRequested?.Invoke(this, EventArgs.Empty);
                    break;
                case "file-open":
                    if (TryReadId(root, out var openId) && TryReadPath(root, out var openPath))
                    {
                        FileOpenRequested?.Invoke(this, openId, openPath);
                    }
                    break;
                case "page-delete":
                    if (TryReadId(root, out var deleteId))
                    {
                        DeleteRequested?.Invoke(this, deleteId);
                    }
                    break;
                case "files-import":
                    var files = ReadImportFiles(root);
                    if (files.Count > 0)
                    {
                        ImportRequested?.Invoke(this, files);
                    }
                    break;
                case "prompt-generate":
                {
                    var prompt = root.TryGetProperty("prompt", out var promptValue)
                        ? promptValue.GetString() ?? ""
                        : "";
                    var model = root.TryGetProperty("model", out var modelValue)
                        ? modelValue.GetString() ?? ""
                        : "";
                    await GenerateAsync(prompt, model);
                    break;
                }
                case "prompt-stop":
                    _generation?.Cancel();
                    break;
                case "prompt-retry":
                    await DetectModelsAsync(force: true);
                    break;
                case "prompt-close":
                    _promptVisible = false;
                    _aiButton.BackColor = Color.Transparent;
                    _aiButton.ForeColor = BrowserChrome.Ink;
                    break;
                case "eol":
                case "loaded":
                    UpdateLabels();
                    break;
            }
        }
        catch (Exception ex) when (ex is JsonException or FormatException or InvalidDataException)
        {
            ReportImportError(ex.Message);
        }
    }

    private Task SetEditorTextAsync(string text)
    {
        var pathJson = JsonSerializer.Serialize(_filePath);
        var textJson = JsonSerializer.Serialize(text);
        return _editor.CoreWebView2.ExecuteScriptAsync(
            $"window.sandboxEditor.setFile({pathJson}, {textJson})");
    }

    private Task PushSavedPagesAsync()
    {
        if (!_ready.Task.IsCompletedSuccessfully)
        {
            return Task.CompletedTask;
        }
        var state = new
        {
            activeId = _sandboxId?.ToString("D"),
            activeFile = _filePath,
            pages = _savedPages.Select(page => new
            {
                id = page.Id.ToString("D"),
                title = page.Title,
                updatedUtc = page.UpdatedUtc,
                entryPath = page.EntryPath,
                url = SandboxUrl(page.Id, page.EntryPath),
                directories = new SandboxStore().ListDirectories(page.Id),
                files = page.Files.Select(file => new
                {
                    path = file.Path,
                    size = file.Size,
                    isHtml = file.IsHtml,
                }),
            }),
        };
        var json = JsonSerializer.Serialize(state);
        return _editor.CoreWebView2.ExecuteScriptAsync($"window.sandboxEditor.setPages({json})");
    }

    private static bool TryReadId(JsonElement root, out Guid id)
    {
        id = Guid.Empty;
        return root.TryGetProperty("id", out var value) && Guid.TryParse(value.GetString(), out id);
    }

    private static bool TryReadPath(JsonElement root, out string path)
    {
        path = root.TryGetProperty("path", out var value) ? value.GetString() ?? "" : "";
        return path.Length > 0;
    }

    private static IReadOnlyList<SandboxImportFile> ReadImportFiles(JsonElement root)
    {
        const int maxFileBytes = 25 * 1024 * 1024;
        const int maxTotalBytes = 75 * 1024 * 1024;
        if (!root.TryGetProperty("files", out var values) || values.ValueKind != JsonValueKind.Array)
        {
            return [];
        }
        var files = new List<SandboxImportFile>();
        var total = 0;
        foreach (var value in values.EnumerateArray())
        {
            var path = value.TryGetProperty("path", out var pathValue) ? pathValue.GetString() : null;
            var base64 = value.TryGetProperty("data", out var dataValue) ? dataValue.GetString() : null;
            if (string.IsNullOrWhiteSpace(path) || string.IsNullOrEmpty(base64))
            {
                continue;
            }
            var content = Convert.FromBase64String(base64);
            if (content.Length > maxFileBytes || total + content.Length > maxTotalBytes)
            {
                throw new InvalidDataException("The import is too large. Files are limited to 25 MB each and 75 MB total.");
            }
            total += content.Length;
            files.Add(new SandboxImportFile(path, content));
        }
        return files;
    }

    private static string EscapeUrlPath(string path) =>
        string.Join('/', path.Replace('\\', '/').Split('/').Select(Uri.EscapeDataString));

    private void UpdateLabels()
    {
        var modified = IsDirty ? "  •  Modified" : "";
        var language = Path.GetExtension(_filePath).TrimStart('.').ToUpperInvariant();
        if (language.Length == 0)
        {
            language = "TEXT";
        }
        if (_sandboxId is Guid id)
        {
            _identity.Text = _filePath + modified;
            _status.Text = SandboxUrl(id, _filePath) + $"    {language}    {_eol}    UTF-8";
        }
        else
        {
            _identity.Text = "New sandbox" + modified;
            _status.Text = $"GUID is created on first save    {language}    {_eol}    UTF-8";
        }
    }

    private static ChromeButton MakeButton(
        char glyph,
        bool primary,
        string accessibleName,
        bool symbolFont = false)
    {
        var button = new ChromeButton
        {
            Text = glyph.ToString(),
            AccessibleName = accessibleName,
            Size = new Size(32, 32),
            Margin = new Padding(2, 0, 2, 0),
            BackColor = Color.Transparent,
            ForeColor = primary ? BrowserChrome.Accent : BrowserChrome.Ink,
            Font = new Font(symbolFont ? "Segoe UI Symbol" : "Segoe MDL2 Assets", symbolFont ? 12f : 10f),
        };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = BrowserChrome.Hover;
        button.FlatAppearance.MouseDownBackColor = BrowserChrome.Press;
        var tip = new ToolTip();
        tip.SetToolTip(button, accessibleName);
        return button;
    }
}
