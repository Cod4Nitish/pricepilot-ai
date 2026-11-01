import { describe, expect, it } from "vitest";
import { parseQuery, scoreListing } from "../match";

describe("parseQuery", () => {
  it("parses brand, storage, color, maxPrice", () => {
    const q = parseQuery("Samsung Galaxy S24 256GB black under ₹60,000");
    expect(q.brand).toBe("samsung");
    expect(q.storageGb).toBe(256);
    expect(q.color).toBe("black");
    expect(q.maxPrice).toBe(60000);
    expect(q.condition).toBe("new");
    expect(q.modelTokens).toContain("s24");
  });
  it("parses k suffix and refurbished", () => {
    const q = parseQuery("refurbished iphone 13 128gb below 30k");
    expect(q.maxPrice).toBe(30000);
    expect(q.condition).toBe("refurbished");
    expect(q.storageGb).toBe(128);
  });
  it("parses ram/storage pair", () => {
    const q = parseQuery("oneplus 12 12/256");
    expect(q.ramGb).toBe(12);
    expect(q.storageGb).toBe(256);
  });
});

describe("scoreListing", () => {
  const q = parseQuery("Samsung Galaxy S24 256GB");
  it("matches exact", () => {
    const r = scoreListing(q, "Samsung Galaxy S24 5G (Onyx Black, 8GB, 256GB Storage)");
    expect(r.hardExcluded).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it("excludes different storage", () => {
    expect(scoreListing(q, "Samsung Galaxy S24 5G (Onyx Black, 8GB, 128GB Storage)").hardExcluded).toBe(true);
    expect(scoreListing(parseQuery("iphone 15 128gb"), "Apple iPhone 15 (256 GB) - Blue").hardExcluded).toBe(true);
  });
  it("excludes Ultra / FE / Plus variants", () => {
    expect(scoreListing(q, "Samsung Galaxy S24 Ultra 5G 256GB").hardExcluded).toBe(true);
    expect(scoreListing(q, "Samsung Galaxy S24 FE 5G 256GB").hardExcluded).toBe(true);
    expect(scoreListing(q, "Samsung Galaxy S24+ 5G 256GB").hardExcluded).toBe(true);
  });
  it("excludes different generation", () => {
    expect(scoreListing(q, "Samsung Galaxy S23 256GB").hardExcluded).toBe(true);
  });
  it("excludes refurbished when new wanted and vice versa", () => {
    expect(scoreListing(q, "Samsung Galaxy S24 256GB (Renewed)").hardExcluded).toBe(true);
    expect(scoreListing(parseQuery("galaxy s24 256gb refurbished"), "Samsung Galaxy S24 256GB").hardExcluded).toBe(true);
  });
  it("requires the Ultra when asked", () => {
    const u = parseQuery("galaxy s24 ultra 256gb");
    expect(scoreListing(u, "Samsung Galaxy S24 Ultra 5G 256GB").hardExcluded).toBe(false);
    expect(scoreListing(u, "Samsung Galaxy S24 256GB").hardExcluded).toBe(true);
  });
  it("lowers confidence when storage missing in title", () => {
    const r = scoreListing(q, "Samsung Galaxy S24 5G");
    expect(r.hardExcluded).toBe(false);
    expect(r.confidence).toBeLessThan(0.8);
  });
});
