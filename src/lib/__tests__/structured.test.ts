import { describe, expect, it } from "vitest";
import { extractFromMarkdown } from "../extract";
import { discoverProductLinks, isProductUrl, productKey, RETAILER_BY_ID } from "../retailers";
import { isJunkTitle } from "../match";
import { extractReturnPolicy, extractWarranty, parseStructuredProduct } from "../structured";

const LD = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"SAMSUNG Galaxy S24 5G (8GB RAM, 256GB, Onyx Black)","sku":"491589123","mpn":"SM-S921BZKGINU","gtin13":"8806095323572","image":["https://img.croma.com/s24.jpg"],"brand":{"@type":"Brand","name":"Samsung"},"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.5","ratingCount":"1203"},"offers":{"@type":"Offer","price":"54990.00","priceCurrency":"INR","availability":"https://schema.org/InStock","seller":{"@type":"Organization","name":"Croma"},"hasMerchantReturnPolicy":{"@type":"MerchantReturnPolicy","merchantReturnDays":7}}}</script>`;

describe("structured data", () => {
  it("parses JSON-LD Product/Offer", () => {
    const p = parseStructuredProduct(`# Croma\n${LD}`)!;
    expect(p).toMatchObject({
      price: 54990,
      priceCurrency: "INR",
      availability: "in_stock",
      gtin: "8806095323572",
      mpn: "SM-S921BZKGINU",
      sku: "491589123",
      brand: "Samsung",
      seller: "Croma",
      ratingValue: 4.5,
      ratingCount: 1203,
      returnPolicy: "7-day return",
    });
  });
  it("extractFromMarkdown prefers JSON-LD price when present and exposes fields", () => {
    const r = extractFromMarkdown(`# Buy SAMSUNG Galaxy S24 5G Online\nLoading...\n${LD}`);
    expect(r.price).toBe(54990);
    expect(r.evidence).toMatch(/JSON-LD/);
    expect(r.availability).toBe("in_stock");
    expect(r.gtin).toBe("8806095323572");
    expect(r.returnPolicy).toBe("7-day return");
    expect(r.seller).toBe("Croma");
  });
  it("ignores non-INR JSON-LD price", () => {
    expect(extractFromMarkdown(`# X\n{"@type":"Product","offers":{"price":"699","priceCurrency":"USD"}}`).price).toBeNull();
  });
  it("reads meta price tags (either attribute order)", () => {
    const r = extractFromMarkdown(`# X\n<meta content="INR" property="product:price:currency"><meta content="54990" property="product:price:amount">`);
    expect(r.price).toBe(54990);
    expect(r.structuredSource).toBe("meta");
  });
  it("warranty and return only from page text", () => {
    expect(extractWarranty("1 Year Manufacturer Warranty for device")).toMatch(/1 Year/);
    expect(extractReturnPolicy("7 Days Replacement Policy")).toMatch(/7 Days/);
    expect(extractWarranty("# Phone\n₹999")).toBeUndefined();
  });
  it("availability ignores related-products noise and conflicting signals are unknown", () => {
    expect(extractFromMarkdown("# A\n₹999\nAdd to cart\nBuy Now\n## Similar Products\nSold Out\nNotify Me").availability).toBe("in_stock");
    expect(extractFromMarkdown("# A\n₹999\nCurrently unavailable\nAdd to cart").availability).toBe("unknown");
  });
});

describe("retailer URLs and discovery", () => {
  it("tightened product URL regexes", () => {
    const rel = RETAILER_BY_ID.reliance;
    expect(isProductUrl(rel, "https://www.reliancedigital.in/samsung-galaxy-s24-5g-8gb-256gb/p/493839412")).toBe(true);
    expect(isProductUrl(rel, "https://www.reliancedigital.in/product/offers")).toBe(false);
    expect(isProductUrl(rel, "https://www.reliancedigital.in/mobiles/c/S101711")).toBe(false);
    const v = RETAILER_BY_ID.vijay;
    expect(isProductUrl(v, "https://www.vijaysales.com/p/P235486/235486/samsung-galaxy-s24")).toBe(true);
    expect(isProductUrl(v, "https://www.vijaysales.com/c/mobile-phones/12345")).toBe(false);
    expect(isProductUrl(v, "https://www.vijaysales.com/search/samsung/2024")).toBe(false);
  });
  it("productKey identifies the same product across URL variants", () => {
    expect(productKey("amazon", "https://www.amazon.in/a/dp/B0CMDRCZBH?x=1")).toBe(productKey("amazon", "https://www.amazon.in/gp/product/B0CMDRCZBH"));
    expect(productKey("flipkart", "https://www.flipkart.com/a/p/itmabc?pid=MOB1&lid=x")).toBe(productKey("flipkart", "https://www.flipkart.com/b/p/itmabc?pid=MOB1"));
  });
  it("discovers product links from a category page", () => {
    const md = `[Samsung Galaxy S24 5G 256GB](/samsung-galaxy-s24-5g-256gb/p/493839412)\n[Apple iPhone 15](/apple-iphone-15/p/493000001)\n[Mobiles](/mobiles/c/S1)`;
    const d = discoverProductLinks(RETAILER_BY_ID.reliance, "Samsung Galaxy S24 256GB", {
      markdown: md,
      links: ["https://www.reliancedigital.in/samsung-galaxy-s24-5g-256gb/p/493839412", "https://evil.com/p/493839412"],
    });
    expect(d).toHaveLength(1);
    expect(d[0].url).toBe("https://www.reliancedigital.in/samsung-galaxy-s24-5g-256gb/p/493839412");
  });
  it("junk titles", () => {
    expect(isJunkTitle("Add to your order")).toBe(true);
    expect(isJunkTitle("Samsung Galaxy S24 5G")).toBe(false);
  });
});
