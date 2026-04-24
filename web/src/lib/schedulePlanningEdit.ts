import type { SchedulePlanningEmployee, SchedulePlanningPayload } from "../types/scheduleExtract";

function cloneEmployees(employees: SchedulePlanningEmployee[]): SchedulePlanningEmployee[] {
  return employees.map((e) => ({ ...e }));
}

/** Move one employee from `fromIndex` to `toIndex` (stable reorder). */
export function moveEmployeeInPayload(
  payload: SchedulePlanningPayload,
  fromIndex: number,
  toIndex: number,
): SchedulePlanningPayload {
  const n = payload.employees.length;
  if (fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n || fromIndex === toIndex) {
    return payload;
  }
  const employees = cloneEmployees(payload.employees);
  const [removed] = employees.splice(fromIndex, 1);
  if (removed === undefined) {
    return payload;
  }
  employees.splice(toIndex, 0, removed);
  return { ...payload, employees };
}

/** Swap two employees at indices `i` and `j` in the planning JSON. */
export function swapEmployeesInPayload(
  payload: SchedulePlanningPayload,
  i: number,
  j: number,
): SchedulePlanningPayload {
  const n = payload.employees.length;
  if (i < 0 || i >= n || j < 0 || j >= n || i === j) {
    return payload;
  }
  const employees = cloneEmployees(payload.employees);
  const a = employees[i];
  const b = employees[j];
  if (a === undefined || b === undefined) {
    return payload;
  }
  employees[i] = b;
  employees[j] = a;
  return { ...payload, employees };
}
