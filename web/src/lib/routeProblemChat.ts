import type { RouteProblemResponse } from "../types/routeProblem";

export type MissingRouteField = "vehicles" | "warehouses" | "addresses";

/** All three counts must be positive before opening the map. */
export function isRouteProblemComplete(r: RouteProblemResponse): boolean {
  return r.vehicleCount > 0 && r.warehouseCount > 0 && r.addressCount > 0;
}

export function getMissingRouteFields(r: RouteProblemResponse): MissingRouteField[] {
  const missing: MissingRouteField[] = [];
  if (r.warehouseCount <= 0) {
    missing.push("warehouses");
  }
  if (r.addressCount <= 0) {
    missing.push("addresses");
  }
  if (r.vehicleCount <= 0) {
    missing.push("vehicles");
  }
  return missing;
}

const fieldLabels: Record<MissingRouteField, string> = {
  warehouses: "warehouses (depots / hubs)",
  addresses: "delivery addresses (customer stops, not warehouses)",
  vehicles: "vehicles (cars / fleet size)",
};

/** Assistant message when extraction left some counts at zero. */
export function buildMissingDetailsPrompt(missing: MissingRouteField[]): string {
  if (missing.length === 0) {
    return "";
  }
  const lines = missing.map((m) => `• ${fieldLabels[m]}`);
  return (
    "I don’t have a positive number yet for everything we need. Please tell me how many you need for:\n\n" +
    `${lines.join("\n")}\n\n` +
    "Reply with the missing numbers (you can send a short message like “3 addresses and 2 cars”)."
  );
}
