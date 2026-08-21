using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ThreeBrowser;

public sealed class MainForm : Form
{
    private const uint SwpNoMove = 0x0002;
    private const uint SwpNoSize = 0x0001;
    private const uint SwpNoActivate = 0x0010;
    private const string HomeUrl = ThreeInject.HomeUrl;

    private readonly BrowserChrome _chrome = new();
    private readonly WebView2 _web = new();
    private readonly SandboxStore _sandboxStore = new();
    private readonly System.Windows.Forms.Timer _debugTimer = new();
    private Form? _nativePreview;
    private SandboxEditorForm? _sandboxEditor;
    private AgentHarnessForm? _agentHarness;
    private Guid? _sandboxId;
    private string _sandboxFilePath = "index.html";
    private string _sandboxHtml = DefaultSandboxHtml;
    private bool _nativePreviewMayClose;
    private bool _nativePreviewReturning;
    private string _lastDebugOverlay = "";
    private NativeBridge? _bridge;
    private string _webRoot = "";
    private bool _nativeStopping;
    private int _webGpuOn;
    private int _nativeWgpu;
    private int _webGpuFps;
    private int _webGpuW;
    private int _webGpuH;
    private int _webGpuSession = 1;
    private CoreWebView2Environment? _env;
    private CoreWebView2SharedBuffer? _cmdBuffer;
    private IntPtr _cmdView = IntPtr.Zero;
    private readonly string _startupAddress;
    internal const int CmdBufferBytes = 8 * 1024 * 1024;

    public MainForm(string? startupAddress = null)
    {
        _startupAddress = string.IsNullOrWhiteSpace(startupAddress) ? HomeUrl : startupAddress;
        Text = "ThreeBrowser";
        Width = 1280;
        Height = 840;
        MinimumSize = new Size(720, 520);
        BackColor = BrowserChrome.Bar;
        Font = new Font("Segoe UI", 9f);
        KeyPreview = true;
        ShowIcon = true;
        try
        {
            var exe = Environment.ProcessPath;
            if (!string.IsNullOrEmpty(exe))
            {
                using var extracted = Icon.ExtractAssociatedIcon(exe);
                if (extracted != null)
                {
                    Icon = (Icon)extracted.Clone();
                }
            }
        }
        catch
        {
            /* keep the WinForms default */
        }

        _chrome.Address.Text = _startupAddress;
        _chrome.Address.GotFocus += (_, _) =>
        {
            ReleasePointer();
            _chrome.Invalidate(true);
            BeginInvoke(_chrome.Address.SelectAll);
        };
        _chrome.Address.LostFocus += (_, _) => _chrome.Invalidate(true);
        _chrome.Address.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Enter)
            {
                e.SuppressKeyPress = true;
                ReleasePointer();
                NavigateTo(_chrome.Address.Text);
            }
            else if (e.KeyCode == Keys.Escape)
            {
                SyncAddressFromWeb();
                _web.Focus();
            }
        };
        _chrome.BackButton.Click += (_, _) => TryNav(() => _web.CoreWebView2?.GoBack());
        _chrome.ForwardButton.Click += (_, _) => TryNav(() => _web.CoreWebView2?.GoForward());
        _chrome.ReloadButton.Click += (_, _) =>
        {
            if (_chrome.IsLoading)
            {
                _web.CoreWebView2?.Stop();
            }
            else
            {
                Reload();
            }
        };
        _chrome.HomeButton.Click += (_, _) =>
        {
            ReleasePointer();
            NavigateTo(HomeUrl);
        };
        _chrome.InjectToggled += (_, _) =>
        {
            SyncDebugHud();
            _ = SetInjectorAsync(_chrome.InjectEnabled);
        };
        _chrome.VsyncToggled += (_, _) => ApplyNativeVsync();
        _chrome.DebugToggled += (_, _) =>
        {
            SyncDebugHud();
            if (!_chrome.DebugEnabled)
            {
                CloseNativePreview();
            }
        };
        _chrome.NativeWindowRequested += (_, _) => ToggleNativePreview();
        _chrome.SandboxRequested += (_, _) => ShowSandboxEditor();
        _chrome.AgentRequested += (_, _) => ShowAgentHarness();
        _chrome.BackendChanged += (_, _) => _ = ApplyBackendAsync();

        _web.Dock = DockStyle.Fill;
        _web.DefaultBackgroundColor = Color.Transparent;

        _debugTimer.Interval = 200;
        _debugTimer.Tick += (_, _) => RefreshDebugHud();

        Controls.Add(_web);
        Controls.Add(_chrome);

        Load += (_, _) => _ = InitAsync();
        Resize += (_, _) => EmbedNativeSurface();
        FormClosing += (_, _) =>
        {
            _debugTimer.Stop();
            _agentHarness?.Dispose();
            ShutdownNative();
        };
        KeyDown += OnBrowserKey;
    }

    public void ResetNative()
    {
        ClearWebGpuBypass();
        // Insert the WebGPU reset barrier immediately while NavigationStarting
        // still owns the document transition. Deferring this call lets the old
        // and new pages enqueue overlapping handle namespaces.
        try { NativeWebGpu.tw_reset(); }
        catch (DllNotFoundException) { }
        catch (EntryPointNotFoundException) { }
        CloseNativePreview();
        _ = Task.Run(() =>
        {
            try { Native.tn_runtime_reset(); }
            catch (DllNotFoundException) { }
        });
    }

    public bool TryStartNativeWebGpu()
    {
        bool Start()
        {
            if (!IsHandleCreated)
            {
                return false;
            }
            var sz = _web.ClientSize;
            var w = Math.Max(1, sz.Width);
            var h = Math.Max(1, sz.Height);
            try
            {
                return NativeWebGpu.tw_start(IntPtr.Zero, 0, 0, w, h) != 0;
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

        if (IsDisposed)
        {
            return false;
        }
        if (InvokeRequired)
        {
            try
            {
                return (bool)Invoke(Start);
            }
            catch (ObjectDisposedException)
            {
                return false;
            }
            catch (InvalidOperationException)
            {
                return false;
            }
        }
        return Start();
    }

    public Size WebClientSize()
    {
        Size Read()
        {
            var sz = _web.ClientSize;
            if (sz.Width > 0 && sz.Height > 0)
            {
                return sz;
            }
            return new Size(1280, 720);
        }

        if (IsDisposed)
        {
            return new Size(1280, 720);
        }
        if (InvokeRequired)
        {
            try
            {
                return (Size)Invoke(Read);
            }
            catch (ObjectDisposedException)
            {
                return new Size(1280, 720);
            }
            catch (InvalidOperationException)
            {
                return new Size(1280, 720);
            }
        }
        return Read();
    }

    public void BeginWebGpuBypass(bool nativeWgpu = false)
    {
        Interlocked.Exchange(ref _webGpuOn, 1);
        Interlocked.Exchange(ref _nativeWgpu, nativeWgpu ? 1 : 0);
    }

    internal bool NativeWgpuOn => Volatile.Read(ref _nativeWgpu) != 0;

    internal int WebGpuSession => Volatile.Read(ref _webGpuSession);

    public void NoteWebGpuFrame(int fps, int width, int height)
    {
        Interlocked.Exchange(ref _webGpuFps, fps);
        Interlocked.Exchange(ref _webGpuW, width);
        Interlocked.Exchange(ref _webGpuH, height);
    }

    private void ClearWebGpuBypass()
    {
        Interlocked.Exchange(ref _webGpuOn, 0);
        Interlocked.Exchange(ref _nativeWgpu, 0);
        Interlocked.Exchange(ref _webGpuFps, 0);
        Interlocked.Exchange(ref _webGpuW, 0);
        Interlocked.Exchange(ref _webGpuH, 0);
    }

    public void ReleasePointer()
    {
        if (_web.CoreWebView2 == null)
        {
            return;
        }
        _ = _web.CoreWebView2.ExecuteScriptAsync(
            "try{document.exitPointerLock&&document.exitPointerLock()}catch(e){}" +
            "try{window.__threeReleasePointer&&window.__threeReleasePointer()}catch(e){}");
    }

    public void ShutdownNative()
    {
        if (_nativeStopping)
        {
            return;
        }
        if (InvokeRequired)
        {
            try { Invoke(ShutdownNative); }
            catch (ObjectDisposedException) { }
            catch (InvalidOperationException) { }
            return;
        }
        _nativeStopping = true;
        try
        {
            var done = Task.Run(() =>
            {
                try { NativeWebGpu.tw_shutdown(); }
                catch (DllNotFoundException) { }
                catch (EntryPointNotFoundException) { }
                Native.tn_runtime_shutdown();
            });
            while (!done.Wait(15))
            {
                Application.DoEvents();
            }
        }
        catch (DllNotFoundException) { }
    }

    public void ApplyNativeVsync()
    {
        var enabled = _chrome.VsyncEnabled ? 1 : 0;
        try
        {
            Native.tn_runtime_set_vsync(enabled);
        }
        catch (DllNotFoundException)
        {
        }
        try
        {
            NativeWebGpu.tw_set_vsync(enabled);
        }
        catch (DllNotFoundException)
        {
        }
        catch (EntryPointNotFoundException)
        {
        }
    }

    public void SyncBackendFromNative()
    {
        try
        {
            _chrome.SetVulkan(string.Equals(Native.BackendName(), "Vulkan", StringComparison.OrdinalIgnoreCase));
        }
        catch (DllNotFoundException)
        {
        }
        catch (EntryPointNotFoundException)
        {
        }
    }

    private async Task ApplyBackendAsync()
    {
        try
        {
            Native.tn_runtime_set_backend(_chrome.VulkanEnabled ? 1 : 0);
        }
        catch (DllNotFoundException)
        {
        }
        catch (EntryPointNotFoundException)
        {
        }
        if (!_chrome.InjectEnabled)
        {
            return;
        }
        ReleasePointer();
        await ReloadIgnoringCacheAsync();
    }

    private void SyncDebugHud()
    {
        var on = _chrome.InjectEnabled && _chrome.DebugEnabled;
        _debugTimer.Enabled = on;
        if (on)
        {
            RefreshDebugHud();
        }
        else
        {
            _lastDebugOverlay = "";
            HideDebugOverlay();
        }
    }

    private void RefreshDebugHud()
    {
        if (!_chrome.InjectEnabled || !_chrome.DebugEnabled)
        {
            return;
        }
        string overlay;
        try
        {
            if (Volatile.Read(ref _nativeWgpu) != 0 && NativeWebGpu.IsOpen())
            {
                NativeWebGpu.tw_stats(out var fps, out var frameUs, out var w, out var h, out var vsync, out _);
                var backend = NativeWebGpu.BackendName();
                if (string.IsNullOrEmpty(backend))
                {
                    backend = "WebGPU";
                }
                var label = backend.StartsWith("WebGPU", StringComparison.OrdinalIgnoreCase)
                    ? backend
                    : "WebGPU · " + backend;
                var ms = frameUs / 1000.0;
                overlay =
                    $"{Math.Max(fps, 0)} fps\n" +
                    $"{ms:0.0} ms\n" +
                    $"{Math.Max(w, 0)} × {Math.Max(h, 0)}\n" +
                    $"{label} · vsync {(vsync != 0 ? "on" : "off")}";
            }
            else if (Volatile.Read(ref _webGpuOn) != 0)
            {
                var fps = Math.Max(0, Volatile.Read(ref _webGpuFps));
                var w = Math.Max(0, Volatile.Read(ref _webGpuW));
                var h = Math.Max(0, Volatile.Read(ref _webGpuH));
                overlay =
                    $"{fps} fps\n" +
                    $"{w} × {h}\n" +
                    "WebGPU · Dawn\n" +
                    "threepp bypass";
            }
            else
            {
                Native.tn_runtime_stats(out var fps, out var frameUs, out var w, out var h, out var vsync, out _);
                var ms = frameUs / 1000.0;
                var backend = Native.BackendName();
                if (string.IsNullOrEmpty(backend))
                {
                    backend = "OpenGL";
                }
                overlay =
                    $"{fps} fps\n" +
                    $"{ms:0.0} ms\n" +
                    $"{Math.Max(w, 0)} × {Math.Max(h, 0)}\n" +
                    $"{backend} · vsync {(vsync != 0 ? "on" : "off")}";
            }
        }
        catch (Exception)
        {
            overlay = "native stats unavailable";
        }
        PushDebugOverlay(overlay);
    }

    private void PushDebugOverlay(string text)
    {
        var core = _web.CoreWebView2;
        if (core == null || text == _lastDebugOverlay)
        {
            return;
        }
        _lastDebugOverlay = text;
        var payload = JsString(text ?? "");
        _ = core.ExecuteScriptAsync(
            "(function(t){" +
            "var id='__tb_debug_hud';" +
            "var el=document.getElementById(id);" +
            "if(!el){" +
            "el=document.createElement('div');" +
            "el.id=id;" +
            "el.style.cssText='position:fixed;right:8px;top:8px;z-index:2147483647;pointer-events:none;" +
            "font:12px/1.35 Consolas,ui-monospace,monospace;color:#e8f0fe;" +
            "background:rgba(32,33,36,.86);padding:8px 10px;border-radius:8px;" +
            "white-space:pre;letter-spacing:.02em;box-shadow:0 1px 6px rgba(0,0,0,.28)';" +
            "(document.body||document.documentElement).appendChild(el);" +
            "}" +
            "el.textContent=t;" +
            "})(" + payload + ")");
    }

    private void HideDebugOverlay()
    {
        var core = _web.CoreWebView2;
        if (core == null)
        {
            return;
        }
        _ = core.ExecuteScriptAsync(
            "var e=document.getElementById('__tb_debug_hud');if(e)e.remove();");
    }

    private static string JsString(string value)
    {
        return "\"" + value
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\r", "")
            .Replace("\n", "\\n") + "\"";
    }

    public void EmbedNativeSurface()
    {
        if (IsDisposed || !IsHandleCreated || !_chrome.InjectEnabled)
        {
            return;
        }
        if (_nativePreview is { IsDisposed: false })
        {
            return;
        }
        try
        {
            var sz = _web.ClientSize;
            if (sz.Width <= 0 || sz.Height <= 0)
            {
                return;
            }
            var w = Math.Max(1, sz.Width);
            var h = Math.Max(1, sz.Height);
            if (Volatile.Read(ref _nativeWgpu) != 0)
            {
                var twHwnd = IntPtr.Zero;
                try
                {
                    twHwnd = NativeWebGpu.tw_hwnd();
                }
                catch (DllNotFoundException)
                {
                }
                catch (EntryPointNotFoundException)
                {
                }
                if (twHwnd != IntPtr.Zero)
                {
                    NativeWebGpu.tw_attach_host(Handle, _web.Left, _web.Top, w, h);
                    SetWindowPos(_web.Handle, HWND_TOP, 0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoActivate);
                }
                return;
            }
            if (Volatile.Read(ref _webGpuOn) != 0)
            {
                return;
            }
            if (Native.tn_runtime_hwnd() == IntPtr.Zero)
            {
                return;
            }
            // Child of the form: coords are the form client area, not the
            // outer window. PointToScreen/PointToClient was adding the caption
            // height to Y, so raycasts (clientY / innerHeight) sat too low.
            Native.tn_runtime_attach_host(Handle, _web.Left, _web.Top, w, h);
            SetWindowPos(_web.Handle, HWND_TOP, 0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoActivate);
        }
        catch (DllNotFoundException)
        {
        }
        catch (EntryPointNotFoundException)
        {
        }
    }

    private void ToggleNativePreview()
    {
        if (_nativePreview is { IsDisposed: false } open)
        {
            open.Close();
            return;
        }
        if (Volatile.Read(ref _nativeWgpu) == 0)
        {
            MessageBox.Show(this,
                "Native WebGPU is not active on this page yet.",
                "Native test window",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        var size = _web.ClientSize;
        var preview = new Form
        {
            Text = "ThreeBrowser - Native WebGPU test window",
            ClientSize = new Size(Math.Max(1, size.Width), Math.Max(1, size.Height)),
            MinimumSize = new Size(320, 240),
            FormBorderStyle = FormBorderStyle.FixedSingle,
            MaximizeBox = false,
            StartPosition = FormStartPosition.CenterParent,
            BackColor = Color.Black,
            ShowIcon = Icon != null,
            Icon = Icon,
        };
        _nativePreview = preview;
        _nativePreviewMayClose = false;
        _nativePreviewReturning = false;
        preview.Shown += (_, _) =>
        {
            if (preview.IsDisposed || Volatile.Read(ref _nativeWgpu) == 0)
            {
                preview.Close();
                return;
            }
            try
            {
                var client = preview.ClientSize;
                NativeWebGpu.tw_attach_host(preview.Handle, 0, 0,
                    Math.Max(1, client.Width), Math.Max(1, client.Height));
            }
            catch (DllNotFoundException)
            {
                preview.Close();
            }
            catch (EntryPointNotFoundException)
            {
                preview.Close();
            }
        };
        preview.FormClosing += (_, e) =>
        {
            if (_nativeStopping || _nativePreviewMayClose)
            {
                return;
            }
            e.Cancel = true;
            preview.Hide();
            _ = ReturnNativePreviewAsync(preview);
        };
        preview.FormClosed += (_, _) =>
        {
            if (ReferenceEquals(_nativePreview, preview))
            {
                _nativePreview = null;
            }
            _nativePreviewMayClose = false;
            _nativePreviewReturning = false;
            preview.Dispose();
            if (!IsDisposed && IsHandleCreated && Volatile.Read(ref _nativeWgpu) != 0)
            {
                BeginInvoke(EmbedNativeSurface);
            }
        };
        preview.Show(this);
    }

    private void CloseNativePreview()
    {
        var preview = _nativePreview;
        if (preview == null || preview.IsDisposed)
        {
            _nativePreview = null;
            return;
        }
        preview.Close();
    }

    private async Task ReturnNativePreviewAsync(Form preview)
    {
        if (_nativePreviewReturning || preview.IsDisposed)
        {
            return;
        }
        _nativePreviewReturning = true;
        try
        {
            var size = _web.ClientSize;
            NativeWebGpu.tw_attach_host(Handle, _web.Left, _web.Top,
                Math.Max(1, size.Width), Math.Max(1, size.Height));

            // tw_attach_host intentionally queues the cross-thread SetParent.
            // Keep the temporary parent alive until that operation completes;
            // destroying a parent also destroys its child HWNDs.
            for (var attempt = 0; attempt < 100; attempt++)
            {
                await Task.Delay(20);
                if (preview.IsDisposed)
                {
                    return;
                }
                var native = NativeWebGpu.tw_hwnd();
                if (native == IntPtr.Zero || GetParent(native) == Handle)
                {
                    _nativePreviewMayClose = true;
                    preview.Close();
                    return;
                }
            }
            preview.Show(this);
        }
        catch (DllNotFoundException)
        {
            _nativePreviewMayClose = true;
            preview.Close();
        }
        catch (EntryPointNotFoundException)
        {
            _nativePreviewMayClose = true;
            preview.Close();
        }
        finally
        {
            _nativePreviewReturning = false;
        }
    }

    private void NavigateTo(string raw)
    {
        if (_web.CoreWebView2 == null)
        {
            return;
        }
        var url = (raw ?? "").Trim();
        if (url.Length == 0)
        {
            url = HomeUrl;
        }
        else if (!LooksLikeUrl(url))
        {
            url = "https://www.google.com/search?q=" + Uri.EscapeDataString(url);
        }
        else if (!url.Contains("://", StringComparison.Ordinal))
        {
            url = "https://" + url;
        }
        _web.CoreWebView2.Navigate(url);
    }

    private static bool LooksLikeUrl(string s)
    {
        if (s.Contains("://", StringComparison.Ordinal))
        {
            return true;
        }
        if (s.StartsWith("localhost", StringComparison.OrdinalIgnoreCase) ||
            s.StartsWith("threebrowser.local", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        if (s.Contains(' ') || !s.Contains('.'))
        {
            return false;
        }
        return true;
    }

    private async Task InitAsync()
    {
        try
        {
            _webRoot = FindWebRoot();
            var userData = Path.Combine(Path.GetTempPath(), "ThreeBrowserWebView2");
            Directory.CreateDirectory(userData);
            _env = await CoreWebView2Environment.CreateAsync(null, userData);
            await _web.EnsureCoreWebView2Async(_env);
            CreateCmdBuffer();

            _bridge = new NativeBridge(this);
            _web.CoreWebView2.Settings.AreHostObjectsAllowed = true;
            _web.CoreWebView2.Settings.IsWebMessageEnabled = true;
            await SetNetworkCacheDisabledAsync(_chrome.InjectEnabled);
            _web.CoreWebView2.AddHostObjectToScript("native", _bridge);

            _web.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "threebrowser.local",
                _webRoot,
                CoreWebView2HostResourceAccessKind.Allow);

            _web.CoreWebView2.AddWebResourceRequestedFilter(
                "https://sandbox.threebrowser.local/*",
                CoreWebView2WebResourceContext.All,
                CoreWebView2WebResourceRequestSourceKinds.All);

            foreach (var filter in new[]
            {
                "*three.module.js*",
                "*three.module.min.js*",
                "*three.min.js*",
                "*/build/three.js*",
                "*three.webgpu.js*",
                "*three.webgpu.min.js*",
            })
            {
                _web.CoreWebView2.AddWebResourceRequestedFilter(
                    filter,
                    CoreWebView2WebResourceContext.All,
                    CoreWebView2WebResourceRequestSourceKinds.All);
            }

            _web.CoreWebView2.WebResourceRequested += OnWebResourceRequested;
            _web.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (e.IsRedirected)
                {
                    return;
                }
                Interlocked.Increment(ref _webGpuSession);
                _chrome.SetLoading(true);
                ReleasePointer();
                if (_chrome.InjectEnabled)
                {
                    ResetNative();
                }
            };
            _web.CoreWebView2.ContentLoading += (_, _) =>
            {
                if (_chrome.InjectEnabled)
                {
                    PostCmdBuffer();
                }
            };
            _web.CoreWebView2.NavigationCompleted += (_, _) =>
            {
                _chrome.SetLoading(false);
                if (_chrome.InjectEnabled)
                {
                    PostCmdBuffer();
                }
                SyncNav();
                SyncTitle();
                if (!_chrome.Address.Focused)
                {
                    SyncAddressFromWeb();
                }
                if (_chrome.DebugEnabled)
                {
                    RefreshDebugHud();
                }
            };
            _web.CoreWebView2.HistoryChanged += (_, _) => SyncNav();
            _web.CoreWebView2.DocumentTitleChanged += (_, _) => SyncTitle();
            _web.CoreWebView2.SourceChanged += (_, _) =>
            {
                if (!_chrome.Address.Focused)
                {
                    SyncAddressFromWeb();
                }
            };
            _web.CoreWebView2.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                _web.CoreWebView2.Navigate(e.Uri);
            };
            _web.CoreWebView2.ProcessFailed += (_, e) =>
            {
                File.WriteAllText(
                    Path.Combine(Path.GetTempPath(), "ThreeBrowser-crash.log"),
                    "WebView2 ProcessFailed kind=" + e.ProcessFailedKind + " reason=" + e.Reason);
            };

            await _web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                """
                (function () {
                  const proto = Element.prototype;
                  proto.setPointerCapture = function () {};
                  proto.releasePointerCapture = function () {};
                  const activePtrs = new Set();
                  window.addEventListener('pointerdown', function (e) { activePtrs.add(e.pointerId); }, true);
                  window.addEventListener('pointerup', function (e) { activePtrs.delete(e.pointerId); }, true);
                  window.addEventListener('pointercancel', function (e) { activePtrs.delete(e.pointerId); }, true);
                  window.__threeReleasePointer = function () {
                    try { document.exitPointerLock && document.exitPointerLock(); } catch (e) {}
                    const ids = Array.from(activePtrs);
                    activePtrs.clear();
                    for (let i = 0; i < ids.length; i++) {
                      try {
                        document.dispatchEvent(new PointerEvent('pointerup', {
                          bubbles: true, cancelable: true, pointerId: ids[i], pointerType: 'mouse'
                        }));
                      } catch (e) {}
                    }
                  };
                  window.addEventListener('blur', window.__threeReleasePointer, true);
                  window.addEventListener('keydown', function (e) {
                    if (e.code === 'Escape') window.__threeReleasePointer();
                  }, true);
                  try {
                    chrome.webview.addEventListener('sharedbufferreceived', function (e) {
                      const b = e.getBuffer();
                      window.__TN_SHARED = b;
                      const cmd = window.__TN && window.__TN.cmd;
                      if (cmd && cmd.attach) cmd.attach(b);
                    });
                  } catch (e) {}
                })();
                """);

            NavigateTo(_startupAddress);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.ToString(), "ThreeBrowser failed to start WebView2");
        }
    }

    private void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var uri = e.Request?.Uri;
        if (TryServeSandbox(uri, e))
        {
            return;
        }
        if (!_chrome.InjectEnabled)
        {
            return;
        }
        if (ThreeInject.IsPassthrough(uri))
        {
            return;
        }

        try
        {
            if (ThreeInject.IsThreeWebGpuLibrary(uri))
            {
                e.Response = ThreeInject.CreateResponse(
                    _web.CoreWebView2.Environment,
                    ThreeInject.WebGpuShimSource(uri!));
                return;
            }
            if (!ThreeInject.IsThreeCoreLibrary(uri))
            {
                return;
            }
            var esm = ThreeInject.IsEsmLibrary(uri!);
            var body = esm ? ThreeInject.EsmSource(_webRoot) : ThreeInject.ClassicSource(_webRoot);
            e.Response = ThreeInject.CreateResponse(_web.CoreWebView2.Environment, body);
        }
        catch (Exception ex)
        {
            File.WriteAllText(
                Path.Combine(Path.GetTempPath(), "ThreeBrowser-inject.log"),
                uri + "\n" + ex);
        }
    }

    private bool TryServeSandbox(string? requestedUri, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (!Uri.TryCreate(requestedUri, UriKind.Absolute, out var uri) ||
            !uri.Host.Equals("sandbox.threebrowser.local", StringComparison.OrdinalIgnoreCase) ||
            !TryGetSandboxResourcePath(uri.AbsolutePath, out var id, out var relativePath))
        {
            return false;
        }

        string? resolvedPath;
        try
        {
            resolvedPath = _sandboxStore.ResolveResourcePath(id, relativePath);
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException or UnauthorizedAccessException)
        {
            SetSandboxErrorResponse(e, 400, "Bad Request", ex.Message);
            return true;
        }
        if (resolvedPath == null)
        {
            SetSandboxErrorResponse(e, 404, "Not Found", $"Sandbox resource not found: {relativePath}");
            return true;
        }

        SandboxResource? resource;
        if (_sandboxId == id &&
            resolvedPath.Equals(_sandboxFilePath, StringComparison.OrdinalIgnoreCase))
        {
            resource = new SandboxResource(
                Encoding.UTF8.GetBytes(_sandboxHtml),
                SandboxStore.ContentTypeForPath(_sandboxFilePath));
        }
        else
        {
            resource = _sandboxStore.ReadResource(id, resolvedPath);
        }
        if (resource == null)
        {
            SetSandboxErrorResponse(e, 404, "Not Found", $"Sandbox resource not found: {resolvedPath}");
            return true;
        }

        var stream = new MemoryStream(resource.Content, writable: false);
        e.Response = _web.CoreWebView2.Environment.CreateWebResourceResponse(
            stream,
            200,
            "OK",
            $"Content-Type: {resource.ContentType}\r\n" +
            "Cache-Control: no-store, no-cache, must-revalidate\r\n" +
            "Pragma: no-cache\r\n" +
            "X-Content-Type-Options: nosniff");
        return true;
    }

    private void SetSandboxErrorResponse(
        CoreWebView2WebResourceRequestedEventArgs e,
        int statusCode,
        string reason,
        string message)
    {
        e.Response = _web.CoreWebView2.Environment.CreateWebResourceResponse(
            new MemoryStream(Encoding.UTF8.GetBytes(message), writable: false),
            statusCode,
            reason,
            "Content-Type: text/plain; charset=utf-8\r\n" +
            "Cache-Control: no-store, no-cache, must-revalidate\r\n" +
            "X-Content-Type-Options: nosniff");
    }

    private void ShowSandboxEditor()
    {
        if (_sandboxEditor == null || _sandboxEditor.IsDisposed)
        {
            if (_env == null)
            {
                return;
            }
            _sandboxEditor = new SandboxEditorForm(Icon, _env, _webRoot);
            _sandboxEditor.LoadSandbox(_sandboxId, _sandboxFilePath, _sandboxHtml);
            _sandboxEditor.SaveRequested += async (_, _) => await SaveSandboxAsync(navigate: false);
            _sandboxEditor.NavigateRequested += async (_, _) => await SaveSandboxAsync(navigate: true);
            _sandboxEditor.NewRequested += (_, _) => NewSandbox();
            _sandboxEditor.FileOpenRequested += async (_, id, path) => await OpenSandboxFileAsync(id, path);
            _sandboxEditor.DeleteRequested += (_, id) => DeleteSandbox(id);
            _sandboxEditor.ImportRequested += async (_, files) => await ImportSandboxFilesAsync(files);
        }

        RefreshSavedPages();

        if (_sandboxEditor.Visible)
        {
            _sandboxEditor.Activate();
        }
        else
        {
            _sandboxEditor.Show(this);
        }
    }

    private void ShowAgentHarness()
    {
        if (_env == null)
        {
            return;
        }
        if (_agentHarness == null || _agentHarness.IsDisposed)
        {
            _agentHarness = new AgentHarnessForm(Icon, _env, _webRoot, _sandboxStore);
            _agentHarness.ProjectChanged += (_, e) => SyncSandboxFromAgent(e);
            _agentHarness.FileOpenRequested += async (id, path) =>
            {
                ShowSandboxEditor();
                await OpenSandboxFileAsync(id, path);
            };
            _agentHarness.NavigateRequested += (id, path) =>
            {
                ReleasePointer();
                _web.CoreWebView2?.Navigate(SandboxEditorForm.SandboxUrl(id, path));
                Activate();
            };
            _agentHarness.DeleteProjectRequested += DeleteSandbox;
        }
        if (_agentHarness.Visible)
        {
            _agentHarness.Activate();
        }
        else
        {
            _agentHarness.Show(this);
        }
    }

    private void SyncSandboxFromAgent(AgentProjectChangedEventArgs e)
    {
        RefreshSavedPages();
        var editor = _sandboxEditor;
        if (_sandboxId != e.ProjectId || editor == null || editor.IsDisposed)
        {
            return;
        }
        var previousPrefix = e.PreviousPath?.TrimEnd('/') + "/";
        var activePathAffected = e.IsDirectory
            ? !string.IsNullOrEmpty(e.PreviousPath) &&
              _sandboxFilePath.StartsWith(previousPrefix, StringComparison.OrdinalIgnoreCase)
            : e.PreviousPath?.Equals(_sandboxFilePath, StringComparison.OrdinalIgnoreCase) == true;
        if (activePathAffected)
        {
            if (e.CurrentPath == null)
            {
                if (!editor.IsDirty)
                {
                    var replacement = _sandboxStore.List()
                        .FirstOrDefault(project => project.Id == e.ProjectId)?.Files
                        .FirstOrDefault(file => file.IsHtml);
                    if (replacement != null && _sandboxStore.Load(e.ProjectId, replacement.Path) is { } replacementPage)
                    {
                        _sandboxFilePath = replacementPage.FilePath;
                        _sandboxHtml = replacementPage.Html;
                        editor.LoadSandbox(replacementPage.Id, replacementPage.FilePath, replacementPage.Html);
                        RefreshSavedPages();
                        return;
                    }
                }
                editor.ReportExternalDeletion(_sandboxFilePath);
                return;
            }
            _sandboxFilePath = e.IsDirectory
                ? e.CurrentPath.TrimEnd('/') + "/" + _sandboxFilePath[previousPrefix.Length..]
                : e.CurrentPath;
            editor.ApplyExternalRename(_sandboxFilePath);
            if (e.IsDirectory)
            {
                RefreshSavedPages();
                return;
            }
        }
        if (!e.ChangedFiles.Any(path => path.Equals(_sandboxFilePath, StringComparison.OrdinalIgnoreCase)))
        {
            return;
        }
        if (editor.IsDirty)
        {
            editor.ReportExternalChange(_sandboxFilePath);
            return;
        }
        if (_sandboxStore.Load(e.ProjectId, _sandboxFilePath) is not { } page)
        {
            return;
        }
        _sandboxHtml = page.Html;
        editor.LoadSandbox(page.Id, page.FilePath, page.Html);
        RefreshSavedPages();
    }

    private async Task SaveSandboxAsync(bool navigate)
    {
        var editor = _sandboxEditor;
        if (editor == null || editor.IsDisposed)
        {
            return;
        }
        try
        {
            _sandboxId ??= Guid.NewGuid();
            _sandboxHtml = await editor.GetHtmlAsync();
            var saved = _sandboxStore.Save(_sandboxId.Value, _sandboxFilePath, _sandboxHtml);
            editor.MarkSaved(_sandboxId.Value, _sandboxFilePath);
            _chrome.SandboxActive = true;
            RefreshSavedPages();

            if (navigate && _web.CoreWebView2 != null)
            {
                ReleasePointer();
                _web.CoreWebView2.Navigate(SandboxEditorForm.SandboxUrl(_sandboxId.Value, saved.EntryPath));
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(editor, ex.Message, "Sandbox save failed");
        }
    }

    private void NewSandbox()
    {
        var editor = _sandboxEditor;
        if (editor == null || editor.IsDisposed)
        {
            return;
        }
        if (editor.IsDirty && MessageBox.Show(
                editor,
                "Discard the unsaved changes and start a new sandbox?",
                "New sandbox",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question) != DialogResult.Yes)
        {
            return;
        }
        _sandboxId = null;
        _sandboxFilePath = "index.html";
        _sandboxHtml = DefaultSandboxHtml;
        _chrome.SandboxActive = false;
        editor.LoadSandbox(null, _sandboxFilePath, _sandboxHtml);
        RefreshSavedPages();
    }

    private Task OpenSandboxFileAsync(Guid id, string path)
    {
        var editor = _sandboxEditor;
        if (editor == null || editor.IsDisposed ||
            (_sandboxId == id && _sandboxFilePath.Equals(path, StringComparison.OrdinalIgnoreCase)))
        {
            return Task.CompletedTask;
        }
        if (editor.IsDirty && MessageBox.Show(
                editor,
                "Discard the unsaved changes and open this saved page?",
                "Open saved page",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question) != DialogResult.Yes)
        {
            return Task.CompletedTask;
        }

        try
        {
            var page = _sandboxStore.Load(id, path);
            if (page == null)
            {
                RefreshSavedPages();
                return Task.CompletedTask;
            }
            _sandboxId = page.Id;
            _sandboxFilePath = page.FilePath;
            _sandboxHtml = page.Html;
            _chrome.SandboxActive = true;
            editor.LoadSandbox(page.Id, page.FilePath, page.Html);
            RefreshSavedPages();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            MessageBox.Show(editor, ex.Message, "Open sandbox file failed");
        }
        return Task.CompletedTask;
    }

    private async Task ImportSandboxFilesAsync(IReadOnlyList<SandboxImportFile> files)
    {
        var editor = _sandboxEditor;
        if (editor == null || editor.IsDisposed || files.Count == 0)
        {
            return;
        }
        try
        {
            _sandboxId ??= Guid.NewGuid();
            if (editor.IsDirty || !_sandboxStore.List().Any(page => page.Id == _sandboxId))
            {
                _sandboxHtml = await editor.GetHtmlAsync();
                _sandboxStore.Save(_sandboxId.Value, _sandboxFilePath, _sandboxHtml);
                editor.MarkSaved(_sandboxId.Value, _sandboxFilePath);
            }
            _sandboxStore.Import(_sandboxId.Value, files);
            if (files.Any(file => ImportedPathEquals(file.Path, _sandboxFilePath)) &&
                _sandboxStore.Load(_sandboxId.Value, _sandboxFilePath) is { } importedPage)
            {
                _sandboxHtml = importedPage.Html;
                editor.LoadSandbox(importedPage.Id, importedPage.FilePath, importedPage.Html);
            }
            _chrome.SandboxActive = true;
            RefreshSavedPages();
            editor.ReportImport(files.Count);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            editor.ReportImportError(ex.Message);
            MessageBox.Show(editor, ex.Message, "Sandbox import failed");
        }
    }

    private void DeleteSandbox(Guid id)
    {
        try
        {
            _sandboxStore.Delete(id);
            _agentHarness?.NotifyProjectDeleted(id);
            if (_sandboxId == id)
            {
                _sandboxId = null;
                _sandboxFilePath = "index.html";
                _sandboxHtml = DefaultSandboxHtml;
                _chrome.SandboxActive = false;
                _sandboxEditor?.LoadSandbox(null, _sandboxFilePath, _sandboxHtml);
                _sandboxEditor?.Hide();
            }
            RefreshSavedPages();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            MessageBox.Show(_sandboxEditor, ex.Message, "Sandbox delete failed");
        }
    }

    private void RefreshSavedPages()
    {
        _sandboxEditor?.SetSavedPages(_sandboxStore.List(), _sandboxId, _sandboxFilePath);
        _agentHarness?.RefreshFromStore();
    }

    private static bool TryGetSandboxResourcePath(string path, out Guid id, out string relativePath)
    {
        id = Guid.Empty;
        relativePath = "";
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0 || !Guid.TryParse(parts[0], out id))
        {
            return false;
        }
        relativePath = parts.Length == 1
            ? "index.html"
            : string.Join('/', parts.Skip(1).Select(Uri.UnescapeDataString));
        return true;
    }

    private static bool ImportedPathEquals(string importedPath, string activePath) =>
        importedPath.Replace('\\', '/').Trim('/').Equals(
            activePath.Replace('\\', '/').Trim('/'),
            StringComparison.OrdinalIgnoreCase);

    private static readonly string DefaultSandboxHtml = """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>ThreeBrowser Sandbox</title>
          <style>
            :root { color-scheme: dark; font-family: system-ui, sans-serif; }
            body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111827; color: #e5e7eb; }
            main { max-width: 720px; padding: 48px; }
            h1 { color: #60a5fa; }
          </style>
        </head>
        <body>
          <main>
            <h1>ThreeBrowser Sandbox</h1>
            <p>Edit this HTML, save it, then navigate to run the page.</p>
          </main>
          <script type="module">
            console.log('Sandbox ready');
          </script>
        </body>
        </html>
        """.Replace("\r\n", "\n", StringComparison.Ordinal)
           .Replace("\n", "\r\n", StringComparison.Ordinal);

    private static string FindWebRoot()
    {
        var nextToExe = Path.Combine(AppContext.BaseDirectory, "web");
        if (File.Exists(Path.Combine(nextToExe, "three-native.js")))
        {
            return nextToExe;
        }

        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 8 && dir != null; i++)
        {
            var web = Path.Combine(dir.FullName, "web");
            if (File.Exists(Path.Combine(web, "three-native.js")))
            {
                return web;
            }
            dir = dir.Parent;
        }

        throw new DirectoryNotFoundException(
            "Could not find web/three-native.js next to ThreeBrowser.exe.");
    }

    private async Task SetInjectorAsync(bool enabled)
    {
        _chrome.InjectEnabled = enabled;
        _web.DefaultBackgroundColor = enabled ? Color.Transparent : Color.White;
        ReleasePointer();
        ResetNative();
        await SetNetworkCacheDisabledAsync(enabled);
        await ReloadIgnoringCacheAsync();
    }

    private void Reload()
    {
        _ = ReloadIgnoringCacheAsync();
    }

    private async Task ReloadIgnoringCacheAsync()
    {
        var core = _web.CoreWebView2;
        if (core == null)
        {
            return;
        }
        ReleasePointer();
        if (_chrome.InjectEnabled)
        {
            ResetNative();
        }
        try
        {
            await core.CallDevToolsProtocolMethodAsync("Network.clearBrowserCache", "{}");
            await core.CallDevToolsProtocolMethodAsync("Page.reload", "{\"ignoreCache\":true}");
        }
        catch
        {
            core.Reload();
        }
    }

    private async Task SetNetworkCacheDisabledAsync(bool disabled)
    {
        var core = _web.CoreWebView2;
        if (core == null)
        {
            return;
        }
        try
        {
            var json = disabled ? "{\"cacheDisabled\":true}" : "{\"cacheDisabled\":false}";
            await core.CallDevToolsProtocolMethodAsync("Network.setCacheDisabled", json);
        }
        catch
        {
        }
    }

    private void TryNav(Action? action)
    {
        ReleasePointer();
        action?.Invoke();
    }

    private void SyncNav()
    {
        var core = _web.CoreWebView2;
        _chrome.SetNav(core?.CanGoBack == true, core?.CanGoForward == true);
    }

    private void SyncTitle()
    {
        var title = _web.CoreWebView2?.DocumentTitle;
        Text = string.IsNullOrWhiteSpace(title) || title == "ThreeBrowser"
            ? "ThreeBrowser"
            : title + " – ThreeBrowser";
    }

    private void SyncAddressFromWeb()
    {
        var url = _web.Source?.ToString() ?? "";
        if (url.Length > 0)
        {
            _chrome.Address.Text = url;
        }
    }

    private void OnBrowserKey(object? sender, KeyEventArgs e)
    {
        if (e.Control && e.Shift && e.KeyCode == Keys.N)
        {
            e.Handled = true;
            _ = SetInjectorAsync(!_chrome.InjectEnabled);
            return;
        }
        if (e.Control && e.KeyCode == Keys.L)
        {
            e.Handled = true;
            _chrome.Address.Focus();
            _chrome.Address.SelectAll();
            return;
        }
        if ((e.Control && e.KeyCode == Keys.R) || e.KeyCode == Keys.F5)
        {
            e.Handled = true;
            Reload();
            return;
        }
        if (e.Alt && e.KeyCode == Keys.Left)
        {
            e.Handled = true;
            TryNav(() => _web.CoreWebView2?.GoBack());
            return;
        }
        if (e.Alt && e.KeyCode == Keys.Right)
        {
            e.Handled = true;
            TryNav(() => _web.CoreWebView2?.GoForward());
        }
    }

    internal void PostCmdBuffer()
    {
        if (_web.CoreWebView2 == null || _cmdBuffer == null)
        {
            return;
        }
        try
        {
            _web.CoreWebView2.PostSharedBufferToScript(
                _cmdBuffer,
                CoreWebView2SharedBufferAccess.ReadWrite,
                "{\"kind\":\"cmd\"}");
        }
        catch (Exception)
        {
        }
    }

    internal int SubmitCmd(int nbytes)
    {
        if (Volatile.Read(ref _nativeWgpu) != 0)
        {
            return SubmitWebGpuCmd(nbytes);
        }
        return SubmitMappedCmd(Native.tn_cmd_submit, nbytes);
    }

    internal int SubmitWebGpuCmd(int nbytes)
    {
        if (!NativeWebGpu.IsOpen())
        {
            return nbytes <= 0 ? 1 : 0;
        }
        return SubmitMappedCmd(NativeWebGpu.tw_cmd_submit, nbytes);
    }

    internal int SubmitWebGpuCmd(int nbytes, int session)
    {
        // MessageChannel callbacks from the document being left can outlive
        // NavigationStarting. A successful no-op keeps those stale streams
        // from entering the next document's recycled WebGPU handle namespace.
        if (session != WebGpuSession)
        {
            return 1;
        }
        return SubmitWebGpuCmd(nbytes);
    }

    private int SubmitMappedCmd(Func<IntPtr, int, int> submit, int nbytes)
    {
        if (nbytes <= 0)
        {
            return 1;
        }
        if (nbytes > CmdBufferBytes)
        {
            return 0;
        }
        try
        {
            if (_cmdView != IntPtr.Zero)
            {
                return submit(_cmdView, nbytes);
            }
            if (_cmdBuffer == null)
            {
                return 0;
            }
            using var stream = _cmdBuffer.OpenStream();
            stream.Position = 0;
            var copy = new byte[nbytes];
            var got = stream.Read(copy, 0, nbytes);
            var pin = GCHandle.Alloc(copy, GCHandleType.Pinned);
            try
            {
                return submit(pin.AddrOfPinnedObject(), got);
            }
            finally
            {
                pin.Free();
            }
        }
        catch (DllNotFoundException)
        {
            return 0;
        }
        catch (EntryPointNotFoundException)
        {
            return 0;
        }
    }

    private void CreateCmdBuffer()
    {
        if (_env == null || _cmdBuffer != null)
        {
            return;
        }
        _cmdBuffer = _env.CreateSharedBuffer((ulong)CmdBufferBytes);
        var handle = _cmdBuffer.FileMappingHandle.DangerousGetHandle();
        _cmdView = MapViewOfFile(handle, FileMapAllAccess, 0, 0, (UIntPtr)CmdBufferBytes);
        if (_cmdView == IntPtr.Zero)
        {
            _cmdView = MapViewOfFile(handle, FileMapReadWrite, 0, 0, (UIntPtr)CmdBufferBytes);
        }
    }

    private const uint FileMapReadWrite = 0x0002 | 0x0004;
    private const uint FileMapAllAccess = 0x000F001F;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr MapViewOfFile(
        IntPtr hFileMappingObject,
        uint dwDesiredAccess,
        uint dwFileOffsetHigh,
        uint dwFileOffsetLow,
        UIntPtr dwNumberOfBytesToMap);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr hWnd);

    private static readonly IntPtr HWND_TOP = IntPtr.Zero;
}
