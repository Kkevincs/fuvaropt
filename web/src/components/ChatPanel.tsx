import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  type MapPin,
  type MapPinKind,
  RouteMap,
  pinColors,
  pinKindLabels,
} from "./RouteMap";
import { RouteAnalysisReport } from "./RouteAnalysisReport";
import {
  fetchRoutePlanResult,
  fetchScheduleProblemResult,
  postOptimizationSuggestions,
  postRoutePlanJob,
  postRouteProblemFromMessage,
  postScheduleFromMessage,
  postScheduleProblem,
  PostScheduleEmptyDailyResponseError,
  subscribeScheduleSolveInsights,
} from "../api/client";
import { DEFAULT_VEHICLE_CAPACITY, buildTimefoldApiPayload } from "../lib/buildTimefoldPayload";
import {
  DEMO_LIMIT_MESSAGE,
  buildMissingDetailsPrompt,
  exceedsDemoLimits,
  getMissingRouteFields,
  isRouteProblemComplete,
} from "../lib/routeProblemChat";
import type { OptimalRoutePlan } from "../types/optimalRoutePlan";
import type { RouteProblemResponse } from "../types/routeProblem";
import type { SchedulePlanningPayload } from "../types/scheduleExtract";
import type { ScheduleProblemSolveResponse } from "../types/scheduleProblemSolve";
import { ScheduleConstraintsPanel } from "./ScheduleConstraintsPanel";
import { ScheduleEmployeeRosterEditor } from "./ScheduleEmployeeRosterEditor";
import { ScheduleProblemTimeline } from "./ScheduleProblemTimeline";
import { ScheduleInsightsReport } from "./ScheduleInsightsReport";
import {
  MULTI_DAY_MIN_DISTINCT_START_DAYS_MESSAGE,
  SCHEDULE_DAY_MODE_PROMPT,
  SCHEDULE_DAY_MODE_RETRY,
  SCHEDULE_DEMO_LIMITS_MESSAGE,
  type ScheduleDayMode,
  buildMissingSchedulePrompt,
  flightsSatisfyMultiDayStartDateRule,
  isScheduleExtractComplete,
  tryParseScheduleDayMode,
  isLikelySoleDayModeMessage,
} from "../lib/scheduleProblemChat";
import { buildScheduleRefinementMessage } from "../lib/buildScheduleRefinementMessage";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

const introText =
  "Tell me about the deliveries. Mention how many warehouses, delivery addresses, and vehicles you need. " +
  "This demo supports at most 4 warehouses, 8 vehicles, and 20 addresses. " +
  "If you skip a number, I will ask until we have all three.";

const welcomeIntroText =
  "What problem are you solving today? I can help with:\n\n" +
  "• Employee scheduling — shifts, skills, availability, and a solved timeline.\n\n" +
  "• Route optimization — warehouses, delivery stops, vehicles, and a map.\n\n" +
  "Briefly describe your situation, or say whether you need scheduling or routes.";

const clarifyProblemTypeText =
  "I’m not sure which you mean. Are you trying to solve employee scheduling (shifts, people, availability) " +
  "or route optimization (deliveries, warehouses, vehicles)? " +
  "Reply with a short phrase—for example “scheduling” or “routes.”";

const scheduleIntroText =
  "Describe your scheduling needs in plain language: who can work, what skills they have, which duties or shifts must be covered, and any time off or preferences. " +
  "I will ask follow-up questions until the plan is complete.\n\n" +
  SCHEDULE_DEMO_LIMITS_MESSAGE +
  " When the plan is ready, you will choose **single-day** or **multi-day**; then the solved timeline appears below.";

/** Max time for warm-up GET + wait + final GET + insights after POST. */
const ROUTE_LOAD_TIMEOUT_MS = 120_000;

/** Wait between first GET (after POST) and final GET so the solver can finish. */
const SOLVER_WAIT_MS = 30_000;

/** Wait after POST /schedules/problem before GET /schedules/{jobId}. */
const SCHEDULE_PROBLEM_WAIT_MS = 7_000;

type ProblemType = "unset" | "routing" | "scheduling";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(id);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort);
  });
}

/** Only warehouse and delivery pins are quota-driven from the API. */
const pinKinds: MapPinKind[] = ["warehouse", "delivery"];

function classifyProblemIntent(text: string): "routing" | "scheduling" | "ambiguous" {
  const t = text.toLowerCase();
  const sched =
    /\bschedul(ing|e)?\b|\bshift(s)?\b|\bemployee(s)?\b|\bstaff(ing)?\b|\broster\b|\brota\b|\bavailability\b|\btime ?off\b|\bunavailable\b|\b(cover|work)\s+(a\s+)?shift\b|\bnight\s+shift\b|\bweekend\s+work\b|\bteam\s+schedule\b/.test(
      t,
    );
  const route =
    /\broute(s|ing)?\b|\bdeliver(y|ies|ing)?\b|\bwarehouse(s)?\b|\bvehicle(s)?\b|\btruck(s)?\b|\bvan(s)?\b|\bfleet\b|\bmap\b|\baddress(es)?\b|\bstop(s)?\b|\bgps\b|\btransport(ing)?\b|\bparcel(s)?\b|\bpackage(s)?\b|\bcargo\b/.test(
      t,
    );

  if (sched && !route) {
    return "scheduling";
  }
  if (route && !sched) {
    return "routing";
  }
  if (sched && route) {
    if (/\bemployee\s+schedul|staff\s+shift|shift\s+plan|work\s+schedul\b/i.test(text)) {
      return "scheduling";
    }
    if (/\bvehicle\s+rout|delivery\s+rout|route\s+optim|optimize\s+rout|multi[\s-]*stop\b/i.test(text)) {
      return "routing";
    }
    return "ambiguous";
  }
  const w = t.trim();
  if (/^(scheduling|schedule|shifts|employees|staff|roster)$/i.test(w)) {
    return "scheduling";
  }
  if (/^(routing|routes?|deliveries|delivery|vehicles|map)$/i.test(w)) {
    return "routing";
  }
  return "ambiguous";
}

/** Clears both domains so entering routing or scheduling from the welcome step starts clean. */
function createInitialWelcomeMessage(): ChatMessage {
  return { id: crypto.randomUUID(), role: "assistant", text: welcomeIntroText };
}

export function ChatPanel() {
  const [problemType, setProblemType] = useState<ProblemType>("unset");
  const [phase, setPhase] = useState<"chat" | "map">("chat");
  const [routeProblem, setRouteProblem] = useState<RouteProblemResponse | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>(() => [createInitialWelcomeMessage()]);
  const [draft, setDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  /** User lines sent so far; combined and re-sent to extraction until all counts are positive. */
  const [extractionMessageParts, setExtractionMessageParts] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [activePinKind, setActivePinKind] = useState<MapPinKind>("warehouse");
  const [mapPins, setMapPins] = useState<MapPin[]>([]);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const [sendError, setSendError] = useState<string | null>(null);
  const [sendLoading, setSendLoading] = useState(false);
  const [fetchResultLoading, setFetchResultLoading] = useState(false);
  const [optimalRoute, setOptimalRoute] = useState<OptimalRoutePlan | null>(null);
  /** Top 3 Gemini post-optimization suggestions (shown under Route analysis, not in chat). */
  const [actionInsights, setActionInsights] = useState<string[] | null>(null);
  const [actionInsightsLoading, setActionInsightsLoading] = useState(false);
  const [actionInsightsError, setActionInsightsError] = useState<string | null>(null);
  /** Skip duplicate Gemini calls when reloading the same job id. */
  const insightsFetchedForJobIdRef = useRef<string | null>(null);

  /** Combined user lines for schedule extraction (same pattern as routing). */
  const [extractionScheduleParts, setExtractionScheduleParts] = useState<string[]>([]);
  /** Last complete planning JSON (employees + flights). */
  const [schedulePlanningDraft, setSchedulePlanningDraft] = useState<SchedulePlanningPayload | null>(null);
  const [schedulingChatLoading, setSchedulingChatLoading] = useState(false);
  const [scheduleOptimizing, setScheduleOptimizing] = useState(false);
  const [scheduleJobId, setScheduleJobId] = useState<string | null>(null);
  const [scheduleSolveResult, setScheduleSolveResult] = useState<ScheduleProblemSolveResponse | null>(null);
  const [scheduleSolveError, setScheduleSolveError] = useState<string | null>(null);
  const [scheduleRetryLoading, setScheduleRetryLoading] = useState(false);
  /** After a complete extract, wait for a clear single vs multi reply before POST. */
  const [awaitingScheduleDayMode, setAwaitingScheduleDayMode] = useState(false);
  /** Remembers single vs multi for “re-optimize” after a successful solve. */
  const [lastScheduleDayMode, setLastScheduleDayMode] = useState<ScheduleDayMode | null>(null);
  /**
   * First schedule POST uses **flights** (same as extract); after a successful solve, later POSTs use **shifts**
   * unless the plan is refreshed from chat (reset). Roster re-optimize always passes `useShiftsWire: true`.
   */
  const [schedulePostUseShiftsWire, setSchedulePostUseShiftsWire] = useState(false);
  const [scheduleSolveInsights, setScheduleSolveInsights] = useState<string[] | null>(null);
  const [scheduleSolveInsightsLoading, setScheduleSolveInsightsLoading] = useState(false);
  const [scheduleSolveInsightsError, setScheduleSolveInsightsError] = useState<string | null>(null);

  const selectedPin = useMemo(
    () => (selectedPinId === null ? null : mapPins.find((p) => p.id === selectedPinId) ?? null),
    [mapPins, selectedPinId],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    subscribeScheduleSolveInsights((p) => {
      setScheduleSolveInsights(p.suggestions);
      setScheduleSolveInsightsError(p.error);
      setScheduleSolveInsightsLoading(false);
    });
    return () => {
      subscribeScheduleSolveInsights(null);
    };
  }, []);

  function replaceStateForChosenMode(mode: "routing" | "scheduling") {
    setProblemType(mode);
    setPhase("chat");
    setDraft("");
    setExtractionMessageParts([]);
    setRouteProblem(null);
    setChatError(null);
    setMapPins([]);
    setSelectedPinId(null);
    setOptimalRoute(null);
    insightsFetchedForJobIdRef.current = null;
    setActionInsights(null);
    setActionInsightsError(null);
    setSendError(null);
    setExtractionScheduleParts([]);
    setSchedulePlanningDraft(null);
    setScheduleOptimizing(false);
    setScheduleJobId(null);
    setScheduleSolveResult(null);
    setScheduleSolveError(null);
    setAwaitingScheduleDayMode(false);
    setLastScheduleDayMode(null);
    setSchedulePostUseShiftsWire(false);
    setScheduleSolveInsights(null);
    setScheduleSolveInsightsError(null);
    setScheduleSolveInsightsLoading(false);
  }

  async function handleWelcomeSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) {
      return;
    }

    const intent = classifyProblemIntent(text);
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text };

    if (intent === "ambiguous") {
      setDraft("");
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: crypto.randomUUID(), role: "assistant", text: clarifyProblemTypeText },
      ]);
      return;
    }

    const followUp = intent === "routing" ? introText : scheduleIntroText;
    setDraft("");
    replaceStateForChosenMode(intent);
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: crypto.randomUUID(), role: "assistant", text: followUp },
    ]);
  }

  async function handleRetryScheduleProblemFetch() {
    if (scheduleJobId === null) {
      return;
    }
    setScheduleRetryLoading(true);
    setScheduleSolveError(null);
    setScheduleSolveInsights(null);
    setScheduleSolveInsightsError(null);
    setScheduleSolveInsightsLoading(true);
    try {
      const solved = await fetchScheduleProblemResult(scheduleJobId);
      setScheduleSolveResult(solved);
    } catch (err) {
      setScheduleSolveError(err instanceof Error ? err.message : "Could not load solved schedule.");
      setScheduleSolveInsightsLoading(false);
    } finally {
      setScheduleRetryLoading(false);
    }
  }

  async function runScheduleSolverJob(
    payload: SchedulePlanningPayload,
    dayMode: ScheduleDayMode,
    options?: { skipDayModePromptOnError?: boolean; isRosterRerun?: boolean },
  ) {
    if (dayMode === "multi" && !flightsSatisfyMultiDayStartDateRule(payload.flights)) {
      setAwaitingScheduleDayMode(true);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: MULTI_DAY_MIN_DISTINCT_START_DAYS_MESSAGE,
        },
      ]);
      return;
    }

    setLastScheduleDayMode(dayMode);
    setScheduleSolveError(null);
    setScheduleSolveResult(null);
    setScheduleSolveInsights(null);
    setScheduleSolveInsightsError(null);
    setScheduleSolveInsightsLoading(false);
    setScheduleOptimizing(true);
    try {
      const useShiftsWire = schedulePostUseShiftsWire || options?.isRosterRerun === true;
      const outcome = await postScheduleProblem(payload, dayMode, { useShiftsWire });
      if (outcome.kind === "solved") {
        setScheduleJobId(null);
        setScheduleSolveResult(outcome.solved);
        setScheduleSolveInsightsLoading(true);
        setSchedulePostUseShiftsWire(true);
        const scoreLine = outcome.solved.scores?.scoreString ?? "—";
        const solvedLabel = dayMode === "multi" ? "Multi-day solve complete" : "Solved";
        const line = options?.isRosterRerun
          ? `Re-optimized (${dayMode === "multi" ? "multi-day" : "single-day"}). Score: ${scoreLine}. Updated timeline is below.`
          : `${solvedLabel}. Score: ${scoreLine}. Timeline is below.`;
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: line,
          },
        ]);
        return;
      }

      setScheduleJobId(outcome.jobId);
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), ROUTE_LOAD_TIMEOUT_MS);
      try {
        await sleep(SCHEDULE_PROBLEM_WAIT_MS, controller.signal);
        const solved = await fetchScheduleProblemResult(outcome.jobId, { signal: controller.signal });
        setScheduleSolveResult(solved);
        setScheduleSolveInsightsLoading(true);
        const scoreLine = solved.scores?.scoreString ?? "—";
        const line = options?.isRosterRerun
          ? `Re-optimized (job ${outcome.jobId}). Score: ${scoreLine}. Updated timeline is below.`
          : `Solved (job ${outcome.jobId}). Score: ${scoreLine}. Timeline is below.`;
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: line,
          },
        ]);
        setSchedulePostUseShiftsWire(true);
      } catch (err) {
        const failMsg =
          err instanceof Error && err.name === "AbortError"
            ? `Request timed out after ${ROUTE_LOAD_TIMEOUT_MS / 1000}s. You can retry fetching the result below.`
            : err instanceof Error
              ? err.message
              : "Could not load solved schedule.";
        setScheduleSolveError(failMsg);
        setScheduleSolveInsightsLoading(false);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: failMsg,
          },
        ]);
      } finally {
        window.clearTimeout(timeoutId);
      }
    } catch (err) {
      const emptyDaily = err instanceof PostScheduleEmptyDailyResponseError;
      const msg = err instanceof Error ? err.message : "Schedule problem service request failed.";
      if (!options?.skipDayModePromptOnError && !emptyDaily) {
        setAwaitingScheduleDayMode(true);
      }
      const assistantText =
        options?.skipDayModePromptOnError
          ? `Re-optimize failed: ${msg}`
          : emptyDaily
            ? `Solve completed with no usable plan: ${msg}`
            : `Could not start the solve (${msg}). The plan is still ready—reply **single** or **multi** to try again.`;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: assistantText,
        },
      ]);
    } finally {
      setScheduleOptimizing(false);
    }
  }

  async function handleSchedulingSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || schedulingChatLoading || scheduleOptimizing) {
      return;
    }

    setSchedulingChatLoading(true);
    setDraft("");
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text }]);

    try {
      if (awaitingScheduleDayMode && schedulePlanningDraft !== null) {
        const dayMode = tryParseScheduleDayMode(text);
        if (dayMode === null) {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "assistant", text: SCHEDULE_DAY_MODE_RETRY },
          ]);
          return;
        }
        setAwaitingScheduleDayMode(false);
        await runScheduleSolverJob(schedulePlanningDraft, dayMode);
        return;
      }

      if (
        schedulePlanningDraft !== null &&
        isLikelySoleDayModeMessage(text)
      ) {
        const m = tryParseScheduleDayMode(text);
        if (m !== null) {
          setAwaitingScheduleDayMode(false);
          await runScheduleSolverJob(schedulePlanningDraft, m);
          return;
        }
      }

      const isRefine = schedulePlanningDraft !== null;
      const nonRefineCombined = [...extractionScheduleParts, text].join("\n\n");
      const extractMessage = (() => {
        if (!isRefine || schedulePlanningDraft === null) {
          return nonRefineCombined;
        }
        const userInstruction =
          extractionScheduleParts.length > 0
            ? `${extractionScheduleParts.join("\n\n")}\n\n${text}`
            : text;
        return buildScheduleRefinementMessage(schedulePlanningDraft, userInstruction);
      })();

      const res = await postScheduleFromMessage({ message: extractMessage });
      if (!isScheduleExtractComplete(res)) {
        if (!isRefine) {
          setSchedulePlanningDraft(null);
          setLastScheduleDayMode(null);
          setSchedulePostUseShiftsWire(false);
        }
        setAwaitingScheduleDayMode(false);
        setExtractionScheduleParts((prev) => [...prev, text]);
        const followUp = buildMissingSchedulePrompt(res);
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", text: followUp },
        ]);
        return;
      }
      setExtractionScheduleParts([]);
      const payload: SchedulePlanningPayload = {
        employees: res.employees,
        flights: res.flights,
      };
      setSchedulePlanningDraft(payload);
      setSchedulePostUseShiftsWire(false);
      setScheduleSolveError(null);
      setScheduleSolveResult(null);
      setScheduleSolveInsights(null);
      setScheduleSolveInsightsError(null);
      setScheduleSolveInsightsLoading(false);

      // Prefer an explicit "single" / "multi" in this message, then remember last successful run, then ask.
      // (Do not clear lastScheduleDayMode on each complete extract, or we re-prompt and forget mode every time.)
      const fromReply = tryParseScheduleDayMode(text);
      if (fromReply !== null) {
        setAwaitingScheduleDayMode(false);
        await runScheduleSolverJob(payload, fromReply);
        return;
      }
      if (lastScheduleDayMode !== null) {
        setAwaitingScheduleDayMode(false);
        await runScheduleSolverJob(payload, lastScheduleDayMode);
        return;
      }

      setAwaitingScheduleDayMode(true);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", text: SCHEDULE_DAY_MODE_PROMPT },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", text: msg },
      ]);
    } finally {
      setSchedulingChatLoading(false);
    }
  }

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

    const combinedMessage = [...extractionMessageParts, text].join("\n\n");

    try {
      const res = await postRouteProblemFromMessage({ message: combinedMessage });
      if (!isRouteProblemComplete(res)) {
        setExtractionMessageParts((prev) => [...prev, text]);
        const missing = getMissingRouteFields(res);
        const followUp = buildMissingDetailsPrompt(missing);
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", text: followUp },
        ]);
        return;
      }
      if (exceedsDemoLimits(res)) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", text: DEMO_LIMIT_MESSAGE },
        ]);
        return;
      }
      setExtractionMessageParts([]);
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

  async function runOptimizedRoutePipeline(jobId: string) {
    setFetchResultLoading(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), ROUTE_LOAD_TIMEOUT_MS);
    try {
      try {
        await fetchRoutePlanResult(jobId, { signal: controller.signal });
      } catch {
        /* First GET may 404 or return NOT_SOLVING — warm-up only; final GET runs after wait. */
      }
      await sleep(SOLVER_WAIT_MS, controller.signal);
      const plan = await fetchRoutePlanResult(jobId, { signal: controller.signal });
      setOptimalRoute(plan);
      setSelectedPinId(null);

      if (insightsFetchedForJobIdRef.current !== jobId) {
        setActionInsights(null);
        setActionInsightsError(null);
        setActionInsightsLoading(true);
        try {
          const ins = await postOptimizationSuggestions(JSON.stringify(plan));
          insightsFetchedForJobIdRef.current = jobId;
          setActionInsights(ins.suggestions.slice(0, 3));
          setActionInsightsError(null);
        } catch (err) {
          setActionInsights(null);
          setActionInsightsError(
            err instanceof Error
              ? err.message
              : "Could not load AI suggestions. Check FuvarOpt and Gemini configuration.",
          );
        } finally {
          setActionInsightsLoading(false);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setSendError(
          `Optimizing the route timed out after ${ROUTE_LOAD_TIMEOUT_MS / 1000}s. The solver may still be running—try sending again in a moment.`,
        );
      } else {
        const msg = err instanceof Error ? err.message : "Could not load route result.";
        setSendError(msg);
      }
    } finally {
      window.clearTimeout(timeoutId);
      setFetchResultLoading(false);
    }
  }

  async function handleSendTimefold() {
    if (routeProblem === null) {
      return;
    }
    setSendError(null);
    setSendLoading(true);
    let jobId: string;
    try {
      const payload = buildTimefoldApiPayload(routeProblem, mapPins);
      jobId = await postRoutePlanJob(payload);
      insightsFetchedForJobIdRef.current = null;
      setOptimalRoute(null);
      setActionInsights(null);
      setActionInsightsError(null);
      setSelectedPinId(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Submit failed.";
      setSendError(msg);
      return;
    } finally {
      setSendLoading(false);
    }

    await runOptimizedRoutePipeline(jobId);
  }

  const warehouseUsed = routeProblem !== null ? countPins("warehouse") : 0;
  const deliveryUsed = routeProblem !== null ? countPins("delivery") : 0;

  const messageBubbles = (
    <>
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
    </>
  );

  return (
    <div className="relative flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      {fetchResultLoading && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-slate-950/85 backdrop-blur-sm"
          role="alertdialog"
          aria-busy="true"
          aria-live="polite"
          aria-label="Optimizing route"
        >
          <div
            className="h-14 w-14 animate-spin rounded-full border-4 border-brand-500/25 border-t-brand-400"
            aria-hidden
          />
          <p className="text-lg font-semibold tracking-tight text-white">Optimizing route</p>
          <p className="max-w-sm px-6 text-center text-sm text-slate-400">
            Checking the job and loading the optimized route. The map stays hidden until it is ready.
          </p>
        </div>
      )}
      {scheduleOptimizing && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-slate-950/85 backdrop-blur-sm"
          role="alertdialog"
          aria-busy="true"
          aria-live="polite"
          aria-label="Solving schedule"
        >
          <div
            className="h-14 w-14 animate-spin rounded-full border-4 border-brand-500/25 border-t-brand-400"
            aria-hidden
          />
          <p className="text-lg font-semibold tracking-tight text-white">Solving schedule</p>
          <p className="max-w-sm px-6 text-center text-sm text-slate-400">
            Your plan is being solved. This can take a little while, especially for multi-day runs.
          </p>
        </div>
      )}
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-emerald-700 text-sm font-bold text-slate-950">
          F
        </span>
        <div>
          <h1 className="text-sm font-semibold text-white">FuvarOpt</h1>
          <p className="text-xs text-slate-500">
            {problemType === "scheduling"
              ? "Schedule assistant"
              : problemType === "routing"
                ? "Route assistant"
                : "Getting started"}
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-3 sm:px-6 sm:py-4">
          {problemType === "unset" && (
            <section
              className="flex min-h-0 flex-1 flex-col pb-2"
              aria-label="What problem are you solving"
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-xl">
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6">
                  {messageBubbles}
                </div>

                <form
                  className="shrink-0 border-t border-white/10 bg-slate-950/60 p-4 sm:p-5"
                  onSubmit={handleWelcomeSubmit}
                >
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Describe your problem or say scheduling vs routes…"
                      rows={3}
                      className="min-h-[88px] w-full resize-y rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={!draft.trim()}
                        className="rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Send
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </section>
          )}

          {problemType === "scheduling" && (
            <section
              className="flex min-h-0 flex-1 flex-col gap-4 pb-2"
              aria-label="Employee scheduling"
            >
              <div className="flex min-h-0 min-h-[140px] flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-xl">
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6">
                  {messageBubbles}
                </div>
              </div>

              <div className="shrink-0 flex flex-col gap-4">
                {scheduleSolveError !== null && (
                  <div
                    className="flex flex-col gap-3 rounded-xl border border-rose-500/35 bg-rose-950/40 px-4 py-3 text-sm text-rose-100"
                    role="alert"
                  >
                    <p>{scheduleSolveError}</p>
                    {scheduleJobId !== null && scheduleSolveResult === null && (
                      <button
                        type="button"
                        disabled={scheduleRetryLoading || scheduleOptimizing}
                        onClick={() => void handleRetryScheduleProblemFetch()}
                        className="self-start rounded-lg border border-rose-400/40 bg-rose-900/50 px-4 py-2 text-xs font-semibold text-rose-50 transition hover:bg-rose-800/50 disabled:opacity-50"
                      >
                        {scheduleRetryLoading ? "Retrying…" : "Retry fetch result"}
                      </button>
                    )}
                  </div>
                )}

                {scheduleSolveResult !== null && (
                  <>
                    <ScheduleProblemTimeline result={scheduleSolveResult} />
                    <ScheduleInsightsReport
                      title="Fix constraint issues"
                      description="Suggestions from the analyze step (hard constraints first, then soft). From Gemini + your FuvarOpt API—review before changing the plan."
                      insights={scheduleSolveInsights}
                      loading={scheduleSolveInsightsLoading}
                      error={scheduleSolveInsightsError}
                      maxItems={10}
                    />
                    <ScheduleConstraintsPanel planning={schedulePlanningDraft} result={scheduleSolveResult} />
                    {schedulePlanningDraft !== null && (
                      <ScheduleEmployeeRosterEditor
                        payload={schedulePlanningDraft}
                        onPayloadChange={setSchedulePlanningDraft}
                        onReoptimize={() => {
                          void runScheduleSolverJob(
                            schedulePlanningDraft,
                            lastScheduleDayMode ?? "single",
                            {
                              skipDayModePromptOnError: true,
                              isRosterRerun: true,
                            },
                          );
                        }}
                        reoptimizeDisabled={scheduleOptimizing}
                        reoptimizeLabel={scheduleOptimizing ? "Optimizing…" : "Re-optimize with this roster"}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setScheduleSolveResult(null);
                        setScheduleJobId(null);
                        setScheduleSolveError(null);
                        setSchedulePostUseShiftsWire(false);
                        setScheduleSolveInsights(null);
                        setScheduleSolveInsightsError(null);
                        setScheduleSolveInsightsLoading(false);
                      }}
                      className="self-start rounded-xl border border-white/15 bg-slate-800/90 px-5 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700/90"
                    >
                      Clear solved timeline
                    </button>
                  </>
                )}
              </div>

              <form
                className="shrink-0 rounded-2xl border border-white/10 bg-slate-950/60 p-4 sm:p-5 shadow-xl"
                onSubmit={handleSchedulingSubmit}
                aria-label="Schedule chat — continue after timeline and insights"
              >
                {scheduleSolveResult !== null && (
                  <p className="mb-2 text-xs font-medium text-slate-500">
                    Continue the conversation — your message updates the plan (merge) and can re-run the solver.
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                    }}
                    placeholder={
                      awaitingScheduleDayMode
                        ? "single or multi — e.g. one day, multiple days, s, m…"
                        : schedulePlanningDraft !== null
                          ? "Describe changes to the current plan, or type single / multi to re-solve. Your edits merge into the plan JSON, then the solver runs again."
                          : "Answer the assistant’s questions…"
                    }
                    rows={3}
                    disabled={schedulingChatLoading || scheduleOptimizing}
                    className="min-h-[88px] w-full resize-y rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={schedulingChatLoading || scheduleOptimizing || !draft.trim()}
                      className="rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {schedulingChatLoading ? "Working…" : "Send"}
                    </button>
                  </div>
                </div>
              </form>
            </section>
          )}

          {problemType === "routing" && phase === "chat" && (
            <section
              className="flex min-h-0 flex-1 flex-col pb-2"
              aria-label="Delivery description"
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-xl">
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6">
                  {messageBubbles}
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
                      placeholder="Describe warehouses, addresses, and cars…"
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

          {problemType === "routing" && phase === "map" && routeProblem !== null && (
            <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:items-stretch">
              {optimalRoute === null && (
                <aside
                  className="flex max-h-[42dvh] min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 lg:max-h-none lg:max-w-[22rem] lg:h-[min(calc(100dvh-6rem),900px)]"
                  aria-label="Conversation"
                >
                  <div className="border-b border-white/10 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Conversation
                  </div>
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                    {messageBubbles}
                  </div>
                  <p className="border-t border-white/10 px-4 py-2 text-xs text-slate-500">
                    Read-only while you edit the map and routes.
                  </p>
                </aside>
              )}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
              <section className="flex min-h-0 flex-1 flex-col gap-4 pb-2" aria-label="Map placement">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-white">Place locations on the map</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      Set vehicles per warehouse and demand per delivery stop. Each vehicle holds up to{" "}
                      <span className="font-medium text-slate-200">{DEFAULT_VEHICLE_CAPACITY}</span> packages.
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
                            disabled={fetchResultLoading}
                            onClick={() => setActivePinKind(kind)}
                            title={atCap ? "At maximum for this type" : undefined}
                            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
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
                      Clear the route result below to edit pins. You can submit a new job after clearing.
                    </p>
                  </div>
                )}

                {fetchResultLoading ? (
                  <div
                    className="flex h-[min(55vh,520px)] min-h-[280px] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-slate-900/80 ring-1 ring-white/5"
                    role="status"
                    aria-live="polite"
                  >
                    <p className="text-sm font-medium text-slate-300">Map hidden during optimization</p>
                    <p className="max-w-xs px-4 text-center text-xs text-slate-500">
                      The route appears here after the final fetch completes.
                    </p>
                  </div>
                ) : (
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
                )}

                {optimalRoute !== null && (
                  <RouteAnalysisReport
                    plan={optimalRoute}
                    actionInsights={actionInsights}
                    actionInsightsLoading={actionInsightsLoading}
                    actionInsightsError={actionInsightsError}
                  />
                )}

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
                            Packages to deliver here (shown on the map pin). Each vehicle holds up to{" "}
                            {DEFAULT_VEHICLE_CAPACITY} packages.
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
                        insightsFetchedForJobIdRef.current = null;
                        setActionInsights(null);
                        setActionInsightsError(null);
                        setSelectedPinId(null);
                      }}
                      className="rounded-xl border border-white/15 bg-slate-800/90 px-5 py-3 text-sm font-medium text-slate-200 transition hover:bg-slate-700/90"
                    >
                      Clear route result
                    </button>
                  )}
                  {optimalRoute === null && (
                    <button
                      type="button"
                      disabled={sendLoading || fetchResultLoading}
                      onClick={() => void handleSendTimefold()}
                      className="rounded-xl bg-brand-500 px-8 py-3 text-sm font-semibold text-slate-950 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sendLoading ? "Sending…" : "Send"}
                    </button>
                  )}
                </div>
              </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
