import type { SchedulePlanningPayload } from "../types/scheduleExtract";

/**
 * Schedule problem request bodies to Java (Jackson, `LocalDateTime` for shift times):
 * - **No** `score` or `solverStatus` — the service analyzes/recomputes from `employees` + `flights` or `+ shifts`.
 * - `earliestShiftStart` / `expectedShiftStart`: `null` when unknown — never `""` (empty string is not a valid
 *   `LocalDateTime` in Jackson).
 * - **Flights** (first / analysis): `employees` + `flights` (same demand as extract).
 * - **Shifts** (re-optimize, etc.): `employees` + `shifts`. Each shift: unassigned `employee: null` before solve.
 */

export type ScheduleServiceProblemPostBody = {
  employees: ScheduleServiceProblemEmployeeWire[];
  shifts: ScheduleServiceProblemShiftWire[];
};

export type ScheduleServiceProblemEmployeeWire = {
  id: string;
  name: string;
  skills: string[];
  /** `null` when not set; never `""` (Jackson + LocalDateTime). */
  earliestShiftStart: string | null;
  expectedShiftStart: string | null;
  dailyMinWorkingHour: number;
  dailyMaxWorkingHour: number;
  weeklyWorkedHours: number;
  weeklyMaxWorkingHours: number;
  monthlyWorkedHours: number;
  monthlyMaxWorkingHours: number;
  unavailableDates: { start: string; end: string }[];
  undesiredDates: { start: string; end: string }[];
  desiredDates: { start: string; end: string }[];
};

export type ScheduleServiceProblemShiftWire = {
  id: string;
  duration: { start: string; end: string };
  location: string;
  requiredSkills: string[];
  /** Unassigned when submitting the problem. */
  employee: null;
};

/**
 * Java `LocalDateTime` (JSON) must be a full date-time, e.g. `2026-06-02T04:00:00`.
 * Values like `04:00:00` alone cause 400 "cannot deserialize".
 */
function localDateTimeOrNullFromPlanning(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (t.length === 0) {
    return null;
  }
  if (!/\d{4}-\d{2}-\d{2}/.test(t)) {
    return null;
  }
  return t;
}

function wireEmployee(e: SchedulePlanningPayload["employees"][0]): ScheduleServiceProblemEmployeeWire {
  return {
    id: e.id,
    name: e.name,
    skills: Array.isArray(e.skills) ? [...e.skills] : [],
    earliestShiftStart: localDateTimeOrNullFromPlanning(e.earliestShiftStart),
    expectedShiftStart: localDateTimeOrNullFromPlanning(e.expectedShiftStart),
    dailyMinWorkingHour: e.dailyMinWorkingHour,
    dailyMaxWorkingHour: e.dailyMaxWorkingHour,
    weeklyWorkedHours: e.weeklyWorkedHours,
    weeklyMaxWorkingHours: e.weeklyMaxWorkingHours,
    monthlyWorkedHours: e.monthlyWorkedHours,
    monthlyMaxWorkingHours: e.monthlyMaxWorkingHours,
    unavailableDates: (e.unavailableDates ?? []).map((r) => ({ start: r.start, end: r.end })),
    undesiredDates: (e.undesiredDates ?? []).map((r) => ({ start: r.start, end: r.end })),
    desiredDates: (e.desiredDates ?? []).map((r) => ({ start: r.start, end: r.end })),
  };
}

/**
 * Flights in chat extraction become **shifts** for this API: one row per (flight ×
 * `requiredEmployees` slot × `numberOfEmployees` copies).
 */
function wireShiftsFromFlights(
  body: SchedulePlanningPayload,
): ScheduleServiceProblemShiftWire[] {
  const out: ScheduleServiceProblemShiftWire[] = [];
  for (const f of body.flights ?? []) {
    const d = f.duration;
    if (!d || typeof d !== "object") {
      continue;
    }
    const start = String(d.start ?? "");
    const end = String(d.end ?? "");
    const reList = f.requiredEmployees?.length ? f.requiredEmployees : [{ skills: [] as string[], numberOfEmployees: 1 }];

    for (const re of reList) {
      const n = Math.max(1, Math.floor(Number(re.numberOfEmployees) || 1));
      const requiredSkills = Array.isArray(re.skills) ? re.skills.map((s) => String(s)) : [];
      for (let i = 0; i < n; i += 1) {
        out.push({
          id: `${f.id}-${out.length + 1}`,
          duration: { start, end },
          location: "",
          requiredSkills,
          employee: null,
        });
      }
    }
  }
  return out;
}

/** `employees` + `flights` (coverage demand) — same model as LLM / extract. */
export type ScheduleServiceFlightsProblemPostBody = {
  employees: ScheduleServiceProblemEmployeeWire[];
  flights: ScheduleServiceProblemFlightWire[];
};

export type ScheduleServiceProblemFlightWire = {
  id: string;
  duration: { start: string; end: string };
  requiredEmployees: { skills: string[]; numberOfEmployees: number }[];
};

function wireFlight(f: SchedulePlanningPayload["flights"][0]): ScheduleServiceProblemFlightWire {
  const d = f.duration;
  return {
    id: f.id,
    duration: { start: String(d?.start ?? ""), end: String(d?.end ?? "") },
    requiredEmployees: (f.requiredEmployees ?? []).map((re) => ({
      skills: Array.isArray(re.skills) ? re.skills.map((s) => String(s)) : [],
      numberOfEmployees: Math.max(1, Math.floor(Number(re.numberOfEmployees) || 1)),
    })),
  };
}

/**
 * Map sanitized planning DTO to the service POST for the first solve (employees + **flights**).
 */
export function schedulePlanningToFlightsServicePostBody(
  body: SchedulePlanningPayload,
): ScheduleServiceFlightsProblemPostBody {
  return {
    employees: body.employees.map(wireEmployee),
    flights: (body.flights ?? []).map(wireFlight),
  };
}

/**
 * Map sanitized planning DTO to the service POST with **shifts** (e.g. after a first run / re-optimize).
 */
export function schedulePlanningToServiceProblemPostBody(
  body: SchedulePlanningPayload,
): ScheduleServiceProblemPostBody {
  return {
    employees: body.employees.map(wireEmployee),
    shifts: wireShiftsFromFlights(body),
  };
}

function jsonStringifyScheduleWire(
  body: ScheduleServiceProblemPostBody | ScheduleServiceFlightsProblemPostBody,
): string {
  return JSON.stringify(body, (_key, value) => {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === "number" && (!Number.isFinite(value) || Number.isNaN(value))) {
      return 0;
    }
    return value;
  });
}

export function safeJsonStringifyServiceProblemPost(body: ScheduleServiceProblemPostBody): string {
  return jsonStringifyScheduleWire(body);
}

export function safeJsonStringifyFlightsServiceProblemPost(body: ScheduleServiceFlightsProblemPostBody): string {
  return jsonStringifyScheduleWire(body);
}
