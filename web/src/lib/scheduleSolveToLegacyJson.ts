import type {
  ScheduleProblemEmployeeResult,
  ScheduleProblemFlightResult,
  ScheduleProblemSolveResponse,
} from "../types/scheduleProblemSolve";

/** `{ start, end }` for ranges (ISO strings). */
export type DateRange = { start: string; end: string };

/**
 * Java wire: `earliestShiftStart` / `expectedShiftStart` are `LocalDateTime` (JSON `string` or `null` only — never `""`).
 */
export type LegacyScheduleEmployee = {
  id: string;
  name: string;
  skills: string[];
  earliestShiftStart: string | null;
  expectedShiftStart: string | null;
  dailyMinWorkingHour: number;
  dailyMaxWorkingHour: number;
  weeklyWorkedHours: number;
  weeklyMaxWorkingHours: number;
  monthlyWorkedHours: number;
  monthlyMaxWorkingHours: number;
  unavailableDates: DateRange[];
  undesiredDates: DateRange[];
  desiredDates: DateRange[];
};

export type LegacyScheduleShift = {
  id: string;
  duration: { start: string; end: string };
  location: string;
  requiredSkills: string[];
  employee: LegacyScheduleEmployee;
};

/**
 * JSON shape for analyze: **employees** + **shifts** only (no `score` / `solverStatus` on request — server recomputes).
 */
export type LegacyOptimizedScheduleJson = {
  employees: LegacyScheduleEmployee[];
  shifts: LegacyScheduleShift[];
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function localDateTimeOrNull(v: string | null | undefined): string | null {
  if (v == null) {
    return null;
  }
  const t = String(v).trim();
  return t.length > 0 ? t : null;
}

function normalizeDateRanges(ranges: unknown[]): DateRange[] {
  const out: DateRange[] = [];
  for (const x of ranges) {
    if (isRecord(x) && (typeof x.start === "string" || typeof x.Start === "string")) {
      const start = String(x.start ?? x.Start ?? "");
      const end = String(x.end ?? x.End ?? "");
      out.push({ start, end });
    }
  }
  return out;
}

function toLegacyEmployee(emp: ScheduleProblemEmployeeResult): LegacyScheduleEmployee {
  return {
    id: String(emp.id ?? ""),
    name: String(emp.name ?? ""),
    skills: Array.isArray(emp.skills) ? emp.skills.map((s) => String(s)) : [],
    earliestShiftStart: localDateTimeOrNull(emp.earliestShiftStart),
    expectedShiftStart: localDateTimeOrNull(emp.expectedShiftStart),
    dailyMinWorkingHour: Number.isFinite(emp.dailyMinWorkingHour) ? emp.dailyMinWorkingHour : 0,
    dailyMaxWorkingHour: Number.isFinite(emp.dailyMaxWorkingHour) ? emp.dailyMaxWorkingHour : 0,
    weeklyWorkedHours: Number.isFinite(emp.weeklyWorkedHours) ? emp.weeklyWorkedHours : 0,
    weeklyMaxWorkingHours: Number.isFinite(emp.weeklyMaxWorkingHours) ? emp.weeklyMaxWorkingHours : 0,
    monthlyWorkedHours: Number.isFinite(emp.monthlyWorkedHours) ? emp.monthlyWorkedHours : 0,
    monthlyMaxWorkingHours: Number.isFinite(emp.monthlyMaxWorkingHours) ? emp.monthlyMaxWorkingHours : 0,
    unavailableDates: normalizeDateRanges(emp.unavailableDates as unknown[]),
    undesiredDates: normalizeDateRanges(emp.undesiredDates as unknown[]),
    desiredDates: normalizeDateRanges(emp.desiredDates as unknown[]),
  };
}

function buildShifts(
  employees: ScheduleProblemEmployeeResult[],
  flights: ScheduleProblemFlightResult[],
  byId: Map<string, ScheduleProblemEmployeeResult>,
): LegacyScheduleShift[] {
  const out: LegacyScheduleShift[] = [];

  for (const f of flights) {
    if (f.requiredEmployees?.length) {
      for (const req of f.requiredEmployees) {
        const emp = byId.get(req.employeeId);
        if (emp) {
          out.push({
            id: `${f.id}#${req.employeeId}`,
            duration: { ...f.duration },
            location: "",
            requiredSkills: Array.isArray(req.skills) ? [...req.skills] : [],
            employee: toLegacyEmployee(emp),
          });
        }
      }
    }
  }

  if (out.length > 0) {
    return out;
  }

  for (const emp of employees) {
    for (const af of emp.assignedFlights ?? []) {
      const f = flights.find((fl) => fl.id === af.id);
      if (!f) {
        continue;
      }
      out.push({
        id: `${f.id}#${emp.id}`,
        duration: { ...f.duration },
        location: "",
        requiredSkills: Array.isArray(af.skills) ? [...af.skills] : [],
        employee: toLegacyEmployee(emp),
      });
    }
  }

  return out;
}

/**
 * Map a schedule-problem **solved** payload (`flights` + per-flight assignments) to
 * `employees` + `shifts` (request-shaped JSON for services that analyze from assignments only).
 */
export function convertSolvedScheduleToLegacyJson(
  result: ScheduleProblemSolveResponse,
): LegacyOptimizedScheduleJson {
  const { employees, flights } = result;
  const byId = new Map(employees.map((e) => [e.id, e] as const));

  return {
    employees: employees.map(toLegacyEmployee),
    shifts: buildShifts(employees, flights, byId),
  };
}
