using System;
using FuvarOpt.Models;

namespace FuvarOpt.Services;

public static class RouteProblemBuilder
{
    public static RouteProblemResponse FromCounts(
        int vehicleCount = 0,
        int addressCount = 0,
        int warehouseCount = 0,
        int packageCount = 0)
    {
        if (vehicleCount < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(vehicleCount), vehicleCount, "vehicleCount cannot be negative.");
        }

        if (addressCount < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(addressCount), addressCount, "addressCount cannot be negative.");
        }

        if (warehouseCount < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(warehouseCount), warehouseCount, "warehouseCount cannot be negative.");
        }

        if (packageCount < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(packageCount), packageCount, "packageCount cannot be negative.");
        }

        return new RouteProblemResponse(vehicleCount, addressCount, warehouseCount, packageCount);
    }
}
