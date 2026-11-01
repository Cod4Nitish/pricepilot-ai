// Adapters from the two existing module outputs into UnifiedOffer. Unknowns stay null.
import type { FastOffer, ProviderResult, StoreFees } from "../fast/types";
import type { Offer } from "../types";
import { entityFromText, extractGtins, productIdFor } from "./ecommerce/entity";
import { parseDiscountTexts } from "./ecommerce/discounts";
import { parseQuantity } from "./units";
import { createHash } from "node:crypto";
import type { UnifiedOffer } from "./schema";

export function fromEcommerceOffer(o: Offer, opts: { pageText?: string; locationId?: string | null } = {}): UnifiedOffer {
  const text = [o.title, o.evidence ?? "", opts.pageText ?? "", ...o.offers, o.gtin ? `gtin: ${o.gtin}` : ""].join("\n");
  const gtins = extractGtins(text);
  const ent = entityFromText(o.title);
  ent.gtins = gtins;
  const specLike = /\b\d+\s*(gb|tb|mah|inch|hz)\b|\b[2-6]\s?g\b/i.test(o.title);
  const q = specLike ? null : parseQuantity(o.title);
  const packM = /\bpack\s*of\s*(\d+)\b/i.exec(o.title);
  return {
    productId: productIdFor({ ...ent, brand: o.spec.brand ? ent.brand ?? o.spec.brand : ent.brand }),
    productName: o.title,
    brand: ent.brand ?? (o.spec.brand ? o.spec.brand.toLowerCase() : null),
    variant: {
      storageGb: o.spec.storageGb ?? ent.storageGb,
      ramGb: o.spec.ramGb ?? ent.ramGb,
      color: o.spec.color ?? ent.colors[0] ?? null,
      size: null,
      condition: o.spec.condition === "new" || o.spec.condition === "refurbished" ? o.spec.condition : null,
      pack: packM ? Number(packM[1]) : null,
    },
    unitQuantity: q,
    retailer: o.retailer,
    commerceMode: "ecommerce",
    sourceUrl: o.url,
    locationId: opts.locationId ?? null,
    listedPrice: o.price,
    mrp: o.mrp,
    shippingFee: o.deliveryCharge,
    handlingFee: null,
    platformFee: null,
    eligibleDiscount: null,
    conditionalDiscounts: parseDiscountTexts(o.offers, o.price),
    stockStatus: o.availability,
    deliveryEtaMinutes: null,
    observedAt: o.checkedAt,
    verificationStatus: o.verification,
    matchingConfidence: o.matchConfidence,
    evidence: [...(o.evidence ? [{ text: o.evidence, source: o.url }] : []), ...o.offers.slice(0, 3).map((t) => ({ text: t, source: o.url }))],
    gtin: gtins[0] ?? null,
  };
}

export interface QuickCtx {
  providerName: string;
  pincode: string | null;
  fees: StoreFees;
  observedAt: string;
  homeUrl: string;
  /** whether the provider run verified the delivery location */
  locationVerified: boolean;
}

export function quickCtxFromResult(r: ProviderResult, pincode: string | null): QuickCtx {
  return { providerName: r.providerName, pincode, fees: r.fees, observedAt: r.checkedAt, homeUrl: r.homeUrl, locationVerified: r.locationVerified };
}

export function fromQuickOffer(o: FastOffer, ctx: QuickCtx): UnifiedOffer {
  const ent = entityFromText(`${o.brand ?? ""} ${o.title}`);
  const uq = parseQuantity(o.packLabel) ?? parseQuantity(o.title) ?? (o.pack ? { value: o.pack.total, unit: o.pack.kind === "weight" ? ("g" as const) : o.pack.kind === "volume" ? ("ml" as const) : ("unit" as const), raw: o.pack.label } : null);
  const key = ["quick", ent.brand ?? o.brand?.toLowerCase() ?? "", [...ent.tokens].sort().join("-")].join("|");
  const stock: UnifiedOffer["stockStatus"] = o.available === true ? "in_stock" : o.available === false ? "out_of_stock" : "unknown";
  const agentRead = o.price !== null && !!o.evidence;
  return {
    productId: createHash("sha1").update(key).digest("hex").slice(0, 16),
    productName: o.title,
    brand: o.brand ? o.brand.toLowerCase() : ent.brand,
    variant: { storageGb: null, ramGb: null, color: null, size: o.packLabel, condition: null, pack: null },
    unitQuantity: uq,
    retailer: o.providerId,
    commerceMode: "quick",
    sourceUrl: o.productUrl ?? ctx.homeUrl,
    locationId: ctx.pincode,
    listedPrice: o.price,
    mrp: o.mrp,
    shippingFee: ctx.fees.delivery,
    handlingFee: ctx.fees.handling,
    platformFee: ctx.fees.platform,
    eligibleDiscount: null,
    conditionalDiscounts: [],
    stockStatus: stock,
    deliveryEtaMinutes: o.etaMinutes,
    observedAt: ctx.observedAt,
    verificationStatus: agentRead && ctx.locationVerified ? "agent_verified" : "unverified",
    matchingConfidence: Math.max(0, Math.min(1, o.matchConfidence)),
    evidence: o.evidence ? [{ text: o.evidence, source: o.productUrl ?? ctx.homeUrl }] : [],
  };
}
