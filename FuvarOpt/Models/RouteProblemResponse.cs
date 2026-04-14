namespace FuvarOpt.Models;

public sealed record RouteProblemResponse(
    int VehicleCount,
    int AddressCount,
    int WarehouseCount,
    int Packages);
