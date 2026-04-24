import type {
  ScheduleDateTimeRange,
  ScheduleFlight,
  SchedulePlanningEmployee,
  SchedulePlanningPayload,
} from "../types/scheduleExtract";

/**
 * Produces a schedule-problem POST body the downstream service can deserialize (.NET
 * `ProblemDTO` / `SchedulePlanningEmployeeDto` style: non-null arrays, int counts, and
 * **empty string** for unknown shift times — not JSON `null`, which often breaks
 * deserialization for `string` properties).
 */
function num(n: unknown, d: number): number {
  if (typeof n === "number" && Number.isFinite(n)) {
    return n;
  }
  if (typeof n === "string" && n.trim() !== "" && !Number.isNaN(Number(n))) {
    return Number(n);
  }
  return d;
}

function asStringArray(a: unknown): string[] {
  if (!Array.isArray(a)) {
    return [];
  }
  return a
    .map((x) => (x == null ? null : String(x).trim()))
    .filter((x): x is string => x !== null && x.length > 0);
}

/** Java / JSON `LocalDateTime` needs a calendar date, not a bare `HH:mm:ss`. */
function onlyIfFullDateTimeString(s: string): string {
  const t = s.trim();
  if (t.length === 0) {
    return "";
  }
  return /\d{4}-\d{2}-\d{2}/.test(t) ? t : "";
}

function asDateRanges(a: unknown): ScheduleDateTimeRange[] {
  if (!Array.isArray(a)) {
    return [];
  }
  const out: ScheduleDateTimeRange[] = [];
  for (const x of a) {
    if (x === null || typeof x !== "object" || Array.isArray(x)) {
      continue;
    }
    const o = x as Record<string, unknown>;
    const start = onlyIfFullDateTimeString(String(o.start ?? o.Start ?? ""));
    const end = onlyIfFullDateTimeString(String(o.end ?? o.End ?? ""));
    if (start.length > 0 || end.length > 0) {
      out.push({ start, end });
    }
  }
  return out;
}

function sanitizeEmployee(e: Partial<SchedulePlanningEmployee>): SchedulePlanningEmployee {
  return {
    id: String((e as SchedulePlanningEmployee).id ?? "").trim() || "employee",
    name: String((e as SchedulePlanningEmployee).name ?? "").trim() || "—",
    skills: asStringArray((e as SchedulePlanningEmployee).skills),
    /** `""` when unknown; time-only like `04:00:00` is stripped (invalid for Java `LocalDateTime` on the schedule service). */
    expectedShiftStart: (() => {
      const v = (e as SchedulePlanningEmployee).expectedShiftStart;
      if (v == null) {
        return "";
      }
      return onlyIfFullDateTimeString(String(v));
    })(),
    earliestShiftStart: (() => {
      const v = (e as SchedulePlanningEmployee).earliestShiftStart;
      if (v == null) {
        return "";
      }
      return onlyIfFullDateTimeString(String(v));
    })(),
    dailyMinWorkingHour: num((e as SchedulePlanningEmployee).dailyMinWorkingHour, 0),
    /**
     * Missing extract often sends 0. Downstream treats 0 as a literal cap → 8h shifts violate
     * "max 0 hours". Only 0 means "unset" here; use generous caps so simple plans stay feasible.
     */
    dailyMaxWorkingHour: (() => {
      const v = num((e as SchedulePlanningEmployee).dailyMaxWorkingHour, 0);
      return v === 0 ? 24 : v;
    })(),
    weeklyWorkedHours: num((e as SchedulePlanningEmployee).weeklyWorkedHours, 0),
    weeklyMaxWorkingHours: (() => {
      const v = num((e as SchedulePlanningEmployee).weeklyMaxWorkingHours, 0);
      return v === 0 ? 168 : v;
    })(),
    monthlyWorkedHours: num((e as SchedulePlanningEmployee).monthlyWorkedHours, 0),
    monthlyMaxWorkingHours: (() => {
      const v = num((e as SchedulePlanningEmployee).monthlyMaxWorkingHours, 0);
      return v === 0 ? 744 : v;
    })(),
    unavailableDates: asDateRanges((e as SchedulePlanningEmployee).unavailableDates),
    undesiredDates: asDateRanges((e as SchedulePlanningEmployee).undesiredDates),
    desiredDates: asDateRanges((e as SchedulePlanningEmployee).desiredDates),
  };
}

function sanitizeFlight(f: Partial<ScheduleFlight>): ScheduleFlight {
  const d = f.duration;
  const duration = {
    start: d && typeof d === "object" && !Array.isArray(d) ? String((d as { start?: unknown }).start ?? (d as { Start?: unknown }).Start ?? "") : "",
    end: d && typeof d === "object" && !Array.isArray(d) ? String((d as { end?: unknown }).end ?? (d as { End?: unknown }).End ?? "") : "",
  };
  const reqRaw = f.requiredEmployees;
  const requiredEmployees: ScheduleFlight["requiredEmployees"] = [];
  if (Array.isArray(reqRaw)) {
    for (const re of reqRaw) {
      if (re === null || typeof re !== "object" || Array.isArray(re)) {
        continue;
      }
      const o = re as { skills?: unknown; Skills?: unknown; numberOfEmployees?: unknown; NumberOfEmployees?: unknown };
      const n = num(o.numberOfEmployees ?? o.NumberOfEmployees, 0);
      requiredEmployees.push({
        skills: asStringArray(o.skills ?? o.Skills),
        numberOfEmployees: Math.max(1, Math.floor(n)),
      });
    }
  }
  if (requiredEmployees.length === 0) {
    requiredEmployees.push({ skills: [], numberOfEmployees: 1 });
  }
  return {
    id: String(f.id ?? "").trim() || "flight",
    duration,
    requiredEmployees,
  };
}

export function sanitizeSchedulePlanningPayloadForService(body: SchedulePlanningPayload | null | undefined): SchedulePlanningPayload {
  const employees = Array.isArray(body?.employees) ? body!.employees.map((e) => sanitizeEmployee(e as Partial<SchedulePlanningEmployee>)) : [];
  const flights = Array.isArray(body?.flights) ? body!.flights.map((f) => sanitizeFlight(f as Partial<ScheduleFlight>)) : [];
  return { employees, flights };
}

/** `JSON.stringify` replacer: drop `undefined`, coerce non-finite numbers to 0. */
export function safeJsonStringifyForScheduleService(payload: SchedulePlanningPayload): string {
  return JSON.stringify(payload, (_key, value) => {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === "number" && (!Number.isFinite(value) || Number.isNaN(value))) {
      return 0;
    }
    return value;
  });
}
