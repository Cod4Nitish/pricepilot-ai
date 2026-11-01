import { describe, expect, it } from "vitest";
import { parseShopQuery } from "../parser";

describe("shop intent for the demo queries (deterministic, no LLM)", () => {
  it("recommendation queries: budget is a constraint, not identity", () => {
    for (const q of ["Best phone under 50k", "Best phone under ₹50K"]) {
      const p = parseShopQuery(q);
      expect(p.searchIntent).toBe("PRODUCT_RECOMMENDATION");
      expect(p.category).toBe("smartphone");
      expect(p.budgetMax).toBe(50000);
      expect(p.brand).toBeNull();
      expect(p.model).toBeNull();
    }
    const cam = parseShopQuery("Best camera phone under 40000");
    expect(cam.searchIntent).toBe("PRODUCT_RECOMMENDATION");
    expect(cam.budgetMax).toBe(40000);
    expect(JSON.stringify(cam.preferredFeatures).toLowerCase()).toContain("camera");
  });
  it("feature search keeps the GPU as a hard requirement", () => {
    const p = parseShopQuery("Gaming laptop RTX 4050 under 70000");
    expect(p.searchIntent).toBe("FEATURE_SEARCH");
    expect(p.category).toBe("laptop");
    expect(p.budgetMax).toBe(70000);
    expect(p.variant.gpu).toBe("RTX 4050");
  });
  it("exact product and comparison", () => {
    expect(parseShopQuery("Samsung Galaxy S24 256GB").searchIntent).toBe("EXACT_PRODUCT");
    expect(parseShopQuery("Samsung S24 vs OnePlus 13").searchIntent).toBe("PRODUCT_COMPARISON");
  });
});
