using System;
using System.Collections.Generic;

namespace FuvarOpt.Models;

/// <summary>Optimized route JSON from GET /route-plans/{jobId}. Vehicle visits are visit id strings, not nested objects.</summary>
public sealed class OptimizedRoutePlanDto
{
    public List<OptimizedRouteVehicleDto> Vehicles { get; set; } = new();

    public List<OptimizedRouteVisitDto> Visits { get; set; } = new();

    public int? TotalDrivingTimeSeconds { get; set; }
}

public sealed class OptimizedRouteVehicleDto
{
    public string Id { get; set; } = "";

    /// <summary>[latitude, longitude]</summary>
    public double[] HomeLocation { get; set; } = Array.Empty<double>();

    /// <summary>Visit ids in route order.</summary>
    public List<string> Visits { get; set; } = new();

    public int? TotalDrivingTimeSeconds { get; set; }
}

public sealed class OptimizedRouteVisitDto
{
    public string Id { get; set; } = "";

    /// <summary>[latitude, longitude]</summary>
    public double[] Location { get; set; } = Array.Empty<double>();
}
