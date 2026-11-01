"use client";
import type { UsageSummary } from "@/lib/cost/context";

const SKIP_WORDS: Record<string, string> = {
  target_met: "stopped early: enough retailers verified",
  retailer_already_verified: "retailer already verified without an agent",
  low_match_confidence: "skipped: product match confidence too low",
  blocked_or_login: "skipped: page blocked or needs a login",
  not_relevant_retailer: "skipped: retailer not relevant to this product",
  duplicate_product: "skipped: duplicate product page",
  per_search_cap: "skipped: per-search agent cap reached",
  daily_run_cap: "skipped: daily agent run cap reached",
  daily_budget: "skipped: daily agent budget reached",
  credits_exhausted: "skipped: TinyFish credits exhausted",
  cached_observation: "skipped: recent cached price reused",
};
const skipWords = (k: string) => SKIP_WORDS[k] ?? k.replace(/_/g, " ");

export function cacheStatus(u: UsageSummary, responseCached: boolean): { label: string; detail: string } {
  if (u.freshCheck) return { label: "Fresh", detail: "User-requested fresh check: caches bypassed." };
  if (responseCached || (u.productSearches > 0 && u.cacheHits === u.productSearches)) return { label: "Cached", detail: "Served from a recent cached comparison." };
  if (u.sharedInFlight > 0) return { label: "Shared", detail: "Joined an identical search already in progress." };
  return { label: "Live", detail: "Prices read live for this request." };
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
function age(s: number) {
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-white/75">{label}</dt>
      <dd className="tabular break-words text-base font-semibold text-white">{value}</dd>
    </div>
  );
}

/** Measured TinyFish telemetry for this request. Every number comes from usage; nothing is estimated here. */
export default function ResearchCostPanel({ usage, cached }: { usage: UsageSummary; cached: boolean }) {
  const u = usage;
  const cs = cacheStatus(u, cached);
  const skipped = Object.entries(u.agentSkipped).filter(([, n]) => n > 0);
  const stages = [
    { name: "Cache", value: `${u.cacheHits} hit${u.cacheHits === 1 ? "" : "s"}${u.discoveryCacheHits ? ` + ${u.discoveryCacheHits} discovery` : ""}` },
    { name: "Search", value: `${u.tinyfishSearchRequests} request${u.tinyfishSearchRequests === 1 ? "" : "s"}` },
    { name: "Fetch", value: `${u.tinyfishFetchUrls} URL${u.tinyfishFetchUrls === 1 ? "" : "s"}` },
    { name: "Paid Agent", value: `${u.paidAgentRuns} run${u.paidAgentRuns === 1 ? "" : "s"}` },
  ];
  return (
    <section aria-label="Research cost" className="space-y-4 rounded-[1.1rem] border border-[#101827] bg-[#101827] p-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-white">Research cost</p>
        <span className="inline-flex items-center rounded-full border border-white/60 px-2.5 py-1 text-xs font-semibold">
          <span className="sr-only">Cache status: </span>
          {cs.label}
        </span>
      </div>

      <div>
        <p className="font-display text-3xl font-extrabold tabular">
          {u.cost.computedUsd === null ? "Unknown (step count not returned)" : `$${u.cost.computedUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`}
        </p>
        <p className="mt-1 text-xs text-white/80">{u.cost.basis}</p>
        <p className="mt-0.5 text-xs text-white/80">{u.cost.billed}</p>
      </div>

      <div>
        <p className="text-xs text-white/80">Cache → Search → Fetch → Paid Agent only when required</p>
        <ol className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stages.map((s, i) => (
            <li key={s.name} className="rounded-xl border border-white/25 px-2.5 py-2">
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-white/75">{i + 1}. {s.name}</p>
              <p className="tabular text-sm font-semibold">{s.value}</p>
            </li>
          ))}
        </ol>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Stat label="Agent steps" value={u.paidAgentSteps} />
        {u.agentRunsWithoutStepCount > 0 && <Stat label="Runs without step count" value={u.agentRunsWithoutStepCount} />}
        <Stat label="Verified retailers" value={`${u.verifiedRetailers.length} of ${u.retailersSearched.length}`} />
        <Stat label="Total time" value={secs(u.latencyMs)} />
        <Stat label="First verified price" value={u.timeToFirstVerifiedPriceMs === null ? "Unknown" : secs(u.timeToFirstVerifiedPriceMs)} />
        <Stat label="Oldest price age" value={age(u.priceMaxAgeSeconds)} />
      </dl>

      <p className="text-xs text-white/80">{cs.detail}{u.earlyStopped ? " Stopped early once enough retailers were verified." : ""}</p>

      {skipped.length > 0 && (
        <div>
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-white/75">Agent runs avoided</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {skipped.map(([k, n]) => (
              <li key={k}>{n} × {skipWords(k)}</li>
            ))}
          </ul>
        </div>
      )}
      {u.retailersSearched.length > 0 && (
        <p className="text-xs text-white/80">
          Searched: {u.retailersSearched.join(", ")}. Verified: {u.verifiedRetailers.length ? u.verifiedRetailers.join(", ") : "none"}.
        </p>
      )}
    </section>
  );
}
