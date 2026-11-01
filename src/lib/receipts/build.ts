// Deal Decision Receipt: a shareable summary built ONLY from a completed comparison. Pure; no TinyFish calls.
// Nothing here invents data: unknown stays null/"Unknown", unverified prices are labelled, bad source URLs are dropped.
import { z } from "zod";
import type { UsageSummary } from "@/lib/cost/context";
import { validateRetailerUrl } from "@/lib/ssrf";
import type { ParsedQuery, ProductGroup, SourceStatus } from "@/lib/shop/types";

const RETAILER_NAMES: Record<string, string> = { amazon: "Amazon.in", flipkart: "Flipkart", croma: "Croma", reliance: "Reliance Digital", vijay: "Vijay Sales" };

export const ReceiptLineSchema = z.object({
  retailer: z.string(),
  retailerName: z.string(),
  productTitle: z.string(),
  listedPrice: z.number().nullable(),
  costStatus: z.string(),
  confirmedTotal: z.number().nullable(),
  knownMinimum: z.number().nullable(),
  unknownCharges: z.array(z.string()),
  conditionalOffers: z.array(z.string()),
  stock: z.string(),
  verification: z.enum(["verified", "agent_verified", "snippet_only", "unverified"]),
  verifiedAt: z.string(),
  matchConfidence: z.number(),
  sourceUrl: z.string().nullable(),
  evidence: z.array(z.string()),
});
export type ReceiptLine = z.infer<typeof ReceiptLineSchema>;

export const DealReceiptSchema = z.object({
  receiptId: z.string(),
  generatedAt: z.string(),
  comparisonGeneratedAt: z.string(),
  userQuery: z.string(),
  productName: z.string(),
  productVariant: z.string(),
  matchConfidence: z.number().nullable(),
  comparedRetailers: z.array(z.object({ retailer: z.string(), outcome: z.string() })),
  verifiedOffers: z.number(),
  lines: z.array(ReceiptLineSchema),
  recommendedOffer: z.object({ retailer: z.string(), label: z.string(), value: z.number() }).nullable(),
  recommendationExplanation: z.string(),
  priceDifference: z.object({ amount: z.number(), between: z.tuple([z.string(), z.string()]), basis: z.string() }).nullable(),
  evidenceQuality: z.enum(["strong", "partial", "weak", "none"]),
  evidenceQualityReason: z.string(),
  unknownFees: z.array(z.string()),
  limitations: z.array(z.string()),
  researchCost: z
    .object({ searchRequests: z.number(), fetchedUrls: z.number(), paidAgentRuns: z.number(), agentSteps: z.number(), calculatedUsd: z.number().nullable(), basis: z.string() })
    .nullable(),
});
export type DealReceipt = z.infer<typeof DealReceiptSchema>;

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const VERIFIED = new Set(["verified", "agent_verified"]);

export function buildReceipt(input: {
  group: ProductGroup;
  parsed: Pick<ParsedQuery, "raw">;
  statuses: SourceStatus[];
  usage?: UsageSummary | null;
  comparisonGeneratedAt: string;
  now?: Date;
  id?: string;
}): DealReceipt {
  const { group } = input;
  const now = input.now ?? new Date();
  const limitations: string[] = [];
  let droppedUrls = 0;
  const lines: ReceiptLine[] = group.offers.map((o) => {
    const v = validateRetailerUrl(o.sourceUrl);
    if (!v.ok) droppedUrls++;
    const tc = o.trueCost;
    return {
      retailer: o.retailer,
      retailerName: RETAILER_NAMES[o.retailer] ?? o.retailer,
      productTitle: o.productName,
      listedPrice: o.listedPrice,
      costStatus: tc?.costStatus ?? "UNKNOWN",
      confirmedTotal: tc?.confirmedTotal ?? null,
      knownMinimum: tc?.knownLowerBound ?? null,
      unknownCharges: tc?.unknownComponents ?? ["shipping fee"],
      conditionalOffers: (tc?.conditionalDiscounts ?? []).map((d) => d.text),
      stock: o.stockStatus,
      verification: o.verificationStatus,
      verifiedAt: o.observedAt,
      matchConfidence: o.matchingConfidence,
      sourceUrl: v.ok ? v.url : null,
      evidence: o.evidence.slice(0, 3).map((e) => e.text),
    };
  });
  if (droppedUrls) limitations.push(`${droppedUrls} source link(s) failed URL validation and were removed.`);

  const verifiedLines = lines.filter((l) => VERIFIED.has(l.verification) && l.listedPrice !== null && l.matchConfidence >= 0.8);
  const verifiedRetailers = new Set(verifiedLines.map((l) => l.retailer));
  const verdict = group.trueCostVerdict;

  let recommendedOffer: DealReceipt["recommendedOffer"] = null;
  let explanation: string;
  if (verdict?.cheapestConfirmed) {
    recommendedOffer = { retailer: verdict.cheapestConfirmed.retailer, label: "Cheapest Confirmed total", value: verdict.cheapestConfirmed.value };
    explanation = `${RETAILER_NAMES[verdict.cheapestConfirmed.retailer] ?? verdict.cheapestConfirmed.retailer} has the lowest fully known payable total (${inr(verdict.cheapestConfirmed.value)}).`;
  } else if (verdict?.lowestListed) {
    recommendedOffer = { retailer: verdict.lowestListed.retailer, label: "Lowest Listed Price (total not confirmed)", value: verdict.lowestListed.value };
    explanation = `${RETAILER_NAMES[verdict.lowestListed.retailer] ?? verdict.lowestListed.retailer} has the lowest verified listed price (${inr(verdict.lowestListed.value)}). Shipping or other charges were not shown, so the final payable total is not confirmed.`;
  } else {
    explanation = "No verified exact-match price was found, so no recommendation is made.";
  }
  if (verifiedRetailers.size < 2) {
    limitations.push(verifiedRetailers.size === 1 ? "Only one retailer had a verified price: this is not a multi-store comparison." : "No retailer had a verified price.");
  }

  let priceDifference: DealReceipt["priceDifference"] = null;
  const byRetailer = new Map<string, number>();
  for (const l of verifiedLines) byRetailer.set(l.retailer, Math.min(byRetailer.get(l.retailer) ?? Infinity, l.listedPrice!));
  if (byRetailer.size >= 2) {
    const sorted = [...byRetailer.entries()].sort((a, b) => a[1] - b[1]);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    priceDifference = { amount: Math.round((hi[1] - lo[1]) * 100) / 100, between: [lo[0], hi[0]], basis: "Difference between verified LISTED prices (not payable totals)." };
  }

  const comparedRetailers = input.statuses
    .filter((s) => !s.source.includes(":") && s.source !== "discovery" && s.state !== "disabled")
    .map((s) => ({ retailer: s.source, outcome: `${s.state}: ${s.message}` }));
  for (const s of comparedRetailers) if (!/^ok/.test(s.outcome)) limitations.push(`${RETAILER_NAMES[s.retailer] ?? s.retailer}: ${s.outcome.replace(/^[a-z_]+: /, "")}`);

  const unknownFees = [...new Set(lines.flatMap((l) => l.unknownCharges))];
  if (unknownFees.length) limitations.push(`Not shown by the retailer page: ${unknownFees.join(", ")}. Totals that depend on them are minimums only.`);
  if (lines.some((l) => l.conditionalOffers.length)) limitations.push("Bank/coupon/EMI offers are listed verbatim; eligibility is decided at checkout and they are not deducted.");
  if (lines.some((l) => l.stock === "unknown")) limitations.push("Stock status was not shown for some offers.");
  limitations.push("Delivery dates are not included unless checked for a pincode.");

  const quality: DealReceipt["evidenceQuality"] =
    verifiedRetailers.size >= 2 && verdict?.cheapestConfirmed ? "strong" : verifiedRetailers.size >= 2 ? "partial" : verifiedRetailers.size === 1 ? "weak" : "none";
  const qualityReason =
    quality === "strong"
      ? "At least two retailers verified and a fully known payable total."
      : quality === "partial"
        ? "At least two retailers verified, but payable totals are not fully known."
        : quality === "weak"
          ? "Only one retailer verified."
          : "No verified prices.";

  const v = group.variant;
  const variant = [v.storageGb ? `${v.storageGb} GB storage` : null, v.ramGb ? `${v.ramGb} GB RAM` : null, v.gpu ? v.gpu.toUpperCase() : null, v.color, v.condition !== "unknown" ? v.condition : null].filter(Boolean).join(", ");
  const u = input.usage;
  return DealReceiptSchema.parse({
    receiptId: input.id ?? `PP-${now.getTime().toString(36).toUpperCase()}`,
    generatedAt: now.toISOString(),
    comparisonGeneratedAt: input.comparisonGeneratedAt,
    userQuery: input.parsed.raw,
    productName: group.name,
    productVariant: variant || "Not specified",
    matchConfidence: verifiedLines.length ? Math.min(...verifiedLines.map((l) => l.matchConfidence)) : null,
    comparedRetailers,
    verifiedOffers: verifiedLines.length,
    lines,
    recommendedOffer,
    recommendationExplanation: explanation,
    priceDifference,
    evidenceQuality: quality,
    evidenceQualityReason: qualityReason,
    unknownFees,
    limitations,
    researchCost: u
      ? { searchRequests: u.tinyfishSearchRequests, fetchedUrls: u.tinyfishFetchUrls, paidAgentRuns: u.paidAgentRuns, agentSteps: u.paidAgentSteps, calculatedUsd: u.cost.computedUsd, basis: u.cost.basis }
      : null,
  });
}

/** Plain-text summary for copy / native share. */
export function receiptText(r: DealReceipt): string {
  const L: string[] = [];
  L.push(`PricePilot Deal Receipt ${r.receiptId}`);
  L.push(`${r.productName}${r.productVariant !== "Not specified" ? ` (${r.productVariant})` : ""}`);
  L.push(`Search: "${r.userQuery}" · compared ${r.comparisonGeneratedAt}`);
  L.push("");
  for (const l of r.lines) {
    const price = l.listedPrice !== null ? inr(l.listedPrice) : "price not verified";
    const total = l.confirmedTotal !== null ? `total ${inr(l.confirmedTotal)}` : l.knownMinimum !== null ? `at least ${inr(l.knownMinimum)} (${l.unknownCharges.join(", ")} unknown)` : "";
    L.push(`- ${l.retailerName}: ${price} · ${l.verification.replace("_", " ")} ${l.verifiedAt}${total ? ` · ${total}` : ""}`);
    if (l.sourceUrl) L.push(`  ${l.sourceUrl}`);
  }
  L.push("");
  L.push(`Verdict: ${r.recommendationExplanation}`);
  if (r.priceDifference) L.push(`Listed-price gap: ${inr(r.priceDifference.amount)}`);
  L.push(`Evidence: ${r.evidenceQuality} (${r.evidenceQualityReason})`);
  if (r.limitations.length) L.push(`Limits: ${r.limitations.join(" | ")}`);
  if (r.researchCost) L.push(`Research cost: ${r.researchCost.searchRequests} searches, ${r.researchCost.fetchedUrls} pages, ${r.researchCost.paidAgentRuns} paid agent runs (${r.researchCost.agentSteps} steps)${r.researchCost.calculatedUsd !== null ? `, calculated $${r.researchCost.calculatedUsd}` : ""}`);
  return L.join("\n");
}
