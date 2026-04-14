import { useMemo } from "react";
import type { OptimalRoutePlan } from "../types/optimalRoutePlan";
import { analyzeOptimalRoutePlan } from "../lib/analyzeOptimalRoutePlan";

type Props = {
  plan: OptimalRoutePlan;
};

export function RouteAnalysisReport({ plan }: Props) {
  const r = useMemo(() => analyzeOptimalRoutePlan(plan), [plan]);

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-4 sm:px-5">
      <h3 className="text-sm font-semibold text-white">Route analysis</h3>
      <p className="mt-1 text-xs text-slate-500">
        Same metrics as the FuvarOpt MCP tool <code className="text-slate-400">AnalyzeOptimizedRoute</code>.
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Warehouses used</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-white">{r.warehousesUsed}</dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Vehicles (active / total)</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-white">
            {r.activeVehicles} / {r.totalVehicles}
          </dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Stops assigned</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-white">{r.totalStopsAssigned}</dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Avg stops / vehicle</dt>
          <dd className="mt-1 text-sm text-slate-200">
            <span className="font-semibold tabular-nums text-white">{r.averageStopsPerActiveVehicle}</span>
            <span className="text-slate-500"> active</span>
            <span className="mx-1 text-slate-600">·</span>
            <span className="font-semibold tabular-nums text-white">
              {r.averageStopsPerVehicleIncludingIdle}
            </span>
            <span className="text-slate-500"> incl. idle</span>
          </dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Driving time (solver)</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-brand-200">
            {r.totalDrivingTimeSeconds}s
          </dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Straight-line distance (approx.)
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-emerald-200/95">
            {r.approximateStraightLineDistanceKmTotal} km
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">{r.travelMetricNote}</p>

      {r.perVehicle.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[320px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-slate-950/60 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Stops</th>
                <th className="px-3 py-2 font-medium">Drive (s)</th>
                <th className="px-3 py-2 font-medium">Line km</th>
              </tr>
            </thead>
            <tbody>
              {r.perVehicle.map((row) => (
                <tr key={row.vehicleId} className="border-b border-white/5 last:border-0">
                  <td className="px-3 py-2 font-mono text-slate-200">{row.vehicleId}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-300">{row.stopCount}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-300">{row.drivingTimeSeconds}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-300">
                    {row.approximateStraightLineRouteKm}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
