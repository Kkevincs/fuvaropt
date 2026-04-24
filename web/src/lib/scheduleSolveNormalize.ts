import type {
  AssignedFlightRef,
  FlightRequiredEmployeeResult,
  ScheduleProblemEmployeeResult,
  ScheduleProblemFlightResult,
  ScheduleProblemScores,
  ScheduleProblemSolveResponse,
} from "../types/scheduleProblemSolve";

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/** C# and some clients serialize Opta-style scores as numbers *or* strings. */
function parseScoreNumber(a: unknown, b: unknown): number {
  for (const v of [a, b]) {
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) {
        return n;
      }
    }
  }
  return 0;
}

function normAssignedFlight(x: unknown): AssignedFlightRef | null {
  if (!isRecord(x)) {
    return null;
  }
  const id = x.id ?? x.Id;
  const skills = x.skills ?? x.Skills;
  if (typeof id !== "string") {
    return null;
  }
  return {
    id,
    skills: Array.isArray(skills) ? (skills as string[]) : [],
  };
}

function normEmployee(e: unknown): ScheduleProblemEmployeeResult {
  if (!isRecord(e)) {
    return {
      id: "",
      name: "",
      skills: [],
      earliestShiftStart: null,
      expectedShiftStart: null,
      dailyMinWorkingHour: 0,
      dailyMaxWorkingHour: 0,
      weeklyWorkedHours: 0,
      weeklyMaxWorkingHours: 0,
      monthlyWorkedHours: 0,
      monthlyMaxWorkingHours: 0,
      unavailableDates: [],
      undesiredDates: [],
      desiredDates: [],
      assignedFlights: [],
      startWorkingTime: null,
      endWorkingTime: null,
      usefulWorkingTime: 0,
      totalWorkingTime: 0,
    };
  }
  const o = e;
  const afRaw = o.assignedFlights ?? o.AssignedFlights;
  const assignedFlights: AssignedFlightRef[] = Array.isArray(afRaw)
    ? (afRaw.map(normAssignedFlight).filter(Boolean) as AssignedFlightRef[])
    : [];

  const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

  return {
    id: String(o.id ?? o.Id ?? ""),
    name: String(o.name ?? o.Name ?? ""),
    skills: Array.isArray(o.skills ?? o.Skills) ? (o.skills ?? o.Skills) as string[] : [],
    earliestShiftStart: (o.earliestShiftStart ?? o.EarliestShiftStart ?? null) as string | null,
    expectedShiftStart: (o.expectedShiftStart ?? o.ExpectedShiftStart ?? null) as string | null,
    dailyMinWorkingHour: num(o.dailyMinWorkingHour ?? o.DailyMinWorkingHour),
    dailyMaxWorkingHour: num(o.dailyMaxWorkingHour ?? o.DailyMaxWorkingHour),
    weeklyWorkedHours: num(o.weeklyWorkedHours ?? o.WeeklyWorkedHours),
    weeklyMaxWorkingHours: num(o.weeklyMaxWorkingHours ?? o.WeeklyMaxWorkingHours),
    monthlyWorkedHours: num(o.monthlyWorkedHours ?? o.MonthlyWorkedHours),
    monthlyMaxWorkingHours: num(o.monthlyMaxWorkingHours ?? o.MonthlyMaxWorkingHours),
    unavailableDates: Array.isArray(o.unavailableDates ?? o.UnavailableDates)
      ? (o.unavailableDates ?? o.UnavailableDates) as unknown[]
      : [],
    undesiredDates: Array.isArray(o.undesiredDates ?? o.UndesiredDates)
      ? (o.undesiredDates ?? o.UndesiredDates) as unknown[]
      : [],
    desiredDates: Array.isArray(o.desiredDates ?? o.DesiredDates)
      ? (o.desiredDates ?? o.DesiredDates) as unknown[]
      : [],
    assignedFlights,
    startWorkingTime: (o.startWorkingTime ?? o.StartWorkingTime ?? null) as string | null,
    endWorkingTime: (o.endWorkingTime ?? o.EndWorkingTime ?? null) as string | null,
    usefulWorkingTime: num(o.usefulWorkingTime ?? o.UsefulWorkingTime),
    totalWorkingTime: num(o.totalWorkingTime ?? o.TotalWorkingTime),
  };
}

function normReqEmp(x: unknown): FlightRequiredEmployeeResult {
  if (!isRecord(x)) {
    return { employeeId: "", skills: [] };
  }
  const o = x;
  const id = o.employeeId ?? o.EmployeeId;
  const skills = o.skills ?? o.Skills;
  return {
    employeeId: typeof id === "string" ? id : String(id ?? ""),
    skills: Array.isArray(skills) ? (skills as string[]) : [],
  };
}

function normFlight(f: unknown): ScheduleProblemFlightResult {
  if (!isRecord(f)) {
    return { id: "", duration: { start: "", end: "" }, requiredEmployees: [] };
  }
  const o = f;
  const dur = isRecord(o.duration ?? o.Duration) ? (o.duration ?? o.Duration) as Record<string, unknown> : {};
  const start = String(dur.start ?? dur.Start ?? "");
  const end = String(dur.end ?? dur.End ?? "");
  const reqRaw = o.requiredEmployees ?? o.RequiredEmployees;
  const requiredEmployees: FlightRequiredEmployeeResult[] = Array.isArray(reqRaw)
    ? reqRaw.map(normReqEmp)
    : [];

  return {
    id: String(o.id ?? o.Id ?? ""),
    duration: { start, end },
    requiredEmployees,
  };
}

/** e.g. "-24hard/-1000soft" (OptaPlanner) when numbers live only in the string. */
function tryParseHardSoftFromScoreString(s: string): { hard: number; soft: number } | null {
  const t = s.trim();
  const m = t.match(/^(-?[\d,]+)\s*hard\s*\/\s*(-?[\d,]+)\s*soft$/i);
  if (!m) {
    return null;
  }
  const hard = Number(String(m[1]).replaceAll(",", ""));
  const soft = Number(String(m[2]).replaceAll(",", ""));
  if (!Number.isFinite(hard) || !Number.isFinite(soft)) {
    return null;
  }
  return { hard, soft };
}

function normScores(s: unknown): ScheduleProblemScores {
  if (!isRecord(s)) {
    return { hardScore: 0, softScore: 0, scoreString: "—" };
  }
  const o = s;
  let hardScore = parseScoreNumber(o.hardScore, o.HardScore);
  let softScore = parseScoreNumber(o.softScore, o.SoftScore);
  const scoreString = String(o.scoreString ?? o.ScoreString ?? "—");
  if (hardScore === 0 && softScore === 0 && scoreString !== "—") {
    const parsed = tryParseHardSoftFromScoreString(scoreString);
    if (parsed !== null) {
      hardScore = parsed.hard;
      softScore = parsed.soft;
    }
  }
  return { hardScore, softScore, scoreString };
}

/**
 * Recognizes a schedule-service POST body (camelCase or PascalCase, optional wrappers) and
 * returns a UI-ready {@link ScheduleProblemSolveResponse}.
 */
const UNWRAP_KEYS: string[] = [
  "data",
  "Data",
  "result",
  "Result",
  "payload",
  "Payload",
  "solution",
  "Solution",
  "plan",
  "Plan",
  "value",
  "Value",
  "content",
  "Content",
  "body",
  "Body",
  "output",
  "Output",
  "model",
  "Model",
  "response",
  "Response",
  "schedule",
  "Schedule",
  "solved",
  "Solved",
  "answer",
  "Answer",
  "problem",
  "Problem",
];

function pickEmployeeArray(root: Record<string, unknown>): unknown[] | null {
  const em =
    root.employees ??
    root.Employees ??
    root.staff ??
    root.Staff ??
    root.people ??
    root.People;
  return Array.isArray(em) ? em : null;
}

function pickFlightArray(root: Record<string, unknown>): unknown[] | null {
  const fl =
    root.flights ?? root.Flights ?? root.duties ?? root.Duties ?? root.shifts ?? root.Shifts;
  return Array.isArray(fl) ? fl : null;
}

function pickScoresRawFromNode(root: Record<string, unknown>): unknown {
  return (
    root.scores ??
    root.Scores ??
    root.score ??
    root.Score ??
    root.aggregatedScore ??
    root.AggregatedScore
  );
}

function buildSolveIfComplete(root: Record<string, unknown>): ScheduleProblemSolveResponse | null {
  const em = pickEmployeeArray(root);
  const fl = pickFlightArray(root);
  if (em === null || fl === null) {
    return null;
  }
  return {
    employees: em.map(normEmployee),
    flights: fl.map(normFlight),
    scores: normScores(pickScoresRawFromNode(root)),
  };
}

/** Same as {@link buildSolveIfComplete} but allows a missing/empty `flights` list (e.g. metadata-only day objects). */
function buildSolveWithOptionalFlights(root: Record<string, unknown>): ScheduleProblemSolveResponse | null {
  const em = pickEmployeeArray(root);
  if (em === null) {
    return null;
  }
  const fl = pickFlightArray(root) ?? [];
  return {
    employees: em.map(normEmployee),
    flights: fl.map(normFlight),
    scores: normScores(pickScoresRawFromNode(root)),
  };
}

/**
 * Multi-day API often returns `{ dailySolutions: [ { employees, flights }, ... ], scores? }` instead of a single
 * top-level `employees` + `flights`. Merges into one {@link ScheduleProblemSolveResponse} for the timeline.
 */
function tryMergeDailySolutions(root: Record<string, unknown>): ScheduleProblemSolveResponse | null {
  const daily = root.dailySolutions ?? root.DailySolutions;
  if (!Array.isArray(daily) || daily.length === 0) {
    return null;
  }

  const parts: ScheduleProblemSolveResponse[] = [];
  for (const d of daily) {
    if (!isRecord(d)) {
      continue;
    }
    const s = buildSolveIfComplete(d) ?? buildSolveWithOptionalFlights(d);
    if (s !== null) {
      parts.push(s);
    }
  }
  if (parts.length === 0) {
    return null;
  }

  const byEmp = new Map<string, ScheduleProblemEmployeeResult>();
  const allFlights: ScheduleProblemFlightResult[] = [];

  for (const p of parts) {
    for (const f of p.flights) {
      if (f.id) {
        allFlights.push(f);
      }
    }
    for (const e of p.employees) {
      const id = e.id;
      if (!id) {
        continue;
      }
      const prev = byEmp.get(id);
      if (!prev) {
        byEmp.set(id, { ...e, assignedFlights: [...(e.assignedFlights ?? [])] });
      } else {
        prev.assignedFlights = [...(prev.assignedFlights ?? []), ...(e.assignedFlights ?? [])];
      }
    }
  }

  if (allFlights.length === 0 && byEmp.size === 0) {
    return null;
  }

  return {
    employees: Array.from(byEmp.values()),
    flights: allFlights,
    scores: normScores(pickScoresRawFromNode(root)),
  };
}

function deepFindScheduleSolve(data: unknown, depth: number): ScheduleProblemSolveResponse | null {
  if (data === null || data === undefined) {
    return null;
  }
  if (depth > 12) {
    return null;
  }

  if (isRecord(data)) {
    const mergedDaily = tryMergeDailySolutions(data);
    if (mergedDaily !== null) {
      return mergedDaily;
    }
    const direct = buildSolveIfComplete(data);
    if (direct !== null) {
      return direct;
    }
    for (const k of UNWRAP_KEYS) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        const inner = (data as Record<string, unknown>)[k];
        const found = deepFindScheduleSolve(inner, depth + 1);
        if (found !== null) {
          return found;
        }
      }
    }
  }

  if (Array.isArray(data)) {
    for (const el of data) {
      const found = deepFindScheduleSolve(el, depth + 1);
      if (found !== null) {
        return found;
      }
    }
  }

  return null;
}

function isTrivialScores(s: ScheduleProblemScores): boolean {
  return s.scoreString === "—" && s.hardScore === 0 && s.softScore === 0;
}

/** True if this object looks like a score DTO, not a full solution row. */
function looksLikePlainScoreObject(r: Record<string, unknown>): boolean {
  if (Array.isArray(r.employees) || Array.isArray(r.Employees)) {
    return false;
  }
  if (Array.isArray(r.flights) || Array.isArray(r.Flights) || Array.isArray(r.dailySolutions)) {
    return false;
  }
  const hasHard = r.hardScore !== undefined || r.HardScore !== undefined;
  const hasSoft = r.softScore !== undefined || r.SoftScore !== undefined;
  const hasStr = r.scoreString !== undefined || r.ScoreString !== undefined;
  if (!hasHard && !hasSoft && !hasStr) {
    return false;
  }
  return Object.keys(r).length <= 16;
}

/**
 * The solver may put `scores` on the response root while `deepFindScheduleSolve` matches a nested
 * `{ employees, flights }` without scores — then normScores is empty. Walk the full JSON and take
 * the best non-trivial `scores` / `score` / plain score DTO we find.
 */
function findBestScheduleScoresInTree(data: unknown, depth: number): ScheduleProblemScores | null {
  if (data === null || data === undefined || depth > 16) {
    return null;
  }
  let best: ScheduleProblemScores | null = null;

  function isBetterScore(current: ScheduleProblemScores, candidate: ScheduleProblemScores): boolean {
    if (isTrivialScores(candidate)) {
      return false;
    }
    if (isTrivialScores(current)) {
      return true;
    }
    const cHasStr = candidate.scoreString !== "—" ? 1 : 0;
    const aHasStr = current.scoreString !== "—" ? 1 : 0;
    if (cHasStr > aHasStr) {
      return true;
    }
    if (cHasStr < aHasStr) {
      return false;
    }
    return (
      Math.abs(candidate.hardScore) + Math.abs(candidate.softScore) >
      Math.abs(current.hardScore) + Math.abs(current.softScore)
    );
  }

  function consider(cand: ScheduleProblemScores) {
    if (best === null) {
      best = cand;
    } else if (isBetterScore(best, cand)) {
      best = cand;
    }
  }

  function walk(node: unknown, d: number) {
    if (d > 16) {
      return;
    }
    if (isRecord(node)) {
      const nested = pickScoresRawFromNode(node);
      if (nested !== undefined) {
        consider(normScores(nested));
      }
      if (looksLikePlainScoreObject(node)) {
        consider(normScores(node));
      }
      for (const v of Object.values(node)) {
        walk(v, d + 1);
      }
    } else if (Array.isArray(node)) {
      for (const el of node) {
        walk(el, d + 1);
      }
    }
  }

  walk(data, 0);
  return best;
}

export function tryNormalizeScheduleSolveFromApi(data: unknown): ScheduleProblemSolveResponse | null {
  if (data === null || data === undefined) {
    return null;
  }
  const found = deepFindScheduleSolve(data, 0);
  if (found === null) {
    return null;
  }
  if (!isTrivialScores(found.scores)) {
    return found;
  }
  const fromTree = findBestScheduleScoresInTree(data, 0);
  if (fromTree === null || isTrivialScores(fromTree)) {
    return found;
  }
  return { ...found, scores: fromTree };
}
