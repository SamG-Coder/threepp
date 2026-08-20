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
        if (file is "three.module.js" or "three.module.min.js" or "three.min.js"
            or "three.core.js" or "three.core.min.js" or "three.cjs")
        {
            return true;
        }

        return file == "three.js" && (
            path.Contains("/build/", StringComparison.Ordinal) ||
            path.Contains("/npm/three", StringComparison.Ordinal) ||
            path.Contains("/ajax/libs/three.js/", StringComparison.Ordinal));
    }

    internal static bool IsEsmLibrary(string uri)
    {
        var file = Path.GetFileName(new Uri(uri).AbsolutePath).ToLowerInvariant();
        return file.Contains(".module.", StringComparison.Ordinal) ||
               file.Contains(".core.", StringComparison.Ordinal) ||
               file.EndsWith(".mjs", StringComparison.Ordinal) ||
               file.EndsWith(".cjs", StringComparison.Ordinal);
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
