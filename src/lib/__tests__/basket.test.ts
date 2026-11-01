import { describe, expect, it } from "vitest";
import { optimizeBasket } from "../basket";
import type { Offer, RetailerId } from "../types";

function offer(retailer: RetailerId, price: number | null, extra: Partial<Offer> = {}): Offer {
  return {
    id: `${retailer}-${price}`,
    retailer,
    retailerName: retailer,
    title: "t",
    url: `https://x/${retailer}`,
    price,
    mrp: null,
    discountPct: null,
    deliveryCharge: null,
    availability: "in_stock",
    offers: [],
    spec: {},
    matchConfidence: 0.9,
    matchNotes: [],
    verification: "verified",
    checkedAt: new Date().toISOString(),
    ...extra,
  };
}

describe("optimizeBasket", () => {
  it("picks cheapest verified offer per line and flags unknown delivery", () => {
    const plan = optimizeBasket([
      { query: "a", qty: 2, offers: [offer("amazon", 100), offer("flipkart", 90)] },
      { query: "b", qty: 1, offers: [offer("amazon", 50)] },
    ]);
    expect(plan.totalVerified).toBe(2 * 90 + 50);
    expect(plan.stores).toHaveLength(2);
    expect(plan.stores.every((s) => s.total === null)).toBe(true);
    expect(plan.caveats.join(" ")).toMatch(/Delivery charges are unknown/);
  });

  it("uses known delivery charges to consolidate stores", () => {
    const plan = optimizeBasket([
      { query: "a", qty: 1, offers: [offer("amazon", 105, { deliveryCharge: 0 }), offer("flipkart", 100, { deliveryCharge: 40 })] },
      { query: "b", qty: 1, offers: [offer("amazon", 105, { deliveryCharge: 0 }), offer("flipkart", 100, { deliveryCharge: 40 })] },
    ]);
    // all flipkart: 200 + 40 = 240; all amazon: 210
    expect(plan.stores).toHaveLength(1);
    expect(plan.stores[0].retailer).toBe("amazon");
    expect(plan.totalVerified).toBe(210);
  });

  it("ignores unverified, low-confidence, out-of-stock offers and reports unresolved", () => {
    const plan = optimizeBasket([
      { query: "a", qty: 1, offers: [offer("amazon", 10, { verification: "snippet_only" }), offer("croma", 11, { matchConfidence: 0.6 }), offer("flipkart", 12, { availability: "out_of_stock" })] },
      { query: "b", qty: 1, offers: [offer("amazon", null)] },
    ]);
    expect(plan.stores).toHaveLength(0);
    expect(plan.unresolved).toEqual(["a", "b"]);
    expect(plan.totalVerified).toBeNull();
  });
});
