import type { OptimalRoutePlan } from "../types/optimalRoutePlan";

export type VehicleTravelBreakdown = {
  vehicleId: string;
  stopCount: number;
  drivingTimeSeconds: number;
  approximateStraightLineRouteKm: number;
};

export type RouteOptimizationAnalysisResult = {
  totalVehicles: number;
  activeVehicles: number;
  warehousesUsed: number;
  totalStopsAssigned: number;
  averageStopsPerActiveVehicle: number;
  averageStopsPerVehicleIncludingIdle: number;
  totalDrivingTimeSeconds: number;
  travelMetricNote: string;
  approximateStraightLineDistanceKmTotal: number;
  perVehicle: VehicleTravelBreakdown[];
};

function roundLocationKey(lat: number, lng: number): string {
  const rLat = Math.round(lat * 1e6) / 1e6;
  const rLng = Math.round(lng * 1e6) / 1e6;
  return `${rLat},${rLng}`;
}

function buildVisitLookup(
  visits: OptimalRoutePlan["visits"],
): Map<string, { lat: number; lng: number }> {
  const m = new Map<string, { lat: number; lng: number }>();
  for (const v of visits) {
    if (v.location?.length === 2) {
      m.set(v.id, { lat: v.location[0], lng: v.location[1] });
    }
  }
  return m;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusKm = 6371;
  const degToRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * degToRad;
  const dLon = (lon2 - lon1) * degToRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * degToRad) * Math.cos(lat2 * degToRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function computeRouteKm(
  homeLat: number,
  homeLng: number,
  visitIds: string[],
  lookup: Map<string, { lat: number; lng: number }>,
): number {
  const pts: { lat: number; lng: number }[] = [{ lat: homeLat, lng: homeLng }];
  for (const id of visitIds) {
    const p = lookup.get(id);
    if (p) {
      pts.push(p);
    }
  }
  pts.push({ lat: homeLat, lng: homeLng });
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    sum += haversineKm(a.lat, a.lng, b.lat, b.lng);
  }
  return sum;
}

/** Mirrors FuvarOpt RouteOptimizationAnalysisService.Analyze (same metrics as MCP tool). */
export function analyzeOptimalRoutePlan(plan: OptimalRoutePlan): RouteOptimizationAnalysisResult {
  const visitLookup = buildVisitLookup(plan.visits);
  const totalVehicles = plan.vehicles.length;
  const active = plan.vehicles.filter((v) => (v.visits?.length ?? 0) > 0);
  const activeVehicles = active.length;

  const warehouseKeys = new Set<string>();
  for (const v of active) {
    const h = v.homeLocation;
    if (h?.length === 2) {
      warehouseKeys.add(roundLocationKey(h[0], h[1]));
    }
  }

  const totalStopsAssigned = active.reduce((s, v) => s + (v.visits?.length ?? 0), 0);

  const avgActive = activeVehicles > 0 ? totalStopsAssigned / activeVehicles : 0;
  const avgAll = totalVehicles > 0 ? totalStopsAssigned / totalVehicles : 0;

  const perVehicle: VehicleTravelBreakdown[] = [];
  let kmTotal = 0;

  for (const veh of plan.vehicles) {
    const visits = veh.visits ?? [];
    const stopCount = visits.length;
    const drivingSec = veh.totalDrivingTimeSeconds ?? 0;
    let km = 0;
    const h = veh.homeLocation;
    if (h?.length === 2 && stopCount > 0) {
      km = computeRouteKm(h[0], h[1], visits, visitLookup);
    }
    kmTotal += km;
    perVehicle.push({
      vehicleId: veh.id,
      stopCount,
      drivingTimeSeconds: drivingSec,
      approximateStraightLineRouteKm: Math.round(km * 1000) / 1000,
    });
  }

  let sumDriving = perVehicle.reduce((s, p) => s + p.drivingTimeSeconds, 0);
  if (sumDriving === 0 && (plan.totalDrivingTimeSeconds ?? 0) > 0) {
    sumDriving = plan.totalDrivingTimeSeconds ?? 0;
  }

  return {
    totalVehicles,
    activeVehicles,
    warehousesUsed: warehouseKeys.size,
    totalStopsAssigned,
    averageStopsPerActiveVehicle: Math.round(avgActive * 1e4) / 1e4,
    averageStopsPerVehicleIncludingIdle: Math.round(avgAll * 1e4) / 1e4,
    totalDrivingTimeSeconds: sumDriving,
    travelMetricNote:
      "Driving times are solver estimates in seconds, not GPS road distance. Kilometres are straight-line (Haversine) along the route order.",
    approximateStraightLineDistanceKmTotal: Math.round(kmTotal * 1000) / 1000,
    perVehicle,
  };
}
