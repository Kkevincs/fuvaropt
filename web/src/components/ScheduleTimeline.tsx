import type { ScheduleEmployee, ScheduleShift } from "../types/scheduleProblem";

type ScheduleTimelineProps = {
  employees: ScheduleEmployee[];
  shifts: ScheduleShift[];
};

function shiftAssigneeName(shift: ScheduleShift): string | null {
  const e = shift.employee;
  if (e === null || typeof e !== "object" || Object.keys(e).length === 0) {
    return null;
  }
  const o = e as Record<string, unknown>;
  if (typeof o.name === "string" && o.name.trim().length > 0) {
    return o.name.trim();
  }
  if (typeof o.employeeName === "string" && o.employeeName.trim().length > 0) {
    return o.employeeName.trim();
  }
  return null;
}

function rowForShift(shift: ScheduleShift, employees: ScheduleEmployee[]): number {
  const name = shiftAssigneeName(shift);
  if (name === null) {
    return employees.length;
  }
  const idx = employees.findIndex((emp) => emp.name === name);
  if (idx >= 0) {
    return idx;
  }
  return employees.length;
}

/** e.g. "Monday, Apr 20" for the shift’s calendar day (local). */
function formatDayWithWeekday(isoStart: string): string {
  const ms = Date.parse(isoStart);
  if (!Number.isFinite(ms)) {
    return isoStart;
  }
  const d = new Date(ms);
  try {
    const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
    const rest = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${weekday}, ${rest}`;
  } catch {
    return isoStart;
  }
}

export function ScheduleTimeline({ employees, shifts }: ScheduleTimelineProps) {
  if (shifts.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-6 text-sm text-slate-400">
        No shifts to display.
      </div>
    );
  }

  const starts = shifts.map((s) => Date.parse(s.start));
  const ends = shifts.map((s) => Date.parse(s.end));
  const t0 = Math.min(...starts.filter(Number.isFinite));
  const t1 = Math.max(...ends.filter(Number.isFinite));
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/30 px-4 py-4 text-sm text-amber-100">
        Could not build a timeline from shift start/end times.
      </div>
    );
  }

  const span = t1 - t0;
  const rowLabels = [...employees.map((e) => e.name), "Unassigned"];

  const formatTick = (ms: number) => {
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
  };

  const ticks = 5;
  const tickMs = Array.from({ length: ticks }, (_, i) => t0 + (span * i) / Math.max(1, ticks - 1));

  return (
    <div
      className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-xl"
      aria-label="Schedule timeline"
    >
      <div className="border-b border-white/10 px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-white">Schedule</h2>
        <p className="mt-1 text-xs text-slate-500">
          Horizontal axis: {formatTick(t0)} → {formatTick(t1)}. Blocks use each shift’s start and end times; one
          row per employee; unassigned shifts on the last row.
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
            {rowLabels.map((label, rowIdx) => (
              <div key={label + rowIdx} className="flex min-h-[60px] items-stretch gap-2">
                <div className="w-28 shrink-0 truncate py-2 pr-2 text-right text-xs font-medium text-slate-400">
                  {label}
                </div>
                <div className="relative min-h-[56px] flex-1 rounded-lg border border-white/5 bg-slate-950/40">
                  {shifts
                    .map((s, i) => ({ s, i }))
                    .filter(({ s }) => rowForShift(s, employees) === rowIdx)
                    .map(({ s }) => {
                      const a = Date.parse(s.start);
                      const b = Date.parse(s.end);
                      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
                        return null;
                      }
                      const left = ((a - t0) / span) * 100;
                      const width = ((b - a) / span) * 100;
                      const title = `${formatDayWithWeekday(s.start)} · ${s.id} · ${s.requiredSkill} · ${s.location}`;
                      return (
                        <div
                          key={s.id}
                          className="absolute inset-y-1.5 box-border flex min-h-0 min-w-[4px] flex-col justify-center gap-0.5 overflow-hidden rounded-md bg-gradient-to-r from-brand-600/90 to-emerald-700/90 px-1.5 py-1 text-[9px] leading-snug text-white shadow-md ring-1 ring-white/10"
                          style={{
                            left: `${Math.max(0, Math.min(100 - 0.5, left))}%`,
                            width: `${Math.max(0.5, Math.min(100 - left, width))}%`,
                          }}
                          title={title}
                        >
                          <span className="block shrink-0 truncate font-medium leading-tight">
                            {formatDayWithWeekday(s.start)}
                          </span>
                          <span className="block shrink-0 truncate text-white/90">{s.requiredSkill}</span>
                          <span className="block min-h-0 shrink truncate text-white/75">{s.location}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
