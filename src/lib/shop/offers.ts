// Builds ShopOffer objects for one product query by composing the existing e-commerce search,
// entity resolution and discount logic. Only verified-identity ('match') offers are returned;
// everything else goes to `excluded` with a reason. Unknown stays null; nothing is invented.
import { fromEcommerceOffer } from "@/lib/engine/adapters";
import { compareEcommerce } from "@/lib/engine/ecommerce/pipeline";
import { discountPct } from "@/lib/extract";
import { isAccessoryTitle } from "@/lib/match";
import { searchProducts } from "@/lib/search";
import type { Offer, RetailerStatus, SearchResponse } from "@/lib/types";
import type { ConditionalOffer, DeliveryInfo, ShopOffer, SourceStatus } from "./types";

export interface BuildOffersCtx {
  pincode: string | null;
  /** cards/instruments the USER selected, e.g. ["HDFC credit card"]; only these can apply bank offers */
  cards?: string[];
  coupons?: string[];
  parsed?: { budgetMax?: number | null };
}
export interface BuildOffersDeps {
  search?: (query: string) => Promise<SearchResponse>;
}
export interface ExcludedShopOffer {
  title: string;
  retailer: string;
  reason: string;
}
export interface BuildOffersResult {
  offers: ShopOffer[];
  excluded: ExcludedShopOffer[];
  statuses: SourceStatus[];
}

const SPEC_ATTRS = new Set(["gpu", "cpu", "ram", "storage"]);
export const PRICE_PLAUSIBILITY_FLOOR = 0.35;

export function defaultDelivery(pincode: string | null): DeliveryInfo {
  return {
    pincode,
    serviceable: null,
    kind: "not_verified",
    etaText: null,
    etaDate: null,
    etaDays: null,
    guaranteed: false,
    checkedAt: null,
    evidence: null,
    note: pincode ? "Delivery to this pincode has not been checked yet." : "No pincode given; delivery not checked.",
  };
}

function mapStatus(s: RetailerStatus): SourceStatus {
  return { source: s.retailer, state: s.state, message: s.message, ...(s.latencyMs !== undefined ? { latencyMs: s.latencyMs } : {}) };
}

export async function buildOffers(productQuery: string, ctx: BuildOffersCtx, deps: BuildOffersDeps = {}): Promise<BuildOffersResult> {
  const search = deps.search ?? ((q: string) => searchProducts(q));
  const sr = await search(productQuery);
  // Accessories sharing the device name (cases, protectors...) are not the product: dropped, like search-side junk rows.
  const raw: Offer[] = [...sr.offers, ...sr.excluded].filter((o) => !isAccessoryTitle(o.title));
  const rawByUrl = new Map<string, Offer>();
  for (const o of raw) rawByUrl.set(o.url, o);

  const unified = raw.map((o) => fromEcommerceOffer(o, { locationId: ctx.pincode }));
  const cmp = compareEcommerce(productQuery, unified, { cards: ctx.cards, coupons: ctx.coupons, budget: ctx.parsed?.budgetMax ?? null });

  const excluded: ExcludedShopOffer[] = cmp.excluded.map((x) => ({ title: x.offer.productName, retailer: x.offer.retailer, reason: x.reason }));
  const offers: ShopOffer[] = [];
  const isVerifiedPrice = (v: string, p: number | null) => (v === "verified" || v === "agent_verified") && p !== null;
  for (const e of cmp.entries) {
    let unconfirmed: string[] | null = null;
    if (e.resolution.decision !== "match") {
      // 'possible' ONLY because specs are unverifiable (nothing contradicts) + price read from the page => listed, flagged unconfirmed
      const unver = e.resolution.mismatches.filter((m) => m.severity === "unverifiable");
      const onlySpecs = e.resolution.decision === "possible" && unver.length > 0 && e.resolution.mismatches.every((m) => m.severity === "unverifiable" && SPEC_ATTRS.has(m.attribute)) && e.resolution.confidence >= 0.6;
      if (onlySpecs && isVerifiedPrice(e.offer.verificationStatus, e.offer.listedPrice)) {
        unconfirmed = unver.map((m) => m.note);
      } else {
        excluded.push({ title: e.offer.productName, retailer: e.offer.retailer, reason: `Not confirmed as the same product (confidence ${e.resolution.confidence}). ${e.resolution.mismatches.map((m) => m.note).join(" ")}`.trim() });
        continue;
      }
    }
    const src = rawByUrl.get(e.offer.sourceUrl);
    const conditional: ConditionalOffer[] = [
      ...e.pricing.applied.map((d) => ({ text: d.text, amount: d.amount, condition: d.condition, applied: true })),
      ...e.pricing.stillConditional.map((d) => ({ text: d.text, amount: d.amount, condition: d.condition, applied: false })),
    ];
    offers.push({
      ...e.offer,
      evidence: unconfirmed ? [...e.offer.evidence, { text: `Unconfirmed spec: ${unconfirmed.join(" ")}`, source: e.offer.sourceUrl }] : e.offer.evidence,
      ...(unconfirmed ? { specConfirmed: false, specNotes: unconfirmed } : {}),
      matchingConfidence: unconfirmed ? Math.min(0.79, e.resolution.confidence) : e.resolution.confidence,
      eligibleDiscount: e.pricing.eligibleDiscount > 0 ? e.pricing.eligibleDiscount : null,
      imageUrl: src?.imageUrl ?? null,
      mrp: e.offer.mrp,
      discountPct: discountPct(e.offer.listedPrice, e.offer.mrp),
      seller: src?.seller ?? null,
      warranty: src?.warranty ?? null,
      returnPolicy: src?.returnPolicy ?? null,
      conditionalOffers: conditional,
      // Known portion of the total: listed price + known fees - discounts the user selected. Unknown shipping is NEVER counted as 0:
      // totalIsLowerBound=true means the real total can only be higher.
      effectiveTotal: e.pricing.effectiveTotal,
      totalIsLowerBound: e.pricing.totalIsLowerBound,
      delivery: defaultDelivery(ctx.pincode),
    });
  }
  // Price plausibility: with >=3 verified prices, a price below 35% of the median is almost surely an accessory/other item.
  const verifiedPrices = offers.filter((o) => isVerifiedPrice(o.verificationStatus, o.listedPrice)).map((o) => o.listedPrice as number).sort((a, b) => a - b);
  let kept = offers;
  if (verifiedPrices.length >= 3) {
    const mid = Math.floor(verifiedPrices.length / 2);
    const median = verifiedPrices.length % 2 ? verifiedPrices[mid] : (verifiedPrices[mid - 1] + verifiedPrices[mid]) / 2;
    kept = [];
    for (const o of offers) {
      if (o.listedPrice !== null && o.listedPrice < median * PRICE_PLAUSIBILITY_FLOOR) {
        excluded.push({ title: o.productName, retailer: o.retailer, reason: "price implausible for this product (possible accessory)" });
      } else kept.push(o);
    }
  }
  if (kept !== offers) {
    offers.length = 0;
    offers.push(...kept);
  }
  offers.sort((a, b) => (a.effectiveTotal ?? Infinity) - (b.effectiveTotal ?? Infinity) || a.sourceUrl.localeCompare(b.sourceUrl));
  return { offers, excluded, statuses: sr.statuses.map(mapStatus) };
}
