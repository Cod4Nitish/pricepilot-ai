import { describe, expect, it } from "vitest";
import { deriveAdvice } from "../buy-vs-wait";
import type { PricePoint } from "@/lib/types";

const day = 86_400_000;
const mk = (prices: number[], spanDays: number): PricePoint[] =>
  prices.map((price, i) => ({
    offerKey: "k",
    retailer: "amazon",
    price,
    observedAt: new Date(Date.UTC(2026, 0, 1) + (i * spanDays * day) / Math.max(1, prices.length - 1)).toISOString(),
  }));

describe("deriveAdvice", () => {
  it("says insufficient with too few points", () => {
    expect(deriveAdvice(mk([100, 100, 100], 30), 100).kind).toBe("insufficient");
  });
  it("says insufficient when the span is too short", () => {
    expect(deriveAdvice(mk([100, 101, 102, 103, 104, 105], 2), 100).kind).toBe("insufficient");
  });
  it("says insufficient with no current price", () => {
    expect(deriveAdvice(mk([100, 101, 102, 103, 104, 105], 30), null).kind).toBe("insufficient");
  });
  it("buy near the low, wait when well above median", () => {
    const pts = mk([100, 110, 120, 130, 140, 150], 30);
    expect(deriveAdvice(pts, 101).kind).toBe("buy");
    expect(deriveAdvice(pts, 145).kind).toBe("wait");
    expect(deriveAdvice(pts, 125).kind).toBe("neutral");
  });
});
