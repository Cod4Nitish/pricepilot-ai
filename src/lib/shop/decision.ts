// Deterministic, explainable decision over verified ShopOffers. No invented values; missing data is stated.
// Pick.offerId is the offer's sourceUrl (UI convention).
import type { Decision, Pick, ShopOffer, ShopWeights } from "./types";

export const MATCH_MIN_CONFIDENCE = 0.72;
export const DEFAULT_SHOP_WEIGHTS: ShopWeights = { price: 0.6, delivery: 0.25, evidence: 0.15 };

const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const isVerified = (o: ShopOffer) => o.verificationStatus === "verified" || o.verificationStatus === "agent_verified";

export function normalizeShopWeights(w?: Partial<ShopWeights> | null): ShopWeights {
  const ok = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const given = { price: ok(w?.price), delivery: ok(w?.delivery), evidence: ok(w?.evidence) };
  const any = given.price !== null || given.delivery !== null || given.evidence !== null;
  const raw = any ? { price: given.price ?? 0, delivery: given.delivery ?? 0, evidence: given.evidence ?? 0 } : { ...DEFAULT_SHOP_WEIGHTS };
  const sum = raw.price + raw.delivery + raw.evidence;
  if (sum <= 0) return { ...DEFAULT_SHOP_WEIGHTS };
  return { price: raw.price / sum, delivery: raw.delivery / sum, evidence: raw.evidence / sum };
}

/** Evidence quality 0..1: verification level (0.5 verified / 0.4 agent) + in stock (0.2) + warranty stated (0.15) + return policy stated (0.15). */
export function evidenceScore(o: ShopOffer): number {
  return (o.verificationStatus === "verified" ? 0.5 : o.verificationStatus === "agent_verified" ? 0.4 : 0) + (o.stockStatus === "in_stock" ? 0.2 : 0) + (o.warranty ? 0.15 : 0) + (o.returnPolicy ? 0.15 : 0);
}

const eligible = (o: ShopOffer) => isVerified(o) && o.matchingConfidence >= MATCH_MIN_CONFIDENCE && o.listedPrice !== null && o.stockStatus !== "out_of_stock";
const byUrl = (a: ShopOffer, b: ShopOffer) => a.sourceUrl.localeCompare(b.sourceUrl);
const minmax = (vals: number[]) => ({ min: Math.min(...vals), max: Math.max(...vals) });
const norm01 = (v: number, mm: { min: number; max: number }) => (mm.max === mm.min ? 0 : (v - mm.min) / (mm.max - mm.min));

function conditionsFor(o: ShopOffer): string[] {
  const c: string[] = [];
  const open = o.conditionalOffers.filter((x) => !x.applied);
  if (open.length) c.push(`${open.length} bank/coupon offer(s) NOT counted (conditions not selected): ${open.slice(0, 2).map((x) => `"${x.text}" (${x.condition})`).join("; ")}.`);
  if (o.totalIsLowerBound) c.push("Shipping/other fees are unknown, so the real total can be higher than shown.");
  if (o.verificationStatus === "agent_verified") c.push("Price was read by a browser agent from the live page.");
  return c;
}
const evidenceFor = (o: ShopOffer): string[] => [o.sourceUrl, ...o.evidence.slice(0, 2).map((e) => e.text)];

function pick(o: ShopOffer, value: Pick["value"], reasons: string[], extraConditions: string[] = []): Pick {
  return { offerId: o.sourceUrl, retailer: o.retailer, value, reasons, conditions: [...conditionsFor(o), ...extraConditions], evidence: evidenceFor(o) };
}

function etaOf(o: ShopOffer): string | null {
  return o.delivery.kind === "published_estimate" && o.delivery.etaDate ? o.delivery.etaDate : null;
}

export function buildDecision(offers: ShopOffer[], weightsIn?: Partial<ShopWeights> | null): Decision {
  const notes: string[] = [];
  const w = normalizeShopWeights(weightsIn);
  const pool = offers.filter(eligible).sort(byUrl);
  const retailers = new Set(pool.map((o) => o.retailer));
  const singleStoreOnly = retailers.size < 2;

  const skipped = offers.length - pool.length;
  if (skipped > 0) notes.push(`${skipped} offer(s) were left out of the comparison (unverified price, out of stock, or low match confidence).`);
  if (pool.length === 0) {
    notes.push("No verified, in-stock, matching offer is available, so no pick can be made.");
    return { cheapestListed: null, cheapestPayable: null, fastest: null, bestOverall: null, notes, singleStoreOnly: true };
  }
  if (singleStoreOnly) notes.push("Only one store has a verified offer, so a multi-store comparison is not possible yet; other stores may be cheaper.");

  // cheapest listed
  const listedSorted = [...pool].sort((a, b) => (a.listedPrice as number) - (b.listedPrice as number) || byUrl(a, b));
  const cl = listedSorted[0];
  const next = listedSorted.find((o) => o.sourceUrl !== cl.sourceUrl);
  const clReasons = [`Lowest verified listed price ${money(cl.listedPrice as number)} among ${pool.length} verified matching offer(s).`];
  if (next) {
    const diff = (next.listedPrice as number) - (cl.listedPrice as number);
    clReasons.push(diff === 0 ? `Same listed price as ${next.retailer}.` : `${money(diff)} lower than the next offer (${next.retailer}, ${money(next.listedPrice as number)}).`);
  }
  const cheapestListed = pick(cl, cl.listedPrice, clReasons);

  // cheapest payable: only offers with ALL fees known
  const payable = pool.filter((o) => !o.totalIsLowerBound && o.effectiveTotal !== null).sort((a, b) => (a.effectiveTotal as number) - (b.effectiveTotal as number) || byUrl(a, b));
  let cheapestPayable: Pick | null = null;
  if (payable.length) {
    const p = payable[0];
    cheapestPayable = pick(p, p.effectiveTotal, [`Lowest total payable ${money(p.effectiveTotal as number)} among ${payable.length} offer(s) with all fees known.`]);
    if (payable.length < pool.length) notes.push(`${pool.length - payable.length} offer(s) were not considered for cheapest payable because their fees are unknown.`);
  } else {
    notes.push("Cheapest payable total cannot be named: shipping/other fees are unknown for every verified offer. Compare listed prices only.");
  }

  // fastest: published estimates only
  const withEta = pool.filter((o) => etaOf(o) !== null).sort((a, b) => (etaOf(a) as string).localeCompare(etaOf(b) as string) || (a.listedPrice as number) - (b.listedPrice as number) || byUrl(a, b));
  let fastest: Pick | null = null;
  if (withEta.length) {
    const f = withEta[0];
    fastest = pick(f, f.delivery.etaText ?? f.delivery.etaDate, [`Earliest published delivery estimate (${f.delivery.etaText ?? f.delivery.etaDate}) among ${withEta.length} offer(s) with a checked pincode.`], ["Delivery estimates are published by the retailer and are not guaranteed."]);
    if (withEta.length < pool.length) notes.push(`${pool.length - withEta.length} offer(s) have no delivery estimate and were not considered for fastest.`);
  } else {
    notes.push("Fastest delivery cannot be named: no offer has a verified delivery estimate for this pincode.");
  }

  // best overall: weighted min-max
  const deliveryKnown = pool.filter((o) => o.delivery.kind === "published_estimate" && (o.delivery.etaDays !== null || o.delivery.etaDate !== null));
  const dval = (o: ShopOffer) => (o.delivery.etaDays !== null ? o.delivery.etaDays : Date.parse(o.delivery.etaDate as string) / 86_400_000);
  const useDelivery = deliveryKnown.length > 0 && w.delivery > 0;
  let ww = { ...w };
  const conditions: string[] = [];
  if (deliveryKnown.length === 0) {
    const rest = w.price + w.evidence;
    ww = rest > 0 ? { price: w.price / rest, delivery: 0, evidence: w.evidence / rest } : { price: 1, delivery: 0, evidence: 0 };
    notes.push(`Delivery data is missing for all offers, so the delivery weight (${Math.round(w.delivery * 100)}%) was redistributed to price and evidence.`);
    conditions.push("Delivery speed was not compared; check delivery for your pincode before deciding.");
  } else if (deliveryKnown.length < pool.length) {
    notes.push(`Delivery is known for only ${deliveryKnown.length} of ${pool.length} offers; offers without it score 0 on delivery.`);
    conditions.push("Some offers have no delivery estimate, which lowers their score.");
  }
  const priceOf = (o: ShopOffer) => o.effectiveTotal ?? (o.listedPrice as number);
  const pmm = minmax(pool.map(priceOf));
  const dmm = useDelivery ? minmax(deliveryKnown.map(dval)) : { min: 0, max: 0 };
  const scored = pool
    .map((o) => {
      const price = pool.length === 1 || pmm.max === pmm.min ? 1 : 1 - norm01(priceOf(o), pmm);
      const delivery = !useDelivery ? 0 : o.delivery.kind === "published_estimate" && (o.delivery.etaDays !== null || o.delivery.etaDate !== null) ? (dmm.max === dmm.min ? 1 : 1 - norm01(dval(o), dmm)) : 0;
      const evidence = evidenceScore(o);
      const score = Math.round((ww.price * price + ww.delivery * delivery + ww.evidence * evidence) * 10000) / 10000;
      return { o, price, delivery, evidence, score };
    })
    .sort((a, b) => b.score - a.score || priceOf(a.o) - priceOf(b.o) || byUrl(a.o, b.o));
  const top = scored[0];
  const runner = scored[1];
  const reasons = [
    `Weighted score ${Math.round(top.score * 100)}/100 (price ${Math.round(ww.price * 100)}%, delivery ${Math.round(ww.delivery * 100)}%, evidence ${Math.round(ww.evidence * 100)}%).`,
    `Price score ${Math.round(top.price * 100)}, delivery score ${useDelivery ? Math.round(top.delivery * 100) : "n/a"}, evidence score ${Math.round(top.evidence * 100)} (verification, stock, warranty/return stated).`,
  ];
  if (runner) reasons.push(`Ahead of ${runner.o.retailer} (${Math.round(runner.score * 100)}/100).`);
  if (!cheapestPayable) conditions.push("Total payable is unknown because fees are not published; the real total may change the ranking.");
  if (runner && top.score - runner.score < 0.02) conditions.push("Scores are nearly tied; there is no clear overall winner.");
  if (singleStoreOnly) conditions.push("Only one store was compared.");
  if (top.o.sourceUrl !== cl.sourceUrl) {
    notes.push(`Best overall (${top.o.retailer}) differs from cheapest listed (${cl.retailer}): ${money((top.o.listedPrice as number) - (cl.listedPrice as number))} more, but it scores higher on ${top.delivery > 0 ? "delivery and/or " : ""}evidence.`);
  }
  if (conditions.length) notes.push("No unconditional winner: " + conditions.join(" "));
  const bestOverall = pick(top.o, Math.round(top.score * 100), reasons, conditions);

  return { cheapestListed, cheapestPayable, fastest, bestOverall, notes, singleStoreOnly };
}
