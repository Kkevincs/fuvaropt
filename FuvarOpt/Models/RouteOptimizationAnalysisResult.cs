using System.Collections.Generic;

namespace FuvarOpt.Models;

public sealed class RouteOptimizationAnalysisResult
{
    public int TotalVehicles { get; init; }

    public int ActiveVehicles { get; init; }

    /// <summary>Distinct home locations (warehouses) among vehicles that serve at least one stop.</summary>
    public int WarehousesUsed { get; init; }

    public int TotalStopsAssigned { get; init; }

    public double AverageStopsPerActiveVehicle { get; init; }

    public double AverageStopsPerVehicleIncludingIdle { get; init; }

    /// <summary>Sum of per-vehicle solver driving time (seconds).</summary>
    public int TotalDrivingTimeSeconds { get; init; }

    public string TravelMetricNote { get; init; } =
        "Driving times are solver estimates in seconds, not GPS road distance.";

    /// <summary>Sum of straight-line segment lengths along each vehicle route (home → visits → home).</summary>
    public double ApproximateStraightLineDistanceKmTotal { get; init; }

    public List<VehicleTravelBreakdown> PerVehicle { get; init; } = new();
}

public sealed class VehicleTravelBreakdown
{
    public string VehicleId { get; init; } = "";

    public int StopCount { get; init; }

    public int DrivingTimeSeconds { get; init; }

    /// <summary>Straight-line path length for this vehicle (km).</summary>
    public double ApproximateStraightLineRouteKm { get; init; }
}
