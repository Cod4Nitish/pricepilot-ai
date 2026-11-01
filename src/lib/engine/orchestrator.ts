// Unified engine: understand -> route -> collect (injectable) -> normalise -> resolve/compare -> recommend.
import { randomUUID } from "node:crypto";
import { TtlCache } from "../cache";
import { heuristicIntent, type Mode } from "../intent";
import { parseMaxPrice } from "../match";
import type { FastOffer, ProviderResult } from "../fast/types";
import type { RetailerStatus, SearchResponse } from "../types";
import { fromEcommerceOffer, fromQuickOffer, quickCtxFromResult } from "./adapters";
import { compareEcommerce, type EcomEntry } from "./ecommerce/pipeline";
import { normalizeWeights, pickCheapest, pickFastest, scoreCandidates, type RankCand, type Weights } from "./rank";
import type { UnifiedOffer } from "./schema";
import { compareQuick, type QuickConstraints, type QuickResult, type QuickStoreInput } from "./quick/basket";
import type { BasketNeed } from "./quick/solver";
import type { ExcludedOffer, Pick, Recommendation, SourceStatus } from "./types";
import { parseNeed } from "./units";

export interface Collectors {
  ecommerce(query: string): Promise<SearchResponse>;
  quick(pincode: string, queries: string[]): Promise<{ results: ProviderResult[]; failures: { providerId: string; message: string }[] }>;
}

export interface EngineInput {
  text: string;
  pincode?: string;
  budget?: number;
  weights?: Partial<Weights>;
  constraints?: QuickConstraints;
  cards?: string[];
  coupons?: string[];
}

export interface Understanding {
  text: string;
  items: { query: string; route: Mode; reason: string }[];
  pincode: string | null;
  pincodeSource: "explicit_input" | "text" | null;
  budget: number | null;
  maxEtaMinutes: number | null;
  urgent: boolean;
  weightsUsed: Weights;
  notes: string[];
}

export interface PerItemResult {
  request: string;
  route: Mode;
  routeReason: string;
  offers: UnifiedOffer[];
  excluded: ExcludedOffer[];
  ecommerce?: { entries: { offer: UnifiedOffer; decision: string; confidence: number; reasons: string[]; mismatches: unknown[]; listedTotal: number | null; effectiveTotal: number | null; bestCaseEffectiveConditional: number | null; totalIsLowerBound: boolean; unknownFees: string[] }[]; recommendation: Recommendation };
  quick?: QuickResult;
  crossMode?: { comparable: boolean; reason: string; ecommerceTotal: number | null; quickTotal: number | null; winner: "ecommerce" | "quick" | null };
  recommendation: Recommendation;
}

export interface EngineResponse {
  understanding: Understanding;
  perItem: PerItemResult[];
  baskets?: QuickResult;
  statuses: SourceStatus[];
  runId: string;
  generatedAt: string;
}

export interface EngineOptions {
  collectors: Collectors;
  /** pass null to disable caching (tests) */
  cache?: TtlCache<unknown> | null;
  concurrency?: number;
  now?: () => Date;
}

const sharedCache = new TtlCache<unknown>(5 * 60_000, 100);
const DEFAULT_W = { price: 0.6, speed: 0.25, trust: 0.15 };


async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export function understand(input: EngineInput): Understanding {
  const notes: string[] = [];
  let text = input.text.trim().replace(/(\d),\s+(?=\S)/g, "$1 ; ");
  let pincode: string | null = null;
  let pincodeSource: Understanding["pincodeSource"] = null;
  if (input.pincode) {
    pincode = input.pincode;
    pincodeSource = "explicit_input";
  }
  const pm = /(?:^|[^\d])([1-9]\d{5})(?!\d)/.exec(text);
  if (pm) {
    if (!pincode) {
      pincode = pm[1];
      pincodeSource = "text";
    }
    text = text.replace(pm[1], " ");
    text = text.replace(/\b(?:pincode|pin code|pin|deliver(?:y)? to|at)\s*(?=\s|$)/gi, " ");
  }
  const mp = parseMaxPrice(text);
  const budget = input.budget ?? mp.maxPrice ?? null;
  if (mp.maxPrice !== undefined) text = mp.cleaned;
  const etaM = /\b(\d{1,3})\s*-?\s*min(?:ute)?s?\b/i.exec(text);
  const urgent = /\b(today|now|right now|asap|urgent|abhi|jaldi|instant|\d+\s*-?\s*min)/i.test(input.text);
  const maxEtaMinutes = input.constraints?.maxEtaMinutes ?? (etaM ? Number(etaM[1]) : null);
  if (etaM) text = text.replace(etaM[0], " ");
  text = text.replace(/\b(?:deliver(?:y|ed)?\s+(?:in|within))\b/gi, " ").replace(/\s+/g, " ").trim();
  let weightsUsed = normalizeWeights(input.weights);
  if (urgent && !input.weights) {
    weightsUsed = normalizeWeights({ price: 0.45, speed: 0.4, trust: 0.15 });
    notes.push("Urgency detected: speed weighted higher than default (price 0.45, speed 0.40, trust 0.15).");
  }
  const intent = heuristicIntent(text || input.text);
  return {
    text: input.text.trim(),
    items: intent.items.map((i) => ({ query: i.query, route: i.mode, reason: i.reason })),
    pincode,
    pincodeSource,
    budget,
    maxEtaMinutes,
    urgent,
    weightsUsed,
    notes,
  };
}

function mapRetailerStatus(s: RetailerStatus): SourceStatus {
  const state: SourceStatus["state"] = s.state === "ok" ? "ok" : s.state === "partial" ? "partial" : s.state === "no_results" ? "ok" : s.state === "disabled" ? "skipped" : s.state === "error" ? "failed" : "unavailable";
  return { source: `ecommerce:${s.retailer}`, state, message: s.message, offerCount: s.offerCount };
}

const QUICK_OK = new Set(["ok", "partial", "no_results"]);

export async function runEngine(input: EngineInput, opts: EngineOptions): Promise<EngineResponse> {
  const now = opts.now ?? (() => new Date());
  const cache = opts.cache === undefined ? sharedCache : opts.cache;
  const u = understand(input);
  const statuses: SourceStatus[] = [];
  const payment = { cards: input.cards, coupons: input.coupons };
  const constraints: QuickConstraints = { ...input.constraints, ...(u.maxEtaMinutes !== null ? { maxEtaMinutes: u.maxEtaMinutes } : {}) };
  const singleItem = u.items.length === 1;

  const items = u.items.map((it, idx) => ({ ...it, idx, id: `n${idx}`, ecom: it.route !== "quick", quick: it.route !== "ecommerce" }));

  // ---- collect e-commerce (bounded concurrency + cache) ----
  const ecomItems = items.filter((i) => i.ecom);
  const ecomResults = new Map<number, SearchResponse | null>();
  await mapLimit(ecomItems, opts.concurrency ?? 2, async (it) => {
    const ck = `e|${it.query.toLowerCase()}`;
    try {
      const hit = cache?.get(ck) as SearchResponse | undefined;
      const r = hit ?? (await opts.collectors.ecommerce(it.query));
      if (!hit) cache?.set(ck, r);
      ecomResults.set(it.idx, r);
      for (const s of r.statuses) statuses.push({ ...mapRetailerStatus(s), source: `ecommerce:${s.retailer} [${it.query}]` });
    } catch (e) {
      ecomResults.set(it.idx, null);
      statuses.push({ source: `ecommerce [${it.query}]`, state: "failed", message: errMsg(e), offerCount: 0 });
    }
  });

  // ---- collect quick commerce (single batched call) ----
  const quickItems = items.filter((i) => i.quick);
  let quickResults: ProviderResult[] = [];
  if (quickItems.length) {
    if (!u.pincode) {
      statuses.push({ source: "quick", state: "skipped", message: "Quick-commerce skipped: a delivery pincode is required (none given).", offerCount: 0 });
    } else {
      const queries = quickItems.map((i) => i.query);
      const ck = `q|${u.pincode}|${queries.join("|").toLowerCase()}`;
      try {
        const hit = cache?.get(ck) as { results: ProviderResult[]; failures: { providerId: string; message: string }[] } | undefined;
        const r = hit ?? (await opts.collectors.quick(u.pincode, queries));
        if (!hit) cache?.set(ck, r);
        quickResults = r.results;
        for (const p of r.results) {
          const n = p.lines.filter((l) => l.offer).length;
          statuses.push({ source: `quick:${p.providerId}`, state: p.state === "ok" ? "ok" : p.state === "partial" || p.state === "no_results" ? "partial" : "unavailable", message: p.state === "ok" ? `ok (${n} offers)` : `${p.state}${p.reason ? `: ${p.reason}` : ""}`, offerCount: n });
        }
        for (const f of r.failures) statuses.push({ source: `quick:${f.providerId}`, state: "failed", message: f.message, offerCount: 0 });
      } catch (e) {
        statuses.push({ source: "quick", state: "failed", message: errMsg(e), offerCount: 0 });
      }
    }
  }

  // ---- quick normalisation ----
  const needs: BasketNeed[] = quickItems.map((it) => {
    const n = parseNeed(it.query);
    return { id: it.id, query: it.query, unit: n.unit, amount: n.amount };
  });
  const stores: QuickStoreInput[] = quickResults.map((r) => ({
    id: r.providerId,
    name: r.providerName,
    state: r.state,
    reason: r.reason,
    locationVerified: r.locationVerified,
    etaMinutes: r.etaMinutes,
    fees: { delivery: r.fees.delivery, handling: r.fees.handling, platform: r.fees.platform, smallCartFee: null, smallCartThreshold: null, freeDeliveryThreshold: null },
    observedDiscount: r.fees.discount,
  }));
  const offersByNeed: Record<string, UnifiedOffer[]> = {};
  const quickRejected: Record<string, ExcludedOffer[]> = {};
  for (const n of needs) {
    offersByNeed[n.id] = [];
    quickRejected[n.id] = [];
  }
  for (const r of quickResults) {
    if (!QUICK_OK.has(r.state)) continue;
    const ctx = quickCtxFromResult(r, u.pincode);
    for (const l of r.lines) {
      const need = needs.find((n) => n.query === l.query);
      if (!need) continue;
      const add = (o: FastOffer | null, bucket: "ok" | "rej", why: string) => {
        if (!o) return;
        const uo = fromQuickOffer(o, ctx);
        if (bucket === "ok" && l.resolution !== "mismatch" && l.resolution !== "no_match") offersByNeed[need.id].push(uo);
        else quickRejected[need.id].push({ offer: uo, reason: why, decision: "reject" });
      };
      add(l.offer, "ok", l.note || l.resolution);
      for (const rej of l.rejected) add(rej, "rej", `Not a match for the request (${l.note || "rejected by matcher"}).`);
    }
  }
  const quickBudget = constraints.budget ?? u.budget ?? undefined;
  const quickFor = (ns: BasketNeed[], forBasket: boolean): QuickResult =>
    compareQuick({
      needs: ns,
      offersByNeed,
      stores,
      pincode: u.pincode,
      constraints: { ...constraints, ...(forBasket && quickBudget !== undefined ? { budget: quickBudget } : { budget: undefined }) },
      weights: u.weightsUsed,
      includeUnknownStock: true,
    });

  // ---- per item ----
  const perItem: PerItemResult[] = items.map((it) => {
    const res: PerItemResult = {
      request: it.query,
      route: it.route,
      routeReason: it.reason,
      offers: [],
      excluded: [],
      recommendation: emptyRec(`No data collected for "${it.query}".`),
    };
    let eRec: Recommendation | null = null;
    let qRec: Recommendation | null = null;
    let eTop: EcomEntry | null = null;
    if (it.ecom) {
      const sr = ecomResults.get(it.idx);
      if (sr) {
        const offers = [...sr.offers, ...sr.excluded].map((o) => fromEcommerceOffer(o, { locationId: u.pincode }));
        const cmp = compareEcommerce(it.query, offers, { ...payment, budget: singleItem ? u.budget : null, weights: u.weightsUsed });
        res.ecommerce = {
          entries: cmp.entries.map((e) => ({ offer: e.offer, decision: e.resolution.decision, confidence: e.resolution.confidence, reasons: e.resolution.reasons, mismatches: e.resolution.mismatches, listedTotal: e.pricing.listedTotal, effectiveTotal: e.pricing.effectiveTotal, bestCaseEffectiveConditional: e.pricing.bestCaseEffective, totalIsLowerBound: e.pricing.totalIsLowerBound, unknownFees: e.pricing.unknownFees })),
          recommendation: cmp.recommendation,
        };
        res.offers.push(...cmp.entries.map((e) => e.offer));
        res.excluded.push(...cmp.excluded);
        eRec = cmp.recommendation;
        eTop = cmp.entries.find((e) => e.offer.sourceUrl === cmp.recommendation.cheapest?.sourceUrl) ?? null;
      } else eRec = emptyRec("E-commerce data unavailable (collector failed).");
    }
    let qPlanTop: QuickResult | null = null;
    if (it.quick) {
      const need = needs.find((n) => n.id === it.id);
      if (need && u.pincode) {
        const q = quickFor([need], false);
        res.quick = q;
        qPlanTop = q;
        qRec = q.recommendation;
        res.offers.push(...(offersByNeed[need.id] ?? []));
        res.excluded.push(...q.excludedOffers, ...quickRejected[need.id]);
      } else qRec = emptyRec(u.pincode ? "Quick-commerce data unavailable." : "Pincode required for quick commerce.");
    }
    if (eRec && qRec) {
      const cross = crossMode(eTop, qPlanTop, needs.find((n) => n.id === it.id) ?? null, u.weightsUsed);
      res.crossMode = cross.info;
      res.recommendation = cross.rec ?? mergeNonComparable(eRec, qRec, cross.info.reason);
    } else res.recommendation = (eRec ?? qRec) as Recommendation;
    return res;
  });

  const baskets = needs.length && u.pincode && stores.length ? quickFor(needs, true) : undefined;

  return { understanding: u, perItem, baskets, statuses, runId: randomUUID(), generatedAt: now().toISOString() };
}

function emptyRec(text: string): Recommendation {
  return { best: null, cheapest: null, fastest: null, overall: null, reasons: [{ code: "no_data", text, evidence: [] }], caveats: [text], text, enoughEvidence: false };
}

function mergeNonComparable(e: Recommendation, q: Recommendation, why: string): Recommendation {
  const ok = [e.enoughEvidence ? e : null, q.enoughEvidence ? q : null].filter(Boolean) as Recommendation[];
  if (ok.length === 1) {
    const r = ok[0];
    return { ...r, caveats: [...r.caveats, `Only one mode has verified data; the other mode was not compared (${why}).`], text: `${r.text} (Other mode not comparable: ${why})` };
  }
  const text = ok.length === 0 ? `Neither mode has enough verified data. E-commerce: ${e.text} Quick: ${q.text}` : `E-commerce and quick-commerce results are not directly comparable (${why}). E-commerce: ${e.text} Quick: ${q.text}`;
  return { best: null, cheapest: null, fastest: null, overall: null, reasons: [...e.reasons, ...q.reasons], caveats: [...new Set([...e.caveats, ...q.caveats, why])], text, enoughEvidence: false };
}

const VERIFIED = new Set(["verified", "agent_verified"]);

/** Cross-mode comparison only when both sides are verified and carry the identical comparable quantity. */
function crossMode(eTop: EcomEntry | null, q: QuickResult | null, need: BasketNeed | null, weights: Weights): { info: NonNullable<PerItemResult["crossMode"]>; rec: Recommendation | null } {
  const no = (reason: string) => ({ info: { comparable: false, reason, ecommerceTotal: null, quickTotal: null, winner: null }, rec: null });
  if (!eTop) return no("No verified, matching e-commerce offer to compare.");
  const qPick = q?.recommendation.cheapest;
  const qPlan = q?.plans.find((p) => p.id === qPick?.key)?.plan;
  const line = qPlan?.lines[0];
  if (!q || !qPlan || !line || !need) return no("No verified, in-stock quick-commerce plan to compare.");
  const eo = eTop.offer;
  const eq = eo.unitQuantity;
  if (!eq) return no("E-commerce listing does not state a comparable quantity.");
  if (need.unit === "pack" || eq.unit !== need.unit) return no("Units are not comparable (different unit kinds or no quantity stated).");
  if (Math.abs(eq.value - need.amount) > 1e-9) return no(`Quantities differ (${eq.raw} listed vs ${need.amount} ${need.unit} needed).`);
  if (line.overbuy > 0) return no("Quick-commerce pack sizes do not exactly match the quantity needed.");
  if (!VERIFIED.has(eo.verificationStatus)) return no("E-commerce price is not verified.");
  if (qPlan.lines.some((l) => l.stockUnconfirmed || l.confidence < 0.7)) return no("Quick-commerce stock or match is not confirmed.");
  const eTotal = eTop.pricing.effectiveTotal;
  if (eTotal === null) return no("E-commerce total unknown.");
  const cands: RankCand<"ecommerce" | "quick">[] = [
    { key: "ecommerce", item: "ecommerce", total: eTotal, totalIsLowerBound: eTop.pricing.totalIsLowerBound, etaMinutes: eo.deliveryEtaMinutes, trust: 0.9 },
    { key: "quick", item: "quick", total: qPlan.total, totalIsLowerBound: qPlan.totalIsLowerBound, etaMinutes: qPlan.etaMinutes, trust: 0.9 },
  ];
  const cheap = pickCheapest(cands);
  const fast = pickFastest(cands);
  const overall = scoreCandidates(cands, weights)[0];
  const pickOf = (k: "ecommerce" | "quick" | undefined): Pick | null => (k === "ecommerce" ? eRecPick(eTop) : k === "quick" ? (qPick ?? null) : null);
  const info = { comparable: true, reason: `Same quantity (${eq.raw}) and both prices verified.`, ecommerceTotal: eTotal, quickTotal: qPlan.total, winner: (cheap?.item ?? null) as "ecommerce" | "quick" | null };
  const text = `Comparable (${eq.raw}): ${eo.retailer} ${eTotal}${eTop.pricing.totalIsLowerBound ? "+" : ""} vs quick ${qPlan.total}${qPlan.totalIsLowerBound ? "+" : ""}. Cheapest: ${cheap?.item}; best overall by your weights: ${overall.item}.`;
  return {
    info,
    rec: {
      best: pickOf(overall.item),
      cheapest: pickOf(cheap?.item),
      fastest: pickOf(fast?.item),
      overall: pickOf(overall.item),
      reasons: [{ code: "cross_mode", text, evidence: [...eo.evidence.slice(0, 1), ...line.evidence.slice(0, 1).map((t) => ({ text: t, source: line.storeId }))] }],
      caveats: [...(eTop.pricing.totalIsLowerBound ? ["E-commerce total is a lower bound (shipping unknown)."] : []), ...(qPlan.totalIsLowerBound ? ["Quick-commerce total is a lower bound (fees unknown)."] : [])],
      text,
      enoughEvidence: true,
    },
  };
}

function eRecPick(e: EcomEntry): Pick {
  return { key: e.offer.sourceUrl, productId: e.offer.productId, productName: e.offer.productName, retailer: e.offer.retailer, commerceMode: "ecommerce", sourceUrl: e.offer.sourceUrl, total: e.pricing.effectiveTotal, totalIsLowerBound: e.pricing.totalIsLowerBound, etaMinutes: e.offer.deliveryEtaMinutes };
}

// ---- default (production) collectors: existing pipelines, real TinyFish ----
export function defaultCollectors(): Collectors {
  return {
    async ecommerce(query) {
      const { searchProducts } = await import("../search");
      return searchProducts(query);
    },
    async quick(pincode, queries) {
      const { ENABLED_PROVIDERS } = await import("../fast/providers");
      const { lookupProvider } = await import("../fast/service");
      const providers = ENABLED_PROVIDERS();
      const settled = await Promise.allSettled(providers.map((p) => lookupProvider(p, pincode, queries)));
      const results: ProviderResult[] = [];
      const failures: { providerId: string; message: string }[] = [];
      settled.forEach((s, i) => {
        if (s.status === "fulfilled") results.push(s.value.result);
        else failures.push({ providerId: providers[i].id, message: errMsg(s.reason) });
      });
      return { results, failures };
    },
  };
}

export { DEFAULT_W as ENGINE_DEFAULT_WEIGHTS };
