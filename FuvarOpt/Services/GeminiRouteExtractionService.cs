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

        var apiKey = ResolveGeminiApiKey();

        var model =
            _configuration["Gemini:Model"]
            ?? Environment.GetEnvironmentVariable("GEMINI_MODEL")
            ?? _options.Value.Model;

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

    /// <summary>Gemini response schema: warehouses, vehicles, addresses only (no packages).</summary>
    private sealed class GeminiRouteCounts
    {
        public int VehicleCount { get; set; }

        public int AddressCount { get; set; }

        public int WarehouseCount { get; set; }
    }
}
