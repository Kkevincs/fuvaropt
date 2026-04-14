using System;
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

        var apiKey =
            _configuration["Gemini:ApiKey"]
            ?? Environment.GetEnvironmentVariable("GEMINI_API_KEY")
            ?? _options.Value.ApiKey;

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException(
                "Gemini API key is not configured. Set Gemini:ApiKey in appsettings.json or GEMINI_API_KEY.");
        }

        var model =
            _configuration["Gemini:Model"]
            ?? Environment.GetEnvironmentVariable("GEMINI_MODEL")
            ?? _options.Value.Model;

        var prompt =
            "Extract these counts from the user's message about delivery / vehicle routing. "
            + "Use non-negative integers only. If a count is not mentioned, use 0.\n"
            + "Field mapping (synonyms count as the same concept):\n"
            + "- VehicleCount: vehicles, cars, trucks, vans, fleet size, drivers, or how many vehicles are available.\n"
            + "- WarehouseCount: warehouses, depots, hubs, bases, distribution centers.\n"
            + "- AddressCount: delivery addresses, stops, customers, delivery points (not warehouses).\n"
            + "- Packages: packages, parcels, shipments, items, orders to deliver.\n\n"
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
                ["Packages"] = new JsonObject { ["type"] = "INTEGER" },
            },
            ["required"] = new JsonArray(
                "VehicleCount",
                "AddressCount",
                "WarehouseCount",
                "Packages"),
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

        var parsed = JsonSerializer.Deserialize<RouteProblemResponse>(
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
            parsed.Packages);
    }
}
