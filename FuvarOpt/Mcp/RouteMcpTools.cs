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

    private readonly GeminiRouteExtractionService _gemini;
    private readonly RouteOptimizationAnalysisService _routeAnalysis;

    public RouteMcpTools(GeminiRouteExtractionService gemini, RouteOptimizationAnalysisService routeAnalysis)
    {
        _gemini = gemini;
        _routeAnalysis = routeAnalysis;
    }

    [McpServerTool, Description(
        "Extract route problem counts (VehicleCount, AddressCount, WarehouseCount, Packages) from the user's free-text message using Google Gemini.")]
    public async Task<string> ExtractRouteProblemFromMessage(
        [Description("Natural language describing vehicles, addresses, warehouses, packages, or routing needs.")]
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
