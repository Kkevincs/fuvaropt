namespace FuvarOpt.Models;

/// <summary>Body from GET /route-plans/{jobId} after solving.</summary>
public sealed class PostOptimizationSuggestionsRequest
{
    /// <summary>Full JSON string of the optimized route.</summary>
    public string OptimizedRouteJson { get; set; } = "";
}
