import { AsyncLocalStorage } from "node:async_hooks";
import type { SearchUsage } from "../search";
import { getCostConfig } from "./config";

/** Per-request cost context: carries the user's fresh-check choice down and collects every inner search's usage. */
export interface CostContext {
  fresh: boolean;
  usages: SearchUsage[];
  /** optional live forwarder of real pipeline steps (research monitor stream) */
  onStep?: (label: string, status: "ok" | "warn" | "error") => void;
}
export const costContext = new AsyncLocalStorage<CostContext>();

export async function withCostContext<T>(fresh: boolean, fn: () => Promise<T>, onStep?: CostContext["onStep"]): Promise<{ result: T; usage: UsageSummary }> {
  const store: CostContext = { fresh, usages: [], onStep };
  const t0 = Date.now();
  const result = await costContext.run(store, fn);
  return { result, usage: summarizeUsage(store.usages, Date.now() - t0, fresh) };
}

/** Telemetry for one user request (may contain several product searches). Every number is counted, not estimated. */
export interface UsageSummary {
  productSearches: number;
  cacheHits: number;
  sharedInFlight: number;
  freshCheck: boolean;
  routing: string;
  tinyfishSearchRequests: number;
  discoveryCacheHits: number;
  tinyfishFetchUrls: number;
  paidAgentRuns: number;
  paidAgentSteps: number;
  agentRunsWithoutStepCount: number;
  agentSkipped: Record<string, number>;
  earlyStopped: boolean;
  verifiedRetailers: string[];
  retailersSearched: string[];
  latencyMs: number;
  timeToFirstVerifiedPriceMs: number | null;
  priceMaxAgeSeconds: number;
  cost: {
    /** steps × rate; null if an agent run returned no step count (then the cost is unknown, not zero) */
    computedUsd: number | null;
    usdPerAgentStep: number;
    basis: string;
    billed: string;
  };
}

export function summarizeUsage(usages: SearchUsage[], latencyMs: number, fresh: boolean): UsageSummary {
  const cfg = getCostConfig();
  const sum = (f: (u: SearchUsage) => number) => usages.reduce((a, u) => a + f(u), 0);
  const skipped: Record<string, number> = {};
  for (const u of usages) for (const [k, v] of Object.entries(u.agentSkipped)) skipped[k] = (skipped[k] ?? 0) + (v ?? 0);
  const steps = sum((u) => u.agentSteps);
  const unmetered = sum((u) => u.agentRunsWithoutStepCount);
  const ttfr = usages.map((u) => u.timeToFirstVerifiedPriceMs).filter((x): x is number => x !== null);
  return {
    productSearches: usages.length,
    cacheHits: usages.filter((u) => u.cache === "hit").length,
    sharedInFlight: usages.filter((u) => u.cache === "joined").length,
    freshCheck: fresh,
    routing: usages[0]?.routing ?? cfg.routing,
    tinyfishSearchRequests: sum((u) => u.searchCalls),
    discoveryCacheHits: sum((u) => u.discoveryCacheHits),
    tinyfishFetchUrls: sum((u) => u.fetchUrls),
    paidAgentRuns: sum((u) => u.agentRuns),
    paidAgentSteps: steps,
    agentRunsWithoutStepCount: unmetered,
    agentSkipped: skipped,
    earlyStopped: usages.some((u) => u.earlyStopped),
    verifiedRetailers: [...new Set(usages.flatMap((u) => u.verifiedRetailers))],
    retailersSearched: [...new Set(usages.flatMap((u) => u.retailersSearched))],
    latencyMs,
    timeToFirstVerifiedPriceMs: ttfr.length ? Math.min(...ttfr) : null,
    priceMaxAgeSeconds: Math.max(0, ...usages.map((u) => u.priceMaxAgeSeconds)),
    cost: {
      computedUsd: unmetered > 0 ? null : Math.round(steps * cfg.usdPerAgentStep * 10_000) / 10_000,
      usdPerAgentStep: cfg.usdPerAgentStep,
      basis: `Calculated: provider-metered agent steps × $${cfg.usdPerAgentStep}/step (TinyFish Agent rate). TinyFish Search and Fetch are $0.`,
      billed: "Actual billed cost is shown in the TinyFish dashboard/wallet; this app does not read the bill.",
    },
  };
}
