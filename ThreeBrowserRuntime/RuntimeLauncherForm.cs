using System.Diagnostics;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ThreeBrowserRuntime;

internal sealed class RuntimeLauncherForm : Form
{
    private readonly string _runtimeDirectory;
    private readonly string _sitePuller;
    private readonly string _launcher;
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

    internal RuntimeLauncherForm(string runtimeDirectory, string sitePuller, string launcher)
    {
        _runtimeDirectory = runtimeDirectory;
        _sitePuller = sitePuller;
        _launcher = launcher;
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
            }
        }
        catch (Exception error)
        {
            await AppendAsync($"Launcher message error: {error.Message}", "error");
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
            var exitCode = await RunProcessAsync("node", _runtimeDirectory,
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
            await AppendAsync("Unpack complete", "success");
            await AppendAsync($"threebrowser launch \"{entry}\"", "command");
            await StatusAsync("Launching native runtime…", "active");
            var launchExit = await RunProcessAsync("node", _runtimeDirectory, [_launcher, entry], _operation.Token);
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
        await InvokeUiAsync("history", history, history.FirstOrDefault() ?? "");
    }

    private static string GetDestination(Uri address)
    {
        var key = address.GetComponents(UriComponents.SchemeAndServer | UriComponents.Path, UriFormat.Unescaped);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant()[..8];
        var leaf = address.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? "site";
        leaf = Path.GetFileNameWithoutExtension(leaf);
        var safe = string.Concat($"{address.Host}-{leaf}".Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '-')).Trim('-');
        if (safe.Length > 52) safe = safe[..52].TrimEnd('-');
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ThreeBrowser", "RuntimeProjects");
        return Path.Combine(root, $"{safe}-{hash}");
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
header{height:72px;display:flex;align-items:center;padding:0 28px;background:rgba(255,255,255,.9);border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:13px}.logo{width:38px;height:38px;border:1px solid #b9d2f8;background:#eef5ff;border-radius:11px;display:grid;place-items:center;color:var(--blue)}.logo svg{width:21px}.brand h1{font-size:16px;margin:0;font-weight:650;letter-spacing:-.01em}.brand p{font-size:12.5px;color:var(--muted);margin:3px 0 0}
main{height:100%;min-height:0;overflow:hidden;padding:24px 28px 26px;display:grid;grid-template-rows:auto minmax(0,1fr);gap:20px;max-width:1280px;width:100%;margin:0 auto}.launch-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 19px;box-shadow:0 6px 24px rgba(25,34,49,.055)}.label-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}.label{font-size:11px;letter-spacing:.08em;font-weight:700;color:#566173}.hint{font-size:12px;color:#8a93a2}.input-row{display:grid;grid-template-columns:1fr auto;gap:10px}.address-wrap{height:44px;border:1px solid #cfd5dd;border-radius:9px;display:flex;align-items:center;background:#fff;transition:.16s}.address-wrap:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px rgba(20,105,220,.12)}.globe{color:#778294;margin:0 10px 0 13px}input{width:100%;height:100%;border:0;outline:0;background:transparent;color:var(--ink);font-size:14px;padding:0 12px 0 0}input::placeholder{color:#9ba3af}
button{height:44px;border-radius:9px;border:1px solid transparent;padding:0 19px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-weight:600;transition:.15s;white-space:nowrap}.primary{background:var(--blue);color:#fff;min-width:174px;box-shadow:0 5px 12px rgba(20,105,220,.19)}.primary:hover{background:var(--blue2);transform:translateY(-1px)}button:disabled{cursor:default;opacity:.48;transform:none!important}.project{font:12px "Cascadia Mono","Consolas",monospace;color:#788292;margin-top:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:16px}
.terminal{position:relative;height:100%;min-height:0;max-height:100%;border-radius:14px;overflow:hidden;background:var(--terminal);border:1px solid #252e3b;box-shadow:0 12px 34px rgba(12,17,24,.16);display:grid;grid-template-rows:46px minmax(0,1fr)}.terminal-head{display:flex;align-items:center;padding:0 15px;background:var(--terminal2);border-bottom:1px solid #293241}.lights{display:flex;gap:7px;margin-right:15px}.lights i{width:9px;height:9px;border-radius:50%;background:#445166}.lights i:nth-child(1){background:#ff6f6f}.lights i:nth-child(2){background:#f5bd4f}.lights i:nth-child(3){background:#59c87a}.terminal-title{color:#a7b3c5;font-size:11px;letter-spacing:.09em;font-weight:700}.terminal-meta{margin-left:12px;color:#627087;font-size:11px}.terminal-actions{margin-left:auto;display:flex;gap:7px}.ghost{height:30px;border:1px solid #3a4659;background:#222b38;color:#bcc8d8;border-radius:7px;padding:0 11px;font-size:12px;font-weight:500}.ghost:hover:not(:disabled){background:#2d3848;border-color:#526078}
.console{position:relative;height:100%;min-height:0;overflow:auto;font:13px/21px "Cascadia Mono","Consolas",monospace;color:#cbd5e1;contain:strict}.console::-webkit-scrollbar{width:11px;height:11px}.console::-webkit-scrollbar-thumb{background:#343f4f;border:3px solid var(--terminal);border-radius:9px}.virtual-space{position:relative;min-width:100%;width:max-content}.virtual-window{position:absolute;left:20px;right:20px;top:0;min-width:max-content}.line{height:21px;line-height:21px;white-space:pre;overflow:hidden;text-overflow:ellipsis}.line.command{color:#61c6ff}.line.command:before{content:"❯ ";color:var(--green);font-weight:700}.line.muted{color:#74839a}.line.success{color:var(--green)}.line.success:before{content:"✓ ";font-weight:700}.line.error{color:var(--red)}.line.warning{color:var(--amber)}.welcome{height:100%;display:grid;place-items:center;text-align:center;color:#708096}.welcome svg{width:38px;color:#3e8eff;margin-bottom:10px}.welcome strong{display:block;color:#d7e1ee;font-size:14px;margin-bottom:4px}.welcome span{font-size:12px}
.runtime-error{position:absolute;inset:46px 0 0;z-index:4;background:#11161e;overflow:auto;padding:24px}.error-card{max-width:900px;margin:0 auto;border:1px solid #57343b;background:#1c1b23;border-radius:12px;overflow:hidden;box-shadow:0 12px 30px rgba(0,0,0,.22)}.error-summary{display:grid;grid-template-columns:38px 1fr auto;gap:13px;align-items:start;padding:17px 18px;background:#251c23;border-bottom:1px solid #57343b}.error-icon{width:38px;height:38px;border-radius:9px;display:grid;place-items:center;background:#4a252d;color:#ff8f9b;font-weight:800}.error-kicker{font:700 10px/1.2 "Segoe UI",sans-serif;letter-spacing:.1em;color:#d9818b;margin-bottom:6px}.error-headline{font:600 14px/1.45 "Cascadia Mono","Consolas",monospace;color:#ffadb5;overflow-wrap:anywhere}.error-close{height:30px;padding:0 11px;border:1px solid #69414a;background:#31242b;color:#e7bec3;border-radius:7px;font-size:12px}.error-close:hover{background:#442d35}.error-details{padding:14px 18px 18px}.error-details summary{cursor:pointer;color:#c9d3e1;font:600 12px "Segoe UI",sans-serif;margin-bottom:12px}.error-details pre{margin:0;padding:14px;border-radius:8px;background:#10141b;border:1px solid #303744;color:#d8dee9;font:12px/1.6 "Cascadia Mono","Consolas",monospace;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}.runtime-error::-webkit-scrollbar{width:11px}.runtime-error::-webkit-scrollbar-thumb{background:#46343b;border:3px solid #11161e;border-radius:9px}
.busy-line{height:2px;position:absolute;left:0;right:0;top:45px;overflow:hidden;z-index:2}.busy-line:after{content:"";display:none;width:34%;height:100%;background:#3c9cff;animation:load 1.05s ease-in-out infinite}.busy .busy-line:after{display:block}@keyframes load{from{transform:translateX(-100%)}to{transform:translateX(390%)}}footer{height:27px;background:#087dcc;color:#fff;display:flex;align-items:center;padding:0 13px;font-size:11.5px;gap:9px}.state-dot{width:6px;height:6px;background:#d9f0ff;border-radius:50%}.error-footer{background:#bd3535}.active-footer .state-dot{animation:pulse 1s infinite}@keyframes pulse{50%{opacity:.25}}@media(max-width:760px){header{padding:0 18px}main{padding:18px}.input-row{grid-template-columns:1fr}.primary{width:100%}.hint{display:none}.brand p{display:none}}
</style></head><body><div class="app"><header><div class="brand"><div class="logo"><svg viewBox="0 0 24 24" fill="none"><path d="M5 3.8 19 12 5 20.2V3.8Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m9 8.6 5.8 3.4L9 15.4V8.6Z" fill="currentColor" opacity=".2"/></svg></div><div><h1>ThreeBrowser Runtime</h1><p>Native web project importer and launcher</p></div></div></header><main><section class="launch-card"><div class="label-row"><span class="label">WEBSITE URL</span><span class="hint">Vite and Three.js projects are detected automatically</span></div><div class="input-row"><div class="address-wrap"><span class="globe">◎</span><input id="address" list="history" placeholder="https://example.com/scene" spellcheck="false" autocomplete="off"><datalist id="history"></datalist></div><button class="primary" id="run"><span>▶</span><span id="run-label">Unpack &amp; launch</span></button></div><div class="project" id="project">A managed project folder will be created for this URL.</div></section>
<section class="terminal" id="terminal"><div class="busy-line"></div><div class="terminal-head"><div class="lights"><i></i><i></i><i></i></div><span class="terminal-title">UNPACK CONSOLE</span><span class="terminal-meta" id="terminal-meta">READY</span><div class="terminal-actions"><button class="ghost" id="clear">Clear</button><button class="ghost" id="open" disabled>Open project</button><button class="ghost" id="stop" disabled>■&nbsp; Stop</button></div></div><div class="console" id="console"><div class="welcome" id="welcome"><div><svg viewBox="0 0 24 24" fill="none"><path d="m8 9 3 3-3 3M13 15h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.4"/></svg><strong>Ready to unpack</strong><span>Enter a URL to stream the import process here.</span></div></div></div></section></main><footer id="footer"><i class="state-dot"></i><span id="status">Ready · HTTP and HTTPS URLs supported</span></footer></div>
<script>
const $=id=>document.getElementById(id),address=$('address'),run=$('run'),stop=$('stop'),open=$('open'),output=$('console'),footer=$('footer');
const ROW=21,OVERSCAN=14,MAX_LINES=50000,lines=[];let space=null,windowEl=null,renderFrame=0;
const send=(action,extra={})=>chrome.webview.postMessage({action,...extra});
function prepareVirtual(){const welcome=$('welcome');if(welcome)welcome.remove();if(space)return;space=document.createElement('div');space.className='virtual-space';windowEl=document.createElement('div');windowEl.className='virtual-window';space.append(windowEl);output.replaceChildren(space)}
function render(forceBottom=false){prepareVirtual();const totalHeight=lines.length*ROW+36;space.style.height=totalHeight+'px';if(forceBottom)output.scrollTop=Math.max(0,totalHeight-output.clientHeight);const start=Math.max(0,Math.floor((output.scrollTop-18)/ROW)-OVERSCAN),count=Math.ceil(output.clientHeight/ROW)+OVERSCAN*2,end=Math.min(lines.length,start+count),fragment=document.createDocumentFragment();for(let i=start;i<end;i++){const item=lines[i],line=document.createElement('div');line.className='line '+item.kind;line.textContent=item.text;fragment.append(line)}windowEl.style.transform=`translateY(${18+start*ROW}px)`;windowEl.replaceChildren(fragment)}
function scheduleRender(){if(renderFrame)return;renderFrame=requestAnimationFrame(()=>{renderFrame=0;render(false)})}
output.addEventListener('scroll',scheduleRender,{passive:true});new ResizeObserver(scheduleRender).observe(output);
run.onclick=()=>send('run',{url:address.value});stop.onclick=()=>send('stop');open.onclick=()=>send('open');$('clear').onclick=()=>{document.querySelector('.runtime-error')?.remove();lines.length=0;space=null;windowEl=null;output.replaceChildren();render(false)};address.onkeydown=e=>{if(e.key==='Enter'&&!run.disabled)run.click()};
window.runtimeUi={
 history(items,current){$('history').replaceChildren(...items.map(x=>Object.assign(document.createElement('option'),{value:x})));if(current&&!address.value)address.value=current},
 focusAddress(){address.focus();address.select()},
 begin(url,path){document.querySelector('.runtime-error')?.remove();lines.length=0;space=null;windowEl=null;output.replaceChildren();$('project').textContent=path;$('terminal-meta').textContent='UNPACKING'},
 appendMany(items){lines.push(...items);if(lines.length>MAX_LINES)lines.splice(0,lines.length-MAX_LINES);render(true)},
 projectReady(){open.disabled=false;$('terminal-meta').textContent='LAUNCHING'},
 showError(raw){document.querySelector('.runtime-error')?.remove();const clean=String(raw||'Unknown runtime error').replace(/\x1b\[[0-9;]*m/g,''),rows=clean.split(/\r?\n/),headline=rows.find(x=>/^\s*(?:Uncaught\s+)?(?:Reference|Type|Syntax|Range|URI|Eval|Aggregate)?Error\s*:/i.test(x))||rows.find(x=>/error/i.test(x))||'The native runtime stopped unexpectedly.';const panel=document.createElement('div');panel.className='runtime-error';const card=document.createElement('section');card.className='error-card';const summary=document.createElement('div');summary.className='error-summary';const icon=document.createElement('div');icon.className='error-icon';icon.textContent='!';const copy=document.createElement('div');copy.innerHTML='<div class="error-kicker">RUNTIME ERROR</div>';const title=document.createElement('div');title.className='error-headline';title.textContent=headline.trim();copy.append(title);const close=document.createElement('button');close.className='error-close';close.textContent='Back to console';close.onclick=()=>panel.remove();summary.append(icon,copy,close);const details=document.createElement('details');details.className='error-details';details.open=true;const label=document.createElement('summary');label.textContent='Error and stack trace';const pre=document.createElement('pre');pre.textContent=clean;details.append(label,pre);card.append(summary,details);panel.append(card);$('terminal').append(panel);$('terminal-meta').textContent='FAILED'},
 setBusy(value){document.body.classList.toggle('busy',value);address.disabled=value;run.disabled=value;stop.disabled=!value;$('run-label').textContent=value?'Working…':'Unpack & launch';if(!value)$('terminal-meta').textContent='READY'},
 status(text,kind='ready'){$('status').textContent=text;footer.className=kind==='error'?'error-footer':kind==='active'?'active-footer':''}
};
</script></body></html>
""";
}
