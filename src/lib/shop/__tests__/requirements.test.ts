import { describe, expect, it } from "vitest";
import { parseShopQuery } from "../parser";
import { brandMatches, meetsRequirements, productTypeOf, requestedProductType, requirementsEmptyMessage } from "../requirements";
import { validate } from "../../engine/ecommerce/resolve";
import { parseEcomQuery } from "../../engine/ecommerce/entity";

const ok = (q: string, name: string) => meetsRequirements(name, parseShopQuery(q)).ok;

describe("hard brand / product-type requirements (regression: Sony query returned realme earbuds)", () => {
  it("parses the bug query", () => {
    const p = parseShopQuery("sony wireless headphone under 5000");
    expect(p.brand?.toLowerCase()).toBe("sony");
    expect(p.category).toBe("headphones");
    expect(p.budgetMax).toBe(5000);
    expect(requestedProductType(p.raw)).toBe("headphones");
  });

  it("Sony wireless headphones: only Sony over-ear/on-ear headphones pass", () => {
    const q = "sony wireless headphone under 5000";
    expect(ok(q, "realme Buds Air 7")).toBe(false);
    expect(ok(q, "boAt Rockerz 450 Bluetooth On Ear Headphones")).toBe(false);
    expect(ok(q, "Sony WF-C510 Truly Wireless Earbuds")).toBe(false); // earbuds, not headphones
    expect(ok(q, "Sony WI-C100 Wireless Neckband")).toBe(false);
    expect(ok(q, "Sony WH-CH520 Wireless Bluetooth On-Ear Headphones")).toBe(true);
    expect(ok(q, "Sony WH-CH720N Noise Cancelling Wireless Headphones")).toBe(true);
  });

  it("earbuds and neckbands are distinguished from headphones and headsets", () => {
    expect(productTypeOf("realme Buds Air 7")).toBe("earbuds");
    expect(productTypeOf("OnePlus Bullets Wireless Z2 Neckband")).toBe("neckband");
    expect(productTypeOf("HyperX Cloud II Gaming Headset")).toBe("headset");
    expect(productTypeOf("JBL Tune 520BT On-Ear Headphones")).toBe("headphones");
    expect(ok("best tws earbuds under 3000", "JBL Tune 520BT On-Ear Headphones")).toBe(false);
    expect(ok("best tws earbuds under 3000", "boAt Airdopes 141 TWS Earbuds")).toBe(true);
  });

  it("Samsung phones: other brands are rejected; Galaxy counts as Samsung", () => {
    const q = "best samsung phone under 30000";
    expect(ok(q, "Samsung Galaxy M35 5G")).toBe(true);
    expect(ok(q, "Galaxy A35 5G (8GB, 128GB)")).toBe(true);
    expect(ok(q, "OnePlus Nord CE4 Lite")).toBe(false);
    expect(ok(q, "Redmi Note 14 Pro")).toBe(false);
  });

  it("Apple laptops: MacBook counts as Apple, Dell does not", () => {
    expect(brandMatches("MacBook Air M3 13-inch", "apple")).toBe(true);
    const q = "apple laptop under 100000";
    expect(ok(q, "Apple MacBook Air M2")).toBe(true);
    expect(ok(q, "Dell Inspiron 14 Plus")).toBe(false);
  });

  it("gaming accessories: a mouse request rejects keyboards and controllers", () => {
    const q = "gaming mouse under 2000";
    expect(ok(q, "Logitech G203 LIGHTSYNC Wired Gaming Mouse")).toBe(true);
    expect(ok(q, "Redragon K552 Mechanical Gaming Keyboard")).toBe(false);
    expect(ok(q, "Cosmic Byte Ares Wireless Controller")).toBe(false);
  });

  it("no brand and no type in the query: nothing is filtered", () => {
    expect(ok("best phone under 50000", "realme 14 Pro+")).toBe(true);
    expect(requirementsEmptyMessage(parseShopQuery("best phone under 50000"))).toBeNull();
  });

  it("honest empty message names what was asked", () => {
    const m = requirementsEmptyMessage(parseShopQuery("sony wireless headphone under 5000"));
    expect(m).toMatch(/No verified Sony headphones within ₹5,000/);
    expect(m).toMatch(/not shown because you asked for Sony headphones/);
  });

  it("exact variants stay strict (existing resolver)", () => {
    const res = (q: string, t: string) => validate(parseEcomQuery(q).entity, q, { id: "x", title: t }).decision;
    expect(res("Samsung Galaxy S24 256GB", "Samsung Galaxy S24 5G (Onyx Black, 256 GB) (8 GB RAM)")).toBe("match");
    expect(res("Samsung Galaxy S24 256GB", "Samsung Galaxy S24 5G (Onyx Black, 128 GB) (8 GB RAM)")).toBe("reject");
    expect(res("Samsung Galaxy S24 256GB", "Samsung Galaxy S24 Ultra 5G (256 GB)")).toBe("reject");
  });
});
