// Shop pipeline: parse -> route by intent -> (exact | comparison | discovery) -> ShopResponse.
// Business logic only; HTTP concerns live in src/app/api/shop/route.ts.
import { TtlCache } from "@/lib/cache";
import { RunTracker } from "@/lib/runs";
import { getCategoryConfig } from "./categories";
import { resolveAnthropicKey, resolveBuildDecision, resolveBuildOffers } from "./discovery/deps";
import { gatherSpecs, runDiscovery } from "./discovery";
import { filterVariantConflicts, finalizeDecision, lowestVerified, makeGroup, mergeStatuses } from "./discovery/group";
import { pool } from "./discovery/pages";
import { slug } from "./discovery/extract";
import type { Log, ShopDeps, StepSink } from "./discovery/types";
import { parseQueryAsync, parseShopQuery, productQueryFor } from "./parser";
import type { ParsedQuery, ProductGroup, ShopOffer, ShopResponse, ShopWeights, SourceStatus, SpecFact } from "./types";

export type { ShopDeps } from "./discovery/types";

export const DEFAULT_WEIGHTS: ShopWeights = { price: 0.5, delivery: 0.25, evidence: 0.25 };
export type ShopSort = "price" | "delivery" | "relevance";

export interface ShopInput {
  query: string;
  pincode?: string;
  weights?: Partial<ShopWeights>;
  sort?: ShopSort;
  cards?: string[];
  /** Client-chosen run id so the UI can poll GET /api/shop/run/:id from the first step. */
  runId?: string;
}

const cache = new TtlCache<ShopResponse>(10 * 60_000, 100);
export function clearShopCache(): void {
  cache.clear();
}

export function isValidPincode(p: string): boolean {
  return /^[1-9]\d{5}$/.test(p);
}

export function mergeWeights(w?: Partial<ShopWeights>): ShopWeights {
  const out = { ...DEFAULT_WEIGHTS };
  for (const k of ["price", "delivery", "evidence"] as const) {
    const v = w?.[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  if (out.price + out.delivery + out.evidence <= 0) return { ...DEFAULT_WEIGHTS };
  return out;
}

/** "https://www.amazon.in/Samsung-Galaxy-S24-5G/dp/B0..." -> "Samsung Galaxy S24 5G" (null if the link has no readable name). */
export function queryFromProductUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const segs = u.pathname.split("/").filter(Boolean);
  const cand = segs.filter((s) => /[a-z]/i.test(s) && s.includes("-") && !/^(dp|gp|p|product|itm\w*)$/i.test(s));
  const best = [...cand].sort((a, b) => b.length - a.length)[0];
  if (!best) return null;
  const text = decodeURIComponent(best).replace(/[-_+]+/g, " ").replace(/\b(online|buy|price|in india|at best prices?)\b/gi, " ").replace(/\s+/g, " ").trim();
  return text.split(" ").length >= 2 ? text : null;
}

function sortGroups(groups: ProductGroup[], sort: ShopSort): ProductGroup[] {
  const arr = [...groups];
  if (sort === "price") arr.sort((a, b) => (a.lowestVerified?.price ?? Infinity) - (b.lowestVerified?.price ?? Infinity));
  else if (sort === "delivery") {
    const eta = (g: ProductGroup) => Math.min(Infinity, ...g.offers.map((o) => o.delivery?.etaDays ?? Infinity));
    arr.sort((a, b) => eta(a) - eta(b));
  }
  arr.forEach((g, i) => (g.rank = i + 1));
  return arr;
}

function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

/** Strip retailer page-title boilerplate ("Buy ... Online - Croma", "... Online at Best Price On Flipkart.com"). */
export function cleanProductTitle(t: string): string {
  return t
    .replace(/\s*[|:-]\s*(?:croma|vijay sales|reliance digital|flipkart(?:\.com)?|amazon\.in)\b.*$/i, "")
    .replace(/\s+online at best price.*$/i, "")
    .replace(/\s+online\s*$/i, "")
    .replace(/^\s*buy\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const RETAILER_LABEL: Record<string, string> = { amazon: "Amazon.in", flipkart: "Flipkart", croma: "Croma", reliance: "Reliance Digital", vijay: "Vijay Sales" };
const isPriceVerified = (o: ShopOffer) => (o.verificationStatus === "verified" || o.verificationStatus === "agent_verified") && o.listedPrice !== null;

/** Display name from the most trustworthy offer: price-verified first, then match confidence. */
function bestName(offers: ShopOffer[], fallback: string): string {
  const o = [...offers].sort((a, b) => Number(isPriceVerified(b)) - Number(isPriceVerified(a)) || b.matchingConfidence - a.matchingConfidence)[0];
  return (o?.productName && cleanProductTitle(o.productName)) || fallback;
}

function fmt(f: SpecFact): string {
  return `${f.value}${f.unit ? " " + f.unit : ""}`;
}

export async function runShop(input: ShopInput, deps: ShopDeps = {}): Promise<ShopResponse> {
  const now = deps.now ?? (() => new Date());
  const weights = mergeWeights(input.weights);
  const tracker: StepSink = deps.tracker ?? (new RunTracker("search", input.runId ?? deps.runId) as unknown as StepSink);
  const log: Log = (label, status) => tracker.step(label, status ?? "ok");
  try {
    const parsed = await parseQueryAsync(input.query, { anthropicKey: resolveAnthropicKey(deps), fetchImpl: deps.fetchImpl });
    log(`Query parsed: ${parsed.searchIntent}, category ${parsed.category}${parsed.budgetMax !== null ? `, budget up to ${inr(parsed.budgetMax)}` : ""}${parsed.corrections.length ? `, ${parsed.corrections.length} spelling correction(s)` : ""}`);

    const base = { parsed, weights, runId: tracker.id, generatedAt: now().toISOString(), cached: false };
    const empty = (reason: string, statuses: SourceStatus[] = []): ShopResponse => ({ ...base, groups: [], statuses, recommendationProvisional: false, summary: reason, emptyReason: reason });

    // pincode
    const pincode = input.pincode ?? parsed.deliveryPincode ?? null;
    if (input.pincode !== undefined && !isValidPincode(input.pincode)) {
      log("Invalid pincode supplied", "warn");
      const r = empty("Invalid pincode: enter a 6-digit Indian pincode that does not start with 0.");
      await tracker.finish();
      return r;
    }
    if (parsed.deliveryPincode) parsed.deliveryPincode = pincode;

    const sort: ShopSort = input.sort ?? (parsed.sortPreference === "price" || parsed.sortPreference === "delivery" ? parsed.sortPreference : "relevance");
    const key = JSON.stringify({ n: parsed.normalized, u: parsed.url, p: pincode, s: sort, w: weights, c: [...(input.cards ?? [])].sort() });
    if (!deps.noCache) {
      const hit = cache.get(key);
      if (hit) {
        log("Served from 10-minute cache");
        await tracker.finish();
        return { ...structuredClone(hit), cached: true, runId: tracker.id };
      }
    }

    const year = now().getFullYear();
    let res: ShopResponse;
    if (parsed.searchIntent === "PRODUCT_COMPARISON") res = await compare(parsed, { base, pincode, weights, input, deps, log, year });
    else if (parsed.searchIntent === "PRODUCT_RECOMMENDATION" || parsed.searchIntent === "FEATURE_SEARCH") res = await recommend(parsed, { base, pincode, weights, input, deps, log, year });
    // a broad product phrase ("remote control car", "rc car under 2000") in a category without a spec model and
    // without a specific model name is a general search, not an exact-model lookup
    else if (parsed.searchIntent === "EXACT_PRODUCT" && !parsed.model && !getCategoryConfig(parsed.category)) res = await generic(parsed, { base, pincode, weights, input, deps, log, year });
    else res = await exact(parsed, { base, pincode, weights, input, deps, log });

    res.groups = sortGroups(res.groups, sort);
    res.statuses = mergeStatuses(res.statuses);
    log(`Done: ${res.groups.length} product group(s)`, res.groups.length ? "ok" : "warn");
    await tracker.finish();
    if (!deps.noCache && res.groups.length > 0) cache.set(key, structuredClone(res));
    return res;
  } catch (e) {
    log("Run failed", "error");
    await tracker.finish(e instanceof Error ? e.message.slice(0, 200) : "failed");
    throw e;
  }
}

interface Ctx {
  base: Pick<ShopResponse, "parsed" | "weights" | "runId" | "generatedAt" | "cached">;
  pincode: string | null;
  weights: ShopWeights;
  input: ShopInput;
  deps: ShopDeps;
  log: Log;
  year?: number;
}

function emptyRes(ctx: Ctx, reason: string, statuses: SourceStatus[]): ShopResponse {
  return { ...ctx.base, groups: [], statuses, recommendationProvisional: false, summary: reason, emptyReason: reason };
}

async function offersGroup(query: string, p: Partial<ParsedQuery> & Pick<ParsedQuery, "variant">, ctx: Ctx): Promise<{ group: ProductGroup | null; statuses: SourceStatus[]; reason: string | null }> {
  const buildOffers = await resolveBuildOffers(ctx.deps);
  if (!buildOffers) return { group: null, statuses: [{ source: "retailers", state: "error", message: "Retailer offer lookup is unavailable." }], reason: "Retailer price lookup is unavailable." };
  const buildDecision = await resolveBuildDecision(ctx.deps);
  ctx.log(`Looking up verified retailer offers for "${query}"`);
  let r;
  try {
    r = await buildOffers(query, { pincode: ctx.pincode, cards: ctx.input.cards, parsed: p });
  } catch (e) {
    ctx.log(`Offer lookup failed for "${query}"`, "error");
    return { group: null, statuses: [{ source: "retailers", state: "error", message: `Offer lookup failed${e instanceof Error ? `: ${e.message.slice(0, 100)}` : ""}` }], reason: "Retailer lookup failed; no prices could be verified." };
  }
  ctx.log(`Offers for "${query}": ${r.offers.length} verified, ${r.excluded.length} excluded as different products`, r.offers.length ? "ok" : "warn");
  const f = filterVariantConflicts(r.offers, { ramGb: p.variant.ramGb, storageGb: p.variant.storageGb });
  if (f.offers.length === 0) {
    return { group: null, statuses: r.statuses, reason: r.offers.length ? "Offers were found only for a different variant than the one requested." : `No verified store offers found for "${query}".` };
  }
  const decision = finalizeDecision(f.offers, ctx.weights, buildDecision);
  if (f.removed) decision.notes.push(`${f.removed} offer(s) for a different variant were excluded.`);
  const name = bestName(f.offers, query);
  const group = makeGroup({ id: slug(name), name, brand: p.brand ?? null, model: p.model ?? null, variant: p.variant, offers: f.offers, decision });
  return { group, statuses: r.statuses, reason: null };
}

async function exact(parsed: ParsedQuery, ctx: Ctx): Promise<ShopResponse> {
  let query = productQueryFor(parsed);
  let p: ParsedQuery = parsed;
  if (parsed.searchIntent === "PRODUCT_URL") {
    const q = parsed.url ? queryFromProductUrl(parsed.url) : null;
    if (!q) {
      ctx.log("Could not read a product name from the link", "warn");
      return emptyRes(ctx, "Could not identify the product from that link. Paste the product name (for example brand, model and storage) instead.", []);
    }
    query = q;
    p = parseShopQuery(q);
    ctx.log(`Product link resolved to query "${q}"`);
  }
  const { group, statuses, reason } = await offersGroup(query, p, ctx);
  if (!group) return emptyRes(ctx, reason ?? "No relevant verified results found.", statuses);
  const stores = new Set(group.offers.map((o) => o.retailer)).size;
  const verified = group.offers.filter(isPriceVerified);
  const verifiedStores = new Set(verified.map((o) => o.retailer)).size;
  const low = group.lowestVerified;
  const parts = [
    `Found ${group.offers.length} matching offer(s) for "${group.name}" across ${stores} store(s); ${verified.length} with a verified price at ${verifiedStores} store(s).`,
  ];
  if (verified.length < group.offers.length) parts.push(`${group.offers.length - verified.length} offer(s) could not be price-verified and are shown as unknown.`);
  if (low) parts.push(`Lowest verified listed price is ${inr(low.price)} at ${RETAILER_LABEL[low.retailer] ?? low.retailer}.`);
  if (group.decision.singleStoreOnly) parts.push("Multi-store comparison is not possible yet: only one verified store offer was found.");
  parts.push("Delivery dates are not verified until you check them for your pincode.");
  return { ...ctx.base, groups: [group], statuses, recommendationProvisional: false, summary: parts.join(" "), emptyReason: null };
}

const GENERIC_STOP = /\b(best|top|good|great|cheap|cheapest|latest|new|buy|online|india|price|prices|sabse|accha|achha|sasta|wala|wali)\b/gi;
const MAX_GENERIC_GROUPS = 8;

/**
 * Any product category without a scoring config (toys, kettles, shoes, mice, groceries...): one real retailer search
 * (TinyFish Search -> Fetch -> selective Agent, same pipeline and caches), then each matched listing becomes its own
 * product card. Nothing is ranked by specs (there is no spec model for the category): verified prices first.
 */
async function generic(parsed: ParsedQuery, ctx: Ctx): Promise<ShopResponse> {
  const budget = parsed.budgetMax !== null ? ` under ${parsed.budgetMax}` : "";
  const core = parsed.raw.replace(GENERIC_STOP, " ").replace(/\b(under|below|upto|up to|within|less than)\s*(?:rs\.?|₹)?\s*[\d,.]+\s*k?\b/gi, " ").replace(/\s+/g, " ").trim() || parsed.raw;
  const q = `${core}${budget}`;
  ctx.log(`General product search for "${q}" (no category scoring model; listings matched by title)`);
  const searchFn = ctx.deps.searchProducts ?? (await import("@/lib/search")).searchProducts;
  const { buildOffers } = await import("./offers");
  let sr;
  try {
    sr = await searchFn(q);
  } catch (e) {
    ctx.log("Retailer search failed", "error");
    return emptyRes(ctx, `Retailer search failed${e instanceof Error ? `: ${e.message.slice(0, 100)}` : ""}.`, []);
  }
  const statuses: SourceStatus[] = sr.statuses.map((s) => ({ source: s.retailer, state: s.state === "disabled" ? "disabled" : s.state, message: s.message, latencyMs: s.latencyMs }) as SourceStatus);
  const listings = sr.offers.filter((o) => o.matchConfidence >= 0.5);
  const byTitle = new Map<string, typeof listings>();
  for (const o of listings) {
    const k = cleanProductTitle(o.title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 70);
    if (!k) continue;
    byTitle.set(k, [...(byTitle.get(k) ?? []), o]);
  }
  const groups: ProductGroup[] = [];
  {
    for (const [, ls] of byTitle) {
      if (groups.length >= MAX_GENERIC_GROUPS) break;
      // re-uses the already fetched listing: no extra TinyFish calls
      const r = await buildOffers(ls[0].title, { pincode: ctx.pincode, cards: ctx.input.cards, parsed: { budgetMax: parsed.budgetMax } }, { search: async () => ({ ...sr!, offers: ls, excluded: [] }) }).catch(() => null);
      if (!r || r.offers.length === 0) continue;
      const buildDecision = await resolveBuildDecision(ctx.deps);
      const name = bestName(r.offers, cleanProductTitle(ls[0].title));
      const g = makeGroup({ id: slug(name), name, brand: r.offers[0].brand ?? null, model: null, variant: parsed.variant, offers: r.offers, decision: finalizeDecision(r.offers, ctx.weights, buildDecision) });
      g.provisional = !g.lowestVerified;
      // a verified price above the budget is not an in-budget match (summary says "within budget")
      if (parsed.budgetMax !== null && g.lowestVerified && g.lowestVerified.price > parsed.budgetMax) continue;
      groups.push(g);
    }
  }
  groups.sort((a, b) => Number(!!b.lowestVerified) - Number(!!a.lowestVerified) || (a.lowestVerified?.price ?? Infinity) - (b.lowestVerified?.price ?? Infinity));
  groups.forEach((g, i) => (g.rank = i + 1));
  const verified = groups.filter((g) => g.lowestVerified).length;
  ctx.log(`General search: ${groups.length} product(s), ${verified} with a verified price`, groups.length ? "ok" : "warn");
  if (!groups.length) {
    return emptyRes(ctx, `No matching listings with readable details were found for "${core}" at the stores we check. Try a more specific product name or brand.`, statuses);
  }
  const summary = [
    `${groups.length} matching product(s) for "${core}"${parsed.budgetMax !== null ? ` within ${inr(parsed.budgetMax)}` : ""}; ${verified} with a verified store price.`,
    "General product search: listings are matched by their title and shown cheapest verified first, not ranked by specifications.",
  ];
  if (verified < groups.length) summary.push(`${groups.length - verified} listing(s) could not be price-verified and are shown as unverified leads.`);
  return { ...ctx.base, groups, statuses, recommendationProvisional: true, summary: summary.join(" "), emptyReason: null };
}

async function recommend(parsed: ParsedQuery, ctx: Ctx): Promise<ShopResponse> {
  // categories without a scoring model still get a real search (never an instant "not supported")
  if (!getCategoryConfig(parsed.category)) return generic(parsed, ctx);
  const d = await runDiscovery(parsed, { weights: ctx.weights, pincode: ctx.pincode, cards: ctx.input.cards, deps: ctx.deps, log: ctx.log, year: ctx.year ?? new Date().getFullYear() });
  if (d.groups.length === 0) {
    const r = emptyRes(ctx, d.emptyReason ?? "No relevant verified results found.", d.statuses);
    if (d.notes.length) r.summary = `${r.summary} ${d.notes.join(" ")}`;
    r.recommendationProvisional = true;
    return r;
  }
  const prov = d.groups.filter((g) => g.provisional).length;
  const budget = parsed.budgetMax !== null ? ` within ${inr(parsed.budgetMax)}` : "";
  const parts = [
    `Top ${d.groups.length} ${parsed.category} pick(s)${budget}, ranked from specifications found in the pages read; every spec shown links to its source. Scores are a transparent weighted blend, not benchmarks.`,
  ];
  if (prov) parts.push(`${prov} pick(s) are provisional because some key specs were not found.`);
  const unscored = d.groups.filter((g) => g.score?.total === null).length;
  if (unscored) parts.push(`${unscored} pick(s) have too little evidence for an overall score and are ranked by evidence coverage, then price.`);
  if (d.groups.length < 5) parts.push(`Only ${d.groups.length} candidate(s) had enough evidence and a verified price.`);
  parts.push(...d.notes);
  parts.push("Delivery dates are not verified until you check them for your pincode.");
  return { ...ctx.base, groups: d.groups, statuses: d.statuses, recommendationProvisional: prov > 0, summary: parts.join(" "), emptyReason: null };
}

async function compare(parsed: ParsedQuery, ctx: Ctx): Promise<ShopResponse> {
  const sides = parsed.comparisonTargets.slice(0, 3);
  const cfg = getCategoryConfig(parsed.category);
  const year = ctx.year ?? new Date().getFullYear();
  const statuses: SourceStatus[] = [];
  const results = await pool(sides, 2, async (side) => {
    const sp = parseShopQuery(side);
    const variant = sp.variant;
    const [o, s] = await Promise.all([
      offersGroup(side, { ...sp, category: sp.category === "other" ? parsed.category : sp.category, variant }, ctx),
      cfg ? gatherSpecs(side, parsed, ctx.deps, ctx.log, year) : Promise.resolve({ specs: [] as SpecFact[], statuses: [] as SourceStatus[] }),
    ]);
    return { side, o, s };
  });
  const groups: ProductGroup[] = [];
  const missingOffers: string[] = [];
  for (const { side, o, s } of results) {
    statuses.push(...o.statuses, ...s.statuses);
    if (o.group) { o.group.specs = s.specs; groups.push(o.group); } else missingOffers.push(side);
  }
  let table: NonNullable<ShopResponse["comparison"]>["table"] = [];
  if (cfg) {
    table = cfg.specKeys
      .map((k) => {
        const facts = results.map((r) => r.s.specs.find((f) => f.key === k.key));
        return facts.every(Boolean) ? { key: k.key, label: k.label, values: facts.map((f) => fmt(f as SpecFact)) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }
  const parts = [`Compared ${sides.join(" vs ")}.`];
  parts.push(table.length ? `${table.length} specification(s) are shown because they were found with source evidence for every product.` : "No specification was found with evidence for every product, so no spec table is shown.");
  if (missingOffers.length) parts.push(`No verified store offers found for: ${missingOffers.join(", ")}.`);
  if (groups.length) parts.push("Delivery dates are not verified until you check them for your pincode.");
  const res: ShopResponse = {
    ...ctx.base, groups, statuses, recommendationProvisional: missingOffers.length > 0 || table.length === 0,
    comparison: { sides, table }, summary: parts.join(" "), emptyReason: groups.length ? null : "No verified offers were found for any of the compared products.",
  };
  if (!groups.length) res.summary = `${res.summary}`;
  void lowestVerified;
  return res;
}
