import { describe, expect, it } from "vitest";
import { clearSearchCache, searchProducts, richerTitle, unwrapAgentResult, type Deps } from "../../search";
import { runEngine } from "../orchestrator";
import { cleanOffers } from "../ecommerce/dedupe";
import { ecom } from "../__fixtures__/offers";
import { parseEcomQuery } from "../ecommerce/entity";
import { validate } from "../ecommerce/resolve";

const FK1 = "https://www.flipkart.com/samsung-galaxy-s24-5g-cobalt-violet-256-gb/p/itm1111aaaa?pid=MOBGX1111AAAA";
const FK1_DUP = "https://www.flipkart.com/samsung-galaxy-s24-5g/p/itm1111aaaa?pid=MOBGX1111AAAA&lid=LSTxyz&marketplace=FLIPKART";
const FK2 = "https://www.flipkart.com/samsung-galaxy-s24-exynos-5g-amber-yellow-256-gb/p/itm2222bbbb?pid=MOBGX2222BBBB";
const FK_ULTRA = "https://www.flipkart.com/samsung-galaxy-s24-ultra-5g-256-gb/p/itm3333cccc?pid=MOBGX3333CCCC";
const FK_128 = "https://www.flipkart.com/samsung-galaxy-s24-5g-onyx-black-128-gb/p/itm4444dddd?pid=MOBGX4444DDDD";
const FK_REF = "https://www.flipkart.com/samsung-galaxy-s24-5g-256-gb-refurbished/p/itm5555eeee?pid=MOBGX5555EEEE";
const AMZ = "https://www.amazon.in/Samsung-Galaxy-S24-Marble-Storage/dp/B0CMDRCZBH";
const AMZ_JUNK1 = "https://www.amazon.in/gp/product/B0CMDRCZBH?ref_=widget";
const AMZ_JUNK2 = "https://www.amazon.in/dp/B0CJUNK001";
const CROMA = "https://www.croma.com/samsung-galaxy-s24-5g-8gb-ram-256gb-onyx-black-/p/309451";

const flipkartPage = (title: string, price: string) =>
  `# ${title}\n${price} ~~₹74,999~~ 29% off\nAdd to cart\nBuy Now\n7 Days Replacement Policy\n1 Year Manufacturer Warranty for handset\n## Similar Products\nSamsung Galaxy A15 Sold Out\nNotify Me`;

function deps(): Deps & { agentCalls: string[] } {
  const agentCalls: string[] = [];
  const titles: Record<string, { site: string; list: { title: string; url: string }[] }> = {
    "flipkart.com": {
      site: "Flipkart",
      list: [
        { title: "Samsung Galaxy S24 5G (Cobalt Violet, 256 GB) (8 GB RAM)", url: FK1 },
        { title: "Samsung Galaxy S24 5G (Cobalt Violet, 256 GB) (8 GB RAM)", url: FK1_DUP },
        { title: "Samsung Galaxy S24 Exynos 5G (Amber Yellow, 256 GB) (8 GB RAM)", url: FK2 },
        { title: "Samsung Galaxy S24 Ultra 5G (Titanium Black, 256 GB)", url: FK_ULTRA },
        { title: "Samsung Galaxy S24 5G (Onyx Black, 128 GB) (8 GB RAM)", url: FK_128 },
        { title: "Samsung Galaxy S24 5G (256 GB) (8 GB RAM) Refurbished", url: FK_REF },
      ],
    },
    "amazon.in": {
      site: "Amazon",
      list: [
        { title: "Samsung Galaxy S24 5G (Marble Gray, 8GB, 256GB Storage)", url: AMZ },
        { title: "Add to your order", url: AMZ_JUNK1 },
        { title: "Add to your order", url: AMZ_JUNK2 },
      ],
    },
    "croma.com": { site: "Croma", list: [{ title: "Buy SAMSUNG Galaxy S24 5G (8GB RAM, 256GB, Onyx Black) Online", url: CROMA }] },
  };
  return {
    agentCalls,
    search: async ({ includeDomains }) => {
      const t = titles[includeDomains?.[0] ?? ""];
      return { query: "q", page: 0, total_results: 0, results: (t?.list ?? []).map((x, i) => ({ position: i + 1, site_name: t.site, title: x.title, snippet: "", url: x.url })) };
    },
    fetchPages: async ({ urls }) => ({
      results: urls
        .filter((u) => u !== FK_ULTRA)
        .map((u) => ({
          url: u,
          text: u.includes("flipkart") && u.includes("itm1111")
            ? flipkartPage("Samsung Galaxy S24 5G (Cobalt Violet, 256 GB) (8 GB RAM)", "₹53,199")
            : u.includes("flipkart")
              ? flipkartPage("Samsung Galaxy S24 Exynos 5G (Amber Yellow, 256 GB) (8 GB RAM)", "₹54,499")
              : u.includes("amazon")
                ? "# Samsung Galaxy S24 5G (Marble Gray, 8GB, 256GB Storage)\n-26% ₹55,999\nM.R.P.: ₹74,999\nAdd to cart\nIn stock"
                : "# Croma\nLoading...",
        })),
      errors: [],
    }),
    runAgent: async ({ url }) => {
      agentCalls.push(url);
      return { runId: "r", status: "COMPLETED", result: { result: { title: "SAMSUNG Galaxy S24 5G (8GB RAM, 256GB, Onyx Black)", price: "₹54,990", mrp: 74999, availability: "in_stock", deliveryText: "Delivery by 5 Nov" } } };
    },
  };
}

describe("S24 256GB regression (exact match must reach 'match' and be recommendable)", () => {
  it("recommends the verified Flipkart price, filters junk, dedupes, keeps variants out", async () => {
    clearSearchCache();
    const d = deps();
    // target 3 retailers so the adaptive router still sends the agent to Croma (with the default target of 2 it stops early)
    process.env.PP_TARGET_VERIFIED_RETAILERS = "3";
    const eng = await runEngine({ text: "Samsung Galaxy S24 256GB" }, { cache: null, collectors: { ecommerce: (q) => searchProducts(q, { deps: d, persist: false, skipCache: true }), quick: async () => ({ results: [], failures: [] }) } }).finally(() => {
      delete process.env.PP_TARGET_VERIFIED_RETAILERS;
    });
    const item = eng.perItem[0];
    expect(item.recommendation.enoughEvidence).toBe(true);
    expect(item.recommendation.cheapest?.retailer).toBe("flipkart");
    expect(item.recommendation.cheapest?.total).toBe(53199);
    const entries = item.ecommerce!.entries;
    expect(entries.every((e) => e.decision === "match" && e.confidence >= 0.8)).toBe(true);
    // Flipkart dup collapsed: 2 unique Flipkart + Amazon + Croma
    expect(entries.filter((e) => e.offer.retailer === "flipkart")).toHaveLength(2);
    expect(entries.map((e) => e.offer.retailer).sort()).toEqual(["amazon", "croma", "flipkart", "flipkart"]);
    // Croma priced via agent and labelled so, at most 3 agent runs
    expect(entries.find((e) => e.offer.retailer === "croma")?.offer.verificationStatus).toBe("agent_verified");
    expect(d.agentCalls.length).toBeLessThanOrEqual(3);
    // junk never appears anywhere, not even as exclusions
    const all = JSON.stringify(eng);
    expect(all).not.toContain("Add to your order");
    // mismatched variants are excluded with reasons
    const ex = item.excluded.map((e) => e.offer.productName);
    expect(ex.some((t) => /Ultra/.test(t))).toBe(true);
    expect(ex.some((t) => /128 GB/.test(t))).toBe(true);
    expect(ex.some((t) => /Refurbished/.test(t))).toBe(true);
    expect(entries.some((e) => /Ultra|128 GB|Refurbished/.test(e.offer.productName))).toBe(false);
  });

  it("search response keeps policy fields only when read from the page, and ignores 'Sold Out' in related products", async () => {
    clearSearchCache();
    const r = await searchProducts("Samsung Galaxy S24 256GB", { deps: deps(), persist: false, skipCache: true });
    const fk = r.offers.find((o) => o.retailer === "flipkart" && o.price === 53199)!;
    expect(fk.availability).toBe("in_stock");
    expect(fk.warranty).toMatch(/1 Year/i);
    expect(fk.returnPolicy).toMatch(/7 Days/i);
    const am = r.offers.find((o) => o.retailer === "amazon")!;
    expect(am.warranty).toBeUndefined();
    expect(am.returnPolicy).toBeUndefined();
  });
});

describe("resolution with exact attributes", () => {
  const want = parseEcomQuery("Samsung Galaxy S24 256GB").entity;
  const res = (t: string) => validate(want, "Samsung Galaxy S24 256GB", { id: "x", title: t });
  it("matches same brand/model/storage with RAM/colour/marketing numbers in the title", () => {
    for (const t of [
      "Samsung Galaxy S24 5G (Cobalt Violet, 256 GB) (8 GB RAM)",
      "Samsung Galaxy S24 5G (Marble Gray, 8GB, 256GB Storage), 2 Year Warranty, 2X Zoom",
      "Buy SAMSUNG Galaxy S24 5G (8GB RAM, 256GB, Onyx Black) Online",
    ]) {
      const r = res(t);
      expect(r.decision, t).toBe("match");
      expect(r.confidence, t).toBeGreaterThanOrEqual(0.8);
    }
  });
  it("still rejects other storage, S23, Ultra, FE, Plus, refurbished", () => {
    for (const t of ["Samsung Galaxy S24 5G 128 GB", "Samsung Galaxy S23 5G 256 GB", "Samsung Galaxy S24 Ultra 256 GB", "Samsung Galaxy S24 FE 256 GB", "Samsung Galaxy S24+ 256 GB", "Samsung Galaxy S24 256 GB Refurbished"]) {
      expect(res(t).decision, t).toBe("reject");
    }
  });
});

describe("helpers", () => {
  it("cleanOffers drops junk and duplicates, keeping the verified one", () => {
    const a = ecom({ productName: "Samsung Galaxy S24 5G 256 GB", retailer: "amazon", listedPrice: 55000, sourceUrl: "https://www.amazon.in/x/dp/B0CMDRCZBH", verificationStatus: "unverified" });
    const b = ecom({ productName: "Samsung Galaxy S24 5G 256 GB", retailer: "amazon", listedPrice: 55000, sourceUrl: "https://www.amazon.in/dp/B0CMDRCZBH?ref_=x" });
    const j = ecom({ productName: "Add to your order", retailer: "amazon", listedPrice: null, sourceUrl: "https://www.amazon.in/dp/B0CJUNK001" });
    const out = cleanOffers([a, b, j]);
    expect(out).toEqual([b]);
  });
  it("richerTitle adds storage/RAM from the search title only when the page lacks and does not contradict", () => {
    expect(richerTitle("Samsung Galaxy S24 5G", "Samsung Galaxy S24 5G (Onyx Black, 256 GB) (8 GB RAM)")).toContain("256 GB");
    expect(richerTitle("Samsung Galaxy S24 5G 128 GB", "Samsung Galaxy S24 5G (256 GB)")).toBe("Samsung Galaxy S24 5G 128 GB");
  });
  it("unwrapAgentResult tolerates strings, nesting and price objects", () => {
    expect(unwrapAgentResult('{"price": 5}')).toEqual({ price: 5 });
    expect(unwrapAgentResult({ result: { price: { value: "7" } } })).toEqual({ price: "7" });
    expect(unwrapAgentResult("not json")).toBeNull();
  });
});
