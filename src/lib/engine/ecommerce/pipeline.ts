// E-commerce comparison: resolve -> price -> rank -> explain.
import type { UnifiedOffer } from "../schema";
import { pickCheapest, pickFastest, scoreCandidates, type RankCand, type Weights } from "../rank";
import type { ExcludedOffer, Pick, Reason, Recommendation } from "../types";
import { priceOffer, type PaymentOptions, type PricedOffer } from "./discounts";
import { cleanOffers } from "./dedupe";
import { parseEcomQuery, type EcomQuery } from "./entity";
import { resolveCandidates, type Resolution } from "./resolve";

export interface EcomEntry {
  offer: UnifiedOffer;
  resolution: Resolution;
  pricing: PricedOffer;
  eligibleForCheapest: boolean;
  ineligibleReason: string | null;
}
export interface EcomComparison {
  query: EcomQuery;
  entries: EcomEntry[]; // match + possible, ranked by effective total (nulls last)
  excluded: ExcludedOffer[]; // rejected resolutions
  recommendation: Recommendation;
}

const money = (n: number | null) => (n === null ? "unknown" : `₹${n.toLocaleString("en-IN")}`);

function toPick(e: EcomEntry): Pick {
  return {
    key: e.offer.sourceUrl,
    productId: e.offer.productId,
    productName: e.offer.productName,
    retailer: e.offer.retailer,
    commerceMode: "ecommerce",
    sourceUrl: e.offer.sourceUrl,
    total: e.pricing.effectiveTotal,
    totalIsLowerBound: e.pricing.totalIsLowerBound,
    etaMinutes: e.offer.deliveryEtaMinutes,
    note: e.pricing.stillConditional.length && e.pricing.bestCaseEffective !== null && e.pricing.bestCaseEffective < (e.pricing.effectiveTotal ?? Infinity)
      ? `Conditional best case ${money(e.pricing.bestCaseEffective)} if offers apply (not counted)`
      : undefined,
  };
}

export function compareEcommerce(
  queryText: string,
  offersIn: UnifiedOffer[],
  opts: PaymentOptions & { budget?: number | null; weights?: Partial<Weights> | null } = {},
): EcomComparison {
  const offers = cleanOffers(offersIn);
  const query = parseEcomQuery(queryText);
  const budget = opts.budget ?? query.budget;
  const res = resolveCandidates(query.entity, queryText, offers.map((o) => ({ id: o.sourceUrl, title: o.productName, gtins: o.gtin ? [o.gtin] : [] })));
  const entries: EcomEntry[] = [];
  const excluded: ExcludedOffer[] = [];
  offers.forEach((offer, i) => {
    const resolution = res[i];
    if (resolution.decision === "reject") {
      excluded.push({ offer, reason: resolution.reasons.join(" "), decision: "reject" });
      return;
    }
    const pricing = priceOffer(offer, opts);
    let why: string | null = null;
    if (resolution.decision !== "match") why = "Match is only 'possible'; not confirmed to be the same product.";
    else if (offer.verificationStatus !== "verified" && offer.verificationStatus !== "agent_verified") why = `Price is ${offer.verificationStatus}, not read from the page.`;
    else if (offer.stockStatus === "out_of_stock") why = "Out of stock.";
    else if (offer.listedPrice === null || pricing.effectiveTotal === null) why = "No price available.";
    else if (budget != null && pricing.effectiveTotal > budget) why = `Over budget (${money(pricing.effectiveTotal)} > ${money(budget)}).`;
    entries.push({ offer, resolution, pricing, eligibleForCheapest: why === null, ineligibleReason: why });
  });
  entries.sort((a, b) => (a.pricing.effectiveTotal ?? Infinity) - (b.pricing.effectiveTotal ?? Infinity));

  const eligible = entries.filter((e) => e.eligibleForCheapest);
  const cands: RankCand<EcomEntry>[] = eligible.map((e) => ({
    key: e.offer.sourceUrl,
    item: e,
    total: e.pricing.effectiveTotal,
    totalIsLowerBound: e.pricing.totalIsLowerBound,
    etaMinutes: e.offer.deliveryEtaMinutes,
    trust: 0.6 * e.resolution.confidence + 0.4 * (e.offer.verificationStatus === "verified" ? 1 : 0.8),
  }));
  const cheapest = pickCheapest(cands);
  const fastest = pickFastest(cands);
  const scored = scoreCandidates(cands, opts.weights);
  const overall = scored[0] ?? null;

  const reasons: Reason[] = [];
  const caveats: string[] = [];
  for (const x of excluded.slice(0, 5)) caveats.push(`Excluded "${x.offer.productName}" (${x.offer.retailer}): ${x.reason}`);
  for (const e of entries.filter((e) => !e.eligibleForCheapest)) caveats.push(`Not eligible for "cheapest": ${e.offer.retailer} "${e.offer.productName}" - ${e.ineligibleReason}`);
  for (const e of entries) for (const m of e.resolution.mismatches.filter((m) => m.severity !== "hard")) caveats.push(`${e.offer.retailer}: ${m.attribute} ${m.severity === "soft" ? "differs" : "unverifiable"} - ${m.note}`);

  let text: string;
  if (cheapest) {
    const e = cheapest.item;
    reasons.push({
      code: "cheapest_verified",
      text: `${e.offer.retailer} has the lowest ${e.pricing.totalIsLowerBound ? "known (lower-bound) " : ""}effective total ${money(e.pricing.effectiveTotal)} among ${eligible.length} verified, matching in-stock offer(s).`,
      evidence: e.offer.evidence.slice(0, 2),
    });
    reasons.push({ code: "match", text: e.resolution.reasons.slice(0, 4).join(" "), evidence: [{ text: e.offer.productName, source: e.offer.sourceUrl }] });
    if (e.pricing.totalIsLowerBound) caveats.push(`Total is a lower bound: ${e.pricing.unknownFees.join(", ")} unknown for ${e.offer.retailer}.`);
    if (e.pricing.eligibleDiscount > 0) reasons.push({ code: "discount_applied", text: `Discount ₹${e.pricing.eligibleDiscount} counted because you selected a matching payment option.`, evidence: e.pricing.applied.map((d) => ({ text: d.text, source: e.offer.sourceUrl })) });
    if (e.pricing.stillConditional.length) caveats.push(`${e.pricing.stillConditional.length} bank/coupon offer(s) not counted (conditions not selected/verified)${e.pricing.bestCaseEffective !== null && e.pricing.bestCaseEffective < (e.pricing.effectiveTotal ?? 0) ? `; conditional best case ${money(e.pricing.bestCaseEffective)}` : ""}.`);
    const tie = eligible.length > 1 && cands.some((c) => c.key !== cheapest.key && c.total !== null && cheapest.total !== null && Math.abs((c.total as number) - cheapest.total) / cheapest.total <= 0.01);
    if (tie) caveats.push("Another offer is within 1% of this total; the difference is not meaningful.");
    text = `${e.offer.productName} at ${e.offer.retailer} for ${money(e.pricing.effectiveTotal)}${e.pricing.totalIsLowerBound ? " (+ unknown fees)" : ""}. ${reasons[0].text} Source: ${e.offer.sourceUrl}.`;
    if (caveats.length) text += ` Caveats: ${caveats.slice(0, 3).join(" ")}`;
  } else {
    const best = entries[0];
    text = best
      ? `No offer is verified and matching enough to recommend. Closest is ${best.offer.retailer} "${best.offer.productName}" at ${money(best.offer.listedPrice)} but: ${best.ineligibleReason ?? "unverified"}`
      : "No matching offers were found.";
    reasons.push({ code: "insufficient_evidence", text, evidence: [] });
  }
  const overallPick = overall ? toPick(overall.item) : null;
  const cheapPick = cheapest ? toPick(cheapest.item) : null;
  return {
    query,
    entries,
    excluded,
    recommendation: {
      best: overallPick,
      cheapest: cheapPick,
      fastest: fastest ? toPick(fastest.item) : null,
      overall: overallPick,
      reasons,
      caveats,
      text,
      enoughEvidence: cheapest !== null,
    },
  };
}
