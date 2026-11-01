import { TtlCache } from "../cache";
import { runAgent, Limiter, TinyFishError } from "../tinyfish";
import { buildStoreBasket, compareBaskets } from "./basket";
import { AGENT_MAX_SECONDS, OUTPUT_SCHEMA, buildGoal, failedResult, normalizeAgentOutput } from "./goals";
import { ENABLED_PROVIDERS } from "./providers";
import type { BasketLine, FastBasketResponse, LineResult, ProviderConfig, ProviderResult } from "./types";

const TEN_MIN = 10 * 60_000;
/** Cap concurrent fast-commerce agent runs (cost protection). */
const agentLimiter = new Limiter(4);

type Meta = Pick<ProviderResult, "fees" | "etaText" | "etaMinutes" | "locationEvidence" | "locationVerified" | "runId" | "checkedAt">;
const lineCache = new TtlCache<LineResult>(TEN_MIN, 500);
const metaCache = new TtlCache<Meta>(TEN_MIN, 100);

export const cacheKey = (providerId: string, pincode: string, query: string) => `${providerId}|${pincode}|${query.toLowerCase().trim()}`;

export function clearFastCache(): void {
  lineCache.clear();
  metaCache.clear();
}

/** Run (or serve from the 10-minute (pincode, query) cache) one provider's lookup for a list of queries. */
export async function lookupProvider(
  provider: ProviderConfig,
  pincode: string,
  queries: string[],
): Promise<{ result: ProviderResult; cached: boolean }> {
  const hits = new Map<string, LineResult>();
  for (const q of queries) {
    const h = lineCache.get(cacheKey(provider.id, pincode, q));
    if (h) hits.set(q, h);
  }
  const missing = queries.filter((q) => !hits.has(q));
  let fresh: ProviderResult | null = null;

  if (missing.length) {
    try {
      const run = await agentLimiter.run(() =>
        runAgent({
          url: provider.homeUrl,
          goal: buildGoal(provider, pincode, missing),
          outputSchema: OUTPUT_SCHEMA,
          maxDurationSeconds: AGENT_MAX_SECONDS,
          pollIntervalMs: 4000,
          overallTimeoutMs: (AGENT_MAX_SECONDS + 30) * 1000,
        }),
      );
      if (run.status === "COMPLETED") fresh = normalizeAgentOutput(provider, missing, run.result, run.runId);
      else if (run.status === "CANCELLED") fresh = failedResult(provider, missing, "cancelled", null, run.runId);
      else fresh = failedResult(provider, missing, "error", run.error, run.runId);
    } catch (e) {
      // Config / auth / credits problems are the caller's to report; per-run failures become honest states.
      if (e instanceof TinyFishError && e.kind === "timeout") fresh = failedResult(provider, missing, "timeout", null);
      else if (e instanceof TinyFishError && (e.kind === "unavailable" || e.kind === "network" || e.kind === "upstream")) fresh = failedResult(provider, missing, "error", e.message);
      else throw e;
    }
    if (fresh.state === "ok" || fresh.state === "partial" || fresh.state === "no_results") {
      for (const l of fresh.lines) lineCache.set(cacheKey(provider.id, pincode, l.query), l);
      metaCache.set(`${provider.id}|${pincode}`, {
        fees: fresh.fees,
        etaText: fresh.etaText,
        etaMinutes: fresh.etaMinutes,
        locationEvidence: fresh.locationEvidence,
        locationVerified: fresh.locationVerified,
        runId: fresh.runId,
        checkedAt: fresh.checkedAt,
      });
    } else {
      return { result: { ...fresh, lines: queries.map((q) => ({ query: q, resolution: "not_checked" as const, offer: null, rejected: [], note: "Not checked." })) }, cached: false };
    }
  }

  const m: Meta | null = fresh ?? metaCache.get(`${provider.id}|${pincode}`) ?? null;
  if (!m) return { result: failedResult(provider, queries, "error", "cached data expired"), cached: false };
  const freshByQ = new Map((fresh?.lines ?? []).map((l) => [l.query, l]));
  const lines = queries.map((q) => hits.get(q) ?? freshByQ.get(q)!);
  const found = lines.filter((l) => l.resolution === "found").length;
  const state = found === lines.length ? "ok" : found === 0 && lines.every((l) => l.resolution === "no_match" || l.resolution === "mismatch") ? "no_results" : "partial";
  return {
    cached: missing.length === 0,
    result: {
      providerId: provider.id,
      providerName: provider.name,
      state,
      reason: state === "ok" ? "" : state === "no_results" ? "no products were found" : "some items were unavailable or could not be matched exactly",
      locationVerified: m.locationVerified,
      locationEvidence: m.locationEvidence,
      runId: m.runId,
      lines,
      fees: m.fees,
      etaText: m.etaText,
      etaMinutes: m.etaMinutes,
      checkedAt: m.checkedAt,
      homeUrl: provider.homeUrl,
    },
  };
}

export async function compareFast(pincode: string, lines: BasketLine[]): Promise<FastBasketResponse> {
  const providers = ENABLED_PROVIDERS();
  const queries = lines.map((l) => l.query);
  const outs = await Promise.all(providers.map((p) => lookupProvider(p, pincode, queries)));
  const results = outs.map((o) => o.result);
  const baskets = results.map((r) => buildStoreBasket(r, lines));
  return {
    pincode,
    lines,
    providers: results,
    baskets,
    comparison: compareBaskets(baskets, lines),
    generatedAt: new Date().toISOString(),
    cached: outs.every((o) => o.cached),
  };
}
