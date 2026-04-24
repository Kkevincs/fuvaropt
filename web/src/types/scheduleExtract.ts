export type ScheduleDateTimeRange = {
  start: string;
  end: string;
};

export type SchedulePlanningEmployee = {
  id: string;
  name: string;
  skills: string[];
  /** Use `null` or `""` when unknown; the wire sanitizer sends `""` for the schedule service deserializer. */
  expectedShiftStart: string | null;
  earliestShiftStart: string | null;
  dailyMinWorkingHour: number;
  dailyMaxWorkingHour: number;
  weeklyWorkedHours: number;
  weeklyMaxWorkingHours: number;
  monthlyWorkedHours: number;
  monthlyMaxWorkingHours: number;
  unavailableDates: ScheduleDateTimeRange[];
  undesiredDates: ScheduleDateTimeRange[];
  desiredDates: ScheduleDateTimeRange[];
};

export type ScheduleFlightRequiredEmployees = {
  skills: string[];
  numberOfEmployees: number;
};

export type ScheduleFlight = {
  id: string;
  duration: {
    start: string;
    end: string;
  };
  requiredEmployees: ScheduleFlightRequiredEmployees[];
};

/** Full planning body posted to the schedule problem service. */
export type SchedulePlanningPayload = {
  employees: SchedulePlanningEmployee[];
  flights: ScheduleFlight[];
};

/** POST /api/schedule/from-message — same shape as MCP tool ExtractScheduleFromMessage result. */
export type ScheduleExtractResponse = {
  employees: SchedulePlanningEmployee[];
  flights: ScheduleFlight[];
  complete: boolean;
  missingHints?: string[];
};
