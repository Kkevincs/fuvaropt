namespace FuvarOpt.Models;

/// <summary>Body with solved schedule JSON from GET /schedules/{jobId}.</summary>
public sealed class PostScheduleOptimizationSuggestionsRequest
{
    public string SolvedScheduleJson { get; set; } = "";

    /// <summary>Optional JSON from PUT /schedules/analyze (constraint match — hard/soft causes).</summary>
    public string? AnalyzeResponseJson { get; set; }
}
