import { describe, expect, it } from "vitest";
import { fastOffer, line, providerResult, rawOffer, searchResponse } from "../__fixtures__/offers";
import { runEngine, understand, type Collectors } from "../orchestrator";

const phone = (retailer: "amazon" | "flipkart" | "croma", price: number | null, title = "Apple iPhone 15 (128 GB) Black", extra = {}) => rawOffer({ title, retailer, price, ...extra });

function collectors(over: Partial<Collectors> = {}): Collectors {
  return {
    ecommerce: async () => searchResponse([phone("amazon", 60000), phone("flipkart", 59000, "Apple iPhone 15 (256 GB) Black")]),
    quick: async (_p, queries) => ({
      results: [
        providerResult("blinkit", queries.map((q) => line(q, fastOffer({ providerId: "blinkit", query: q, title: "Amul Toned Milk", price: 30, packLabel: "500 ml" })))),
      ],
      failures: [],
    }),
    ...over,
  };
}
const run = (text: string, c: Collectors, extra = {}) => runEngine({ text, ...extra }, { collectors: c, cache: null });

describe("understanding", () => {
  it("extracts pincode, budget, urgency and routes items", () => {
    const u = understand({ text: "iphone 15 128gb under 70000, 1 kg atta and milk 500 ml deliver in 10 min to 560001" });
    expect(u.pincode).toBe("560001");
    expect(u.pincodeSource).toBe("text");
    expect(u.budget).toBe(70000);
    expect(u.maxEtaMinutes).toBe(10);
    expect(u.urgent).toBe(true);
    expect(u.items.map((i) => i.route)).toContain("ecommerce");
    expect(u.items.map((i) => i.route)).toContain("quick");
    expect(u.weightsUsed.speed).toBeGreaterThan(0.25);
  });
  it("explicit weights are normalised and not overridden by urgency", () => {
    const u = understand({ text: "milk today", pincode: "560001", weights: { price: 2, speed: 1, trust: 1 } });
    expect(u.weightsUsed.price).toBeCloseTo(0.5);
    expect(u.pincodeSource).toBe("explicit_input");
  });
});

describe("engine", () => {
  it("ecommerce: eliminates incompatible variants and recommends the matching verified offer", async () => {
    const r = await run("iphone 15 128gb", collectors());
    const item = r.perItem[0];
    expect(item.route).toBe("ecommerce");
    expect(item.recommendation.cheapest?.retailer).toBe("amazon");
    expect(item.excluded.map((x) => x.offer.retailer)).toEqual(["flipkart"]);
    expect(r.statuses.some((s) => s.source.startsWith("ecommerce:amazon") && s.state === "ok")).toBe(true);
    expect(r.runId).toBeTruthy();
  });
  it("quick: builds per-item and basket plans, requires pincode", async () => {
    const r = await run("500 ml milk", collectors(), { pincode: "560001" });
    expect(r.perItem[0].route).toBe("quick");
    expect(r.baskets?.singleStore[0].total).toBe(30);
    expect(r.perItem[0].recommendation.cheapest?.retailer).toBe("blinkit");
    const noPin = await run("500 ml milk", collectors());
    expect(noPin.statuses.find((s) => s.source === "quick")?.state).toBe("skipped");
    expect(noPin.baskets).toBeUndefined();
    expect(noPin.perItem[0].recommendation.enoughEvidence).toBe(false);
  });
  it("partial failure: a throwing e-commerce collector does not lose quick results", async () => {
    const r = await run("iphone 15 128gb and 500 ml milk and 1 kg atta", collectors({ ecommerce: async () => { throw new Error("TinyFish timeout"); } }), { pincode: "560001" });
    const ecomStatus = r.statuses.find((s) => s.state === "failed" && s.source.startsWith("ecommerce"));
    expect(ecomStatus?.message).toMatch(/timeout/);
    expect(r.perItem.find((p) => p.route === "quick")?.recommendation.cheapest).not.toBeNull();
    expect(r.perItem.find((p) => p.route === "ecommerce")?.recommendation.enoughEvidence).toBe(false);
  });
  it("partial failure: quick collector throws, e-commerce still returned", async () => {
    const r = await run("iphone 15 128gb and 500 ml milk and 1 kg atta", collectors({ quick: async () => { throw new Error("agent crashed"); } }), { pincode: "560001" });
    expect(r.statuses.find((s) => s.source === "quick")?.state).toBe("failed");
    expect(r.perItem.find((p) => p.route === "ecommerce")?.recommendation.cheapest?.retailer).toBe("amazon");
  });
  it("partial failure: one quick provider fails, another succeeds", async () => {
    const c = collectors({
      quick: async (_p, queries) => ({
        results: [
          providerResult("blinkit", queries.map((q) => line(q, fastOffer({ providerId: "blinkit", query: q, title: "Milk", price: 30, packLabel: "500 ml" })))),
          providerResult("zepto", [], { state: "not_serviceable", reason: "No service at pincode" }),
        ],
        failures: [{ providerId: "instamart", message: "captcha" }],
      }),
    });
    const r = await run("500 ml milk", c, { pincode: "560001" });
    expect(r.statuses.find((s) => s.source === "quick:zepto")?.state).toBe("unavailable");
    expect(r.statuses.find((s) => s.source === "quick:instamart")?.state).toBe("failed");
    expect(r.baskets?.excludedStores.map((s) => s.storeId)).toContain("zepto");
    expect(r.baskets?.singleStore.length).toBe(1);
  });
  it("quick fees unknown => lower bound, and never invented as zero", async () => {
    const c = collectors({
      quick: async (_p, qs) => ({ results: [providerResult("blinkit", qs.map((q) => line(q, fastOffer({ providerId: "blinkit", query: q, title: "Milk", price: 30, packLabel: "500 ml" }))), { fees: { delivery: null, handling: null, platform: null, discount: null, evidence: null } })], failures: [] }),
    });
    const r = await run("500 ml milk", c, { pincode: "560001" });
    expect(r.baskets?.singleStore[0].totalIsLowerBound).toBe(true);
    expect(r.baskets?.singleStore[0].unknownComponents.length).toBe(3);
  });
  it("both-route: no cross-mode verdict when quantities are not comparable", async () => {
    const c = collectors({
      ecommerce: async () => searchResponse([rawOffer({ title: "Duracell CR2032 Lithium Coin Battery Pack of 10", retailer: "amazon", price: 450 })]),
      quick: async (_p, qs) => ({ results: [providerResult("blinkit", qs.map((q) => line(q, fastOffer({ providerId: "blinkit", query: q, title: "Duracell CR2032 Lithium Coin Battery", price: 120, packLabel: "4 units" }))))], failures: [] }),
    });
    const r = await run("duracell cr2032 battery", c, { pincode: "560001" });
    expect(r.perItem[0].route).toBe("both");
    expect(r.perItem[0].crossMode?.comparable).toBe(false);
    expect(r.perItem[0].recommendation.best).toBeNull();
  });
  it("both-route: cross-mode compared only when identical verified quantity", async () => {
    const c = collectors({
      ecommerce: async () => searchResponse([rawOffer({ title: "Duracell CR2032 Lithium Battery 4 pcs", retailer: "amazon", price: 450 })]),
      quick: async (_p, qs) => ({ results: [providerResult("blinkit", qs.map((q) => line(q, fastOffer({ providerId: "blinkit", query: q, title: "Duracell CR2032 Lithium Coin Battery", price: 520, packLabel: "4 units" }))))], failures: [] }),
    });
    const r = await run("duracell cr2032 battery 4 pcs", c, { pincode: "560001" });
    expect(r.perItem[0].crossMode?.comparable).toBe(true);
    expect(r.perItem[0].crossMode?.winner).toBe("ecommerce");
    expect(r.perItem[0].recommendation.cheapest?.commerceMode).toBe("ecommerce");
  });
  it("uses the cache when provided", async () => {
    let calls = 0;
    const c = collectors({ ecommerce: async () => { calls++; return searchResponse([phone("amazon", 60000)]); } });
    const { TtlCache } = await import("../../cache");
    const cache = new TtlCache<unknown>(60_000);
    await runEngine({ text: "iphone 15 128gb" }, { collectors: c, cache });
    await runEngine({ text: "iphone 15 128gb" }, { collectors: c, cache });
    expect(calls).toBe(1);
  });
});
