import { describe, expect, it } from "vitest";
import { discountPct, extractFromMarkdown, parseInr } from "../extract";

describe("parseInr", () => {
  it("handles Indian grouping", () => {
    expect(parseInr("1,79,999")).toBe(179999);
    expect(parseInr("79,999")).toBe(79999);
    expect(parseInr("1,299.50")).toBe(1299.5);
    expect(parseInr("abc")).toBeNull();
  });
});

describe("extractFromMarkdown", () => {
  it("reads Amazon-style price and MRP, ignoring EMI", () => {
    const md = `# Samsung Galaxy S24 Ultra 5G (Titanium Gray, 12GB, 256GB)
![img](https://m.media-amazon.com/images/I/abc.jpg)
EMI starts at ₹5,833 per month
-8% ₹1,29,999
M.R.P.: ₹1,41,900
Bank Offer: 10% instant discount up to ₹3,000 on HDFC cards
No Cost EMI available
In stock`;
    const r = extractFromMarkdown(md);
    expect(r.price).toBe(129999);
    expect(r.mrp).toBe(141900);
    expect(r.title).toContain("Galaxy S24 Ultra");
    expect(r.availability).toBe("in_stock");
    expect(r.offers.some((o) => /bank offer/i.test(o))).toBe(true);
    expect(r.offers.some((o) => /no cost emi/i.test(o))).toBe(true);
    expect(r.evidence).toContain("1,29,999");
    expect(r.imageUrl).toContain("media-amazon");
  });

  it("handles struck-through MRP (Flipkart style)", () => {
    const r = extractFromMarkdown("# Phone\n₹79,999 ~~₹89,999~~ 10% off\nAdd to cart");
    expect(r.price).toBe(79999);
    expect(r.mrp).toBe(89999);
  });

  it("prefers deal price on a Buy line over other numbers", () => {
    const r = extractFromMarkdown("# X\nExchange offer up to ₹20,000\nBuy at ₹54,999");
    expect(r.price).toBe(54999);
  });

  it("returns null price when page has none (JS-rendered)", () => {
    const r = extractFromMarkdown("# Croma Phone\nLoading...");
    expect(r.price).toBeNull();
    expect(r.evidence).toBeUndefined();
  });

  it("detects out of stock", () => {
    expect(extractFromMarkdown("# A\n₹999\nCurrently unavailable").availability).toBe("out_of_stock");
  });
});

describe("discountPct", () => {
  it("only when both known", () => {
    expect(discountPct(90, 100)).toBe(10);
    expect(discountPct(null, 100)).toBeNull();
    expect(discountPct(100, 90)).toBeNull();
  });
});
