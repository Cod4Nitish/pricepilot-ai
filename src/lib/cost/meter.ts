import { getCostConfig } from "./config";

/**
 * Process-wide cost meter (in memory; survives dev HMR via globalThis). On serverless each instance has its own
 * counters and they reset on cold start: analytics describe THIS instance since `since`. Supabase is not used yet.
 */
export type AgentSkipReason =
  | "target_met"
  | "retailer_already_verified"
  | "low_match_confidence"
  | "blocked_or_login"
  | "not_relevant_retailer"
  | "duplicate_product"
  | "per_search_cap"
  | "daily_run_cap"
  | "daily_budget"
  | "credits_exhausted"
  | "cached_observation";

export interface DayUsage {
  date: string; // UTC YYYY-MM-DD
  agentRuns: number;
  agentSteps: number;
  /** runs whose step count the provider did not return */
  unmeteredRuns: number;
}

interface State {
  since: string;
  searches: number;
  cacheHits: number;
  inflightJoins: number;
  freshChecks: number;
  searchCalls: number;
  fetchCalls: number;
  fetchUrls: number;
  agentRuns: number;
  agentCompleted: number;
  agentFailed: number;
  agentTimedOut: number;
  agentSteps: number;
  unmeteredRuns: number;
  agentInFlight: number;
  skipped: Partial<Record<AgentSkipReason, number>>;
  verifiedComparisons: number;
  searchesWithVerified: number;
  retailers: Record<string, { searched: number; verified: number }>;
  ttfrMs: number[];
  latencyMs: number[];
  day: DayUsage;
}

const today = () => new Date().toISOString().slice(0, 10);
const emptyDay = (): DayUsage => ({ date: today(), agentRuns: 0, agentSteps: 0, unmeteredRuns: 0 });
const fresh = (): State => ({
  since: new Date().toISOString(),
  searches: 0,
  cacheHits: 0,
  inflightJoins: 0,
  freshChecks: 0,
  searchCalls: 0,
  fetchCalls: 0,
  fetchUrls: 0,
  agentRuns: 0,
  agentCompleted: 0,
  agentFailed: 0,
  agentTimedOut: 0,
  agentSteps: 0,
  unmeteredRuns: 0,
  agentInFlight: 0,
  skipped: {},
  verifiedComparisons: 0,
  searchesWithVerified: 0,
  retailers: {},
  ttfrMs: [],
  latencyMs: [],
  day: emptyDay(),
});

const g = globalThis as unknown as { __ppCostMeter?: State };
function st(): State {
  if (!g.__ppCostMeter) g.__ppCostMeter = fresh();
  const s = g.__ppCostMeter;
  if (s.day.date !== today()) s.day = emptyDay();
  return s;
}
export function resetMeter(): void {
  g.__ppCostMeter = fresh();
}
const pushCapped = (a: number[], v: number) => {
  a.push(v);
  if (a.length > 500) a.shift();
};
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export const meter = {
  searchCall(): void {
    st().searchCalls++;
  },
  fetchCall(urls: number): void {
    const s = st();
    s.fetchCalls++;
    s.fetchUrls += urls;
  },
  /** Gate checked right before a paid Agent run starts (process-wide daily limits). */
  canStartAgent(): { ok: true } | { ok: false; reason: "daily_run_cap" | "daily_budget"; message: string } {
    const cfg = getCostConfig();
    const s = st();
    if (s.day.agentRuns >= cfg.agentDailyMaxRuns) {
      return { ok: false, reason: "daily_run_cap", message: `Daily paid agent run limit (${cfg.agentDailyMaxRuns}) reached.` };
    }
    if (cfg.agentDailyBudgetUsd !== null) {
      // steps of runs still in flight (and of this one) are unknown: reserve them
      const projected = (s.day.agentSteps + (s.agentInFlight + 1) * cfg.agentReserveSteps) * cfg.usdPerAgentStep;
      if (projected > cfg.agentDailyBudgetUsd) {
        return { ok: false, reason: "daily_budget", message: `Daily paid agent budget ($${cfg.agentDailyBudgetUsd.toFixed(2)}) would be exceeded.` };
      }
    }
    return { ok: true };
  },
  agentStart(): void {
    const s = st();
    s.agentRuns++;
    s.agentInFlight++;
    s.day.agentRuns++;
  },
  agentEnd(outcome: "completed" | "failed" | "timeout", steps: number | null): void {
    const s = st();
    s.agentInFlight = Math.max(0, s.agentInFlight - 1);
    if (outcome === "completed") s.agentCompleted++;
    else if (outcome === "timeout") s.agentTimedOut++;
    else s.agentFailed++;
    if (steps === null) {
      s.unmeteredRuns++;
      s.day.unmeteredRuns++;
    } else {
      s.agentSteps += steps;
      s.day.agentSteps += steps;
    }
  },
  skip(reason: AgentSkipReason, n = 1): void {
    if (n <= 0) return;
    const s = st();
    s.skipped[reason] = (s.skipped[reason] ?? 0) + n;
  },
  searchStarted(kind: "miss" | "hit" | "joined", freshCheck: boolean): void {
    const s = st();
    s.searches++;
    if (kind === "hit") s.cacheHits++;
    if (kind === "joined") s.inflightJoins++;
    if (freshCheck) s.freshChecks++;
  },
  searchFinished(o: { latencyMs: number; ttfrMs: number | null; retailersSearched: string[]; retailersVerified: string[] }): void {
    const s = st();
    pushCapped(s.latencyMs, o.latencyMs);
    if (o.ttfrMs !== null) pushCapped(s.ttfrMs, o.ttfrMs);
    for (const r of o.retailersSearched) {
      s.retailers[r] ??= { searched: 0, verified: 0 };
      s.retailers[r].searched++;
    }
    for (const r of o.retailersVerified) {
      s.retailers[r] ??= { searched: 0, verified: 0 };
      s.retailers[r].verified++;
    }
    if (o.retailersVerified.length >= 1) s.searchesWithVerified++;
    if (o.retailersVerified.length >= 2) s.verifiedComparisons++;
  },
  snapshot() {
    const cfg = getCostConfig();
    const s = st();
    const usd = (steps: number) => round4(steps * cfg.usdPerAgentStep);
    const pct = (a: number[], p: number) => {
      if (!a.length) return null;
      const x = [...a].sort((m, n) => m - n);
      return x[Math.min(x.length - 1, Math.floor((p / 100) * x.length))];
    };
    const computed = usd(s.agentSteps);
    return {
      scope: "This server instance only, in memory, since `since` (resets on restart / serverless cold start).",
      since: s.since,
      searches: s.searches,
      cacheHits: s.cacheHits,
      inflightJoins: s.inflightJoins,
      cacheHitRate: s.searches ? Math.round(((s.cacheHits + s.inflightJoins) / s.searches) * 1000) / 1000 : null,
      freshChecks: s.freshChecks,
      tinyfish: {
        searchCalls: s.searchCalls,
        fetchCalls: s.fetchCalls,
        fetchUrls: s.fetchUrls,
        agentRuns: s.agentRuns,
        agentCompleted: s.agentCompleted,
        agentFailed: s.agentFailed,
        agentTimedOut: s.agentTimedOut,
        agentInFlight: s.agentInFlight,
        agentSteps: s.agentSteps,
        agentRunsWithoutStepCount: s.unmeteredRuns,
      },
      agentSkipped: s.skipped,
      cost: {
        computedAgentUsd: computed,
        basis: `Computed: metered num_of_steps × $${cfg.usdPerAgentStep}/step (TinyFish Agent rate). Search/Fetch are $0. Not a wallet reading; runs without a step count are not included.`,
        costPerVerifiedComparisonUsd: s.verifiedComparisons ? round4(computed / s.verifiedComparisons) : null,
        today: { ...s.day, computedUsd: usd(s.day.agentSteps) },
        alert: usd(s.day.agentSteps) >= cfg.alertDailyUsd ? `Computed agent spend today is at or above $${cfg.alertDailyUsd}.` : null,
      },
      outcomes: {
        searchesWithVerifiedPrice: s.searchesWithVerified,
        verifiedComparisons: s.verifiedComparisons,
        verifiedComparisonDefinition: "A search where at least 2 distinct retailers had a verified price for a confidently matched product.",
      },
      retailerCoverage: s.retailers,
      latencyMs: { p50: pct(s.latencyMs, 50), p90: pct(s.latencyMs, 90), samples: s.latencyMs.length },
      timeToFirstVerifiedPriceMs: { p50: pct(s.ttfrMs, 50), p90: pct(s.ttfrMs, 90), samples: s.ttfrMs.length },
      budgets: {
        routing: cfg.routing,
        agentMaxPerSearch: cfg.agentMaxPerSearch,
        agentMaxConcurrent: cfg.agentMaxConcurrent,
        agentDailyMaxRuns: cfg.agentDailyMaxRuns,
        agentDailyBudgetUsd: cfg.agentDailyBudgetUsd,
        agentMaxDurationS: cfg.agentMaxDurationS,
        agentMinMatchConfidence: cfg.agentMinMatchConfidence,
        targetVerifiedRetailers: cfg.targetVerifiedRetailers,
        priceTtlS: cfg.priceTtlS,
        discoveryTtlS: cfg.discoveryTtlS,
        note: "Timeouts bound run time, not money. The daily budget is checked before each run starts, so one run can overshoot it by its own steps.",
      },
    };
  },
};
