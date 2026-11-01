import { trueCostVerdict } from "@/lib/engine/ecommerce/truecost";
// ProductGroup assembly helpers shared by the pipeline and discovery.
import type { Decision, ParsedQuery, Pick, ProductGroup, ProductScore, ShopOffer, ShopWeights, SourceStatus, SpecFact } from "../types";
import { hostOf } from "./evidence";
import type { BuildDecisionFn } from "./types";

export const SINGLE_STORE_NOTE = "Multi-store comparison is not possible yet: only one verified store offer was found.";

export function distinctRetailers(offers: ShopOffer[]): number {
  return new Set(offers.map((o) => o.retailer)).size;
}

/** Priced, not out-of-stock offers; falls back to none (never to a made-up price). */
export function pricedOffers(offers: ShopOffer[]): ShopOffer[] {
  return offers.filter((o) => o.listedPrice !== null && o.listedPrice > 0 && o.stockStatus !== "out_of_stock");
}

export function lowestVerified(offers: ShopOffer[]): { price: number; retailer: string } | null {
  let best: ShopOffer | null = null;
  for (const o of pricedOffers(offers)) if (!best || (o.listedPrice as number) < (best.listedPrice as number)) best = o;
  return best ? { price: best.listedPrice as number, retailer: best.retailer } : null;
}

/** Offers whose declared variant conflicts with the variant the user asked for are removed. */
export function filterVariantConflicts(offers: ShopOffer[], want: Pick2): { offers: ShopOffer[]; removed: number } {
  const kept = offers.filter((o) => (want.ramGb === null || o.variant.ramGb === null || o.variant.ramGb === want.ramGb) && (want.storageGb === null || o.variant.storageGb === null || o.variant.storageGb === want.storageGb));
  return { offers: kept, removed: offers.length - kept.length };
}
type Pick2 = { ramGb: number | null; storageGb: number | null };

/**
 * Never mix prices from different variants: keep the single dominant RAM/storage bucket
 * (most distinct retailers, then most offers). A user-specified variant filters instead.
 */
export function pickVariantBucket(offers: ShopOffer[], want: Pick2): { offers: ShopOffer[]; note: string | null; ramGb: number | null; storageGb: number | null } {
  const f = filterVariantConflicts(offers, want);
  const base = f.offers;
  const buckets = new Map<string, ShopOffer[]>();
  for (const o of base) {
    const k = `${o.variant.ramGb ?? "?"}/${o.variant.storageGb ?? "?"}`;
    buckets.set(k, [...(buckets.get(k) ?? []), o]);
  }
  if (buckets.size <= 1) {
    const o = base[0];
    return { offers: base, note: f.removed ? `${f.removed} offer(s) for a different variant were excluded.` : null, ramGb: o?.variant.ramGb ?? want.ramGb, storageGb: o?.variant.storageGb ?? want.storageGb };
  }
  const ranked = [...buckets.entries()].sort((a, b) => distinctRetailers(b[1]) - distinctRetailers(a[1]) || b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const [key, chosen] = ranked[0];
  return {
    offers: chosen,
    note: `Offers for other variants were excluded so prices are not mixed across variants; showing RAM ${chosen[0].variant.ramGb ?? "unknown"} GB / storage ${chosen[0].variant.storageGb ?? "unknown"} GB (variant ${key}).`,
    ramGb: chosen[0].variant.ramGb,
    storageGb: chosen[0].variant.storageGb,
  };
}

/** Honest minimal decision used only when the real decision module is unavailable. */
export function basicDecision(offers: ShopOffer[]): Decision {
  const low = [...pricedOffers(offers)].sort((a, b) => (a.listedPrice as number) - (b.listedPrice as number))[0];
  const cheapest: Pick | null = low ? { offerId: low.sourceUrl, retailer: low.retailer, value: low.listedPrice, reasons: ["Lowest listed price among verified offers"], conditions: [], evidence: [low.sourceUrl] } : null;
  return { cheapestListed: cheapest, cheapestPayable: null, fastest: null, bestOverall: null, notes: ["Detailed decision engine unavailable: only the lowest listed price is shown."], singleStoreOnly: false };
}

function fixPick(p: Pick | null, offers: ShopOffer[]): Pick | null {
  if (!p) return p;
  if (offers.some((o) => o.sourceUrl === p.offerId)) return p;
  const byProduct = offers.find((o) => o.productId === p.offerId);
  const byPrice = offers.find((o) => o.retailer === p.retailer && typeof p.value === "number" && o.listedPrice === p.value);
  const byRetailer = offers.filter((o) => o.retailer === p.retailer);
  const hit = byProduct ?? byPrice ?? (byRetailer.length === 1 ? byRetailer[0] : undefined);
  return hit ? { ...p, offerId: hit.sourceUrl } : p;
}

/** Contract: Pick.offerId === matching offer.sourceUrl. Also applies the single-store rule. */
export function finalizeDecision(offers: ShopOffer[], weights: ShopWeights, build: BuildDecisionFn | null): Decision {
  const d = build ? build(offers, weights) : basicDecision(offers);
  const out: Decision = {
    ...d,
    cheapestListed: fixPick(d.cheapestListed, offers),
    cheapestPayable: fixPick(d.cheapestPayable, offers),
    fastest: fixPick(d.fastest, offers),
    bestOverall: fixPick(d.bestOverall, offers),
    notes: [...d.notes],
  };
  if (distinctRetailers(offers) <= 1) {
    out.singleStoreOnly = true;
    if (!out.notes.includes(SINGLE_STORE_NOTE)) out.notes.push(SINGLE_STORE_NOTE);
  }
  return out;
}

export function mergeStatuses(all: SourceStatus[]): SourceStatus[] {
  const by = new Map<string, SourceStatus[]>();
  for (const s of all) by.set(s.source, [...(by.get(s.source) ?? []), s]);
  const rank: Record<string, number> = { ok: 0, partial: 1, no_results: 2, skipped: 2, disabled: 2, login_required: 3, blocked: 3, timeout: 3, error: 3 };
  return [...by.entries()].map(([source, list]) => {
    const states = new Set(list.map((s) => s.state));
    const lat = list.reduce((a, s) => a + (s.latencyMs ?? 0), 0);
    const msgs = Array.from(new Set(list.map((s) => s.message))).slice(0, 4).join(" | ");
    if (states.size === 1) return { source, state: list[0].state, message: msgs, ...(lat ? { latencyMs: lat } : {}) };
    const hasOk = list.some((s) => s.state === "ok" || s.state === "partial");
    const worst = [...list].sort((a, b) => (rank[b.state] ?? 3) - (rank[a.state] ?? 3))[0];
    return { source, state: hasOk ? ("partial" as const) : worst.state, message: msgs, ...(lat ? { latencyMs: lat } : {}) };
  });
}

export interface GroupInput {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  variant: ParsedQuery["variant"];
  offers: ShopOffer[];
  decision: Decision;
  specs?: SpecFact[];
  score?: ProductScore | null;
  why?: string[];
  provisional?: boolean;
}

export function makeGroup(g: GroupInput): ProductGroup {
  return {
    id: g.id,
    name: g.name,
    brand: g.brand,
    model: g.model,
    variant: g.variant,
    imageUrl: g.offers.find((o) => o.imageUrl)?.imageUrl ?? null,
    specs: g.specs ?? [],
    score: g.score ?? null,
    why: g.why ?? [],
    offers: g.offers,
    decision: g.decision,
    lowestVerified: lowestVerified(g.offers),
    comparable: distinctRetailers(g.offers) >= 2,
    provisional: g.provisional ?? g.score?.provisional ?? false,
    rank: 0,
    trueCostVerdict: trueCostVerdict(
      g.offers.filter((o) => o.trueCost).map((o) => ({ offerId: o.sourceUrl, retailer: o.retailer, verificationStatus: o.verificationStatus, matchingConfidence: o.matchingConfidence, specConfirmed: o.specConfirmed, trueCost: o.trueCost! })),
    ),
  };
}

const COMPONENT_KEYS: Record<string, string[]> = {
  performance: ["chipset"], camera: ["camera_main_mp"], battery: ["battery_mah", "battery_wh"], display: ["refresh_hz", "display_type"],
  software: ["update_years"], cpu: ["cpu"], gpu: ["gpu"], ram: ["ram_gb"], storage: ["storage_gb"], portability: ["weight_kg"], upgradeability: ["ram_upgradable"],
};

/** Evidence-backed reasons derived from the strongest scored components. */
export function whyFromScore(score: ProductScore, specs: SpecFact[]): string[] {
  const out: string[] = [];
  const comps = score.components.filter((c) => c.score !== null && c.name !== "price").sort((a, b) => b.weight * (b.score as number) - a.weight * (a.score as number));
  for (const c of comps) {
    if (out.length >= 4) break;
    for (const key of COMPONENT_KEYS[c.name] ?? []) {
      const f = specs.find((s) => s.key === key);
      if (f) { out.push(`${f.label} ${f.value}${f.unit ? " " + f.unit : ""} (source: ${hostOf(f.sourceUrl)})`); break; }
    }
  }
  if (score.missing.length) out.push(`Not found in sources, so not scored: ${score.missing.join(", ")}`);
  return out;
}

// ---------------- price plausibility guards ----------------

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Guards (b) editorial-price ratio and (c) smartphone floor. Unpriced offers are untouched. */
export function guardOffers(offers: ShopOffer[], o: { category: string; editorialPrice: number | null }): { offers: ShopOffer[]; notes: string[] } {
  const priced = offers.filter((x) => x.listedPrice !== null && x.listedPrice > 0);
  const maxRef = Math.max(o.editorialPrice ?? 0, ...priced.map((x) => x.listedPrice as number));
  const removed: number[] = [];
  const kept = offers.filter((x) => {
    const p = x.listedPrice;
    if (p === null || p <= 0) return true;
    if (o.editorialPrice !== null && p < 0.4 * o.editorialPrice) { removed.push(p); return false; }
    if (o.category === "smartphone" && p < 4000 && maxRef > 10000) { removed.push(p); return false; }
    return true;
  });
  return { offers: kept, notes: removed.length ? [`Ignored ${removed.length} implausibly low price(s) (${removed.map((n) => "\u20b9" + n).join(", ")}) that look like accessory or EMI figures, not the product.`] : [] };
}

/** Guard (a): with >=3 priced offers, drop prices below 35% of the median. */
export function guardMedian(offers: ShopOffer[]): { offers: ShopOffer[]; notes: string[] } {
  const prices = offers.filter((x) => x.listedPrice !== null && x.listedPrice > 0).map((x) => x.listedPrice as number);
  if (prices.length < 3) return { offers, notes: [] };
  const floor = 0.35 * median(prices);
  const removed: number[] = [];
  const kept = offers.filter((x) => {
    if (x.listedPrice !== null && x.listedPrice > 0 && x.listedPrice < floor) { removed.push(x.listedPrice); return false; }
    return true;
  });
  return { offers: kept, notes: removed.length ? [`Ignored ${removed.length} price(s) far below the median of other offers (${removed.map((n) => "\u20b9" + n).join(", ")}).`] : [] };
}

// ---------------- retailer lookup query ----------------

/** Manufacturer part numbers (V3607VU-RP550WS, B13UDXK-1482IN) never appear in retailer titles. */
export function isPartNumber(tok: string): boolean {
  const t = tok.replace(/[()]/g, "");
  if (/^(?:rtx|gtx|rx)\d{3,4}/i.test(t)) return false;
  if (!/\d/.test(t) || !/[a-z]/i.test(t)) return false;
  if (/^(?:wh|wf)-/i.test(t)) return false;
  if (t.includes("-") && t.length >= 7) return true;
  return t.length >= 9 && /^[a-z0-9]+$/i.test(t);
}

/** Retailer search query: brand + series (+ screen size) (+ evidenced GPU), without part numbers or years. */
export function lookupQuery(name: string, evidencedGpu: string | null): { query: string; partNumbers: string[] } {
  const toks = name.split(/\s+/).filter(Boolean);
  const partNumbers = toks.filter(isPartNumber);
  const keep = toks.filter((t) => !isPartNumber(t) && !/^20\d\d$/.test(t));
  let q = keep.join(" ");
  if (evidencedGpu && !new RegExp(evidencedGpu.replace(/\s+/g, "\\s?"), "i").test(q)) q += ` ${evidencedGpu}`;
  return { query: q.trim(), partNumbers };
}

// ---------------- gaming laptop sanity ----------------

/** Returns a drop reason when a candidate cannot be shown as a gaming laptop, else null. */
export function gamingMismatch(c: { name: string; specs: { key: string; value: string | number; evidence: string }[] }): string | null {
  if (/zbook|precision|workstation|thinkpad\s+p\d/i.test(c.name)) return "workstation laptop, not a gaming laptop";
  const gpu = c.specs.find((s) => s.key === "gpu");
  if (gpu && /\b(rtx|gtx|radeon rx)\b/i.test(String(gpu.value))) return null;
  if (/gaming/i.test(c.name) || c.specs.some((s) => /gaming/i.test(s.evidence))) return null;
  return "no evidence of a dedicated gaming GPU or gaming positioning";
}
