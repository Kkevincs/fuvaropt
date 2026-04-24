import { useEffect, useId, useState } from "react";
import type { SchedulePlanningPayload } from "../types/scheduleExtract";
import { moveEmployeeInPayload, swapEmployeesInPayload } from "../lib/schedulePlanningEdit";

type Props = {
  payload: SchedulePlanningPayload;
  onPayloadChange: (next: SchedulePlanningPayload) => void;
  onReoptimize: () => void;
  reoptimizeDisabled: boolean;
  reoptimizeLabel: string;
};

function fmtSkills(skills: string[]): string {
  if (skills.length === 0) {
    return "—";
  }
  return skills.join(", ");
}

export function ScheduleEmployeeRosterEditor({
  payload,
  onPayloadChange,
  onReoptimize,
  reoptimizeDisabled,
  reoptimizeLabel,
}: Props) {
  const n = payload.employees.length;
  const baseId = useId();
  const swapAId = `${baseId}-swap-a`;
  const swapBId = `${baseId}-swap-b`;
  const [swapA, setSwapA] = useState(0);
  const [swapB, setSwapB] = useState(() => (n >= 2 ? 1 : 0));

  useEffect(() => {
    const max = Math.max(0, n - 1);
    setSwapA((a) => Math.min(Math.max(0, a), max));
    setSwapB((b) => Math.min(Math.max(0, b), max));
  }, [n]);

  return (
    <div
      className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-xl"
      aria-label="Employee roster for next run"
    >
      <div className="border-b border-white/10 px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-white">Roster for the next run</h2>
        <p className="mt-1 text-xs text-slate-500">
          Reorder or swap people in the planning data, then run the optimizer again with the same
          single-day or multi-day mode as last time.
        </p>
      </div>

      <ul className="divide-y divide-white/10">
        {payload.employees.map((emp, index) => (
          <li
            key={emp.id || `${index}`}
            className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
          >
            <div className="min-w-0">
              <p className="font-medium text-slate-100">{emp.name || emp.id || `Employee ${index + 1}`}</p>
              <p className="truncate font-mono text-xs text-slate-500">{emp.id}</p>
              <p className="mt-0.5 text-xs text-slate-400">{fmtSkills(emp.skills)}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => onPayloadChange(moveEmployeeInPayload(payload, index, index - 1))}
                className="rounded-lg border border-white/10 bg-slate-800/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700/90 disabled:cursor-not-allowed disabled:opacity-40"
                title="Move up in list"
              >
                Up
              </button>
              <button
                type="button"
                disabled={index >= n - 1}
                onClick={() => onPayloadChange(moveEmployeeInPayload(payload, index, index + 1))}
                className="rounded-lg border border-white/10 bg-slate-800/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700/90 disabled:cursor-not-allowed disabled:opacity-40"
                title="Move down in list"
              >
                Down
              </button>
            </div>
          </li>
        ))}
      </ul>

      {n >= 2 && (
        <div className="border-t border-white/10 px-4 py-3 sm:px-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Swap two people</p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor={swapAId} className="text-xs text-slate-500">
                First
              </label>
              <select
                id={swapAId}
                value={swapA}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSwapA(v);
                  if (v === swapB && n >= 2) {
                    setSwapB(v === 0 ? 1 : 0);
                  }
                }}
                className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
              >
                {payload.employees.map((emp, index) => (
                  <option key={`a-${emp.id}-${index}`} value={index}>
                    {emp.name || emp.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor={swapBId} className="text-xs text-slate-500">
                Second
              </label>
              <select
                id={swapBId}
                value={swapB}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSwapB(v);
                  if (v === swapA && n >= 2) {
                    setSwapA(v === 0 ? 1 : 0);
                  }
                }}
                className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
              >
                {payload.employees.map((emp, index) => (
                  <option key={`b-${emp.id}-${index}`} value={index}>
                    {emp.name || emp.id}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => onPayloadChange(swapEmployeesInPayload(payload, swapA, swapB))}
              disabled={swapA === swapB}
              className="rounded-xl border border-white/15 bg-slate-800/90 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Swap
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-white/10 px-4 py-4 sm:px-5">
        <button
          type="button"
          disabled={reoptimizeDisabled}
          onClick={onReoptimize}
          className="rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {reoptimizeLabel}
        </button>
      </div>
    </div>
  );
}
