import { describe, expect, it } from "vitest";
import { parseShopQuery, parseQueryAsync, convertAmounts, extractBudget } from "../parser";

type Row = [string, Record<string, unknown>];
const rows: Row[] = [
  ["Samsung Galaxy S24 256GB", { searchIntent: "EXACT_PRODUCT", brand: "Samsung", category: "smartphone" }],
  ["Best phone under 50000", { searchIntent: "PRODUCT_RECOMMENDATION", category: "smartphone", budgetMax: 50000 }],
  ["Gaming laptop RTX 4050 16GB RAM below 70000", { searchIntent: "FEATURE_SEARCH", category: "laptop", budgetMax: 70000 }],
  ["Best camera phone for travelling", { searchIntent: "PRODUCT_RECOMMENDATION", category: "smartphone", budgetMax: null }],
  ["Samsung S24 vs OnePlus 13", { searchIntent: "PRODUCT_COMPARISON", comparisonTargets: ["samsung galaxy s24", "oneplus 13"] }],
  ["I need a good laptop for coding, gaming and video editing under 80k", { searchIntent: "PRODUCT_RECOMMENDATION", category: "laptop", budgetMax: 80000 }],
  ["50 hazaar ke andar sabse accha phone", { searchIntent: "PRODUCT_RECOMMENDATION", category: "smartphone", budgetMax: 50000, language: "hinglish" }],
  ["sasta gaming laptop 70k tak", { category: "laptop", budgetMax: 70000, language: "hinglish", sortPreference: "price" }],
  ["samsng galxy s24", { searchIntent: "EXACT_PRODUCT", brand: "Samsung", category: "smartphone" }],
  ["best phone under 1.2 lakh", { budgetMax: 120000 }],
  ["laptop under 1 lakh", { budgetMax: 100000, category: "laptop" }],
  ["phone between 20000 and 30000", { budgetMin: 20000, budgetMax: 30000 }],
  ["phone around 30k", { budgetMin: 27000, budgetMax: 33000 }],
  ["phone below ₹25,000", { budgetMax: 25000 }],
  ["iPhone 15 128GB", { searchIntent: "EXACT_PRODUCT", brand: "Apple" }],
  ["OnePlus 13 12GB 256GB", { searchIntent: "EXACT_PRODUCT", brand: "OnePlus" }],
  ["best 5G phone upto 20000", { budgetMax: 20000, category: "smartphone" }],
  ["laptop with 16GB RAM and 512GB SSD under 60000", { searchIntent: "FEATURE_SEARCH", budgetMax: 60000 }],
  ["phone without amoled under 15000", { excludedFeatures: ["amoled"], budgetMax: 15000 }],
  ["WH-1000XM5", { searchIntent: "EXACT_PRODUCT" }],
  ["iphone 15 vs iphone 16", { searchIntent: "PRODUCT_COMPARISON" }],
  ["iphone 15 vs 16 pro", { searchIntent: "PRODUCT_COMPARISON", comparisonTargets: ["iphone 15", "iphone 16 pro"] }],
  ["macbook air m2", { searchIntent: "EXACT_PRODUCT", brand: "Apple", category: "laptop" }],
  ["best laptop for students under 50k", { searchIntent: "PRODUCT_RECOMMENDATION", budgetMax: 50000 }],
  ["suggest a phone with good battery", { searchIntent: "PRODUCT_RECOMMENDATION", category: "smartphone" }],
  ["60 hazaar tak laptop", { budgetMax: 60000, category: "laptop" }],
  ["mujhe 30 hazaar se kam mein achha phone chahiye", { budgetMax: 30000, category: "smartphone" }],
  ["rtx 4060 laptop", { searchIntent: "FEATURE_SEARCH", category: "laptop" }],
  ["4k tv under 40000", { budgetMax: 40000, category: "tv" }],
  ["lightweight laptop for travel under 70000", { preferredFeatures: ["lightweight", "travel"], budgetMax: 70000 }],
  ["samsung a55", { brand: "Samsung", searchIntent: "EXACT_PRODUCT" }],
  ["redmi note 13 pro 8gb 256gb", { searchIntent: "EXACT_PRODUCT", category: "smartphone" }],
  ["best phone under 40000 delivery to 560001", { deliveryPincode: "560001", budgetMax: 40000 }],
  ["pixel 8a", { searchIntent: "EXACT_PRODUCT", brand: "Google" }],
];

describe("parseShopQuery table", () => {
  for (const [q, exp] of rows) {
    it(q, () => {
      const p = parseShopQuery(q);
      for (const [k, v] of Object.entries(exp)) expect((p as unknown as Record<string, unknown>)[k], `${k} for "${q}" -> ${JSON.stringify(p)}`).toEqual(v);
    });
  }
});

describe("parser details", () => {
  it("variant extraction", () => {
    const p = parseShopQuery("Samsung Galaxy S24 256GB");
    expect(p.variant.storageGb).toBe(256);
    const l = parseShopQuery("Gaming laptop RTX 4050 16GB RAM below 70000");
    expect(l.variant.ramGb).toBe(16);
    expect(l.variant.gpu).toBe("RTX 4050");
    expect(parseShopQuery("phone 8/256gb").variant).toMatchObject({ ramGb: 8, storageGb: 256 });
  });
  it("records typo corrections", () => {
    const p = parseShopQuery("samsng galxy s24");
    expect(p.corrections).toEqual(expect.arrayContaining([{ from: "samsng", to: "samsung" }, { from: "galxy", to: "galaxy" }]));
    expect(p.normalized).toBe("samsung galaxy s24");
  });
  it("does not corrupt ordinary words", () => {
    expect(parseShopQuery("best nothing phone 2a").corrections).toEqual([]);
  });
  it("amount conversion", () => {
    expect(convertAmounts("under 50k")).toBe("under 50000");
    expect(convertAmounts("1.2 lakh")).toBe("120000");
    expect(convertAmounts("4k tv")).toBe("4k tv");
    expect(convertAmounts("under 2L")).toBe("under 200000");
    expect(convertAmounts("2 litre")).toBe("2 litre");
    expect(extractBudget("under 5 kg").max).toBeNull();
  });
  it("detects a validated retailer URL", () => {
    const p = parseShopQuery("https://www.amazon.in/Samsung-Galaxy-S24/dp/B0CQXXXXXX?tag=abc&ref=x");
    expect(p.searchIntent).toBe("PRODUCT_URL");
    expect(p.url).toBe("https://www.amazon.in/Samsung-Galaxy-S24/dp/B0CQXXXXXX");
  });
  it("rejects non-retailer URLs (no url set)", () => {
    const p = parseShopQuery("http://169.254.169.254/latest phone");
    expect(p.url).toBeNull();
    expect(p.searchIntent).not.toBe("PRODUCT_URL");
  });
  it("devanagari", () => {
    const p = parseShopQuery("50 हजार के अंदर सबसे अच्छा फोन");
    expect(p.budgetMax).toBe(50000);
    expect(p.category).toBe("smartphone");
    expect(p.language).toBe("hi");
  });
});

describe("LLM refinement", () => {
  const okFetch = (body: unknown) => (async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(body) }] }), { status: 200 })) as unknown as typeof fetch;
  it("is skipped without key or when confidence is high", async () => {
    let called = 0;
    const f = (async () => { called++; return new Response("{}"); }) as unknown as typeof fetch;
    await parseQueryAsync("Samsung Galaxy S24 256GB", { anthropicKey: "k", fetchImpl: f });
    await parseQueryAsync("something vague xyz", { fetchImpl: f });
    expect(called).toBe(0);
  });
  it("refines low-confidence queries and validates output", async () => {
    const good = { searchIntent: "PRODUCT_RECOMMENDATION", category: "tv", brand: null, model: null, budgetMin: null, budgetMax: 40000, preferredFeatures: [], excludedFeatures: [], comparisonTargets: [] };
    const p = await parseQueryAsync("something vague xyz", { anthropicKey: "k", fetchImpl: okFetch(good) });
    expect(p.source).toBe("llm");
    expect(p.category).toBe("tv");
    const bad = await parseQueryAsync("something vague xyz", { anthropicKey: "k", fetchImpl: okFetch({ searchIntent: "NOPE" }) });
    expect(bad.source).toBe("deterministic");
  });
  it("falls back on network failure", async () => {
    const f = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
    const p = await parseQueryAsync("something vague xyz", { anthropicKey: "k", fetchImpl: f });
    expect(p.source).toBe("deterministic");
  });
});
