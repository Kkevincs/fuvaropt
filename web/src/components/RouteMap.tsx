import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { OptimalRoutePlan } from "../types/optimalRoutePlan";
import {
  buildVehicleRoutePaths,
  colorForVehicleId,
  vehicleIdForVisit,
} from "../lib/optimalRouteGeometry";

export type MapPinKind = "warehouse" | "delivery" | "start" | "end";

export type MapPin = {
  id: string;
  kind: MapPinKind;
  lat: number;
  lng: number;
  /** Cars / vehicles based at this warehouse (only meaningful when kind === "warehouse"). */
  vehicleCount?: number;
  /** Packages to deliver at this stop (only meaningful when kind === "delivery"). */
  demand?: number;
};

const defaultCenter: [number, number] = [47.4979, 19.0402];
const defaultZoom = 7;

const pinColors: Record<MapPinKind, string> = {
  warehouse: "#3b82f6",
  delivery: "#10b981",
  start: "#f59e0b",
  end: "#f43f5e",
};

function makeDivIcon(color: string) {
  return L.divIcon({
    className: "fuvar-leaflet-pin",
    html: `<div class="fuvar-dot" style="background:${color}"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

/** Avoid NaN on badges when count is missing or invalid (NaN is not replaced by ??). */
function badgeCount(value: unknown): number {
  const x = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(x)) {
    return 0;
  }
  return Math.max(0, Math.min(999, Math.floor(x)));
}

function makeWarehouseIcon(vehicleCount: number) {
  const n = badgeCount(vehicleCount);
  return L.divIcon({
    className: "fuvar-leaflet-pin fuvar-warehouse-pin",
    html: `<div class="fuvar-warehouse-marker">
      <div class="fuvar-dot" style="background:${pinColors.warehouse}"></div>
      <span class="fuvar-warehouse-badge">${n}</span>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function makeDeliveryIcon(demand: number) {
  const n = badgeCount(demand);
  return L.divIcon({
    className: "fuvar-leaflet-pin fuvar-delivery-pin",
    html: `<div class="fuvar-delivery-marker">
      <div class="fuvar-dot" style="background:${pinColors.delivery}"></div>
      <span class="fuvar-delivery-badge">${n}</span>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FitBounds({
  southWest,
  northEast,
}: {
  southWest: [number, number];
  northEast: [number, number];
}) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds([southWest, northEast], { padding: [28, 28], maxZoom: 16 });
  }, [map, southWest, northEast]);
  return null;
}

function makeSolutionHomeIcon(color: string) {
  return L.divIcon({
    className: "fuvar-leaflet-pin fuvar-solution-home-wrap",
    html: `<div class="fuvar-solution-home" style="color:${color}">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
      </svg>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function makeSolutionVisitIcon(color: string) {
  return L.divIcon({
    className: "fuvar-leaflet-pin",
    html: `<div class="fuvar-solution-visit" style="background:${color}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

type RouteMapProps = {
  pins: MapPin[];
  onAddPin: (lat: number, lng: number) => void;
  onPinClick?: (pin: MapPin) => void;
  /** When set, shows optimized routes and disables adding pins. */
  solution?: OptimalRoutePlan | null;
};

export function RouteMap({ pins, onAddPin, onPinClick, solution = null }: RouteMapProps) {
  const icons = useMemo(
    () => ({
      warehouse: makeDivIcon(pinColors.warehouse),
      delivery: makeDivIcon(pinColors.delivery),
      start: makeDivIcon(pinColors.start),
      end: makeDivIcon(pinColors.end),
    }),
    [],
  );

  const solutionPaths = useMemo(
    () => (solution !== null ? buildVehicleRoutePaths(solution) : []),
    [solution],
  );

  const showSolution = solution !== null;

  return (
    <div className="flex h-[min(55vh,520px)] min-h-[280px] w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 ring-1 ring-white/5">
      <div className="relative flex min-h-0 flex-1 flex-col [&_.leaflet-container]:h-full [&_.leaflet-container]:min-h-0 [&_.leaflet-container]:w-full [&_.leaflet-container]:rounded-2xl">
        <MapContainer
          center={defaultCenter}
          zoom={defaultZoom}
          className="isolate z-0 h-full min-h-0 w-full flex-1 rounded-2xl"
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {showSolution && solution !== null && (
            <FitBounds southWest={solution.southWestCorner} northEast={solution.northEastCorner} />
          )}
          {!showSolution && <MapClickHandler onClick={onAddPin} />}
          {showSolution &&
            solutionPaths.map((path) => {
              if (path.positions.length < 2) {
                return null;
              }
              return (
                <Polyline
                  key={`line-${path.vehicleId}`}
                  positions={path.positions}
                  pathOptions={{
                    color: path.color,
                    weight: 4,
                    opacity: 0.88,
                    lineJoin: "round",
                  }}
                />
              );
            })}
          {showSolution &&
            solution !== null &&
            solution.vehicles.map((v) => {
              const [lat, lng] = v.homeLocation;
              const path = solutionPaths.find((p) => p.vehicleId === v.id);
              const color = path?.color ?? "#64748b";
              return (
                <Marker
                  key={`home-${v.id}`}
                  position={[lat, lng]}
                  icon={makeSolutionHomeIcon(color)}
                />
              );
            })}
          {showSolution &&
            solution !== null &&
            solution.visits.map((visit) => {
              const [lat, lng] = visit.location;
              const vid =
                typeof visit.vehicle === "string" && visit.vehicle.length > 0
                  ? visit.vehicle
                  : vehicleIdForVisit(solution, visit.id);
              const color =
                vid !== null && vid.length > 0
                  ? colorForVehicleId(solution, vid)
                  : "#64748b";
              return (
                <Marker
                  key={`visit-${visit.id}`}
                  position={[lat, lng]}
                  icon={makeSolutionVisitIcon(color)}
                />
              );
            })}
          {!showSolution &&
            pins.map((p) => {
              const icon =
                p.kind === "warehouse"
                  ? makeWarehouseIcon(p.vehicleCount ?? 0)
                  : p.kind === "delivery"
                    ? makeDeliveryIcon(p.demand ?? 0)
                    : icons[p.kind];
              return (
                <Marker
                  key={p.id}
                  position={[p.lat, p.lng]}
                  icon={icon}
                  eventHandlers={
                    onPinClick
                      ? {
                          click: () => {
                            onPinClick(p);
                          },
                        }
                      : undefined
                  }
                />
              );
            })}
        </MapContainer>
      </div>
    </div>
  );
}

export const pinKindLabels: Record<MapPinKind, string> = {
  warehouse: "Warehouse",
  delivery: "Delivery address",
  start: "Start zone",
  end: "End zone",
};

export { pinColors };
