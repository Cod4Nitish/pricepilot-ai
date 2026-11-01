// Deterministic fixtures. Prices are test data only (never shown to users).
import type { FastOffer, LineResult, ProviderResult } from "../../fast/types";
import type { SearchResponse, Offer } from "../../types";
import { fromEcommerceOffer } from "../adapters";
import { parseDiscountTexts } from "../ecommerce/discounts";
import { entityFromText, productIdFor } from "../ecommerce/entity";
import type { UnifiedOffer } from "../schema";
import { parseQuantity } from "../units";
import type { QuickStoreInput } from "../quick/basket";

const T = "2026-11-01T10:00:00.000Z";

export function ecom(o: Partial<UnifiedOffer> & { productName: string; retailer: string; listedPrice: number | null; offerTexts?: string[] }): UnifiedOffer {
  const ent = entityFromText(o.productName);
  const { offerTexts, ...rest } = o;
  return {
    productId: productIdFor(ent),
    brand: ent.brand,
    variant: { storageGb: ent.storageGb, ramGb: ent.ramGb, color: ent.colors[0] ?? null, size: null, condition: ent.condition, pack: null },
    unitQuantity: null,
    commerceMode: "ecommerce",
    sourceUrl: `https://${o.retailer}.example/p/${encodeURIComponent(o.productName)}`,
    locationId: null,
    mrp: null,
    shippingFee: 0,
    handlingFee: null,
    platformFee: null,
    eligibleDiscount: null,
    conditionalDiscounts: parseDiscountTexts(offerTexts ?? [], o.listedPrice),
    stockStatus: "in_stock",
    deliveryEtaMinutes: null,
    observedAt: T,
    verificationStatus: "verified",
    matchingConfidence: 0.9,
    evidence: [{ text: `${o.productName} ₹${o.listedPrice}`, source: "page" }],
    gtin: null,
    ...rest,
  } as UnifiedOffer;
}

export function quick(o: { store: string; name: string; price: number | null; qty?: string; stock?: UnifiedOffer["stockStatus"]; pincode?: string | null; eta?: number | null; conf?: number }): UnifiedOffer {
  return {
    productId: `${o.store}-${o.name}-${o.qty}`,
    productName: o.name,
    brand: null,
    variant: { storageGb: null, ramGb: null, color: null, size: o.qty ?? null, condition: null, pack: null },
    unitQuantity: o.qty ? parseQuantity(o.qty) : null,
    retailer: o.store,
    commerceMode: "quick",
    sourceUrl: `https://${o.store}.example/${encodeURIComponent(o.name)}-${o.qty ?? ""}`,
    locationId: o.pincode === undefined ? "560001" : o.pincode,
    listedPrice: o.price,
    mrp: null,
    shippingFee: null,
    handlingFee: null,
    platformFee: null,
    eligibleDiscount: null,
    conditionalDiscounts: [],
    stockStatus: o.stock ?? "in_stock",
    deliveryEtaMinutes: o.eta ?? null,
    observedAt: T,
    verificationStatus: "agent_verified",
    matchingConfidence: o.conf ?? 0.9,
    evidence: [{ text: `${o.name} ${o.qty ?? ""} ₹${o.price}`, source: o.store }],
  };
}

export const FEES0 = { delivery: 0, handling: 0, platform: 0, smallCartFee: null, smallCartThreshold: null, freeDeliveryThreshold: null };
export function store(id: string, over: Omit<Partial<QuickStoreInput>, "fees"> & { fees?: Partial<QuickStoreInput["fees"]> } = {}): QuickStoreInput {
  const { fees, ...rest } = over;
  return { id, name: id[0].toUpperCase() + id.slice(1), state: "ok", reason: "", locationVerified: true, etaMinutes: 10, fees: { ...FEES0, ...fees }, ...rest };
}

// ---- raw module outputs for orchestrator tests ----
export function rawOffer(p: Partial<Offer> & { title: string; retailer: Offer["retailer"]; price: number | null }): Offer {
  return {
    id: p.title, retailerName: p.retailer, url: `https://www.${p.retailer}.in/dp/${encodeURIComponent(p.title)}`, mrp: null, discountPct: null, deliveryCharge: 0, availability: "in_stock",
    offers: [], spec: {}, matchConfidence: 0.9, matchNotes: [], verification: "verified", checkedAt: T, evidence: `${p.title} ₹${p.price}`, ...p,
  };
}
export function searchResponse(offers: Offer[], excluded: Offer[] = []): SearchResponse {
  return {
    query: "q", parsed: { rawQuery: "q" }, offers, excluded,
    statuses: [{ retailer: "amazon", retailerName: "Amazon", state: "ok", message: "ok", offerCount: offers.length }],
    bestVerified: null, recommendation: { text: "", enoughEvidence: true, caveats: [] }, runId: "r", generatedAt: T, cached: false,
  };
}
export function fastOffer(p: Partial<FastOffer> & { providerId: FastOffer["providerId"]; title: string; price: number | null; packLabel: string; query: string }): FastOffer {
  return { brand: null, pack: null, mrp: null, discountPct: null, available: true, deliveryEta: "10 mins", etaMinutes: 10, productUrl: null, unitPrice: null, matchConfidence: 0.9, matchNotes: [], evidence: `${p.title} ${p.packLabel} ₹${p.price}`, ...p } as FastOffer;
}
export function providerResult(id: ProviderResult["providerId"], lines: LineResult[], over: Partial<ProviderResult> = {}): ProviderResult {
  return {
    providerId: id, providerName: id, state: "ok", reason: "", locationVerified: true, locationEvidence: "Delivering to 560001", runId: "x", lines,
    fees: { delivery: 0, handling: 0, platform: 0, discount: null, evidence: null }, etaText: "10 mins", etaMinutes: 10, checkedAt: T, homeUrl: `https://${id}.example`, ...over,
  };
}
export function line(query: string, offer: FastOffer | null, resolution: LineResult["resolution"] = "found"): LineResult {
  return { query, resolution, offer, rejected: [], note: "" };
}
export { fromEcommerceOffer };
