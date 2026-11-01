import type { PackSize, UnitPrice } from "./types";

const W = "kg|kgs|g|gm|gms|gram|grams";
const V = "l|ltr|ltrs|litre|litres|liter|liters|ml";
const MEASURE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${W}|${V})\\b`, "i");
const MULTI = new RegExp(`(\\d+)\\s*(?:x|×)\\s*(\\d+(?:\\.\\d+)?)\\s*(${W}|${V})\\b`, "i");
const PACK_OF = /\b(?:pack|set|box|carton)\s*of\s*(\d+)\b/i;
const COUNT = /(\d+)\s*(?:pcs|pc|pieces|piece|units|unit|nos|eggs|egg|sachets|sachet|bars|bar|tablets|count|ct|packs|pouches)\b/i;
const WEIGHT_UNITS = new RegExp(`^(${W})$`);

function measureToBase(n: number, unit: string): { kind: "weight" | "volume"; total: number } {
  const u = unit.toLowerCase();
  if (u === "kg" || u === "kgs") return { kind: "weight", total: n * 1000 };
  if (WEIGHT_UNITS.test(u)) return { kind: "weight", total: n };
  if (u === "ml") return { kind: "volume", total: n };
  return { kind: "volume", total: n * 1000 };
}

function fmt(kind: PackSize["kind"], total: number, mult: number): string {
  if (kind === "count") return `${total} ${total === 1 ? "unit" : "units"}`;
  const per = total / mult;
  const base = kind === "weight" ? (per >= 1000 ? `${per / 1000} kg` : `${per} g`) : per >= 1000 ? `${per / 1000} L` : `${per} ml`;
  return mult > 1 ? `${mult} x ${base}` : base;
}

/** Parse a pack size from text like "500 ml", "1 L", "Pack of 12", "6 eggs", "2 x 500 g". Null if not stated. */
export function parsePack(text: string | null | undefined): PackSize | null {
  if (!text) return null;
  const t = text.replace(/,/g, "");
  const multi = MULTI.exec(t);
  if (multi) {
    const count = Number(multi[1]);
    const m = measureToBase(Number(multi[2]), multi[3]);
    if (count > 0 && m.total > 0) return { kind: m.kind, total: count * m.total, label: fmt(m.kind, count * m.total, count) };
  }
  const meas = MEASURE.exec(t);
  const packOf = PACK_OF.exec(t);
  if (meas) {
    const m = measureToBase(Number(meas[1]), meas[2]);
    if (!(m.total > 0)) return null;
    const mult = packOf ? Math.max(1, Number(packOf[1])) : 1;
    return { kind: m.kind, total: m.total * mult, label: fmt(m.kind, m.total * mult, mult) };
  }
  const cnt = COUNT.exec(t);
  const n = cnt ? Number(cnt[1]) : packOf ? Number(packOf[1]) : NaN;
  if (Number.isFinite(n) && n > 0) return { kind: "count", total: n, label: fmt("count", n, 1) };
  return null;
}

export function samePack(a: PackSize | null, b: PackSize | null): boolean {
  return !!a && !!b && a.kind === b.kind && Math.abs(a.total - b.total) < 1e-6;
}

/** Unit price only when the pack size was parsed and price is valid. */
export function unitPrice(price: number | null, pack: PackSize | null): UnitPrice | null {
  if (price === null || !Number.isFinite(price) || price <= 0 || !pack || !(pack.total > 0)) return null;
  const r = (n: number) => Math.round(n * 100) / 100;
  if (pack.kind === "weight") return { value: r((price / pack.total) * 100), per: "100g" };
  if (pack.kind === "volume") return { value: r((price / pack.total) * 100), per: "100ml" };
  return { value: r(price / pack.total), per: "unit" };
}

/** Delivery ETA minutes from published text only. Ranges use the upper bound (conservative). Unparseable -> null. */
export function parseEtaMinutes(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const mins = /(\d+)(?:\s*(?:-|–|to)\s*(\d+))?\s*(?:min|mins|minute|minutes)\b/.exec(t);
  if (mins) return Number(mins[2] ?? mins[1]);
  const hrs = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(?:hr|hrs|hour|hours)\b/.exec(t);
  if (hrs) return Math.round(Number(hrs[2] ?? hrs[1]) * 60);
  return null;
}
