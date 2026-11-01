import type { BasketPlan, Offer, RetailerId } from "./types";

export interface BasketInputLine {
  query: string;
  qty: number;
  offers: Offer[];
}

const isUsable = (o: Offer) =>
  o.price !== null &&
  (o.verification === "verified" || o.verification === "agent_verified") &&
  o.matchConfidence >= 0.8 &&
  o.availability !== "out_of_stock";

interface Choice {
  query: string;
  qty: number;
  offer: Offer;
}

/** Cost of an assignment: item totals + known delivery per store; tie-break on fewer stores. */
function cost(choices: Choice[]): { total: number; stores: number } {
  const byStore = new Map<RetailerId, Choice[]>();
  for (const c of choices) byStore.set(c.offer.retailer, [...(byStore.get(c.offer.retailer) ?? []), c]);
  let total = 0;
  for (const [, cs] of byStore) {
    total += cs.reduce((s, c) => s + c.offer.price! * c.qty, 0);
    total += storeDelivery(cs) ?? 0;
  }
  return { total, stores: byStore.size };
}

/** Delivery per store: only when every line's charge is known (uses the highest, assuming one shipment). */
function storeDelivery(cs: Choice[]): number | null {
  const ds = cs.map((c) => c.offer.deliveryCharge);
  if (ds.some((d) => d === null)) return null;
  return Math.max(...(ds as number[]));
}

const better = (a: { total: number; stores: number }, b: { total: number; stores: number }) =>
  a.total < b.total - 1e-9 || (Math.abs(a.total - b.total) < 1e-9 && a.stores < b.stores);

export function optimizeBasket(lines: BasketInputLine[]): BasketPlan {
  const caveats: string[] = [];
  const unresolved: string[] = [];
  const resolved: { query: string; qty: number; cands: Offer[] }[] = [];
  for (const l of lines) {
    const cands = l.offers.filter(isUsable);
    if (!cands.length) unresolved.push(l.query);
    else resolved.push({ query: l.query, qty: l.qty, cands });
  }

  let best: Choice[] = [];
  if (resolved.length) {
    // greedy start: cheapest per line
    best = resolved.map((r) => ({ query: r.query, qty: r.qty, offer: [...r.cands].sort((a, b) => a.price! - b.price!)[0] }));
    const space = resolved.reduce((p, r) => p * r.cands.length, 1);
    if (space <= 20000) {
      // exhaustive
      let bestCost = cost(best);
      const cur: Choice[] = [];
      const rec = (i: number) => {
        if (i === resolved.length) {
          const c = cost(cur);
          if (better(c, bestCost)) {
            bestCost = c;
            best = cur.map((x) => ({ ...x }));
          }
          return;
        }
        for (const o of resolved[i].cands) {
          cur[i] = { query: resolved[i].query, qty: resolved[i].qty, offer: o };
          rec(i + 1);
        }
      };
      rec(0);
    } else {
      // local search: re-pick each line's offer given others, until stable
      let improved = true;
      let guard = 0;
      while (improved && guard++ < 20) {
        improved = false;
        for (let i = 0; i < resolved.length; i++) {
          for (const o of resolved[i].cands) {
            const trial = best.map((c, j) => (j === i ? { ...c, offer: o } : c));
            if (better(cost(trial), cost(best))) {
              best = trial;
              improved = true;
            }
          }
        }
      }
      caveats.push("Basket was large; a near-optimal (not exhaustive) plan was used.");
    }
  }

  const byStore = new Map<RetailerId, Choice[]>();
  for (const c of best) byStore.set(c.offer.retailer, [...(byStore.get(c.offer.retailer) ?? []), c]);
  const stores: BasketPlan["stores"] = [...byStore.entries()].map(([retailer, cs]) => {
    const subtotal = cs.reduce((s, c) => s + c.offer.price! * c.qty, 0);
    const delivery = storeDelivery(cs);
    return {
      retailer,
      retailerName: cs[0].offer.retailerName,
      lines: cs.map((c) => ({ query: c.query, offer: c.offer, qty: c.qty })),
      subtotal,
      delivery,
      total: delivery === null ? null : subtotal + delivery,
    };
  });

  if (stores.some((s) => s.delivery === null)) caveats.push("Delivery charges are unknown for some stores and are not included; totals shown are item prices only.");
  if (unresolved.length) caveats.push(`No verified, confident, in-stock offer was found for: ${unresolved.join("; ")}.`);
  caveats.push("Prices are listed prices read from retailer pages; bank offers/coupons and final checkout price are not guaranteed.");
  if (stores.length > 1) caveats.push("Splitting across stores may add delivery charges or time not reflected here.");

  const totalVerified = stores.length
    ? stores.reduce((s, st) => s + (st.total ?? st.subtotal), 0)
    : null;
  return { stores, unresolved, totalVerified, caveats };
}
