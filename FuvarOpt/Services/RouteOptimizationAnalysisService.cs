using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using FuvarOpt.Models;

namespace FuvarOpt.Services;

public sealed class RouteOptimizationAnalysisService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    public RouteOptimizationAnalysisResult Analyze(string optimizedRouteJson)
    {
        if (string.IsNullOrWhiteSpace(optimizedRouteJson))
        {
            throw new ArgumentException("Optimized route JSON is required.", nameof(optimizedRouteJson));
        }

        OptimizedRoutePlanDto? plan;
        try
        {
            plan = JsonSerializer.Deserialize<OptimizedRoutePlanDto>(optimizedRouteJson, JsonOptions);
        }
        catch (JsonException ex)
        {
            throw new ArgumentException("Invalid JSON: " + ex.Message, nameof(optimizedRouteJson), ex);
        }

        if (plan is null || plan.Vehicles is null || plan.Vehicles.Count == 0)
        {
            throw new ArgumentException("Optimized route must include a non-empty vehicles array.", nameof(optimizedRouteJson));
        }

        var visitLookup = BuildVisitLookup(plan.Visits);

        var totalVehicles = plan.Vehicles.Count;
        var active = plan.Vehicles.Where(v => v.Visits is not null && v.Visits.Count > 0).ToList();
        var activeVehicles = active.Count;

        var warehouseKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var v in active)
        {
            if (v.HomeLocation is { Length: >= 2 })
            {
                warehouseKeys.Add(RoundLocationKey(v.HomeLocation[0], v.HomeLocation[1]));
            }
        }

        var totalStopsAssigned = active.Sum(v => v.Visits?.Count ?? 0);

        var avgActive = activeVehicles > 0
            ? (double)totalStopsAssigned / activeVehicles
            : 0d;

        var avgAll = totalVehicles > 0
            ? (double)totalStopsAssigned / totalVehicles
            : 0d;

        var perVehicle = new List<VehicleTravelBreakdown>();
        var kmTotal = 0d;

        foreach (var veh in plan.Vehicles)
        {
            var visits = veh.Visits ?? new List<string>();
            var stopCount = visits.Count;
            var drivingSec = veh.TotalDrivingTimeSeconds ?? 0;

            var km = 0d;
            if (veh.HomeLocation is { Length: >= 2 } && stopCount > 0)
            {
                km = ComputeRouteKm(
                    veh.HomeLocation[0],
                    veh.HomeLocation[1],
                    visits,
                    visitLookup);
            }

            kmTotal += km;

            perVehicle.Add(new VehicleTravelBreakdown
            {
                VehicleId = veh.Id ?? "",
                StopCount = stopCount,
                DrivingTimeSeconds = drivingSec,
                ApproximateStraightLineRouteKm = Math.Round(km, 3),
            });
        }

        var sumDriving = perVehicle.Sum(p => p.DrivingTimeSeconds);
        if (sumDriving == 0 && plan.TotalDrivingTimeSeconds is int rootTotal && rootTotal > 0)
        {
            sumDriving = rootTotal;
        }

        return new RouteOptimizationAnalysisResult
        {
            TotalVehicles = totalVehicles,
            ActiveVehicles = activeVehicles,
            WarehousesUsed = warehouseKeys.Count,
            TotalStopsAssigned = totalStopsAssigned,
            AverageStopsPerActiveVehicle = Math.Round(avgActive, 4),
            AverageStopsPerVehicleIncludingIdle = Math.Round(avgAll, 4),
            TotalDrivingTimeSeconds = sumDriving,
            ApproximateStraightLineDistanceKmTotal = Math.Round(kmTotal, 3),
            PerVehicle = perVehicle,
        };
    }

    private static Dictionary<string, (double Lat, double Lng)> BuildVisitLookup(List<OptimizedRouteVisitDto>? visits)
    {
        var map = new Dictionary<string, (double, double)>(StringComparer.Ordinal);
        if (visits is null)
        {
            return map;
        }

        foreach (var v in visits)
        {
            if (string.IsNullOrEmpty(v.Id) || v.Location is not { Length: >= 2 })
            {
                continue;
            }

            map[v.Id] = (v.Location[0], v.Location[1]);
        }

        return map;
    }

    private static string RoundLocationKey(double lat, double lng)
    {
        var rLat = Math.Round(lat, 6, MidpointRounding.AwayFromZero);
        var rLng = Math.Round(lng, 6, MidpointRounding.AwayFromZero);
        return $"{rLat.ToString(CultureInfo.InvariantCulture)},{rLng.ToString(CultureInfo.InvariantCulture)}";
    }

    /// <summary>Home → each visit in order → home; straight-line segments (km).</summary>
    private static double ComputeRouteKm(
        double homeLat,
        double homeLng,
        List<string> visitIds,
        IReadOnlyDictionary<string, (double Lat, double Lng)> lookup)
    {
        var pts = new List<(double Lat, double Lng)> { (homeLat, homeLng) };
        foreach (var id in visitIds)
        {
            if (lookup.TryGetValue(id, out var coord))
            {
                pts.Add(coord);
            }
        }

        pts.Add((homeLat, homeLng));

        var sum = 0d;
        for (var i = 1; i < pts.Count; i++)
        {
            var a = pts[i - 1];
            var b = pts[i];
            sum += HaversineKm(a.Lat, a.Lng, b.Lat, b.Lng);
        }

        return sum;
    }

    private static double HaversineKm(double lat1, double lon1, double lat2, double lon2)
    {
        const double EarthRadiusKm = 6371.0;
        const double DegToRad = Math.PI / 180.0;
        var dLat = (lat2 - lat1) * DegToRad;
        var dLon = (lon2 - lon1) * DegToRad;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
            + Math.Cos(lat1 * DegToRad) * Math.Cos(lat2 * DegToRad) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        var c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
        return EarthRadiusKm * c;
    }
}
