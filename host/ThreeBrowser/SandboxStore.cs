using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ThreeBrowser;

internal sealed record SandboxFileSummary(string Path, long Size, bool IsHtml);

internal sealed record SandboxPageSummary(
    Guid Id,
    string Title,
    DateTime UpdatedUtc,
    string EntryPath,
    IReadOnlyList<SandboxFileSummary> Files);

internal sealed record SandboxPage(Guid Id, string Title, string Html, string FilePath, DateTime UpdatedUtc);

internal sealed record SandboxImportFile(string Path, byte[] Content);

internal sealed record SandboxResource(byte[] Content, string ContentType);

internal sealed partial class SandboxStore
{
    private const string DefaultEntryPath = "index.html";
    private const string MetadataFileName = "sandbox.json";
    private readonly string _root;

    internal SandboxStore()
    {
        _root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ThreeBrowser",
            "Sandboxes");
    }

    internal IReadOnlyList<SandboxPageSummary> List()
    {
        if (!Directory.Exists(_root))
        {
            return [];
        }

        var pages = new List<SandboxPageSummary>();
        foreach (var directory in Directory.EnumerateDirectories(_root))
        {
            if (!Guid.TryParse(Path.GetFileName(directory), out var id))
            {
                continue;
            }

            try
            {
                var files = ListFiles(id);
                if (files.Count == 0)
                {
                    continue;
                }
                var metadata = ReadMetadata(directory);
                var entryPath = FindEntryPath(files, metadata?.EntryPath);
                var htmlPath = ResolveFilePath(id, entryPath);
                var title = metadata?.Title;
                if (string.IsNullOrWhiteSpace(title) && File.Exists(htmlPath) && IsHtml(entryPath))
                {
                    title = ExtractTitle(File.ReadAllText(htmlPath));
                }
                var updatedUtc = metadata?.UpdatedUtc ?? files
                    .Select(file => File.GetLastWriteTimeUtc(ResolveFilePath(id, file.Path)))
                    .DefaultIfEmpty(DateTime.UtcNow)
                    .Max();
                pages.Add(new SandboxPageSummary(
                    id,
                    string.IsNullOrWhiteSpace(title) ? "Untitled project" : title,
                    updatedUtc,
                    entryPath,
                    files));
            }
            catch (IOException)
            {
                // A project being written should not prevent the rest of the library loading.
            }
            catch (UnauthorizedAccessException)
            {
            }
        }

        return pages.OrderByDescending(page => page.UpdatedUtc).ToArray();
    }

    internal SandboxPage? Load(Guid id, string relativePath)
    {
        relativePath = NormalizeRelativePath(relativePath);
        if (!IsHtml(relativePath))
        {
            return null;
        }
        var path = ResolveFilePath(id, relativePath);
        if (!File.Exists(path))
        {
            return null;
        }

        var html = File.ReadAllText(path);
        var metadata = ReadMetadata(PageDirectory(id));
        return new SandboxPage(
            id,
            ExtractTitle(html),
            html,
            relativePath,
            metadata?.UpdatedUtc ?? File.GetLastWriteTimeUtc(path));
    }

    internal SandboxPageSummary Save(Guid id, string relativePath, string html)
    {
        relativePath = NormalizeRelativePath(relativePath);
        if (!IsHtml(relativePath))
        {
            throw new InvalidOperationException("Only HTML files can be edited in the sandbox editor.");
        }
        var directory = PageDirectory(id);
        var path = ResolveFilePath(id, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var title = ExtractTitle(html);
        var updatedUtc = DateTime.UtcNow;
        File.WriteAllText(path, html);
        WriteMetadata(directory, new Metadata(title, updatedUtc, relativePath));
        return new SandboxPageSummary(id, title, updatedUtc, relativePath, ListFiles(id));
    }

    internal void Import(Guid id, IReadOnlyList<SandboxImportFile> files)
    {
        if (files.Count == 0)
        {
            return;
        }
        var directory = PageDirectory(id);
        Directory.CreateDirectory(directory);
        foreach (var file in files)
        {
            var relativePath = NormalizeRelativePath(file.Path);
            if (relativePath.Equals(MetadataFileName, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            var path = ResolveFilePath(id, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllBytes(path, file.Content);
        }

        var summaries = ListFiles(id);
        var previous = ReadMetadata(directory);
        var entryPath = FindEntryPath(summaries, previous?.EntryPath);
        var title = previous?.Title;
        var entryFile = ResolveFilePath(id, entryPath);
        if (IsHtml(entryPath) && File.Exists(entryFile))
        {
            title = ExtractTitle(File.ReadAllText(entryFile));
        }
        WriteMetadata(directory, new Metadata(
            string.IsNullOrWhiteSpace(title) ? "Untitled project" : title,
            DateTime.UtcNow,
            entryPath));
    }

    internal SandboxResource? ReadResource(Guid id, string relativePath)
    {
        relativePath = NormalizeRelativePath(relativePath);
        if (relativePath.Equals(MetadataFileName, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        var path = ResolveFilePath(id, relativePath);
        return File.Exists(path)
            ? new SandboxResource(File.ReadAllBytes(path), ContentType(relativePath))
            : null;
    }

    internal bool Delete(Guid id)
    {
        var directory = PageDirectory(id);
        if (!Directory.Exists(directory))
        {
            return false;
        }
        DeleteDirectoryContentsSafely(new DirectoryInfo(directory));
        Directory.Delete(directory);
        return true;
    }

    internal string GetProjectDirectory(Guid id)
    {
        var directory = PageDirectory(id);
        if (!Directory.Exists(directory))
        {
            throw new DirectoryNotFoundException("The selected sandbox project no longer exists.");
        }
        return directory;
    }

    private IReadOnlyList<SandboxFileSummary> ListFiles(Guid id)
    {
        var directory = PageDirectory(id);
        if (!Directory.Exists(directory))
        {
            return [];
        }
        var files = new List<SandboxFileSummary>();
        CollectFiles(new DirectoryInfo(directory), directory, files);
        return files.OrderBy(file => file.Path, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static void CollectFiles(
        DirectoryInfo directory,
        string projectRoot,
        List<SandboxFileSummary> files)
    {
        if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
        {
            return;
        }
        foreach (var file in directory.EnumerateFiles())
        {
            if ((file.Attributes & FileAttributes.ReparsePoint) != 0 ||
                file.Name.Equals(MetadataFileName, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            var relative = Path.GetRelativePath(projectRoot, file.FullName).Replace('\\', '/');
            files.Add(new SandboxFileSummary(relative, file.Length, IsHtml(relative)));
        }
        foreach (var child in directory.EnumerateDirectories())
        {
            CollectFiles(child, projectRoot, files);
        }
    }

    private static void DeleteDirectoryContentsSafely(DirectoryInfo directory)
    {
        if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
        {
            throw new IOException("The sandbox contains a linked folder and cannot be deleted safely.");
        }
        foreach (var file in directory.EnumerateFiles())
        {
            if ((file.Attributes & FileAttributes.ReparsePoint) != 0)
            {
                throw new IOException("The sandbox contains a linked file and cannot be deleted safely.");
            }
            file.Delete();
        }
        foreach (var child in directory.EnumerateDirectories())
        {
            DeleteDirectoryContentsSafely(child);
            child.Delete();
        }
    }

    private string PageDirectory(Guid id) => Path.Combine(_root, id.ToString("D"));

    private string ResolveFilePath(Guid id, string relativePath)
    {
        var projectRoot = Path.GetFullPath(PageDirectory(id));
        var path = Path.GetFullPath(Path.Combine(projectRoot, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        var boundary = projectRoot.EndsWith(Path.DirectorySeparatorChar)
            ? projectRoot
            : projectRoot + Path.DirectorySeparatorChar;
        if (!path.StartsWith(boundary, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("The file path is outside the sandbox project.");
        }
        return path;
    }

    private static string NormalizeRelativePath(string path)
    {
        path = Uri.UnescapeDataString(path ?? "").Replace('\\', '/').Trim('/');
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0 || parts.Any(part =>
                part is "." or ".." ||
                part.Contains(':') ||
                part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0))
        {
            throw new InvalidDataException("The sandbox file path is invalid.");
        }
        return string.Join('/', parts);
    }

    private static string FindEntryPath(IReadOnlyList<SandboxFileSummary> files, string? preferred)
    {
        if (!string.IsNullOrWhiteSpace(preferred) &&
            files.Any(file => file.IsHtml && file.Path.Equals(preferred, StringComparison.OrdinalIgnoreCase)))
        {
            return preferred;
        }
        return files.FirstOrDefault(file => file.Path.Equals(DefaultEntryPath, StringComparison.OrdinalIgnoreCase))?.Path
               ?? files.FirstOrDefault(file => file.IsHtml)?.Path
               ?? files.FirstOrDefault()?.Path
               ?? DefaultEntryPath;
    }

    private static Metadata? ReadMetadata(string directory)
    {
        var path = Path.Combine(directory, MetadataFileName);
        if (!File.Exists(path))
        {
            return null;
        }
        try
        {
            return JsonSerializer.Deserialize<Metadata>(File.ReadAllText(path));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static void WriteMetadata(string directory, Metadata metadata) =>
        File.WriteAllText(Path.Combine(directory, MetadataFileName), JsonSerializer.Serialize(metadata));

    private static bool IsHtml(string path) =>
        Path.GetExtension(path).Equals(".html", StringComparison.OrdinalIgnoreCase) ||
        Path.GetExtension(path).Equals(".htm", StringComparison.OrdinalIgnoreCase);

    private static string ExtractTitle(string html)
    {
        var match = TitleRegex().Match(html);
        var title = match.Success ? WebUtility.HtmlDecode(match.Groups[1].Value).Trim() : "";
        title = WhitespaceRegex().Replace(title, " ");
        return string.IsNullOrWhiteSpace(title) ? "Untitled page" : title;
    }

    private static string ContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" or ".htm" => "text/html; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".js" or ".mjs" => "text/javascript; charset=utf-8",
        ".json" or ".map" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".ico" => "image/x-icon",
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        ".ttf" => "font/ttf",
        ".wasm" => "application/wasm",
        ".mp3" => "audio/mpeg",
        ".mp4" => "video/mp4",
        _ => "application/octet-stream",
    };

    private sealed record Metadata(string Title, DateTime UpdatedUtc, string EntryPath);

    [GeneratedRegex(@"<title\b[^>]*>(.*?)</title\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex TitleRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
