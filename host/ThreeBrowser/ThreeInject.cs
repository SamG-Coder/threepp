using System.Text;
using Microsoft.Web.WebView2.Core;

namespace ThreeBrowser;

internal static class ThreeInject
{
    internal const string HomeUrl = "https://threebrowser.local/index.html";

    private static string? _classic;
    private static string? _esm;
    private static readonly object Gate = new();

    internal static bool IsThreeCoreLibrary(string? uri)
    {
        if (string.IsNullOrEmpty(uri) || !Uri.TryCreate(uri, UriKind.Absolute, out var parsed))
        {
            return false;
        }

        var path = parsed.AbsolutePath.Replace('\\', '/').ToLowerInvariant();
        if (path.Contains("/addons/", StringComparison.Ordinal) ||
            path.Contains("/jsm/", StringComparison.Ordinal) ||
            path.Contains("three-native", StringComparison.Ordinal) ||
            path.Contains("three-esm-exports", StringComparison.Ordinal))
        {
            return false;
        }

        var file = Path.GetFileName(path);
        // Only the WebGL library entry points. three.webgpu.js is a separate
        // track (IsThreeWebGpuLibrary): it imports ./three.core.js, and swapping
        // that file for native THREE drops exports such as CubeDepthTexture.
        if (file is "three.module.js" or "three.module.min.js" or "three.min.js"
            or "three.cjs")
        {
            return true;
        }

        return file == "three.js" && (
            path.Contains("/build/", StringComparison.Ordinal) ||
            path.Contains("/npm/three", StringComparison.Ordinal) ||
            path.Contains("/ajax/libs/three.js/", StringComparison.Ordinal));
    }

    // three/webgpu is a GPU API (Dawn → D3D12/Vulkan), not a threepp scene graph.
    // Intercept the ESM entry so Native is "on", but serve a shim that re-exports
    // stock three.webgpu.js. Never intercept three.core.js.
    internal static bool IsThreeWebGpuLibrary(string? uri)
    {
        if (string.IsNullOrEmpty(uri) || !Uri.TryCreate(uri, UriKind.Absolute, out var parsed))
        {
            return false;
        }
        if (IsPassthrough(parsed))
        {
            return false;
        }

        var path = parsed.AbsolutePath.Replace('\\', '/').ToLowerInvariant();
        if (path.Contains("/addons/", StringComparison.Ordinal) ||
            path.Contains("/jsm/", StringComparison.Ordinal) ||
            path.Contains("three-native", StringComparison.Ordinal) ||
            path.Contains("three-esm-exports", StringComparison.Ordinal))
        {
            return false;
        }

        var file = Path.GetFileName(path);
        return file is "three.webgpu.js" or "three.webgpu.min.js";
    }

    internal static bool IsPassthrough(string? uri)
    {
        return !string.IsNullOrEmpty(uri) &&
               Uri.TryCreate(uri, UriKind.Absolute, out var parsed) &&
               IsPassthrough(parsed);
    }

    private static bool IsPassthrough(Uri parsed)
    {
        return parsed.Query.Contains("tb-raw=", StringComparison.OrdinalIgnoreCase);
    }

    internal static string PassthroughUri(string uri)
    {
        if (IsPassthrough(uri))
        {
            return uri;
        }
        return uri.Contains('?', StringComparison.Ordinal) ? uri + "&tb-raw=1" : uri + "?tb-raw=1";
    }

    internal static bool IsEsmLibrary(string uri)
    {
        var file = Path.GetFileName(new Uri(uri).AbsolutePath).ToLowerInvariant();
        return file.Contains(".module.", StringComparison.Ordinal) ||
               file.Contains(".core.", StringComparison.Ordinal) ||
               file.Contains(".webgpu.", StringComparison.Ordinal) ||
               file.Contains(".tsl.", StringComparison.Ordinal) ||
               file.EndsWith(".mjs", StringComparison.Ordinal) ||
               file.EndsWith(".cjs", StringComparison.Ordinal);
    }

    internal static string WebGpuShimSource(string requestedUri)
    {
        var stock = PassthroughUri(requestedUri);
        var quoted = JsStringLiteral(stock);
        // export * keeps TSL / Scene / WebGPURenderer's siblings. The explicit
        // WebGPURenderer class shadows the stock export (ESM explicit-wins-star).
        return
            "/* ThreeBrowser: stock WebGPURenderer. Native GPU = command ring + MessageChannel, not threepp. */\n" +
            "export * from " + quoted + ";\n" +
            "import * as TB_WEBGPU from " + quoted + ";\n" +
            "const StockWebGPURenderer = TB_WEBGPU.WebGPURenderer;\n" +
            "function tbNative() {\n" +
            "  try { return globalThis.chrome.webview.hostObjects.sync.native; } catch (e) { return null; }\n" +
            "}\n" +
            "function tbCall(name) {\n" +
            "  const n = tbNative();\n" +
            "  if (!n) return;\n" +
            "  try {\n" +
            "    if (arguments.length <= 1) return n[name]();\n" +
            "    return n[name](arguments[1], arguments[2], arguments[3]);\n" +
            "  } catch (e) {}\n" +
            "}\n" +
            "function tbStyleHitCanvas(el) {\n" +
            "  if (!el || !el.style) return;\n" +
            "  const s = el.style;\n" +
            "  s.position = 'fixed'; s.left = '0'; s.top = '0';\n" +
            "  s.width = '100%'; s.height = '100%'; s.margin = '0';\n" +
            "  s.border = '0'; s.padding = '0'; s.display = 'block';\n" +
            "  s.boxSizing = 'border-box'; s.background = 'transparent';\n" +
            "  s.opacity = '0'; s.pointerEvents = 'auto';\n" +
            "}\n" +
            "function tbOverlayStyle() {\n" +
            "  const doc = globalThis.document;\n" +
            "  if (!doc || doc.getElementById('__tb_wgpu_overlay')) return;\n" +
            "  const style = doc.createElement('style');\n" +
            "  style.id = '__tb_wgpu_overlay';\n" +
            "  style.textContent = 'html,body{background:transparent!important;}';\n" +
            "  (doc.head || doc.documentElement).appendChild(style);\n" +
            "}\n" +
            "export class WebGPURenderer extends StockWebGPURenderer {\n" +
            "  constructor(parameters) {\n" +
            "    super(parameters);\n" +
            "    this._tbWebGpuOn = false;\n" +
            "    this._tbFpsFrames = 0;\n" +
            "    this._tbFpsAcc = 0;\n" +
            "    this._tbFpsLast = (globalThis.performance && performance.now()) || 0;\n" +
            "    this._anim = null;\n" +
            "    this._animPort = null;\n" +
            "    tbOverlayStyle();\n" +
            "    tbStyleHitCanvas(this.domElement);\n" +
            "    tbCall('RuntimeStartWebGpu');\n" +
            "  }\n" +
            "  _tbNotify() {\n" +
            "    if (this._tbWebGpuOn) return;\n" +
            "    this._tbWebGpuOn = true;\n" +
            "    tbCall('RuntimeStartWebGpu');\n" +
            "  }\n" +
            "  _tbTick() {\n" +
            "    this._tbNotify();\n" +
            "    const now = (globalThis.performance && performance.now()) || 0;\n" +
            "    this._tbFpsFrames++;\n" +
            "    this._tbFpsAcc += Math.max(0, now - this._tbFpsLast);\n" +
            "    this._tbFpsLast = now;\n" +
            "    if (this._tbFpsAcc < 400) return;\n" +
            "    const fps = Math.round(this._tbFpsFrames * 1000 / this._tbFpsAcc);\n" +
            "    const el = this.domElement;\n" +
            "    const w = (el && (el.width || el.clientWidth)) | 0;\n" +
            "    const h = (el && (el.height || el.clientHeight)) | 0;\n" +
            "    this._tbFpsFrames = 0;\n" +
            "    this._tbFpsAcc = 0;\n" +
            "    tbCall('WebGpuFrame', fps, w, h);\n" +
            "  }\n" +
            "  async init(...args) {\n" +
            "    this._tbNotify();\n" +
            "    try {\n" +
            "      const n = tbNative();\n" +
            "      const nativeGpu = n && n.WebGpuIsNative && n.WebGpuIsNative();\n" +
            "      if (nativeGpu) {\n" +
            "        const mod = await import('https://threebrowser.local/three-webgpu-gpu.js?tb-native=2');\n" +
            "        if (mod && typeof mod.install === 'function') await mod.install();\n" +
            "      }\n" +
            "    } catch (e) {\n" +
            "      try { console.warn('[ThreeBrowser] native wgpu ring not ready, Chromium Dawn', e); } catch (e2) {}\n" +
            "    }\n" +
            "    const r = await super.init(...args);\n" +
            "    tbStyleHitCanvas(this.domElement);\n" +
            "    return r;\n" +
            "  }\n" +
            "  setAnimationLoop(cb) {\n" +
            "    this._anim = cb;\n" +
            "    if (this._animPort) {\n" +
            "      try { this._animPort.close(); } catch (e) {}\n" +
            "      this._animPort = null;\n" +
            "    }\n" +
            "    if (!cb) {\n" +
            "      try { super.setAnimationLoop(null); } catch (e) {}\n" +
            "      return;\n" +
            "    }\n" +
            "    try { super.setAnimationLoop(null); } catch (e) {}\n" +
            "    const self = this;\n" +
            "    if (typeof MessageChannel === 'function') {\n" +
            "      const ch = new MessageChannel();\n" +
            "      this._animPort = ch.port1;\n" +
            "      const loop = function () {\n" +
            "        if (self._anim !== cb) return;\n" +
            "        try { cb(performance.now()); } catch (err) {\n" +
            "          console.error(err); self._anim = null; return;\n" +
            "        }\n" +
            "        if (self._anim === cb) setTimeout(function () { if (self._anim === cb) ch.port2.postMessage(0); }, 0);\n" +
            "      };\n" +
            "      ch.port1.onmessage = loop;\n" +
            "      const arm = function () { if (self._anim === cb) ch.port2.postMessage(0); };\n" +
            "      setTimeout(arm, 0);\n" +
            "      return;\n" +
            "    }\n" +
            "    return super.setAnimationLoop(cb);\n" +
            "  }\n" +
            "  setSize(width, height, updateStyle) {\n" +
            "    const r = super.setSize(width, height, updateStyle);\n" +
            "    tbStyleHitCanvas(this.domElement);\n" +
            "    return r;\n" +
            "  }\n" +
            "  render(...args) {\n" +
            "    this._tbTick();\n" +
            "    return super.render(...args);\n" +
            "  }\n" +
            "}\n" +
            "try {\n" +
            "  console.info('[ThreeBrowser] three/webgpu: stock renderer, MessageChannel pump, native ring if available');\n" +
            "} catch (e) {}\n";
    }

    private static string JsStringLiteral(string value)
    {
        return "\"" + value
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("\"", "\\\"", StringComparison.Ordinal)
            .Replace("\r", "", StringComparison.Ordinal)
            .Replace("\n", "", StringComparison.Ordinal) + "\"";
    }

    internal static string ClassicSource(string webRoot) => Load(webRoot).classic;

    internal static string EsmSource(string webRoot) => Load(webRoot).esm;

    internal static CoreWebView2WebResourceResponse CreateResponse(
        CoreWebView2Environment env,
        string body)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        var stream = new MemoryStream(bytes, writable: false);
        return env.CreateWebResourceResponse(
            stream,
            200,
            "OK",
            "Content-Type: application/javascript; charset=utf-8\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Cache-Control: no-store");
    }

    private static (string classic, string esm) Load(string webRoot)
    {
        if (_classic != null && _esm != null)
        {
            return (_classic, _esm);
        }

        lock (Gate)
        {
            if (_classic != null && _esm != null)
            {
                return (_classic, _esm);
            }

            var sliceDir = Path.Combine(webRoot, "three");
            if (Directory.Exists(sliceDir))
            {
                var slices = Directory.GetFiles(sliceDir, "*.js")
                    .OrderBy(f => Path.GetFileName(f), StringComparer.OrdinalIgnoreCase)
                    .ToArray();
                if (slices.Length > 0)
                {
                    _classic = string.Join("\n", slices.Select(File.ReadAllText));
                    _esm = _classic + "\n" + BuildEsmFooter(webRoot);
                    return (_classic, _esm);
                }
            }

            var classicPath = Path.Combine(webRoot, "three-native.js");
            var exportsPath = Path.Combine(webRoot, "three-esm-exports.js");
            _classic = File.ReadAllText(classicPath);
            var exports = File.ReadAllText(exportsPath);
            _esm = _classic + "\n" + exports;
            return (_classic, _esm);
        }
    }

    private static string BuildEsmFooter(string webRoot)
    {
        var names = new SortedSet<string>(StringComparer.Ordinal);
        var exportsDir = Path.Combine(webRoot, "three", "exports");
        if (Directory.Exists(exportsDir))
        {
            foreach (var file in Directory.GetFiles(exportsDir, "*.txt"))
            {
                foreach (var line in File.ReadAllLines(file))
                {
                    var name = line.Trim();
                    if (name.Length > 0 && name[0] != '#')
                    {
                        names.Add(name);
                    }
                }
            }
        }

        var sb = new StringBuilder();
        sb.AppendLine("const T = globalThis.THREE;");
        sb.AppendLine("export default T;");
        foreach (var name in names)
        {
            sb.AppendLine("export const " + name + " = T." + name + ";");
        }
        return sb.ToString();
    }
}
