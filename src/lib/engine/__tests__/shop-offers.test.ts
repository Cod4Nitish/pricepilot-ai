import { describe, expect, it } from "vitest";
import { buildDecision, normalizeShopWeights } from "../../shop/decision";
import { buildOffers } from "../../shop/offers";
import type { DeliveryInfo, ShopOffer } from "../../shop/types";
import type { Offer, SearchResponse } from "../../types";
import { ecom } from "../__fixtures__/offers";

const raw = (o: Partial<Offer> & { title: string; retailer: Offer["retailer"]; url: string; price: number | null }): Offer => ({
  id: o.url,
  retailerName: o.retailer,
  imageUrl: undefined,
  mrp: null,
  discountPct: null,
  deliveryCharge: null,
  availability: "in_stock",
  offers: [],
  spec: {},
  matchConfidence: 0.9,
  matchNotes: [],
  verification: "verified",
  checkedAt: "2025-11-01T00:00:00Z",
  ...o,
});
const sr = (offers: Offer[], excluded: Offer[] = []): SearchResponse => ({
  query: "q",
  parsed: { rawQuery: "q" },
  offers,
  excluded,
  statuses: [{ retailer: "flipkart", retailerName: "Flipkart", state: "ok", message: "ok", offerCount: 1 }],
  bestVerified: null,
  recommendation: { text: "", enoughEvidence: true, caveats: [] },
  runId: "r",
  generatedAt: "",
  cached: false,
});

describe("buildOffers", () => {
  const fk = raw({
    title: "Samsung Galaxy S24 5G (Cobalt Violet, 256 GB) (8 GB RAM)",
    retailer: "flipkart",
    url: "https://www.flipkart.com/s/p/itm1?pid=A1",
    price: 53199,
    mrp: 74999,
    imageUrl: "https://img/x.jpg",
    seller: "RetailNet",
    warranty: "1 Year Manufacturer Warranty",
    offers: ["10% instant discount up to Rs 3000 on HDFC Bank credit cards"],
  });
  const am = raw({ title: "Samsung Galaxy S24 5G (Marble Gray, 8GB, 256GB Storage)", retailer: "amazon", url: "https://www.amazon.in/dp/B0CMDRCZBH", price: 55999 });
  const ultra = raw({ title: "Samsung Galaxy S24 Ultra 5G 256 GB", retailer: "flipkart", url: "https://www.flipkart.com/u/p/itm2?pid=A2", price: 99999, matchConfidence: 0 });
  const run = (cards?: string[]) => buildOffers("Samsung Galaxy S24 256GB", { pincode: "560001", cards }, { search: async () => sr([fk, am], [ultra]) });

  it("returns verified matches with contract fields; variants excluded with reasons", async () => {
    const r = await run();
    expect(r.offers).toHaveLength(2);
    expect(r.excluded.map((e) => e.title)).toEqual(["Samsung Galaxy S24 Ultra 5G 256 GB"]);
    expect(r.excluded[0].reason).toMatch(/variant|Ultra/i);
    const f = r.offers.find((o) => o.retailer === "flipkart")!;
    expect(f).toMatchObject({ imageUrl: "https://img/x.jpg", mrp: 74999, seller: "RetailNet", warranty: "1 Year Manufacturer Warranty", returnPolicy: null });
    expect(f.discountPct).toBeCloseTo(29.1, 0);
    expect(f.delivery).toMatchObject({ kind: "not_verified", guaranteed: false, serviceable: null, etaDate: null, pincode: "560001" });
    expect(f.totalIsLowerBound).toBe(true); // shipping unknown is never 0
    const am2 = r.offers.find((o) => o.retailer === "amazon")!;
    expect(am2.discountPct).toBeNull();
    expect(r.statuses[0].source).toBe("flipkart");
  });
  it("conditional offers apply only when the user's card matches", async () => {
    const none = (await run()).offers.find((o) => o.retailer === "flipkart")!;
    expect(none.conditionalOffers.every((c) => !c.applied)).toBe(true);
    expect(none.effectiveTotal).toBe(53199);
    const hdfc = (await run(["HDFC credit card"])).offers.find((o) => o.retailer === "flipkart")!;
    expect(hdfc.conditionalOffers.some((c) => c.applied)).toBe(true);
    expect(hdfc.effectiveTotal).toBeLessThan(53199);
  });
});

const delivery = (o: Partial<DeliveryInfo> = {}): DeliveryInfo => ({ pincode: "560001", serviceable: null, kind: "not_verified", etaText: null, etaDate: null, etaDays: null, guaranteed: false, checkedAt: null, evidence: null, note: null, ...o });
const so = (retailer: string, price: number, extra: Partial<ShopOffer> = {}): ShopOffer => ({
  ...ecom({ productName: "Samsung Galaxy S24 5G 256 GB", retailer, listedPrice: price, sourceUrl: `https://${retailer}.example/p/1`, shippingFee: null }),
  imageUrl: null,
  mrp: null,
  discountPct: null,
  seller: null,
  warranty: null,
  returnPolicy: null,
  conditionalOffers: [],
  effectiveTotal: price,
  totalIsLowerBound: true,
  delivery: delivery(),
  ...extra,
});
const est = (etaDate: string, etaDays: number, etaText = "x") => delivery({ kind: "published_estimate", etaText, etaDate, etaDays });

describe("buildDecision", () => {
  it("empty and single-store cases", () => {
    expect(buildDecision([]).cheapestListed).toBeNull();
    const d = buildDecision([so("amazon", 100)]);
    expect(d.singleStoreOnly).toBe(true);
    expect(d.cheapestListed?.offerId).toBe("https://amazon.example/p/1");
    expect(d.notes.join(" ")).toMatch(/Only one store/);
  });
  it("cheapest listed among verified matches; unverified, out of stock and low-confidence are excluded", () => {
    const d = buildDecision([
      so("a", 50000, { verificationStatus: "unverified" }),
      so("b", 51000, { stockStatus: "out_of_stock" }),
      so("c", 52000, { matchingConfidence: 0.5 }),
      so("d", 60000),
      so("e", 58000, { verificationStatus: "agent_verified" }),
    ]);
    expect(d.cheapestListed).toMatchObject({ retailer: "e", value: 58000 });
    expect(d.singleStoreOnly).toBe(false);
  });
  it("cheapest payable null with a note while fees are unknown; chosen only among fully-known totals", () => {
    const unknown = buildDecision([so("a", 100), so("b", 120)]);
    expect(unknown.cheapestPayable).toBeNull();
    expect(unknown.notes.join(" ")).toMatch(/payable/i);
    const known = buildDecision([so("a", 100, { totalIsLowerBound: true }), so("b", 120, { totalIsLowerBound: false, effectiveTotal: 120 })]);
    expect(known.cheapestPayable).toMatchObject({ retailer: "b", value: 120 });
  });
  it("fastest uses published estimates only", () => {
    const none = buildDecision([so("a", 100), so("b", 120)]);
    expect(none.fastest).toBeNull();
    expect(none.notes.join(" ")).toMatch(/Fastest/);
    const d = buildDecision([
      so("a", 100, { delivery: est("2025-11-06", 5, "Delivery by 6 Nov") }),
      so("b", 120, { delivery: est("2025-11-02", 1, "Tomorrow, 2 Nov") }),
      so("c", 90, { delivery: delivery({ kind: "error" }) }),
    ]);
    expect(d.fastest).toMatchObject({ retailer: "b", value: "Tomorrow, 2 Nov" });
    expect(d.fastest?.conditions.join(" ")).toMatch(/not guaranteed/);
  });
  it("best overall: redistributes missing delivery weight and says so; no unconditional winner", () => {
    const d = buildDecision([so("a", 100), so("b", 200)], { price: 1, delivery: 1, evidence: 0 });
    expect(d.bestOverall?.retailer).toBe("a");
    expect(d.notes.join(" ")).toMatch(/redistributed/);
    expect(d.notes.join(" ")).toMatch(/No unconditional winner/);
    expect(d.bestOverall?.conditions.join(" ")).toMatch(/Delivery speed was not compared/);
  });
  it("weights shift the winner when delivery is known", () => {
    const offers = [so("cheap", 100, { delivery: est("2025-11-10", 9) }), so("fast", 110, { delivery: est("2025-11-02", 1) })];
    expect(buildDecision(offers, { price: 1, delivery: 0, evidence: 0 }).bestOverall?.retailer).toBe("cheap");
    expect(buildDecision(offers, { price: 0, delivery: 1, evidence: 0 }).bestOverall?.retailer).toBe("fast");
    expect(buildDecision(offers, { price: 0, delivery: 1, evidence: 0 }).notes.join(" ")).not.toMatch(/redistributed/);
  });
  it("is deterministic and normalizes weights", () => {
    const o = [so("a", 100), so("b", 100)];
    expect(JSON.stringify(buildDecision(o))).toBe(JSON.stringify(buildDecision([...o].reverse())));
    const w = normalizeShopWeights({ price: 2, delivery: 1, evidence: 1 });
    expect(w.price + w.delivery + w.evidence).toBeCloseTo(1);
    expect(normalizeShopWeights({ price: 0, delivery: 0, evidence: 0 }).price).toBeCloseTo(0.6);
  });
});
