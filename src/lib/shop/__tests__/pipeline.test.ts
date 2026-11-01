import { beforeEach, describe, expect, it } from "vitest";
import { clearShopCache, runShop, queryFromProductUrl, type ShopDeps } from "../pipeline";
import { verifyFacts, evidenceInPage } from "../discovery/evidence";
import { extractWithLlm } from "../discovery/extract";
import { smartphoneConfig, laptopConfig } from "../categories";
import type { Decision, ShopOffer, SpecFact } from "../types";

const URL1 = "https://www.gsmarena.com/best-phones.php";
const PAGE = `# Best phones under 40000 in India

Our picks for the best phones this year, with full specifications and pricing details for each model.

## 1. OnePlus 13R
- 5G connectivity, Snapdragon 8 Gen 3 chipset
- 6000 mAh battery with fast charging
- 6.78-inch 120Hz AMOLED display
- 50MP main camera
- 12GB RAM and 256GB storage
Price: ₹39,999

## 2. Samsung Galaxy A55
- Exynos 1480 processor
- 5000 mAh battery
- 120Hz Super AMOLED display
- 50MP main camera
Price: ₹34,999

## 3. Realme GT 7 Pro
- Snapdragon 8 Elite chipset
- 6500 mAh battery
- 120Hz AMOLED display
- 50MP main camera
Price: ₹59,999
`;

function offer(retailer: string, price: number | null, extra: Partial<ShopOffer> = {}): ShopOffer {
  return {
    productId: "p", productName: "Prod", brand: null,
    variant: { storageGb: 256, ramGb: 12, color: null, size: null, condition: "new", pack: null },
    unitQuantity: null, retailer, commerceMode: "ecommerce", sourceUrl: `https://${retailer}.example/p/${price}`, locationId: null,
    listedPrice: price, mrp: null, shippingFee: null, handlingFee: null, platformFee: null, eligibleDiscount: null, conditionalDiscounts: [],
    stockStatus: "in_stock", deliveryEtaMinutes: null, observedAt: "2026-01-01T00:00:00Z", verificationStatus: "verified", matchingConfidence: 0.9, evidence: [],
    imageUrl: null, seller: null, warranty: null, returnPolicy: null, conditionalOffers: [], effectiveTotal: price, totalIsLowerBound: false, discountPct: null, mrp2: undefined,
    delivery: { pincode: null, serviceable: null, kind: "not_verified", etaText: null, etaDate: null, etaDays: null, guaranteed: false, checkedAt: null, evidence: null, note: null },
    ...extra,
  } as unknown as ShopOffer;
}

const decisionOf = (offers: ShopOffer[]): Decision => {
  const low = [...offers].sort((a, b) => (a.listedPrice ?? 0) - (b.listedPrice ?? 0))[0];
  return { cheapestListed: low ? { offerId: "hash-" + low.retailer, retailer: low.retailer, value: low.listedPrice, reasons: [], conditions: [], evidence: [] } : null, cheapestPayable: null, fastest: null, bestOverall: null, notes: [], singleStoreOnly: false };
};

function mkDeps(over: Partial<ShopDeps> & { offersFor?: (q: string) => ShopOffer[] } = {}) {
  const steps: string[] = [];
  const queries: string[] = [];
  const deps: ShopDeps = {
    anthropicKey: null,
    noCache: true,
    tracker: { id: "run_test_1", step: (l) => { steps.push(l); }, finish: async () => {} },
    search: async (p) => { queries.push(p.query); return { query: p.query, total_results: 1, page: 0, results: [{ position: 1, site_name: "gsmarena", title: "Best phones", snippet: "", url: URL1 }] }; },
    fetchPages: async (p) => ({ results: p.urls.map((u) => ({ url: u, text: PAGE })), errors: [] }),
    buildDecision: (offers) => decisionOf(offers),
    buildOffers: async (q) => {
      const offers = (over.offersFor ?? (() => [offer("amazon", 38000), offer("flipkart", 37500)]))(q);
      return { offers, excluded: [], statuses: [{ source: "amazon", state: offers.length ? "ok" : "no_results", message: "ok" }] };
    },
    ...over,
  };
  delete (deps as { offersFor?: unknown }).offersFor;
  return { deps, steps, queries };
}

beforeEach(() => clearShopCache());

describe("scoring: evidence only", () => {
  const f = (key: string, value: string | number): SpecFact => ({ key, label: key, value, sourceUrl: "u", evidence: String(value) });
  it("missing specs => null components, provisional, no guessing", () => {
    const s = smartphoneConfig.score([f("battery_mah", 5000)], { price: null, priceRef: null, weights: smartphoneConfig.weightsFor({ preferredFeatures: [] }) });
    expect(s.components.find((c) => c.name === "battery")?.score).toBeCloseTo((5000 - 3000) / 3500, 3);
    expect(s.components.find((c) => c.name === "performance")?.score).toBeNull();
    expect(s.missing).toEqual(expect.arrayContaining(["performance", "camera", "display", "software", "price"]));
    expect(s.provisional).toBe(true);
    expect(s.total).not.toBeNull();
  });
  it("unknown chipset is not guessed", () => {
    const s = smartphoneConfig.score([f("chipset", "Helio G99 Ultra")], { price: null, priceRef: null, weights: smartphoneConfig.weightsFor({ preferredFeatures: [] }) });
    expect(s.components.find((c) => c.name === "performance")?.score).toBeNull();
    expect(s.total).toBeNull();
  });
  it("known chipset tier is used and total renormalizes over available components", () => {
    const w = smartphoneConfig.weightsFor({ preferredFeatures: [] });
    const s = smartphoneConfig.score([f("chipset", "Snapdragon 8 Gen 3"), f("battery_mah", 6500)], { price: null, priceRef: null, weights: w });
    const expected = ((w.performance * 0.9 + w.battery * 1) / (w.performance + w.battery)) * 100;
    expect(s.total).toBeCloseTo(expected, 0);
  });
  it("feature preference reweights components", () => {
    const base = smartphoneConfig.weightsFor({ preferredFeatures: [] });
    const cam = smartphoneConfig.weightsFor({ preferredFeatures: ["camera"] });
    expect(cam.camera).toBeGreaterThan(base.camera);
    expect(Object.values(cam).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
  it("laptop tiers and a complete spec set is not provisional", () => {
    const specs = [f("cpu", "Core i7-13650HX"), f("gpu", "RTX 4060"), f("ram_gb", 16), f("storage_gb", 512), f("refresh_hz", 144), f("display_type", "IPS"), f("battery_wh", 70), f("weight_kg", 2.2), f("ram_upgradable", "yes")];
    const s = laptopConfig.score(specs, { price: 70000, priceRef: 80000, weights: laptopConfig.weightsFor({ preferredFeatures: ["gaming"] }) });
    expect(s.missing).toEqual([]);
    expect(s.provisional).toBe(false);
  });
  it("RTX requirement fails a weaker GPU, passes better, unknown stays unknown", () => {
    const parsed = { variant: { gpu: "RTX 4050", ramGb: null, storageGb: null }, budgetMax: null, budgetMin: null, preferredFeatures: [], excludedFeatures: [] } as never;
    const c = laptopConfig.constraints(parsed)[0];
    expect(c.check({ specs: [f("gpu", "RTX 3050")], price: null }, true)).toBe("fail");
    expect(c.check({ specs: [f("gpu", "RTX 4060")], price: null }, true)).toBe("pass");
    expect(c.check({ specs: [], price: null }, true)).toBe("unknown");
  });
});

describe("evidence verification", () => {
  const pages = new Map([[URL1, "The phone packs a **5000 mAh**  battery and a 120Hz display."]]);
  const keys = new Set(["battery_mah", "refresh_hz"]);
  it("normalizes whitespace, case and markdown", () => {
    expect(evidenceInPage("5000 MAH battery", pages.get(URL1) as string)).toBe(true);
  });
  it("drops hallucinated evidence, wrong sources, wrong values and unknown keys", () => {
    const facts: SpecFact[] = [
      { key: "battery_mah", label: "b", value: 5000, sourceUrl: URL1, evidence: "5000 mAh battery" },
      { key: "refresh_hz", label: "r", value: 144, sourceUrl: URL1, evidence: "144Hz display" }, // not in page
      { key: "battery_mah", label: "b", value: 6000, sourceUrl: URL1, evidence: "5000 mAh battery" }, // value not in evidence
      { key: "battery_mah", label: "b", value: 5000, sourceUrl: "https://other.example", evidence: "5000 mAh battery" }, // wrong source
      { key: "weird", label: "w", value: 1, sourceUrl: URL1, evidence: "120Hz display" }, // key not allowed
    ];
    const r = verifyFacts(facts, pages, keys);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped).toBe(4);
  });
  it("LLM candidates: unverifiable facts and unmentioned candidates are dropped", async () => {
    const out = {
      candidates: [
        { name: "OnePlus 13R", price_inr: 39999, price_evidence: "Price: ₹39,999", price_source_url: URL1, specs: [
          { key: "battery_mah", value: 6000, sourceUrl: URL1, evidence: "6000 mAh battery" },
          { key: "chipset", value: "Snapdragon 8 Gen 5", sourceUrl: URL1, evidence: "Snapdragon 8 Gen 5 chipset" }, // hallucinated
        ] },
        { name: "Fakephone X9", specs: [{ key: "battery_mah", value: 9000, sourceUrl: URL1, evidence: "9000 mAh" }] },
      ],
    };
    const r = await extractWithLlm([{ url: URL1, title: "", text: PAGE }], smartphoneConfig, async () => JSON.stringify(out), { categoryLabel: "smartphone" });
    expect(r.ok).toBe(true);
    expect(r.candidates.map((c) => c.name)).toEqual(["OnePlus 13R"]);
    expect(r.candidates[0].specs.map((s) => s.key)).toEqual(["battery_mah"]);
    expect(r.candidates[0].price?.price).toBe(39999);
    expect(r.droppedFacts).toBe(1);
    expect(r.droppedCandidates).toBe(1);
  });
});

describe("runShop: recommendation", () => {
  it("finds, constrains by budget, scores and returns evidence-backed groups with real steps", async () => {
    const { deps, steps, queries } = mkDeps();
    const r = await runShop({ query: "best 5G phone under 40000" }, deps);
    expect(queries.some((q) => /best smartphones under 40000 India/.test(q))).toBe(true);
    expect(r.parsed.searchIntent).toBe("PRODUCT_RECOMMENDATION");
    // Realme GT 7 Pro (evidence price 59,999) violates budget by a wide margin: excluded before offers
    expect(r.groups.map((g) => g.name)).toEqual(expect.arrayContaining(["OnePlus 13R", "Samsung Galaxy A55"]));
    expect(r.groups.map((g) => g.name)).not.toContain("Realme GT 7 Pro");
    for (const g of r.groups) {
      expect(g.specs.every((s) => s.evidence && s.sourceUrl)).toBe(true);
      expect(g.why.some((w) => w.includes("source:"))).toBe(true);
      expect(g.score?.total).not.toBeNull();
      expect(g.comparable).toBe(true);
    }
    expect(r.groups.map((g) => g.rank)).toEqual(r.groups.map((_, i) => i + 1));
    expect(r.statuses.map((s) => s.source)).toEqual(expect.arrayContaining(["discovery:search", "discovery:fetch", "discovery:llm", "amazon"]));
    expect(r.statuses.find((s) => s.source === "discovery:llm")?.state).toBe("skipped");
    expect(r.weights).toEqual({ price: 0.5, delivery: 0.25, evidence: 0.25 });
    expect(r.runId).toBe("run_test_1");
    expect(steps[0]).toMatch(/^Query parsed/);
    expect(steps.some((s) => /Discovery search finished: 1 pages found/.test(s))).toBe(true);
    expect(steps.some((s) => /Offers for OnePlus 13R/.test(s))).toBe(true);
  });

  it("Pick.offerId is normalized to the offer sourceUrl", async () => {
    const { deps } = mkDeps();
    const r = await runShop({ query: "best phone under 40000" }, deps);
    for (const g of r.groups) {
      const urls = g.offers.map((o) => o.sourceUrl);
      expect(urls).toContain(g.decision.cheapestListed?.offerId);
    }
  });

  it("drops candidates whose verified lowest price violates the budget", async () => {
    const { deps } = mkDeps({ offersFor: (q) => (q.includes("A55") ? [offer("amazon", 42000)] : [offer("amazon", 38000), offer("flipkart", 39000)]) });
    const r = await runShop({ query: "best phone under 40000" }, deps);
    expect(r.groups.map((g) => g.name)).toEqual(["OnePlus 13R"]);
    expect(r.summary).toMatch(/outside your budget/);
  });

  it("single verified store => note and singleStoreOnly", async () => {
    const { deps } = mkDeps({ offersFor: () => [offer("amazon", 38000)] });
    const r = await runShop({ query: "best phone under 40000" }, deps);
    expect(r.groups.length).toBeGreaterThan(0);
    for (const g of r.groups) {
      expect(g.decision.singleStoreOnly).toBe(true);
      expect(g.decision.notes).toContain("Multi-store comparison is not possible yet: only one verified store offer was found.");
      expect(g.comparable).toBe(false);
    }
  });

  it("never mixes variants: keeps the dominant variant bucket", async () => {
    const v = (ram: number, sto: number) => ({ variant: { storageGb: sto, ramGb: ram, color: null, size: null, condition: "new", pack: null } }) as Partial<ShopOffer>;
    const { deps } = mkDeps({ offersFor: () => [offer("amazon", 36000, v(8, 128)), offer("flipkart", 37000, v(12, 256)), offer("croma", 37500, v(12, 256))] });
    const r = await runShop({ query: "best phone under 40000" }, deps);
    const g = r.groups[0];
    expect(g.offers.map((o) => o.variant.storageGb)).toEqual([256, 256]);
    expect(g.lowestVerified?.price).toBe(37000);
    expect(g.why.join(" ")).toMatch(/other variants were excluded/);
  });

  it("zero results gives an emptyReason, no fabricated groups", async () => {
    const { deps } = mkDeps({ search: async (p) => ({ query: p.query, results: [], total_results: 0, page: 0 }) });
    const r = await runShop({ query: "best phone under 40000" }, deps);
    expect(r.groups).toEqual([]);
    expect(r.emptyReason).toBeTruthy();
    expect(r.statuses.find((s) => s.source === "discovery:search")?.state).toBe("no_results");
  });

  it("all candidates without verified offers => empty with reason", async () => {
    const { deps } = mkDeps({ offersFor: () => [] });
    const r = await runShop({ query: "best phone under 40000" }, deps);
    expect(r.groups).toEqual([]);
    expect(r.emptyReason).toMatch(/verified store price/);
  });

  it("partial failure: one offer lookup throws, others still returned", async () => {
    const { deps } = mkDeps();
    const orig = deps.buildOffers!;
    deps.buildOffers = async (q, c) => { if (q.includes("A55")) throw new Error("boom"); return orig(q, c); };
    const r = await runShop({ query: "best phone under 40000" }, deps);
    expect(r.groups.map((g) => g.name)).toEqual(["OnePlus 13R"]);
    expect(r.statuses.some((s) => s.source === "retailers" && s.state === "error")).toBe(true);
  });

  it("search provider failure becomes an honest status", async () => {
    const { deps } = mkDeps({ search: async () => { throw new Error("down"); } });
    const r = await runShop({ query: "best phone under 40000" }, deps);
    expect(r.groups).toEqual([]);
    expect(r.statuses.find((s) => s.source === "discovery:search")?.state).toBe("error");
  });

  it("budget hard-constraint on required RAM filters candidates with contradicting evidence", async () => {
    const { deps } = mkDeps();
    const r = await runShop({ query: "phone with 16GB RAM under 50000" }, deps);
    // OnePlus 13R lists 12GB RAM in evidence => fails 16GB requirement
    expect(r.groups.map((g) => g.name)).not.toContain("OnePlus 13R");
  });

  it("caches results for identical requests", async () => {
    const { deps } = mkDeps({ noCache: false });
    const a = await runShop({ query: "best phone under 40000" }, deps);
    const b = await runShop({ query: "best phone under 40000" }, deps);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
  });

  it("sorts by price when asked", async () => {
    const { deps } = mkDeps({ offersFor: (q) => (q.includes("A55") ? [offer("amazon", 30000), offer("flipkart", 31000)] : [offer("amazon", 38000), offer("flipkart", 39000)]) });
    const r = await runShop({ query: "best phone under 40000", sort: "price" }, deps);
    expect(r.groups.map((g) => g.lowestVerified?.price)).toEqual([30000, 38000]);
    expect(r.groups.map((g) => g.rank)).toEqual([1, 2]);
  });

  it("unsupported category does not guess", async () => {
    const { deps } = mkDeps();
    const r = await runShop({ query: "best tv under 40000" }, deps);
    expect(r.groups).toEqual([]);
    expect(r.emptyReason).toMatch(/smartphones and laptops/);
  });
});

describe("runShop: pincode validation", () => {
  it.each(["12345", "012345", "abcdef", "1234567"])("rejects %s", async (pin) => {
    const { deps, queries } = mkDeps();
    const r = await runShop({ query: "Samsung Galaxy S24 256GB", pincode: pin }, deps);
    expect(r.emptyReason).toMatch(/Invalid pincode/);
    expect(r.groups).toEqual([]);
    expect(queries).toEqual([]);
  });
});

describe("runShop: exact + url", () => {
  it("exact product returns one group and passes pincode/cards through", async () => {
    let ctxSeen: unknown;
    const { deps } = mkDeps();
    deps.buildOffers = async (q, c) => { ctxSeen = { q, c }; return { offers: [offer("amazon", 60000, { productName: "Samsung Galaxy S24 5G 256GB" }), offer("flipkart", 59000)], excluded: [], statuses: [] }; };
    const r = await runShop({ query: "Samsung Galaxy S24 256GB", pincode: "560001", cards: ["HDFC"] }, deps);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].name).toBe("Samsung Galaxy S24 5G 256GB");
    expect(r.groups[0].lowestVerified).toEqual({ price: 59000, retailer: "flipkart" });
    expect((ctxSeen as { q: string; c: { pincode: string; cards: string[] } }).q).toBe("samsung galaxy s24 256gb");
    expect((ctxSeen as { c: { pincode: string; cards: string[] } }).c).toMatchObject({ pincode: "560001", cards: ["HDFC"] });
  });

  it("exact with no offers => emptyReason", async () => {
    const { deps } = mkDeps({ offersFor: () => [] });
    const r = await runShop({ query: "Samsung Galaxy S24 256GB" }, deps);
    expect(r.groups).toEqual([]);
    expect(r.emptyReason).toMatch(/No verified store offers/);
  });

  it("product URL is mapped to a name query", async () => {
    expect(queryFromProductUrl("https://www.amazon.in/Samsung-Galaxy-S24-5G-Onyx/dp/B0CQXXXXXX")).toBe("Samsung Galaxy S24 5G Onyx");
    expect(queryFromProductUrl("https://www.amazon.in/dp/B0CQXXXXXX")).toBeNull();
    const { deps } = mkDeps();
    const r = await runShop({ query: "https://www.amazon.in/dp/B0CQXXXXXX" }, deps);
    expect(r.parsed.searchIntent).toBe("PRODUCT_URL");
    expect(r.emptyReason).toMatch(/Could not identify the product/);
  });

  it("offer module unavailable yields an honest status, not data", async () => {
    const { deps } = mkDeps();
    deps.buildOffers = undefined;
    // real module may or may not exist yet; with a failing lookup we still must not fabricate
    deps.buildOffers = async () => { throw new Error("x"); };
    const r = await runShop({ query: "Samsung Galaxy S24 256GB" }, deps);
    expect(r.groups).toEqual([]);
    expect(r.statuses.some((s) => s.state === "error")).toBe(true);
  });
});

describe("runShop: comparison", () => {
  const pageFor = (u: string) => (u.includes("a") ? "" : "");
  void pageFor;
  const SPEC_A = "Samsung Galaxy S24 specifications: 4000 mAh battery, 120Hz Dynamic AMOLED 2X display, 50MP main camera, 8GB RAM. " + "x".repeat(300);
  const SPEC_B = "OnePlus 13 specifications: 6000 mAh battery, 120Hz LTPO AMOLED display, 50MP main camera. " + "y".repeat(300);

  it("table contains only specs present with evidence on BOTH sides", async () => {
    const { deps } = mkDeps({
      search: async (p) => ({ query: p.query, total_results: 1, page: 0, results: [{ position: 1, site_name: "s", title: "t", snippet: "", url: p.query.toLowerCase().includes("oneplus") ? "https://spec.example/b" : "https://spec.example/a" }] }),
      fetchPages: async (p) => ({ results: p.urls.map((u) => ({ url: u, text: u.endsWith("/a") ? SPEC_A : SPEC_B })), errors: [] }),
    });
    const r = await runShop({ query: "Samsung S24 vs OnePlus 13" }, deps);
    expect(r.parsed.searchIntent).toBe("PRODUCT_COMPARISON");
    expect(r.comparison?.sides).toEqual(["samsung galaxy s24", "oneplus 13"]);
    const keys = r.comparison?.table.map((t) => t.key) ?? [];
    expect(keys).toEqual(expect.arrayContaining(["battery_mah", "refresh_hz", "camera_main_mp", "display_type"]));
    expect(keys).not.toContain("ram_gb"); // only side A has RAM evidence
    expect(r.comparison?.table.find((t) => t.key === "battery_mah")?.values).toEqual(["4000 mAh", "6000 mAh"]);
    expect(r.groups).toHaveLength(2);
    for (const g of r.groups) expect(g.decision).toBeTruthy();
  });

  it("no shared evidence => no table rows, flagged provisional", async () => {
    const { deps } = mkDeps({ fetchPages: async (p) => ({ results: p.urls.map((u) => ({ url: u, text: "nothing useful here. ".repeat(30) })), errors: [] }) });
    const r = await runShop({ query: "Samsung S24 vs OnePlus 13" }, deps);
    expect(r.comparison?.table).toEqual([]);
    expect(r.recommendationProvisional).toBe(true);
    expect(r.summary).toMatch(/no spec table/);
  });
});
