using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ThreeBrowser;

internal sealed class AgentProjectChangedEventArgs(
    Guid projectId,
    IReadOnlyList<string> changedFiles,
    string? previousPath = null,
    string? currentPath = null,
    bool isDirectory = false) : EventArgs
{
    internal Guid ProjectId { get; } = projectId;
    internal IReadOnlyList<string> ChangedFiles { get; } = changedFiles;
    internal string? PreviousPath { get; } = previousPath;
    internal string? CurrentPath { get; } = currentPath;
    internal bool IsDirectory { get; } = isDirectory;
}

internal sealed class AgentHarnessForm : Form
{
    private readonly WebView2 _view = new();
    private readonly CoreWebView2Environment _environment;
    private readonly string _webRoot;
    private readonly SandboxStore _sandboxStore;
    private readonly Label _identity = new();
    private readonly Label _statusLabel = new();
    private readonly ChromeButton _refreshButton;
    private readonly ChromeButton _stopButton;
    private readonly HttpClient _ollama = new()
    {
        BaseAddress = new Uri("http://127.0.0.1:11434/"),
        Timeout = Timeout.InfiniteTimeSpan,
    };
    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly List<string> _models = new();
    private IReadOnlyList<SandboxPageSummary> _projects = [];
    private Guid? _projectId;
    private string _status = "Choose a saved sandbox project.";
    private bool _detecting;
    private CancellationTokenSource? _runCancellation;
    private AgentHarness? _harness;
    private readonly object _changeLock = new();
    private readonly HashSet<string> _changedFiles = new(StringComparer.OrdinalIgnoreCase);

    internal event EventHandler<AgentProjectChangedEventArgs>? ProjectChanged;
    internal event Action<Guid, string>? FileOpenRequested;
    internal event Action<Guid, string>? NavigateRequested;

    internal void RefreshFromStore()
    {
        if (IsDisposed)
        {
            return;
        }
        if (InvokeRequired)
        {
            BeginInvoke(RefreshFromStore);
            return;
        }
        RefreshProjects();
        _ = PushStateAsync();
    }

    internal AgentHarnessForm(
        Icon? icon,
        CoreWebView2Environment environment,
        string webRoot,
        SandboxStore sandboxStore)
    {
        _environment = environment;
        _webRoot = webRoot;
        _sandboxStore = sandboxStore;
        Text = "Offline Agent Harness – ThreeBrowser";
        Width = 1120;
        Height = 780;
        MinimumSize = new Size(820, 560);
        StartPosition = FormStartPosition.CenterParent;
        BackColor = Color.White;
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
            Width = 220,
            Text = "◇  Agent Harness",
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
            Width = 72,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            Padding = new Padding(0, 10, 0, 10),
            Margin = new Padding(0),
            BackColor = BrowserChrome.Bar,
        };
        _refreshButton = MakeButton('\uE72C', "Refresh sandbox projects and Ollama models");
        _stopButton = MakeButton('\uE71A', "Stop agent run");
        _refreshButton.Click += async (_, _) =>
        {
            RefreshProjects();
            await DetectModelsAsync(force: true);
        };
        _stopButton.Click += (_, _) => _runCancellation?.Cancel();
        actions.Controls.Add(_refreshButton);
        actions.Controls.Add(_stopButton);
        toolbar.Controls.Add(_identity);
        toolbar.Controls.Add(actions);
        toolbar.Controls.Add(heading);

        var rule = new Panel
        {
            Dock = DockStyle.Top,
            Height = 1,
            BackColor = BrowserChrome.Line,
        };
        _statusLabel.Dock = DockStyle.Bottom;
        _statusLabel.Height = 24;
        _statusLabel.Padding = new Padding(12, 0, 8, 0);
        _statusLabel.BackColor = Color.FromArgb(0, 122, 204);
        _statusLabel.ForeColor = Color.White;
        _statusLabel.Font = new Font("Segoe UI", 8.5f);
        _statusLabel.TextAlign = ContentAlignment.MiddleLeft;
        _statusLabel.AutoEllipsis = true;
        _view.Dock = DockStyle.Fill;
        _view.DefaultBackgroundColor = Color.White;
        Controls.Add(_view);
        Controls.Add(_statusLabel);
        Controls.Add(rule);
        Controls.Add(toolbar);
        RefreshProjects();
        UpdateChrome();
        _ = InitializeAsync();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            return;
        }
        base.OnFormClosing(e);
    }

    protected override async void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        if (!Visible || IsDisposed)
        {
            return;
        }
        RefreshProjects();
        await PushStateAsync();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _runCancellation?.Cancel();
            _runCancellation?.Dispose();
            _harness?.Dispose();
            _ollama.Dispose();
        }
        base.Dispose(disposing);
    }

    private async Task InitializeAsync()
    {
        try
        {
            await _view.EnsureCoreWebView2Async(_environment);
            _view.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            _view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            _view.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "threebrowser.local",
                _webRoot,
                CoreWebView2HostResourceAccessKind.Allow);
            _view.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            _view.CoreWebView2.WebResourceRequested += BlockRemoteWebRequests;
            _view.CoreWebView2.WebMessageReceived += OnMessage;
            _view.CoreWebView2.Navigate("https://threebrowser.local/agent-harness/index.html");
        }
        catch (Exception ex)
        {
            _ready.TrySetException(ex);
            MessageBox.Show(this, ex.Message, "Agent harness failed to start");
        }
    }

    private void BlockRemoteWebRequests(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri) &&
            uri.Host.Equals("threebrowser.local", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }
        e.Response = _view.CoreWebView2.Environment.CreateWebResourceResponse(
            new MemoryStream(Encoding.UTF8.GetBytes("Network access is disabled in the Agent Harness.")),
            403,
            "Forbidden",
            "Content-Type: text/plain; charset=utf-8\r\nCache-Control: no-store");
    }

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var root = message.RootElement;
            var type = root.TryGetProperty("type", out var typeValue) ? typeValue.GetString() : "";
            switch (type)
            {
                case "ready":
                    _ready.TrySetResult();
                    RefreshProjects();
                    await PushStateAsync();
                    await DetectModelsAsync(force: false);
                    break;
                case "select-project":
                    if (root.TryGetProperty("id", out var idValue) &&
                        Guid.TryParse(idValue.GetString(), out var projectId) &&
                        _projects.Any(project => project.Id == projectId))
                    {
                        _projectId = projectId;
                        ClearChangedFiles();
                        _status = "Sandbox project exposed. Parent directories and the internet remain inaccessible.";
                        await PushStateAsync();
                    }
                    break;
                case "refresh-projects":
                    RefreshProjects();
                    await PushStateAsync();
                    break;
                case "new-project":
                    if (_runCancellation == null)
                    {
                        var title = ReadMessageString(root, "title");
                        var created = _sandboxStore.CreateProject(title);
                        _projectId = created.Id;
                        ClearChangedFiles();
                        _status = $"Created and saved {created.Title}.";
                        RefreshProjects();
                        ProjectChanged?.Invoke(this, new AgentProjectChangedEventArgs(created.Id, [created.EntryPath]));
                        await PushStateAsync();
                    }
                    break;
                case "rename-project":
                    if (_runCancellation == null && _projectId is Guid renameProjectId)
                    {
                        _sandboxStore.RenameProject(renameProjectId, ReadMessageString(root, "title"));
                        _status = "Project name saved.";
                        RefreshProjects();
                        ProjectChanged?.Invoke(this, new AgentProjectChangedEventArgs(renameProjectId, []));
                        await PushStateAsync();
                    }
                    break;
                case "new-file":
                    if (_runCancellation == null && _projectId is Guid newFileProjectId)
                    {
                        var path = _sandboxStore.CreateFile(newFileProjectId, ReadMessageString(root, "path"));
                        RegisterManagedChange(newFileProjectId, path);
                        _status = $"Created and saved {path}.";
                        RefreshProjects();
                        await PushStateAsync();
                    }
                    break;
                case "rename-file":
                    if (_runCancellation == null && _projectId is Guid renameFileProjectId)
                    {
                        var previousPath = ReadMessageString(root, "path");
                        var currentPath = _sandboxStore.RenameFile(
                            renameFileProjectId,
                            previousPath,
                            ReadMessageString(root, "newPath"));
                        RegisterManagedChange(renameFileProjectId, currentPath, previousPath, currentPath);
                        _status = $"Renamed {previousPath} to {currentPath}.";
                        RefreshProjects();
                        await PushStateAsync();
                    }
                    break;
                case "delete-file":
                    if (_runCancellation == null && _projectId is Guid deleteFileProjectId)
                    {
                        var path = ReadMessageString(root, "path");
                        _sandboxStore.DeleteFile(deleteFileProjectId, path);
                        RegisterManagedChange(deleteFileProjectId, path, path, null);
                        _status = $"Deleted {path}.";
                        RefreshProjects();
                        await PushStateAsync();
                    }
                    break;
                case "open-file":
                    if (_projectId is Guid openFileProjectId)
                    {
                        FileOpenRequested?.Invoke(openFileProjectId, ReadMessageString(root, "path"));
                    }
                    break;
                case "navigate-project":
                    if (_projectId is Guid navigateProjectId)
                    {
                        NavigateProject(navigateProjectId);
                    }
                    break;
                case "new-directory":
                    if (_runCancellation == null && _projectId is Guid newDirectoryProjectId)
                    {
                        var path = _sandboxStore.CreateDirectory(newDirectoryProjectId, ReadMessageString(root, "path"));
                        RegisterManagedChange(newDirectoryProjectId, path, isDirectory: true);
                        _status = $"Created folder {path}.";
                        RefreshProjects();
                        await PushStateAsync();
                    }
                    break;
                case "rename-directory":
                    if (_runCancellation == null && _projectId is Guid renameDirectoryProjectId)
                    {
                        var previousPath = ReadMessageString(root, "path");
                        var currentPath = _sandboxStore.RenameDirectory(
                            renameDirectoryProjectId,
                            previousPath,
                            ReadMessageString(root, "newPath"));
                        RegisterManagedChange(
                            renameDirectoryProjectId,
                            currentPath,
                            previousPath,
                            currentPath,
                            isDirectory: true);
                        _status = $"Renamed folder {previousPath} to {currentPath}.";
                        RefreshProjects();
                        await PushStateAsync();
                    }
                    break;
                case "delete-directory":
                    if (_runCancellation == null && _projectId is Guid deleteDirectoryProjectId)
                    {
                        var path = ReadMessageString(root, "path");
                        _sandboxStore.DeleteDirectory(deleteDirectoryProjectId, path);
                        RegisterManagedChange(deleteDirectoryProjectId, path, path, null, isDirectory: true);
                        _status = $"Deleted folder {path}.";
                        RefreshProjects();
                        await PushStateAsync();
                    }
                    break;
                case "detect-models":
                    await DetectModelsAsync(force: true);
                    break;
                case "select-model":
                    if (_runCancellation == null && _projectId is Guid modelProjectId)
                    {
                        var selectedModel = ReadMessageString(root, "model");
                        if (_models.Contains(selectedModel, StringComparer.Ordinal))
                        {
                            _sandboxStore.SetLastModel(modelProjectId, selectedModel);
                            RefreshProjects();
                            await PushStateAsync();
                        }
                    }
                    break;
                case "run":
                    var prompt = root.TryGetProperty("prompt", out var promptValue)
                        ? promptValue.GetString() ?? ""
                        : "";
                    var model = root.TryGetProperty("model", out var modelValue)
                        ? modelValue.GetString() ?? ""
                        : "";
                    await RunAsync(prompt, model);
                    break;
                case "stop":
                    _runCancellation?.Cancel();
                    break;
            }
        }
        catch (JsonException)
        {
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidDataException or InvalidOperationException)
        {
            _status = ex.Message;
            await AppendEventAsync("error", ex.Message);
            await PushStateAsync();
        }
    }

    private static string ReadMessageString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) ? value.GetString() ?? "" : "";

    private void RefreshProjects()
    {
        _projects = _sandboxStore.List();
        if (_projectId is Guid selected && _projects.All(project => project.Id != selected))
        {
            _projectId = null;
        }
        _projectId ??= _projects.FirstOrDefault()?.Id;
        if (_projects.Count == 0)
        {
            _status = "Save a sandbox project before launching the agent.";
        }
        UpdateChrome();
    }

    private async Task DetectModelsAsync(bool force)
    {
        if (_detecting || _runCancellation != null || (!force && _models.Count > 0))
        {
            return;
        }
        _detecting = true;
        _status = "Detecting local Ollama models…";
        if (force)
        {
            _models.Clear();
        }
        await PushStateAsync();
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
                        _models.Add(name);
                    }
                }
            }
            _status = _models.Count == 0
                ? "Ollama is running, but no models are installed."
                : $"{_models.Count} local model{(_models.Count == 1 ? "" : "s")} available.";
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _status = "Ollama was not detected. Start Ollama, then retry.";
        }
        finally
        {
            _detecting = false;
            await PushStateAsync();
        }
    }

    private async Task RunAsync(string prompt, string model)
    {
        prompt = prompt.Trim();
        if (_runCancellation != null || prompt.Length == 0 ||
            _projectId is not Guid projectId || !_models.Contains(model, StringComparer.Ordinal))
        {
            return;
        }
        try
        {
            _sandboxStore.SetLastModel(projectId, model);
            RefreshProjects();
            var workspace = new AgentWorkspace(_sandboxStore.GetProjectDirectory(projectId));
            lock (_changeLock)
            {
                _changedFiles.Clear();
            }
            workspace.FileChanged += RecordChangedFile;
            _runCancellation = new CancellationTokenSource();
            _harness = new AgentHarness(workspace, model, () => NavigateProject(projectId));
            _status = $"Running locally with {model}";
            await PushStateAsync(running: true);
            await AppendEventAsync("user", prompt);
            await AppendEventAsync("thinking", "Thinking");
            await _harness.RunAsync(prompt, Emit, _runCancellation.Token);
            _status = "Agent run completed.";
            RefreshProjects();
        }
        catch (OperationCanceledException)
        {
            _status = "Agent run stopped.";
            await AppendEventAsync("system", "Run stopped. Completed file changes were kept.");
        }
        catch (Exception ex)
        {
            _status = "Agent run failed.";
            await AppendEventAsync("error", ex.Message);
        }
        finally
        {
            _harness?.Dispose();
            _harness = null;
            _runCancellation?.Dispose();
            _runCancellation = null;
            await PushStateAsync(running: false);
        }
    }

    private void Emit(string kind, string text)
    {
        if (IsDisposed)
        {
            return;
        }
        if (InvokeRequired)
        {
            BeginInvoke(() => _ = AppendEventAsync(kind, text));
        }
        else
        {
            _ = AppendEventAsync(kind, text);
        }
    }

    private Task AppendEventAsync(string kind, string message)
    {
        if (!_ready.Task.IsCompletedSuccessfully)
        {
            return Task.CompletedTask;
        }
        var kindJson = JsonSerializer.Serialize(kind);
        var messageJson = JsonSerializer.Serialize(message);
        return _view.CoreWebView2.ExecuteScriptAsync(
            $"window.agentHarness.appendEvent({kindJson}, {messageJson})");
    }

    private Task PushStateAsync(bool? running = null)
    {
        if (!_ready.Task.IsCompletedSuccessfully)
        {
            return Task.CompletedTask;
        }
        var state = new
        {
            selectedProject = _projectId?.ToString("D"),
            projects = _projects.Select(project => new
            {
                id = project.Id.ToString("D"),
                title = project.Title,
                fileCount = project.Files.Count,
                lastModel = project.LastModel,
                directories = _sandboxStore.ListDirectories(project.Id),
                files = project.Files.Select(file => new
                {
                    path = file.Path,
                    size = file.Size,
                    isHtml = file.IsHtml,
                }),
            }),
            changedFiles = ChangedFilesSnapshot(),
            models = _models,
            status = _status,
            detecting = _detecting,
            running = running ?? _runCancellation != null,
            offline = true,
        };
        UpdateChrome();
        var json = JsonSerializer.Serialize(state);
        return _view.CoreWebView2.ExecuteScriptAsync($"window.agentHarness.setState({json})");
    }

    private void RecordChangedFile(string path)
    {
        bool firstChange;
        lock (_changeLock)
        {
            firstChange = _changedFiles.Add(path);
        }
        if (firstChange)
        {
            Emit("change", path);
        }
        if (IsDisposed || !IsHandleCreated)
        {
            return;
        }
        BeginInvoke(() =>
        {
            RefreshProjects();
            if (_projectId is Guid projectId)
            {
                ProjectChanged?.Invoke(this, new AgentProjectChangedEventArgs(projectId, [path]));
            }
            _ = PushStateAsync();
        });
    }

    private IReadOnlyList<string> ChangedFilesSnapshot()
    {
        lock (_changeLock)
        {
            return _changedFiles.OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToArray();
        }
    }

    private void ClearChangedFiles()
    {
        lock (_changeLock)
        {
            _changedFiles.Clear();
        }
    }

    private void RegisterManagedChange(
        Guid projectId,
        string path,
        string? previousPath = null,
        string? currentPath = null,
        bool isDirectory = false)
    {
        lock (_changeLock)
        {
            _changedFiles.Add(path);
        }
        ProjectChanged?.Invoke(this, new AgentProjectChangedEventArgs(
            projectId,
            [path],
            previousPath,
            currentPath,
            isDirectory));
    }

    private void UpdateChrome()
    {
        var project = _projects.FirstOrDefault(item => item.Id == _projectId);
        _identity.Text = project == null ? "No sandbox selected" : project.Title;
        _statusLabel.Text = _status + "    Offline    Local Ollama";
        _refreshButton.Enabled = _runCancellation == null;
        _stopButton.Enabled = _runCancellation != null;
    }

    private void NavigateProject(Guid projectId)
    {
        var project = _sandboxStore.List().FirstOrDefault(item => item.Id == projectId);
        if (project == null)
        {
            return;
        }
        var path = project.Files.FirstOrDefault(file =>
                       file.Path.Equals("index.html", StringComparison.OrdinalIgnoreCase))?.Path
                   ?? project.EntryPath;
        NavigateRequested?.Invoke(projectId, path);
    }

    private static ChromeButton MakeButton(char glyph, string accessibleName)
    {
        var button = new ChromeButton
        {
            Text = glyph.ToString(),
            AccessibleName = accessibleName,
            Size = new Size(32, 32),
            Margin = new Padding(2, 0, 2, 0),
            BackColor = Color.Transparent,
            ForeColor = BrowserChrome.Ink,
            Font = new Font("Segoe MDL2 Assets", 10f),
        };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = BrowserChrome.Hover;
        button.FlatAppearance.MouseDownBackColor = BrowserChrome.Press;
        var tip = new ToolTip();
        tip.SetToolTip(button, accessibleName);
        return button;
    }
}
