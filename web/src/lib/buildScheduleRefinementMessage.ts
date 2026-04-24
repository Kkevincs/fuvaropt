import type { SchedulePlanningPayload } from "../types/scheduleExtract";

/**
 * Markers read by `ExtractScheduleFromMessageAsync` (FuvarOpt) to enter refinement mode:
 * output full merged employees + flights, not a from-scratch extract only.
 */
export const SCHEDULE_PLAN_REFINE_END = "---END_CURRENT_PLAN_JSON---";

export const SCHEDULE_PLAN_REFINE_START = "---BEGIN_CURRENT_PLAN_JSON---";

const PREFIX = "FUvarOpt_PLAN_REFINE\n";

/**
 * Wrap current planning JSON + free-text user edits for the schedule extract API.
 */
export function buildScheduleRefinementMessage(
  currentPlan: SchedulePlanningPayload,
  userInstruction: string,
): string {
  return (
    `${PREFIX}The app already has a planning state. Merge the instruction into it.\n` +
    `${SCHEDULE_PLAN_REFINE_START}\n` +
    `${JSON.stringify(currentPlan, null, 2)}\n` +
    `${SCHEDULE_PLAN_REFINE_END}\n\n` +
    `User instruction (apply to the plan above; keep valid ids when unchanged):\n` +
    userInstruction.trim()
  );
}
