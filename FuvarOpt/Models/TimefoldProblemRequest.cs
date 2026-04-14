using System;
using System.Collections.Generic;

namespace FuvarOpt.Models;

/// <summary>Request body aligned with route-plans API: tuple coords [lat,lng], service duration in seconds.</summary>
public sealed class TimefoldProblemRequest
{
    public string Name { get; set; } = "";

    /// <summary>[latitude, longitude]</summary>
    public double[] SouthWestCorner { get; set; } = Array.Empty<double>();

    /// <summary>[latitude, longitude]</summary>
    public double[] NorthEastCorner { get; set; } = Array.Empty<double>();

    public DateTimeOffset StartDateTime { get; set; }

    public DateTimeOffset EndDateTime { get; set; }

    public List<TimefoldVehicle> Vehicles { get; set; } = new();

    public List<TimefoldVisit> Visits { get; set; } = new();

    public int TotalDrivingTimeSeconds { get; set; }
}

public sealed class TimefoldVehicle
{
    public string Id { get; set; } = "";

    public int Capacity { get; set; }

    /// <summary>[latitude, longitude]</summary>
    public double[] HomeLocation { get; set; } = Array.Empty<double>();

    public DateTimeOffset DepartureTime { get; set; }

    public List<TimefoldVisit> Visits { get; set; } = new();

    public int TotalDrivingTimeSeconds { get; set; }

    public DateTimeOffset ArrivalTime { get; set; }

    public int TotalDemand { get; set; }
}

public sealed class TimefoldVisit
{
    public string Id { get; set; } = "";

    public string Name { get; set; } = "";

    /// <summary>[latitude, longitude]</summary>
    public double[] Location { get; set; } = Array.Empty<double>();

    public int Demand { get; set; }

    public DateTimeOffset MinStartTime { get; set; }

    public DateTimeOffset MaxEndTime { get; set; }

    /// <summary>Service time in seconds.</summary>
    public int ServiceDuration { get; set; }

    public string? Vehicle { get; set; }

    public string? PreviousVisit { get; set; }

    public DateTimeOffset? ArrivalTime { get; set; }

    public DateTimeOffset? DepartureTime { get; set; }

    public DateTimeOffset? StartServiceTime { get; set; }

    public int? DrivingTimeSecondsFromPreviousStandstill { get; set; }
}
