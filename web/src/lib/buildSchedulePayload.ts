import type { ScheduleEmployee, SchedulePayload, ScheduleShift } from "../types/scheduleProblem";

/**
 * Build POST body for /schedules. Matches working solver contract: each shift has `employee: null`,
 * and `score` / `solverStatus` are null until the solver returns a result.
 */
export function buildSchedulePayload(
  employees: ScheduleEmployee[],
  shifts: Array<Omit<ScheduleShift, "employee">>,
): SchedulePayload {
  return {
    employees,
    shifts: shifts.map((s) => ({
      ...s,
      employee: null,
    })),
    score: null,
    solverStatus: null,
  };
}

export function serializeSchedulePayload(payload: SchedulePayload): string {
  return JSON.stringify(payload, (_key, value) => {
    if (typeof value === "number" && (!Number.isFinite(value) || Number.isNaN(value))) {
      return null;
    }
    return value;
  });
}
