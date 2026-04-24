using System.ComponentModel;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FuvarOpt.Services;
using ModelContextProtocol.Server;

namespace FuvarOpt.Mcp;

[McpServerToolType]
public sealed class RouteMcpTools
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = null,
    };

    private static readonly JsonSerializerOptions JsonCamelOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly GeminiRouteExtractionService _gemini;
    private readonly RouteOptimizationAnalysisService _routeAnalysis;

    public RouteMcpTools(GeminiRouteExtractionService gemini, RouteOptimizationAnalysisService routeAnalysis)
    {
        _gemini = gemini;
        _routeAnalysis = routeAnalysis;
    }

    [McpServerTool, Description(
        "Extract workforce planning JSON from the user's free-text message using Google Gemini: employees (ids, skills, shift times, hour limits, preference intervals) "
        + "and flights (duty windows and requiredEmployees skill bundles). "
        + "Same extraction as POST /api/schedule/from-message. Returns JSON with employees, flights, complete, missingHints. "
        + "If the result will be submitted to the multi-day schedule API (POST /schedules/problem/multi-day on the schedule service), "
        + "flights must satisfy: at least two distinct calendar dates among flight duration.start (i.e. not every flight may start on the same day; compare the yyyy-MM-dd date part). "
        + "Example sentence that works for a multi-day submit: "
        + "\"We have employees emp-1 Alice Smith and emp-2 Bob Jones with skills Driver. "
        + "Flight FLT-A runs from 2026-06-02T06:00:00 to 2026-06-02T10:00:00 and flight FLT-B runs from 2026-06-03T14:00:00 to 2026-06-03T18:00:00; each needs one Driver.\" "
        + "(Two different start days: 2026-06-02 and 2026-06-03.) "
        + "A single-day problem can keep all flights on one date; use POST /schedules/problem instead of multi-day in that case.")]
    public async Task<string> ExtractScheduleFromMessage(
        [Description("Natural language describing employees and flights/coverage to build planning JSON.")]
        string message,
        CancellationToken cancellationToken)
    {
        var result = await _gemini.ExtractScheduleFromMessageAsync(message, cancellationToken).ConfigureAwait(false);
        return JsonSerializer.Serialize(result, JsonCamelOptions);
    }

    [McpServerTool, Description(
        "Extract route problem counts (VehicleCount, AddressCount, WarehouseCount) from the user's free-text message using Google Gemini. Does not extract package totals.")]
    public async Task<string> ExtractRouteProblemFromMessage(
        [Description("Natural language describing vehicles, addresses, and warehouses for routing.")]
        string message,
        CancellationToken cancellationToken)
    {
        var result = await _gemini.ExtractFromMessageAsync(message, cancellationToken).ConfigureAwait(false);
        return JsonSerializer.Serialize(result, JsonOptions);
    }

    [McpServerTool, Description(
        "Analyze a solved route-plan JSON (same body as GET /route-plans/{jobId} returns). " +
        "Reports warehouses used, stops per vehicle, driving time (seconds), and approximate straight-line distance (km).")]
    public Task<string> AnalyzeOptimizedRoute(
        [Description("Full optimized route JSON string from the route-plans API after solving.")]
        string optimizedRouteJson,
        CancellationToken cancellationToken)
    {
        _ = cancellationToken;
        var result = _routeAnalysis.Analyze(optimizedRouteJson);
        return Task.FromResult(JsonSerializer.Serialize(result, JsonOptions));
    }
}
