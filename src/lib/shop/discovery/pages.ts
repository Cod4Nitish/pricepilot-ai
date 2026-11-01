// TinyFish Search + Fetch for discovery. Bounded concurrency; failures become honest statuses.
import { TinyFishError, fetchPages as realFetch, search as realSearch } from "@/lib/tinyfish";
import type { Category, ParsedQuery, SourceStatus } from "../types";
import { requestedProductType } from "../requirements";
import { hostOf } from "./evidence";
import type { FetchedText, Log, ShopDeps } from "./types";

export const JUNK_DOMAINS = [
  "pinterest.com", "facebook.com", "instagram.com", "youtube.com", "twitter.com", "x.com", "quora.com", "linkedin.com", "tiktok.com",
  "ebay.com", "aliexpress.com", "alibaba.com", "temu.com", "wish.com", "olx.in", "olx.com", "scribd.com", "slideshare.net",
];
const PREFERRED = ["gsmarena.com", "91mobiles.com", "smartprix.com", "gadgets360.com", "ndtv.com", "digit.in", "techradar.com", "notebookcheck.net", "rtings.com", "pcmag.com", "tomsguide.com", "androidauthority.com", "indianexpress.com", "hindustantimes.com", "timesofindia.indiatimes.com", "tech.hindustantimes.com", "beebom.com", "mysmartprice.com", "flipkart.com", "amazon.in", "croma.com"];

const CAT_WORD: Partial<Record<Category, string>> = { smartphone: "smartphones", laptop: "laptops", headphones: "earbuds headphones", tv: "smart TVs" };

export function isJunk(url: string): boolean {
  const h = hostOf(url);
  return JUNK_DOMAINS.some((d) => h === d || h.endsWith("." + d));
}

/** Does a search result's title/URL talk about the requested budget ("under 50000", "under-50-000", "50k")? */
export function mentionsBudget(text: string, budget: number | null): boolean {
  if (budget === null) return false;
  const t = text.toLowerCase().replace(/[,\s_-]+/g, "");
  const k = budget % 1000 === 0 ? `${budget / 1000}k` : null;
  return t.includes(`under${budget}`) || t.includes(`below${budget}`) || t.includes(`under₹${budget}`) || t.includes(`underrs${budget}`) || (k !== null && (t.includes(`under${k}`) || t.includes(`below${k}`) || t.includes(`under₹${k}`) || t.includes(`underrs${k}`)));
}

export function buildQueries(p: ParsedQuery, year: number): string[] {
  // an explicitly requested brand / product type belongs in the discovery query ("best Sony headphones under 5000")
  const type = requestedProductType(p.raw);
  const cat = `${p.brand ? `${p.brand} ` : ""}${type ? (type.endsWith("s") ? type : `${type}s`) : (CAT_WORD[p.category] ?? p.category)}`;
  const budget = p.budgetMax !== null ? ` under ${p.budgetMax}` : p.budgetMin !== null ? ` above ${p.budgetMin}` : "";
  const feats = p.preferredFeatures.filter((f) => !["5g"].includes(f)).slice(0, 3).join(" ");
  const specs: string[] = [];
  if (p.variant.gpu) specs.push(p.variant.gpu);
  if (p.variant.ramGb) specs.push(`${p.variant.ramGb}GB RAM`);
  if (p.variant.storageGb) specs.push(`${p.variant.storageGb}GB`);
  if (p.preferredFeatures.includes("5g")) specs.push("5G");
  const qs = [`best ${cat}${budget} India ${year}`];
  if (feats) qs.push(`best ${feats} ${cat}${budget} India ${year} review`);
  if (specs.length) qs.push(`${cat} ${specs.join(" ")}${budget} India ${year} price specifications`);
  else qs.push(`top ${cat}${budget} India ${year} specifications price`);
  return Array.from(new Set(qs)).slice(0, 3);
}

function stateFor(e: unknown): SourceStatus["state"] {
  if (e instanceof TinyFishError) return e.kind === "timeout" ? "timeout" : "error";
  return "error";
}
function msgFor(e: unknown): string {
  if (e instanceof TinyFishError) return e.kind === "insufficient_credits" ? "Search provider has no remaining credits." : `Search provider error (${e.kind}).`;
  return "Search failed.";
}

async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export interface PageResult {
  pages: FetchedText[];
  statuses: SourceStatus[];
}

export async function discoverPages(p: ParsedQuery, deps: ShopDeps, log: Log, year: number, topN = 6): Promise<PageResult> {
  const search = deps.search ?? realSearch;
  const fetchP = deps.fetchPages ?? realFetch;
  const statuses: SourceStatus[] = [];
  const queries = buildQueries(p, year);
  const t0 = Date.now();
  log(`Discovery search started (${queries.length} queries)`);
  const settled = await pool(queries, 2, async (q) => {
    try {
      const r = await search({ query: q, location: "IN", excludeDomains: JUNK_DOMAINS });
      return { ok: true as const, results: r.results };
    } catch (e) {
      return { ok: false as const, error: e };
    }
  });
  const failed = settled.filter((s) => !s.ok);
  const seen = new Set<string>();
  const urls: { url: string; score: number }[] = [];
  for (const s of settled) {
    if (!s.ok) continue;
    for (const r of s.results) {
      let u: URL;
      try { u = new URL(r.url); } catch { continue; }
      if (u.protocol !== "https:" && u.protocol !== "http:") continue;
      if (isJunk(r.url)) continue;
      const key = u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      const h = hostOf(r.url);
      const pref = PREFERRED.findIndex((d) => h === d || h.endsWith("." + d));
      // budget listing pages ("best phones under 50000") list in-budget models: read those first
      const budgetPage = mentionsBudget(`${r.title ?? ""} ${u.pathname}`, p.budgetMax) ? 200 : 0;
      urls.push({ url: r.url, score: budgetPage + (pref >= 0 ? 100 - pref : 0) });
    }
  }
  urls.sort((a, b) => b.score - a.score);
  const top = urls.slice(0, topN).map((u) => u.url);
  const lat = Date.now() - t0;
  if (failed.length === queries.length) {
    statuses.push({ source: "discovery:search", state: stateFor(failed[0].ok ? null : failed[0].error), message: msgFor(failed[0].ok ? null : failed[0].error), latencyMs: lat });
    log("Discovery search failed", "error");
    return { pages: [], statuses };
  }
  statuses.push({
    source: "discovery:search",
    state: urls.length === 0 ? "no_results" : failed.length ? "partial" : "ok",
    message: `${queries.length - failed.length}/${queries.length} queries succeeded, ${urls.length} candidate pages (${top.length} selected)`,
    latencyMs: lat,
  });
  log(`Discovery search finished: ${urls.length} pages found, ${top.length} selected`, urls.length ? "ok" : "warn");
  if (top.length === 0) return { pages: [], statuses };

  const t1 = Date.now();
  const chunks: string[][] = [];
  for (let i = 0; i < top.length; i += 3) chunks.push(top.slice(i, i + 3));
  const fetched = await pool(chunks, 2, async (c) => {
    try {
      return { ok: true as const, out: await fetchP({ urls: c, ttl: 3600, perUrlTimeoutMs: 30_000 }) };
    } catch (e) {
      return { ok: false as const, error: e };
    }
  });
  const pages: FetchedText[] = [];
  let errs = 0;
  for (const f of fetched) {
    if (!f.ok) { errs += 1; continue; }
    errs += f.out.errors.length;
    for (const r of f.out.results) if (r.text && r.text.length > 200) pages.push({ url: r.url, title: r.title ?? "", text: r.text.slice(0, 80_000) });
  }
  statuses.push({
    source: "discovery:fetch",
    state: pages.length === 0 ? "error" : errs > 0 ? "partial" : "ok",
    message: `${pages.length}/${top.length} pages fetched${errs ? `, ${errs} failed` : ""}`,
    latencyMs: Date.now() - t1,
  });
  log(`Fetched ${pages.length}/${top.length} pages`, pages.length ? "ok" : "warn");
  return { pages, statuses };
}

/** Targeted spec lookup for one product (comparison). */
export async function discoverSpecPages(name: string, deps: ShopDeps, log: Log, year: number): Promise<PageResult> {
  const search = deps.search ?? realSearch;
  const fetchP = deps.fetchPages ?? realFetch;
  const statuses: SourceStatus[] = [];
  try {
    const r = await search({ query: `${name} specifications India ${year}`, location: "IN", excludeDomains: JUNK_DOMAINS });
    const urls = Array.from(new Set(r.results.filter((x) => !isJunk(x.url)).map((x) => x.url))).slice(0, 3);
    statuses.push({ source: "discovery:search", state: urls.length ? "ok" : "no_results", message: `${name}: ${urls.length} spec pages` });
    log(`Spec search for "${name}": ${urls.length} pages`, urls.length ? "ok" : "warn");
    if (!urls.length) return { pages: [], statuses };
    const f = await fetchP({ urls, ttl: 3600, perUrlTimeoutMs: 30_000 });
    const pages = f.results.filter((x) => x.text && x.text.length > 200).map((x) => ({ url: x.url, title: x.title ?? "", text: (x.text as string).slice(0, 80_000) }));
    statuses.push({ source: "discovery:fetch", state: pages.length ? (f.errors.length ? "partial" : "ok") : "error", message: `${name}: ${pages.length}/${urls.length} pages fetched` });
    log(`Fetched ${pages.length}/${urls.length} spec pages for "${name}"`, pages.length ? "ok" : "warn");
    return { pages, statuses };
  } catch (e) {
    statuses.push({ source: "discovery:search", state: stateFor(e), message: `${name}: ${msgFor(e)}` });
    log(`Spec lookup for "${name}" failed`, "error");
    return { pages: [], statuses };
  }
}

export { pool };
