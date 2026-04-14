/** `[latitude, longitude]` — matches route-plans API. */
export type LatLngTuple = [number, number];

export type OptimalRouteVisit = {
  id: string;
  name: string;
  location: LatLngTuple;
  demand: number;
  minStartTime?: string;
  maxEndTime?: string;
  serviceDuration?: number;
  vehicle?: string | null;
  previousVisit?: string | null;
  arrivalTime?: string;
  departureTime?: string;
  startServiceTime?: string;
  drivingTimeSecondsFromPreviousStandstill?: number;
};

export type OptimalRouteVehicle = {
  id: string;
  capacity: number;
  homeLocation: LatLngTuple;
  departureTime?: string;
  visits: string[];
  totalDrivingTimeSeconds?: number;
  arrivalTime?: string;
  totalDemand?: number;
};

export type OptimalRoutePlan = {
  name: string;
  southWestCorner: LatLngTuple;
  northEastCorner: LatLngTuple;
  startDateTime: string;
  endDateTime: string;
  vehicles: OptimalRouteVehicle[];
  visits: OptimalRouteVisit[];
  score?: string;
  solverStatus?: string;
  scoreExplanation?: string;
  totalDrivingTimeSeconds?: number;
};

function isLatLngTuple(v: unknown): v is LatLngTuple {
  if (!Array.isArray(v) || v.length !== 2) {
    return false;
  }
  return typeof v[0] === "number" && typeof v[1] === "number";
}

function parseVisit(raw: unknown): OptimalRouteVisit | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const id = o.id;
  const name = o.name;
  const location = o.location;
  const demand = o.demand;
  if (typeof id !== "string" || typeof name !== "string" || !isLatLngTuple(location)) {
    return null;
  }
  return {
    id,
    name,
    location,
    demand: typeof demand === "number" ? demand : Number(demand) || 0,
    minStartTime: typeof o.minStartTime === "string" ? o.minStartTime : undefined,
    maxEndTime: typeof o.maxEndTime === "string" ? o.maxEndTime : undefined,
    serviceDuration: typeof o.serviceDuration === "number" ? o.serviceDuration : undefined,
    vehicle: typeof o.vehicle === "string" ? o.vehicle : o.vehicle === null ? null : undefined,
    previousVisit:
      typeof o.previousVisit === "string" ? o.previousVisit : o.previousVisit === null ? null : undefined,
    arrivalTime: typeof o.arrivalTime === "string" ? o.arrivalTime : undefined,
    departureTime: typeof o.departureTime === "string" ? o.departureTime : undefined,
    startServiceTime: typeof o.startServiceTime === "string" ? o.startServiceTime : undefined,
    drivingTimeSecondsFromPreviousStandstill:
      typeof o.drivingTimeSecondsFromPreviousStandstill === "number"
        ? o.drivingTimeSecondsFromPreviousStandstill
        : undefined,
  };
}

function parseVehicle(raw: unknown): OptimalRouteVehicle | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const id = o.id;
  const homeLocation = o.homeLocation;
  if (typeof id !== "string" || !isLatLngTuple(homeLocation)) {
    return null;
  }
  const visitsRaw = o.visits;
  const visits: string[] = Array.isArray(visitsRaw)
    ? visitsRaw.filter((x): x is string => typeof x === "string")
    : [];
  const capacity = o.capacity;
  return {
    id,
    capacity: typeof capacity === "number" ? capacity : Number(capacity) || 0,
    homeLocation,
    departureTime: typeof o.departureTime === "string" ? o.departureTime : undefined,
    visits,
    totalDrivingTimeSeconds:
      typeof o.totalDrivingTimeSeconds === "number" ? o.totalDrivingTimeSeconds : undefined,
    arrivalTime: typeof o.arrivalTime === "string" ? o.arrivalTime : undefined,
    totalDemand: typeof o.totalDemand === "number" ? o.totalDemand : undefined,
  };
}

/** Parse and validate minimal shape required for map display. */
export function parseOptimalRoutePlan(data: unknown): OptimalRoutePlan {
  if (data === null || typeof data !== "object") {
    throw new Error("Invalid route plan: expected object");
  }
  const o = data as Record<string, unknown>;
  const name = o.name;
  const southWestCorner = o.southWestCorner;
  const northEastCorner = o.northEastCorner;
  const startDateTime = o.startDateTime;
  const endDateTime = o.endDateTime;
  const vehiclesRaw = o.vehicles;
  const visitsRaw = o.visits;

  if (
    typeof name !== "string" ||
    !isLatLngTuple(southWestCorner) ||
    !isLatLngTuple(northEastCorner) ||
    typeof startDateTime !== "string" ||
    typeof endDateTime !== "string" ||
    !Array.isArray(vehiclesRaw) ||
    !Array.isArray(visitsRaw)
  ) {
    throw new Error("Invalid route plan: missing required fields");
  }

  const vehicles = vehiclesRaw.map(parseVehicle).filter((v): v is OptimalRouteVehicle => v !== null);
  const visits = visitsRaw.map(parseVisit).filter((v): v is OptimalRouteVisit => v !== null);

  if (vehicles.length === 0) {
    throw new Error("Invalid route plan: no vehicles");
  }

  return {
    name,
    southWestCorner,
    northEastCorner,
    startDateTime,
    endDateTime,
    vehicles,
    visits,
    score: typeof o.score === "string" ? o.score : undefined,
    solverStatus: typeof o.solverStatus === "string" ? o.solverStatus : undefined,
    scoreExplanation: typeof o.scoreExplanation === "string" ? o.scoreExplanation : undefined,
    totalDrivingTimeSeconds:
      typeof o.totalDrivingTimeSeconds === "number" ? o.totalDrivingTimeSeconds : undefined,
  };
}
