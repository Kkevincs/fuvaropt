using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using FuvarOpt.Models;
using FuvarOpt.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace FuvarOpt.Services;

/// <summary>
/// Calls Google Gemini with JSON schema to extract route counts from free text.
/// </summary>
public sealed class GeminiRouteExtractionService
{
    private const int DemoScheduleMaxEmployees = 4;
    private const int DemoScheduleMaxSkillsPerEmployee = 3;

    /// <summary>Earliest shift start to latest shift end must not exceed this span (demo).</summary>
    private static readonly TimeSpan DemoScheduleMaxShiftWindow = TimeSpan.FromDays(7);

    private readonly HttpClient _http;
    private readonly IConfiguration _configuration;
    private readonly IOptions<GeminiOptions> _options;

    public GeminiRouteExtractionService(
        HttpClient http,
        IConfiguration configuration,
        IOptions<GeminiOptions> options)
    {
        _http = http;
        _configuration = configuration;
        _options = options;
    }

    public async Task<RouteProblemResponse> ExtractFromMessageAsync(
        string userMessage,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(userMessage))
        {
            throw new ArgumentException("Message is required.", nameof(userMessage));
        }

        var apiKey = ResolveGeminiApiKey();

        var model =
            _configuration["Gemini:Model"]
            ?? Environment.GetEnvironmentVariable("GEMINI_MODEL")
            ?? _options.Value.Model;

        var prompt =
            "Extract these counts from the user's message about delivery / vehicle routing. "
            + "Use non-negative integers only. If a count is not mentioned, use 0.\n"
            + "Do not infer or count packages or parcel totals—only the three fields below.\n"
            + "Field mapping (synonyms count as the same concept):\n"
            + "- VehicleCount: vehicles, cars, trucks, vans, fleet size, drivers, or how many vehicles are available.\n"
            + "- WarehouseCount: warehouses, depots, hubs, bases, distribution centers.\n"
            + "- AddressCount: delivery addresses, stops, customers, delivery points (not warehouses).\n\n"
            + "User message:\n"
            + userMessage;

        var schema = new JsonObject
        {
            ["type"] = "OBJECT",
            ["properties"] = new JsonObject
            {
                ["VehicleCount"] = new JsonObject { ["type"] = "INTEGER" },
                ["AddressCount"] = new JsonObject { ["type"] = "INTEGER" },
                ["WarehouseCount"] = new JsonObject { ["type"] = "INTEGER" },
            },
            ["required"] = new JsonArray(
                "VehicleCount",
                "AddressCount",
                "WarehouseCount"),
        };

        var body = new JsonObject
        {
            ["contents"] = new JsonArray
            {
                new JsonObject
                {
                    ["role"] = "user",
                    ["parts"] = new JsonArray
                    {
                        new JsonObject { ["text"] = prompt },
                    },
                },
            },
            ["generationConfig"] = new JsonObject
            {
                ["responseMimeType"] = "application/json",
                ["responseSchema"] = schema,
            },
        };

        var url =
            $"v1beta/models/{Uri.EscapeDataString(model)}:generateContent?key={Uri.EscapeDataString(apiKey)}";
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(
                body.ToJsonString(),
                Encoding.UTF8,
                "application/json"),
        };

        using var response = await _http
            .SendAsync(request, cancellationToken)
            .ConfigureAwait(false);
        var responseText = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Gemini API error {(int)response.StatusCode}: {responseText}");
        }

        using var doc = JsonDocument.Parse(responseText);
        var root = doc.RootElement;
        var text = root
            .GetProperty("candidates")[0]
            .GetProperty("content")
            .GetProperty("parts")[0]
            .GetProperty("text")
            .GetString();

        if (string.IsNullOrWhiteSpace(text))
        {
            throw new InvalidOperationException("Empty Gemini response.");
        }

        var parsed = JsonSerializer.Deserialize<GeminiRouteCounts>(
            text,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        if (parsed is null)
        {
            throw new InvalidOperationException("Could not parse Gemini JSON: " + text);
        }

        return RouteProblemBuilder.FromCounts(
            parsed.VehicleCount,
            parsed.AddressCount,
            parsed.WarehouseCount,
            packageCount: 0);
    }

    /// <summary>
    /// Analyzes solved route JSON and returns short English suggestions (idle vehicles, unused depots, etc.).
    /// </summary>
    public async Task<PostOptimizationSuggestionsResponse> GetPostOptimizationSuggestionsAsync(
        string optimizedRouteJson,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(optimizedRouteJson))
        {
            throw new ArgumentException("Optimized route JSON is required.", nameof(optimizedRouteJson));
        }

        var prompt =
            "You are given JSON from a vehicle routing optimizer (vehicles with homeLocation and visit id lists, "
            + "visits with locations, totalDrivingTimeSeconds, score). "
            + "Respond with JSON only. Write in clear English.\n\n"
            + "Tasks:\n"
            + "1. Identify vehicles with no assigned visits or zero driving time (idle / unused capacity).\n"
            + "2. Identify depot homes (warehouses) that have no vehicle serving any stop from that home.\n"
            + "3. Comment whether fewer active vehicles might have sufficed (heuristic, non-binding).\n"
            + "4. Add one or two practical observations (e.g. imbalance, long legs).\n\n"
            + "suggestions: 2 to 6 short bullet strings (each one line, no markdown bullets in the string).\n\n"
            + "Optimized route JSON:\n"
            + optimizedRouteJson;

        return await GenerateJsonSuggestionsAsync(prompt, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Analyzes solved employee schedule JSON (employees, shifts with assignments, preferences) and returns short English insights.
    /// </summary>
    public async Task<PostOptimizationSuggestionsResponse> GetPostScheduleOptimizationSuggestionsAsync(
        string solvedScheduleJson,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(solvedScheduleJson))
        {
            throw new ArgumentException("Solved schedule JSON is required.", nameof(solvedScheduleJson));
        }

        var prompt =
            "You are given JSON from an employee scheduling optimizer: employees (name, skills, unavailableDates, "
            + "undesiredDates, desiredDates) and shifts (id, start, end, location, requiredSkill, employee assignment). "
            + "Respond with JSON only. Write in clear English.\n\n"
            + "Produce 2 to 6 short suggestion strings. Each string is one line (no markdown bullets inside the string). "
            + "Cover topics such as:\n"
            + "- Workload imbalance: who has more shifts or longer hours than others.\n"
            + "- Preferences: assignments on undesired days, or missing desired days; note if someone could swap to gain a rest day.\n"
            + "- Hypotheticals: e.g. if person A swapped shift X from day Y to Z (or with person B), would they gain an extra rest day or better match preferences.\n"
            + "- Skills vs locations: coverage gaps or overload at a single site.\n"
            + "If the JSON is sparse, still give the best heuristic insights you can.\n\n"
            + "suggestions: 2 to 6 short bullet strings.\n\n"
            + "Solved schedule JSON:\n"
            + solvedScheduleJson;

        return await GenerateJsonSuggestionsAsync(prompt, cancellationToken).ConfigureAwait(false);
    }

    private async Task<PostOptimizationSuggestionsResponse> GenerateJsonSuggestionsAsync(
        string prompt,
        CancellationToken cancellationToken)
    {
        var apiKey = ResolveGeminiApiKey();

        var model =
            _configuration["Gemini:Model"]
            ?? Environment.GetEnvironmentVariable("GEMINI_MODEL")
            ?? _options.Value.Model;

        var schema = new JsonObject
        {
            ["type"] = "OBJECT",
            ["properties"] = new JsonObject
            {
                ["suggestions"] = new JsonObject
                {
                    ["type"] = "ARRAY",
                    ["items"] = new JsonObject { ["type"] = "STRING" },
                },
            },
            ["required"] = new JsonArray("suggestions"),
        };

        var body = new JsonObject
        {
            ["contents"] = new JsonArray
            {
                new JsonObject
                {
                    ["role"] = "user",
                    ["parts"] = new JsonArray
                    {
                        new JsonObject { ["text"] = prompt },
                    },
                },
            },
            ["generationConfig"] = new JsonObject
            {
                ["responseMimeType"] = "application/json",
                ["responseSchema"] = schema,
            },
        };

        var url =
            $"v1beta/models/{Uri.EscapeDataString(model)}:generateContent?key={Uri.EscapeDataString(apiKey)}";
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(
                body.ToJsonString(),
                Encoding.UTF8,
                "application/json"),
        };

        using var response = await _http
            .SendAsync(request, cancellationToken)
            .ConfigureAwait(false);
        var responseText = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Gemini API error {(int)response.StatusCode}: {responseText}");
        }

        using var doc = JsonDocument.Parse(responseText);
        var root = doc.RootElement;
        var text = root
            .GetProperty("candidates")[0]
            .GetProperty("content")
            .GetProperty("parts")[0]
            .GetProperty("text")
            .GetString();

        if (string.IsNullOrWhiteSpace(text))
        {
            throw new InvalidOperationException("Empty Gemini response.");
        }

        var parsed = JsonSerializer.Deserialize<GeminiPostOptimizationResult>(
            text,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        if (parsed?.Suggestions is null || parsed.Suggestions.Count == 0)
        {
            throw new InvalidOperationException("Could not parse Gemini suggestions: " + text);
        }

        return new PostOptimizationSuggestionsResponse
        {
            Suggestions = parsed.Suggestions.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).ToList(),
        };
    }

    private sealed class GeminiPostOptimizationResult
    {
        public List<string>? Suggestions { get; set; }
    }

    private string ResolveGeminiApiKey()
    {
        foreach (var v in new[]
        {
            _configuration["Gemini:ApiKey"],
            Environment.GetEnvironmentVariable("GEMINI_API_KEY"),
            _options.Value.ApiKey,
        })
        {
            if (!string.IsNullOrWhiteSpace(v))
            {
                return v.Trim();
            }
        }

        throw new InvalidOperationException(
            "Gemini API key is not configured. Set GEMINI_API_KEY in a .env file at the repository root "
            + "(see .env.example), or set the environment variable GEMINI_API_KEY, or Gemini:ApiKey for local overrides.");
    }

    /// <summary>
    /// Extracts employees and shifts from free text (same logic as MCP tool <c>ExtractScheduleFromMessage</c>).
    /// </summary>
    public async Task<ScheduleExtractResponse> ExtractScheduleFromMessageAsync(
        string userMessage,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(userMessage))
        {
            throw new ArgumentException("Message is required.", nameof(userMessage));
        }

        var apiKey = ResolveGeminiApiKey();

        var model =
            _configuration["Gemini:Model"]
            ?? Environment.GetEnvironmentVariable("GEMINI_MODEL")
            ?? _options.Value.Model;

        var prompt =
            "You extract structured employee scheduling data for an optimizer API. Output must satisfy the JSON schema.\n\n"
            + "MULTIPLE EMPLOYEES: If the user says they have N employees or lists names (e.g. \"Josh and Adam\"), you MUST output exactly N entries in the employees array—never merge into one. "
            + "Each distinct paragraph or sentence block that describes a different person (different skills, days, or preferences) is a separate employee. "
            + "If the user repeats the wrong name in a later sentence (e.g. says \"Adam\" again when describing the second person), treat it as a typo: assign that block to the other named person from the introduction (e.g. the first block is Adam, the second block with Python/C# is Josh). "
            + "Use the names from the opening line when resolving conflicts.\n\n"
            + "EMPLOYEES: For each person: name, skills (string list), unavailableDates, undesiredDates, desiredDates. "
            + "Dates in those arrays must be YYYY-MM-DD only. "
            + "When the user gives a calendar week or date range and says they prefer or cannot work on certain weekdays, "
            + "convert each weekday to the actual calendar date that falls inside that range (e.g. for 2026-04-19 to 2026-04-24, "
            + "Monday is 2026-04-20, Tuesday 2026-04-21, Wednesday 2026-04-22, Thursday 2026-04-23, Friday 2026-04-24, "
            + "unless the user’s locale implies a different mapping—use the dates that match their stated week).\n\n"
            + "SHIFTS: Each shift needs id, start, end (ISO 8601 with full date and time), location, requiredSkill. "
            + "Every shift **location** must be a concrete city, site, or office name (e.g. Budapest, Ambulatory care)—never generic placeholders like \"Unspecified\" or \"TBD\". "
            + "When the user states which skills are needed on which days (e.g. Excel on Mon/Tue/Fri, Python on Wed, Excel+Python on Thu), "
            + "expand that into one shift per distinct (calendar day, required skill): use a working-day window such as 09:00–17:00 local on that date. "
            + "If multiple skills apply the same day, output one shift per skill. "
            + "If the user did not name a location for a shift, infer a reasonable one from context or omit that shift until the user provides it in a follow-up.\n\n"
            + "Each employee must have **at least one non-empty skill** in the skills array.\n\n"
            + "Use stable ids such as \"2026-04-20-excel\", \"2026-04-23-python\".\n\n"
            + "Do not return an empty shifts array when the user has described concrete scheduling needs for days or skills in a week. "
            + "Use empty arrays for employee date lists only when the user did not mention those preferences.\n\n"
            + "PREFERENCE COVERAGE: If the user names several people and states likes, dislikes, cannot work, or preferred days for some of them but not for another named person, "
            + "that person still needs either the same kind of preference detail or an explicit note that they have no preference / are flexible—do not silently leave them with empty date arrays while others are filled. "
            + "Never invent or guess preference dates for someone whose likes/dislikes you were not told; leave arrays empty for them so the app can ask.\n\n"
            + $"DEMO LIMITS (enforced by the server after extraction, not by you truncating): at most {DemoScheduleMaxEmployees} employees; "
            + $"at most {DemoScheduleMaxSkillsPerEmployee} skills per employee; "
            + "all shift start/end times within one calendar window of 7 days (earliest shift start to latest shift end). "
            + "SKILLS ARRAY: Include **every** distinct job title or role the user gives for each person as a separate string in `skills`. "
            + "Do **not** merge or drop roles to stay under a limit—if they list more than three roles for someone, output all of them; the demo will mark the extract incomplete and ask them to use at most three. "
            + "Never silently omit the last roles.\n\n"
            + "User message:\n"
            + userMessage;

        var schema = BuildScheduleExtractionSchema();

        var body = new JsonObject
        {
            ["contents"] = new JsonArray
            {
                new JsonObject
                {
                    ["role"] = "user",
                    ["parts"] = new JsonArray
                    {
                        new JsonObject { ["text"] = prompt },
                    },
                },
            },
            ["generationConfig"] = new JsonObject
            {
                ["responseMimeType"] = "application/json",
                ["responseSchema"] = schema,
            },
        };

        var url =
            $"v1beta/models/{Uri.EscapeDataString(model)}:generateContent?key={Uri.EscapeDataString(apiKey)}";
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(
                body.ToJsonString(),
                Encoding.UTF8,
                "application/json"),
        };

        using var response = await _http
            .SendAsync(request, cancellationToken)
            .ConfigureAwait(false);
        var responseText = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Gemini API error {(int)response.StatusCode}: {responseText}");
        }

        using var doc = JsonDocument.Parse(responseText);
        var root = doc.RootElement;
        var text = root
            .GetProperty("candidates")[0]
            .GetProperty("content")
            .GetProperty("parts")[0]
            .GetProperty("text")
            .GetString();

        if (string.IsNullOrWhiteSpace(text))
        {
            throw new InvalidOperationException("Empty Gemini response.");
        }

        var parsed = JsonSerializer.Deserialize<ScheduleGeminiRoot>(
            text,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        if (parsed is null)
        {
            throw new InvalidOperationException("Could not parse Gemini JSON: " + text);
        }

        var employees = parsed.Employees ?? new List<ScheduleEmployeeDto>();
        var shifts = parsed.Shifts ?? new List<ScheduleShiftInputDto>();

        NormalizeEmployeesAfterExtraction(employees);
        NormalizeShiftsAfterExtraction(shifts);

        var missingHints = CollectScheduleIssues(employees, shifts, userMessage);

        return new ScheduleExtractResponse
        {
            Employees = employees,
            Shifts = shifts,
            Complete = missingHints.Count == 0,
            MissingHints = missingHints,
        };
    }

    private static void NormalizeEmployeesAfterExtraction(IList<ScheduleEmployeeDto> employees)
    {
        foreach (var e in employees)
        {
            e.Skills ??= new List<string>();
            e.UnavailableDates ??= new List<string>();
            e.UndesiredDates ??= new List<string>();
            e.DesiredDates ??= new List<string>();
        }
    }

    private static void NormalizeShiftsAfterExtraction(IList<ScheduleShiftInputDto> shifts)
    {
        for (var i = 0; i < shifts.Count; i++)
        {
            var s = shifts[i];
            if (string.IsNullOrWhiteSpace(s.Id))
            {
                s.Id = $"shift-{i + 1}";
            }
        }
    }

    private static bool HasAtLeastOneNonEmptySkill(IReadOnlyList<string>? skills)
    {
        if (skills is null || skills.Count == 0)
        {
            return false;
        }

        return skills.Any(s => !string.IsNullOrWhiteSpace(s));
    }

    private static bool IsPlaceholderLocation(string? location)
    {
        if (string.IsNullOrWhiteSpace(location))
        {
            return true;
        }

        var t = location.Trim().ToLowerInvariant();
        return t is "unspecified" or "tbd" or "n/a" or "na" or "none" or "-" or "unknown";
    }

    /// <summary>
    /// When the user explicitly names multiple people but Gemini returns fewer employee rows (e.g. duplicate \"Adam\" typo for Josh),
    /// add a targeted hint so the UI can ask only for the missing person.
    /// </summary>
    private static void AppendRosterMismatchHints(
        string userMessage,
        IReadOnlyList<ScheduleEmployeeDto> employees,
        List<string> issues)
    {
        if (string.IsNullOrWhiteSpace(userMessage))
        {
            return;
        }

        var lower = userMessage.ToLowerInvariant();
        var mentionsMultiple =
            lower.Contains("2 employees")
            || lower.Contains("two employees")
            || (lower.Contains("josh") && lower.Contains("adam"));

        if (!mentionsMultiple || employees.Count >= 2)
        {
            return;
        }

        if (employees.Count == 1)
        {
            issues.Add(
                "employees: the message introduces two people (e.g. Josh and Adam) but only one employee was extracted. "
                + "Add a second employee row: if a paragraph repeats the wrong name, assign that paragraph to the other person from the first line.");
        }
    }

    /// <summary>Lists concrete problems with the extracted JSON so the UI only asks for what is still missing.</summary>
    private static List<string> CollectScheduleIssues(
        IReadOnlyList<ScheduleEmployeeDto> employees,
        IReadOnlyList<ScheduleShiftInputDto> shifts,
        string userMessage)
    {
        var issues = new List<string>();

        if (employees.Count < 1)
        {
            issues.Add("Add at least one employee (name is required).");
        }

        if (shifts.Count < 1)
        {
            issues.Add("Add at least one shift (id, start, end, location, required skill).");
        }

        AppendRosterMismatchHints(userMessage, employees, issues);

        AppendPreferenceCoverageHints(employees, userMessage, issues);

        for (var i = 0; i < employees.Count; i++)
        {
            if (string.IsNullOrWhiteSpace(employees[i].Name))
            {
                issues.Add($"employees[{i}].name: must be a non-empty string.");
            }
            else if (!HasAtLeastOneNonEmptySkill(employees[i].Skills))
            {
                issues.Add($"employees[{i}].skills: add at least one skill for this employee.");
            }
        }

        for (var i = 0; i < shifts.Count; i++)
        {
            var s = shifts[i];
            var label = string.IsNullOrWhiteSpace(s.Id)
                ? $"shifts[{i}]"
                : $"shifts[{i}] (id \"{s.Id.Trim()}\")";

            if (string.IsNullOrWhiteSpace(s.Id))
            {
                issues.Add($"{label}: id is missing or empty.");
            }

            if (string.IsNullOrWhiteSpace(s.Start))
            {
                issues.Add($"{label}.start: missing (use ISO datetime, e.g. 2022-03-10T08:00:00).");
            }
            else if (!DateTime.TryParse(s.Start, out _))
            {
                issues.Add($"{label}.start: not a valid datetime (got \"{s.Start}\").");
            }

            if (string.IsNullOrWhiteSpace(s.End))
            {
                issues.Add($"{label}.end: missing (use ISO datetime).");
            }
            else if (!DateTime.TryParse(s.End, out _))
            {
                issues.Add($"{label}.end: not a valid datetime (got \"{s.End}\").");
            }

            if (IsPlaceholderLocation(s.Location))
            {
                issues.Add($"{label}.location: add a city or site name (not empty or generic placeholders like \"Unspecified\").");
            }

            if (string.IsNullOrWhiteSpace(s.RequiredSkill))
            {
                issues.Add($"{label}.requiredSkill: missing or empty.");
            }

            if (DateTime.TryParse(s.Start, out var ts)
                && DateTime.TryParse(s.End, out var te)
                && te <= ts)
            {
                issues.Add($"{label}: end must be after start.");
            }
        }

        AppendDemoScheduleLimits(employees, shifts, issues);

        return issues;
    }

    private static int CountNonEmptySkills(IReadOnlyList<string>? skills)
    {
        if (skills is null || skills.Count == 0)
        {
            return 0;
        }

        return skills.Count(s => !string.IsNullOrWhiteSpace(s));
    }

    private static void AppendDemoScheduleLimits(
        IReadOnlyList<ScheduleEmployeeDto> employees,
        IReadOnlyList<ScheduleShiftInputDto> shifts,
        List<string> issues)
    {
        // Check skills before headcount so users see the right demo message when many comma-separated roles
        // were mis-counted as "extra people" under old text heuristics.
        for (var i = 0; i < employees.Count; i++)
        {
            var n = CountNonEmptySkills(employees[i].Skills);
            if (n > DemoScheduleMaxSkillsPerEmployee)
            {
                var who = string.IsNullOrWhiteSpace(employees[i].Name)
                    ? $"employees[{i}]"
                    : $"\"{employees[i].Name.Trim()}\"";
                issues.Add(
                    $"This is a demo app: you can enter at most {DemoScheduleMaxSkillsPerEmployee} skills per employee — {who} has {n}. "
                    + "Shorten the list to three roles or fewer, then send again.");
            }
        }

        if (employees.Count > DemoScheduleMaxEmployees)
        {
            issues.Add(
                $"This is a demo app: at most {DemoScheduleMaxEmployees} employees — reduce the roster or split into multiple requests.");
        }

        DateTime? minStart = null;
        DateTime? maxEnd = null;
        foreach (var s in shifts)
        {
            if (!DateTime.TryParse(s.Start, out var ts)
                || !DateTime.TryParse(s.End, out var te)
                || te <= ts)
            {
                continue;
            }

            minStart = minStart is null ? ts : (ts < minStart.Value ? ts : minStart);
            maxEnd = maxEnd is null ? te : (te > maxEnd.Value ? te : maxEnd);
        }

        if (minStart is not null && maxEnd is not null)
        {
            var span = maxEnd.Value - minStart.Value;
            if (span > DemoScheduleMaxShiftWindow)
            {
                issues.Add(
                    $"This is a demo app: all shifts must fall within {DemoScheduleMaxShiftWindow.TotalDays:F0} days from the earliest shift start to the latest shift end "
                    + $"(got ~{span.TotalDays:F1} days). Narrow the planning window or split the problem.");
            }
        }
    }

    private static bool HasAnyPreferenceDates(ScheduleEmployeeDto e) =>
        e.DesiredDates.Count > 0 || e.UndesiredDates.Count > 0 || e.UnavailableDates.Count > 0;

    /// <summary>
    /// If some employees have preference dates filled (or the user text describes preferences near some names) but
    /// others do not, require follow-up for the missing people (e.g. Anna/Blake/Adam described, Elisa not).
    /// </summary>
    private static void AppendPreferenceCoverageHints(
        IReadOnlyList<ScheduleEmployeeDto> employees,
        string userMessage,
        List<string> issues)
    {
        if (employees.Count < 2)
        {
            return;
        }

        var anyHasExtractedPreferences = employees.Any(HasAnyPreferenceDates);
        var anyNameHasTextPreferenceDescription = employees.Any(
            e => !string.IsNullOrWhiteSpace(e.Name) && UserMessageDescribesPreferencesNearName(userMessage, e.Name));

        if (!anyHasExtractedPreferences && !anyNameHasTextPreferenceDescription)
        {
            return;
        }

        foreach (var e in employees)
        {
            if (string.IsNullOrWhiteSpace(e.Name))
            {
                continue;
            }

            if (HasAnyPreferenceDates(e))
            {
                continue;
            }

            if (UserMessageExplicitlyDeclaresNoPreferencesForEmployee(userMessage, e.Name))
            {
                continue;
            }

            var needHint = false;
            if (anyHasExtractedPreferences)
            {
                needHint = true;
            }
            else if (anyNameHasTextPreferenceDescription && !UserMessageDescribesPreferencesNearName(userMessage, e.Name))
            {
                needHint = true;
            }

            if (!needHint)
            {
                continue;
            }

            issues.Add(
                $"employee \"{e.Name}\": preferences not stated — the message describes preferences for others; "
                + $"add preferred, undesired, or unavailable days for {e.Name}, or say explicitly that they have no preference / are flexible.");
        }
    }

    /// <summary>
    /// True when the user's text mentions likes/dislikes/cannot-work style preferences in the same neighborhood as this name.
    /// </summary>
    private static bool UserMessageDescribesPreferencesNearName(string userMessage, string name)
    {
        if (string.IsNullOrWhiteSpace(userMessage) || string.IsNullOrWhiteSpace(name))
        {
            return false;
        }

        var lower = userMessage.ToLowerInvariant();
        var nameLower = name.Trim().ToLowerInvariant();
        if (nameLower.Length < 2)
        {
            return false;
        }

        for (var i = 0; i <= lower.Length - nameLower.Length; i++)
        {
            if (string.CompareOrdinal(lower.Substring(i, nameLower.Length), nameLower) != 0)
            {
                continue;
            }

            if (i > 0 && char.IsLetter(lower[i - 1]))
            {
                continue;
            }

            if (i + nameLower.Length < lower.Length && char.IsLetter(lower[i + nameLower.Length]))
            {
                continue;
            }

            var winStart = Math.Max(0, i - 110);
            var winEnd = Math.Min(lower.Length, i + nameLower.Length + 110);
            var window = lower[winStart..winEnd];
            if (WindowContainsPreferencePhrases(window))
            {
                return true;
            }
        }

        return false;
    }

    private static bool WindowContainsPreferencePhrases(string window)
    {
        return window.Contains("likes to", StringComparison.Ordinal)
            || window.Contains("doesn't like", StringComparison.Ordinal)
            || window.Contains("dont like", StringComparison.Ordinal)
            || window.Contains("doesnt like", StringComparison.Ordinal)
            || window.Contains("can't work", StringComparison.Ordinal)
            || window.Contains("cant work", StringComparison.Ordinal);
    }

    private static bool UserMessageExplicitlyDeclaresNoPreferencesForEmployee(string userMessage, string employeeName)
    {
        if (string.IsNullOrWhiteSpace(userMessage) || string.IsNullOrWhiteSpace(employeeName))
        {
            return false;
        }

        var nameLower = employeeName.Trim().ToLowerInvariant();
        var lower = userMessage.ToLowerInvariant();
        if (!lower.Contains(nameLower, StringComparison.Ordinal))
        {
            return false;
        }

        var markers = new[]
        {
            "no preference", "no preferences", "no specific", "no particular",
            "flexible", "any day", "any days", "doesn't care", "does not care",
            "fine with any", "indifferent", "open to any", "any shift", "doesn't mind",
            "okay with any", "ok with any", "nothing specific", "whatever works",
        };

        foreach (var marker in markers)
        {
            var idx = lower.IndexOf(marker, StringComparison.Ordinal);
            while (idx >= 0)
            {
                var winStart = Math.Max(0, idx - 120);
                var winEnd = Math.Min(lower.Length, idx + marker.Length + 120);
                var window = lower[winStart..winEnd];
                if (window.Contains(nameLower, StringComparison.Ordinal))
                {
                    return true;
                }

                idx = lower.IndexOf(marker, idx + 1, StringComparison.Ordinal);
            }
        }

        return false;
    }

    private static JsonObject BuildScheduleExtractionSchema()
    {
        static JsonObject StringArraySchema() =>
            new JsonObject
            {
                ["type"] = "ARRAY",
                ["items"] = new JsonObject { ["type"] = "STRING" },
            };

        var employeeProps = new JsonObject
        {
            ["name"] = new JsonObject { ["type"] = "STRING" },
            ["skills"] = StringArraySchema(),
            ["unavailableDates"] = StringArraySchema(),
            ["undesiredDates"] = StringArraySchema(),
            ["desiredDates"] = StringArraySchema(),
        };

        var employeeItem = new JsonObject
        {
            ["type"] = "OBJECT",
            ["properties"] = employeeProps,
            ["required"] = new JsonArray(
                "name",
                "skills",
                "unavailableDates",
                "undesiredDates",
                "desiredDates"),
        };

        var shiftProps = new JsonObject
        {
            ["id"] = new JsonObject { ["type"] = "STRING" },
            ["start"] = new JsonObject { ["type"] = "STRING" },
            ["end"] = new JsonObject { ["type"] = "STRING" },
            ["location"] = new JsonObject { ["type"] = "STRING" },
            ["requiredSkill"] = new JsonObject { ["type"] = "STRING" },
        };

        var shiftItem = new JsonObject
        {
            ["type"] = "OBJECT",
            ["properties"] = shiftProps,
            ["required"] = new JsonArray("id", "start", "end", "location", "requiredSkill"),
        };

        return new JsonObject
        {
            ["type"] = "OBJECT",
            ["properties"] = new JsonObject
            {
                ["employees"] = new JsonObject
                {
                    ["type"] = "ARRAY",
                    ["items"] = employeeItem,
                },
                ["shifts"] = new JsonObject
                {
                    ["type"] = "ARRAY",
                    ["items"] = shiftItem,
                },
            },
            ["required"] = new JsonArray("employees", "shifts"),
        };
    }

    private sealed class ScheduleGeminiRoot
    {
        public List<ScheduleEmployeeDto>? Employees { get; set; }

        public List<ScheduleShiftInputDto>? Shifts { get; set; }
    }

    /// <summary>Gemini response schema: warehouses, vehicles, addresses only (no packages).</summary>
    private sealed class GeminiRouteCounts
    {
        public int VehicleCount { get; set; }

        public int AddressCount { get; set; }

        public int WarehouseCount { get; set; }
    }
}
