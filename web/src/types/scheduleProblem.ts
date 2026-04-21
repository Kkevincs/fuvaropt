/** Employee row for schedule API (matches POST/GET JSON shape). */
export type ScheduleEmployee = {
  name: string;
  skills: string[];
  unavailableDates: string[];
  undesiredDates: string[];
  desiredDates: string[];
};

/** Shift row before solve: `employee` is null; solver fills it on GET. */
export type ScheduleShift = {
  id: string;
  start: string;
  end: string;
  location: string;
  requiredSkill: string;
  employee: Record<string, unknown> | null;
};

export type ScheduleScore = {
  zero: boolean;
  hardScore: number;
  softScore: number;
  feasible: boolean;
};

/** Full POST body to /schedules (solver API expects nulls for pre-solve fields). */
export type SchedulePayload = {
  employees: ScheduleEmployee[];
  shifts: ScheduleShift[];
  score: ScheduleScore | null;
  solverStatus: string | null;
};

/** GET /schedules/:jobId — same structure with assignments. */
export type ScheduleSolveResponse = SchedulePayload;
