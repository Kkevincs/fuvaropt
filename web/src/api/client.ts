import {
  normalizeRouteProblemResponse,
  type RouteProblemFromMessageBody,
  type RouteProblemResponse,
} from "../types/routeProblem";
import { parseOptimalRoutePlan, type OptimalRoutePlan } from "../types/optimalRoutePlan";
import {
  normalizePostOptimizationSuggestions,
  type PostOptimizationSuggestionsResponse,
} from "../types/postOptimizationSuggestions";
import { serializeTimefoldPayload, type TimefoldApiPayload } from "../lib/buildTimefoldPayload";
import { serializeSchedulePayload } from "../lib/buildSchedulePayload";
import type { ScheduleExtractResponse } from "../types/scheduleExtract";
import type { SchedulePayload, ScheduleSolveResponse } from "../types/scheduleProblem";

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

/** Relative path: Vite dev/preview proxy forwards to localhost:1010 (avoids CORS). */
const defaultRoutePlansUrl = "/route-plans";

export function getRoutePlansUrl(): string {
  const v = import.meta.env.VITE_ROUTE_PLANS_URL;
  return typeof v === "string" && v.length > 0 ? v.replace(/\/$/, "") : defaultRoutePlansUrl;
}

export function getRoutePlanJobUrl(jobId: string): string {
  const base = getRoutePlansUrl();
  return `${base}/${encodeURIComponent(jobId)}`;
}

/**
 * Default `/schedules` is same-origin in dev (browser → Vite on 5173 → proxy to 8080 in vite.config.ts).
 * Calling `http://localhost:8080/schedules` from the browser hits CORS unless the 8080 app sends
 * Access-Control-Allow-Origin. Set VITE_SCHEDULES_URL to a direct URL only if that server allows your dev origin.
 */
const defaultSchedulesUrl = "/schedules";

export function getSchedulesUrl(): string {
  const v = import.meta.env.VITE_SCHEDULES_URL;
  return typeof v === "string" && v.length > 0 ? v.replace(/\/$/, "") : defaultSchedulesUrl;
}

export function getScheduleJobUrl(jobId: string): string {
  const base = getSchedulesUrl();
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

export async function fetchRoutePlanResult(
  jobId: string,
  init?: { signal?: AbortSignal },
): Promise<OptimalRoutePlan> {
  const url = getRoutePlanJobUrl(jobId);
  const res = await fetch(url, { method: "GET", signal: init?.signal });
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

export type ScheduleFromMessageBody = { message: string };

export async function postScheduleFromMessage(
  body: ScheduleFromMessageBody,
): Promise<ScheduleExtractResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/schedule/from-message`, {
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
    throw new Error(msg || `Schedule extraction failed (${res.status})`);
  }
  const parsed = JSON.parse(text) as ScheduleExtractResponse;
  console.log(
    "[Schedule extract] full JSON from /api/schedule/from-message (verify employees here)\n" +
      JSON.stringify(parsed, null, 2),
  );
  console.log(
    "[Schedule extract] employee names:",
    parsed.employees.map((e) => e.name),
    "— click Submit schedule to log [Schedule] final JSON for POST /schedules",
  );
  return parsed;
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

export async function postOptimizationSuggestions(
  optimizedRouteJson: string,
): Promise<PostOptimizationSuggestionsResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/route-problem/post-optimization-suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ optimizedRouteJson }),
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
    throw new Error(msg || `Suggestions request failed (${res.status})`);
  }
  return normalizePostOptimizationSuggestions(JSON.parse(text) as unknown);
}

export async function postScheduleOptimizationSuggestions(
  solvedScheduleJson: string,
): Promise<PostOptimizationSuggestionsResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/schedule/post-optimization-suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ solvedScheduleJson }),
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
    throw new Error(msg || `Schedule suggestions request failed (${res.status})`);
  }
  return normalizePostOptimizationSuggestions(JSON.parse(text) as unknown);
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

/** POST schedule JSON to schedules service; returns job id for GET result. */
export async function postScheduleJob(body: SchedulePayload): Promise<string> {
  const serialized = serializeSchedulePayload(body);
  console.log(
    "[Schedule POST] request body to /schedules (full payload)\n" +
      JSON.stringify(JSON.parse(serialized), null, 2),
  );
  const url = getSchedulesUrl();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: serialized,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    /* non-JSON */
  }
  console.log("[schedules POST]", res.status, res.url, data);
  if (res.ok && data !== null && typeof data === "object") {
    console.log("[Schedule POST] /schedules response\n" + JSON.stringify(data, null, 2));
  }
  if (!res.ok) {
    let msg = text;
    if (typeof data === "object" && data !== null && "error" in data) {
      const e = (data as { error?: string }).error;
      if (typeof e === "string") {
        msg = e;
      }
    }
    throw new Error(msg || `Schedule request failed (${res.status})`);
  }
  const jobId = extractJobIdFromPostResponse(data);
  if (jobId === undefined) {
    throw new Error("Schedule service did not return a job id");
  }
  console.log("[schedules] job id:", jobId);
  return jobId;
}

export async function fetchScheduleResult(
  jobId: string,
  init?: { signal?: AbortSignal },
): Promise<ScheduleSolveResponse> {
  const url = getScheduleJobUrl(jobId);
  const res = await fetch(url, { method: "GET", signal: init?.signal });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    /* non-JSON */
  }
  console.log("[schedules]", res.status, res.url, data);
  if (!res.ok) {
    let msg = text;
    if (typeof data === "object" && data !== null && "error" in data) {
      const e = (data as { error?: string }).error;
      if (typeof e === "string") {
        msg = e;
      }
    }
    throw new Error(msg || `GET schedule result failed (${res.status})`);
  }
  if (data === null || data === undefined) {
    throw new Error("Empty schedule response");
  }
  return data as ScheduleSolveResponse;
}
