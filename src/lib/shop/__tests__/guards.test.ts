import { beforeEach, describe, expect, it } from "vitest";
import { clearShopCache, runShop, type ShopDeps } from "../pipeline";
import { gamingMismatch, guardMedian, guardOffers, lookupQuery } from "../discovery/group";
import { smartphoneConfig, scoreCoverage } from "../categories";
import type { Decision, ShopOffer, SpecFact } from "../types";

function offer(retailer: string, price: number | null, extra: Partial<ShopOffer> = {}): ShopOffer {
  return {
    productId: "p", productName: "Prod", brand: null,
    variant: { storageGb: 256, ramGb: 8, color: null, size: null, condition: "new", pack: null },
    unitQuantity: null, retailer, commerceMode: "ecommerce", sourceUrl: `https://${retailer}.example/p/${price}`, locationId: null,
    listedPrice: price, mrp: null, shippingFee: null, handlingFee: null, platformFee: null, eligibleDiscount: null, conditionalDiscounts: [],
    stockStatus: "in_stock", deliveryEtaMinutes: null, observedAt: "2026-01-01T00:00:00Z", verificationStatus: "verified", matchingConfidence: 0.9, evidence: [],
    imageUrl: null, seller: null, warranty: null, returnPolicy: null, conditionalOffers: [], effectiveTotal: price, totalIsLowerBound: false, discountPct: null,
    delivery: { pincode: null, serviceable: null, kind: "not_verified", etaText: null, etaDate: null, etaDays: null, guaranteed: false, checkedAt: null, evidence: null, note: null },
    ...extra,
  } as unknown as ShopOffer;
}
const dec = (): Decision => ({ cheapestListed: null, cheapestPayable: null, fastest: null, bestOverall: null, notes: [], singleStoreOnly: false });

function deps(page: string, offersFor: (q: string) => ShopOffer[], queries: string[] = []): ShopDeps {
  return {
    anthropicKey: null, noCache: true,
    tracker: { id: "run_guard_1", step: () => {}, finish: async () => {} },
    search: async (p) => ({ query: p.query, total_results: 1, page: 0, results: [{ position: 1, site_name: "s", title: "t", snippet: "", url: "https://review.example/best" }] }),
    fetchPages: async (p) => ({ results: p.urls.map((u) => ({ url: u, text: page })), errors: [] }),
    buildDecision: dec,
    buildOffers: async (q) => { queries.push(q); return { offers: offersFor(q), excluded: [], statuses: [] }; },
  };
}
beforeEach(() => clearShopCache());

describe("price plausibility guards", () => {
  it("(a) drops prices below 35% of the median when >= 3 offers", () => {
    const r = guardMedian([offer("a", 274), offer("b", 30000), offer("c", 31000), offer("d", 32000)]);
    expect(r.offers.map((o) => o.listedPrice)).toEqual([30000, 31000, 32000]);
    expect(r.notes[0]).toMatch(/median/);
    expect(guardMedian([offer("a", 274), offer("b", 30000)]).offers).toHaveLength(2); // < 3 offers: untouched
  });
  it("(b) drops offers below 40% of editorial price", () => {
    const r = guardOffers([offer("a", 12000), offer("b", 38000)], { category: "laptop", editorialPrice: 39999 });
    expect(r.offers.map((o) => o.listedPrice)).toEqual([38000]);
  });
  it("(c) smartphone floor: < 4000 dropped when other prices exceed 10000", () => {
    const r = guardOffers([offer("a", 3199), offer("b", 28000)], { category: "smartphone", editorialPrice: null });
    expect(r.offers.map((o) => o.listedPrice)).toEqual([28000]);
    // cheap phone category with only cheap prices is not touched
    expect(guardOffers([offer("a", 3199)], { category: "smartphone", editorialPrice: null }).offers).toHaveLength(1);
  });
  it("candidate with only implausible offers is dropped, never shown", async () => {
    const page = `## 1. Poco X8 Pro\n- 6000 mAh battery\n- 120Hz AMOLED display\n- Snapdragon 7 Gen 3 chipset\n- 50MP main camera\nPrice: ₹27,999\n${"filler text ".repeat(40)}`;
    const r = await runShop({ query: "best phone under 50000" }, deps(page, () => [offer("amazon", 274)]));
    expect(r.groups).toEqual([]);
    expect(r.summary).toMatch(/implausible|no verified store price/);
  });
});

describe("score honesty", () => {
  const f = (key: string, value: string | number): SpecFact => ({ key, label: key, value, sourceUrl: "u", evidence: String(value) });
  it("display + price only => total null (coverage < 50%)", () => {
    const w = smartphoneConfig.weightsFor({ preferredFeatures: [] });
    const s = smartphoneConfig.score([f("refresh_hz", 120), f("display_type", "AMOLED")], { price: 20000, priceRef: 50000, weights: w });
    expect(s.total).toBeNull();
    expect(s.provisional).toBe(true);
    expect(scoreCoverage(s)).toBeLessThan(0.5);
  });
  it("unscored candidates never outrank a scored one; ranked by coverage then price", async () => {
    const page = [
      "## 1. Poco X8 Pro", "- 120Hz AMOLED display", "Price: ₹20,000",
      "## 2. Samsung Galaxy A55", "- Exynos 1480 processor", "- 5000 mAh battery", "- 120Hz Super AMOLED display", "- 50MP main camera", "- Snapdragon 7 Gen 3 chipset", "- 5 years of updates", "Price: ₹34,999",
      "## 3. Vivo V50", "- 90Hz AMOLED display", "Price: ₹30,000",
      "filler text ".repeat(40),
    ].join("\n");
    const r = await runShop({ query: "best phone under 50000" }, deps(page, () => [offer("amazon", 25000), offer("flipkart", 26000)]));
    expect(r.groups[0].name).toBe("Samsung Galaxy A55");
    expect(r.groups[0].score?.total).not.toBeNull();
    const unscored = r.groups.filter((g) => g.score?.total === null);
    expect(unscored.length).toBeGreaterThan(0);
    expect(r.groups.indexOf(unscored[0])).toBeGreaterThan(0);
    expect(r.summary).toMatch(/too little evidence for an overall score/);
    expect(unscored[0].why.join(" ")).toMatch(/Too little evidence/);
  });
});

describe("laptop discovery guards", () => {
  it("lookupQuery strips part numbers and years, adds only evidenced GPU", () => {
    expect(lookupQuery("MSI Katana 15 B13UDXK-1482IN", "RTX 4050")).toEqual({ query: "MSI Katana 15 RTX 4050", partNumbers: ["B13UDXK-1482IN"] });
    expect(lookupQuery("Asus Gaming V16 2025 V3607VU-RP550WS", "RTX 4050").query).toBe("Asus Gaming V16 RTX 4050");
    expect(lookupQuery("Asus Gaming V16", null).query).toBe("Asus Gaming V16"); // GPU not evidenced => not claimed
    expect(lookupQuery("Lenovo LOQ 15 RTX 4050", "RTX 4050").query).toBe("Lenovo LOQ 15 RTX 4050");
  });
  it("gamingMismatch: workstation dropped, GPU or gaming evidence kept", () => {
    const gpu = (v: string) => ({ key: "gpu", value: v, evidence: v });
    expect(gamingMismatch({ name: "HP ZBook Power G11", specs: [gpu("RTX 2000")] })).toMatch(/workstation/);
    expect(gamingMismatch({ name: "MSI Katana 15", specs: [gpu("RTX 4050")] })).toBeNull();
    expect(gamingMismatch({ name: "Asus Gaming V16", specs: [] })).toBeNull();
    expect(gamingMismatch({ name: "Dell Inspiron 15", specs: [gpu("Iris Xe")] })).toMatch(/no evidence/);
  });
  const PAGE = [
    "## 1. MSI Katana 15 B13UDXK-1482IN", "- Core i7-13620H processor", "- RTX 4050 graphics", "- 16GB RAM", "- 512GB SSD", "- 144Hz display", "Price: ₹69,990",
    "## 2. HP ZBook Power G11", "- Core i7-13700H", "- RTX 4050 graphics", "- 16GB RAM", "- 512GB SSD", "Price: ₹69,000",
    "## 3. Dell Inspiron 15", "- Core i5-1335U processor", "- 16GB RAM", "- 512GB SSD", "Price: ₹55,000",
    "filler text ".repeat(40),
  ].join("\n");
  it("end to end: part number not sent to retailers, workstation and non-gaming dropped with reasons", async () => {
    const queries: string[] = [];
    const r = await runShop({ query: "Gaming laptop RTX 4050 under 70000" }, deps(PAGE, () => [offer("amazon", 66000, { variant: { storageGb: 512, ramGb: 16, color: null, size: null, condition: "new", pack: null } }), offer("flipkart", 67000, { variant: { storageGb: 512, ramGb: 16, color: null, size: null, condition: "new", pack: null } })], queries));
    expect(r.parsed.searchIntent).toBe("FEATURE_SEARCH");
    expect(queries.some((q) => q.includes("B13UDXK"))).toBe(false);
    expect(queries.some((q) => q.startsWith("MSI Katana 15 RTX 4050"))).toBe(true);
    expect(r.groups.map((g) => g.name)).toEqual(["MSI Katana 15 B13UDXK-1482IN"]);
    expect(r.summary).toMatch(/HP ZBook Power G11: workstation laptop/);
    expect(r.summary).toMatch(/Dell Inspiron 15: no evidence of a dedicated gaming GPU/);
  });
  it("unknown GPU is kept as provisional and never claimed to be RTX 4050", async () => {
    const page = ["## 1. Asus Gaming V16 2025", "- Core i7-13650HX processor", "- 16GB RAM", "- 512GB SSD", "- 144Hz display", "Price: ₹69,990", "filler text ".repeat(40)].join("\n");
    const queries: string[] = [];
    const r = await runShop({ query: "Gaming laptop RTX 4050 under 70000" }, deps(page, () => [offer("amazon", 66000, { variant: { storageGb: 512, ramGb: 16, color: null, size: null, condition: "new", pack: null } })], queries));
    expect(queries.some((q) => /RTX/i.test(q))).toBe(false);
    const g = r.groups[0];
    expect(g.provisional).toBe(true);
    expect(g.variant.gpu).toBeNull();
    expect(g.why.join(" ")).toMatch(/Not confirmed by sources: RTX 4050 or better/);
  });
});
