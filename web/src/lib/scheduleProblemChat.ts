import type { ScheduleExtractResponse, ScheduleFlight } from "../types/scheduleExtract";

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
      "The plan is not complete yet. Address the following (you can reply in one message):\n\n" +
        `${lines.join("\n")}\n\n` +
        "We will keep asking until everything needed is filled in, then continue automatically."
    );
  }
  if (!r.complete) {
    return (
      "The schedule is not complete yet. Add any missing required fields (employees, flights, skills, duration times, requiredEmployees), then send again."
    );
  }
  return "";
}

/** Single-day vs multi-day schedule API (`/schedules/problem` vs `.../multi-day`). */
export type ScheduleDayMode = "single" | "multi";

export const SCHEDULE_DAY_MODE_PROMPT =
  "The plan is valid and ready to solve. Do you want a **single-day** solve or a **multi-day** solve? " +
  "Reply with **single** (or *one day*) for one planning day, or **multi** (or *multiple days*) for a longer horizon. " +
  "Multi-day needs at least two duties on **different calendar dates**; if everything is on one day, choose **single** or add another duty on another date.";

export const SCHEDULE_DAY_MODE_RETRY =
  "I could not tell whether you want single-day or multi-day. Please reply with **single** for one planning day, or **multi** for a multi-day horizon, then send again.";

/** `POST /schedules/problem/multi-day` requires at least two distinct `duration.start` dates (by yyyy-MM-dd). */
export const MULTI_DAY_MIN_DISTINCT_START_DAYS_MESSAGE =
  "For a **multi-day** run we need at least **two** duties on **different calendar dates** (not just different times on the same day). " +
  "Add a duty on another date in the chat, send again to refresh the plan, then choose **multi**; or choose **single** for a one-day solve.";

/**
 * True when there are at least two different calendar dates among `flight.duration.start` (ISO-8601, date from yyyy-MM-dd prefix or `Date` parse).
 */
export function flightsSatisfyMultiDayStartDateRule(flights: ScheduleFlight[]): boolean {
  const days = new Set<string>();
  for (const f of flights) {
    const start = f.duration?.start;
    if (typeof start !== "string" || start.length === 0) {
      continue;
    }
    const key = calendarDayKeyFromIsoStart(start);
    if (key !== null) {
      days.add(key);
    }
  }
  return days.size >= 2;
}

function calendarDayKeyFromIsoStart(iso: string): string | null {
  const t = iso.trim();
  const ymd = t.match(/^(\d{4}-\d{2}-\d{2})/);
  if (ymd) {
    return ymd[1] ?? null;
  }
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) {
    return null;
  }
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Interprets a short user reply for day mode. Returns null if the answer is ambiguous or empty.
 */
export function tryParseScheduleDayMode(input: string): ScheduleDayMode | null {
  const t = input
    .trim()
    .toLowerCase()
    .replace(/[.!?:;]+$/g, "")
    .replace(/\s+/g, " ");
  if (!t) {
    return null;
  }

  const wantsMulti =
    t === "multi" ||
    t === "multiple" ||
    t === "m" ||
    t === "2" ||
    t === "multiday" ||
    t === "multi-day" ||
    t === "multi day" ||
    /\bmultiple\s+days?\b/.test(t) ||
    /\bmany\s+days?\b/.test(t) ||
    /\bseveral\s+days?\b/.test(t) ||
    /\bmulti-?day\b/.test(t);

  const wantsSingle =
    t === "single" ||
    t === "s" ||
    t === "1" ||
    t === "one day" ||
    t === "single day" ||
    t === "1 day" ||
    t === "single-day" ||
    t === "oneday" ||
    /\bonly\s+one\s+day\b/.test(t) ||
    /\b(a\s+)?single\s+day\b/.test(t);

  if (wantsMulti && wantsSingle) {
    return null;
  }
  if (wantsMulti) {
    return "multi";
  }
  if (wantsSingle) {
    return "single";
  }
  return null;
}

/**
 * True when the message is short and only expresses single vs multi (re-solve with current plan, no new extract).
 */
export function isLikelySoleDayModeMessage(input: string): boolean {
  const t = input.trim();
  if (t.length === 0 || t.length > 36) {
    return false;
  }
  if (t.includes("\n")) {
    return false;
  }
  return tryParseScheduleDayMode(t) !== null;
}
