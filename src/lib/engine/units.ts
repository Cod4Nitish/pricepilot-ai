// Quantity parsing and unit-price maths. Base units: g, ml, unit.
import type { UnitQuantity } from "./schema";

const W = "kg|kgs|gms|gm|g|grams|gram";
const V = "ml|ltrs|ltr|litres|litre|liters|liter|l";
const MEAS = `(\d+(?:\.\d+)?)\s*(${W}|${V})\b`;
const round = (n: number) => Math.round(n * 1000) / 1000;

function toBase(n: number, u: string): { value: number; unit: "g" | "ml" } {
  const x = u.toLowerCase();
  if (x === "kg" || x === "kgs") return { value: round(n * 1000), unit: "g" };
  if (new RegExp(`^(${W})$`).test(x)) return { value: round(n), unit: "g" };
  if (x === "ml") return { value: round(n), unit: "ml" };
  return { value: round(n * 1000), unit: "ml" };
}

/** Parse "500 g", "0.5 kg", "1L", "dozen", "6 x 200ml", "pack of 2", "2 x 500 g", "12 eggs". Null if no quantity is stated. */
export function parseQuantity(text: string | null | undefined): UnitQuantity | null {
  if (!text) return null;
  const t = text.replace(/,/g, "").replace(/×/g, "x");
  // N x measure
  let m = new RegExp(`(\d+)\s*x\s*${MEAS}`, "i").exec(t);
  if (m) {
    const b = toBase(Number(m[2]), m[3]);
    return { value: round(b.value * Number(m[1])), unit: b.unit, raw: m[0] };
  }
  // measure x N
  m = new RegExp(`${MEAS}\s*x\s*(\d+)\b`, "i").exec(t);
  if (m) {
    const b = toBase(Number(m[1]), m[2]);
    return { value: round(b.value * Number(m[3])), unit: b.unit, raw: m[0] };
  }
  m = new RegExp(MEAS, "i").exec(t);
  if (m) {
    const b = toBase(Number(m[1]), m[2]);
    const mult = /\b(?:pack|set|box|combo)\s*of\s*(\d+)\b/i.exec(t) ?? /\b(\d+)\s*packs?\b/i.exec(t);
    const k = mult ? Number(mult[1]) : 1;
    return { value: round(b.value * k), unit: b.unit, raw: mult ? `${m[0]} ${mult[0]}` : m[0] };
  }
  m = /\b(half\s+)?(\d+(?:\.\d+)?\s*)?dozen\b/i.exec(t);
  if (m) {
    const n = m[2] ? Number(m[2]) : 1;
    return { value: (m[1] ? 6 : 12 * n), unit: "unit", raw: m[0].trim() };
  }
  m = /\b(\d+)\s*(?:pcs|pc|pieces|piece|units|unit|nos|eggs|egg|count|ct|sachets|sachet)\b/i.exec(t);
  if (m) return { value: Number(m[1]), unit: "unit", raw: m[0] };
  m = /\b(?:pack|set|box|combo)\s*of\s*(\d+)\b/i.exec(t);
  if (m) return { value: Number(m[1]), unit: "unit", raw: m[0] };
  return null;
}

export type PerUnit = "100g" | "100ml" | "unit";
export function unitPrice(price: number | null, q: UnitQuantity | null): { value: number; per: PerUnit } | null {
  if (price === null || !q || q.value <= 0) return null;
  if (q.unit === "unit") return { value: Math.round((price / q.value) * 100) / 100, per: "unit" };
  return { value: Math.round((price / q.value) * 100 * 100) / 100, per: q.unit === "g" ? "100g" : "100ml" };
}

/** Quantity needed by a request, e.g. "2 kg onion" -> {amount:2000, unit:'g'}. */
export type NeedUnit = "g" | "ml" | "unit" | "pack";
export function parseNeed(text: string, qty = 1): { unit: NeedUnit; amount: number; raw: string | null } {
  const q = parseQuantity(text);
  if (!q) return { unit: "pack", amount: qty, raw: null };
  return { unit: q.unit, amount: round(q.value * qty), raw: q.raw };
}
