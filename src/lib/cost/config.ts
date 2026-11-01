/**
 * Cost / execution budgets for paid TinyFish Agent runs. All values come from server env (never NEXT_PUBLIC_*).
 *
 * Pricing facts (TinyFish wallet rates, read 2026-11-01): Agent = $0.016 per step; Search and Fetch = $0.
 * A run's real cost is only known after it finishes (num_of_steps). Timeouts and max_duration bound run
 * TIME, not money: they do not guarantee a strict monetary limit. The daily budget gate checks spend so far
 * plus a per-run reserve before starting a run, so a single run can overshoot the budget by its own steps.
 */
export type RoutingMode = "adaptive" | "legacy";

export interface CostConfig {
  routing: RoutingMode;
  /** Max paid Agent runs per search request. */
  agentMaxPerSearch: number;
  /** Max paid Agent runs in flight at once (process-wide). */
  agentMaxConcurrent: number;
  /** Max paid Agent runs per UTC day (process-wide). */
  agentDailyMaxRuns: number;
  /** Daily paid budget in USD (computed from metered steps). null = no USD cap. */
  agentDailyBudgetUsd: number | null;
  /** Steps reserved per run when checking the daily budget before a run starts. */
  agentReserveSteps: number;
  agentMaxDurationS: number;
  agentOverallTimeoutMs: number;
  fetchTimeoutMs: number;
  /** Only send an Agent to a listing whose title matches the query at least this well. */
  agentMinMatchConfidence: number;
  /** Early stop: once this many distinct retailers have a verified price for the product, no more Agent runs. */
  targetVerifiedRetailers: number;
  /** Freshness tolerance for price observations (app cache and TinyFish Fetch ttl). */
  priceTtlS: number;
  /** Product identity (title/image/specs) cache. */
  specTtlS: number;
  /** Which product pages a retailer search returned (discovery). */
  discoveryTtlS: number;
  /** USD per Agent step used to compute cost from metered steps. */
  usdPerAgentStep: number;
  /** Daily USD level that flags a cost alert in analytics. */
  alertDailyUsd: number;
}

function num(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
function optNum(name: string, def: number | null, min: number, max: number): number | null {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === "off" || raw === "none") return null;
  return raw ? num(name, def ?? 0, min, max) : def;
}

export function getCostConfig(): CostConfig {
  const routing = process.env.PP_ROUTING?.trim().toLowerCase() === "legacy" ? "legacy" : "adaptive";
  return {
    routing,
    agentMaxPerSearch: Math.round(num("PP_AGENT_MAX_PER_SEARCH", 2, 0, 10)),
    agentMaxConcurrent: Math.round(num("PP_AGENT_MAX_CONCURRENT", 2, 1, 10)),
    agentDailyMaxRuns: Math.round(num("PP_AGENT_DAILY_MAX_RUNS", 100, 0, 100_000)),
    agentDailyBudgetUsd: optNum("PP_AGENT_DAILY_BUDGET_USD", 2, 0, 10_000),
    agentReserveSteps: Math.round(num("PP_AGENT_RESERVE_STEPS", 10, 1, 200)),
    agentMaxDurationS: Math.round(num("PP_AGENT_MAX_DURATION_S", 75, 15, 300)),
    agentOverallTimeoutMs: Math.round(num("PP_AGENT_TIMEOUT_MS", 100_000, 20_000, 300_000)),
    fetchTimeoutMs: Math.round(num("PP_FETCH_TIMEOUT_MS", 45_000, 5_000, 110_000)),
    agentMinMatchConfidence: num("PP_AGENT_MIN_MATCH", 0.8, 0.5, 1),
    targetVerifiedRetailers: Math.round(num("PP_TARGET_VERIFIED_RETAILERS", 2, 1, 5)),
    priceTtlS: Math.round(num("PP_PRICE_TTL_S", 900, 0, 86_400)),
    specTtlS: Math.round(num("PP_SPEC_TTL_S", 86_400, 60, 7 * 86_400)),
    discoveryTtlS: Math.round(num("PP_DISCOVERY_TTL_S", 21_600, 0, 7 * 86_400)),
    usdPerAgentStep: num("PP_USD_PER_AGENT_STEP", 0.016, 0, 10),
    alertDailyUsd: num("PP_COST_ALERT_USD", 1, 0, 10_000),
  };
}
