import type { PricePoint } from "@/lib/types";

export const MIN_POINTS = 6;
export const MIN_SPAN_DAYS = 7;

export type Advice =
  | { kind: "insufficient"; points: number; spanDays: number }
  | { kind: "buy" | "wait" | "neutral"; headline: string; detail: string; points: number; spanDays: number; low: number; median: number; high: number };

/**
 * Derives advice ONLY from stored observations. Needs >= MIN_POINTS observations spread over
 * >= MIN_SPAN_DAYS days; otherwise returns "insufficient" and nothing is invented.
 */
export function deriveAdvice(points: PricePoint[], current: number | null): Advice {
  const prices = points.map((p) => p.price).filter((n) => Number.isFinite(n) && n > 0);
  const times = points.map((p) => new Date(p.observedAt).getTime()).filter((t) => !Number.isNaN(t));
  const spanDays = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 86_400_000 : 0;
  if (current === null || prices.length < MIN_POINTS || spanDays < MIN_SPAN_DAYS) {
    return { kind: "insufficient", points: prices.length, spanDays };
  }
  const sorted = [...prices].sort((a, b) => a - b);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const base = { points: prices.length, spanDays, low, median, high };
  if (current <= low * 1.02) {
    return { kind: "buy", headline: "At or near the lowest recorded price", detail: "The current price is within 2% of the lowest we have recorded.", ...base };
  }
  if (current >= median * 1.05) {
    return { kind: "wait", headline: "Above the typical recorded price", detail: "The current price is at least 5% above the median we have recorded. Waiting may be cheaper, but this is not a forecast.", ...base };
  }
  return { kind: "neutral", headline: "Close to the typical recorded price", detail: "The current price is within the range we usually record. History alone does not favour buying or waiting.", ...base };
}
