import {
  normalizeRouteProblemResponse,
  type RouteProblemFromMessageBody,
  type RouteProblemResponse,
} from "../types/routeProblem";
import { parseOptimalRoutePlan, type OptimalRoutePlan } from "../types/optimalRoutePlan";
import { serializeTimefoldPayload, type TimefoldApiPayload } from "../lib/buildTimefoldPayload";

const defaultBase = "http://localhost:5078";

function logServerResponse(res: Response, bodyText: string): void {
  let data: unknown = bodyText;
  try {
    data = bodyText ? (JSON.parse(bodyText) as unknown) : null;
  } catch {
    /* non-JSON body */
  }
  console.log("[FuvarOpt API]", res.status, res.url, data);
}

export function getApiBaseUrl(): string {
  const v = import.meta.env.VITE_API_BASE_URL;
  return typeof v === "string" && v.length > 0 ? v.replace(/\/$/, "") : defaultBase;
}

/** Relative path: Vite dev/preview proxy forwards to localhost:8080 (avoids CORS). */
const defaultRoutePlansUrl = "/route-plans";

export function getRoutePlansUrl(): string {
  const v = import.meta.env.VITE_ROUTE_PLANS_URL;
  return typeof v === "string" && v.length > 0 ? v.replace(/\/$/, "") : defaultRoutePlansUrl;
}

export function getRoutePlanJobUrl(jobId: string): string {
  const base = getRoutePlansUrl();
  return `${base}/${encodeURIComponent(jobId)}`;
}

export function extractJobIdFromPostResponse(data: unknown): string | undefined {
  /** API may return a bare UUID string (not JSON) or a JSON string `"uuid"`. */
  if (typeof data === "string") {
    const t = data.trim();
    return t.length > 0 ? t : undefined;
  }
  if (data === null || typeof data !== "object") {
    return undefined;
  }
  const o = data as Record<string, unknown>;
  for (const k of ["jobId", "job_id", "id", "uuid"]) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) {
      return v;
    }
  }
  return undefined;
}

export async function fetchRoutePlanResult(jobId: string): Promise<OptimalRoutePlan> {
  const url = getRoutePlanJobUrl(jobId);
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    /* non-JSON */
  }
  console.log("[route-plans]", res.status, res.url, data);
  if (!res.ok) {
    let msg = text;
    if (typeof data === "object" && data !== null && "error" in data) {
      const e = (data as { error?: string }).error;
      if (typeof e === "string") {
        msg = e;
      }
    }
    throw new Error(msg || `GET route plan failed (${res.status})`);
  }
  if (data === null || data === undefined) {
    throw new Error("Empty route plan response");
  }
  return parseOptimalRoutePlan(data);
}

export async function postRouteProblemFromMessage(
  body: RouteProblemFromMessageBody,
): Promise<RouteProblemResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/route-problem/from-message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  logServerResponse(res, text);
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) {
        msg = j.error;
      }
    } catch {
      /* use raw */
    }
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return normalizeRouteProblemResponse(JSON.parse(text) as unknown);
}

/** POST final Timefold JSON to route-plans service; returns job id for GET result. */
export async function postRoutePlanJob(body: TimefoldApiPayload): Promise<string> {
  const url = getRoutePlansUrl();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: serializeTimefoldPayload(body),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    /* non-JSON */
  }
  console.log("[route-plans]", res.status, res.url, data);
  if (!res.ok) {
    let msg = text;
    if (typeof data === "object" && data !== null && "error" in data) {
      const e = (data as { error?: string }).error;
      if (typeof e === "string") {
        msg = e;
      }
    }
    throw new Error(msg || `Request failed (${res.status})`);
  }
  const jobId = extractJobIdFromPostResponse(data);
  if (jobId === undefined) {
    throw new Error("Route plan service did not return a job id");
  }
  console.log("[route-plans] job id:", jobId);
  return jobId;
}
