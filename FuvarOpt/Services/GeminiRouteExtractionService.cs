using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
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
    /// When <paramref name="analyzeResponseJson"/> is set, prioritizes fixes for hard constraints, then soft (from analyze).
    /// </summary>
    public async Task<PostOptimizationSuggestionsResponse> GetPostScheduleOptimizationSuggestionsAsync(
        string solvedScheduleJson,
        string? analyzeResponseJson,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(solvedScheduleJson))
        {
            throw new ArgumentException("Solved schedule JSON is required.", nameof(solvedScheduleJson));
        }

        string prompt;
        if (!string.IsNullOrWhiteSpace(analyzeResponseJson))
        {
            prompt =
                "You are given (1) JSON from an employee scheduling optimizer: employees (name, skills, preferences) "
                + "and shifts (id, duration, requiredSkills, employee assignment), and "
                + "(2) JSON from PUT /schedules/analyze: constraint match analysis (hard and soft constraint causes, "
                + "violations, match counts, weights, or similar—use the field names as they appear).\n"
                + "Respond with JSON only. Write in clear English.\n\n"
                + "Produce 4 to 12 short suggestion strings. Each string is one line (no markdown bullets inside the string). "
                + "Order is critical:\n"
                + "1. First, list every actionable suggestion that addresses **hard** constraint issues (infeasibility, "
                + "must-fix rules, broken hard scores). Reference specific employees, shift ids, or causes from the analyze JSON when possible.\n"
                + "2. Then, suggestions for **soft** constraint improvements (preferences, fairness, minor penalties).\n"
                + "If analyze JSON is dense, still separate hard-related ideas before soft-related ones.\n"
                + "If a section has nothing to say, skip it and use fewer strings total.\n\n"
                + "suggestions: 4 to 12 strings in hard-then-soft order.\n\n"
                + "Solved schedule JSON:\n"
                + solvedScheduleJson
                + "\n\nAnalyze (constraint match) JSON:\n"
                + analyzeResponseJson;
        }
        else
        {
            prompt =
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
        }

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
    /// Extracts employees and flights (coverage demand) from free text (same logic as MCP tool <c>ExtractScheduleFromMessage</c>).
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

        var isPlanRefine = userMessage.Contains("---BEGIN_CURRENT_PLAN_JSON---", StringComparison.Ordinal)
            && userMessage.Contains("---END_CURRENT_PLAN_JSON---", StringComparison.Ordinal);

        var basePrompt =
            "You extract structured workforce planning JSON (ProblemDTO) for an API. Follow the JSON schema; never use JSON null for employees, flights, or skills—use [] for empty arrays.\n\n"
            + "REQUIRED for a meaningful schedule:\n"
            + "- employees[]: each object should have id, name, skills (array of strings; never null). For a real solve use at least one non-empty skill per person.\n"
            + "- flights[]: each object has id, duration { start, end } in yyyy-MM-dd'T'HH:mm:ss (or full ISO; always use T between date and time—if the user wrote \"2026-06-02 06:00\", output \"2026-06-02T06:00:00\"), and requiredEmployees: array of { skills: string[], numberOfEmployees: integer } "
            + "with numberOfEmployees >= 1 and skills as a non-null array (can be empty only if the user explicitly allows no skill filter—prefer at least one skill when demand is stated).\n\n"
            + "OPTIONAL (omit or use 0 / empty arrays if not mentioned):\n"
            + "- employees: expectedShiftStart, earliestShiftStart as full ISO local date-time (yyyy-MM-dd'T'HH:mm:ss) or omit; "
            + "never output time-only strings like \"04:00:00\" (invalid for APIs that use LocalDateTime). "
            + "dailyMinWorkingHour, dailyMaxWorkingHour; weekly/monthly hour counters; unavailableDates, undesiredDates, desiredDates as arrays of { start, end } using the same full date-time form for each start/end.\n\n"
            + "MULTIPLE EMPLOYEES: If the user lists N people, output N employee rows—never merge.\n"
            + "PREFERENCE COVERAGE: If some employees have preference intervals and others do not, leave missing ones as empty arrays.\n\n"
            + "MULTI-DAY API: If the user wants coverage across more than one calendar day (or the downstream app will call POST /schedules/problem/multi-day), "
            + "include at least two flights whose duration.start falls on two different dates (compare yyyy-MM-dd). "
            + "For a single planning day, all flights may share the same date; for multi-day, split duties across at least two start dates.\n\n"
            + $"DEMO LIMITS (server-enforced): at most {DemoScheduleMaxEmployees} employees; "
            + $"at most {DemoScheduleMaxSkillsPerEmployee} skills per employee; "
            + "all flight duration start/end times within 7 days from earliest flight start to latest flight end.\n\n";

        var refineBlock = isPlanRefine
            ? "REFINEMENT: The user message may include a block ---BEGIN_CURRENT_PLAN_JSON--- ... ---END_CURRENT_PLAN_JSON--- with the current plan. "
            + "In that case, apply the 'User instruction' to that plan and output the FULL updated `employees` and `flights` (complete JSON). "
            + "Keep stable `id` values for rows that are not removed. Add, remove, or change flights and employees as requested. "
            + "Do not output a partial diff only—return the same schema as a fresh extract.\n\n"
            : "";

        var prompt = basePrompt + refineBlock + "User message:\n" + userMessage;

        var schema = BuildSchedulePlanningExtractionSchema();

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
            var errMsg = TryGetGeminiHttpErrorMessage(responseText) ?? responseText;
            if (response.StatusCode == HttpStatusCode.BadRequest
                && (errMsg.Contains("deserialize", StringComparison.OrdinalIgnoreCase)
                    || errMsg.Contains("invalid json", StringComparison.OrdinalIgnoreCase)))
            {
                return BuildIncompleteScheduleExtract(
                    new List<string>
                    {
                        "The AI service rejected the request format (" + errMsg + ").",
                        "Rephrase in short lines: one employee per line with id, name, and a skills array; one flight per block with start/end in ISO-8601 using T (yyyy-MM-ddTHH:mm:ss) and requiredEmployees entries.",
                    },
                    addStandardRecoveryHints: true);
            }

            throw new InvalidOperationException(
                $"Gemini API error {(int)response.StatusCode}: {errMsg}");
        }

        if (!TryGetGeminiModelTextFromResponse(
                responseText,
                out var text,
                out var extractFailure))
        {
            return BuildIncompleteScheduleExtract(
                new List<string> { extractFailure },
                addStandardRecoveryHints: true);
        }

        SchedulePlanningGeminiRoot? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<SchedulePlanningGeminiRoot>(
                text!,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch (JsonException ex)
        {
            return BuildIncompleteScheduleExtract(
                new List<string>
                {
                    "The model's reply was not valid schedule JSON. " + ex.Message,
                },
                addStandardRecoveryHints: true);
        }

        if (parsed is null)
        {
            return BuildIncompleteScheduleExtract(
                new List<string> { "The model's reply could not be read as schedule data (empty result)." },
                addStandardRecoveryHints: true);
        }

        var employees = parsed.Employees ?? new List<SchedulePlanningEmployeeDto>();
        var flights = parsed.Flights ?? new List<ScheduleFlightDto>();

        NormalizePlanningEmployeesAfterExtraction(employees);
        NormalizeFlightsAfterExtraction(flights);

        var missingHints = CollectPlanningScheduleIssues(employees, flights, userMessage);

        return new ScheduleExtractResponse
        {
            Employees = employees,
            Flights = flights,
            Complete = missingHints.Count == 0,
            MissingHints = missingHints,
        };
    }

    private static ScheduleExtractResponse BuildIncompleteScheduleExtract(
        List<string> headHints,
        bool addStandardRecoveryHints = true)
    {
        if (addStandardRecoveryHints)
        {
            foreach (var h in GetStandardScheduleRecoveryHints())
            {
                if (!headHints.Contains(h))
                {
                    headHints.Add(h);
                }
            }
        }

        return new ScheduleExtractResponse
        {
            Employees = new List<SchedulePlanningEmployeeDto>(),
            Flights = new List<ScheduleFlightDto>(),
            Complete = false,
            MissingHints = headHints,
        };
    }

    private static IReadOnlyList<string> GetStandardScheduleRecoveryHints() =>
        new[]
        {
            "Each employee needs: id (string), name (string), skills (JSON array with at least one non-empty skill).",
            "Each flight needs: id (string); duration.start and duration.end as ISO datetimes with T (yyyy-MM-ddTHH:mm:ss); requiredEmployees as [{ skills: string[], numberOfEmployees: integer ≥ 1 }].",
            "Multi-day API only: at least two flights must have duration.start on different calendar days (not all starts on the same yyyy-MM-dd).",
        };

    private static string? TryGetGeminiHttpErrorMessage(string responseText)
    {
        try
        {
            using var d = JsonDocument.Parse(responseText);
            if (d.RootElement.TryGetProperty("error", out var err)
                && err.TryGetProperty("message", out var m))
            {
                return m.GetString();
            }
        }
        catch (JsonException)
        {
        }

        return null;
    }

    private static bool TryGetGeminiModelTextFromResponse(
        string responseText,
        out string? text,
        out string failureReason)
    {
        text = null;
        failureReason = string.Empty;

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(responseText);
        }
        catch (JsonException ex)
        {
            failureReason = "Gemini response was not valid JSON: " + ex.Message;
            return false;
        }

        using (doc)
        {
            var root = doc.RootElement;

            if (root.TryGetProperty("promptFeedback", out var feedback)
                && feedback.TryGetProperty("blockReason", out var block))
            {
                failureReason =
                    "The model blocked this input (blockReason: " + (block.GetString() ?? block.ToString()) + ").";
                return false;
            }

            if (root.TryGetProperty("candidates", out var cands) && cands.GetArrayLength() > 0)
            {
                var c0 = cands[0];
                if (c0.TryGetProperty("content", out var content)
                    && content.TryGetProperty("parts", out var parts)
                    && parts.GetArrayLength() > 0
                    && parts[0].TryGetProperty("text", out var textEl))
                {
                    text = textEl.GetString();
                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        return true;
                    }
                }
            }

            failureReason = "The model did not return schedule text (empty response or missing candidates/parts).";
            return false;
        }
    }

    private static string NormalizeSpaceSeparatedIsoDateTime(string? s)
    {
        if (string.IsNullOrWhiteSpace(s))
        {
            return string.Empty;
        }

        var t = s.Trim();
        if (t.Length >= 11 && t[4] == '-' && t[7] == '-' && t[10] == ' ')
        {
            return t.Substring(0, 10) + "T" + t.Substring(11);
        }

        return t;
    }

    private static void NormalizePlanningEmployeesAfterExtraction(IList<SchedulePlanningEmployeeDto> employees)
    {
        for (var i = 0; i < employees.Count; i++)
        {
            var e = employees[i];
            e.Skills ??= new List<string>();
            e.UnavailableDates ??= new List<ScheduleDateTimeRangeDto>();
            e.UndesiredDates ??= new List<ScheduleDateTimeRangeDto>();
            e.DesiredDates ??= new List<ScheduleDateTimeRangeDto>();
            e.ExpectedShiftStart ??= string.Empty;
            e.EarliestShiftStart ??= string.Empty;
            if (string.IsNullOrWhiteSpace(e.Id) && !string.IsNullOrWhiteSpace(e.Name))
            {
                e.Id = $"emp-{SlugId(e.Name)}-{i + 1}";
            }
            else if (string.IsNullOrWhiteSpace(e.Id))
            {
                e.Id = $"employee-{i + 1}";
            }
        }
    }

    private static string SlugId(string name)
    {
        var t = name.Trim().ToLowerInvariant();
        var chars = t.Where(c => char.IsLetterOrDigit(c) || c == '-').ToArray();
        var s = new string(chars);
        return s.Length > 0 ? s : "x";
    }

    private static void NormalizeFlightsAfterExtraction(IList<ScheduleFlightDto> flights)
    {
        for (var i = 0; i < flights.Count; i++)
        {
            var f = flights[i];
            if (f.Duration is null)
            {
                f.Duration = new ScheduleFlightDurationDto();
            }

            f.Duration.Start = NormalizeSpaceSeparatedIsoDateTime(f.Duration.Start);
            f.Duration.End = NormalizeSpaceSeparatedIsoDateTime(f.Duration.End);

            f.RequiredEmployees ??= new List<ScheduleFlightRequiredEmployeesDto>();
            foreach (var re in f.RequiredEmployees)
            {
                re.Skills ??= new List<string>();
            }

            if (string.IsNullOrWhiteSpace(f.Id))
            {
                f.Id = $"flight-{i + 1}";
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

    /// <summary>
    /// When the user explicitly names multiple people but Gemini returns fewer employee rows (e.g. duplicate \"Adam\" typo for Josh),
    /// add a targeted hint so the UI can ask only for the missing person.
    /// </summary>
    private static void AppendRosterMismatchHints(
        string userMessage,
        IReadOnlyList<SchedulePlanningEmployeeDto> employees,
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

    /// <summary>Lists concrete problems with the extracted planning JSON so the UI only asks for what is still missing.</summary>
    private static List<string> CollectPlanningScheduleIssues(
        IReadOnlyList<SchedulePlanningEmployeeDto> employees,
        IReadOnlyList<ScheduleFlightDto> flights,
        string userMessage)
    {
        var issues = new List<string>();

        if (employees.Count < 1)
        {
            issues.Add("Add at least one employee (id and name are required).");
        }

        if (flights.Count < 1)
        {
            issues.Add("Add at least one flight (id, duration start/end, and requiredEmployees).");
        }

        AppendRosterMismatchHints(userMessage, employees, issues);

        AppendPlanningPreferenceCoverageHints(employees, userMessage, issues);

        for (var i = 0; i < employees.Count; i++)
        {
            var e = employees[i];
            var empLabel = string.IsNullOrWhiteSpace(e.Name) ? $"employees[{i}]" : $"\"{e.Name.Trim()}\" (employees[{i}])";

            if (string.IsNullOrWhiteSpace(e.Id))
            {
                issues.Add($"{empLabel}: id is required in the JSON (non-empty string).");
            }

            if (string.IsNullOrWhiteSpace(e.Name))
            {
                issues.Add($"employees[{i}].name: is required in the JSON (non-empty string).");
            }

            if (!HasAtLeastOneNonEmptySkill(e.Skills))
            {
                issues.Add(
                    $"{empLabel}: skills is required—use a JSON array with at least one non-empty skill string (never null; use [] only after you add real skills in your next message).");
            }

            if (!string.IsNullOrWhiteSpace(e.ExpectedShiftStart)
                && !DateTime.TryParse(e.ExpectedShiftStart, out _))
            {
                issues.Add($"employees[{i}].expectedShiftStart: not a valid datetime (got \"{e.ExpectedShiftStart}\").");
            }

            if (!string.IsNullOrWhiteSpace(e.EarliestShiftStart)
                && !DateTime.TryParse(e.EarliestShiftStart, out _))
            {
                issues.Add($"employees[{i}].earliestShiftStart: not a valid datetime (got \"{e.EarliestShiftStart}\").");
            }

            AppendRangeListIssues(issues, e.UnavailableDates, $"employees[{i}].unavailableDates");
            AppendRangeListIssues(issues, e.UndesiredDates, $"employees[{i}].undesiredDates");
            AppendRangeListIssues(issues, e.DesiredDates, $"employees[{i}].desiredDates");
        }

        for (var i = 0; i < flights.Count; i++)
        {
            var f = flights[i];
            var label = string.IsNullOrWhiteSpace(f.Id)
                ? $"flights[{i}]"
                : $"flights[{i}] (id \"{f.Id.Trim()}\")";

            if (string.IsNullOrWhiteSpace(f.Id))
            {
                issues.Add($"{label}: id is missing or empty.");
            }

            var d = f.Duration;
            if (d is null)
            {
                issues.Add($"{label}.duration: missing.");
            }
            else
            {
                if (string.IsNullOrWhiteSpace(d.Start))
                {
                    issues.Add($"{label}.duration.start: missing (ISO datetime).");
                }
                else if (!DateTime.TryParse(d.Start, out _))
                {
                    issues.Add($"{label}.duration.start: not a valid datetime (got \"{d.Start}\").");
                }

                if (string.IsNullOrWhiteSpace(d.End))
                {
                    issues.Add($"{label}.duration.end: missing (ISO datetime).");
                }
                else if (!DateTime.TryParse(d.End, out _))
                {
                    issues.Add($"{label}.duration.end: not a valid datetime (got \"{d.End}\").");
                }

                if (DateTime.TryParse(d.Start, out var ts)
                    && DateTime.TryParse(d.End, out var te)
                    && te <= ts)
                {
                    issues.Add($"{label}: duration end must be after start.");
                }
            }

            if (f.RequiredEmployees is null || f.RequiredEmployees.Count < 1)
            {
                issues.Add($"{label}.requiredEmployees: add at least one entry with skills and numberOfEmployees.");
            }
            else
            {
                for (var r = 0; r < f.RequiredEmployees.Count; r++)
                {
                    var re = f.RequiredEmployees[r];
                    if (!HasAtLeastOneNonEmptySkill(re.Skills))
                    {
                        issues.Add($"{label}.requiredEmployees[{r}].skills: add at least one skill.");
                    }

                    if (re.NumberOfEmployees < 1)
                    {
                        issues.Add($"{label}.requiredEmployees[{r}].numberOfEmployees: must be at least 1.");
                    }
                }
            }
        }

        AppendDemoPlanningScheduleLimits(employees, flights, issues);

        return issues;
    }

    private static void AppendRangeListIssues(
        List<string> issues,
        IReadOnlyList<ScheduleDateTimeRangeDto>? ranges,
        string prefix)
    {
        if (ranges is null || ranges.Count == 0)
        {
            return;
        }

        for (var i = 0; i < ranges.Count; i++)
        {
            var r = ranges[i];
            if (string.IsNullOrWhiteSpace(r.Start) || !DateTime.TryParse(r.Start, out _))
            {
                issues.Add($"{prefix}[{i}].start: invalid or missing datetime.");
            }

            if (string.IsNullOrWhiteSpace(r.End) || !DateTime.TryParse(r.End, out _))
            {
                issues.Add($"{prefix}[{i}].end: invalid or missing datetime.");
            }

            if (DateTime.TryParse(r.Start, out var ts)
                && DateTime.TryParse(r.End, out var te)
                && te < ts)
            {
                issues.Add($"{prefix}[{i}]: end must not be before start.");
            }
        }
    }

    private static int CountNonEmptySkills(IReadOnlyList<string>? skills)
    {
        if (skills is null || skills.Count == 0)
        {
            return 0;
        }

        return skills.Count(s => !string.IsNullOrWhiteSpace(s));
    }

    private static void AppendDemoPlanningScheduleLimits(
        IReadOnlyList<SchedulePlanningEmployeeDto> employees,
        IReadOnlyList<ScheduleFlightDto> flights,
        List<string> issues)
    {
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
        foreach (var f in flights)
        {
            var d = f.Duration;
            if (d is null
                || !DateTime.TryParse(d.Start, out var ts)
                || !DateTime.TryParse(d.End, out var te)
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
                    $"This is a demo app: all flights must fall within {DemoScheduleMaxShiftWindow.TotalDays:F0} days from the earliest flight start to the latest flight end "
                    + $"(got ~{span.TotalDays:F1} days). Narrow the planning window or split the problem.");
            }
        }
    }

    private static bool HasAnyPlanningPreferenceDates(SchedulePlanningEmployeeDto e) =>
        (e.DesiredDates?.Count > 0)
        || (e.UndesiredDates?.Count > 0)
        || (e.UnavailableDates?.Count > 0);

    /// <summary>
    /// If some employees have preference intervals filled (or the user text describes preferences near some names) but
    /// others do not, require follow-up for the missing people.
    /// </summary>
    private static void AppendPlanningPreferenceCoverageHints(
        IReadOnlyList<SchedulePlanningEmployeeDto> employees,
        string userMessage,
        List<string> issues)
    {
        if (employees.Count < 2)
        {
            return;
        }

        var anyHasExtractedPreferences = employees.Any(HasAnyPlanningPreferenceDates);
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

            if (HasAnyPlanningPreferenceDates(e))
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

    private static JsonObject BuildSchedulePlanningExtractionSchema()
    {
        static JsonObject StringArraySchema() =>
            new JsonObject
            {
                ["type"] = "ARRAY",
                ["items"] = new JsonObject { ["type"] = "STRING" },
            };

        // Each ARRAY `items` must be its own JsonNode tree; reusing one JsonObject throws "The node already has a parent."
        static JsonObject CreateDateRangeItemSchema() =>
            new JsonObject
            {
                ["type"] = "OBJECT",
                ["properties"] = new JsonObject
                {
                    ["start"] = new JsonObject { ["type"] = "STRING" },
                    ["end"] = new JsonObject { ["type"] = "STRING" },
                },
                ["required"] = new JsonArray("start", "end"),
            };

        static JsonObject RangeArraySchema() =>
            new JsonObject
            {
                ["type"] = "ARRAY",
                ["items"] = CreateDateRangeItemSchema(),
            };

        var employeeProps = new JsonObject
        {
            ["id"] = new JsonObject { ["type"] = "STRING" },
            ["name"] = new JsonObject { ["type"] = "STRING" },
            ["skills"] = StringArraySchema(),
            ["expectedShiftStart"] = new JsonObject { ["type"] = "STRING" },
            ["earliestShiftStart"] = new JsonObject { ["type"] = "STRING" },
            ["dailyMinWorkingHour"] = new JsonObject { ["type"] = "INTEGER" },
            ["dailyMaxWorkingHour"] = new JsonObject { ["type"] = "INTEGER" },
            ["weeklyWorkedHours"] = new JsonObject { ["type"] = "INTEGER" },
            ["weeklyMaxWorkingHours"] = new JsonObject { ["type"] = "INTEGER" },
            ["monthlyWorkedHours"] = new JsonObject { ["type"] = "INTEGER" },
            ["monthlyMaxWorkingHours"] = new JsonObject { ["type"] = "INTEGER" },
            ["unavailableDates"] = RangeArraySchema(),
            ["undesiredDates"] = RangeArraySchema(),
            ["desiredDates"] = RangeArraySchema(),
        };

        var employeeItem = new JsonObject
        {
            ["type"] = "OBJECT",
            ["properties"] = employeeProps,
            ["required"] = new JsonArray("id", "name", "skills"),
        };

        var reqEmpItem = new JsonObject
        {
            ["type"] = "OBJECT",
            ["properties"] = new JsonObject
            {
                ["skills"] = StringArraySchema(),
                ["numberOfEmployees"] = new JsonObject { ["type"] = "INTEGER" },
            },
            ["required"] = new JsonArray("skills", "numberOfEmployees"),
        };

        var flightItem = new JsonObject
        {
            ["type"] = "OBJECT",
            ["properties"] = new JsonObject
            {
                ["id"] = new JsonObject { ["type"] = "STRING" },
                ["duration"] = new JsonObject
                {
                    ["type"] = "OBJECT",
                    ["properties"] = new JsonObject
                    {
                        ["start"] = new JsonObject { ["type"] = "STRING" },
                        ["end"] = new JsonObject { ["type"] = "STRING" },
                    },
                    ["required"] = new JsonArray("start", "end"),
                },
                ["requiredEmployees"] = new JsonObject
                {
                    ["type"] = "ARRAY",
                    ["items"] = reqEmpItem,
                },
            },
            ["required"] = new JsonArray("id", "duration", "requiredEmployees"),
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
                ["flights"] = new JsonObject
                {
                    ["type"] = "ARRAY",
                    ["items"] = flightItem,
                },
            },
            ["required"] = new JsonArray("employees", "flights"),
        };
    }

    private sealed class SchedulePlanningGeminiRoot
    {
        public List<SchedulePlanningEmployeeDto>? Employees { get; set; }

        public List<ScheduleFlightDto>? Flights { get; set; }
    }

    /// <summary>Gemini response schema: warehouses, vehicles, addresses only (no packages).</summary>
    private sealed class GeminiRouteCounts
    {
        public int VehicleCount { get; set; }

        public int AddressCount { get; set; }

        public int WarehouseCount { get; set; }
    }
}
