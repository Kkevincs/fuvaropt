/** GET /schedules/{jobId} after POST /schedules/problem (schedule service on :8081). */

export type AssignedFlightRef = {
  id: string;
  skills: string[];
};

export type ScheduleProblemEmployeeResult = {
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
  unavailableDates: unknown[];
  undesiredDates: unknown[];
  desiredDates: unknown[];
  assignedFlights: AssignedFlightRef[];
  startWorkingTime: string | null;
  endWorkingTime: string | null;
  usefulWorkingTime: number;
  totalWorkingTime: number;
};

export type FlightRequiredEmployeeResult = {
  employeeId: string;
  skills: string[];
};

export type ScheduleProblemFlightResult = {
  id: string;
  duration: { start: string; end: string };
  requiredEmployees: FlightRequiredEmployeeResult[];
};

export type ScheduleProblemScores = {
  hardScore: number;
  softScore: number;
  scoreString: string;
};

/** One row for solver/Opta-style constraint match info when the API provides it. */
export type ScheduleSolverConstraintRow = {
  label: string;
  value: string;
};

export type ScheduleProblemSolveResponse = {
  employees: ScheduleProblemEmployeeResult[];
  flights: ScheduleProblemFlightResult[];
  scores: ScheduleProblemScores;
  /** Optional breakdown from the schedule service (e.g. constraint match totals). */
  solverConstraintRows?: ScheduleSolverConstraintRow[];
};
