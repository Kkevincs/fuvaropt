using FuvarOpt.Services;
using Xunit;

namespace FuvarOpt.Tests;

public sealed class RouteOptimizationAnalysisServiceTests
{
    private const string SampleOptimizedJson =
        """
        {
            "name": "demo",
            "southWestCorner": [47.49247256734881, 19.03417382049561],
            "northEastCorner": [47.50319926381542, 19.05081238937378],
            "startDateTime": "2026-04-14T07:30:00",
            "endDateTime": "2026-04-15T00:00:00",
            "vehicles": [
                {
                    "id": "1",
                    "capacity": 3,
                    "homeLocation": [47.49745909499436, 19.037826061248783],
                    "departureTime": "2026-04-14T07:30:00",
                    "visits": ["3", "1", "2"],
                    "totalDrivingTimeSeconds": 114,
                    "arrivalTime": "2026-04-14T13:30:14",
                    "totalDemand": 3
                },
                {
                    "id": "2",
                    "capacity": 3,
                    "homeLocation": [47.49745909499436, 19.037826061248783],
                    "departureTime": "2026-04-14T07:30:00",
                    "visits": [],
                    "totalDrivingTimeSeconds": 0,
                    "arrivalTime": "2026-04-14T07:30:00",
                    "totalDemand": 0
                },
                {
                    "id": "3",
                    "capacity": 3,
                    "homeLocation": [47.499401696551544, 19.048812389373783],
                    "departureTime": "2026-04-14T07:30:00",
                    "visits": [],
                    "totalDrivingTimeSeconds": 0,
                    "arrivalTime": "2026-04-14T07:30:00",
                    "totalDemand": 0
                }
            ],
            "visits": [
                {
                    "id": "1",
                    "name": "Delivery 1",
                    "location": [47.501199263815415, 19.03814792633057],
                    "demand": 1
                },
                {
                    "id": "2",
                    "name": "Delivery 2",
                    "location": [47.49887981065674, 19.03617382049561],
                    "demand": 1
                },
                {
                    "id": "3",
                    "name": "Delivery 3",
                    "location": [47.494472567348815, 19.039349555969242],
                    "demand": 1
                }
            ],
            "totalDrivingTimeSeconds": 114
        }
        """;

    [Fact]
    public void Analyze_sample_plan_matches_expected_metrics()
    {
        var svc = new RouteOptimizationAnalysisService();
        var r = svc.Analyze(SampleOptimizedJson);

        Assert.Equal(3, r.TotalVehicles);
        Assert.Equal(1, r.ActiveVehicles);
        Assert.Equal(1, r.WarehousesUsed);
        Assert.Equal(3, r.TotalStopsAssigned);
        Assert.Equal(3.0, r.AverageStopsPerActiveVehicle);
        Assert.Equal(1.0, r.AverageStopsPerVehicleIncludingIdle);
        Assert.Equal(114, r.TotalDrivingTimeSeconds);
        Assert.Single(r.PerVehicle.Where(p => p.VehicleId == "1" && p.StopCount == 3 && p.DrivingTimeSeconds == 114));
        Assert.True(r.ApproximateStraightLineDistanceKmTotal > 0);
    }

    [Fact]
    public void Analyze_throws_on_empty_json()
    {
        var svc = new RouteOptimizationAnalysisService();
        Assert.Throws<ArgumentException>(() => svc.Analyze("   "));
    }
}
