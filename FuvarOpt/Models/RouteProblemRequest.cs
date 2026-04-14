namespace FuvarOpt.Models;

/// <summary>Input for building route problem counts. Omitted or null values are treated as 0.</summary>
public sealed record RouteProblemRequest
{
    public int VehicleCount { get; init; }

    public int AddressCount { get; init; }

    public int WarehouseCount { get; init; }

    public int Packages { get; init; }
}
