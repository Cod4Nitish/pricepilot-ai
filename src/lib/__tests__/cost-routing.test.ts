import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meter, resetMeter } from "../cost/meter";
import { clearSearchCache, isElectronicsQuery, normalizeQueryKey, searchProducts, type Deps } from "../search";
import { parseQuery } from "../match";
import { TinyFishError, runAgent, sanitizeOutputSchema, type AgentRunResult } from "../tinyfish";
import { AGENT_SCHEMA } from "../search";

const AMZ = "https://www.amazon.in/Samsung-Galaxy-S24-Marble-Storage/dp/B0CMDRCZBH";
const FK = "https://www.flipkart.com/samsung-galaxy-s24-5g-cobalt-violet-256-gb/p/itm1111aaaa?pid=MOBGX1111AAAA";
const CROMA = "https://www.croma.com/samsung-galaxy-s24-5g-8gb-ram-256gb-onyx-black-/p/309451";
const REL = "https://www.reliancedigital.in/samsung-galaxy-s24-5g-256gb-onyx-black/p/494351234";
const TITLE = "Samsung Galaxy S24 5G (Onyx Black, 8GB, 256GB Storage)";
const priced = (p: string) => `# ${TITLE}\n${p}\nM.R.P.: ₹74,999\nAdd to cart\nIn stock`;
const noPrice = `# ${TITLE}\nLoading...`;

type Page = { text?: string; error?: string };
interface Fake extends Deps {
  calls: { search: number; fetchUrls: string[]; fetchTtl: (number | undefined)[]; agent: string[] };
}
/** Fake TinyFish: one listing per retailer domain; per-URL page text or fetch error; agent behaviour per URL. */
function fake(
  listings: Record<string, string>,
  pages: Record<string, Page>,
  agent: (url: string) => Promise<AgentRunResult> = async (url) => ({ runId: "r", status: "COMPLETED", steps: 7, result: { title: TITLE, price: url === REL ? 54_490 : 54_990, availability: "in_stock" } }),
): Fake {
  const calls: Fake["calls"] = { search: 0, fetchUrls: [], fetchTtl: [], agent: [] };
  return {
    calls,
    search: async ({ includeDomains }) => {
      calls.search++;
      const url = listings[includeDomains?.[0] ?? ""];
      return { query: "q", page: 0, total_results: url ? 1 : 0, results: url ? [{ position: 1, site_name: "x", title: TITLE, snippet: "", url }] : [] };
    },
    fetchPages: async ({ urls, ttl }) => {
      calls.fetchUrls.push(...urls);
      calls.fetchTtl.push(ttl);
      return {
        results: urls.filter((u) => pages[u]?.text !== undefined).map((u) => ({ url: u, title: TITLE, text: pages[u].text })),
        errors: urls.filter((u) => pages[u]?.error).map((u) => ({ url: u, error: pages[u].error! })),
      };
    },
    runAgent: async ({ url }) => {
      calls.agent.push(url);
      return agent(url);
    },
  };
}
const Q = "Samsung Galaxy S24 256GB";
const run = (d: Deps, q = Q, extra: Parameters<typeof searchProducts>[1] = {}) => searchProducts(q, { deps: d, persist: false, ...extra });

beforeEach(() => {
  clearSearchCache();
  resetMeter();
});
afterEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith("PP_")) delete process.env[k];
  vi.unstubAllGlobals();
});

describe("cost-aware adaptive agent routing", () => {
  it("a successful Fetch avoids the paid Agent and is labelled 'verified'", async () => {
    const d = fake({ "amazon.in": AMZ, "flipkart.com": FK }, { [AMZ]: { text: priced("₹55,999") }, [FK]: { text: priced("₹53,199") } });
    const r = await run(d);
    expect(d.calls.agent).toHaveLength(0);
    expect(r.usage?.agentRuns).toBe(0);
    expect(r.usage?.computedAgentUsd).toBe(0);
    expect(r.offers.every((o) => o.verification === "verified")).toBe(true);
    expect(r.bestVerified?.price).toBe(53199);
    expect(r.usage?.verifiedRetailers.sort()).toEqual(["amazon", "flipkart"]);
  });

  it("early stop: once 2 retailers are verified by Fetch, unpriced listings elsewhere get no Agent, and the response says so", async () => {
    const d = fake(
      { "amazon.in": AMZ, "flipkart.com": FK, "croma.com": CROMA },
      { [AMZ]: { text: priced("₹55,999") }, [FK]: { text: priced("₹53,199") }, [CROMA]: { text: noPrice } },
    );
    const r = await run(d);
    expect(d.calls.agent).toHaveLength(0);
    expect(r.usage?.earlyStopped).toBe(true);
    expect(r.usage?.agentSkipped.target_met).toBe(1);
    expect(r.recommendation.caveats.join(" ")).toMatch(/Stopped early to control cost.*lower price there is possible/);
    expect(r.statuses.find((s) => s.retailer === "croma")?.message).toMatch(/Not checked with the paid browser agent/);
    // never claims the cheapest across all retailers
    expect(r.recommendation.text).toMatch(/could not be fully checked/);
  });

  it("Agent fallback only where necessary: one run for the missing retailer, then stops; metered steps give the cost", async () => {
    const d = fake(
      { "amazon.in": AMZ, "croma.com": CROMA, "reliancedigital.in": REL },
      { [AMZ]: { text: priced("₹55,999") }, [CROMA]: { text: noPrice }, [REL]: { text: noPrice } },
    );
    const r = await run(d);
    expect(d.calls.agent).toHaveLength(1);
    const agentOffer = r.offers.find((o) => o.url === d.calls.agent[0]);
    expect(agentOffer?.verification).toBe("agent_verified");
    expect(agentOffer?.evidence).toMatch(/browser agent/);
    expect(r.usage?.agentRuns).toBe(1);
    expect(r.usage?.agentSteps).toBe(7);
    expect(r.usage?.computedAgentUsd).toBeCloseTo(7 * 0.016, 6);
    expect(r.usage?.agentSkipped.target_met).toBe(1);
  });

  it("low-confidence or accessory listings never get a paid Agent", async () => {
    const CASE = "https://www.amazon.in/Spigen-Case-Galaxy-S24/dp/B0CASE0001";
    const d: Fake = fake({ "amazon.in": CASE, "croma.com": CROMA }, { [CASE]: { text: "# Spigen Back Cover Case for Samsung Galaxy S24\nLoading" }, [CROMA]: { text: noPrice } });
    const search = d.search;
    d.search = async (p, o) => {
      const out = await search(p, o);
      return { ...out, results: out.results.map((x) => (x.url === CASE ? { ...x, title: "Samsung Galaxy S24 5G 256GB back case" } : x)) };
    };
    await run(d);
    expect(d.calls.agent).not.toContain(CASE);
  });

  it("blocked retailer: no Agent, status 'blocked'", async () => {
    const d = fake({ "amazon.in": AMZ, "croma.com": CROMA }, { [AMZ]: { text: priced("₹55,999") }, [CROMA]: { error: "bot_blocked" } });
    const r = await run(d);
    expect(d.calls.agent).toHaveLength(0);
    expect(r.usage?.agentSkipped.blocked_or_login).toBe(1);
    expect(r.statuses.find((s) => s.retailer === "croma")?.state).toBe("blocked");
  });

  it("partial comparison: agent fails -> only the verified retailer is named, with an honest caveat", async () => {
    const d = fake({ "amazon.in": AMZ, "croma.com": CROMA }, { [AMZ]: { text: priced("₹55,999") }, [CROMA]: { text: noPrice } }, async () => ({ runId: "r", status: "FAILED", steps: 3, result: null, error: "page error" }));
    const r = await run(d);
    expect(d.calls.agent).toHaveLength(1);
    expect(r.bestVerified?.retailer).toBe("amazon");
    expect(r.offers.find((o) => o.retailer === "croma")?.verification).toBe("unverified");
    expect(r.offers.find((o) => o.retailer === "croma")?.price).toBeNull();
    expect(r.recommendation.text).toMatch(/could not be fully checked/);
    expect(r.usage?.verifiedRetailers).toEqual(["amazon"]);
    expect(r.usage?.agentSteps).toBe(3); // a failed run still costs its steps
  });

  it("paid budget exhausted: no crash, price stays null, caveat explains", async () => {
    const d = fake({ "amazon.in": AMZ, "croma.com": CROMA }, { [AMZ]: { text: priced("₹55,999") }, [CROMA]: { text: noPrice } }, async () => {
      throw new TinyFishError("budget_exhausted", "Daily paid agent budget ($2.00) would be exceeded.");
    });
    const r = await run(d);
    expect(r.offers.find((o) => o.retailer === "croma")?.price).toBeNull();
    expect(r.bestVerified?.retailer).toBe("amazon");
    expect(r.recommendation.caveats.join(" ")).not.toMatch(/Stopped early/);
  });

  it("per-search cap limits paid runs and says so", async () => {
    process.env.PP_AGENT_MAX_PER_SEARCH = "1";
    process.env.PP_TARGET_VERIFIED_RETAILERS = "3";
    const d = fake({ "amazon.in": AMZ, "croma.com": CROMA, "reliancedigital.in": REL }, { [AMZ]: { text: priced("₹55,999") }, [CROMA]: { text: noPrice }, [REL]: { text: noPrice } });
    const r = await run(d);
    expect(d.calls.agent).toHaveLength(1);
    expect(r.usage?.agentSkipped.per_search_cap).toBe(1);
    expect(r.recommendation.caveats.join(" ")).toMatch(/per-search paid agent limit \(1\)/);
  });
});

describe("caching and request de-duplication", () => {
  const pages = () => ({ [AMZ]: { text: priced("₹55,999") }, [CROMA]: { text: noPrice } });

  it("cache hit avoids duplicate work and keeps the original observation time", async () => {
    const d = fake({ "amazon.in": AMZ, "croma.com": CROMA }, pages());
    const a = await run(d);
    const calls = { s: d.calls.search, f: d.calls.fetchUrls.length, a: d.calls.agent.length };
    const b = await run(d, "  samsung galaxy S24 256 gb ");
    expect({ s: d.calls.search, f: d.calls.fetchUrls.length, a: d.calls.agent.length }).toEqual(calls);
    expect(b.cached).toBe(true);
    expect(b.usage?.cache).toBe("hit");
    expect(b.usage?.agentRuns).toBe(0);
    expect(b.generatedAt).toBe(a.generatedAt);
    expect(b.offers.map((o) => o.checkedAt)).toEqual(a.offers.map((o) => o.checkedAt));
    expect(typeof b.cacheAgeSeconds).toBe("number");
  });

  it("different variants never share a cache key", () => {
    expect(normalizeQueryKey("Samsung Galaxy S24 256 GB")).toBe(normalizeQueryKey("samsung galaxy s24 256gb"));
    expect(normalizeQueryKey("Samsung Galaxy S24 256GB")).not.toBe(normalizeQueryKey("Samsung Galaxy S24 128GB"));
    expect(normalizeQueryKey("Samsung Galaxy S24")).not.toBe(normalizeQueryKey("Samsung Galaxy S24 Ultra"));
    expect(normalizeQueryKey("phone under ₹50,000")).toBe(normalizeQueryKey("phone under rs 50000"));
  });

  it("concurrent identical requests share one in-flight pipeline", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const d = fake({ "amazon.in": AMZ, "croma.com": CROMA }, pages());
    const search = d.search;
    d.search = async (p, o) => {
      await gate;
      return search(p, o);
    };
    const all = Promise.all([run(d), run(d, "samsung galaxy s24 256 GB"), run(d, "Samsung  Galaxy S24 256gb")]);
    release();
    const [a, b, c] = await all;
    expect(d.calls.agent).toHaveLength(1);
    expect(d.calls.search).toBe(5); // one pipeline: one search per enabled retailer
    expect([a, b, c].map((r) => r.usage?.cache).sort()).toEqual(["joined", "joined", "miss"]);
    expect(b.offers.map((o) => o.price)).toEqual(a.offers.map((o) => o.price));
    expect(meter.snapshot().inflightJoins).toBe(2);
  });

  it("a paid agent observation is reused (labelled cached, original time) by a different query for the same product page", async () => {
    const d = fake({ "amazon.in": AMZ, "croma.com": CROMA }, pages());
    const a = await run(d);
    const first = a.offers.find((o) => o.retailer === "croma")!;
    expect(first.verification).toBe("agent_verified");
    const b = await run(d, "Samsung Galaxy S24 5G 256GB");
    expect(d.calls.agent).toHaveLength(1);
    const again = b.offers.find((o) => o.retailer === "croma")!;
    expect(again.checkedAt).toBe(first.checkedAt);
    expect(again.matchNotes.join(" ")).toMatch(/cached observation, not re-checked now/);
    expect(b.usage?.agentSkipped.cached_observation).toBe(1);
  });

  it("user-triggered fresh check bypasses caches and asks TinyFish Fetch for a live page (ttl 0)", async () => {
    const d = fake({ "amazon.in": AMZ, "croma.com": CROMA }, pages());
    await run(d);
    const r = await run(d, Q, { fresh: true });
    expect(r.cached).toBe(false);
    expect(r.usage?.freshCheck).toBe(true);
    expect(d.calls.agent).toHaveLength(2);
    expect(d.calls.fetchTtl.at(-1)).toBe(0);
    expect(r.usage?.priceMaxAgeSeconds).toBe(0);
    // discovery (which pages exist) may come from cache; prices are re-read
    expect(r.usage?.discoveryCacheHits).toBe(2); // amazon + croma had results; empty searches are not cached
  });

  it("legacy routing is still available for A/B measurement", async () => {
    const d = fake(
      { "amazon.in": AMZ, "flipkart.com": FK, "croma.com": CROMA },
      { [AMZ]: { text: priced("₹55,999") }, [FK]: { text: priced("₹53,199") }, [CROMA]: { text: noPrice } },
    );
    const r = await run(d, Q, { routing: "legacy", skipCache: true });
    expect(d.calls.agent).toHaveLength(1); // legacy sends the agent even though 2 retailers are verified
    expect(r.usage?.routing).toBe("legacy");
  });
});

describe("paid-usage gate in the TinyFish client", () => {
  it("daily run cap blocks the Agent before any HTTP call", async () => {
    process.env.PP_AGENT_DAILY_MAX_RUNS = "0";
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(runAgent({ url: CROMA, goal: "g" }, { apiKey: "k" })).rejects.toMatchObject({ kind: "budget_exhausted" });
    expect(f).not.toHaveBeenCalled();
  });

  it("daily USD budget counts metered steps plus a reserve for the next run", () => {
    process.env.PP_AGENT_DAILY_BUDGET_USD = "0.20";
    process.env.PP_AGENT_RESERVE_STEPS = "10";
    expect(meter.canStartAgent().ok).toBe(true); // 10 reserved steps = $0.16
    meter.agentStart();
    meter.agentEnd("completed", 5); // $0.08 spent; +10 reserve = $0.24 > $0.20
    expect(meter.canStartAgent()).toMatchObject({ ok: false, reason: "daily_budget" });
    expect(meter.snapshot().cost.today.computedUsd).toBeCloseTo(0.08, 6);
  });

  it("records real step counts from the provider and counts runs without one separately", async () => {
    const responses = [
      { run_id: "abc" },
      { status: "COMPLETED", result: { price: 1 }, num_of_steps: 9 },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200 })));
    const r = await runAgent({ url: CROMA, goal: "g", pollIntervalMs: 1 }, { apiKey: "k" });
    expect(r.steps).toBe(9);
    const snap = meter.snapshot();
    expect(snap.tinyfish.agentRuns).toBe(1);
    expect(snap.tinyfish.agentSteps).toBe(9);
    expect(snap.cost.computedAgentUsd).toBeCloseTo(0.144, 6);
  });

  it("electronics-only stores are only relevant for electronics queries", () => {
    expect(isElectronicsQuery(parseQuery("Samsung Galaxy S24 256GB"))).toBe(true);
    expect(isElectronicsQuery(parseQuery("Gaming laptop RTX 4050 under 70000"))).toBe(true);
    expect(isElectronicsQuery(parseQuery("Nike Pegasus running shoes size 9"))).toBe(false);
  });
});

describe("agent output_schema", () => {
  it("strips annotation keys TinyFish rejects (HTTP 400) but keeps property names such as 'title'", () => {
    const clean = sanitizeOutputSchema(AGENT_SCHEMA) as { properties: Record<string, Record<string, unknown>>; required: string[] };
    expect(JSON.stringify(clean)).not.toContain("description");
    expect(Object.keys(clean.properties)).toEqual(Object.keys(AGENT_SCHEMA.properties));
    expect(clean.properties.price).toEqual({ type: "number" });
    expect(clean.properties.offers).toEqual({ type: "array", items: { type: "string" } });
    expect(clean.required).toEqual(["price"]);
  });
});

describe("retailers whose fetched page has no price", () => {
  it("a heuristic rupee number on a Vijay/Croma page is never a verified price (only structured data is trusted)", async () => {
    const VIJAY = "https://www.vijaysales.com/p/257086/hp-victus-gaming-laptop-rtx-4050";
    const d = fake({ "vijaysales.com": VIJAY, "croma.com": CROMA }, {
      [VIJAY]: { text: `# ${TITLE}\n\nWorth₹3,199Free\n\n## Standard installation charges ₹1,345+GST` },
      [CROMA]: { text: `# ${TITLE}\nPrice ₹54,990` },
    }, async () => ({ runId: "r", status: "FAILED", steps: 2, result: null }));
    const r = await run(d);
    expect(r.offers.filter((o) => o.price !== null)).toHaveLength(0);
    expect(r.bestVerified).toBeNull();
  });
});

describe("early stop respects the budget", () => {
  it("prices above the requested budget do not count toward the verified-retailer target", async () => {
    const d = fake(
      { "amazon.in": AMZ, "flipkart.com": FK, "croma.com": CROMA },
      { [AMZ]: { text: priced("₹55,999") }, [FK]: { text: priced("₹53,199") }, [CROMA]: { text: noPrice } },
      async () => ({ runId: "r", status: "COMPLETED", steps: 5, result: { title: TITLE, price: 49_990 } }),
    );
    const r = await run(d, "Samsung Galaxy S24 256GB under 50000");
    expect(d.calls.agent).toEqual([CROMA]);
    expect(r.usage?.earlyStopped).toBe(false);
    expect(r.bestVerified?.retailer).toBe("croma");
  });
});

