// Quick-commerce comparison: serviceability -> unit/pack normalisation -> single-store plans -> split analysis -> ranking.
import type { UnifiedOffer } from "../schema";
import { pickCheapest, pickFastest, scoreCandidates, type RankCand, type Weights } from "../rank";
import type { ExcludedOffer, Pick, Reason, Recommendation } from "../types";
import { solveBasket, type BasketNeed, type FeeSpec, type Plan, type SolverOption, type SolverStore } from "./solver";

export const DEFAULT_MIN_SPLIT_SAVING = 30;

export interface QuickStoreInput {
  id: string;
  name: string;
  /** provider run state from the fast module (ok|partial|no_results are serviceable) */
  state: string;
  reason: string;
  locationVerified: boolean;
  etaMinutes: number | null;
  fees: FeeSpec;
  observedDiscount?: number | null;
}
export interface QuickConstraints {
  maxEtaMinutes?: number;
  budget?: number;
  requireAllItems?: boolean;
}
export interface QuickInput {
  needs: BasketNeed[];
  offersByNeed: Record<string, UnifiedOffer[]>;
  stores: QuickStoreInput[];
  pincode: string | null;
  constraints?: QuickConstraints;
  weights?: Partial<Weights> | null;
  minSplitSaving?: number;
  /** include offers whose stock is unknown (flagged on the plan line). Default false. */
  includeUnknownStock?: boolean;
  maxSplitStores?: number;
}

export type SplitStatus = "recommended" | "possible_saving_fees_unknown" | "saving_below_threshold" | "no_benefit" | "not_applicable";
export interface SplitAnalysis {
  status: SplitStatus;
  plan: Plan | null;
  baseline: Plan | null;
  /** baseline.total - split.total (known components only) */
  netSaving: number | null;
  minSaving: number;
  reason: string;
}
export interface RankedPlan {
  id: string;
  kind: "single" | "split";
  plan: Plan;
  feasible: boolean;
  infeasibleReason: string | null;
}
export interface QuickResult {
  excludedStores: { storeId: string; name: string; reason: string }[];
  excludedOffers: (ExcludedOffer & { needId: string })[];
  singleStore: Plan[];
  split: SplitAnalysis;
  plans: RankedPlan[];
  recommendation: Recommendation;
  caveats: string[];
}

const SERVICEABLE = new Set(["ok", "partial", "no_results"]);
const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function toSolverStore(s: QuickStoreInput): SolverStore {
  return { id: s.id, name: s.name, etaMinutes: s.etaMinutes, fees: s.fees, observedDiscount: s.observedDiscount ?? null };
}

/** Build solver options from unified offers, recording why each rejected offer was dropped. */
export function buildOptions(input: QuickInput, accessible: Set<string>): { options: SolverOption[]; excluded: (ExcludedOffer & { needId: string })[] } {
  const options: SolverOption[] = [];
  const excluded: (ExcludedOffer & { needId: string })[] = [];
  for (const n of input.needs) {
    for (const o of input.offersByNeed[n.id] ?? []) {
      const drop = (reason: string) => excluded.push({ offer: o, reason, decision: "reject", needId: n.id });
      if (!accessible.has(o.retailer)) continue; // store-level exclusion already reported
      if (input.pincode && o.locationId && o.locationId !== input.pincode) {
        drop(`Offer was observed for pincode ${o.locationId}, not ${input.pincode} (location-based availability).`);
        continue;
      }
      if (o.stockStatus === "out_of_stock") { drop("Out of stock."); continue; }
      if (o.stockStatus === "unknown" && !input.includeUnknownStock) { drop("Stock status unknown."); continue; }
      if (o.listedPrice === null) { drop("No price."); continue; }
      if (o.matchingConfidence < 0.5) { drop(`Low match confidence (${o.matchingConfidence}).`); continue; }
      let packSize: number;
      if (n.unit === "pack") packSize = 1;
      else {
        const q = o.unitQuantity;
        if (!q) { drop("Pack size not stated; cannot verify quantity."); continue; }
        if (q.unit !== n.unit) { drop(`Unit mismatch: offer is ${q.value} ${q.unit}, need is in ${n.unit}.`); continue; }
        packSize = q.value;
      }
      options.push({
        needId: n.id,
        storeId: o.retailer,
        offerId: o.sourceUrl + "|" + o.productName,
        label: o.unitQuantity?.raw ? `${o.productName} (${o.unitQuantity.raw})` : o.productName,
        packSize,
        price: o.listedPrice,
        confidence: o.matchingConfidence,
        stockUnconfirmed: o.stockStatus === "unknown",
        evidence: o.evidence.map((e) => e.text),
      });
    }
  }
  return { options, excluded };
}

function planTrust(p: Plan, needCount: number): number {
  if (!p.lines.length) return 0;
  const coverage = p.lines.length / Math.max(1, needCount);
  const conf = p.lines.reduce((s, l) => s + l.confidence, 0) / p.lines.length;
  const stock = p.lines.some((l) => l.stockUnconfirmed) ? 0.5 : 1;
  return 0.6 * coverage + 0.25 * conf + 0.15 * stock;
}

function planPick(id: string, p: Plan, names: Map<string, string>): Pick {
  const label = p.storeIds.map((s) => names.get(s) ?? s).join(" + ");
  return {
    key: id,
    productId: id,
    productName: p.lines.map((l) => l.query).join(", "),
    retailer: label,
    commerceMode: "quick",
    sourceUrl: "",
    total: p.lines.length ? p.total : null,
    totalIsLowerBound: p.totalIsLowerBound,
    etaMinutes: p.etaMinutes,
    note: p.missing.length ? `Missing: ${p.missing.map((m) => m.query).join(", ")}` : undefined,
  };
}

export function analyzeSplit(singles: Plan[], all: SolverStore[], options: SolverOption[], needs: BasketNeed[], minSaving: number, maxStores: number): SplitAnalysis {
  const rank = (a: Plan, b: Plan) => a.missing.length - b.missing.length || a.total - b.total;
  const baseline = [...singles].sort(rank)[0] ?? null;
  if (!baseline || all.length < 2 || needs.length < 2) {
    return { status: "not_applicable", plan: null, baseline, netSaving: null, minSaving, reason: needs.length < 2 ? "A split needs at least two different items." : "Fewer than two accessible stores." };
  }
  const split = solveBasket({ needs, stores: all, options, maxStores });
  if (split.storeIds.length < 2) return { status: "no_benefit", plan: null, baseline, netSaving: 0, minSaving, reason: "The best basket already uses a single store." };
  const fewerMissing = baseline.missing.length - split.missing.length;
  if (split.missing.length > baseline.missing.length) return { status: "no_benefit", plan: split, baseline, netSaving: null, minSaving, reason: "Splitting covers fewer items." };
  const saving = Math.round((baseline.total - split.total) * 100) / 100;
  const feesKnown = split.unknownComponents.length === 0 && baseline.unknownComponents.length === 0;
  if (fewerMissing > 0) {
    return {
      status: feesKnown ? "recommended" : "possible_saving_fees_unknown",
      plan: split, baseline, netSaving: saving, minSaving,
      reason: `Splitting covers ${fewerMissing} more item(s) than the best single store.${feesKnown ? "" : " Some fees are unknown, so cost is a lower bound."}`,
    };
  }
  if (saving < minSaving) {
    return { status: "saving_below_threshold", plan: split, baseline, netSaving: saving, minSaving, reason: `Net saving ${money(saving)} (after known fees) is below the ${money(minSaving)} minimum, so one store is simpler.` };
  }
  if (!feesKnown) {
    const unk = [...new Set([...split.unknownComponents, ...baseline.unknownComponents])];
    return { status: "possible_saving_fees_unknown", plan: split, baseline, netSaving: saving, minSaving, reason: `Possible saving of ${money(saving)} on items and known fees, but these fees are unknown (${unk.join(", ")}), so a split is not recommended.` };
  }
  return { status: "recommended", plan: split, baseline, netSaving: saving, minSaving, reason: `Splitting across ${split.perStore.map((p) => p.name).join(" + ")} saves ${money(saving)} net of all fees (all fees known).` };
}

export function compareQuick(input: QuickInput): QuickResult {
  const caveats: string[] = [];
  const excludedStores: QuickResult["excludedStores"] = [];
  const usable: QuickStoreInput[] = [];
  for (const s of input.stores) {
    if (!SERVICEABLE.has(s.state)) excludedStores.push({ storeId: s.id, name: s.name, reason: `${s.state}${s.reason ? `: ${s.reason}` : ""}` });
    else {
      usable.push(s);
      if (!s.locationVerified) caveats.push(`${s.name}: delivery location was not verified for ${input.pincode ?? "your pincode"}.`);
    }
  }
  const accessible = new Set(usable.map((s) => s.id));
  const { options, excluded } = buildOptions(input, accessible);
  const stores = usable.map(toSolverStore);
  const names = new Map(stores.map((s) => [s.id, s.name]));
  const needs = input.needs;

  const singleStore = stores.map((s) => solveBasket({ needs, stores: [s], options, maxStores: 1 }));
  const minSaving = input.minSplitSaving ?? DEFAULT_MIN_SPLIT_SAVING;
  const split = analyzeSplit(singleStore, stores, options, needs, minSaving, input.maxSplitStores ?? 2);

  const plans: RankedPlan[] = singleStore.map((p) => ({ id: `single:${p.storeIds[0] ?? "none"}`, kind: "single" as const, plan: p, feasible: true, infeasibleReason: null }));
  singleStore.forEach((p, i) => { if (!p.storeIds.length) plans[i].id = `single:${stores[i].id}`; });
  if (split.status === "recommended" && split.plan) plans.push({ id: `split:${split.plan.storeIds.join("+")}`, kind: "split", plan: split.plan, feasible: true, infeasibleReason: null });

  const c = input.constraints ?? {};
  for (const rp of plans) {
    const p = rp.plan;
    if (!p.lines.length) rp.infeasibleReason = "No items available.";
    else if (c.requireAllItems && p.missing.length) rp.infeasibleReason = `Missing items: ${p.missing.map((m) => m.query).join(", ")}.`;
    else if (c.maxEtaMinutes !== undefined && p.etaMinutes === null) rp.infeasibleReason = "ETA not published, so the time limit cannot be verified.";
    else if (c.maxEtaMinutes !== undefined && (p.etaMinutes as number) > c.maxEtaMinutes) rp.infeasibleReason = `Published ETA ${p.etaMinutes} min exceeds the ${c.maxEtaMinutes} min limit.`;
    else if (c.budget !== undefined && p.total > c.budget) rp.infeasibleReason = `Total ${money(p.total)}${p.totalIsLowerBound ? " (+ unknown fees)" : ""} exceeds budget ${money(c.budget)}.`;
    rp.feasible = rp.infeasibleReason === null;
  }
  const feasible = plans.filter((p) => p.feasible);
  const minMissing = feasible.length ? Math.min(...feasible.map((p) => p.plan.missing.length)) : 0;
  const pool = feasible.filter((p) => p.plan.missing.length === minMissing);
  const cands: RankCand<RankedPlan>[] = pool.map((rp) => ({
    key: rp.id,
    item: rp,
    total: rp.plan.total,
    totalIsLowerBound: rp.plan.totalIsLowerBound,
    etaMinutes: rp.plan.etaMinutes,
    trust: planTrust(rp.plan, needs.length),
  }));
  const cheapest = pickCheapest(cands);
  const fastest = pickFastest(cands);
  const overall = scoreCandidates(cands, input.weights)[0] ?? null;

  const reasons: Reason[] = [];
  const evOf = (p: Plan) => p.lines.flatMap((l) => l.evidence.slice(0, 1).map((t) => ({ text: t, source: l.storeId })));
  if (cheapest) {
    const p = cheapest.item.plan;
    reasons.push({ code: "cheapest", text: `${p.perStore.map((s) => s.name).join(" + ")} has the lowest ${p.totalIsLowerBound ? "known (lower-bound) " : ""}total ${money(p.total)}${p.missing.length ? ` but is missing ${p.missing.length} item(s)` : ""}.`, evidence: evOf(p) });
  }
  if (fastest) reasons.push({ code: "fastest", text: `${fastest.item.plan.perStore.map((s) => s.name).join(" + ")} has the shortest published ETA (${fastest.etaMinutes} min).`, evidence: [] });
  if (overall) {
    const p = overall.item.plan;
    reasons.push({ code: "overall", text: `Best overall by weighted score ${overall.score} (price ${overall.parts.price.toFixed(2)}, speed ${overall.parts.speed.toFixed(2)}, trust ${overall.parts.trust.toFixed(2)}): ${p.perStore.map((s) => s.name).join(" + ")}.`, evidence: [] });
  }
  reasons.push({ code: "split", text: split.reason, evidence: [] });
  for (const rp of plans.filter((p) => !p.feasible)) caveats.push(`${rp.id} excluded: ${rp.infeasibleReason}`);
  for (const s of excludedStores) caveats.push(`${s.name} excluded: ${s.reason}`);
  for (const x of excluded) caveats.push(`${x.offer.retailer} "${x.offer.productName}" excluded: ${x.reason}`);
  for (const rp of pool) {
    if (rp.plan.totalIsLowerBound) caveats.push(`${rp.id}: total is a lower bound; unknown ${rp.plan.unknownComponents.join(", ")}.`);
    for (const l of rp.plan.lines) {
      if (l.overbuy > 0) caveats.push(`${rp.id}: "${l.query}" overbuys by ${l.overbuy} (${l.overbuyPct}%).`);
      if (l.stockUnconfirmed) caveats.push(`${rp.id}: stock for "${l.query}" is unconfirmed.`);
    }
    if (rp.plan.missing.length) caveats.push(`${rp.id}: missing ${rp.plan.missing.map((m) => m.query).join(", ")}.`);
  }
  const toP = (c0: RankCand<RankedPlan> | null) => (c0 ? planPick(c0.item.id, c0.item.plan, names) : null);
  const overallPick = toP(overall);
  const text = overallPick
    ? `${reasons.find((r) => r.code === "overall")?.text ?? ""} ${cheapest ? reasons[0].text : ""} ${split.reason}`.trim() + (caveats.length ? ` Caveats: ${[...new Set(caveats)].slice(0, 3).join(" ")}` : "")
    : `No feasible plan. ${[...new Set(caveats)].slice(0, 3).join(" ")}`.trim();
  return {
    excludedStores,
    excludedOffers: excluded,
    singleStore,
    split,
    plans,
    recommendation: { best: overallPick, cheapest: toP(cheapest), fastest: toP(fastest), overall: overallPick, reasons, caveats: [...new Set(caveats)], text, enoughEvidence: overallPick !== null && !pool.every((p) => p.plan.totalIsLowerBound) },
    caveats: [...new Set(caveats)],
  };
}
