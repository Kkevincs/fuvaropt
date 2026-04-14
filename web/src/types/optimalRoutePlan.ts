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

function pickVisitId(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) {
    return v;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return null;
}

/** API may use camelCase or PascalCase; some fields use numeric ids in JSON. */
function parseVisit(raw: unknown): OptimalRouteVisit | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const idRaw = o.id ?? o.Id;
  const nameRaw = o.name ?? o.Name;
  const location = o.location ?? o.Location;
  const demand = o.demand ?? o.Demand;
  const id = pickVisitId(idRaw);
  const name = typeof nameRaw === "string" ? nameRaw : nameRaw != null ? String(nameRaw) : "";
  if (id === null || name === "" || !isLatLngTuple(location)) {
    return null;
  }
  const vehicleRaw = o.vehicle ?? o.Vehicle;
  let vehicle: string | null | undefined;
  if (vehicleRaw === null) {
    vehicle = null;
  } else if (typeof vehicleRaw === "string") {
    vehicle = vehicleRaw;
  } else if (typeof vehicleRaw === "number" && Number.isFinite(vehicleRaw)) {
    vehicle = String(vehicleRaw);
  } else {
    vehicle = undefined;
  }
  const prevRaw = o.previousVisit ?? o.PreviousVisit;
  let previousVisit: string | null | undefined;
  if (prevRaw === null) {
    previousVisit = null;
  } else if (typeof prevRaw === "string") {
    previousVisit = prevRaw;
  } else if (typeof prevRaw === "number" && Number.isFinite(prevRaw)) {
    previousVisit = String(prevRaw);
  } else {
    previousVisit = undefined;
  }
  return {
    id,
    name,
    location,
    demand: typeof demand === "number" ? demand : Number(demand) || 0,
    minStartTime:
      typeof o.minStartTime === "string"
        ? o.minStartTime
        : typeof o.MinStartTime === "string"
          ? o.MinStartTime
          : undefined,
    maxEndTime:
      typeof o.maxEndTime === "string"
        ? o.maxEndTime
        : typeof o.MaxEndTime === "string"
          ? o.MaxEndTime
          : undefined,
    serviceDuration:
      typeof o.serviceDuration === "number"
        ? o.serviceDuration
        : typeof o.ServiceDuration === "number"
          ? o.ServiceDuration
          : undefined,
    vehicle,
    previousVisit,
    arrivalTime:
      typeof o.arrivalTime === "string"
        ? o.arrivalTime
        : typeof o.ArrivalTime === "string"
          ? o.ArrivalTime
          : undefined,
    departureTime:
      typeof o.departureTime === "string"
        ? o.departureTime
        : typeof o.DepartureTime === "string"
          ? o.DepartureTime
          : undefined,
    startServiceTime:
      typeof o.startServiceTime === "string"
        ? o.startServiceTime
        : typeof o.StartServiceTime === "string"
          ? o.StartServiceTime
          : undefined,
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
  const idRaw = o.id ?? o.Id;
  const id = typeof idRaw === "string" ? idRaw : pickVisitId(idRaw);
  const homeLocation = o.homeLocation ?? o.HomeLocation;
  if (id === null || !isLatLngTuple(homeLocation)) {
    return null;
  }
  const visitsRaw = o.visits ?? o.Visits;
  const visits: string[] = Array.isArray(visitsRaw)
    ? visitsRaw.map((x) => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "")).filter((x) => x.length > 0)
    : [];
  const capacity = o.capacity ?? o.Capacity;
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
