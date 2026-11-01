import { describe, expect, it } from "vitest";
import { cleanProductTitle } from "../pipeline";

describe("cleanProductTitle (real retailer page titles, 2026-11-01)", () => {
  it("strips page-title boilerplate but keeps the variant", () => {
    expect(cleanProductTitle("Buy SAMSUNG Galaxy S24 5G (8GB RAM, 256GB, Onyx Black) Online - Croma")).toBe("SAMSUNG Galaxy S24 5G (8GB RAM, 256GB, Onyx Black)");
    expect(cleanProductTitle("Samsung Galaxy S24 5G (256 GB Storage, 8 GB RAM) Online at Best Price On Flipkart.com")).toBe("Samsung Galaxy S24 5G (256 GB Storage, 8 GB RAM)");
    expect(cleanProductTitle("Buy HP Victus Gaming Laptop (Core 5, 24GB, 512GB SSD, RTX 4050) 15-fa2508TX | Vijay Sales")).toBe("HP Victus Gaming Laptop (Core 5, 24GB, 512GB SSD, RTX 4050) 15-fa2508TX");
    expect(cleanProductTitle("Samsung Galaxy S24 5G AI Smartphone (Amber Yellow, 8GB, 128GB Storage)")).toBe("Samsung Galaxy S24 5G AI Smartphone (Amber Yellow, 8GB, 128GB Storage)");
  });
  it("does not cut a model name that merely contains a dash", () => {
    expect(cleanProductTitle("Lenovo LOQ 15ARP10E Gaming Laptop - RTX 4050")).toBe("Lenovo LOQ 15ARP10E Gaming Laptop - RTX 4050");
  });
});
