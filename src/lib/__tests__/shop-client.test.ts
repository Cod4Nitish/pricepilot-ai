import { describe, expect, it } from "vitest";
import type { ProductGroup, ShopOffer } from "@/lib/shop/types";
import { budgetLabel, componentPct, formatElapsed, normalizeWeights, relativeTime, rupees, shippingLabel, sortGroups, sortOffers } from "@/lib/shop-client";

const del = (days: number | null) => ({
  pincode: "400001", serviceable: days === null ? null : true, kind: days === null ? "not_verified" : "published_estimate", etaText: null, etaDate: null, etaDays: days,
  guaranteed: false, checkedAt: null, evidence: null, note: null,
});
const offer = (url: string, price: number | null, days: number | null, ver = "verified"): ShopOffer =>
  ({ sourceUrl: url, listedPrice: price, verificationStatus: ver, delivery: del(days) }) as unknown as ShopOffer;
const group = (id: string, rank: number, price: number | null, offers: ShopOffer[]): ProductGroup =>
  ({ id, rank, lowestVerified: price === null ? null : { price, retailer: "x" }, offers }) as unknown as ProductGroup;

describe("shop-client helpers", () => {
  it("formats rupees and never turns unknown into 0", () => {
    expect(rupees(50000)).toBe("Rs 50,000");
    expect(rupees(null)).toBe("Not found");
    expect(shippingLabel(null)).toBe("Unknown");
    expect(shippingLabel(0)).toBe("Free");
    expect(shippingLabel(49)).toBe("Rs 49");
  });
  it("budget label", () => {
    expect(budgetLabel(null, 50000)).toBe("Budget under Rs 50,000");
    expect(budgetLabel(null, null)).toBeNull();
  });
  it("relative time", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(relativeTime("2026-11-01T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-11-01T11:30:00Z", now)).toBe("30 min ago");
    expect(relativeTime("2026-11-01T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime("2026-10-29T12:00:00Z", now)).toBe("3 d ago");
    expect(relativeTime(null, now)).toBe("unknown");
  });
  it("elapsed", () => expect(formatElapsed(65_000)).toBe("1:05"));
  it("component pct keeps null", () => {
    expect(componentPct(null)).toBeNull();
    expect(componentPct(0)).toBe(0);
    expect(componentPct(0.756)).toBe(76);
  });
  it("normalizes weights", () => {
    const w = normalizeWeights({ price: 2, delivery: 1, evidence: 1 });
    expect(w.price + w.delivery + w.evidence).toBeCloseTo(1);
    expect(w.price).toBeCloseTo(0.5);
    expect(normalizeWeights({ price: 0, delivery: 0, evidence: 0 }).price).toBeCloseTo(1 / 3);
  });
  it("sorts offers by verified price, unknown and unverified last", () => {
    const o = [offer("a", 300, null), offer("b", null, null), offer("c", 100, 3, "snippet_only"), offer("d", 200, 1)];
    expect(sortOffers(o, "price").map((x) => x.sourceUrl)).toEqual(["d", "a", "b", "c"]);
  });
  it("sorts offers by ETA, unknown last", () => {
    const o = [offer("a", 1, null), offer("b", 1, 4), offer("c", 1, 2)];
    expect(sortOffers(o, "delivery").map((x) => x.sourceUrl)).toEqual(["c", "b", "a"]);
  });
  it("sorts groups", () => {
    const g = [group("1", 1, null, []), group("2", 2, 500, [offer("x", 1, 5)]), group("3", 3, 300, [offer("y", 1, 2)])];
    expect(sortGroups(g, "price").map((x) => x.id)).toEqual(["3", "2", "1"]);
    expect(sortGroups(g, "delivery").map((x) => x.id)).toEqual(["3", "2", "1"]);
    expect(sortGroups(g, "relevance").map((x) => x.id)).toEqual(["1", "2", "3"]);
  });
});
