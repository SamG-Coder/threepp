using System.Runtime.InteropServices;
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
    private readonly System.Windows.Forms.Timer _debugTimer = new();
    private string _lastDebugOverlay = "";
    private NativeBridge? _bridge;
    private string _webRoot = "";
    private bool _nativeStopping;
    private CoreWebView2Environment? _env;
    private CoreWebView2SharedBuffer? _cmdBuffer;
    private IntPtr _cmdView = IntPtr.Zero;
    internal const int CmdBufferBytes = 8 * 1024 * 1024;

    public MainForm()
    {
        Text = "ThreeBrowser";
        Width = 1280;
        Height = 840;
        MinimumSize = new Size(720, 520);
        BackColor = BrowserChrome.Bar;
        Font = new Font("Segoe UI", 9f);
        KeyPreview = true;

        _chrome.Address.Text = HomeUrl;
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
        _chrome.DebugToggled += (_, _) => SyncDebugHud();
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
            ShutdownNative();
        };
        KeyDown += OnBrowserKey;
    }

    public void ResetNative()
    {
        _ = Task.Run(() =>
        {
            try { Native.tn_runtime_reset(); }
            catch (DllNotFoundException) { }
        });
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
            var done = Task.Run(() => Native.tn_runtime_shutdown());
            while (!done.Wait(15))
            {
                Application.DoEvents();
            }
        }
        catch (DllNotFoundException) { }
    }

    public void ApplyNativeVsync()
    {
        try
        {
            Native.tn_runtime_set_vsync(_chrome.VsyncEnabled ? 1 : 0);
        }
        catch (DllNotFoundException)
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
        try
        {
            if (Native.tn_runtime_hwnd() == IntPtr.Zero)
            {
                return;
            }
            var r = _web.ClientRectangle;
            var w = Math.Max(1, r.Width);
            var h = Math.Max(1, r.Height);
            if (r.Width <= 0 || r.Height <= 0)
            {
                return;
            }
            var origin = _web.PointToScreen(r.Location);
            var local = PointToClient(origin);
            Native.tn_runtime_attach_host(Handle, local.X, local.Y, w, h);
            SetWindowPos(_web.Handle, HWND_TOP, 0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoActivate);
        }
        catch (DllNotFoundException)
        {
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

            foreach (var filter in new[]
            {
                "*three.module.js*",
                "*three.module.min.js*",
                "*three.min.js*",
                "*three.core.js*",
                "*three.core.min.js*",
                "*/build/three.js*",
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

            _web.CoreWebView2.Navigate(HomeUrl);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.ToString(), "ThreeBrowser failed to start WebView2");
        }
    }

    private void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (!_chrome.InjectEnabled)
        {
            return;
        }
        var uri = e.Request?.Uri;
        if (!ThreeInject.IsThreeCoreLibrary(uri))
        {
            return;
        }

        try
        {
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
        if (nbytes <= 0)
        {
            return 1;
        }
        if (nbytes > CmdBufferBytes)
        {
            return 0;
        }
        if (_cmdView != IntPtr.Zero)
        {
            return Native.tn_cmd_submit(_cmdView, nbytes);
        }
        if (_cmdBuffer == null)
        {
            return 0;
        }
        using var stream = _cmdBuffer.OpenStream();
        stream.Position = 0;
        var copy = new byte[nbytes];
        var got = stream.Read(copy, 0, nbytes);
        var pin = System.Runtime.InteropServices.GCHandle.Alloc(copy, System.Runtime.InteropServices.GCHandleType.Pinned);
        try
        {
            return Native.tn_cmd_submit(pin.AddrOfPinnedObject(), got);
        }
        finally
        {
            pin.Free();
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

    private static readonly IntPtr HWND_TOP = IntPtr.Zero;
}
