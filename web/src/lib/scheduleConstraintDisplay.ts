import type { SchedulePlanningPayload } from "../types/scheduleExtract";
import type { ScheduleProblemSolveResponse } from "../types/scheduleProblemSolve";

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function fmtConstraintValue(v: unknown, depth: number): string {
  if (depth > 3) {
    return "…";
  }
  if (v === null || v === undefined) {
    return "—";
  }
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  if (isRecord(v)) {
    const parts: string[] = [];
    for (const [k, val] of Object.entries(v)) {
      if (k === "constraintName" && typeof val === "string") {
        continue;
      }
      parts.push(`${k}: ${fmtConstraintValue(val, depth + 1)}`);
    }
    return parts.length > 0 ? parts.join(", ") : JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    if (v.length === 0) {
      return "[]";
    }
    return (
      v
        .slice(0, 5)
        .map((x) => fmtConstraintValue(x, depth + 1))
        .join("; ") + (v.length > 5 ? " …" : "")
    );
  }
  return String(v);
}

const MAP_KEYS = [
  "constraintMatchTotalMap",
  "ConstraintMatchTotalMap",
  "constraintMatchTotals",
  "ConstraintMatchTotals",
] as const;

/**
 * Picks up OptaPlanner-style maps and indictment-like data from a schedule API JSON body.
 */
export function extractSolverConstraintRowsFromRaw(data: unknown) {
  const out: { label: string; value: string }[] = [];
  const seen = new Set<string>();

  function push(label: string, value: string) {
    const k = `${label}\n${value}`;
    if (seen.has(k) || label.length > 220 || out.length >= 100) {
      return;
    }
    seen.add(k);
    out.push({ label, value });
  }

  function consumeMap(m: unknown) {
    if (!isRecord(m)) {
      return;
    }
    for (const [ck, cv] of Object.entries(m)) {
      push(ck, fmtConstraintValue(cv, 0));
    }
  }

  function tryConsumeConstraintMapsOn(obj: unknown) {
    if (!isRecord(obj)) {
      return;
    }
    for (const key of MAP_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) {
        continue;
      }
      const v = obj[key];
      if (isRecord(v)) {
        consumeMap(v);
      } else if (Array.isArray(v)) {
        for (const item of v) {
          if (isRecord(item)) {
            const name = String(
              (item as { constraintName?: string; name?: string; Name?: string }).constraintName ??
                (item as { name?: string }).name ??
                (item as { Name?: string }).Name ??
                "Entry",
            );
            push(name, fmtConstraintValue(item, 0));
          }
        }
      }
    }
    if (Array.isArray(obj.indictment)) {
      for (const item of obj.indictment) {
        if (isRecord(item)) {
          const name = String(
            (item as { constraintName?: string; name?: string }).constraintName ??
              (item as { name?: string }).name ??
              "Indictment",
          );
          push(name, fmtConstraintValue(item, 0));
        }
      }
    }
    const ca = (obj.constraintAnalyses ?? (obj as { ConstraintAnalyses?: unknown }).ConstraintAnalyses) as
      | unknown[]
      | undefined;
    if (Array.isArray(ca)) {
      for (const item of ca) {
        if (isRecord(item)) {
          const name = String(
            (item as { name?: string; Name?: string }).name ?? (item as { Name?: string }).Name ?? "Analysis",
          );
          push(name, fmtConstraintValue(item, 0));
        }
      }
    }
  }

  function walk(node: unknown, depth: number) {
    if (depth > 10 || out.length >= 100) {
      return;
    }
    tryConsumeConstraintMapsOn(node);
    if (isRecord(node)) {
      for (const v of Object.values(node)) {
        if (v !== null && typeof v === "object") {
          walk(v, depth + 1);
        }
      }
    } else if (Array.isArray(node)) {
      for (const el of node) {
        walk(el, depth + 1);
      }
    }
  }

  tryConsumeConstraintMapsOn(data);
  walk(data, 0);
  return out.slice(0, 100);
}

export function enrichSolveWithConstraints(raw: unknown, solved: ScheduleProblemSolveResponse): ScheduleProblemSolveResponse {
  const rows = extractSolverConstraintRowsFromRaw(raw);
  if (rows.length === 0) {
    return solved;
  }
  return { ...solved, solverConstraintRows: rows };
}

function fmtRangeList(label: string, items: unknown[]): string | null {
  if (items.length === 0) {
    return null;
  }
  return `${label}: ${items.length} range(s)`;
}

export type PlanningConstraintSection = {
  title: string;
  items: { label: string; text: string }[];
};

/**
 * Human-readable view of the planning JSON the optimizer uses (from chat extraction).
 */
export function buildPlanningConstraintSections(payload: SchedulePlanningPayload): PlanningConstraintSection[] {
  const people: { label: string; text: string }[] = payload.employees.map((e) => {
    const bits: string[] = [];
    if (e.skills.length) {
      bits.push(`Skills: ${e.skills.join(", ")}`);
    } else {
      bits.push("Skills: (none specified)");
    }
    if (e.dailyMinWorkingHour > 0 || e.dailyMaxWorkingHour > 0) {
      bits.push(`Day hours: min ${e.dailyMinWorkingHour}h — max ${e.dailyMaxWorkingHour}h`);
    }
    if (e.weeklyMaxWorkingHours > 0 || e.weeklyWorkedHours > 0) {
      bits.push(`Week: ${e.weeklyWorkedHours}h / max ${e.weeklyMaxWorkingHours}h`);
    }
    if (e.monthlyMaxWorkingHours > 0 || e.monthlyWorkedHours > 0) {
      bits.push(`Month: ${e.monthlyWorkedHours}h / max ${e.monthlyMaxWorkingHours}h`);
    }
    if (e.expectedShiftStart) {
      bits.push(`Expected start: ${e.expectedShiftStart}`);
    }
    if (e.earliestShiftStart) {
      bits.push(`Earliest start: ${e.earliestShiftStart}`);
    }
    const u0 = fmtRangeList("Unavailable", e.unavailableDates as unknown[]);
    const u1 = fmtRangeList("Undesired", e.undesiredDates as unknown[]);
    const u2 = fmtRangeList("Preferred", e.desiredDates as unknown[]);
    if (u0) {
      bits.push(u0);
    }
    if (u1) {
      bits.push(u1);
    }
    if (u2) {
      bits.push(u2);
    }
    return { label: e.name || e.id, text: bits.join(" · ") };
  });

  const duties: { label: string; text: string }[] = payload.flights.map((f) => {
    const req = f.requiredEmployees
      .map((r) => `${r.numberOfEmployees}× [${(r.skills ?? []).join(", ")}]`)
      .join(" · ");
    return {
      label: f.id,
      text: `Window ${f.duration.start} → ${f.duration.end}${req ? ` · Need: ${req}` : ""}`,
    };
  });

  return [
    { title: "People & rules", items: people },
    { title: "Duties to assign", items: duties },
  ];
}
