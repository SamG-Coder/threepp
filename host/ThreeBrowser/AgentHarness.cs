using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ThreeBrowser;

internal sealed class AgentHarness : IDisposable
{
    private const int MaxTurns = 40;
    private const int MaxTasks = 8;
    private readonly AgentWorkspace _workspace;
    private readonly string _model;
    private readonly Action _runProject;
    private readonly HttpClient _ollama = new()
    {
        BaseAddress = new Uri("http://127.0.0.1:11434/"),
        Timeout = Timeout.InfiniteTimeSpan,
    };
    private readonly ConcurrentDictionary<string, Task<string>> _tasks = new();
    private readonly SemaphoreSlim _taskSlots = new(3);
    private int _nextTaskId;

    internal AgentHarness(AgentWorkspace workspace, string model, Action runProject)
    {
        _workspace = workspace;
        _model = model;
        _runProject = runProject;
    }

    internal Task<string> RunAsync(
        string prompt,
        Action<string, string> emit,
        CancellationToken cancellationToken) =>
        RunLoopAsync(prompt, allowTasks: true, emit, cancellationToken);

    public void Dispose()
    {
        _ollama.Dispose();
        _taskSlots.Dispose();
    }

    private async Task<string> RunLoopAsync(
        string prompt,
        bool allowTasks,
        Action<string, string> emit,
        CancellationToken cancellationToken)
    {
        var messages = new List<Dictionary<string, object?>>
        {
            new() { ["role"] = "system", ["content"] = SystemPrompt(allowTasks) },
            new() { ["role"] = "user", ["content"] = prompt },
        };
        for (var turn = 0; turn < MaxTurns; turn++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var request = new HttpRequestMessage(HttpMethod.Post, "api/chat")
            {
                Content = JsonContent.Create(new
                {
                    model = _model,
                    stream = false,
                    think = false,
                    messages,
                    tools = ToolDefinitions(allowTasks),
                    options = new { temperature = 0.2 },
                }),
            };
            using var response = await _ollama.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();
            await using var responseStream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(responseStream, cancellationToken: cancellationToken);
            if (!document.RootElement.TryGetProperty("message", out var message))
            {
                throw new InvalidDataException("Ollama returned no assistant message.");
            }

            var content = message.TryGetProperty("content", out var contentValue)
                ? contentValue.GetString() ?? ""
                : "";
            var assistant = new Dictionary<string, object?>
            {
                ["role"] = "assistant",
                ["content"] = content,
            };
            var calls = message.TryGetProperty("tool_calls", out var toolCalls) &&
                        toolCalls.ValueKind == JsonValueKind.Array
                ? toolCalls.EnumerateArray().Select(call => call.Clone()).ToArray()
                : [];
            if (calls.Length == 0)
            {
                var outstanding = allowTasks
                    ? _tasks.Values.Where(task => !task.IsCompleted).ToArray()
                    : [];
                var waitedForOutstandingTasks = outstanding.Length > 0;
                if (outstanding.Length > 0)
                {
                    emit("system", $"Waiting for {outstanding.Length} outstanding task{(outstanding.Length == 1 ? "" : "s")}…");
                    await Task.WhenAll(outstanding).WaitAsync(cancellationToken);
                }
                var result = string.IsNullOrWhiteSpace(content) ? "Task completed." : content.Trim();
                if (waitedForOutstandingTasks)
                {
                    result += "\n\nAll outstanding tasks completed before this run returned.";
                }
                emit("answer", result);
                return result;
            }

            assistant["tool_calls"] = calls;
            messages.Add(assistant);
            foreach (var call in calls)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var function = call.GetProperty("function");
                var callId = call.TryGetProperty("id", out var idValue) ? idValue.GetString() : null;
                var name = function.GetProperty("name").GetString() ?? "";
                var arguments = function.TryGetProperty("arguments", out var args)
                    ? args
                    : EmptyArguments;
                emit("tool", DescribeTool(name, arguments));
                string result;
                try
                {
                    var value = await ExecuteToolAsync(name, arguments, emit, cancellationToken);
                    result = JsonSerializer.Serialize(new { ok = true, result = value });
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    result = JsonSerializer.Serialize(new { ok = false, error = ex.Message });
                }
                messages.Add(new Dictionary<string, object?>
                {
                    ["role"] = "tool",
                    ["tool_name"] = name,
                    ["tool_call_id"] = callId,
                    ["content"] = result,
                });
            }
        }
        throw new InvalidOperationException("The agent reached its 40-turn safety limit.");
    }

    private async Task<object> ExecuteToolAsync(
        string name,
        JsonElement arguments,
        Action<string, string> emit,
        CancellationToken cancellationToken)
    {
        return name switch
        {
            "list_files" => _workspace.ListFiles(String(arguments, "path", "."), Bool(arguments, "recursive")),
            "read_file" => _workspace.ReadFile(RequiredString(arguments, "path")),
            "write_file" => _workspace.WriteFile(
                RequiredString(arguments, "path"),
                RequiredString(arguments, "content")),
            "replace_in_file" => _workspace.ReplaceInFile(
                RequiredString(arguments, "path"),
                RequiredString(arguments, "old_text"),
                RequiredString(arguments, "new_text"),
                Bool(arguments, "replace_all")),
            "create_directory" => _workspace.CreateDirectory(RequiredString(arguments, "path")),
            "grep" => _workspace.Grep(
                RequiredString(arguments, "pattern"),
                String(arguments, "path", "."),
                String(arguments, "file_pattern", "*"),
                Bool(arguments, "case_sensitive")),
            "list_goals" => _workspace.ListGoals(),
            "create_goal" => _workspace.CreateGoal(RequiredString(arguments, "title")),
            "update_goal" => _workspace.UpdateGoal(
                RequiredString(arguments, "id"),
                RequiredString(arguments, "status")),
            "create_task" => CreateTask(RequiredString(arguments, "prompt"), emit, cancellationToken),
            "wait_task" => await WaitTaskAsync(RequiredString(arguments, "task_id"), cancellationToken),
            "run_project" => RunProject(),
            _ => throw new InvalidDataException($"Unknown tool: {name}"),
        };
    }

    private object RunProject()
    {
        _runProject();
        return new { navigation_requested = true };
    }

    private object CreateTask(string prompt, Action<string, string> emit, CancellationToken cancellationToken)
    {
        if (_tasks.Count >= MaxTasks)
        {
            throw new InvalidDataException($"No more than {MaxTasks} tasks may be created in one run.");
        }
        var id = "task-" + Interlocked.Increment(ref _nextTaskId);
        var task = Task.Run(async () =>
        {
            await _taskSlots.WaitAsync(cancellationToken);
            try
            {
                emit("task", $"{id} started: {prompt}");
                var result = await RunLoopAsync(prompt, allowTasks: false, emit, cancellationToken);
                emit("task", $"{id} completed");
                return result;
            }
            finally
            {
                _taskSlots.Release();
            }
        }, cancellationToken);
        if (!_tasks.TryAdd(id, task))
        {
            throw new InvalidOperationException("Could not register the task.");
        }
        return new { task_id = id, status = "running" };
    }

    private async Task<object> WaitTaskAsync(string id, CancellationToken cancellationToken)
    {
        if (!_tasks.TryGetValue(id, out var task))
        {
            if (_tasks.Count != 1)
            {
                throw new InvalidDataException("The task ID was not found.");
            }
            var onlyTask = _tasks.Single();
            id = onlyTask.Key;
            task = onlyTask.Value;
        }
        var result = await task.WaitAsync(cancellationToken);
        return new { task_id = id, status = "complete", result };
    }

    private string SystemPrompt(bool allowTasks) => $$"""
        You are a local coding agent inside ThreeBrowser's offline Agent Harness.
        The only directory you can access is the exposed workspace: {{_workspace.Root}}
        Use only the provided tools. You have no shell, browser, network, package manager, or internet access.
        Never claim to have accessed anything outside the workspace. Never invent tool results.
        Inspect relevant files before editing. Keep changes focused and preserve existing conventions.
        Use grep for code search. Use goals to track multi-step work. Verify your work by reading changed files.
        When the user asks to run, launch, preview, or open the finished project, call run_project after completing file writes.
        {{(allowTasks
            ? "You may create multiple independent tasks, continue useful work, then wait for their task IDs before finishing."
            : "This is a bounded subtask. Do not attempt to create other tasks.")}}
        In the final response, briefly state the outcome, changed paths, and anything that could not be verified.
        """;

    private static object ToolDefinitions(bool allowTasks)
    {
        using var document = JsonDocument.Parse(ToolDefinitionsJson);
        return document.RootElement.EnumerateArray()
            .Where(tool => allowTasks ||
                tool.GetProperty("function").GetProperty("name").GetString() is not ("create_task" or "wait_task" or "run_project"))
            .Select(tool => tool.Clone())
            .ToArray();
    }

    private static string DescribeTool(string name, JsonElement arguments)
    {
        var detail = name switch
        {
            "read_file" or "write_file" or "create_directory" => String(arguments, "path", ""),
            "grep" => String(arguments, "pattern", ""),
            "create_goal" => String(arguments, "title", ""),
            "create_task" => String(arguments, "prompt", ""),
            "wait_task" => String(arguments, "task_id", ""),
            "run_project" => "open the solution entry page in ThreeBrowser",
            _ => "",
        };
        return detail.Length == 0 ? name : $"{name}: {detail}";
    }

    private static string RequiredString(JsonElement arguments, string name)
    {
        var value = String(arguments, name, "");
        return value.Length == 0 ? throw new InvalidDataException($"{name} is required.") : value;
    }

    private static string String(JsonElement arguments, string name, string fallback) =>
        arguments.ValueKind == JsonValueKind.Object &&
        arguments.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? fallback
            : fallback;

    private static bool Bool(JsonElement arguments, string name) =>
        arguments.ValueKind == JsonValueKind.Object &&
        arguments.TryGetProperty(name, out var value) &&
        value.ValueKind is JsonValueKind.True or JsonValueKind.False &&
        value.GetBoolean();

    private static readonly JsonElement EmptyArguments = JsonDocument.Parse("{}").RootElement.Clone();

    private const string ToolDefinitionsJson = """
        [
          {"type":"function","function":{"name":"list_files","description":"List workspace files and directories.","parameters":{"type":"object","properties":{"path":{"type":"string"},"recursive":{"type":"boolean"}}}}},
          {"type":"function","function":{"name":"read_file","description":"Read a UTF-8 text file inside the workspace.","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}},
          {"type":"function","function":{"name":"write_file","description":"Create or replace a UTF-8 text file inside the workspace.","parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}}},
          {"type":"function","function":{"name":"replace_in_file","description":"Replace exact text in a workspace file.","parameters":{"type":"object","properties":{"path":{"type":"string"},"old_text":{"type":"string"},"new_text":{"type":"string"},"replace_all":{"type":"boolean"}},"required":["path","old_text","new_text"]}}},
          {"type":"function","function":{"name":"create_directory","description":"Create a directory inside the workspace.","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}},
          {"type":"function","function":{"name":"grep","description":"Regex-search text files recursively inside the workspace.","parameters":{"type":"object","properties":{"pattern":{"type":"string"},"path":{"type":"string"},"file_pattern":{"type":"string"},"case_sensitive":{"type":"boolean"}},"required":["pattern"]}}},
          {"type":"function","function":{"name":"list_goals","description":"List persistent workspace goals.","parameters":{"type":"object","properties":{}}}},
          {"type":"function","function":{"name":"create_goal","description":"Create a persistent workspace goal.","parameters":{"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}}},
          {"type":"function","function":{"name":"update_goal","description":"Update a goal to active, complete, or blocked.","parameters":{"type":"object","properties":{"id":{"type":"string"},"status":{"type":"string","enum":["active","complete","blocked"]}},"required":["id","status"]}}},
          {"type":"function","function":{"name":"create_task","description":"Start an independent local AI task and return its task ID immediately.","parameters":{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"]}}},
          {"type":"function","function":{"name":"wait_task","description":"Wait for a previously created task and return its result.","parameters":{"type":"object","properties":{"task_id":{"type":"string"}},"required":["task_id"]}}}
          ,{"type":"function","function":{"name":"run_project","description":"Open the current solution's index or entry page in the main ThreeBrowser window after the files are ready.","parameters":{"type":"object","properties":{}}}}
        ]
        """;
}
