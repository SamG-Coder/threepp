using System.ComponentModel;
using System.Drawing.Drawing2D;
using System.Drawing.Text;

namespace ThreeBrowser;

internal sealed class ChromeButton : Button
{
    public ChromeButton()
    {
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        FlatAppearance.MouseOverBackColor = BrowserChrome.Hover;
        FlatAppearance.MouseDownBackColor = BrowserChrome.Press;
        BackColor = Color.Transparent;
        ForeColor = BrowserChrome.Ink;
        Size = new Size(32, 32);
        Margin = new Padding(0);
        Padding = new Padding(0);
        Cursor = Cursors.Hand;
        TabStop = false;
        UseVisualStyleBackColor = false;
        Anchor = AnchorStyles.None;
        TextAlign = ContentAlignment.MiddleCenter;
    }
}

internal sealed class FlatAddress : TextBox
{
    public FlatAddress()
    {
        BorderStyle = BorderStyle.None;
        AutoSize = false;
        Margin = new Padding(0);
        Padding = new Padding(0);
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.Style &= ~0x00800000;   // WS_BORDER
            cp.ExStyle &= ~0x00000200; // WS_EX_CLIENTEDGE
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        TryClearTheme();
    }

    private void TryClearTheme()
    {
        try
        {
            SetWindowTheme(Handle, "", "");
        }
        catch (EntryPointNotFoundException)
        {
        }
    }

    [System.Runtime.InteropServices.DllImport("uxtheme.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern int SetWindowTheme(IntPtr hWnd, string pszSubAppName, string pszSubIdList);
}

internal sealed class BackendMenu : ToolStripDropDown
{
    public BackendMenu(bool vulkanOn, bool vulkanOk, Action<bool> choose)
    {
        AutoSize = false;
        Padding = new Padding(6);
        BackColor = Color.White;
        DropShadowEnabled = true;
        var panel = new Panel
        {
            Size = new Size(172, 84),
            BackColor = Color.White,
        };
        panel.Paint += (_, e) =>
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var pen = new Pen(BrowserChrome.Line);
            var r = panel.ClientRectangle;
            r.Width -= 1;
            r.Height -= 1;
            e.Graphics.DrawRectangle(pen, r);
        };
        panel.Controls.Add(MakeRow("OpenGL", !vulkanOn, true, () =>
        {
            Close();
            choose(false);
        }, 6));
        panel.Controls.Add(MakeRow("Vulkan", vulkanOn, vulkanOk, () =>
        {
            Close();
            if (vulkanOk)
            {
                choose(true);
            }
        }, 44));
        Items.Add(new ToolStripControlHost(panel)
        {
            Margin = Padding.Empty,
            Padding = Padding.Empty,
        });
        Size = new Size(184, 96);
    }

    private static Control MakeRow(string title, bool selected, bool enabled, Action click, int y)
    {
        var row = new Panel
        {
            Location = new Point(6, y),
            Size = new Size(160, 36),
            Cursor = enabled ? Cursors.Hand : Cursors.Default,
            BackColor = Color.White,
        };
        row.Paint += (_, e) =>
        {
            var g = e.Graphics;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            var hot = enabled && row.ClientRectangle.Contains(row.PointToClient(Cursor.Position));
            if (hot)
            {
                using var fill = new SolidBrush(BrowserChrome.Hover);
                g.FillRectangle(fill, row.ClientRectangle);
            }
            if (selected)
            {
                using var font = new Font("Segoe MDL2 Assets", 9f);
                TextRenderer.DrawText(
                    g, "\uE73E", font,
                    new Rectangle(8, 0, 22, row.Height),
                    BrowserChrome.Accent,
                    TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            }
            using var label = new Font("Segoe UI Semibold", 10f);
            var ink = enabled ? BrowserChrome.Ink : BrowserChrome.Mute;
            TextRenderer.DrawText(
                g, title, label,
                new Rectangle(34, 0, row.Width - 40, row.Height),
                ink,
                TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        };
        row.MouseEnter += (_, _) => row.Invalidate();
        row.MouseLeave += (_, _) => row.Invalidate();
        row.Click += (_, _) =>
        {
            if (enabled)
            {
                click();
            }
        };
        return row;
    }
}

internal sealed class BrowserChrome : Panel
{
    internal static readonly Color Bar = Color.FromArgb(241, 243, 244);
    internal static readonly Color Ink = Color.FromArgb(32, 33, 36);
    internal static readonly Color Mute = Color.FromArgb(95, 99, 104);
    internal static readonly Color Hover = Color.FromArgb(232, 234, 237);
    internal static readonly Color Press = Color.FromArgb(218, 220, 224);
    internal static readonly Color Omnibox = Color.White;
    internal static readonly Color Line = Color.FromArgb(218, 220, 224);
    internal static readonly Color Accent = Color.FromArgb(26, 115, 232);
    internal static readonly Color NativeFill = Color.FromArgb(232, 240, 254);
    internal static readonly Color NativeInk = Color.FromArgb(24, 90, 188);

    internal readonly ChromeButton BackButton = MakeIcon('\uE72B', "Back (Alt+Left)");
    internal readonly ChromeButton ForwardButton = MakeIcon('\uE72A', "Forward (Alt+Right)");
    internal readonly ChromeButton ReloadButton = MakeIcon('\uE72C', "Reload (Ctrl+R)");
    internal readonly ChromeButton HomeButton = MakeIcon('\uE80F', "Home");
    internal readonly ChromeButton SandboxBtn = MakeSandboxButton();
    internal readonly ChromeButton AgentBtn = MakeAgentButton();
    internal readonly ChromeButton DebugBtn = MakeIcon('\uE9F9', "Debug (FPS)");
    internal readonly ChromeButton NativeWindowBtn = MakeIcon('\uE8A7', "Open native test window");
    internal readonly ChromeButton VsyncBtn = MakeIcon('\uE895', "Vsync on/off");
    internal readonly ChromeButton NativeBtn = MakeIcon('\uE964', "Native THREE (Ctrl+Shift+N)");
    internal readonly ChromeButton WebGlBtn = MakeIcon('\uE774', "Stock WebGL (Ctrl+Shift+N)");
    internal readonly FlatAddress Address = new();
    internal readonly Label Badge = new();

    private readonly Panel _omnibox = new();
    private readonly TableLayoutPanel _bar;
    private bool _injectOn = true;
    private bool _vsyncOn;
    private bool _debugOn;
    private bool _sandboxActive;
    private bool _vulkan;
    private bool _loading;
    private BackendMenu? _backendMenu;

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    [Browsable(false)]
    internal bool InjectEnabled
    {
        get => _injectOn;
        set
        {
            if (_injectOn == value)
            {
                return;
            }
            _injectOn = value;
            PaintInject();
        }
    }

    internal event EventHandler? InjectToggled;
    internal event EventHandler? VsyncToggled;
    internal event EventHandler? DebugToggled;
    internal event EventHandler? NativeWindowRequested;
    internal event EventHandler? SandboxRequested;
    internal event EventHandler? AgentRequested;
    internal event EventHandler? BackendChanged;

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    [Browsable(false)]
    internal bool VulkanEnabled => _vulkan;

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    [Browsable(false)]
    internal bool VsyncEnabled => _vsyncOn;

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    [Browsable(false)]
    internal bool DebugEnabled => _debugOn;

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    [Browsable(false)]
    internal bool SandboxActive
    {
        get => _sandboxActive;
        set
        {
            if (_sandboxActive == value)
            {
                return;
            }
            _sandboxActive = value;
            PaintInject();
        }
    }

    internal bool IsLoading => _loading;

    public BrowserChrome()
    {
        DoubleBuffered = true;
        Dock = DockStyle.Top;
        Height = 52;
        BackColor = Bar;
        Padding = new Padding(0);

        _bar = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 12,
            RowCount = 1,
            Padding = new Padding(6, 0, 6, 0),
            Margin = new Padding(0),
            BackColor = Bar,
        };
        _bar.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));
        _bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 36));
        _bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 36));
        _bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 36));
        _bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 36));
        _bar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
        _bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 36));
        _bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 36));
        _bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 36));
        _bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 36));
        _bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 36));
        _bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 36));
        _bar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 36));

        Place(_bar, BackButton, 0);
        Place(_bar, ForwardButton, 1);
        Place(_bar, ReloadButton, 2);
        Place(_bar, HomeButton, 3);
        Place(_bar, NativeWindowBtn, 5);
        Place(_bar, DebugBtn, 6);
        Place(_bar, VsyncBtn, 7);
        Place(_bar, NativeBtn, 8);
        Place(_bar, WebGlBtn, 9);
        Place(_bar, SandboxBtn, 10);
        Place(_bar, AgentBtn, 11);
        SandboxBtn.Click += (_, _) => SandboxRequested?.Invoke(this, EventArgs.Empty);
        AgentBtn.Click += (_, _) => AgentRequested?.Invoke(this, EventArgs.Empty);
        DebugBtn.Click += (_, _) => ToggleDebug();
        NativeWindowBtn.Click += (_, _) => NativeWindowRequested?.Invoke(this, EventArgs.Empty);
        VsyncBtn.Click += (_, _) => ToggleVsync();
        NativeBtn.Click += (_, _) => SetMode(true);
        WebGlBtn.Click += (_, _) => SetMode(false);
        PaintInject();

        _omnibox.Dock = DockStyle.Fill;
        _omnibox.Margin = new Padding(6, 10, 6, 10);
        _omnibox.BackColor = Color.Transparent;
        typeof(Panel).GetProperty("DoubleBuffered",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
            ?.SetValue(_omnibox, true, null);
        _omnibox.Paint += OnOmniboxPaint;
        _omnibox.Resize += (_, _) => LayoutOmnibox();
        _omnibox.Padding = new Padding(0);

        Badge.AutoSize = false;
        Badge.TextAlign = ContentAlignment.MiddleLeft;
        Badge.Font = new Font("Segoe UI Semibold", 8.5f);
        Badge.ForeColor = NativeInk;
        Badge.BackColor = Omnibox;
        Badge.Text = "Native  \u25BE";
        Badge.Size = new Size(78, 20);
        Badge.Cursor = Cursors.Hand;
        Badge.Click += (_, _) => ShowBackendMenu();

        Address.Font = new Font("Segoe UI", 11f);
        Address.ForeColor = Ink;
        Address.BackColor = Omnibox;
        Address.PlaceholderText = "Search Google or type a URL";

        _omnibox.Controls.Add(Address);
        _omnibox.Controls.Add(Badge);
        _bar.Controls.Add(_omnibox, 4, 0);

        Controls.Add(_bar);
    }

    internal void SetBadge(bool native)
    {
        Badge.Text = native ? "Native  \u25BE" : "WebGL";
        Badge.ForeColor = native ? NativeInk : Mute;
        Badge.Cursor = native ? Cursors.Hand : Cursors.Default;
        _omnibox.Invalidate();
        if (IsHandleCreated)
        {
            BeginInvoke(LayoutOmnibox);
        }
    }

    internal void SetVulkan(bool vulkan)
    {
        if (_vulkan == vulkan)
        {
            return;
        }
        _vulkan = vulkan;
    }

    internal void SetNav(bool canBack, bool canForward)
    {
        BackButton.Enabled = canBack;
        ForwardButton.Enabled = canForward;
        BackButton.ForeColor = canBack ? Ink : Mute;
        ForwardButton.ForeColor = canForward ? Ink : Mute;
    }

    internal void SetLoading(bool loading)
    {
        _loading = loading;
        ReloadButton.Text = loading ? "\uE711" : "\uE72C";
        ReloadButton.AccessibleName = loading ? "Stop" : "Reload (Ctrl+R)";
        Cursor = loading ? Cursors.AppStarting : Cursors.Default;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var pen = new Pen(_loading ? Accent : Line, _loading ? 2f : 1f);
        var y = Height - (int)Math.Ceiling(pen.Width);
        e.Graphics.DrawLine(pen, 0, y, Width, y);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        BeginInvoke(LayoutOmnibox);
    }

    private void LayoutOmnibox()
    {
        var r = _omnibox.ClientRectangle;
        if (r.Width < 40 || r.Height < 8)
        {
            return;
        }
        var inner = Rectangle.Inflate(r, -12, -2);
        var textH = Address.Font.Height;
        var y = inner.Y + Math.Max(0, (inner.Height - textH) / 2);
        var chipW = _injectOn ? 78 : 52;
        Badge.SetBounds(inner.X, y, chipW, textH);
        Address.SetBounds(Badge.Right + 6, y, Math.Max(20, inner.Right - (Badge.Right + 10)), textH);
        _omnibox.Invalidate();
    }

    private void SetMode(bool native)
    {
        if (_injectOn == native)
        {
            return;
        }
        _injectOn = native;
        PaintInject();
        InjectToggled?.Invoke(this, EventArgs.Empty);
    }

    private void ToggleVsync()
    {
        if (!_injectOn)
        {
            return;
        }
        _vsyncOn = !_vsyncOn;
        PaintInject();
        VsyncToggled?.Invoke(this, EventArgs.Empty);
    }

    private void ShowBackendMenu()
    {
        if (!_injectOn)
        {
            return;
        }
        _backendMenu?.Close();
        var vulkanOk = Native.HasVulkan();
        _backendMenu = new BackendMenu(_vulkan, vulkanOk, SetBackendFromMenu);
        var origin = Badge.PointToScreen(new Point(-4, Badge.Height + 8));
        _backendMenu.Show(origin);
    }

    private void SetBackendFromMenu(bool vulkan)
    {
        if (_vulkan == vulkan)
        {
            return;
        }
        _vulkan = vulkan;
        BackendChanged?.Invoke(this, EventArgs.Empty);
    }

    private void ToggleDebug()
    {
        if (!_injectOn)
        {
            return;
        }
        _debugOn = !_debugOn;
        PaintInject();
        DebugToggled?.Invoke(this, EventArgs.Empty);
    }

    private void PaintInject()
    {
        DebugBtn.Visible = _injectOn;
        NativeWindowBtn.Visible = _injectOn && _debugOn;
        VsyncBtn.Visible = _injectOn;
        SandboxBtn.Visible = true;
        AgentBtn.Visible = true;
        if (_bar.ColumnStyles.Count > 8)
        {
            _bar.ColumnStyles[5].Width = _injectOn && _debugOn ? 36 : 0;
            _bar.ColumnStyles[6].Width = _injectOn ? 36 : 0;
            _bar.ColumnStyles[7].Width = _injectOn ? 36 : 0;
        }
        StyleSandbox();
        StyleMode(AgentBtn, false);
        StyleMode(DebugBtn, _debugOn);
        StyleMode(NativeWindowBtn, false);
        StyleMode(VsyncBtn, _vsyncOn);
        StyleMode(NativeBtn, _injectOn);
        StyleMode(WebGlBtn, !_injectOn);
        SetBadge(_injectOn);
        DebugBtn.AccessibleName = _debugOn ? "Debug on" : "Debug off";
        VsyncBtn.AccessibleName = _vsyncOn ? "Vsync on" : "Vsync off";
    }

    private void StyleSandbox()
    {
        SandboxBtn.BackColor = _sandboxActive ? NativeFill : Color.Transparent;
        SandboxBtn.ForeColor = _sandboxActive ? NativeInk : Ink;
        SandboxBtn.FlatAppearance.BorderSize = 0;
        SandboxBtn.FlatAppearance.MouseOverBackColor = Hover;
        SandboxBtn.FlatAppearance.MouseDownBackColor = Press;
        SandboxBtn.AccessibleName = _sandboxActive ? "Sandbox active" : "Sandbox";
    }

    private static void StyleMode(Button btn, bool on)
    {
        btn.BackColor = Color.Transparent;
        btn.ForeColor = on ? Accent : Ink;
        btn.FlatAppearance.BorderSize = 0;
        btn.FlatAppearance.MouseOverBackColor = Hover;
        btn.FlatAppearance.MouseDownBackColor = Press;
    }

    private void OnOmniboxPaint(object? sender, PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        var r = _omnibox.ClientRectangle;
        var stroke = Address.Focused ? 2f : 1f;
        var inset = (int)Math.Ceiling(stroke);
        r.X += inset;
        r.Y += inset;
        r.Width -= inset * 2 + 1;
        r.Height -= inset * 2 + 1;
        if (r.Width < 8 || r.Height < 8)
        {
            return;
        }
        using var path = Round(r, r.Height / 2);
        using var fill = new SolidBrush(Omnibox);
        using var pen = new Pen(Address.Focused ? Accent : Line, stroke);
        e.Graphics.FillPath(fill, path);
        e.Graphics.DrawPath(pen, path);
    }

    private static void Place(TableLayoutPanel table, Control c, int col)
    {
        table.Controls.Add(c, col, 0);
    }

    private static GraphicsPath Round(Rectangle r, int radius)
    {
        radius = Math.Max(1, Math.Min(radius, Math.Min(r.Width, r.Height) / 2));
        var d = radius * 2;
        var p = new GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    private static ChromeButton MakeIcon(char glyph, string tip)
    {
        var b = new ChromeButton
        {
            Text = glyph.ToString(),
            Font = IconFont(),
            AccessibleName = tip,
        };
        var t = new ToolTip();
        t.SetToolTip(b, tip);
        return b;
    }

    private static ChromeButton MakeSandboxButton()
    {
        var button = new ChromeButton
        {
            Text = "⚗",
            Font = new Font("Segoe UI Symbol", 13f),
            AccessibleName = "Sandbox",
        };
        var tip = new ToolTip();
        tip.SetToolTip(button, "Sandbox HTML editor");
        return button;
    }

    private static ChromeButton MakeAgentButton()
    {
        var button = new ChromeButton
        {
            Text = "◇",
            Font = new Font("Segoe UI Symbol", 13f),
            AccessibleName = "Offline agent harness",
        };
        var tip = new ToolTip();
        tip.SetToolTip(button, "Offline agent harness");
        return button;
    }

    private static Font IconFont()
    {
        try
        {
            return new Font("Segoe MDL2 Assets", 10f);
        }
        catch (ArgumentException)
        {
            return new Font("Segoe UI Symbol", 10f);
        }
    }
}
