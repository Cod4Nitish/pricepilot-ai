import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireTinyFishKey } from "./byok";
import { TtlCache } from "./cache";
import { getCostConfig, type CostConfig } from "./cost/config";
import { costContext } from "./cost/context";
import { meter, type AgentSkipReason } from "./cost/meter";
import { discountPct, extractFromMarkdown, parseInr } from "./extract";
import { isAccessoryTitle, isJunkTitle, isRelevantOfferText, parseMaxPrice, parseQuery, scoreListing, specFromTitle, type ParsedQuery } from "./match";
import { RETAILERS, RETAILER_BY_ID, discoverProductLinks, isProductUrl, productKey, type RetailerConfig } from "./retailers";
import { RunTracker } from "./runs";
import { canonicalUrl, looksLikeUrl, validateRetailerUrl } from "./ssrf";
import * as tf from "./tinyfish";
import { persistSearch } from "./supabase";
import type { Offer, RetailerId, RetailerStatus, SearchResponse } from "./types";

export interface Deps {
  search: typeof tf.search;
  fetchPages: typeof tf.fetchPages;
  runAgent: typeof tf.runAgent;
}
const defaultDeps: Deps = { search: tf.search, fetchPages: tf.fetchPages, runAgent: tf.runAgent };

export const MAX_AGENT_RUNS = 3;
const CANDIDATES_PER_RETAILER = 3;
const CANDIDATES_PER_RETAILER_DEVICE = 5; // laptop/phone lookups: titles are often truncated, so look at more pages (Fetch is cheap; Agent cap stays MAX_AGENT_RUNS)

/** 5 candidates per retailer for device-like queries (brand + spec/device word), else 3. */
export function candidateCap(parsed: ParsedQuery): number {
  const device = !!parsed.brand && (parsed.gpu !== undefined || parsed.storageGb !== undefined || parsed.ramGb !== undefined || /laptop|notebook|phone|iphone|galaxy|macbook|thinkpad|ideapad/i.test(parsed.rawQuery));
  return device ? CANDIDATES_PER_RETAILER_DEVICE : CANDIDATES_PER_RETAILER;
}

const SERIES_SKIP = new Set(["gaming", "laptop", "notebook", "series", "intel", "amd", "core", "windows", "home"]);
/** Does the title contain the FULL series name (all non-spec model tokens of the query)? */
export function hasFullSeries(parsed: ParsedQuery, title: string): boolean {
  const toks = parsed.modelTokens.filter((w) => !SERIES_SKIP.has(w));
  if (!toks.length) return false;
  const have = new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const squashed = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  return toks.every((w) => have.has(w) || squashed.includes(w));
}
// Response cache (price TTL), discovery cache (which product pages a retailer search returned: stable),
// paid-observation cache (agent-read prices per product page, price TTL) and product identity cache (spec TTL).
const cache = new TtlCache<SearchResponse>(10 * 60_000, 100);
const discoveryCache = new TtlCache<tf.SearchResult[]>(6 * 3600_000, 300);
interface PriceObservation {
  price: number;
  mrp: number | null;
  availability: Offer["availability"];
  offers: string[];
  title: string;
  evidence?: string;
  extra: OfferExtra;
  verification: Offer["verification"];
  checkedAt: string;
}
const observationCache = new TtlCache<PriceObservation>(15 * 60_000, 500);
const identityCache = new TtlCache<{ title: string; imageUrl?: string }>(24 * 3600_000, 1000);
const inflight = new Map<string, Promise<SearchResponse>>();
export function clearSearchCache() {
  cache.clear();
  discoveryCache.clear();
  observationCache.clear();
  identityCache.clear();
  inflight.clear();
}

/**
 * Cache/dedupe key: case, spacing, punctuation, unit spacing ("256 GB" = "256gb"), "rs"/"₹" and word order are
 * normalised. Variant tokens (storage, RAM, colour, model numbers) are all kept, so different variants never share a key.
 */
export function normalizeQueryKey(q: string): string {
  const t = q
    .toLowerCase()
    .replace(/[₹]/g, " rs ")
    .replace(/(\d)\s+(gb|tb|mb|inch|in|hz|mah|w|k)\b/g, "$1$2")
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
  return [...new Set(t.split(" ").filter(Boolean))].sort().join(" ");
}

const ELECTRONICS_RE = /\b(phone|smartphone|mobile|iphone|galaxy|pixel|oneplus|redmi|poco|realme|oppo|vivo|xiaomi|iqoo|motorola|laptop|notebook|macbook|thinkpad|ideapad|vivobook|zenbook|rtx|gtx|tablet|ipad|tv|television|monitor|earbuds|airpods|headphones?|earphones?|speaker|soundbar|smartwatch|watch|camera|dslr|console|playstation|ps5|xbox|refrigerator|fridge|washing machine|air conditioner|ac|microwave|ssd|hdd|router|printer|charger|power ?bank)\b/i;
/** Does this query ask for an electronics product (so electronics-only stores are relevant)? */
export function isElectronicsQuery(parsed: ParsedQuery): boolean {
  return parsed.gpu !== undefined || parsed.storageGb !== undefined || parsed.ramGb !== undefined || ELECTRONICS_RE.test(parsed.rawQuery);
}

/** What one search request cost. Counts are for this request only (0 on a cache hit / shared in-flight result). */
export interface SearchUsage {
  cache: "miss" | "hit" | "joined";
  routing: CostConfig["routing"];
  freshCheck: boolean;
  searchCalls: number;
  discoveryCacheHits: number;
  fetchUrls: number;
  agentRuns: number;
  agentSteps: number;
  agentRunsWithoutStepCount: number;
  /** agent calls that threw (provider error, timeout, budget gate): kind + short message */
  agentErrors: string[];
  /** metered steps × configured $/step; null when no run returned a step count */
  computedAgentUsd: number | null;
  agentSkipped: Partial<Record<AgentSkipReason, number>>;
  earlyStopped: boolean;
  verifiedRetailers: string[];
  retailersSearched: string[];
  latencyMs: number;
  timeToFirstVerifiedPriceMs: number | null;
  /** Fetch freshness tolerance used for this search: a page may be served from TinyFish's cache up to this age. */
  priceMaxAgeSeconds: number;
}
function newUsage(cache: SearchUsage["cache"], cfg: CostConfig, freshCheck: boolean): SearchUsage {
  return {
    cache,
    routing: cfg.routing,
    freshCheck,
    searchCalls: 0,
    discoveryCacheHits: 0,
    fetchUrls: 0,
    agentRuns: 0,
    agentSteps: 0,
    agentRunsWithoutStepCount: 0,
    agentErrors: [],
    computedAgentUsd: null,
    agentSkipped: {},
    earlyStopped: false,
    verifiedRetailers: [],
    retailersSearched: [],
    latencyMs: 0,
    timeToFirstVerifiedPriceMs: null,
    priceMaxAgeSeconds: 0,
  };
}
/** Wrap deps so this request's TinyFish usage is counted (global counters live in tinyfish.ts). */
function meteredDeps(d: Deps, u: SearchUsage): Deps {
  return {
    search: async (p, o) => {
      u.searchCalls++;
      return d.search(p, o);
    },
    fetchPages: async (p, o) => {
      u.fetchUrls += p.urls.length;
      return d.fetchPages(p, o);
    },
    runAgent: async (p, o) => {
      let r: tf.AgentRunResult;
      try {
        r = await d.runAgent(p, o);
      } catch (e) {
        const kind = e instanceof tf.TinyFishError ? e.kind : "error";
        if (u.agentErrors.length < 10) u.agentErrors.push(`${kind}: ${(e as Error).message}`.slice(0, 200));
        throw e;
      }
      u.agentRuns++;
      if (typeof r.steps === "number") u.agentSteps += r.steps;
      else u.agentRunsWithoutStepCount++;
      return r;
    },
  };
}

export function offerId(retailer: RetailerId, url: string): string {
  return createHash("sha1").update(`${retailer}|${canonicalUrl(url)}`).digest("hex").slice(0, 20);
}

export const AGENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Product title exactly as displayed" },
    price: { type: "number", description: "Current selling price in INR next to the main Buy/Add to cart button, digits only; null if not displayed" },
    mrp: { type: "number", description: "Struck-through M.R.P./list price in INR if displayed, else null" },
    availability: { type: "string", description: "in_stock, out_of_stock or unknown, as shown by the buy box" },
    deliveryText: { type: "string", description: "Delivery date/charge line exactly as displayed, else null" },
    seller: { type: "string", description: "Seller / sold-by name if displayed, else null" },
    offers: { type: "array", items: { type: "string" }, description: "Bank/cashback/EMI offer lines, verbatim, max 5" },
  },
  required: ["price"],
};
export const AGENT_GOAL =
  "Open this retailer product page without logging in and read ONLY what is displayed; never guess or infer. " +
  "If a location, cookie, app-install or newsletter popup covers the page, close it. " +
  "Return: title (as displayed); price = the current selling price shown next to the main Buy / Add to cart button, in INR, digits only (NOT an EMI per-month amount, exchange price, or bank-offer price); " +
  "mrp = the struck-through M.R.P. / list price if displayed, else null; availability = in_stock, out_of_stock or unknown according to the buy box; " +
  "deliveryText = the delivery date or delivery charge line exactly as displayed, else null; seller = the seller name if displayed, else null; " +
  "offers = up to 5 bank/cashback/EMI offer lines verbatim. " +
  "If a CAPTCHA, login wall or bot check appears, stop and return price null. Do not solve CAPTCHAs. Never add to cart, never start checkout.";

const num = z.union([z.number(), z.string()]).nullish().transform((v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v > 0 ? v : null;
  return parseInr(v.replace(/[₹]|rs\.?|inr/gi, "").trim());
});
const agentResultSchema = z.object({
  title: z.string().nullish(),
  price: num,
  mrp: num,
  availability: z.string().nullish(),
  offers: z.array(z.string()).nullish(),
  deliveryText: z.string().nullish(),
  seller: z.string().nullish(),
});

/** Tolerant unwrap of TinyFish agent output: {result:{...}}, JSON strings, price objects. */
export function unwrapAgentResult(raw: unknown): unknown {
  let r = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof r === "string") {
      try {
        r = JSON.parse(r);
      } catch {
        return null;
      }
    } else if (r && typeof r === "object" && !("price" in r) && "result" in r) r = (r as { result: unknown }).result;
    else break;
  }
  if (r && typeof r === "object") {
    const o = { ...(r as Record<string, unknown>) };
    for (const k of ["price", "mrp"]) {
      const v = o[k];
      if (v && typeof v === "object" && "value" in v) o[k] = (v as { value: unknown }).value;
    }
    return o;
  }
  return r;
}

interface Candidate {
  retailer: RetailerConfig;
  url: string;
  searchTitle: string;
  snippet: string;
  prescore: number;
}

interface PipelineCtx {
  deps: Deps;
  tracker: RunTracker;
  agentBudget: { left: number; creditsExhausted: boolean };
  caveats: string[];
  cfg: CostConfig;
  fresh: boolean;
  usage: SearchUsage;
  t0: number;
  /** set when the app-side paid-usage limit blocked a run */
  budgetBlocked: string | null;
}

function skipAgent(ctx: PipelineCtx, reason: AgentSkipReason, n = 1): void {
  if (n <= 0) return;
  ctx.usage.agentSkipped[reason] = (ctx.usage.agentSkipped[reason] ?? 0) + n;
  meter.skip(reason, n);
}

type FetchIssue = "bot_blocked" | "login_required" | "other";

type OfferExtra = Partial<Pick<Offer, "seller" | "warranty" | "returnPolicy" | "gtin" | "sku" | "rating" | "deliveryText">>;

/**
 * A page h1/title is sometimes shorter than the search-result title (e.g. "Samsung Galaxy S24 5G" vs
 * "... (256 GB, 8 GB RAM)"). Keep the page title unless the search title adds storage/RAM without contradicting it.
 */
export function richerTitle(pageTitle: string, searchTitle: string): string {
  if (!searchTitle || isJunkTitle(searchTitle)) return pageTitle;
  const p = specFromTitle(pageTitle);
  const st = specFromTitle(searchTitle);
  const lacks = (p.storageGb === undefined && st.storageGb !== undefined) || (p.ramGb === undefined && st.ramGb !== undefined);
  const contradicts = (p.storageGb !== undefined && st.storageGb !== undefined && p.storageGb !== st.storageGb) || p.condition !== st.condition;
  if (lacks && !contradicts) {
    const nums = pageTitle.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && /\d/.test(w));
    const sl = searchTitle.toLowerCase();
    if (nums.every((w) => sl.includes(w))) return searchTitle;
  }
  return pageTitle;
}

/** Agent budget: one run per retailer first (retailers whose Fetch has no price go first), then by prescore. */
function pickAgentWork<T extends { c: Candidate }>(need: T[], budget: { left: number; creditsExhausted: boolean }): T[] {
  const by = new Map<string, T[]>();
  for (const w of [...need].sort((a, b) => b.c.prescore - a.c.prescore)) {
    const l = by.get(w.c.retailer.id) ?? [];
    l.push(w);
    by.set(w.c.retailer.id, l);
  }
  const order = [...by.values()].sort((a, b) => Number(a[0].c.retailer.fetchHasPrice) - Number(b[0].c.retailer.fetchHasPrice) || b[0].c.prescore - a[0].c.prescore);
  const out: T[] = [];
  for (let round = 0; ; round++) {
    let any = false;
    for (const l of order) {
      if (round >= l.length) continue;
      any = true;
      if (budget.left <= 0 || budget.creditsExhausted) return out;
      budget.left--;
      out.push(l[round]);
    }
    if (!any) return out;
  }
}

function cleanSearchQuery(q: string): string {
  return parseMaxPrice(q).cleaned.replace(/\s+/g, " ").trim();
}

async function runPipeline(
  parsed: ParsedQuery,
  searchQuery: string,
  retailers: RetailerConfig[],
  ctx: PipelineCtx,
): Promise<{ offers: Offer[]; statuses: RetailerStatus[] }> {
  const { deps, tracker } = ctx;
  const now = () => new Date().toISOString();
  const statusBy = new Map<RetailerId, RetailerStatus>();
  const latency = new Map<RetailerId, number>();
  const offers: Offer[] = [];

  for (const r of RETAILERS) {
    if (!r.enabled) statusBy.set(r.id, { retailer: r.id, retailerName: r.name, state: "disabled", message: "Retailer disabled.", offerCount: 0 });
  }

  // 1. per-retailer search in parallel
  const searched = await Promise.all(
    retailers.map(async (r) => {
      const t0 = Date.now();
      const useDiscoveryCache = ctx.cfg.routing === "adaptive" && ctx.cfg.discoveryTtlS > 0;
      const dkey = `${r.id}|${normalizeQueryKey(searchQuery)}`;
      const cachedResults = useDiscoveryCache ? discoveryCache.get(dkey) : undefined;
      if (cachedResults) {
        latency.set(r.id, Date.now() - t0);
        ctx.usage.discoveryCacheHits++;
        tracker.step(`${r.name}: product pages from discovery cache (${cachedResults.length} results; prices are re-read)`);
        return { r, results: cachedResults, error: null as tf.TinyFishError | null };
      }
      try {
        const out = await deps.search({ query: searchQuery, location: "IN", includeDomains: [r.domain] });
        latency.set(r.id, Date.now() - t0);
        if (useDiscoveryCache && out.results.length) discoveryCache.set(dkey, out.results, ctx.cfg.discoveryTtlS * 1000);
        tracker.step(`${r.name}: search returned ${out.results.length} results`);
        return { r, results: out.results, error: null as tf.TinyFishError | null };
      } catch (e) {
        latency.set(r.id, Date.now() - t0);
        const err = e instanceof tf.TinyFishError ? e : new tf.TinyFishError("upstream", (e as Error).message);
        tracker.step(`${r.name}: search failed (${err.kind})`, "error");
        return { r, results: [] as tf.SearchResult[], error: err };
      }
    }),
  );

  const cap = candidateCap(parsed);
  const candidates: Candidate[] = [];
  const excludedPre: Offer[] = [];
  for (const s of searched) {
    if (s.error) {
      const e = s.error;
      const msg =
        e.kind === "insufficient_credits"
          ? "TinyFish credits are exhausted; this retailer could not be searched."
          : e.kind === "auth"
            ? "TinyFish rejected the API key."
            : `Search failed (${e.kind}); not checked.`;
      statusBy.set(s.r.id, { retailer: s.r.id, retailerName: s.r.name, state: "error", message: msg, offerCount: 0, latencyMs: latency.get(s.r.id) });
      continue;
    }
    const seen = new Set<string>();
    const scored: Candidate[] = [];
    const categoryUrls: string[] = [];
    let junk = 0;
    for (const res of s.results) {
      const v = validateRetailerUrl(res.url);
      if (!v.ok || v.retailer.id !== s.r.id) continue;
      if (!isProductUrl(s.r, v.url)) {
        if (categoryUrls.length < 2) categoryUrls.push(v.url);
        continue;
      }
      // Non-product widgets ("Add to your order", "Sponsored"...) are junk: dropped before matching, not reported as exclusions.
      if (isJunkTitle(res.title)) {
        junk++;
        continue;
      }
      const key = productKey(s.r.id, v.url) ?? canonicalUrl(v.url);
      if (seen.has(key)) continue;
      seen.add(key);
      const m = scoreListing(parsed, res.title);
      if (m.hardExcluded) {
        excludedPre.push(
          makeOffer(s.r, v.url, res.title, null, null, "unknown", [], m.spec, 0, m.notes, "snippet_only", now(), undefined, undefined),
        );
        continue;
      }
      scored.push({ retailer: s.r, url: v.url, searchTitle: res.title, snippet: res.snippet, prescore: m.confidence });
    }
    if (junk) tracker.step(`${s.r.name}: ignored ${junk} non-product widget row(s)`);

    // product-page discovery from category/listing pages when search found no product page
    if (scored.length === 0 && categoryUrls.length) {
      try {
        const out = await deps.fetchPages({ urls: categoryUrls.slice(0, 1), ttl: 3600, links: true });
        const pg = out.results[0];
        if (pg) {
          const links = discoverProductLinks(s.r, searchQuery, { links: pg.links, markdown: pg.text }, cap);
          for (const l of links) {
            const lv = validateRetailerUrl(l.url);
            if (!lv.ok || lv.retailer.id !== s.r.id) continue;
            const key = productKey(s.r.id, lv.url) ?? canonicalUrl(lv.url);
            if (seen.has(key)) continue;
            seen.add(key);
            const m = scoreListing(parsed, l.text);
            if (m.hardExcluded) continue;
            scored.push({ retailer: s.r, url: lv.url, searchTitle: l.text, snippet: "", prescore: Math.min(m.confidence, 0.6) });
          }
          tracker.step(`${s.r.name}: discovered ${scored.length} product link(s) from a category page`);
        }
      } catch (e) {
        tracker.step(`${s.r.name}: category discovery failed (${(e as Error).message})`, "warn");
      }
    }

    scored.sort((a, b) => Number(hasFullSeries(parsed, b.searchTitle)) - Number(hasFullSeries(parsed, a.searchTitle)) || b.prescore - a.prescore);
    candidates.push(...scored.slice(0, cap));
    if (scored.length === 0) {
      statusBy.set(s.r.id, {
        retailer: s.r.id,
        retailerName: s.r.name,
        state: "no_results",
        message: s.results.length ? "Search returned only category/other pages or non-matching products." : "No results found.",
        offerCount: 0,
        latencyMs: latency.get(s.r.id),
      });
    }
  }

  // 2. fetch in batches of 10
  const pages = new Map<string, tf.FetchedPage>();
  const issues = new Map<string, FetchIssue>();
  const fetchErrs = new Map<string, string>();
  const urls = candidates.map((c) => c.url);
  // TinyFish Fetch may serve a cached page up to `ttl` seconds old: fresh checks use 0, adaptive uses the price TTL.
  const fetchTtl = ctx.fresh ? 0 : ctx.cfg.routing === "legacy" ? 3600 : ctx.cfg.priceTtlS;
  ctx.usage.priceMaxAgeSeconds = Math.max(ctx.usage.priceMaxAgeSeconds, fetchTtl);
  for (let i = 0; i < urls.length; i += 10) {
    const batch = urls.slice(i, i + 10);
    try {
      const out = await deps.fetchPages({ urls: batch, ttl: fetchTtl, imageLinks: true });
      for (const p of out.results) {
        pages.set(p.url, p);
        if (p.final_url) pages.set(p.final_url, p);
      }
      for (const e of out.errors) {
        fetchErrs.set(e.url, e.error);
        issues.set(e.url, e.error === "bot_blocked" ? "bot_blocked" : e.error === "login_required" ? "login_required" : "other");
      }
      tracker.step(`Fetched ${out.results.length}/${batch.length} pages`, out.errors.length ? "warn" : "ok");
    } catch (e) {
      const err = e as Error;
      for (const u of batch) {
        fetchErrs.set(u, "fetch_failed");
        issues.set(u, "other");
      }
      tracker.step(`Fetch failed: ${err.message}`, "error");
      if (e instanceof tf.TinyFishError && e.kind === "insufficient_credits") ctx.agentBudget.creditsExhausted = true;
    }
  }

  // 3. extract
  interface Work {
    c: Candidate;
    title: string;
    price: number | null;
    mrp: number | null;
    availability: Offer["availability"];
    offers: string[];
    imageUrl?: string;
    evidence?: string;
    extra: OfferExtra;
    verification: Offer["verification"];
    fetched: boolean;
    /** when the price was observed (set for agent reads and cached observations; else now) */
    checkedAt?: string;
    cachedNote?: string;
    agentTried?: boolean;
  }
  const work: Work[] = candidates.map((c) => {
    const page = pages.get(c.url);
    if (!page?.text) {
      const id = identityCache.get(canonicalUrl(c.url));
      return { c, title: id?.title ?? c.searchTitle, imageUrl: id?.imageUrl, price: null, mrp: null, availability: "unknown", offers: [], extra: {}, verification: "unverified", fetched: false };
    }
    const ex = extractFromMarkdown(page.text, { title: page.title, description: page.description, imageLinks: page.image_links });
    // Retailers whose fetched page does not render the price (fetchHasPrice=false, e.g. Vijay Sales/Croma): any rupee
    // number in the markdown is gift values, installation charges, exchange values... Trust only structured data there.
    if (!c.retailer.fetchHasPrice && ex.price !== null && !ex.structuredSource) {
      ex.price = null;
      ex.mrp = null;
      ex.evidence = undefined;
    }
    return {
      c,
      title: richerTitle(ex.title ?? page.title ?? c.searchTitle, c.searchTitle),
      extra: {
        ...(ex.seller ? { seller: ex.seller } : {}),
        ...(ex.warranty ? { warranty: ex.warranty } : {}),
        ...(ex.returnPolicy ? { returnPolicy: ex.returnPolicy } : {}),
        ...(ex.gtin ? { gtin: ex.gtin } : {}),
        ...(ex.sku ? { sku: ex.sku } : {}),
        ...(ex.rating ? { rating: ex.rating } : {}),
      },
      price: ex.price,
      mrp: ex.mrp,
      availability: ex.availability,
      offers: ex.offers,
      imageUrl: ex.imageUrl,
      evidence: ex.evidence,
      verification: ex.price !== null ? "verified" : "unverified",
      fetched: true,
    } satisfies Work;
  });
  for (const w of work) {
    if (w.fetched && !isJunkTitle(w.title)) identityCache.set(canonicalUrl(w.c.url), { title: w.title, imageUrl: w.imageUrl }, ctx.cfg.specTtlS * 1000);
  }
  const strongMatch = (w: Work) => {
    const m = scoreListing(parsed, w.title);
    return !m.hardExcluded && m.confidence >= ctx.cfg.agentMinMatchConfidence && !isAccessoryTitle(w.title);
  };
  const markFirstPrice = () => {
    if (ctx.usage.timeToFirstVerifiedPriceMs === null && work.some((w) => w.price !== null && strongMatch(w))) ctx.usage.timeToFirstVerifiedPriceMs = Date.now() - ctx.t0;
  };
  markFirstPrice();

  // 4. paid Agent fallback.
  const isBlocked = (w: Work) => issues.get(w.c.url) === "bot_blocked" || issues.get(w.c.url) === "login_required";
  const agentRead = async (w: Work) => {
    w.agentTried = true;
    try {
      tracker.step(`${w.c.retailer.name}: using paid browser agent for price`);
      const r = await deps.runAgent({
        url: w.c.url,
        goal: AGENT_GOAL,
        outputSchema: AGENT_SCHEMA,
        stealth: !w.c.retailer.fetchHasPrice,
        maxDurationSeconds: ctx.cfg.routing === "legacy" ? 90 : ctx.cfg.agentMaxDurationS,
        overallTimeoutMs: ctx.cfg.routing === "legacy" ? 110_000 : ctx.cfg.agentOverallTimeoutMs,
      });
      if (r.status !== "COMPLETED") {
        tracker.step(`${w.c.retailer.name}: agent ${r.status.toLowerCase()}${r.error ? ` (${r.error})` : ""}`, "warn");
        return;
      }
      const p = agentResultSchema.safeParse(unwrapAgentResult(r.result));
      if (!p.success || p.data.price === null) {
        tracker.step(`${w.c.retailer.name}: agent could not read a price`, "warn");
        return;
      }
      w.price = p.data.price;
      w.mrp = p.data.mrp !== null && p.data.mrp > p.data.price ? p.data.mrp : null;
      if (p.data.title) w.title = richerTitle(p.data.title, w.title);
      if (p.data.seller) w.extra.seller = p.data.seller;
      if (p.data.deliveryText) w.extra.deliveryText = p.data.deliveryText;
      if (p.data.offers?.length) w.offers = p.data.offers.slice(0, 8);
      const av = (p.data.availability ?? "").toLowerCase();
      w.availability = /out/.test(av) ? "out_of_stock" : /in[_ ]?stock|available/.test(av) ? "in_stock" : w.availability;
      w.verification = "agent_verified";
      w.evidence = `Read by browser agent from live page: price ₹${p.data.price}`;
      w.checkedAt = now();
      markFirstPrice();
      if (ctx.cfg.routing === "adaptive" && ctx.cfg.priceTtlS > 0) {
        observationCache.set(
          productKey(w.c.retailer.id, w.c.url) ?? canonicalUrl(w.c.url),
          { price: w.price, mrp: w.mrp, availability: w.availability, offers: w.offers, title: w.title, evidence: w.evidence, extra: { ...w.extra }, verification: w.verification, checkedAt: w.checkedAt },
          ctx.cfg.priceTtlS * 1000,
        );
      }
    } catch (e) {
      if (e instanceof tf.TinyFishError && e.kind === "insufficient_credits") {
        ctx.agentBudget.creditsExhausted = true;
        ctx.caveats.push("TinyFish credits ran out during browser-agent verification.");
      } else if (e instanceof tf.TinyFishError && e.kind === "budget_exhausted") {
        ctx.budgetBlocked = e.message;
      }
      tracker.step(`${w.c.retailer.name}: agent not run or failed (${(e as Error).message})`, "error");
    }
  };

  const agentSkippedRetailers = new Map<RetailerId, AgentSkipReason>();
  if (ctx.cfg.routing === "legacy") {
    // Legacy routing (before the cost sprint): any unpriced, non-blocked listing, up to MAX_AGENT_RUNS, round-robin by retailer.
    const needAgent = work.filter((w) => w.price === null && !isBlocked(w));
    const toRun = pickAgentWork(needAgent, ctx.agentBudget);
    if (needAgent.length > toRun.length) {
      ctx.caveats.push(`Price not read for ${needAgent.length - toRun.length} listing(s): the per-search browser-agent limit (${MAX_AGENT_RUNS}) was reached to protect cost.`);
    }
    await Promise.all(toRun.map(agentRead));
  } else {
    // Adaptive routing: Agent only for a listing whose price Fetch could not read, that strongly matches the query,
    // at a relevant retailer with no verified price yet, within per-search and daily budgets. Stops early once
    // `targetVerifiedRetailers` distinct retailers have a verified price.
    const electronics = isElectronicsQuery(parsed);
    const pool: Work[] = [];
    const seenKeys = new Set<string>();
    for (const w of [...work].filter((x) => x.price === null).sort((a, b) => b.c.prescore - a.c.prescore)) {
      const reason: AgentSkipReason | null = isBlocked(w)
        ? "blocked_or_login"
        : !strongMatch(w)
          ? "low_match_confidence"
          : w.c.retailer.electronicsOnly && !electronics
            ? "not_relevant_retailer"
            : null;
      if (reason) {
        skipAgent(ctx, reason);
        continue;
      }
      const key = productKey(w.c.retailer.id, w.c.url) ?? canonicalUrl(w.c.url);
      if (seenKeys.has(key)) {
        skipAgent(ctx, "duplicate_product");
        continue;
      }
      seenKeys.add(key);
      const obs = ctx.fresh ? undefined : observationCache.get(key);
      if (obs) {
        Object.assign(w, { price: obs.price, mrp: obs.mrp, availability: obs.availability, offers: obs.offers, title: obs.title, evidence: obs.evidence, verification: obs.verification, checkedAt: obs.checkedAt });
        w.extra = { ...w.extra, ...obs.extra };
        w.cachedNote = `Price observed by the browser agent at ${obs.checkedAt} (cached observation, not re-checked now).`;
        skipAgent(ctx, "cached_observation");
        tracker.step(`${w.c.retailer.name}: reused agent price observed at ${obs.checkedAt}`);
        markFirstPrice();
        continue;
      }
      pool.push(w);
    }
    // same rule as the final response: a price above the requested budget does not count as a usable verified offer
    const usable = (w: Work) => w.price !== null && strongMatch(w) && (!parsed.maxPrice || w.price <= parsed.maxPrice);
    const verifiedRetailers = () => new Set(work.filter(usable).map((w) => w.c.retailer.id));
    let started = 0;
    let stop: AgentSkipReason | null = null;
    for (;;) {
      const have = verifiedRetailers();
      const remaining = pool.filter((w) => !w.agentTried && w.price === null && !have.has(w.c.retailer.id));
      if (!remaining.length) break;
      if (have.size >= ctx.cfg.targetVerifiedRetailers) {
        stop = "target_met";
        break;
      }
      if (ctx.agentBudget.creditsExhausted) {
        stop = "credits_exhausted";
        break;
      }
      if (ctx.budgetBlocked) {
        stop = /run limit/.test(ctx.budgetBlocked) ? "daily_run_cap" : "daily_budget";
        break;
      }
      const capLeft = ctx.cfg.agentMaxPerSearch - started;
      if (capLeft <= 0) {
        stop = "per_search_cap";
        break;
      }
      const want = Math.min(ctx.cfg.targetVerifiedRetailers - have.size, capLeft);
      const wave: Work[] = [];
      const used = new Set<RetailerId>();
      for (const w of remaining) {
        if (used.has(w.c.retailer.id)) continue;
        used.add(w.c.retailer.id);
        wave.push(w);
        if (wave.length >= want) break;
      }
      started += wave.length;
      await Promise.all(wave.map(agentRead));
    }
    const haveEnd = verifiedRetailers();
    const untried = pool.filter((w) => !w.agentTried && w.price === null);
    for (const w of untried) {
      const reason: AgentSkipReason = haveEnd.has(w.c.retailer.id) ? "retailer_already_verified" : (stop ?? "per_search_cap");
      skipAgent(ctx, reason);
      if (!haveEnd.has(w.c.retailer.id)) agentSkippedRetailers.set(w.c.retailer.id, reason);
    }
    const notChecked = untried.filter((w) => !haveEnd.has(w.c.retailer.id)).length;
    if (stop === "target_met" && notChecked) {
      ctx.usage.earlyStopped = true;
      ctx.caveats.push(
        `Stopped early to control cost: ${haveEnd.size} retailers already had verified prices, so ${notChecked} listing(s) at other retailers were not checked with the paid browser agent. A lower price there is possible.`,
      );
    } else if (stop && stop !== "target_met" && notChecked) {
      const why =
        stop === "per_search_cap"
          ? `the per-search paid agent limit (${ctx.cfg.agentMaxPerSearch}) was reached`
          : stop === "credits_exhausted"
            ? "TinyFish credits are exhausted"
            : (ctx.budgetBlocked ?? "the daily paid-usage limit was reached");
      ctx.caveats.push(`Price not read for ${notChecked} listing(s): ${why}.`);
    }
  }

  // 5. build offers (dedupe: same product key, or same retailer + title + price; verified rows win)
  const seenOffer = new Set<string>();
  const isVer = (w: Work) => (w.verification === "verified" || w.verification === "agent_verified" ? 1 : 0);
  for (const w of [...work].sort((a, b) => isVer(b) - isVer(a))) {
    const k1 = productKey(w.c.retailer.id, w.c.url) ?? canonicalUrl(w.c.url);
    const k2 = w.price !== null ? `${w.c.retailer.id}|${w.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${w.price}` : null;
    if (seenOffer.has(k1) || (k2 && seenOffer.has(k2))) continue;
    seenOffer.add(k1);
    if (k2) seenOffer.add(k2);
    const m = scoreListing(parsed, w.title);
    const notes = [...m.notes];
    let conf = m.confidence;
    if (w.price !== null && parsed.maxPrice && w.price > parsed.maxPrice) {
      notes.push(`Above the requested budget of ₹${parsed.maxPrice}.`);
      conf = Math.min(conf, 0.3);
    }
    if (w.price === null) notes.push("Price could not be confirmed from the page.");
    if (w.cachedNote) notes.push(w.cachedNote);
    // page-wide promotions for other categories (air fryer, storage devices...) are not offers for this product
    const offerLines = w.offers.filter((t) => isRelevantOfferText(t, w.title));
    offers.push(
      makeOffer(w.c.retailer, w.c.url, w.title, w.price, w.mrp, w.availability, offerLines, m.spec, m.hardExcluded ? 0 : conf, notes, w.verification, w.checkedAt ?? now(), w.imageUrl, w.evidence, w.extra),
    );
  }

  // 6. statuses
  for (const r of retailers) {
    if (statusBy.has(r.id)) continue;
    const mine = work.filter((w) => w.c.retailer.id === r.id);
    const priced = mine.filter((w) => w.price !== null);
    const blocked = mine.filter((w) => issues.get(w.c.url) === "bot_blocked").length;
    const login = mine.filter((w) => issues.get(w.c.url) === "login_required").length;
    let state: RetailerStatus["state"];
    let message: string;
    if (priced.length === mine.length && mine.length > 0) {
      state = "ok";
      message = `${priced.length} listing(s) price-checked on the retailer page.`;
    } else if (priced.length > 0) {
      state = "partial";
      message = `${priced.length} of ${mine.length} listings had a readable price.`;
    } else if (blocked === mine.length) {
      state = "blocked";
      message = "Retailer blocked automated access (bot protection). Not bypassed; prices unavailable.";
    } else if (login === mine.length) {
      state = "login_required";
      message = "Retailer requires login to show price. Prices unavailable.";
    } else {
      state = mine.some((w) => w.fetched) ? "partial" : "error";
      const why = [...new Set(mine.map((w) => fetchErrs.get(w.c.url)).filter(Boolean))].join(", ");
      const skipped = agentSkippedRetailers.get(r.id);
      const skipNote =
        skipped === "target_met"
          ? " Not checked with the paid browser agent: enough other retailers were already verified (cost control)."
          : skipped
            ? " Not checked with the paid browser agent (paid-usage limit)."
            : "";
      message = `Found ${mine.length} product page(s) but could not read a price${why ? ` (${why})` : ""}.${skipNote}${r.proven ? "" : " This retailer integration is not fully proven yet."}`;
    }
    statusBy.set(r.id, { retailer: r.id, retailerName: r.name, state, message, offerCount: priced.length, latencyMs: latency.get(r.id) });
  }

  return { offers: [...offers, ...excludedPre], statuses: retailers.map((r) => statusBy.get(r.id)!).filter(Boolean) };
}

function makeOffer(
  r: RetailerConfig,
  url: string,
  title: string,
  price: number | null,
  mrp: number | null,
  availability: Offer["availability"],
  offerText: string[],
  spec: Offer["spec"],
  conf: number,
  notes: string[],
  verification: Offer["verification"],
  checkedAt: string,
  imageUrl?: string,
  evidence?: string,
  extra: OfferExtra = {},
): Offer {
  return {
    ...extra,
    id: offerId(r.id, url),
    retailer: r.id,
    retailerName: r.name,
    title,
    url,
    imageUrl,
    price,
    mrp,
    discountPct: discountPct(price, mrp),
    deliveryCharge: null,
    availability,
    offers: offerText,
    spec,
    matchConfidence: conf,
    matchNotes: notes,
    verification,
    checkedAt,
    evidence,
  };
}

const priceAsc = (a: Offer, b: Offer) => (a.price ?? Infinity) - (b.price ?? Infinity);

export function buildResponse(args: {
  query: string;
  parsed: ParsedQuery;
  all: Offer[];
  statuses: RetailerStatus[];
  runId: string;
  extraCaveats: string[];
}): SearchResponse {
  const { all, parsed, statuses } = args;
  const matched = all.filter((o) => o.matchConfidence >= 0.5);
  const offers = matched.sort(priceAsc);
  const excluded = all.filter((o) => o.matchConfidence < 0.5);
  const bestVerified =
    offers.find((o) => o.price !== null && (o.verification === "verified" || o.verification === "agent_verified") && o.matchConfidence >= 0.8) ?? null;

  const caveats = [...args.extraCaveats];
  caveats.push("Prices are the listed price read from the retailer page; bank/card offers and coupons are shown verbatim but their conditions are not verified and may not apply at checkout.");
  if (offers.some((o) => o.deliveryCharge === null)) caveats.push("Delivery charges are unknown and not included in comparisons.");
  for (const s of statuses) {
    if (s.state === "blocked" || s.state === "login_required" || s.state === "error") caveats.push(`${s.retailerName}: ${s.message}`);
  }
  const unchecked = statuses.filter((s) => s.state !== "ok" && s.state !== "disabled" && s.state !== "no_results").length;

  let text: string;
  let enough = false;
  if (bestVerified) {
    enough = true;
    const verifiedCount = offers.filter((o) => o.verification === "verified" || o.verification === "agent_verified").length;
    text = `Lowest verified listed price found: ₹${bestVerified.price!.toLocaleString("en-IN")} at ${bestVerified.retailerName}, among ${verifiedCount} verified listing(s)${unchecked ? `; ${unchecked} retailer(s) could not be fully checked, so a cheaper price elsewhere is possible` : ""}. Final price at checkout (offers, delivery) is not guaranteed.`;
  } else if (offers.length) {
    text = "Matching listings were found, but none has a verified price with high match confidence, so I can't name a confirmed cheapest option.";
  } else {
    text = "No confident matches were found. Try adding the exact model and storage, or paste a product link.";
  }
  if (parsed.maxPrice && !offers.some((o) => o.price !== null && o.price <= parsed.maxPrice!)) {
    text += ` No verified listing within the ₹${parsed.maxPrice.toLocaleString("en-IN")} budget was found.`;
  }
  return {
    query: args.query,
    parsed: { rawQuery: parsed.rawQuery, brand: parsed.brand, model: parsed.model, storageGb: parsed.storageGb, ramGb: parsed.ramGb, color: parsed.color, condition: parsed.condition, maxPrice: parsed.maxPrice },
    offers,
    excluded,
    statuses,
    bestVerified,
    recommendation: { text, enoughEvidence: enough, caveats },
    runId: args.runId,
    generatedAt: new Date().toISOString(),
    cached: false,
  };
}

export class SearchInputError extends Error {
  name = "SearchInputError";
}

export interface SearchOptions {
  userId?: string;
  deps?: Deps;
  /** bypass the response cache AND in-flight sharing (cron refresh, benchmarks) */
  skipCache?: boolean;
  persist?: boolean;
  /** user-triggered fresh check: no response/observation cache, TinyFish Fetch ttl 0 */
  fresh?: boolean;
  /** override PP_ROUTING (benchmarks / tests only) */
  routing?: CostConfig["routing"];
}

/**
 * Cost-aware entry point: response cache -> shared in-flight work -> pipeline (discovery cache -> Search -> Fetch ->
 * paid Agent only when justified). Cached responses keep their original timestamps and say they are cached.
 */
export async function searchProducts(rawQuery: string, opts: SearchOptions = {}): Promise<SearchResponse> {
  const store = costContext.getStore();
  const r = await searchProductsInner(rawQuery, { ...opts, fresh: opts.fresh ?? store?.fresh });
  if (store && r.usage) store.usages.push(r.usage);
  return r;
}

async function searchProductsInner(rawQuery: string, opts: SearchOptions): Promise<SearchResponse> {
  const query = rawQuery.trim();
  if (!query) throw new SearchInputError("Query is empty.");
  if (!opts.deps) requireTinyFishKey();
  const base = getCostConfig();
  const cfg: CostConfig = opts.routing ? { ...base, routing: opts.routing } : base;
  const fresh = !!opts.fresh;
  const ck = `${cfg.routing}|${normalizeQueryKey(query)}`;

  if (!opts.skipCache && !fresh) {
    const hit = cache.get(ck);
    if (hit) {
      meter.searchStarted("hit", false);
      return {
        ...hit,
        cached: true,
        cacheAgeSeconds: Math.max(0, Math.round((Date.now() - Date.parse(hit.generatedAt)) / 1000)),
        usage: { ...newUsage("hit", cfg, false), verifiedRetailers: hit.usage?.verifiedRetailers ?? [], retailersSearched: hit.usage?.retailersSearched ?? [] },
      };
    }
  }
  const fk = fresh ? `${ck}|fresh` : ck;
  if (!opts.skipCache) {
    const running = inflight.get(fk);
    if (running) {
      meter.searchStarted("joined", fresh);
      const r = await running;
      return { ...r, usage: { ...newUsage("joined", cfg, fresh), verifiedRetailers: r.usage?.verifiedRetailers ?? [], retailersSearched: r.usage?.retailersSearched ?? [] } };
    }
  }
  meter.searchStarted("miss", fresh);
  const p = runSearch(query, opts, cfg, fresh, ck);
  if (!opts.skipCache) {
    inflight.set(fk, p);
    p.then(
      () => inflight.delete(fk),
      () => inflight.delete(fk),
    );
  }
  return p;
}

async function runSearch(query: string, opts: SearchOptions, cfg: CostConfig, fresh: boolean, ck: string): Promise<SearchResponse> {
  const t0 = Date.now();
  const usage = newUsage("miss", cfg, fresh);
  const deps = meteredDeps(opts.deps ?? defaultDeps, usage);
  const tracker = new RunTracker("search", randomUUID());
  const ctx: PipelineCtx = {
    deps,
    tracker,
    agentBudget: { left: cfg.routing === "legacy" ? MAX_AGENT_RUNS : cfg.agentMaxPerSearch, creditsExhausted: false },
    caveats: [],
    cfg,
    fresh,
    usage,
    t0,
    budgetBlocked: null,
  };
  try {
    let parsed: ParsedQuery;
    let all: Offer[] = [];
    const statuses: RetailerStatus[] = [];
    const enabled = RETAILERS.filter((r) => r.enabled);

    if (looksLikeUrl(query)) {
      const v = validateRetailerUrl(query);
      if (!v.ok) throw new SearchInputError(v.reason);
      tracker.step(`Pasted ${v.retailer.name} link detected`);
      const t0 = Date.now();
      const page = await deps.fetchPages({ urls: [v.url], ttl: 3600, imageLinks: true });
      const p = page.results[0];
      if (!p?.text) {
        const why = page.errors[0]?.error ?? "no content";
        throw new SearchInputError(`Could not read that product page (${why}).`);
      }
      const ex = extractFromMarkdown(p.text, { title: p.title, description: p.description, imageLinks: p.image_links });
      const title = ex.title ?? p.title ?? "";
      if (!title) throw new SearchInputError("Could not determine the product title from that link.");
      parsed = parseQuery(title);
      parsed.rawQuery = query;
      let price = ex.price;
      let verification: Offer["verification"] = price !== null ? "verified" : "unverified";
      let mrp = ex.mrp;
      let evidence = ex.evidence;
      let offersText = ex.offers;
      if (price === null && !v.retailer.fetchHasPrice) {
        try {
          const r = await deps.runAgent({ url: v.url, goal: AGENT_GOAL, outputSchema: AGENT_SCHEMA, maxDurationSeconds: 90, overallTimeoutMs: 110_000 });
          ctx.agentBudget.left--;
          const pr = r.status === "COMPLETED" ? agentResultSchema.safeParse(r.result && typeof r.result === "object" && "result" in (r.result as object) ? (r.result as { result: unknown }).result : r.result) : null;
          if (pr?.success && pr.data.price !== null) {
            price = pr.data.price;
            mrp = pr.data.mrp !== null && pr.data.mrp > pr.data.price ? pr.data.mrp : null;
            if (pr.data.offers?.length) offersText = pr.data.offers.slice(0, 8);
            verification = "agent_verified";
            evidence = `Read by browser agent from live page: price ₹${price}`;
          }
        } catch (e) {
          tracker.step(`Agent failed: ${(e as Error).message}`, "error");
        }
      }
      const m = scoreListing(parsed, title);
      all.push(
        makeOffer(v.retailer, v.url, title, price, mrp, ex.availability, offersText, m.spec, Math.max(m.confidence, 0.9), ["Product link supplied by the user.", ...m.notes], verification, new Date().toISOString(), ex.imageUrl, evidence),
      );
      statuses.push({
        retailer: v.retailer.id,
        retailerName: v.retailer.name,
        state: price !== null ? "ok" : "partial",
        message: price !== null ? "Pasted page read." : "Pasted page read but no price could be confirmed.",
        offerCount: price !== null ? 1 : 0,
        latencyMs: Date.now() - t0,
      });
      const others = enabled.filter((r) => r.id !== v.retailer.id);
      const sq = title.replace(/\s+/g, " ").slice(0, 90);
      const res = await runPipeline(parsed, sq, others, ctx);
      all = all.concat(res.offers);
      statuses.push(...res.statuses);
    } else {
      parsed = parseQuery(query);
      const res = await runPipeline(parsed, cleanSearchQuery(query), enabled, ctx);
      all = res.offers;
      statuses.push(...res.statuses);
    }

    const order = RETAILERS.map((r) => r.id);
    statuses.sort((a, b) => order.indexOf(a.retailer) - order.indexOf(b.retailer));
    const resp = buildResponse({ query, parsed, all, statuses, runId: tracker.id, extraCaveats: ctx.caveats });
    usage.latencyMs = Date.now() - t0;
    usage.retailersSearched = statuses.filter((s) => s.state !== "disabled").map((s) => s.retailer);
    usage.verifiedRetailers = [
      ...new Set(resp.offers.filter((o) => o.price !== null && (o.verification === "verified" || o.verification === "agent_verified") && o.matchConfidence >= 0.8).map((o) => o.retailer)),
    ];
    usage.computedAgentUsd =
      usage.agentRuns === 0 ? 0 : usage.agentRuns === usage.agentRunsWithoutStepCount ? null : Math.round(usage.agentSteps * cfg.usdPerAgentStep * 10_000) / 10_000;
    resp.usage = usage;
    meter.searchFinished({ latencyMs: usage.latencyMs, ttfrMs: usage.timeToFirstVerifiedPriceMs, retailersSearched: usage.retailersSearched, retailersVerified: usage.verifiedRetailers });
    tracker.step(`Done: ${resp.offers.length} matches, ${resp.excluded.length} excluded; paid agent runs ${usage.agentRuns}`);
    await tracker.finish();
    const allFailed = statuses.length > 0 && statuses.every((s) => s.state === "error");
    if (!allFailed && cfg.priceTtlS > 0) cache.set(ck, resp, cfg.priceTtlS * 1000);
    if (opts.persist !== false) await persistSearch(resp, opts.userId);
    return resp;
  } catch (e) {
    await tracker.finish((e as Error).message);
    throw e;
  }
}

export { RETAILER_BY_ID };
