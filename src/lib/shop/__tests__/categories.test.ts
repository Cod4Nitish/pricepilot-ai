import { describe, expect, it } from "vitest";
import { parseShopQuery } from "../parser";
import { getCategoryConfig, headphonesConfig, isRecommendationSupported, tvConfig, unsupportedCategoryMessage } from "../categories";

const U = "https://example.com/p";

describe("category detection for new categories", () => {
  const rows: [string, string][] = [
    ["Best wireless earbuds under 5000", "headphones"],
    ["best tws under 2000", "headphones"],
    ["best headphones with anc", "headphones"],
    ["boat neckband under 1500", "headphones"],
    ["Best 55 inch smart TV under 50000", "tv"],
    ["best television under 30000", "tv"],
    ["4k tv under 40000", "tv"],
  ];
  it.each(rows)("%s -> %s", (q, cat) => {
    const p = parseShopQuery(q);
    expect(p.category).toBe(cat);
    expect(isRecommendationSupported(p.category)).toBe(true);
  });
  it("budgets parse for the homepage queries", () => {
    expect(parseShopQuery("Best wireless earbuds under 5000").budgetMax).toBe(5000);
    expect(parseShopQuery("Best 55 inch smart TV under 50000").budgetMax).toBe(50000);
  });
  it("unsupported categories have no config (honest empty state, no fake recs)", () => {
    for (const q of ["Best gaming mouse under 3000", "Best air purifier under 15000"]) {
      const p = parseShopQuery(q);
      expect(getCategoryConfig(p.category)).toBeNull();
      expect(isRecommendationSupported(p.category)).toBe(false);
      expect(unsupportedCategoryMessage(p.category)).toMatch(/not supported yet/);
    }
  });
});

describe("headphones/tv config sanity", () => {
  for (const cfg of [headphonesConfig, tvConfig]) {
    it(`${cfg.category} weights normalise to 1 and keys match defaults`, () => {
      const w = cfg.weightsFor({ preferredFeatures: ["gaming"] });
      expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      expect(Object.keys(w).sort()).toEqual(Object.keys(cfg.defaultWeights).sort());
      const base = Object.values(cfg.defaultWeights).reduce((a, b) => a + b, 0);
      expect(base).toBeCloseTo(1, 6);
    });
    it(`${cfg.category} with no evidence gives no score`, () => {
      const s = cfg.score([], { price: null, priceRef: null, weights: cfg.weightsFor({ preferredFeatures: [] }) });
      expect(s.total).toBeNull();
    });
  }

  it("headphones extraction only uses page facts; ANC query => hard constraint", () => {
    const text = "boAt Airdopes X with Hybrid ANC, 13mm drivers, 50 hours of playback, quad mics with ENC, 60ms low latency, Bluetooth v5.3.";
    const specs = headphonesConfig.extractSpecs(text, U);
    const get = (k: string) => specs.find((s) => s.key === k)?.value;
    expect(get("anc")).toBe("yes");
    expect(get("driver_mm")).toBe(13);
    expect(get("battery_hours")).toBe(50);
    expect(get("latency_ms")).toBe(60);
    expect(get("bluetooth_version")).toBe("5.3");
    expect(headphonesConfig.extractSpecs("Plain earbuds, great bass.", U)).toEqual([]);
    for (const s of specs) expect(text.replace(/\s+/g, " ")).toContain(s.evidence);
    const c = headphonesConfig.constraints(parseShopQuery("best anc earbuds under 5000")).find((x) => x.id === "anc");
    expect(c).toBeDefined();
    expect(c!.check({ specs: [], price: null }, true)).toBe("unknown");
  });

  it("tv extraction and 4K / screen-size constraints", () => {
    const text = 'Sony Bravia 139 cm (55 inches) 4K Ultra HD Smart LED Google TV, Dolby Vision, 120Hz, 3 HDMI ports.';
    const specs = tvConfig.extractSpecs(text, U);
    const get = (k: string) => specs.find((s) => s.key === k)?.value;
    expect(get("screen_inch")).toBe(55);
    expect(get("resolution")).toBe("4K");
    expect(get("panel_type")).toBe("LED");
    expect(get("hdr")).toBe("Dolby Vision");
    expect(get("refresh_hz")).toBe(120);
    expect(get("smart_os")).toBe("Google TV");
    expect(get("hdmi_ports")).toBe(3);
    const cs = tvConfig.constraints(parseShopQuery("Best 55 inch 4K smart TV under 50000"));
    const inch = cs.find((x) => x.id === "screen_inch")!;
    expect(inch.check({ specs, price: null }, true)).toBe("pass");
    expect(inch.check({ specs: specs.map((s) => (s.key === "screen_inch" ? { ...s, value: 43 } : s)), price: null }, true)).toBe("fail");
    expect(cs.find((x) => x.id === "resolution_4k")!.check({ specs, price: null }, true)).toBe("pass");
  });
});
