// Exact basket solver for MVP scale (<= 8 items, <= 3 stores): enumerates store subsets and item->store
// assignments with branch-and-bound. Solves the same problem a MILP would; `solveBasket` is the swap-in point.
// Pack covering uses a small DP (unbounded knapsack with coverage cap) per (item, store).

import type { NeedUnit } from "../units";


export interface BasketNeed {
  id: string;
  query: string;
  unit: NeedUnit;
  /** required amount in base units (or number of packs when unit === 'pack') */
  amount: number;
}
export interface FeeSpec {
  delivery: number | null;
  handling: number | null;
  platform: number | null;
  smallCartFee: number | null;
  smallCartThreshold: number | null;
  freeDeliveryThreshold: number | null;
}
export interface SolverStore {
  id: string;
  name: string;
  etaMinutes: number | null;
  fees: FeeSpec;
  /** observed store-level discount (never applied: conditions unknown) */
  observedDiscount?: number | null;
}
export interface SolverOption {
  needId: string;
  storeId: string;
  offerId: string;
  label: string;
  /** size of one pack in the need's base unit (1 for 'pack' needs) */
  packSize: number;
  price: number;
  confidence: number;
  stockUnconfirmed?: boolean;
  evidence: string[];
}
export interface BasketProblem {
  needs: BasketNeed[];
  stores: SolverStore[];
  options: SolverOption[];
  /** max distinct stores in the plan (default 3) */
  maxStores?: number;
  /** max packs bought per line (default 20) */
  maxPacksPerLine?: number;
}

export interface PackChoice {
  offerId: string;
  label: string;
  size: number;
  price: number;
  count: number;
}
export interface PlanLine {
  needId: string;
  query: string;
  storeId: string;
  packs: PackChoice[];
  required: number;
  covered: number;
  overbuy: number; // covered - required (>= 0)
  overbuyPct: number;
  lineTotal: number;
  stockUnconfirmed: boolean;
  confidence: number;
  evidence: string[];
}
export interface StoreFeeBreakdown {
  delivery: number | null;
  handling: number | null;
  platform: number | null;
  smallCart: number | null;
  known: number;
  unknown: string[];
  freeDeliveryApplied: boolean;
}
export interface PlanStore {
  storeId: string;
  name: string;
  subtotal: number;
  fees: StoreFeeBreakdown;
  etaMinutes: number | null;
  observedDiscount: number | null;
  /** subtotal + known fees */
  knownTotal: number;
}
export interface Plan {
  storeIds: string[];
  lines: PlanLine[];
  missing: { needId: string; query: string; reason: string }[];
  perStore: PlanStore[];
  itemsSubtotal: number;
  knownFees: number;
  /** known total (items + known fees). Exact only when totalIsLowerBound is false. */
  total: number;
  totalIsLowerBound: boolean;
  unknownComponents: string[];
  /** max published ETA across used stores; null if any is unknown */
  etaMinutes: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export interface Combo {
  packs: PackChoice[];
  cost: number;
  covered: number;
}

/** Minimum-cost multiset of packs whose total size >= required. Ties: least overbuy, then fewest packs. */
export function bestPackCombo(required: number, packs: { offerId: string; label: string; size: number; price: number }[], maxPacks = 20): Combo | null {
  if (!(required > 0) || !packs.length) return null;
  const ps = packs.filter((p) => p.size > 0 && p.price >= 0);
  if (!ps.length) return null;
  let step = Math.round(required * 1000);
  for (const p of ps) step = gcd(step, Math.round(p.size * 1000));
  const R = Math.round((required * 1000) / step);
  if (R > 40000) return null;
  const sizes = ps.map((p) => Math.round((p.size * 1000) / step));
  type S = { cost: number; total: number; count: number; prev: number; pack: number } | null;
  const dp: S[] = new Array(R + 1).fill(null);
  dp[0] = { cost: 0, total: 0, count: 0, prev: -1, pack: -1 };
  for (let c = 0; c < R; c++) {
    const s = dp[c];
    if (!s || s.count >= maxPacks) continue;
    ps.forEach((p, i) => {
      const nc = Math.min(R, c + sizes[i]);
      const cand = { cost: r2(s.cost + p.price), total: s.total + sizes[i], count: s.count + 1, prev: c, pack: i };
      const cur = dp[nc];
      if (!cur || cand.cost < cur.cost - 1e-9 || (Math.abs(cand.cost - cur.cost) < 1e-9 && (cand.total < cur.total || (cand.total === cur.total && cand.count < cur.count)))) dp[nc] = cand;
    });
  }
  const end = dp[R];
  if (!end) return null;
  const counts = new Map<number, number>();
  for (let c = R; c > 0; ) {
    const s = dp[c] as NonNullable<S>;
    counts.set(s.pack, (counts.get(s.pack) ?? 0) + 1);
    c = s.prev;
  }
  const chosen: PackChoice[] = [...counts.entries()].map(([i, count]) => ({ offerId: ps[i].offerId, label: ps[i].label, size: ps[i].size, price: ps[i].price, count }));
  const covered = chosen.reduce((s, p) => s + p.size * p.count, 0);
  return { packs: chosen, cost: r2(end.cost), covered: r2(covered) };
}

export function computeStoreFees(store: SolverStore, subtotal: number): StoreFeeBreakdown {
  const f = store.fees;
  const unknown: string[] = [];
  let known = 0;
  let freeDeliveryApplied = false;
  let delivery: number | null;
  if (f.freeDeliveryThreshold !== null && subtotal >= f.freeDeliveryThreshold) {
    delivery = 0;
    freeDeliveryApplied = true;
  } else if (f.delivery === null) {
    delivery = null;
    unknown.push(`${store.name} delivery fee`);
  } else delivery = f.delivery;
  if (delivery !== null) known += delivery;
  const handling = f.handling;
  if (handling === null) unknown.push(`${store.name} handling fee`);
  else known += handling;
  const platform = f.platform;
  if (platform === null) unknown.push(`${store.name} platform fee`);
  else known += platform;
  let smallCart: number | null = 0;
  if (f.smallCartThreshold !== null && subtotal < f.smallCartThreshold) {
    if (f.smallCartFee === null) {
      smallCart = null;
      unknown.push(`${store.name} small-cart fee`);
    } else {
      smallCart = f.smallCartFee;
      known += smallCart;
    }
  }
  return { delivery, handling, platform, smallCart, known: r2(known), unknown, freeDeliveryApplied };
}

function subsets<T>(arr: T[], maxSize: number): T[][] {
  const out: T[][] = [];
  const rec = (i: number, cur: T[]) => {
    if (cur.length) out.push([...cur]);
    if (cur.length === maxSize) return;
    for (let j = i; j < arr.length; j++) {
      cur.push(arr[j]);
      rec(j + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

interface LineChoice {
  combo: Combo;
  opts: SolverOption[];
}

/** Exact best plan: fewest missing items first, then lowest known total, then fewer unknown fees, then fewer stores. */
export function solveBasket(problem: BasketProblem): Plan {
  const maxStores = Math.max(1, Math.min(problem.maxStores ?? 3, problem.stores.length || 1));
  const maxPacks = problem.maxPacksPerLine ?? 20;
  const { needs, stores } = problem;
  // per (need, store) minimal-cost pack combination
  const choice = new Map<string, LineChoice | null>();
  const noChoiceReason = new Map<string, string>();
  for (const n of needs) {
    for (const s of stores) {
      const opts = problem.options.filter((o) => o.needId === n.id && o.storeId === s.id);
      if (!opts.length) {
        choice.set(`${n.id}|${s.id}`, null);
        continue;
      }
      // dedupe packs by offerId
      const combo = bestPackCombo(n.amount, opts.map((o) => ({ offerId: o.offerId, label: o.label, size: o.packSize, price: o.price })), maxPacks);
      choice.set(`${n.id}|${s.id}`, combo ? { combo, opts } : null);
    }
  }

  const buildPlan = (storeIds: string[], assign: (string | null)[]): Plan => {
    const lines: PlanLine[] = [];
    const missing: Plan["missing"] = [];
    const sub = new Map<string, number>();
    needs.forEach((n, i) => {
      const sid = assign[i];
      if (!sid) {
        missing.push({ needId: n.id, query: n.query, reason: "No in-stock, correctly sized offer at any included store." });
        return;
      }
      const ch = choice.get(`${n.id}|${sid}`) as LineChoice;
      const used = ch.opts.filter((o) => ch.combo.packs.some((p) => p.offerId === o.offerId));
      lines.push({
        needId: n.id,
        query: n.query,
        storeId: sid,
        packs: ch.combo.packs,
        required: n.amount,
        covered: ch.combo.covered,
        overbuy: r2(ch.combo.covered - n.amount),
        overbuyPct: n.amount > 0 ? r2(((ch.combo.covered - n.amount) / n.amount) * 100) : 0,
        lineTotal: ch.combo.cost,
        stockUnconfirmed: used.some((o) => o.stockUnconfirmed),
        confidence: used.length ? Math.min(...used.map((o) => o.confidence)) : 0,
        evidence: used.flatMap((o) => o.evidence).slice(0, 4),
      });
      sub.set(sid, r2((sub.get(sid) ?? 0) + ch.combo.cost));
    });
    const perStore: PlanStore[] = [];
    const unknownComponents: string[] = [];
    let knownFees = 0;
    for (const sid of storeIds) {
      if (!sub.has(sid)) continue;
      const st = stores.find((s) => s.id === sid) as SolverStore;
      const subtotal = sub.get(sid) as number;
      const fees = computeStoreFees(st, subtotal);
      knownFees += fees.known;
      unknownComponents.push(...fees.unknown);
      perStore.push({ storeId: sid, name: st.name, subtotal, fees, etaMinutes: st.etaMinutes, observedDiscount: st.observedDiscount ?? null, knownTotal: r2(subtotal + fees.known) });
    }
    const itemsSubtotal = r2([...sub.values()].reduce((a, b) => a + b, 0));
    const etas = perStore.map((p) => p.etaMinutes);
    return {
      storeIds: perStore.map((p) => p.storeId),
      lines,
      missing,
      perStore,
      itemsSubtotal,
      knownFees: r2(knownFees),
      total: r2(itemsSubtotal + knownFees),
      totalIsLowerBound: unknownComponents.length > 0,
      unknownComponents,
      etaMinutes: perStore.length && etas.every((e) => e !== null) ? Math.max(...(etas as number[])) : null,
    };
  };

  const holder: { best: Plan | null } = { best: null };
  const better = (a: Plan, b: Plan | null): boolean => {
    if (!b) return true;
    if (a.missing.length !== b.missing.length) return a.missing.length < b.missing.length;
    if (Math.abs(a.total - b.total) > 1e-9) return a.total < b.total;
    if (a.unknownComponents.length !== b.unknownComponents.length) return a.unknownComponents.length < b.unknownComponents.length;
    if (a.storeIds.length !== b.storeIds.length) return a.storeIds.length < b.storeIds.length;
    return a.storeIds.join() < b.storeIds.join();
  };

  for (const subset of subsets(stores, maxStores)) {
    const ids = subset.map((s) => s.id);
    const assign: (string | null)[] = new Array(needs.length).fill(null);
    const rec = (i: number, itemCost: number, missing: number) => {
      // bound: fees are non-negative, so item cost alone is a lower bound on the objective
      const best = holder.best;
      if (best && (missing > best.missing.length || (missing === best.missing.length && itemCost > best.total + 1e-9))) return;
      if (i === needs.length) {
        const plan = buildPlan(ids, assign);
        if (better(plan, holder.best)) holder.best = plan;
        return;
      }
      let any = false;
      for (const sid of ids) {
        const ch = choice.get(`${needs[i].id}|${sid}`);
        if (!ch) continue;
        any = true;
        assign[i] = sid;
        rec(i + 1, itemCost + ch.combo.cost, missing);
      }
      if (!any) {
        assign[i] = null;
        rec(i + 1, itemCost, missing + 1);
      }
      assign[i] = null;
    };
    rec(0, 0, 0);
  }
  return holder.best ?? buildPlan([], new Array(needs.length).fill(null));
}
