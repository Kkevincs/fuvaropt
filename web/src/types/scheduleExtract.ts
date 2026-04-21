import type { ScheduleEmployee } from "./scheduleProblem";

/** Shift without `employee` (filled by solver after POST). */
export type ScheduleShiftInput = {
  id: string;
  start: string;
  end: string;
  location: string;
  requiredSkill: string;
};

/** GET /api/schedule/from-message — same shape as MCP tool ExtractScheduleFromMessage result. */
export type ScheduleExtractResponse = {
  employees: ScheduleEmployee[];
  shifts: ScheduleShiftInput[];
  complete: boolean;
  /** When complete is false, server-side validation: only these items need a follow-up message. */
  missingHints?: string[];
};
