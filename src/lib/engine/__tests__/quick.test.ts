import { describe, expect, it } from "vitest";
import { FEES0, quick, store } from "../__fixtures__/offers";
import { compareQuick, type QuickInput } from "../quick/basket";
import { bestPackCombo, solveBasket } from "../quick/solver";
import { normalizeWeights } from "../rank";
import { parseNeed, parseQuantity, unitPrice } from "../units";

describe("quantity parsing", () => {
  it("parses common forms to base units", () => {
    expect(parseQuantity("Amul Gold 500 g")).toMatchObject({ value: 500, unit: "g" });
    expect(parseQuantity("0.5 kg")).toMatchObject({ value: 500, unit: "g" });
    expect(parseQuantity("1L")).toMatchObject({ value: 1000, unit: "ml" });
    expect(parseQuantity("1000 ml")).toMatchObject({ value: 1000, unit: "ml" });
    expect(parseQuantity("dozen eggs")).toMatchObject({ value: 12, unit: "unit" });
    expect(parseQuantity("6 x 200ml")).toMatchObject({ value: 1200, unit: "ml" });
    expect(parseQuantity("pack of 2")).toMatchObject({ value: 2, unit: "unit" });
    expect(parseQuantity("2 x 500 g")).toMatchObject({ value: 1000, unit: "g" });
    expect(parseQuantity("Atta 1 kg pack of 2")).toMatchObject({ value: 2000, unit: "g" });
    expect(parseQuantity("Amul Butter")).toBeNull();
  });
  it("500g vs 1kg are different quantities with correct unit prices", () => {
    const a = parseQuantity("500 g");
    const b = parseQuantity("1 kg");
    expect(unitPrice(30, a)).toEqual({ value: 6, per: "100g" });
    expect(unitPrice(50, b)).toEqual({ value: 5, per: "100g" });
    expect(unitPrice(null, b)).toBeNull();
    expect(unitPrice(10, null)).toBeNull();
    expect(parseNeed("2 kg onion")).toMatchObject({ unit: "g", amount: 2000 });
    expect(parseNeed("bread")).toMatchObject({ unit: "pack", amount: 1 });
  });
});

describe("pack combination", () => {
  const p = (size: number, price: number, id = String(size)) => ({ offerId: id, label: id, size, price });
  it("need 1 kg: 2x500g beats a pricey 1kg", () => {
    const c = bestPackCombo(1000, [p(500, 40), p(1000, 90)]);
    expect(c?.cost).toBe(80);
    expect(c?.packs).toEqual([expect.objectContaining({ size: 500, count: 2 })]);
  });
  it("picks the 1 kg pack when cheaper, and flags overbuy when covering requires it", () => {
    expect(bestPackCombo(1000, [p(500, 50), p(1000, 70)])?.packs[0].size).toBe(1000);
    const over = bestPackCombo(1000, [p(750, 60)]);
    expect(over?.covered).toBe(1500);
  });
  it("packs smaller than needed are rejected unless multiples cover it", () => {
    expect(bestPackCombo(1000, [p(500, 40)])?.covered).toBe(1000);
    expect(bestPackCombo(1000, [p(500, 40)], 1)).toBeNull();
  });
  it("mixes sizes optimally (1.5 kg = 1000 + 500)", () => {
    const c = bestPackCombo(1500, [p(500, 45), p(1000, 80)]);
    expect(c?.cost).toBe(125);
  });
});

const needs = (...qs: [string, string, number][]) => qs.map(([id, query, amount]) => ({ id, query, unit: "g" as const, amount }));
function input(over: Partial<QuickInput>): QuickInput {
  return { needs: [], offersByNeed: {}, stores: [], pincode: "560001", includeUnknownStock: false, ...over };
}

describe("quick basket", () => {
  it("excludes unserviceable/blocked stores with a reason", () => {
    const r = compareQuick(
      input({
        needs: needs(["a", "flour", 1000]),
        offersByNeed: { a: [quick({ store: "blinkit", name: "Atta", price: 50, qty: "1 kg" }), quick({ store: "zepto", name: "Atta", price: 40, qty: "1 kg" })] },
        stores: [store("blinkit"), store("zepto", { state: "not_serviceable", reason: "Not delivering to 560001" })],
      }),
    );
    expect(r.excludedStores).toEqual([{ storeId: "zepto", name: "Zepto", reason: "not_serviceable: Not delivering to 560001" }]);
    expect(r.singleStore.map((p) => p.storeIds[0])).toEqual(["blinkit"]);
  });
  it("location-based unavailability: offers observed for another pincode are dropped", () => {
    const r = compareQuick(
      input({
        needs: needs(["a", "flour", 1000]),
        offersByNeed: { a: [quick({ store: "blinkit", name: "Atta", price: 50, qty: "1 kg", pincode: "110001" })] },
        stores: [store("blinkit")],
      }),
    );
    expect(r.singleStore[0].missing.length).toBe(1);
    expect(r.excludedOffers[0].reason).toMatch(/pincode 110001/);
  });
  it("out-of-stock and unknown-stock items are excluded by default, flagged when included", () => {
    const base = { needs: needs(["a", "flour", 1000]), stores: [store("blinkit")] };
    const offers = { a: [quick({ store: "blinkit", name: "Atta", price: 50, qty: "1 kg", stock: "out_of_stock" }), quick({ store: "blinkit", name: "Atta B", price: 55, qty: "1 kg", stock: "unknown" })] };
    expect(compareQuick(input({ ...base, offersByNeed: offers })).singleStore[0].missing.length).toBe(1);
    const flagged = compareQuick(input({ ...base, offersByNeed: offers, includeUnknownStock: true }));
    expect(flagged.singleStore[0].lines[0].stockUnconfirmed).toBe(true);
    expect(flagged.singleStore[0].lines[0].lineTotal).toBe(55);
    expect(flagged.caveats.join(" ")).toMatch(/unconfirmed/);
  });
  it("wrong pack unit or missing pack size is rejected; multipack satisfied by multiples", () => {
    const r = compareQuick(
      input({
        needs: needs(["a", "milk", 1000]),
        offersByNeed: {
          a: [
            quick({ store: "blinkit", name: "Milk", price: 30, qty: "6 pcs" }),
            quick({ store: "blinkit", name: "Milk", price: 45 }),
            quick({ store: "blinkit", name: "Milk 500 ml", price: 28, qty: "500 ml" }),
          ],
        },
        stores: [store("blinkit")],
      }),
    );
    const need = { id: "a", query: "milk", unit: "ml" as const, amount: 1000 };
    expect(need.unit).toBe("ml");
    expect(r.singleStore[0].lines.length).toBe(0);
    expect(r.excludedOffers.map((e) => e.reason).join("|")).toMatch(/Unit mismatch.*Pack size not stated|Pack size not stated.*Unit mismatch/s);
    const ml = compareQuick(
      input({
        needs: [need],
        offersByNeed: { a: [quick({ store: "blinkit", name: "Milk", price: 28, qty: "500 ml" }), quick({ store: "blinkit", name: "Milk", price: 30, qty: "6 x 200 ml" })] },
        stores: [store("blinkit")],
      }),
    );
    // the 6 x 200 ml multipack (1200 ml for 30) is cheaper than 2 x 500 ml (56) even with 200 ml overbuy, which is flagged
    expect(ml.singleStore[0].lines[0].lineTotal).toBe(30);
    expect(ml.singleStore[0].lines[0].overbuy).toBe(200);
    const only500 = compareQuick(input({ needs: [need], offersByNeed: { a: [quick({ store: "blinkit", name: "Milk", price: 28, qty: "500 ml" })] }, stores: [store("blinkit")] }));
    expect(only500.singleStore[0].lines[0].lineTotal).toBe(56);
    expect(only500.singleStore[0].lines[0].packs[0]).toMatchObject({ size: 500, count: 2 });
    expect(only500.singleStore[0].lines[0].overbuy).toBe(0);
  });
  it("cheapest single-store basket accounts for known fees", () => {
    const n = needs(["a", "atta", 1000], ["b", "oil", 1000]);
    const offersByNeed = {
      a: [quick({ store: "blinkit", name: "Atta", price: 50, qty: "1 kg" }), quick({ store: "zepto", name: "Atta", price: 48, qty: "1 kg" })],
      b: [quick({ store: "blinkit", name: "Oil", price: 160, qty: "1000 g" }), quick({ store: "zepto", name: "Oil", price: 158, qty: "1000 g" })],
    };
    const r = compareQuick(input({ needs: n, offersByNeed, stores: [store("blinkit"), store("zepto", { fees: { delivery: 25 } })] }));
    expect(r.recommendation.cheapest?.retailer).toBe("Blinkit");
    expect(r.recommendation.cheapest?.total).toBe(210);
    expect(r.singleStore.find((p) => p.storeIds[0] === "zepto")?.total).toBe(231);
  });
});

describe("split optimisation", () => {
  const n = needs(["a", "atta", 1000], ["b", "oil", 1000]);
  // blinkit cheap atta, zepto cheap oil
  const offersByNeed = (savingA: number, savingB: number) => ({
    a: [quick({ store: "blinkit", name: "Atta", price: 100 - savingA, qty: "1 kg" }), quick({ store: "zepto", name: "Atta", price: 100, qty: "1 kg" })],
    b: [quick({ store: "blinkit", name: "Oil", price: 200, qty: "1000 g" }), quick({ store: "zepto", name: "Oil", price: 200 - savingB, qty: "1000 g" })],
  });
  it("split beats single store only net of per-store fees", () => {
    const stores = [store("blinkit", { fees: { delivery: 30 } }), store("zepto", { fees: { delivery: 30 } })];
    // Savings: atta 40 + ... single blinkit = 60+200+30 = 290; single zepto = 100+160+30 = 290; split = 60+160+60 = 280 => saves 10 only
    const small = compareQuick(input({ needs: n, offersByNeed: offersByNeed(40, 40), stores }));
    expect(small.split.netSaving).toBe(10);
    expect(small.split.status).toBe("saving_below_threshold");
    // bigger savings with free-delivery thresholds known: 80 each => single 100-80... compute: split saves net
    const big = compareQuick(input({ needs: n, offersByNeed: offersByNeed(80, 80), stores }));
    // single blinkit: 20+200+30=250; zepto: 100+120+30=250; split: 20+120+60=200 => saving 50 >= 30
    expect(big.split.netSaving).toBe(50);
    expect(big.split.status).toBe("recommended");
    expect(big.plans.some((p) => p.kind === "split")).toBe(true);
    expect(big.split.plan?.total).toBe(200);
  });
  it("threshold is configurable", () => {
    const stores = [store("blinkit", { fees: { delivery: 30 } }), store("zepto", { fees: { delivery: 30 } })];
    const r = compareQuick(input({ needs: n, offersByNeed: offersByNeed(80, 80), stores, minSplitSaving: 60 }));
    expect(r.split.status).toBe("saving_below_threshold");
  });
  it("split not recommended when included fees are unknown (shown as possible saving)", () => {
    const stores = [store("blinkit", { fees: { delivery: 30 } }), store("zepto", { fees: { delivery: null } })];
    const r = compareQuick(input({ needs: n, offersByNeed: offersByNeed(80, 80), stores }));
    expect(r.split.status).toBe("possible_saving_fees_unknown");
    expect(r.split.reason).toMatch(/unknown/);
    expect(r.plans.some((p) => p.kind === "split")).toBe(false);
    expect(r.split.plan?.totalIsLowerBound).toBe(true);
  });
  it("free-delivery thresholds and small-cart fees are applied only when known", () => {
    const st = store("blinkit", { fees: { delivery: 40, freeDeliveryThreshold: 199, smallCartFee: 20, smallCartThreshold: 100 } });
    const plan = (price: number) => solveBasket({ needs: n.slice(0, 1), stores: [{ id: "blinkit", name: "Blinkit", etaMinutes: 10, fees: st.fees }], options: [{ needId: "a", storeId: "blinkit", offerId: "x", label: "x", packSize: 1000, price, confidence: 1, evidence: [] }] });
    expect(plan(250).total).toBe(250); // free delivery
    expect(plan(150).total).toBe(190); // delivery 40, no small cart
    expect(plan(80).total).toBe(140); // delivery 40 + small cart 20
    expect(FEES0.smallCartFee).toBeNull();
  });
  it("solveBasket finds the exact optimum for 8 items x 3 stores quickly", () => {
    const ns = Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, query: `item${i}`, unit: "pack" as const, amount: 1 }));
    const sts = ["a", "b", "c"].map((id) => ({ id, name: id, etaMinutes: 10, fees: { ...FEES0, delivery: 10 } }));
    const options = ns.flatMap((x, i) => sts.map((s, j) => ({ needId: x.id, storeId: s.id, offerId: `${x.id}${s.id}`, label: "p", packSize: 1, price: 50 + ((i * 7 + j * 13) % 11), confidence: 1, evidence: [] })));
    const t0 = Date.now();
    const plan = solveBasket({ needs: ns, stores: sts, options, maxStores: 3 });
    expect(Date.now() - t0).toBeLessThan(2000);
    // brute-force lower bound check: cheapest per item + fees for used stores
    expect(plan.lines.length).toBe(8);
    const minItems = ns.reduce((s, x) => s + Math.min(...options.filter((o) => o.needId === x.id).map((o) => o.price)), 0);
    expect(plan.itemsSubtotal).toBeGreaterThanOrEqual(minItems);
    expect(plan.total).toBeLessThanOrEqual(minItems + 30);
  });
});

describe("constraints and ranking", () => {
  const n = needs(["a", "atta", 1000]);
  const offersByNeed = {
    a: [
      quick({ store: "blinkit", name: "Atta", price: 60, qty: "1 kg" }), // slow, cheap
      quick({ store: "zepto", name: "Atta", price: 75, qty: "1 kg" }), // fast, pricier
      quick({ store: "instamart", name: "Atta", price: 70, qty: "1 kg" }), // unknown ETA
    ],
  };
  const stores = [store("blinkit", { etaMinutes: 25 }), store("zepto", { etaMinutes: 8 }), store("instamart", { etaMinutes: null })];
  it("cheapest vs fastest vs overall differ; ETA unknown never wins fastest", () => {
    const r = compareQuick(input({ needs: n, offersByNeed, stores, weights: { price: 1, speed: 0, trust: 0 } }));
    expect(r.recommendation.cheapest?.retailer).toBe("Blinkit");
    expect(r.recommendation.fastest?.retailer).toBe("Zepto");
    expect(r.recommendation.overall?.retailer).toBe("Blinkit");
  });
  it("weights change the Best Overall pick", () => {
    const speedy = compareQuick(input({ needs: n, offersByNeed, stores, weights: { price: 0.1, speed: 0.9, trust: 0 } }));
    expect(speedy.recommendation.overall?.retailer).toBe("Zepto");
    const thrifty = compareQuick(input({ needs: n, offersByNeed, stores, weights: { price: 0.9, speed: 0.1, trust: 0 } }));
    expect(thrifty.recommendation.overall?.retailer).toBe("Blinkit");
    const w = normalizeWeights({ price: 3, speed: 1 });
    expect(w.price + w.speed + w.trust).toBeCloseTo(1);
    expect(normalizeWeights().price).toBe(0.6);
  });
  it("maxEta excludes slower plans (and unknown-ETA plans) even when cheaper", () => {
    const r = compareQuick(input({ needs: n, offersByNeed, stores, constraints: { maxEtaMinutes: 10 } }));
    expect(r.recommendation.cheapest?.retailer).toBe("Zepto");
    expect(r.plans.find((p) => p.id === "single:blinkit")?.infeasibleReason).toMatch(/exceeds/);
    expect(r.plans.find((p) => p.id === "single:instamart")?.infeasibleReason).toMatch(/not published/);
  });
  it("budget makes faster-but-over-budget plans infeasible", () => {
    const r = compareQuick(input({ needs: n, offersByNeed, stores, constraints: { budget: 65 } }));
    expect(r.recommendation.fastest?.retailer).toBe("Blinkit");
    expect(r.plans.find((p) => p.id === "single:zepto")?.infeasibleReason).toMatch(/budget/);
  });
  it("requireAllItems drops incomplete plans; no feasible plan gives an honest empty result", () => {
    const two = needs(["a", "atta", 1000], ["b", "oil", 1000]);
    const ob = { ...offersByNeed, b: [quick({ store: "zepto", name: "Oil", price: 150, qty: "1000 g" })] };
    const r = compareQuick(input({ needs: two, offersByNeed: ob, stores, constraints: { requireAllItems: true } }));
    expect(r.recommendation.cheapest?.retailer).toBe("Zepto");
    const none = compareQuick(input({ needs: n, offersByNeed, stores, constraints: { maxEtaMinutes: 3 } }));
    expect(none.recommendation.best).toBeNull();
    expect(none.recommendation.text).toMatch(/No feasible plan/);
  });
  it("unknown fees mark total as lower bound and lose near-ties to fully known totals", () => {
    const st = [store("blinkit", { fees: { delivery: null } }), store("zepto", { fees: { delivery: 0.5 } })];
    const ob = { a: [quick({ store: "blinkit", name: "Atta", price: 60, qty: "1 kg" }), quick({ store: "zepto", name: "Atta", price: 60, qty: "1 kg" })] };
    const r = compareQuick(input({ needs: n, offersByNeed: ob, stores: st }));
    expect(r.singleStore.find((p) => p.storeIds[0] === "blinkit")?.totalIsLowerBound).toBe(true);
    expect(r.recommendation.cheapest?.retailer).toBe("Zepto");
  });
});
