/** Matches backend RouteProblemResponse (camelCase JSON). */
export type RouteProblemResponse = {
  vehicleCount: number;
  addressCount: number;
  warehouseCount: number;
  packages: number;
};

function parseIntNonNeg(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(0, Math.floor(v));
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n)) {
      return Math.max(0, n);
    }
  }
  return 0;
}

/** Accept camelCase or PascalCase keys from the API (avoids silent 0s if casing mismatches). */
export function normalizeRouteProblemResponse(raw: unknown): RouteProblemResponse {
  if (raw === null || typeof raw !== "object") {
    return { vehicleCount: 0, addressCount: 0, warehouseCount: 0, packages: 0 };
  }
  const o = raw as Record<string, unknown>;
  const pick = (camel: string, pascal: string): number => {
    if (camel in o) {
      return parseIntNonNeg(o[camel]);
    }
    if (pascal in o) {
      return parseIntNonNeg(o[pascal]);
    }
    const lowerCamel = camel.toLowerCase();
    for (const key of Object.keys(o)) {
      if (key.toLowerCase() === lowerCamel) {
        return parseIntNonNeg(o[key]);
      }
    }
    return 0;
  };
  return {
    vehicleCount: pick("vehicleCount", "VehicleCount"),
    addressCount: pick("addressCount", "AddressCount"),
    warehouseCount: pick("warehouseCount", "WarehouseCount"),
    packages: pick("packages", "Packages"),
  };
}

export type RouteProblemFromMessageBody = {
  message: string;
};
