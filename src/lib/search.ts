import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireEnv } from "./env";
import { TtlCache } from "./cache";
import { discountPct, extractFromMarkdown, parseInr } from "./extract";
import { parseMaxPrice, parseQuery, scoreListing, type ParsedQuery } from "./match";
import { RETAILERS, RETAILER_BY_ID, isProductUrl, type RetailerConfig } from "./retailers";
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
const cache = new TtlCache<SearchResponse>(10 * 60_000, 100);
export function clearSearchCache() {
  cache.clear();
}

export function offerId(retailer: RetailerId, url: string): string {
  return createHash("sha1").update(`${retailer}|${canonicalUrl(url)}`).digest("hex").slice(0, 20);
}

const AGENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    price: { type: "number", description: "Current selling price in INR, digits only" },
    mrp: { type: "number", description: "Struck-through MRP in INR if shown, else null" },
    availability: { type: "string", description: "in_stock or out_of_stock" },
    offers: { type: "array", items: { type: "string" }, description: "Bank/cashback/EMI offer text, verbatim" },
  },
  required: ["price"],
};
const AGENT_GOAL =
  "Read this retailer product page without logging in. Return the current selling price in INR (digits only), the MRP if shown, availability (in_stock or out_of_stock), the product title, and up to 5 offer lines verbatim. If a CAPTCHA, login wall or bot check appears, stop and return price null. Do not solve CAPTCHAs.";

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
});

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
}

type FetchIssue = "bot_blocked" | "login_required" | "other";

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
      try {
        const out = await deps.search({ query: searchQuery, location: "IN", includeDomains: [r.domain] });
        latency.set(r.id, Date.now() - t0);
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
    for (const res of s.results) {
      const v = validateRetailerUrl(res.url);
      if (!v.ok || v.retailer.id !== s.r.id || !isProductUrl(s.r, v.url)) continue;
      const key = canonicalUrl(v.url);
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
    scored.sort((a, b) => b.prescore - a.prescore);
    candidates.push(...scored.slice(0, CANDIDATES_PER_RETAILER));
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
  for (let i = 0; i < urls.length; i += 10) {
    const batch = urls.slice(i, i + 10);
    try {
      const out = await deps.fetchPages({ urls: batch, ttl: 3600, imageLinks: true });
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
    verification: Offer["verification"];
    fetched: boolean;
  }
  const work: Work[] = candidates.map((c) => {
    const page = pages.get(c.url);
    if (!page?.text) {
      return { c, title: c.searchTitle, price: null, mrp: null, availability: "unknown", offers: [], verification: "unverified", fetched: false };
    }
    const ex = extractFromMarkdown(page.text, { title: page.title, imageLinks: page.image_links });
    return {
      c,
      title: ex.title ?? page.title ?? c.searchTitle,
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

  // 4. agent fallback (bounded), only for fetched-or-unfetched pages that are not bot blocked / login walls
  const needAgent = work
    .filter((w) => w.price === null && issues.get(w.c.url) !== "bot_blocked" && issues.get(w.c.url) !== "login_required")
    .sort((a, b) => b.c.prescore - a.c.prescore);
  const toRun: Work[] = [];
  for (const w of needAgent) {
    if (ctx.agentBudget.left <= 0 || ctx.agentBudget.creditsExhausted) break;
    ctx.agentBudget.left--;
    toRun.push(w);
  }
  if (needAgent.length > toRun.length) {
    ctx.caveats.push(`Price not read for ${needAgent.length - toRun.length} listing(s): the per-search browser-agent limit (${MAX_AGENT_RUNS}) was reached to protect cost.`);
  }
  await Promise.all(
    toRun.map(async (w) => {
      try {
        tracker.step(`${w.c.retailer.name}: using browser agent for price`);
        const r = await deps.runAgent({ url: w.c.url, goal: AGENT_GOAL, outputSchema: AGENT_SCHEMA, maxDurationSeconds: 90, overallTimeoutMs: 110_000 });
        if (r.status !== "COMPLETED") {
          tracker.step(`${w.c.retailer.name}: agent ${r.status.toLowerCase()}${r.error ? ` (${r.error})` : ""}`, "warn");
          return;
        }
        let raw = r.result as unknown;
        if (raw && typeof raw === "object" && "result" in raw && typeof (raw as { result: unknown }).result === "object") raw = (raw as { result: unknown }).result;
        const p = agentResultSchema.safeParse(raw);
        if (!p.success || p.data.price === null) {
          tracker.step(`${w.c.retailer.name}: agent could not read a price`, "warn");
          return;
        }
        w.price = p.data.price;
        w.mrp = p.data.mrp !== null && p.data.mrp > p.data.price ? p.data.mrp : null;
        if (p.data.title) w.title = p.data.title;
        if (p.data.offers?.length) w.offers = p.data.offers.slice(0, 8);
        const av = (p.data.availability ?? "").toLowerCase();
        w.availability = /out/.test(av) ? "out_of_stock" : /in[_ ]?stock|available/.test(av) ? "in_stock" : w.availability;
        w.verification = "agent_verified";
        w.evidence = `Read by browser agent from live page: price ₹${p.data.price}`;
      } catch (e) {
        if (e instanceof tf.TinyFishError && e.kind === "insufficient_credits") {
          ctx.agentBudget.creditsExhausted = true;
          ctx.caveats.push("TinyFish credits ran out during browser-agent verification.");
        }
        tracker.step(`${w.c.retailer.name}: agent failed (${(e as Error).message})`, "error");
      }
    }),
  );

  // 5. build offers
  for (const w of work) {
    const m = scoreListing(parsed, w.title);
    const notes = [...m.notes];
    let conf = m.confidence;
    if (w.price !== null && parsed.maxPrice && w.price > parsed.maxPrice) {
      notes.push(`Above the requested budget of ₹${parsed.maxPrice}.`);
      conf = Math.min(conf, 0.3);
    }
    if (w.price === null) notes.push("Price could not be confirmed from the page.");
    offers.push(
      makeOffer(w.c.retailer, w.c.url, w.title, w.price, w.mrp, w.availability, w.offers, m.spec, m.hardExcluded ? 0 : conf, notes, w.verification, now(), w.imageUrl, w.evidence),
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
      message = `Found ${mine.length} product page(s) but could not read a price${why ? ` (${why})` : ""}.${r.proven ? "" : " This retailer integration is not fully proven yet."}`;
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
): Offer {
  return {
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

export async function searchProducts(
  rawQuery: string,
  opts: { userId?: string; deps?: Deps; skipCache?: boolean; persist?: boolean } = {},
): Promise<SearchResponse> {
  const query = rawQuery.trim();
  if (!query) throw new SearchInputError("Query is empty.");
  const deps = opts.deps ?? defaultDeps;
  if (!opts.deps) requireEnv("TINYFISH_API_KEY");

  const ck = query.toLowerCase().replace(/\s+/g, " ");
  if (!opts.skipCache) {
    const hit = cache.get(ck);
    if (hit) return { ...hit, cached: true };
  }

  const tracker = new RunTracker("search", randomUUID());
  const ctx: PipelineCtx = { deps, tracker, agentBudget: { left: MAX_AGENT_RUNS, creditsExhausted: false }, caveats: [] };
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
      const ex = extractFromMarkdown(p.text, { title: p.title, imageLinks: p.image_links });
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
    tracker.step(`Done: ${resp.offers.length} matches, ${resp.excluded.length} excluded`);
    await tracker.finish();
    const allFailed = statuses.length > 0 && statuses.every((s) => s.state === "error");
    if (!allFailed) cache.set(ck, resp);
    if (opts.persist !== false) await persistSearch(resp, opts.userId);
    return resp;
  } catch (e) {
    await tracker.finish((e as Error).message);
    throw e;
  }
}

export { RETAILER_BY_ID };
