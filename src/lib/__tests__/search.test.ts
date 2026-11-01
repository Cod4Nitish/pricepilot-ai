import { describe, expect, it } from "vitest";
import { clearSearchCache, searchProducts, type Deps } from "../search";

const amazonUrl = "https://www.amazon.in/Samsung-Galaxy-S24/dp/B0CMDRCZBH";
const amazonUltra = "https://www.amazon.in/Samsung-Galaxy-S24-Ultra/dp/B0CMDRCZBI";

describe("searchProducts orchestrator (mocked)", () => {
  it("filters non-product URLs, excludes variants, never fabricates for other retailers", async () => {
    clearSearchCache();
    const deps: Deps = {
      search: async ({ includeDomains }) => ({
        query: "q",
        page: 0,
        total_results: 2,
        results:
          includeDomains?.[0] === "amazon.in"
            ? [
                { position: 1, site_name: "Amazon", title: "Samsung Galaxy S24 5G 8GB 256GB", snippet: "", url: amazonUrl },
                { position: 2, site_name: "Amazon", title: "Samsung Galaxy S24 Ultra 256GB", snippet: "", url: amazonUltra },
                { position: 3, site_name: "Amazon", title: "Mobiles", snippet: "", url: "https://www.amazon.in/mobile-phones/b?node=1" },
              ]
            : [],
      }),
      fetchPages: async ({ urls }) => ({
        results: urls.map((u) => ({ url: u, title: "Samsung Galaxy S24 5G 8GB 256GB", text: "# Samsung Galaxy S24 5G 8GB 256GB\n₹54,999\nM.R.P.: ₹74,999\nIn stock" })),
        errors: [],
      }),
      runAgent: async () => {
        throw new Error("agent should not be called");
      },
    };
    const r = await searchProducts("Samsung Galaxy S24 256GB", { deps, persist: false });
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0].price).toBe(54999);
    expect(r.offers[0].verification).toBe("verified");
    expect(r.bestVerified?.retailer).toBe("amazon");
    expect(r.excluded.some((o) => /Ultra/.test(o.title))).toBe(true);
    expect(r.statuses.find((s) => s.retailer === "flipkart")?.state).toBe("no_results");
    expect(r.recommendation.caveats.join(" ")).toMatch(/not guaranteed|may not apply/);
  });
});
