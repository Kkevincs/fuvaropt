import type { ScheduleProblemFlightResult, ScheduleProblemSolveResponse } from "../types/scheduleProblemSolve";

type Props = {
  result: ScheduleProblemSolveResponse;
};

function formatTick(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatDayWithWeekday(isoStart: string): string {
  const ms = Date.parse(isoStart);
  if (!Number.isFinite(ms)) {
    return isoStart;
  }
  const d = new Date(ms);
  try {
    const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
    const rest = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${weekday} ${rest}`;
  } catch {
    return isoStart;
  }
}

/**
 * Solved plan: one row per employee, blocks from `assignedFlights` × `flights[].duration`.
 */
export function ScheduleProblemTimeline({ result }: Props) {
  const { employees, flights, scores } = result;
  const flightById = new Map<string, ScheduleProblemFlightResult>();
  for (const f of flights) {
    flightById.set(f.id, f);
  }

  type Block = {
    start: string;
    end: string;
    flightId: string;
    label: string;
  };

  const blocksByEmployee = new Map<string, Block[]>();
  for (const emp of employees) {
    const list: Block[] = [];
    for (const af of emp.assignedFlights ?? []) {
      const fl = flightById.get(af.id);
      if (!fl) {
        continue;
      }
      const label = [af.id, ...(af.skills?.length ? af.skills : [])].join(" · ");
      list.push({
        start: fl.duration.start,
        end: fl.duration.end,
        flightId: af.id,
        label,
      });
    }
    blocksByEmployee.set(emp.id, list);
  }

  const allTimes: number[] = [];
  for (const f of flights) {
    const a = Date.parse(f.duration.start);
    const b = Date.parse(f.duration.end);
    if (Number.isFinite(a)) {
      allTimes.push(a);
    }
    if (Number.isFinite(b)) {
      allTimes.push(b);
    }
  }
  for (const emp of employees) {
    if (emp.startWorkingTime) {
      const t = Date.parse(emp.startWorkingTime);
      if (Number.isFinite(t)) {
        allTimes.push(t);
      }
    }
    if (emp.endWorkingTime) {
      const t = Date.parse(emp.endWorkingTime);
      if (Number.isFinite(t)) {
        allTimes.push(t);
      }
    }
  }

  if (allTimes.length < 2) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/30 px-4 py-4 text-sm text-amber-100">
        <p className="font-medium">Solved schedule</p>
        <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-amber-200/60">scoreString</p>
        <p className="mt-0.5 break-words font-mono text-sm text-amber-100/90">
          {scores?.scoreString?.trim() ? scores.scoreString : "—"}
        </p>
        <p className="mt-3 text-amber-200/80">
          There were not enough flight start/end times to draw a timeline.
          Check that each assigned flight has a matching entry with times in the response.
        </p>
      </div>
    );
  }

  const t0 = Math.min(...allTimes);
  const t1 = Math.max(...allTimes);
  const span = Math.max(1, t1 - t0);

  const ticks = 5;
  const tickMs = Array.from({ length: ticks }, (_, i) => t0 + (span * i) / Math.max(1, ticks - 1));

  return (
    <div
      className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-xl"
      aria-label="Solved schedule timeline"
    >
      <div className="border-b border-white/10 px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-white">Solved schedule</h2>
        <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">scoreString</p>
        <p className="mt-0.5 break-words font-mono text-sm text-emerald-300/95">
          {scores?.scoreString?.trim() ? scores.scoreString : "—"}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Axis: {formatTick(t0)} → {formatTick(t1)}. Each row is an employee; blocks are assigned flights.
        </p>
      </div>

      <div className="overflow-x-auto px-2 pb-4 pt-2 sm:px-4">
        <div className="min-w-[640px]">
          <div className="mb-2 flex pl-[7.5rem]">
            {tickMs.map((ms) => (
              <div
                key={ms}
                className="flex-1 border-l border-white/10 pl-1 text-[10px] text-slate-500 first:border-l-0 first:pl-0"
              >
                {formatTick(ms)}
              </div>
            ))}
          </div>

          <div className="relative space-y-1">
            {employees.map((emp) => {
              const blocks = blocksByEmployee.get(emp.id) ?? [];
              const wStart = emp.startWorkingTime ? Date.parse(emp.startWorkingTime) : NaN;
              const wEnd = emp.endWorkingTime ? Date.parse(emp.endWorkingTime) : NaN;
              const hasShiftBar =
                Number.isFinite(wStart) && Number.isFinite(wEnd) && wEnd > wStart;
              return (
                <div key={emp.id} className="flex min-h-[64px] items-stretch gap-2">
                  <div className="w-28 shrink-0 py-2 pr-2 text-right">
                    <div className="truncate text-xs font-medium text-slate-300" title={emp.name}>
                      {emp.name}
                    </div>
                    <div className="truncate text-[10px] text-slate-500" title={emp.id}>
                      {emp.id}
                    </div>
                    {emp.usefulWorkingTime > 0 && (
                      <div className="text-[10px] text-slate-500">
                        useful {emp.usefulWorkingTime}h / {emp.totalWorkingTime}h
                      </div>
                    )}
                  </div>
                  <div className="relative min-h-[56px] flex-1 rounded-lg border border-white/5 bg-slate-950/40">
                    {hasShiftBar && (
                      <div
                        className="absolute inset-y-1 rounded-md border border-dashed border-white/15 bg-slate-800/30"
                        style={{
                          left: `${((wStart! - t0) / span) * 100}%`,
                          width: `${((wEnd! - wStart!) / span) * 100}%`,
                        }}
                        title={`Working window ${emp.startWorkingTime} – ${emp.endWorkingTime}`}
                      />
                    )}
                    {blocks.map((b) => {
                      const a = Date.parse(b.start);
                      const c = Date.parse(b.end);
                      if (!Number.isFinite(a) || !Number.isFinite(c) || c <= a) {
                        return null;
                      }
                      const left = ((a - t0) / span) * 100;
                      const width = ((c - a) / span) * 100;
                      return (
                        <div
                          key={`${emp.id}-${b.flightId}-${b.start}`}
                          className="absolute inset-y-1.5 z-[1] box-border flex min-h-0 min-w-[4px] flex-col justify-center gap-0.5 overflow-hidden rounded-md bg-gradient-to-r from-brand-600/90 to-emerald-700/90 px-1.5 py-1 text-[9px] leading-snug text-white shadow-md ring-1 ring-white/10"
                          style={{
                            left: `${Math.max(0, Math.min(100 - 0.5, left))}%`,
                            width: `${Math.max(0.5, Math.min(100 - left, width))}%`,
                          }}
                          title={`${b.flightId} ${b.start} → ${b.end}`}
                        >
                          <span className="block shrink-0 truncate font-medium">
                            {formatDayWithWeekday(b.start)}
                          </span>
                          <span className="block shrink-0 truncate text-white/90">{b.flightId}</span>
                          <span className="block min-h-0 shrink truncate text-white/75">{b.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
