using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ThreeBrowser;

internal sealed record SandboxFileSummary(string Path, long Size, bool IsHtml);

internal sealed record SandboxPageSummary(
    Guid Id,
    string Title,
    DateTime UpdatedUtc,
    string EntryPath,
    IReadOnlyList<SandboxFileSummary> Files,
    string? LastModel = null);

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
                    files,
                    metadata?.LastModel));
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
        var path = ResolveFilePath(id, relativePath);
        if (!File.Exists(path))
        {
            return null;
        }
        var bytes = File.ReadAllBytes(path);
        if (bytes.Length > 2 * 1024 * 1024 || bytes.Contains((byte)0))
        {
            throw new InvalidDataException("This file is binary or larger than the 2 MB text-editor limit.");
        }
        string text;
        try
        {
            text = new System.Text.UTF8Encoding(false, true).GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            throw new InvalidDataException("This file is not valid UTF-8 text and cannot be opened in the text editor.");
        }
        var metadata = ReadMetadata(PageDirectory(id));
        return new SandboxPage(
            id,
            IsHtml(relativePath) ? ExtractTitle(text) : metadata?.Title ?? Path.GetFileName(relativePath),
            text,
            relativePath,
            metadata?.UpdatedUtc ?? File.GetLastWriteTimeUtc(path));
    }

    internal SandboxPageSummary Save(Guid id, string relativePath, string text)
    {
        relativePath = NormalizeRelativePath(relativePath);
        var directory = PageDirectory(id);
        var path = ResolveFilePath(id, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var previous = ReadMetadata(directory);
        var title = IsHtml(relativePath)
            ? ExtractTitle(text)
            : previous?.Title ?? "Untitled project";
        var updatedUtc = DateTime.UtcNow;
        File.WriteAllText(path, text);
        var files = ListFiles(id);
        var entryPath = FindEntryPath(files, previous?.EntryPath ?? relativePath);
        WriteMetadata(directory, new Metadata(title, updatedUtc, entryPath, previous?.LastModel));
        return new SandboxPageSummary(id, title, updatedUtc, entryPath, files, previous?.LastModel);
    }

    internal SandboxPageSummary CreateProject(string title)
    {
        title = NormalizeProjectTitle(title);
        var id = Guid.NewGuid();
        var encodedTitle = WebUtility.HtmlEncode(title);
        var html = $"<!doctype html>\r\n<html lang=\"en\">\r\n<head>\r\n  <meta charset=\"utf-8\">\r\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\r\n  <title>{encodedTitle}</title>\r\n</head>\r\n<body>\r\n  <h1>{encodedTitle}</h1>\r\n</body>\r\n</html>\r\n";
        return Save(id, DefaultEntryPath, html);
    }

    internal void RenameProject(Guid id, string title)
    {
        title = NormalizeProjectTitle(title);
        var directory = PageDirectory(id);
        if (!Directory.Exists(directory))
        {
            throw new DirectoryNotFoundException("The selected sandbox project no longer exists.");
        }
        var files = ListFiles(id);
        var previous = ReadMetadata(directory);
        WriteMetadata(directory, new Metadata(
            title,
            DateTime.UtcNow,
            FindEntryPath(files, previous?.EntryPath),
            previous?.LastModel));
    }

    internal string CreateFile(Guid id, string relativePath)
    {
        relativePath = NormalizeManagedPath(relativePath);
        var directory = PageDirectory(id);
        if (!Directory.Exists(directory))
        {
            throw new DirectoryNotFoundException("The selected sandbox project no longer exists.");
        }
        var path = ResolveFilePath(id, relativePath);
        if (File.Exists(path))
        {
            throw new IOException("A file with that name already exists.");
        }
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var content = IsHtml(relativePath)
            ? "<!doctype html>\r\n<html lang=\"en\">\r\n<head>\r\n  <meta charset=\"utf-8\">\r\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\r\n  <title>Untitled page</title>\r\n</head>\r\n<body>\r\n</body>\r\n</html>\r\n"
            : "";
        File.WriteAllText(path, content);
        TouchMetadata(id);
        return relativePath;
    }

    internal string RenameFile(Guid id, string relativePath, string newRelativePath)
    {
        relativePath = NormalizeManagedPath(relativePath);
        newRelativePath = NormalizeManagedPath(newRelativePath);
        if (relativePath.Equals(newRelativePath, StringComparison.OrdinalIgnoreCase))
        {
            return relativePath;
        }
        var source = ResolveFilePath(id, relativePath);
        var destination = ResolveFilePath(id, newRelativePath);
        if (!File.Exists(source))
        {
            throw new FileNotFoundException("The selected sandbox file no longer exists.", relativePath);
        }
        if (File.Exists(destination))
        {
            throw new IOException("A file with that name already exists.");
        }
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        File.Move(source, destination);
        RemoveEmptyParentDirectories(Path.GetDirectoryName(source)!, PageDirectory(id));

        var directory = PageDirectory(id);
        var previous = ReadMetadata(directory);
        var entryPath = previous?.EntryPath.Equals(relativePath, StringComparison.OrdinalIgnoreCase) == true
            ? newRelativePath
            : FindEntryPath(ListFiles(id), previous?.EntryPath);
        WriteMetadata(directory, new Metadata(
            previous?.Title ?? "Untitled project",
            DateTime.UtcNow,
            entryPath,
            previous?.LastModel));
        return newRelativePath;
    }

    internal void DeleteFile(Guid id, string relativePath)
    {
        relativePath = NormalizeManagedPath(relativePath);
        var files = ListFiles(id);
        if (files.Count <= 1)
        {
            throw new InvalidOperationException("A sandbox project must contain at least one file.");
        }
        var path = ResolveFilePath(id, relativePath);
        if (!File.Exists(path))
        {
            throw new FileNotFoundException("The selected sandbox file no longer exists.", relativePath);
        }
        var attributes = File.GetAttributes(path);
        if ((attributes & FileAttributes.ReparsePoint) != 0)
        {
            throw new IOException("Linked files cannot be deleted from a sandbox project.");
        }
        File.Delete(path);
        RemoveEmptyParentDirectories(Path.GetDirectoryName(path)!, PageDirectory(id));
        TouchMetadata(id);
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
            entryPath,
            previous?.LastModel));
    }

    internal void SetLastModel(Guid id, string model)
    {
        model = model?.Trim() ?? "";
        if (model.Length is < 1 or > 240)
        {
            throw new InvalidDataException("The Ollama model name is invalid.");
        }
        var directory = PageDirectory(id);
        if (!Directory.Exists(directory))
        {
            throw new DirectoryNotFoundException("The selected sandbox project no longer exists.");
        }
        var files = ListFiles(id);
        var previous = ReadMetadata(directory);
        WriteMetadata(directory, new Metadata(
            previous?.Title ?? "Untitled project",
            previous?.UpdatedUtc ?? DateTime.UtcNow,
            FindEntryPath(files, previous?.EntryPath),
            model));
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

    internal string? ResolveResourcePath(Guid id, string relativePath)
    {
        relativePath = NormalizeRelativePath(relativePath);
        if (relativePath.Equals(MetadataFileName, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        var path = ResolveFilePath(id, relativePath);
        if (File.Exists(path))
        {
            return relativePath;
        }
        if (!Directory.Exists(path))
        {
            return null;
        }
        var indexPath = relativePath.TrimEnd('/') + "/" + DefaultEntryPath;
        return File.Exists(ResolveFilePath(id, indexPath)) ? indexPath : null;
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

    internal IReadOnlyList<string> ListDirectories(Guid id)
    {
        var root = PageDirectory(id);
        if (!Directory.Exists(root))
        {
            return [];
        }
        var directories = new List<string>();
        CollectDirectories(new DirectoryInfo(root), root, directories);
        return directories.OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    internal string CreateDirectory(Guid id, string relativePath)
    {
        relativePath = NormalizeManagedPath(relativePath);
        var path = ResolveDirectoryPath(id, relativePath);
        if (Directory.Exists(path) || File.Exists(path))
        {
            throw new IOException("A file or folder with that name already exists.");
        }
        Directory.CreateDirectory(path);
        return relativePath;
    }

    internal string RenameDirectory(Guid id, string relativePath, string newRelativePath)
    {
        relativePath = NormalizeManagedPath(relativePath);
        newRelativePath = NormalizeManagedPath(newRelativePath);
        var source = ResolveDirectoryPath(id, relativePath);
        var destination = ResolveDirectoryPath(id, newRelativePath);
        var sourceBoundary = source.EndsWith(Path.DirectorySeparatorChar)
            ? source
            : source + Path.DirectorySeparatorChar;
        if (destination.StartsWith(sourceBoundary, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("A folder cannot be moved inside itself.");
        }
        if (!Directory.Exists(source))
        {
            throw new DirectoryNotFoundException("The selected sandbox folder no longer exists.");
        }
        if ((File.GetAttributes(source) & FileAttributes.ReparsePoint) != 0)
        {
            throw new IOException("Linked folders cannot be renamed.");
        }
        if (Directory.Exists(destination) || File.Exists(destination))
        {
            throw new IOException("A file or folder with that name already exists.");
        }
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        Directory.Move(source, destination);
        RemoveEmptyParentDirectories(Path.GetDirectoryName(source)!, PageDirectory(id));
        var previous = ReadMetadata(PageDirectory(id));
        if (previous != null)
        {
            var prefix = relativePath + "/";
            var entryPath = previous.EntryPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
                ? newRelativePath + "/" + previous.EntryPath[prefix.Length..]
                : previous.EntryPath;
            WriteMetadata(PageDirectory(id), previous with { EntryPath = entryPath, UpdatedUtc = DateTime.UtcNow });
        }
        return newRelativePath;
    }

    internal void DeleteDirectory(Guid id, string relativePath)
    {
        relativePath = NormalizeManagedPath(relativePath);
        var path = ResolveDirectoryPath(id, relativePath);
        if (!Directory.Exists(path))
        {
            throw new DirectoryNotFoundException("The selected sandbox folder no longer exists.");
        }
        var prefix = relativePath + "/";
        var remainingFiles = ListFiles(id).Count(file =>
            !file.Path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
        if (remainingFiles == 0)
        {
            throw new InvalidOperationException("A sandbox project must contain at least one file.");
        }
        var directory = new DirectoryInfo(path);
        DeleteDirectoryContentsSafely(directory);
        directory.Delete();
        RemoveEmptyParentDirectories(Path.GetDirectoryName(path)!, PageDirectory(id));
        TouchMetadata(id);
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

    private static void CollectDirectories(DirectoryInfo directory, string projectRoot, List<string> paths)
    {
        if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
        {
            return;
        }
        foreach (var child in directory.EnumerateDirectories())
        {
            if ((child.Attributes & FileAttributes.ReparsePoint) != 0)
            {
                continue;
            }
            paths.Add(Path.GetRelativePath(projectRoot, child.FullName).Replace('\\', '/'));
            CollectDirectories(child, projectRoot, paths);
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

    private string ResolveDirectoryPath(Guid id, string relativePath) => ResolveFilePath(id, relativePath);

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

    private static string NormalizeManagedPath(string path)
    {
        var relativePath = NormalizeRelativePath(path);
        if (relativePath.Equals(MetadataFileName, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("That file name is reserved by ThreeBrowser.");
        }
        return relativePath;
    }

    private static string NormalizeProjectTitle(string title)
    {
        title = WhitespaceRegex().Replace(title?.Trim() ?? "", " ");
        if (title.Length is < 1 or > 120)
        {
            throw new InvalidDataException("The project name must be between 1 and 120 characters.");
        }
        return title;
    }

    private void TouchMetadata(Guid id)
    {
        var directory = PageDirectory(id);
        var files = ListFiles(id);
        var previous = ReadMetadata(directory);
        var entryPath = FindEntryPath(files, previous?.EntryPath);
        WriteMetadata(directory, new Metadata(
            previous?.Title ?? "Untitled project",
            DateTime.UtcNow,
            entryPath,
            previous?.LastModel));
    }

    private static void RemoveEmptyParentDirectories(string directory, string projectRoot)
    {
        var root = Path.GetFullPath(projectRoot);
        var current = new DirectoryInfo(directory);
        while (!current.FullName.Equals(root, StringComparison.OrdinalIgnoreCase) &&
               current.Exists &&
               !current.EnumerateFileSystemInfos().Any())
        {
            var parent = current.Parent;
            current.Delete();
            if (parent == null)
            {
                break;
            }
            current = parent;
        }
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

    internal static string ContentTypeForPath(string path) => ContentType(path);

    private sealed record Metadata(
        string Title,
        DateTime UpdatedUtc,
        string EntryPath,
        string? LastModel = null);

    [GeneratedRegex(@"<title\b[^>]*>(.*?)</title\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex TitleRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
