using System.Text.Json;
using System.Text.RegularExpressions;

namespace ThreeBrowser;

internal sealed class AgentWorkspace
{
    private const int MaxReadBytes = 2 * 1024 * 1024;
    private const int MaxSearchResults = 200;
    private const string StateDirectoryName = ".threebrowser";
    private readonly string _rootWithSeparator;
    private readonly object _goalLock = new();

    internal event Action<string>? FileChanged;

    internal AgentWorkspace(string root)
    {
        Root = Path.GetFullPath(root);
        if (!Directory.Exists(Root))
        {
            throw new DirectoryNotFoundException("The exposed workspace directory does not exist.");
        }
        if ((File.GetAttributes(Root) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException("A linked directory cannot be exposed as an agent workspace.");
        }
        _rootWithSeparator = Root.EndsWith(Path.DirectorySeparatorChar)
            ? Root
            : Root + Path.DirectorySeparatorChar;
    }

    internal string Root { get; }

    internal object ListFiles(string relativePath, bool recursive)
    {
        var directory = ResolveDirectory(relativePath, mustExist: true);
        var items = new List<object>();
        Enumerate(directory, recursive, items, 0);
        return new { path = DisplayPath(directory), items };
    }

    internal object ReadFile(string relativePath)
    {
        var path = ResolveFile(relativePath, mustExist: true);
        var info = new FileInfo(path);
        if (info.Length > MaxReadBytes)
        {
            throw new InvalidDataException("The file is larger than the 2 MB read limit.");
        }
        if (LooksBinary(path))
        {
            throw new InvalidDataException("Binary files cannot be read as agent text.");
        }
        return new { path = DisplayPath(path), content = File.ReadAllText(path) };
    }

    internal object WriteFile(string relativePath, string content)
    {
        if (content.Length > MaxReadBytes)
        {
            throw new InvalidDataException("The file content is larger than the 2 MB write limit.");
        }
        var path = ResolveFile(relativePath, mustExist: false);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        ValidateExistingPath(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
        FileChanged?.Invoke(DisplayPath(path));
        return new { path = DisplayPath(path), bytes = new FileInfo(path).Length };
    }

    internal object ReplaceInFile(string relativePath, string oldText, string newText, bool replaceAll)
    {
        if (oldText.Length == 0)
        {
            throw new InvalidDataException("old_text cannot be empty.");
        }
        var path = ResolveFile(relativePath, mustExist: true);
        var content = File.ReadAllText(path);
        var count = CountOccurrences(content, oldText);
        if (count == 0)
        {
            throw new InvalidDataException("old_text was not found in the file.");
        }
        if (!replaceAll && count != 1)
        {
            throw new InvalidDataException($"old_text occurs {count} times; provide more context or use replace_all.");
        }
        var updated = replaceAll
            ? content.Replace(oldText, newText, StringComparison.Ordinal)
            : ReplaceFirst(content, oldText, newText);
        if (updated.Length > MaxReadBytes)
        {
            throw new InvalidDataException("The updated file exceeds the 2 MB write limit.");
        }
        File.WriteAllText(path, updated);
        FileChanged?.Invoke(DisplayPath(path));
        return new { path = DisplayPath(path), replacements = replaceAll ? count : 1 };
    }

    internal object CreateDirectory(string relativePath)
    {
        var path = ResolveDirectory(relativePath, mustExist: false);
        Directory.CreateDirectory(path);
        ValidateExistingPath(path);
        FileChanged?.Invoke(DisplayPath(path));
        return new { path = DisplayPath(path) };
    }

    internal object Grep(string pattern, string relativePath, string? filePattern, bool caseSensitive)
    {
        var directory = ResolveDirectory(relativePath, mustExist: true);
        var options = caseSensitive ? RegexOptions.None : RegexOptions.IgnoreCase;
        var regex = new Regex(pattern, options, TimeSpan.FromSeconds(1));
        var wildcard = string.IsNullOrWhiteSpace(filePattern) ? "*" : filePattern;
        var results = new List<object>();
        foreach (var file in SafeFiles(directory, wildcard))
        {
            if (new FileInfo(file).Length > MaxReadBytes || LooksBinary(file))
            {
                continue;
            }
            var lineNumber = 0;
            foreach (var line in File.ReadLines(file))
            {
                lineNumber++;
                if (!regex.IsMatch(line))
                {
                    continue;
                }
                results.Add(new { path = DisplayPath(file), line = lineNumber, text = line.Trim() });
                if (results.Count >= MaxSearchResults)
                {
                    return new { matches = results, truncated = true };
                }
            }
        }
        return new { matches = results, truncated = false };
    }

    internal object ListGoals()
    {
        lock (_goalLock)
        {
            return new { goals = ReadGoals() };
        }
    }

    internal object CreateGoal(string title)
    {
        title = title.Trim();
        if (title.Length == 0)
        {
            throw new InvalidDataException("The goal title cannot be empty.");
        }
        lock (_goalLock)
        {
            var goals = ReadGoals();
            var goal = new AgentGoal(Guid.NewGuid().ToString("N"), title, "active", DateTime.UtcNow);
            goals.Add(goal);
            WriteGoals(goals);
            return goal;
        }
    }

    internal object UpdateGoal(string id, string status)
    {
        status = status.ToLowerInvariant();
        if (status is not ("active" or "complete" or "blocked"))
        {
            throw new InvalidDataException("Goal status must be active, complete, or blocked.");
        }
        lock (_goalLock)
        {
            var goals = ReadGoals();
            var index = goals.FindIndex(goal => goal.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
            if (index < 0)
            {
                throw new InvalidDataException("The goal was not found.");
            }
            goals[index] = goals[index] with { Status = status };
            WriteGoals(goals);
            return goals[index];
        }
    }

    private void Enumerate(string directory, bool recursive, List<object> items, int depth)
    {
        if (items.Count >= 500 || depth > 20)
        {
            return;
        }
        ValidateExistingPath(directory);
        foreach (var child in new DirectoryInfo(directory).EnumerateFileSystemInfos()
                     .OrderBy(info => info is FileInfo)
                     .ThenBy(info => info.Name, StringComparer.OrdinalIgnoreCase))
        {
            if ((child.Attributes & FileAttributes.ReparsePoint) != 0)
            {
                continue;
            }
            items.Add(new
            {
                path = DisplayPath(child.FullName),
                type = child is DirectoryInfo ? "directory" : "file",
                size = child is FileInfo file ? file.Length : 0,
            });
            if (recursive && child is DirectoryInfo childDirectory)
            {
                Enumerate(childDirectory.FullName, true, items, depth + 1);
            }
            if (items.Count >= 500)
            {
                return;
            }
        }
    }

    private IEnumerable<string> SafeFiles(string directory, string pattern)
    {
        var pending = new Stack<DirectoryInfo>();
        var scanned = 0;
        pending.Push(new DirectoryInfo(directory));
        while (pending.Count > 0)
        {
            var current = pending.Pop();
            ValidateExistingPath(current.FullName);
            foreach (var file in current.EnumerateFiles(pattern))
            {
                if ((file.Attributes & FileAttributes.ReparsePoint) == 0)
                {
                    yield return file.FullName;
                    scanned++;
                    if (scanned >= 10_000)
                    {
                        yield break;
                    }
                }
            }
            foreach (var child in current.EnumerateDirectories())
            {
                if ((child.Attributes & FileAttributes.ReparsePoint) == 0 &&
                    !child.Name.Equals(StateDirectoryName, StringComparison.OrdinalIgnoreCase))
                {
                    pending.Push(child);
                }
            }
        }
    }

    private string ResolveFile(string relativePath, bool mustExist)
    {
        var path = Resolve(relativePath);
        if (mustExist && !File.Exists(path))
        {
            throw new FileNotFoundException("The requested workspace file does not exist.", relativePath);
        }
        ValidateExistingPath(Path.GetDirectoryName(path)!);
        if (File.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException("Linked files are outside the agent workspace boundary.");
        }
        return path;
    }

    private string ResolveDirectory(string relativePath, bool mustExist)
    {
        var path = Resolve(relativePath);
        if (mustExist && !Directory.Exists(path))
        {
            throw new DirectoryNotFoundException("The requested workspace directory does not exist.");
        }
        if (Directory.Exists(path))
        {
            ValidateExistingPath(path);
        }
        else
        {
            ValidateExistingPath(Path.GetDirectoryName(path) ?? Root);
        }
        return path;
    }

    private string Resolve(string relativePath)
    {
        relativePath = (relativePath ?? "").Trim();
        var path = relativePath.Length == 0 || relativePath == "."
            ? Root
            : Path.GetFullPath(Path.Combine(Root, relativePath));
        if (!path.Equals(Root, StringComparison.OrdinalIgnoreCase) &&
            !path.StartsWith(_rootWithSeparator, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("The requested path is outside the exposed workspace.");
        }
        return path;
    }

    private void ValidateExistingPath(string path)
    {
        var current = new DirectoryInfo(path);
        while (current != null &&
               (current.FullName.Equals(Root, StringComparison.OrdinalIgnoreCase) ||
                current.FullName.StartsWith(_rootWithSeparator, StringComparison.OrdinalIgnoreCase)))
        {
            if (current.Exists && (current.Attributes & FileAttributes.ReparsePoint) != 0)
            {
                throw new InvalidDataException("Linked directories are outside the agent workspace boundary.");
            }
            if (current.FullName.Equals(Root, StringComparison.OrdinalIgnoreCase))
            {
                break;
            }
            current = current.Parent;
        }
    }

    private string DisplayPath(string path)
    {
        var relative = Path.GetRelativePath(Root, path).Replace('\\', '/');
        return relative == "." ? "." : relative;
    }

    private List<AgentGoal> ReadGoals()
    {
        var path = GoalPath();
        if (!File.Exists(path))
        {
            return [];
        }
        try
        {
            return JsonSerializer.Deserialize<List<AgentGoal>>(File.ReadAllText(path)) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private void WriteGoals(List<AgentGoal> goals)
    {
        var path = GoalPath();
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(goals, new JsonSerializerOptions { WriteIndented = true }));
        FileChanged?.Invoke(DisplayPath(path));
    }

    private string GoalPath() => Path.Combine(Root, StateDirectoryName, "goals.json");

    private static bool LooksBinary(string path)
    {
        using var stream = File.OpenRead(path);
        var buffer = new byte[Math.Min(4096, (int)stream.Length)];
        var read = stream.Read(buffer);
        return buffer.AsSpan(0, read).Contains((byte)0);
    }

    private static int CountOccurrences(string content, string value)
    {
        var count = 0;
        var index = 0;
        while ((index = content.IndexOf(value, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += value.Length;
        }
        return count;
    }

    private static string ReplaceFirst(string content, string oldText, string newText)
    {
        var index = content.IndexOf(oldText, StringComparison.Ordinal);
        return content[..index] + newText + content[(index + oldText.Length)..];
    }

    private sealed record AgentGoal(string Id, string Title, string Status, DateTime CreatedUtc);
}
