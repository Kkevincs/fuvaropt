import type { MapPin } from "../components/RouteMap";
import type { RouteProblemResponse } from "../types/routeProblem";

/** `[latitude, longitude]` — matches route-plans API demo. */
export type LatLngTuple = [number, number];

export type TimefoldVisitPayload = {
  id: string;
  name: string;
  location: LatLngTuple;
  demand: number;
  minStartTime: string;
  maxEndTime: string;
  /** Service time in seconds (API expects a number, not ISO duration). */
  serviceDuration: number;
  vehicle: null;
  previousVisit: null;
  arrivalTime: null;
  departureTime: null;
  startServiceTime: null;
  drivingTimeSecondsFromPreviousStandstill: null;
};

export type TimefoldVehiclePayload = {
  id: string;
  capacity: number;
  homeLocation: LatLngTuple;
  departureTime: string;
  /** Demo keeps nested visits empty; all stops live in root `visits`. */
  visits: TimefoldVisitPayload[];
  totalDrivingTimeSeconds: number;
  arrivalTime: string;
  totalDemand: number;
};

/**
 * Wire format aligned with `/route-plans` demo (tuple coords, seconds, nulls).
 */
export type TimefoldApiPayload = {
  name: string;
  southWestCorner: LatLngTuple;
  northEastCorner: LatLngTuple;
  startDateTime: string;
  endDateTime: string;
  vehicles: TimefoldVehiclePayload[];
  visits: TimefoldVisitPayload[];
  totalDrivingTimeSeconds: number;
};

const BBOX_PADDING_RATIO = 0.05;
const BBOX_PADDING_MIN = 0.002;

/** Fixed per-vehicle capacity for testing (solver payload). */
export const VEHICLE_CAPACITY_TEST = 3;

/** Default service time at a stop (seconds), e.g. 30 minutes. */
export const DEFAULT_SERVICE_DURATION_SECONDS = 1800;

function asTuple(lat: number, lng: number): LatLngTuple {
  return [lat, lng];
}

/** Local wall time `YYYY-MM-DDTHH:mm:ss` (no timezone suffix). */
function toLocalIsoNoOffset(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function datePart(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Planning window start: today 07:30 (same idea as demo). */
function planningStartToday(): Date {
  const d = new Date();
  d.setHours(7, 30, 0, 0);
  return d;
}

/** End of horizon: next calendar day 00:00 (demo-style). */
function planningEndNextMidnight(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Build payload for external route-plans API from map pins.
 */
export function buildTimefoldApiPayload(
  _routeProblem: RouteProblemResponse,
  pins: MapPin[],
): TimefoldApiPayload {
  void _routeProblem;
  const relevant = pins.filter((p) => p.kind === "warehouse" || p.kind === "delivery");
  if (relevant.length === 0) {
    throw new Error("Place at least one warehouse or delivery pin to define the area.");
  }

  const lats = relevant.map((p) => p.lat);
  const lngs = relevant.map((p) => p.lng);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);

  const latSpan = Math.max(maxLat - minLat, 1e-9);
  const lngSpan = Math.max(maxLng - minLng, 1e-9);
  const padLat = Math.max(latSpan * BBOX_PADDING_RATIO, BBOX_PADDING_MIN);
  const padLng = Math.max(lngSpan * BBOX_PADDING_RATIO, BBOX_PADDING_MIN);
  minLat -= padLat;
  maxLat += padLat;
  minLng -= padLng;
  maxLng += padLng;

  const planStart = planningStartToday();
  const planEnd = planningEndNextMidnight();
  const startIso = toLocalIsoNoOffset(planStart);
  const endIso = toLocalIsoNoOffset(planEnd);
  const dayStr = datePart(planStart);

  const warehouses = pins.filter((p) => p.kind === "warehouse");
  const totalVehicles = warehouses.reduce((s, w) => s + (w.vehicleCount ?? 0), 0);
  if (totalVehicles <= 0) {
    throw new Error("Assign at least one vehicle across warehouses.");
  }

  let vehicleIndex = 0;
  const vehicles: TimefoldVehiclePayload[] = [];

  for (const w of warehouses) {
    const n = w.vehicleCount ?? 0;
    for (let i = 0; i < n; i++) {
      vehicleIndex += 1;
      vehicles.push({
        id: String(vehicleIndex),
        capacity: VEHICLE_CAPACITY_TEST,
        homeLocation: asTuple(w.lat, w.lng),
        departureTime: startIso,
        visits: [],
        totalDrivingTimeSeconds: 0,
        arrivalTime: startIso,
        totalDemand: 0,
      });
    }
  }

  const deliveries = pins.filter((p) => p.kind === "delivery");

  const visits: TimefoldVisitPayload[] = deliveries.map((p, i) => {
    const demand = Math.max(0, Math.min(999, Math.floor(p.demand ?? 0)));
    const morning = i % 2 === 0;
    return {
      id: String(i + 1),
      name: `Delivery ${i + 1}`,
      location: asTuple(p.lat, p.lng),
      demand,
      minStartTime: morning ? `${dayStr}T08:00:00` : `${dayStr}T13:00:00`,
      maxEndTime: morning ? `${dayStr}T12:00:00` : `${dayStr}T18:00:00`,
      serviceDuration: DEFAULT_SERVICE_DURATION_SECONDS,
      vehicle: null,
      previousVisit: null,
      arrivalTime: null,
      departureTime: null,
      startServiceTime: null,
      drivingTimeSecondsFromPreviousStandstill: null,
    };
  });

  return {
    name: "demo",
    southWestCorner: asTuple(minLat, minLng),
    northEastCorner: asTuple(maxLat, maxLng),
    startDateTime: startIso,
    endDateTime: endIso,
    vehicles,
    visits,
    totalDrivingTimeSeconds: 0,
  };
}

/**
 * Strict JSON string for APIs / Postman (no `undefined`; `null` preserved).
 */
export function serializeTimefoldPayload(payload: TimefoldApiPayload): string {
  return JSON.stringify(payload, (_key, value) => {
    if (typeof value === "number" && (!Number.isFinite(value) || Number.isNaN(value))) {
      return null;
    }
    return value;
  });
}

/** @deprecated Use buildTimefoldApiPayload */
export const buildTimefoldProblemPayload = buildTimefoldApiPayload;
export type TimefoldProblemPayload = TimefoldApiPayload;
