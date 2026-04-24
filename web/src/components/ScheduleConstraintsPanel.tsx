import { useMemo } from "react";
import { buildPlanningConstraintSections } from "../lib/scheduleConstraintDisplay";
import type { SchedulePlanningPayload } from "../types/scheduleExtract";
import type { ScheduleProblemSolveResponse } from "../types/scheduleProblemSolve";

type Props = {
  planning: SchedulePlanningPayload | null;
  result: ScheduleProblemSolveResponse;
};

export function ScheduleConstraintsPanel({ planning, result }: Props) {
  const planningSections = useMemo(
    () => (planning !== null ? buildPlanningConstraintSections(planning) : []),
    [planning],
  );

  const { scores, solverConstraintRows } = result;
  const hasSolverRows = (solverConstraintRows?.length ?? 0) > 0;

  return (
    <div
      className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40 shadow-xl"
      aria-label="Constraints and score"
    >
      <div className="border-b border-white/10 px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-white">Constraints & score</h2>
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">scoreString</p>
        <p className="mt-0.5 break-words font-mono text-sm leading-snug text-emerald-200/95">
          {scores?.scoreString?.trim() ? scores.scoreString : "—"}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          What was sent to the optimizer, hard/soft scores, and—when the service returns
          them—per-constraint breakdown rows.
        </p>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Solver score</h3>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 sm:col-span-2">
              <dt className="text-[10px] uppercase text-slate-500">scoreString</dt>
              <dd className="mt-0.5 break-words font-mono text-sm text-emerald-200/90">
                {scores?.scoreString?.trim() ? scores.scoreString : "—"}
              </dd>
            </div>
            <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2">
              <dt className="text-[10px] uppercase text-slate-500">Hard / soft</dt>
              <dd className="font-mono tabular-nums text-slate-200">
                {scores?.hardScore ?? 0} / {scores?.softScore ?? 0}
              </dd>
            </div>
          </dl>
        </section>

        {hasSolverRows && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Constraint breakdown (from solver)
            </h3>
            <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/40 p-2 text-sm">
              {solverConstraintRows!.map((row, i) => (
                <li
                  key={`${row.label}-${i}`}
                  className="border-b border-white/5 pb-2 last:border-b-0 last:pb-0"
                >
                  <p className="font-medium text-slate-200">{row.label}</p>
                  <p className="mt-0.5 break-words font-mono text-xs text-slate-400">{row.value}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {planningSections.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your problem (input)</h3>
            <div className="mt-2 space-y-4">
              {planningSections.map((sec) => (
                <div key={sec.title}>
                  <p className="text-sm font-medium text-slate-300">{sec.title}</p>
                  <ul className="mt-2 space-y-2">
                    {sec.items.map((row, idx) => (
                      <li
                        key={`${sec.title}-${idx}-${row.label}`}
                        className="rounded-lg border border-white/5 bg-slate-950/30 px-3 py-2 text-sm"
                      >
                        <p className="font-medium text-brand-200/90">{row.label}</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-400">{row.text}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
