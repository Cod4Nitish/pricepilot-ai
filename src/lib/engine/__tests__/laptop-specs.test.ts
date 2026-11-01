import { describe, expect, it } from "vitest";
import { parseQuery, scoreListing } from "../../match";
import { buildDecision } from "../../shop/decision";
import { buildOffers } from "../../shop/offers";
import { candidateCap, hasFullSeries } from "../../search";
import type { Offer, SearchResponse } from "../../types";
import { entityFromText, parseEcomQuery } from "../ecommerce/entity";
import { validate } from "../ecommerce/resolve";

const Q = "MSI Katana 15 RTX 4050";
const res = (q: string, t: string) => validate(parseEcomQuery(q).entity, q, { id: "x", title: t });

const FULL = 'MSI Katana 15 B13VEK-1226IN Intel Core i7-13620H 13th Gen, 15.6" FHD 144Hz, 16GB DDR5, 1TB SSD, NVIDIA GeForce RTX 4050 6GB, Windows 11 Home';
const TRUNC = 'MSI Katana 15, Intel 13th Gen Core i5-13420H, 15.6" FHD 144Hz, 16GB, 512GB SSD, Windows 11 Home...';

describe("laptop entity: GPU/CPU are specs, not model numbers", () => {
  it("extracts specs and leaves only the series as model number", () => {
    const e = entityFromText(Q);
    expect(e.gpu).toBe("rtx 4050");
    expect(e.modelNumbers).toEqual(["15"]);
    const f = entityFromText(FULL);
    expect(f.gpu).toBe("rtx 4050");
    expect(f.cpuModel).toBe("13620h");
    expect(f.modelNumbers).not.toContain("4050");
    expect(f.modelNumbers).not.toContain("11");
    expect(f.modelNumbers).not.toContain("13th");
  });
  it("full title matches; truncated title (GPU absent) is only 'possible' (unverifiable), never rejected", () => {
    const m = res(Q, FULL);
    expect(m.decision).toBe("match");
    expect(m.confidence).toBeGreaterThanOrEqual(0.8);
    const p = res(Q, TRUNC);
    expect(p.decision).toBe("possible");
    expect(p.confidence).toBeGreaterThanOrEqual(0.6);
    expect(p.confidence).toBeLessThan(0.8);
    expect(p.mismatches.find((x) => x.attribute === "gpu")?.severity).toBe("unverifiable");
  });
  it("a different GPU is a hard mismatch; series number mismatches stay hard", () => {
    expect(res(Q, FULL.replace("RTX 4050", "RTX 4060")).decision).toBe("reject");
    expect(res(Q, "MSI Katana A15 AI B8VF Ryzen 7 RTX 4050").decision).toBe("reject");
    expect(res("ASUS TUF Gaming F15", "ASUS TUF Gaming F17 FX707ZC4 RTX 3050").decision).toBe("reject");
    expect(res("ASUS TUF Gaming F15", "ASUS TUF Gaming F15 FX506HF-HN024W Core i5 11400H").decision).toBe("match");
    expect(res(Q, "MSI Thin 15 B12UC RTX 4050").decision).not.toBe("match");
  });
  it("a different CPU is a hard mismatch; CPU absent is unverifiable", () => {
    const q = "MSI Katana 15 i7-13620H RTX 4050";
    expect(res(q, "MSI Katana 15 Intel Core i5-13420H RTX 4050").decision).toBe("reject");
    expect(res(q, "MSI Katana 15 RTX 4050 16GB").decision).toBe("possible");
  });
  it("phones are unaffected (S24 still matches, Core Ultra is not a variant suffix)", () => {
    expect(res("Samsung Galaxy S24 256GB", "Samsung Galaxy S24 5G (Onyx Black, 256 GB) (8 GB RAM)").decision).toBe("match");
    expect(res(Q, "MSI Katana 15 Intel Core Ultra 7 155H RTX 4050 Windows 11").decision).toBe("match");
  });
  it("legacy scorer (search prefilter) does not exclude truncated titles for the GPU number", () => {
    const pq = parseQuery(Q);
    expect(pq.gpu).toBe("rtx 4050");
    expect(pq.modelTokens).not.toContain("4050");
    const t = scoreListing(pq, TRUNC);
    expect(t.hardExcluded).toBe(false);
    expect(t.confidence).toBeLessThan(0.8);
    expect(scoreListing(pq, FULL).confidence).toBeGreaterThanOrEqual(0.8);
    expect(scoreListing(pq, FULL.replace("RTX 4050", "RTX 4060")).hardExcluded).toBe(true);
  });
});

describe("search candidate selection", () => {
  it("fetches 5 candidates for device queries, 3 otherwise; series-name titles first", () => {
    expect(candidateCap(parseQuery(Q))).toBe(5);
    expect(candidateCap(parseQuery("Samsung Galaxy S24 256GB"))).toBe(5);
    expect(candidateCap(parseQuery("boat airdopes"))).toBe(3);
    expect(hasFullSeries(parseQuery(Q), "MSI Katana 15 B13VEK")).toBe(true);
    expect(hasFullSeries(parseQuery(Q), "MSI Thin 15 B12UC")).toBe(false);
  });
});

const raw = (o: Partial<Offer> & { title: string; url: string; price: number | null }): Offer => ({
  id: o.url,
  retailer: "amazon",
  retailerName: "Amazon.in",
  mrp: null,
  discountPct: null,
  deliveryCharge: null,
  availability: "in_stock",
  offers: [],
  spec: {},
  matchConfidence: 0.9,
  matchNotes: [],
  verification: "verified",
  checkedAt: "2025-11-01T00:00:00Z",
  ...o,
});
const search = (offers: Offer[]): SearchResponse => ({
  query: Q,
  parsed: { rawQuery: Q },
  offers,
  excluded: [],
  statuses: [],
  bestVerified: null,
  recommendation: { text: "", enoughEvidence: true, caveats: [] },
  runId: "r",
  generatedAt: "",
  cached: false,
});

describe("buildOffers on laptops", () => {
  const full = raw({ title: FULL, url: "https://www.amazon.in/a/dp/B0AAAAAAA1", price: 69990 });
  const full2 = raw({ title: FULL.replace("1TB", "512GB"), url: "https://www.amazon.in/a/dp/B0AAAAAAA2", price: 71990, retailer: "flipkart", retailerName: "Flipkart" });
  const trunc = raw({ title: TRUNC.replace("...", ""), url: "https://www.amazon.in/a/dp/B0AAAAAAA3", price: 62990, retailer: "croma" as never, retailerName: "Croma" });
  const shield = raw({ title: "Screen Protector for MSI Katana 15 RTX 4050 Laptop", url: "https://www.amazon.in/a/dp/B0AAAAAAA4", price: 399 });
  const cheapish = raw({ title: FULL.replace("1TB", "256GB"), url: "https://www.amazon.in/a/dp/B0AAAAAAA5", price: 9990, retailer: "vijay" as never, retailerName: "Vijay Sales" });

  it("accessory rows never reach offers; truncated-spec listing is listed as unconfirmed, not cheapest", async () => {
    const r = await buildOffers(Q, { pincode: null }, { search: async () => search([full, full2, trunc, shield]) });
    expect(r.offers.some((o) => /Screen Protector/.test(o.productName))).toBe(false);
    expect(r.excluded.some((o) => /Screen Protector/.test(o.title))).toBe(false);
    const u = r.offers.find((o) => o.sourceUrl === trunc.url);
    // storage 512 vs 1TB differ => full2 rejected; truncated stays 'possible' because RAM/GPU are unverifiable
    expect(u?.specConfirmed).toBe(false);
    expect(u!.matchingConfidence).toBeGreaterThanOrEqual(0.6);
    expect(u!.matchingConfidence).toBeLessThan(0.8);
    expect(u!.evidence.some((e) => /Unconfirmed spec/.test(e.text))).toBe(true);
    const d = buildDecision(r.offers);
    expect(d.cheapestListed?.offerId).toBe(full.url);
    expect(d.notes.join(" ")).toMatch(/unconfirmed spec/);
  });

  it("price plausibility: drops a price below 35% of the median when >=3 verified offers", async () => {
    const mk = (n: number, price: number) => raw({ title: FULL, url: `https://www.amazon.in/a/dp/B0BBBBBBB${n}`, price });
    const r = await buildOffers(Q, { pincode: null }, { search: async () => search([mk(1, 70000), mk(2, 72000), mk(3, 71000), cheapish]) });
    expect(r.offers.some((o) => o.listedPrice === 9990)).toBe(false);
    expect(r.excluded.find((x) => x.reason === "price implausible for this product (possible accessory)")?.title).toContain("Katana");
    // fewer than 3 verified offers: no guard
    const few = await buildOffers(Q, { pincode: null }, { search: async () => search([mk(1, 70000), cheapish]) });
    expect(few.offers.some((o) => o.listedPrice === 9990)).toBe(true);
  });
});
