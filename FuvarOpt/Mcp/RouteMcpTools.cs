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
        "Extract employee scheduling data (employees with skills and date preferences, shifts with id/start/end/location/requiredSkill) from the user's free-text message using Google Gemini. "
        + "Same extraction as POST /api/schedule/from-message. Returns JSON with employees, shifts, and complete.")]
    public async Task<string> ExtractScheduleFromMessage(
        [Description("Natural language describing employees, skills, dates, and shifts to schedule.")]
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
