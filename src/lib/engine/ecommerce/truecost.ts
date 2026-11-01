// TrueCost: what the shopper will actually pay, with honest uncertainty. Pure, no I/O.
//
// payableTotal = listedPrice + verifiedFees - confirmedDiscounts
//
// Rules: missing fees are UNKNOWN (never 0). A card/coupon offer is CONDITIONAL even if the user picked a matching
// card (eligibility is decided at checkout). Offers never stack. EMI/cashback is never an immediate discount.
// A percentage offer is never converted to rupees for the best case (its cap/eligibility is unknown).
import { z } from "zod";
import type { UnifiedOffer } from "../schema";

export const CostStatusSchema = z.enum(["CONFIRMED", "LOWER_BOUND", "CONDITIONAL", "UNKNOWN"]);
export type CostStatus = z.infer<typeof CostStatusSchema>;

export const TrueCostSchema = z.object({
  listedPrice: z.number().nullable(),
  knownShippingFee: z.number().nullable(),
  knownHandlingFee: z.number().nullable(),
  knownPlatformFee: z.number().nullable(),
  confirmedDiscounts: z.array(z.object({ text: z.string(), amount: z.number() })),
  conditionalDiscounts: z.array(z.object({ text: z.string(), amount: z.number().nullable(), condition: z.string(), kind: z.string() })),
  /** null unless every required charge is known */
  confirmedTotal: z.number().nullable(),
  /** listed + known fees - confirmed discounts: the minimum you will pay (more if unknown charges apply) */
  knownLowerBound: z.number().nullable(),
  /** knownLowerBound minus the single largest explicit-rupee conditional offer (never stacked); null if none */
  conditionalBestCase: z.number().nullable(),
  unknownComponents: z.array(z.string()),
  costStatus: CostStatusSchema,
  purchasable: z.enum(["in_stock", "out_of_stock", "unknown"]),
  explanation: z.string(),
});
export type TrueCost = z.infer<typeof TrueCostSchema>;

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
/** explicit rupee amount stated in the offer text itself ("₹1,500 off", "Flat Rs 2000 instant discount") */
function explicitRupees(text: string): number | null {
  if (/up ?to|upto|cashback|emi|per month|\/month/i.test(text)) return null;
  const m = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:off|instant|discount|flat)?/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function computeTrueCost(o: UnifiedOffer): TrueCost {
  const listed = o.listedPrice;
  const required: { name: string; v: number | null }[] =
    o.commerceMode === "ecommerce"
      ? [{ name: "shipping fee", v: o.shippingFee }]
      : [
          { name: "delivery fee", v: o.shippingFee },
          { name: "handling fee", v: o.handlingFee },
          { name: "platform fee", v: o.platformFee },
        ];
  const unknownComponents = required.filter((c) => c.v === null).map((c) => c.name);
  const knownFees = (o.shippingFee ?? 0) + (o.handlingFee ?? 0) + (o.platformFee ?? 0);
  const confirmed = o.eligibleDiscount && o.eligibleDiscount > 0 ? [{ text: "Discount shown as applied on the retailer page", amount: o.eligibleDiscount }] : [];
  const confirmedSum = confirmed.reduce((a, d) => a + d.amount, 0);
  const conditional = o.conditionalDiscounts.map((d) => ({
    text: d.text,
    amount: d.kind === "emi" ? null : explicitRupees(d.text),
    condition: d.condition,
    kind: d.kind ?? "other",
  }));
  const bestConditional = Math.max(0, ...conditional.map((d) => d.amount ?? 0));

  if (listed === null) {
    return {
      listedPrice: null,
      knownShippingFee: o.shippingFee,
      knownHandlingFee: o.handlingFee,
      knownPlatformFee: o.platformFee,
      confirmedDiscounts: confirmed,
      conditionalDiscounts: conditional,
      confirmedTotal: null,
      knownLowerBound: null,
      conditionalBestCase: null,
      unknownComponents: ["listed price", ...unknownComponents],
      costStatus: "UNKNOWN",
      purchasable: o.stockStatus,
      explanation: "The listed price could not be verified, so no cost can be calculated.",
    };
  }
  const lower = r2(Math.max(0, listed + knownFees - confirmedSum));
  const confirmedTotal = unknownComponents.length === 0 ? lower : null;
  const conditionalBestCase = bestConditional > 0 ? r2(Math.max(0, lower - bestConditional)) : null;
  const costStatus: CostStatus = unknownComponents.length ? "LOWER_BOUND" : conditionalBestCase !== null ? "CONDITIONAL" : "CONFIRMED";

  const parts: string[] = [`Listed price ${fmt(listed)}.`];
  if (knownFees > 0) parts.push(`Known fees ${fmt(knownFees)}.`);
  if (unknownComponents.length) parts.push(`${unknownComponents.join(", ")} not shown on the page, so ${fmt(lower)} is a minimum, not the final payable total.`);
  else parts.push(`All required charges are known: payable total ${fmt(lower)}.`);
  if (conditional.length) {
    parts.push(
      conditionalBestCase !== null
        ? `${conditional.length} offer(s) need eligibility checks at checkout; the largest explicit one could bring it to ${fmt(conditionalBestCase)} (not guaranteed, offers not stacked).`
        : `${conditional.length} offer(s) need eligibility checks at checkout and have no confirmed rupee value; they are not deducted.`,
    );
  }
  if (o.stockStatus === "out_of_stock") parts.push("Shown as out of stock when checked.");
  return {
    listedPrice: listed,
    knownShippingFee: o.shippingFee,
    knownHandlingFee: o.handlingFee,
    knownPlatformFee: o.platformFee,
    confirmedDiscounts: confirmed,
    conditionalDiscounts: conditional,
    confirmedTotal,
    knownLowerBound: lower,
    conditionalBestCase,
    unknownComponents,
    costStatus,
    purchasable: o.stockStatus,
    explanation: parts.join(" "),
  };
}

type Ranked = { offerId: string; retailer: string; value: number };
export interface TrueCostVerdict {
  /** only an exact, verified, purchasable offer whose total is fully known */
  cheapestConfirmed: Ranked | null;
  lowestListed: Ranked | null;
  lowestKnownMinimum: Ranked | null;
  /** offers tied with the lowest listed price (same rupee value) */
  tiedLowestListed: string[];
  notes: string[];
}

interface Eligible {
  offerId: string;
  retailer: string;
  verificationStatus: string;
  matchingConfidence: number;
  specConfirmed?: boolean;
  trueCost: TrueCost;
}

/** Labels across the SAME exact product's offers. Callers must pass only same-product, same-variant offers. */
export function trueCostVerdict(offers: Eligible[]): TrueCostVerdict {
  const exact = offers.filter((o) => (o.verificationStatus === "verified" || o.verificationStatus === "agent_verified") && o.matchingConfidence >= 0.8 && o.specConfirmed !== false);
  const min = (list: Eligible[], f: (t: TrueCost) => number | null): Ranked | null => {
    let best: Ranked | null = null;
    for (const o of list) {
      const v = f(o.trueCost);
      if (v !== null && (best === null || v < best.value)) best = { offerId: o.offerId, retailer: o.retailer, value: v };
    }
    return best;
  };
  const purchasable = exact.filter((o) => o.trueCost.purchasable !== "out_of_stock");
  const cheapestConfirmed = min(purchasable, (t) => t.confirmedTotal);
  const lowestListed = min(exact, (t) => t.listedPrice);
  const lowestKnownMinimum = min(exact, (t) => t.knownLowerBound);
  const tiedLowestListed = lowestListed ? exact.filter((o) => o.trueCost.listedPrice === lowestListed.value).map((o) => o.offerId) : [];
  const notes: string[] = [];
  if (!exact.length) notes.push("No verified exact-match offer: no cost winner can be named.");
  else if (!cheapestConfirmed) notes.push("No offer has a fully known payable total (shipping or other charges not shown), so no 'Cheapest Confirmed' is awarded. Lowest listed price and lowest known minimum are shown instead.");
  if (tiedLowestListed.length > 1) notes.push(`${tiedLowestListed.length} offers share the lowest listed price.`);
  if (exact.some((o) => o.trueCost.purchasable === "out_of_stock")) notes.push("Out-of-stock offers cannot be Cheapest Confirmed.");
  return { cheapestConfirmed, lowestListed, lowestKnownMinimum, tiedLowestListed, notes };
}
