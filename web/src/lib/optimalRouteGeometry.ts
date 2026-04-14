import type { LatLngExpression } from "leaflet";
import type { OptimalRoutePlan } from "../types/optimalRoutePlan";

/** Distinct colors for vehicle routes (home, line, visit dots). */
export const VEHICLE_ROUTE_COLORS = [
  "#0891b2",
  "#1e293b",
  "#db2777",
  "#2563eb",
  "#ea580c",
  "#ca8a04",
  "#7c3aed",
  "#0d9488",
] as const;

export function vehicleColorForIndex(index: number): string {
  return VEHICLE_ROUTE_COLORS[((index % VEHICLE_ROUTE_COLORS.length) + VEHICLE_ROUTE_COLORS.length) % VEHICLE_ROUTE_COLORS.length];
}

export function vehicleIndexById(plan: OptimalRoutePlan, vehicleId: string): number {
  const i = plan.vehicles.findIndex((v) => v.id === vehicleId);
  return i >= 0 ? i : 0;
}

export function colorForVehicleId(plan: OptimalRoutePlan, vehicleId: string): string {
  return vehicleColorForIndex(vehicleIndexById(plan, vehicleId));
}

/** When per-visit `vehicle` is missing, infer from `vehicles[].visits` lists. */
export function vehicleIdForVisit(plan: OptimalRoutePlan, visitId: string): string | null {
  for (const v of plan.vehicles) {
    if (v.visits.includes(visitId)) {
      return v.id;
    }
  }
  return null;
}

export function buildVisitPositionLookup(
  plan: OptimalRoutePlan,
): Map<string, { lat: number; lng: number }> {
  const m = new Map<string, { lat: number; lng: number }>();
  for (const v of plan.visits) {
    const [lat, lng] = v.location;
    m.set(v.id, { lat, lng });
  }
  return m;
}

export type VehicleRoutePath = {
  vehicleId: string;
  color: string;
  /** Closed loop home → visits → home when visits non-empty. */
  positions: LatLngExpression[];
  home: [number, number];
};

/** Straight-segment path per vehicle: home → each visit id in order → home. */
export function buildVehicleRoutePaths(plan: OptimalRoutePlan): VehicleRoutePath[] {
  const lookup = buildVisitPositionLookup(plan);
  return plan.vehicles.map((veh, idx) => {
    const color = vehicleColorForIndex(idx);
    const [hLat, hLng] = veh.homeLocation;
    const home: [number, number] = [hLat, hLng];
    const positions: LatLngExpression[] = [home];

    for (const visitId of veh.visits) {
      const pt = lookup.get(visitId);
      if (pt === undefined) {
        continue;
      }
      positions.push([pt.lat, pt.lng]);
    }

    if (veh.visits.length > 0) {
      positions.push(home);
    }

    return {
      vehicleId: veh.id,
      color,
      positions,
      home,
    };
  });
}
