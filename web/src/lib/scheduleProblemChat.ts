import type { ScheduleExtractResponse } from "../types/scheduleExtract";

/** Aligned with server validation in `GeminiRouteExtractionService.AppendDemoScheduleLimits`. */
export const DEMO_MAX_SCHEDULE_EMPLOYEES = 4;
export const DEMO_MAX_SKILLS_PER_EMPLOYEE = 3;
export const DEMO_MAX_SCHEDULE_SPAN_DAYS = 7;

export const SCHEDULE_DEMO_LIMITS_MESSAGE =
  `This is a demo app: at most ${DEMO_MAX_SCHEDULE_EMPLOYEES} employees, you can enter at most ${DEMO_MAX_SKILLS_PER_EMPLOYEE} skills per person, ` +
  `and shift times spanning at most ${DEMO_MAX_SCHEDULE_SPAN_DAYS} days (earliest shift start through latest shift end).`;

export function isScheduleExtractComplete(r: ScheduleExtractResponse): boolean {
  return r.complete;
}

/** Assistant reply when extraction is incomplete: only the gaps the API reported. */
export function buildMissingSchedulePrompt(r: ScheduleExtractResponse): string {
  const hints = (r.missingHints ?? []).filter((h) => h.trim().length > 0);
  if (hints.length > 0) {
    const lines = hints.map((h) => `• ${h}`);
    return (
      "A few values are still missing or invalid. Please reply with only what is needed:\n\n" +
      `${lines.join("\n")}\n\n` +
      "You can send one short message covering these points."
    );
  }
  if (!r.complete) {
    return (
      "The schedule is not complete yet. Add any missing employees or shifts, or fix invalid times, then send again."
    );
  }
  return "";
}
