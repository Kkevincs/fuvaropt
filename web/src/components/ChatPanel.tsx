import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  type MapPin,
  type MapPinKind,
  RouteMap,
  pinColors,
  pinKindLabels,
} from "./RouteMap";
import { RouteAnalysisReport } from "./RouteAnalysisReport";
import { fetchRoutePlanResult, postRoutePlanJob, postRouteProblemFromMessage } from "../api/client";
import {
  VEHICLE_CAPACITY_TEST,
  buildTimefoldApiPayload,
  serializeTimefoldPayload,
} from "../lib/buildTimefoldPayload";
import type { OptimalRoutePlan } from "../types/optimalRoutePlan";
import type { RouteProblemResponse } from "../types/routeProblem";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

const introText =
  "Tell me about the deliveries. You can mention how many warehouses, delivery addresses, vehicles, and packages you need—we will turn that into counts for the map.";

/** Only warehouse and delivery pins are quota-driven from the API. */
const pinKinds: MapPinKind[] = ["warehouse", "delivery"];

export function ChatPanel() {
  const [phase, setPhase] = useState<"chat" | "map">("chat");
  const [routeProblem, setRouteProblem] = useState<RouteProblemResponse | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "q", role: "assistant", text: introText },
  ]);
  const [draft, setDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [activePinKind, setActivePinKind] = useState<MapPinKind>("warehouse");
  const [mapPins, setMapPins] = useState<MapPin[]>([]);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const [sendError, setSendError] = useState<string | null>(null);
  const [sendLoading, setSendLoading] = useState(false);
  /** Set after POST /route-plans succeeds; used only for GET (no second POST). */
  const [routePlanJobId, setRoutePlanJobId] = useState<string | null>(null);
  const [fetchResultLoading, setFetchResultLoading] = useState(false);
  const [optimalRoute, setOptimalRoute] = useState<OptimalRoutePlan | null>(null);

  const selectedPin = useMemo(
    () => (selectedPinId === null ? null : mapPins.find((p) => p.id === selectedPinId) ?? null),
    [mapPins, selectedPinId],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleChatSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || chatLoading) {
      return;
    }

    setChatError(null);
    setChatLoading(true);
    setDraft("");
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text }]);

    try {
      const res = await postRouteProblemFromMessage({ message: text });
      setRouteProblem(res);
      setPhase("map");
      setMapPins([]);
      setSelectedPinId(null);
      setActivePinKind("warehouse");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setChatError(msg);
    } finally {
      setChatLoading(false);
    }
  }

  function countPins(kind: MapPinKind): number {
    return mapPins.filter((p) => p.kind === kind).length;
  }

  function handleAddPin(lat: number, lng: number) {
    if (routeProblem === null) {
      return;
    }
    const cap = activePinKind === "warehouse" ? routeProblem.warehouseCount : routeProblem.addressCount;
    if (countPins(activePinKind) >= cap) {
      return;
    }
    setMapPins((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        kind: activePinKind,
        lat,
        lng,
        ...(activePinKind === "warehouse"
          ? { vehicleCount: 0 }
          : activePinKind === "delivery"
            ? { demand: 1 }
            : {}),
      },
    ]);
  }

  function setDeliveryDemand(deliveryId: string, demand: number) {
    const safe = Number.isFinite(demand) ? demand : 0;
    const n = Math.max(0, Math.min(999, Math.floor(safe)));
    setMapPins((prev) =>
      prev.map((p) => (p.id === deliveryId && p.kind === "delivery" ? { ...p, demand: n } : p)),
    );
  }

  function setWarehouseVehicleCount(warehouseId: string, vehicleCount: number) {
    if (routeProblem === null) {
      return;
    }
    const safe = Number.isFinite(vehicleCount) ? vehicleCount : 0;
    const n = Math.max(0, Math.min(999, Math.floor(safe)));
    setMapPins((prev) => {
      const warehouses = prev.filter((p) => p.kind === "warehouse");
      const sumOthers = warehouses
        .filter((w) => w.id !== warehouseId)
        .reduce((s, w) => s + (Number.isFinite(w.vehicleCount) ? (w.vehicleCount ?? 0) : 0), 0);
      const maxForThis = Math.max(0, routeProblem.vehicleCount - sumOthers);
      const clamped = Math.min(n, maxForThis);
      return prev.map((p) =>
        p.id === warehouseId && p.kind === "warehouse" ? { ...p, vehicleCount: clamped } : p,
      );
    });
  }

  async function handleSendTimefold() {
    if (routeProblem === null) {
      return;
    }
    setSendError(null);
    setSendLoading(true);
    try {
      const payload = buildTimefoldApiPayload(routeProblem, mapPins);
      const raw = serializeTimefoldPayload(payload);
      console.log(
        "[Timefold] final JSON (same bytes as POST body; copy for Postman)\n" +
          JSON.stringify(JSON.parse(raw), null, 2),
      );
      const jobId = await postRoutePlanJob(payload);
      setRoutePlanJobId(jobId);
      setOptimalRoute(null);
      setSelectedPinId(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Submit failed.";
      setSendError(msg);
    } finally {
      setSendLoading(false);
    }
  }

  async function handleLoadOptimizedRoute() {
    if (routePlanJobId === null || routePlanJobId === "") {
      return;
    }
    setSendError(null);
    setFetchResultLoading(true);
    try {
      const plan = await fetchRoutePlanResult(routePlanJobId);
      setOptimalRoute(plan);
      setSelectedPinId(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not load route result.";
      setSendError(msg);
    } finally {
      setFetchResultLoading(false);
    }
  }

  const warehouseUsed = routeProblem !== null ? countPins("warehouse") : 0;
  const deliveryUsed = routeProblem !== null ? countPins("delivery") : 0;

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-emerald-700 text-sm font-bold text-slate-950">
          F
        </span>
        <div>
          <h1 className="text-sm font-semibold text-white">FuvarOpt</h1>
          <p className="text-xs text-slate-500">Route assistant</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6">
          {phase === "chat" && (
            <section className="pb-4" aria-label="Delivery description">
              <div className="flex max-h-[min(50vh,480px)] min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-xl">
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[75%] ${
                          m.role === "user"
                            ? "rounded-br-md bg-gradient-to-br from-brand-600 to-emerald-700 text-white shadow-md whitespace-pre-wrap"
                            : "rounded-bl-md border border-white/10 bg-slate-800/90 text-slate-200 whitespace-pre-wrap"
                        }`}
                      >
                        {m.text}
                      </div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>

                <form
                  className="shrink-0 border-t border-white/10 bg-slate-950/60 p-4 sm:p-5"
                  onSubmit={handleChatSubmit}
                >
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        setChatError(null);
                      }}
                      placeholder="Describe warehouses, addresses, cars, packages…"
                      rows={3}
                      disabled={chatLoading}
                      className="min-h-[88px] w-full resize-y rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={chatLoading || !draft.trim()}
                        className="rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {chatLoading ? "Working…" : "Continue"}
                      </button>
                      {chatError !== null && (
                        <p className="text-sm text-rose-400" role="alert">
                          {chatError}
                        </p>
                      )}
                    </div>
                  </div>
                </form>
              </div>
            </section>
          )}

          {phase === "map" && routeProblem !== null && (
            <>
              <section className="flex min-h-0 flex-1 flex-col gap-4 pb-2" aria-label="Map placement">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-white">Place locations on the map</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      Set vehicles per warehouse and demand per delivery stop. Each car has capacity{" "}
                      <span className="font-medium text-slate-200">{VEHICLE_CAPACITY_TEST}</span> for
                      testing. Extracted package total:{" "}
                      <span className="font-medium text-slate-200">{routeProblem.packages}</span>.
                    </p>
                  </div>
                  <p className="text-xs text-slate-500">
                    Vehicles (budget): {routeProblem.vehicleCount} · Warehouses: {warehouseUsed}/
                    {routeProblem.warehouseCount} · Addresses: {deliveryUsed}/
                    {routeProblem.addressCount}
                  </p>
                </div>

                {optimalRoute === null ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Pin type
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {pinKinds.map((kind) => {
                        const active = activePinKind === kind;
                        const color = pinColors[kind];
                        const used = kind === "warehouse" ? warehouseUsed : deliveryUsed;
                        const cap =
                          kind === "warehouse" ? routeProblem.warehouseCount : routeProblem.addressCount;
                        const atCap = used >= cap;
                        return (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => setActivePinKind(kind)}
                            title={atCap ? "At maximum for this type" : undefined}
                            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                              active
                                ? "border-white/30 bg-white/10 text-white ring-2 ring-brand-500/50"
                                : "border-white/10 bg-slate-900/80 text-slate-300 hover:bg-slate-800/80"
                            } ${atCap ? "opacity-60" : ""}`}
                          >
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/30"
                              style={{ backgroundColor: color }}
                            />
                            {pinKindLabels[kind]}
                            <span className="text-xs tabular-nums text-slate-500">
                              {used}/{cap}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100/95">
                    <p className="font-medium text-white">Optimized route</p>
                    {optimalRoute.score !== undefined && (
                      <p className="mt-1 font-mono text-xs text-emerald-200/90">{optimalRoute.score}</p>
                    )}
                    <p className="mt-2 text-xs text-emerald-200/80">
                      Clear the result below to edit pins and send again.
                    </p>
                  </div>
                )}

                <RouteMap
                  pins={mapPins}
                  onAddPin={handleAddPin}
                  solution={optimalRoute}
                  onPinClick={(pin) => {
                    if (optimalRoute === null) {
                      setSelectedPinId(pin.id);
                    }
                  }}
                />

                {optimalRoute !== null && <RouteAnalysisReport plan={optimalRoute} />}

                {sendLoading && (
                  <div
                    className="flex items-start gap-3 rounded-xl border border-brand-500/35 bg-brand-950/50 px-4 py-3 text-sm text-brand-50"
                    role="status"
                    aria-live="polite"
                  >
                    <span
                      className="mt-0.5 h-4 w-4 shrink-0 animate-pulse rounded-full bg-brand-400"
                      aria-hidden
                    />
                    <p className="font-medium text-white">Submitting job…</p>
                  </div>
                )}

                {routePlanJobId !== null && !sendLoading && (
                  <div
                    className="rounded-xl border border-slate-600/50 bg-slate-900/70 px-4 py-3 text-sm text-slate-200"
                    role="status"
                  >
                    <p className="font-medium text-white">Job queued</p>
                    <p className="mt-1 font-mono text-xs text-slate-400 break-all">{routePlanJobId}</p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">
                      The solver may need several seconds (often ~7s or more). When it is ready, press{" "}
                      <span className="font-medium text-slate-300">Load optimized route</span> to fetch the
                      result (GET only—no second POST). Use the same button again to refresh the map from
                      this job id.
                    </p>
                  </div>
                )}

                <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-4 sm:px-5">
                  {optimalRoute !== null ? (
                    <p className="text-sm text-slate-400">
                      Pin details are hidden while the optimized route is shown (see Route analysis above).
                      Clear the route result to edit warehouses and deliveries.
                    </p>
                  ) : selectedPin !== null ? (
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Selected pin · {pinKindLabels[selectedPin.kind]}
                        </p>
                        <p className="mt-2 font-mono text-base text-brand-200 tabular-nums">
                          {selectedPin.lat.toFixed(6)}, {selectedPin.lng.toFixed(6)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Latitude, longitude (WGS‑84)
                        </p>
                      </div>

                      {selectedPin.kind === "warehouse" && (
                        <div className="border-t border-white/10 pt-4">
                          <p className="text-sm font-medium text-white">Vehicles at this warehouse</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Total across warehouses cannot exceed {routeProblem.vehicleCount} cars.
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                aria-label="Remove one vehicle"
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-slate-800 text-lg font-semibold text-white transition hover:bg-slate-700"
                                onClick={() =>
                                  setWarehouseVehicleCount(
                                    selectedPin.id,
                                    (selectedPin.vehicleCount ?? 0) - 1,
                                  )
                                }
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min={0}
                                max={999}
                                value={selectedPin.vehicleCount ?? 0}
                                onChange={(e) =>
                                  setWarehouseVehicleCount(
                                    selectedPin.id,
                                    Number.parseInt(e.target.value, 10) || 0,
                                  )
                                }
                                className="h-10 w-20 rounded-xl border border-white/10 bg-slate-900 px-2 text-center font-mono text-sm text-white tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                              />
                              <button
                                type="button"
                                aria-label="Add one vehicle"
                                disabled={(() => {
                                  const others = mapPins
                                    .filter((p) => p.kind === "warehouse" && p.id !== selectedPin.id)
                                    .reduce(
                                      (s, w) =>
                                        s +
                                        (Number.isFinite(w.vehicleCount) ? (w.vehicleCount ?? 0) : 0),
                                      0,
                                    );
                                  const maxForThis = Math.max(
                                    0,
                                    routeProblem.vehicleCount - others,
                                  );
                                  return (selectedPin.vehicleCount ?? 0) >= maxForThis;
                                })()}
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-brand-600 text-lg font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() =>
                                  setWarehouseVehicleCount(
                                    selectedPin.id,
                                    (selectedPin.vehicleCount ?? 0) + 1,
                                  )
                                }
                              >
                                +
                              </button>
                            </div>
                            <span className="text-xs text-slate-500">
                              {(selectedPin.vehicleCount ?? 0) === 1
                                ? "1 vehicle"
                                : `${selectedPin.vehicleCount ?? 0} vehicles`}
                            </span>
                          </div>
                        </div>
                      )}

                      {selectedPin.kind === "delivery" && (
                        <div className="border-t border-white/10 pt-4">
                          <p className="text-sm font-medium text-white">Demand at this address</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Packages to deliver here (shown on the map pin). Each vehicle capacity is{" "}
                            {VEHICLE_CAPACITY_TEST}.
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                aria-label="Remove one from demand"
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-slate-800 text-lg font-semibold text-white transition hover:bg-slate-700"
                                onClick={() =>
                                  setDeliveryDemand(
                                    selectedPin.id,
                                    (selectedPin.demand ?? 0) - 1,
                                  )
                                }
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min={0}
                                max={999}
                                value={selectedPin.demand ?? 0}
                                onChange={(e) =>
                                  setDeliveryDemand(
                                    selectedPin.id,
                                    Number.parseInt(e.target.value, 10) || 0,
                                  )
                                }
                                className="h-10 w-20 rounded-xl border border-white/10 bg-slate-900 px-2 text-center font-mono text-sm text-white tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                              />
                              <button
                                type="button"
                                aria-label="Add one to demand"
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-emerald-600 text-lg font-semibold text-white transition hover:bg-emerald-500"
                                onClick={() =>
                                  setDeliveryDemand(
                                    selectedPin.id,
                                    (selectedPin.demand ?? 0) + 1,
                                  )
                                }
                              >
                                +
                              </button>
                            </div>
                            <span className="text-xs text-slate-500">
                              {(selectedPin.demand ?? 0) === 1
                                ? "1 package"
                                : `${selectedPin.demand ?? 0} packages`}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Click a pin on the map to see its details here.
                    </p>
                  )}
                </div>
              </section>

              <div className="flex flex-col items-end gap-2 pb-10">
                {sendError !== null && (
                  <p className="max-w-full text-right text-sm text-rose-400" role="alert">
                    {sendError}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {optimalRoute !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        setOptimalRoute(null);
                        setSelectedPinId(null);
                      }}
                      className="rounded-xl border border-white/15 bg-slate-800/90 px-5 py-3 text-sm font-medium text-slate-200 transition hover:bg-slate-700/90"
                    >
                      Clear route result
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={routePlanJobId === null || fetchResultLoading || sendLoading}
                    onClick={() => void handleLoadOptimizedRoute()}
                    className="rounded-xl border border-brand-500/40 bg-brand-950/60 px-5 py-3 text-sm font-semibold text-brand-100 transition hover:bg-brand-900/70 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {fetchResultLoading ? "Loading…" : "Load optimized route"}
                  </button>
                  <button
                    type="button"
                    disabled={sendLoading}
                    onClick={() => void handleSendTimefold()}
                    className="rounded-xl bg-brand-500 px-8 py-3 text-sm font-semibold text-slate-950 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sendLoading ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
