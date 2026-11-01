import { describe, expect, it } from "vitest";
import { ecom, rawOffer } from "../__fixtures__/offers";
import { fromEcommerceOffer } from "../adapters";
import { parseDiscountText } from "../ecommerce/discounts";
import { entityFromText, extractGtins, gtinCheckDigitValid, parseEcomQuery } from "../ecommerce/entity";
import { compareEcommerce } from "../ecommerce/pipeline";
import { validate } from "../ecommerce/resolve";
import { UnifiedOfferSchema } from "../schema";

const decide = (q: string, title: string, gtins: string[] = [], qg?: string) => {
  const e = parseEcomQuery(q).entity;
  if (qg) e.gtins = [qg];
  return validate(e, q, { id: "x", title, gtins });
};

describe("entity resolution", () => {
  it("matches the same model and rejects 128 vs 256GB", () => {
    expect(decide("samsung galaxy s24 256gb", "Samsung Galaxy S24 5G (Onyx Black, 256 GB) (8 GB RAM)").decision).toBe("match");
    const r = decide("samsung galaxy s24 256gb", "Samsung Galaxy S24 5G (Onyx Black, 128 GB)");
    expect(r.decision).toBe("reject");
    expect(r.mismatches.some((m) => m.attribute === "storage" && m.severity === "hard")).toBe(true);
  });
  it("rejects S24 Ultra and S24 FE for an S24 query, and S24 for an Ultra query", () => {
    expect(decide("galaxy s24 256gb", "Samsung Galaxy S24 Ultra 5G 256 GB").decision).toBe("reject");
    expect(decide("galaxy s24 256gb", "Samsung Galaxy S24 FE 5G 256 GB").decision).toBe("reject");
    expect(decide("galaxy s24 ultra 256gb", "Samsung Galaxy S24 5G 256 GB").decision).toBe("reject");
    expect(decide("galaxy s24 ultra 256gb", "Samsung Galaxy S24 Ultra 5G 256 GB").decision).toBe("match");
    expect(decide("galaxy s24", "Samsung Galaxy S23 5G 256 GB").decision).toBe("reject");
  });
  it("rejects refurbished vs new", () => {
    const r = decide("iphone 15 128gb", "Apple iPhone 15 (128 GB) - Refurbished");
    expect(r.decision).toBe("reject");
    expect(r.mismatches.some((m) => m.attribute === "condition")).toBe(true);
  });
  it("brand alias: galaxy implies samsung; brand clash rejected", () => {
    expect(entityFromText("galaxy s24").brand).toBe("samsung");
    expect(decide("samsung s24", "Apple iPhone S24 case").decision).toBe("reject");
  });
  it("colour mismatch is soft and reported; unknown storage is unverifiable (never a silent match)", () => {
    const soft = decide("iphone 15 128gb blue", "Apple iPhone 15 (128 GB) - Black");
    expect(soft.decision).not.toBe("reject");
    expect(soft.mismatches.find((m) => m.attribute === "color")?.severity).toBe("soft");
    const unk = decide("iphone 15 128gb", "Apple iPhone 15 Black");
    expect(unk.mismatches.find((m) => m.attribute === "storage")?.severity).toBe("unverifiable");
    expect(unk.decision).toBe("possible");
    const exact = decide("iphone 15 128gb", "Apple iPhone 15 (128 GB) Black");
    expect(exact.confidence).toBeGreaterThan(unk.confidence);
  });
  it("GTIN overrides fuzzy matching (and conflicting GTINs reject)", () => {
    const ean = "8806095323572";
    expect(gtinCheckDigitValid(ean)).toBe(true);
    expect(gtinCheckDigitValid("8806095323573")).toBe(false);
    const r = decide("samsung galaxy s24 256gb", "SM-S921B/DS Smartphone Marble Grey", ["0" + ean], "0" + ean);
    expect(r.decision).toBe("match");
    expect(r.viaGtin).toBe(true);
    const other = decide("samsung galaxy s24 256gb", "Samsung Galaxy S24 5G 256 GB", ["04006381333931"], "0" + ean);
    expect(other.decision).toBe("reject");
  });
  it("extracts only check-digit-valid GTINs from JSON-LD/markdown", () => {
    expect(extractGtins('{"@type":"Product","gtin13":"8806095323572"}')).toEqual(["08806095323572"]);
    expect(extractGtins("EAN: 8806095323573")).toEqual([]);
  });
});

describe("eligible discounts", () => {
  const texts = ["Flat ₹2000 off on HDFC Bank credit cards. Minimum order ₹20000", "Apply coupon SAVE500 to get ₹500 off", "No cost EMI available on ICICI cards"];
  it("parses amount and condition text", () => {
    const d = parseDiscountText(texts[0]);
    expect(d.amount).toBe(2000);
    expect(d.instruments).toContain("hdfc");
    expect(d.condition).toMatch(/HDFC/);
    expect(d.applied).toBe(false);
    expect(parseDiscountText(texts[2]).amount).toBeNull();
  });
  const mk = () => [ecom({ productName: "Apple iPhone 15 (128 GB) Black", retailer: "amazon", listedPrice: 60000, offerTexts: texts })];
  it("does NOT apply conditional discounts by default; reports best case separately", () => {
    const e = compareEcommerce("iphone 15 128gb", mk()).entries[0];
    expect(e.pricing.eligibleDiscount).toBe(0);
    expect(e.pricing.effectiveTotal).toBe(60000);
    expect(e.pricing.listedTotal).toBe(60000);
    expect(e.pricing.bestCaseEffective).toBe(60000 - 2000 - 500);
    expect(e.pricing.stillConditional.length).toBe(3);
  });
  it("applies only with a matching card / coupon", () => {
    expect(compareEcommerce("iphone 15 128gb", mk(), { cards: ["SBI"] }).entries[0].pricing.eligibleDiscount).toBe(0);
    expect(compareEcommerce("iphone 15 128gb", mk(), { cards: ["HDFC credit"] }).entries[0].pricing.effectiveTotal).toBe(58000);
    expect(compareEcommerce("iphone 15 128gb", mk(), { cards: ["hdfc"], coupons: ["save500"] }).entries[0].pricing.effectiveTotal).toBe(57500);
  });
  it("min-order condition is enforced", () => {
    const o = [ecom({ productName: "Apple iPhone 15 (128 GB) Black", retailer: "amazon", listedPrice: 15000, offerTexts: [texts[0]] })];
    expect(compareEcommerce("iphone 15 128gb", o, { cards: ["hdfc"] }).entries[0].pricing.eligibleDiscount).toBe(0);
  });
});

describe("effective price ranking", () => {
  const t = "Apple iPhone 15 (128 GB) Black";
  it("unknown shipping => lower bound and does not win a near-tie against a fully known total", () => {
    const a = ecom({ productName: t, retailer: "croma", listedPrice: 60000, shippingFee: null });
    const b = ecom({ productName: t, retailer: "amazon", listedPrice: 60400, shippingFee: 0 });
    const c = compareEcommerce("iphone 15 128gb", [a, b]);
    expect(c.entries.find((e) => e.offer.retailer === "croma")?.pricing.totalIsLowerBound).toBe(true);
    expect(c.recommendation.cheapest?.retailer).toBe("amazon");
    const a2 = ecom({ productName: t, retailer: "croma", listedPrice: 50000, shippingFee: null });
    const c2 = compareEcommerce("iphone 15 128gb", [a2, b]);
    expect(c2.recommendation.cheapest?.retailer).toBe("croma");
    expect(c2.recommendation.cheapest?.totalIsLowerBound).toBe(true);
  });
  it("shipping is added when known", () => {
    const c = compareEcommerce("iphone 15 128gb", [ecom({ productName: t, retailer: "amazon", listedPrice: 60000, shippingFee: 99 })]);
    expect(c.entries[0].pricing.effectiveTotal).toBe(60099);
  });
  it("only match + verified in-stock offers can be cheapest", () => {
    const offers = [
      ecom({ productName: t, retailer: "amazon", listedPrice: 70000 }),
      ecom({ productName: t, retailer: "flipkart", listedPrice: 50000, verificationStatus: "snippet_only" }),
      ecom({ productName: t, retailer: "croma", listedPrice: 55000, stockStatus: "out_of_stock" }),
      ecom({ productName: "Apple iPhone 15 Black", retailer: "reliance", listedPrice: 52000 }),
      ecom({ productName: "Apple iPhone 15 (256 GB) Black", retailer: "vijay", listedPrice: 40000 }),
    ];
    const c = compareEcommerce("iphone 15 128gb", offers);
    expect(c.recommendation.cheapest?.retailer).toBe("amazon");
    expect(c.excluded.map((x) => x.offer.retailer)).toEqual(["vijay"]);
    expect(c.recommendation.caveats.join(" ")).toMatch(/snippet_only/);
    expect(c.recommendation.text).toMatch(/amazon/);
  });
  it("no eligible offer => no recommendation, honest text", () => {
    const c = compareEcommerce("iphone 15 128gb", [ecom({ productName: t, retailer: "flipkart", listedPrice: 50000, verificationStatus: "unverified" })]);
    expect(c.recommendation.cheapest).toBeNull();
    expect(c.recommendation.enoughEvidence).toBe(false);
  });
  it("budget excludes over-budget offers from the recommendation", () => {
    const c = compareEcommerce("iphone 15 128gb under 50000", [ecom({ productName: t, retailer: "amazon", listedPrice: 60000 })]);
    expect(c.recommendation.cheapest).toBeNull();
  });
});

describe("adapters and schema", () => {
  it("fromEcommerceOffer produces a valid UnifiedOffer with nulls for unknowns", () => {
    const u = fromEcommerceOffer(rawOffer({ title: "Apple iPhone 15 (128 GB) Black", retailer: "amazon", price: 60000, deliveryCharge: null, offers: ["Flat ₹2000 off on HDFC cards"], evidence: "Price ₹60,000 GTIN: 8806095323572" }));
    expect(UnifiedOfferSchema.safeParse(u).success).toBe(true);
    expect(u.shippingFee).toBeNull();
    expect(u.handlingFee).toBeNull();
    expect(u.deliveryEtaMinutes).toBeNull();
    expect(u.eligibleDiscount).toBeNull();
    expect(u.conditionalDiscounts[0].applied).toBe(false);
    expect(u.gtin).toBe("08806095323572");
    expect(u.variant.storageGb).toBe(128);
    expect(u.unitQuantity).toBeNull();
  });
});
