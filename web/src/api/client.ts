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
import type { ScheduleDayMode } from "../lib/scheduleProblemChat";
import { enrichSolveWithConstraints } from "../lib/scheduleConstraintDisplay";
import {
  safeJsonStringifyFlightsServiceProblemPost,
  safeJsonStringifyServiceProblemPost,
  schedulePlanningToFlightsServicePostBody,
  schedulePlanningToServiceProblemPostBody,
} from "../lib/schedulePlanningToShiftApiBody";
import { sanitizeSchedulePlanningPayloadForService } from "../lib/sanitizeSchedulePlanningPayload";
import { convertSolvedScheduleToLegacyJson } from "../lib/scheduleSolveToLegacyJson";
import { tryNormalizeScheduleSolveFromApi } from "../lib/scheduleSolveNormalize";
import type { ScheduleExtractResponse, SchedulePlanningPayload } from "../types/scheduleExtract";
import type { SchedulePayload, ScheduleSolveResponse } from "../types/scheduleProblem";
import type { ScheduleProblemSolveResponse } from "../types/scheduleProblemSolve";

const defaultBase = "http://localhost:5078";

/** Pretty-prints the exact JSON string sent in `fetch` (dev / `npm run dev` only). */
function devLogOutgoingJson(label: string, jsonBody: string): void {
  if (!import.meta.env.DEV) {
    return;
  }
  try {
    const parsed: unknown = JSON.parse(jsonBody);
    console.log(`[FuvarOpt] ${label}\n${JSON.stringify(parsed, null, 2)}`);
  } catch {
    console.log(`[FuvarOpt] ${label} (non-JSON body)\n`, jsonBody);
  }
}

function devLogLegacyOptimizedSchedule(result: ScheduleProblemSolveResponse): void {
  if (!import.meta.env.DEV) {
    return;
  }
  const legacy = convertSolvedScheduleToLegacyJson(result);
  console.log(`[FuvarOpt] Optimized plan (request-shaped JSON: employees, shifts; scores stay in the solve response)\n${JSON.stringify(legacy, null, 2)}`);
}

/** Same base as `POST /schedules/problem` (e.g. Vite dev → proxy to 8081). */
function getScheduleAnalyzeUrl(): string {
  return `${getScheduleProblemServiceBaseUrl()}/schedules/analyze?fetchPolicy=${encodeURIComponent("FETCH_MATCH_COUNT")}`;
}

/**
 * `PUT` employees+shifts to `/schedules/analyze` (constraint match / causes). Returns parsed JSON or `null` on failure.
 * Logs the response to the console on success.
 */
export async function putScheduleProblemAnalyze(
  solved: ScheduleProblemSolveResponse,
): Promise<unknown | null> {
  const body = convertSolvedScheduleToLegacyJson(solved);
  const jsonBody = JSON.stringify(body, (_key, value) => {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === "number" && (!Number.isFinite(value) || Number.isNaN(value))) {
      return 0;
    }
    return value;
  });
  const url = getScheduleAnalyzeUrl();
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: jsonBody,
    });
    const text = await res.text();
    if (!res.ok) {
      console.warn(`[FuvarOpt] PUT schedules/analyze failed: ${res.status}`, text.slice(0, 2000));
      return null;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      console.log(`[FuvarOpt] PUT schedules/analyze response (${res.status}): (empty body)`);
      return null;
    }
    try {
      const data: unknown = JSON.parse(trimmed);
      console.log(
        `[FuvarOpt] PUT schedules/analyze response (${res.status}):\n${JSON.stringify(data, null, 2)}`,
      );
      return data;
    } catch {
      console.log(`[FuvarOpt] PUT schedules/analyze response (${res.status}, non-JSON):\n${text}`);
      return null;
    }
  } catch (err: unknown) {
    console.warn("[FuvarOpt] PUT schedules/analyze request failed", err);
    return null;
  }
}

export type ScheduleSolveInsightsPayload = { suggestions: string[]; error: string | null };

type ScheduleSolveInsightsListener = (p: ScheduleSolveInsightsPayload) => void;

let scheduleSolveInsightsListener: ScheduleSolveInsightsListener | null = null;

/** Subscribes to AI fix suggestions (hard constraints first) after a successful solve. Returns unsubscribe. */
export function subscribeScheduleSolveInsights(listener: ScheduleSolveInsightsListener | null): void {
  scheduleSolveInsightsListener = listener;
}

async function onScheduleSolved(solved: ScheduleProblemSolveResponse): Promise<void> {
  devLogLegacyOptimizedSchedule(solved);
  const analyze = await putScheduleProblemAnalyze(solved);
  let analyzeString: string | undefined;
  if (analyze != null) {
    try {
      analyzeString = JSON.stringify(analyze);
    } catch {
      analyzeString = undefined;
    }
  }
  try {
    const ins = await postScheduleOptimizationSuggestions(JSON.stringify(solved), analyzeString);
    scheduleSolveInsightsListener?.({ suggestions: ins.suggestions, error: null });
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : "Could not load constraint fix suggestions. Check FuvarOpt and Gemini configuration.";
    scheduleSolveInsightsListener?.({ suggestions: [], error: msg });
  }
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

/**
 * Schedule planning service: POST {base}/schedules/problem (returns job id, then GET {base}/schedules/{jobId})
 * or POST .../multi-day (may return the solved plan JSON in the POST response with no job id).
 *
 * **Default (no env):** same-origin `/schedule-solver` so Vite can proxy to `http://localhost:8081`
 * without browser CORS (see `vite.config.ts`). Effective upstream path is still `/schedules/problem`, etc.
 *
 * **Override:** set `VITE_SCHEDULE_PROBLEM_BASE_URL` to a full origin (e.g. `http://localhost:8081`) only
 * if the API sends `Access-Control-Allow-Origin` for your dev origin, or for production.
 */
export function getScheduleProblemServiceBaseUrl(): string {
  const v = import.meta.env.VITE_SCHEDULE_PROBLEM_BASE_URL;
  if (typeof v === "string" && v.length > 0) {
    return v.replace(/\/$/, "");
  }
  return "/schedule-solver";
}

function scheduleProblemPath(dayMode: ScheduleDayMode): string {
  return dayMode === "multi" ? "/schedules/problem/multi-day" : "/schedules/problem";
}

/** Single-day API returns a job id and expects GET /schedules/{id}. Multi-day often returns the solved plan JSON in the POST body. */
export type PostScheduleProblemResult =
  | { kind: "job"; jobId: string }
  | { kind: "solved"; solved: ScheduleProblemSolveResponse };

/** Parse body from schedule service; supports double-encoded JSON strings. */
function parseScheduleServiceResponseText(text: string): unknown {
  const t = text.trim();
  if (t.length === 0) {
    return null;
  }
  try {
    const v = JSON.parse(t) as unknown;
    if (typeof v === "string") {
      const t2 = v.trim();
      if (t2.startsWith("{") || t2.startsWith("[")) {
        try {
          return JSON.parse(t2) as unknown;
        } catch {
          return v;
        }
      }
    }
    return v;
  } catch {
    return text;
  }
}

export type PostScheduleProblemOptions = {
  /**
   * `false` (default): POST **employees** + **flights** (same as extract / first analysis).
   * `true`: POST **employees** + **shifts** — only for **single-day** runs (after a successful solve, roster re-optimize).
   * **Multi-day** always uses `flights` wire; the service does not accept `shifts` on that path.
   */
  useShiftsWire?: boolean;
};

export async function postScheduleProblem(
  body: SchedulePlanningPayload,
  dayMode: ScheduleDayMode = "single",
  options: PostScheduleProblemOptions = {},
): Promise<PostScheduleProblemResult> {
  /**
   * Multi-day (`POST .../schedules/problem/multi-day`) DTOs expect `employees` + `flights` (coverage).
   * Sending `shifts` there causes 400 "Not able to deserialize" on typical Java services.
   * Single-day may accept the expanded `shifts` body after a first solve.
   */
  const useShiftsWire = options.useShiftsWire === true && dayMode === "single";
  const base = getScheduleProblemServiceBaseUrl();
  const path = scheduleProblemPath(dayMode);
  const url = `${base}${path}`;
  const payload = sanitizeSchedulePlanningPayloadForService(body);
  const requestBody = useShiftsWire
    ? safeJsonStringifyServiceProblemPost(schedulePlanningToServiceProblemPostBody(payload))
    : safeJsonStringifyFlightsServiceProblemPost(schedulePlanningToFlightsServicePostBody(payload));
  const wireLabel = useShiftsWire ? "shifts" : "flights";
  devLogOutgoingJson(`POST ${path} (schedule problem, ${dayMode}, ${wireLabel} wire)`, requestBody);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: requestBody,
  });
  const text = await res.text();
  const data: unknown = parseScheduleServiceResponseText(text);
  if (!res.ok) {
    let msg = text;
    if (typeof data === "object" && data !== null && "error" in data) {
      const e = (data as { error?: string }).error;
      if (typeof e === "string") {
        msg = e;
      }
    }
    throw new Error(msg || `POST ${path} failed (${res.status})`);
  }
  /** Prefer a full solve payload over `id` / `jobId` — multi-day often returns `{ id, employees, flights }`. */
  const solved = tryNormalizeScheduleSolveFromApi(data);
  if (solved !== null) {
    const enriched = enrichSolveWithConstraints(data, solved);
    void onScheduleSolved(enriched);
    return { kind: "solved", solved: enriched };
  }
  const jobId = extractJobIdFromPostResponse(data);
  if (jobId !== undefined) {
    return { kind: "job", jobId };
  }

  const emptyErr = buildEmptyDailySolutionsPostError(data, dayMode);
  if (emptyErr !== null) {
    throw emptyErr;
  }

  const empty = !text.trim();
  const hint =
    dayMode === "multi"
      ? "Multi-day runs can take many minutes; a very large or slow response may time out. "
      : "";
  const preview = text && text.length > 0 ? ` Details: ${text.slice(0, 400)}` : "";
  throw new Error(
    (empty
      ? "The schedule service returned an empty response. For long multi-day jobs, try again in a moment or ask your administrator about server timeouts. "
      : "The schedule service did not return a completed schedule or job id yet. ") +
      hint +
      preview,
  );
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/**
 * 200 OK with `{ "dailySolutions": [], "aggregatedScore": { ... } }` — nothing to show and no job id.
 * Distinguishes this from a generic "no solve yet" so the UI can avoid the single/multi re-prompt.
 */
export class PostScheduleEmptyDailyResponseError extends Error {
  override readonly name = "PostScheduleEmptyDailyResponseError";
  constructor(message: string) {
    super(message);
  }
}

function buildEmptyDailySolutionsPostError(
  data: unknown,
  dayMode: ScheduleDayMode,
): PostScheduleEmptyDailyResponseError | null {
  if (!isRecord(data)) {
    return null;
  }
  const daily = data.dailySolutions ?? data.DailySolutions;
  if (!Array.isArray(daily) || daily.length > 0) {
    return null;
  }
  const hasAggregated = data.aggregatedScore != null || data.AggregatedScore != null;
  const modePhrase =
    dayMode === "multi" ? "a multi-day response with" : "a response with";
  return new PostScheduleEmptyDailyResponseError(
    `The schedule service returned ${modePhrase} **no daily solutions** (` +
      "`dailySolutions` is empty). There is no assignment to show and no job id to poll. " +
      "Often the solver could not find a feasible plan, or the request did not match what the service expects. " +
      "Try **single**-day, simplify the problem, or check schedule service logs. " +
      (hasAggregated ? "The response only included aggregate scores, not per-day data. " : ""),
  );
}

export async function fetchScheduleProblemResult(
  jobId: string,
  init?: { signal?: AbortSignal },
): Promise<ScheduleProblemSolveResponse> {
  const base = getScheduleProblemServiceBaseUrl();
  const url = `${base}/schedules/${encodeURIComponent(jobId)}`;
  const res = await fetch(url, { method: "GET", signal: init?.signal });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    /* non-JSON */
  }
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
  const normalized = tryNormalizeScheduleSolveFromApi(data);
  if (normalized !== null) {
    const out = enrichSolveWithConstraints(data, normalized);
    void onScheduleSolved(out);
    return out;
  }
  const loose = data as Partial<ScheduleProblemSolveResponse>;
  const fallback: ScheduleProblemSolveResponse = {
    employees: Array.isArray(loose.employees) ? loose.employees : [],
    flights: Array.isArray(loose.flights) ? loose.flights : [],
    scores: loose.scores ?? { hardScore: 0, softScore: 0, scoreString: "—" },
  };
  const out = enrichSolveWithConstraints(data, fallback);
  void onScheduleSolved(out);
  return out;
}

function looksLikeScheduleJobIdString(t: string): boolean {
  const s = t.trim();
  if (s.length < 8 || s.length > 80) {
    return false;
  }
  if (/^[\dA-Fa-f-]+$/.test(s) && /-/.test(s)) {
    return true;
  }
  return /^[0-9A-Za-z_.:-]+$/.test(s) && !s.startsWith("{") && !s.startsWith("[");
}

export function extractJobIdFromPostResponse(data: unknown): string | undefined {
  /** API may return a bare id string (not JSON) or a short JSON string `"uuid"`. */
  if (typeof data === "string") {
    const t = data.trim();
    if (t.length === 0) {
      return undefined;
    }
    if (looksLikeScheduleJobIdString(t)) {
      return t;
    }
    return undefined;
  }
  if (data === null || typeof data !== "object") {
    return undefined;
  }
  const o = data as Record<string, unknown>;
  for (const k of [
    "jobId",
    "JobId",
    "job_id",
    "id",
    "Id",
    "uuid",
    "UUID",
  ]) {
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
  return JSON.parse(text) as ScheduleExtractResponse;
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
  analyzeResponseJson?: string,
): Promise<PostOptimizationSuggestionsResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/schedule/post-optimization-suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      analyzeResponseJson !== undefined
        ? { solvedScheduleJson, analyzeResponseJson }
        : { solvedScheduleJson },
    ),
  });
  const text = await res.text();
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
  const requestBody = serializeTimefoldPayload(body);
  devLogOutgoingJson("POST /route-plans (Timefold body)", requestBody);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: requestBody,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    /* non-JSON */
  }
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
  return jobId;
}

/** POST schedule JSON to schedules service; returns job id for GET result. */
export async function postScheduleJob(body: SchedulePayload): Promise<string> {
  const serialized = serializeSchedulePayload(body);
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
