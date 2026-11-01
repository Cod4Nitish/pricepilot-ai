// Hard user requirements that must hold BEFORE ranking or display: explicitly requested brand and product type.
// A verified retailer price never makes a product match the request. Pure, deterministic.
import type { ParsedQuery } from "./types";

export type ProductType = "headphones" | "earbuds" | "neckband" | "headset" | "speaker" | "mouse" | "keyboard" | "controller" | "monitor";

// Brand aliases: product-line names that identify a brand when the brand word itself is missing from a title.
const BRAND_ALIASES: Record<string, RegExp> = {
  apple: /\b(apple|iphone|ipad|macbook|airpods|imac)\b/i,
  samsung: /\b(samsung|galaxy)\b/i,
  google: /\b(google|pixel)\b/i,
  oneplus: /\b(oneplus|one plus|nord)\b/i,
  xiaomi: /\b(xiaomi|redmi|mi)\b/i,
  sony: /\b(sony|playstation|bravia|xperia)\b/i,
  realme: /\brealme\b/i,
  boat: /\bboat\b/i,
  jbl: /\bjbl\b/i,
  logitech: /\b(logitech|logi)\b/i,
};

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Does this product name belong to the requested brand? */
export function brandMatches(name: string, brand: string): boolean {
  const b = norm(brand);
  const re = BRAND_ALIASES[b] ?? new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(name);
}

/** Product type stated by a product name (null when the name does not say). */
export function productTypeOf(name: string): ProductType | null {
  const t = name.toLowerCase();
  // Sony model families: WH = over-ear headphones, WF = true-wireless earbuds, WI = neckband
  // case-sensitive model codes (WH-CH520, WF-1000XM5, WI-C100); never plain words such as "Wireless" / "Wired"
  const sony = /\bW([HFI])-(?:[A-Z]{1,3}\d|\d{3,4})/.exec(name);
  if (sony) return sony[1] === "F" ? "earbuds" : sony[1] === "I" ? "neckband" : "headphones";
  if (/neckband/.test(t)) return "neckband";
  if (/\b(tws|earbuds?|buds|airpods|true wireless|in-ear earphones?)\b/.test(t)) return "earbuds";
  if (/\bheadsets?\b/.test(t)) return "headset";
  if (/\b(headphones?|over[- ]ear|on[- ]ear)\b/.test(t)) return "headphones";
  if (/\bspeakers?\b|soundbar/.test(t)) return "speaker";
  if (/\bmouse\b|\bmice\b/.test(t)) return "mouse";
  if (/\bkeyboard\b/.test(t)) return "keyboard";
  if (/\b(controller|gamepad|joystick)\b/.test(t)) return "controller";
  if (/\bmonitor\b/.test(t)) return "monitor";
  return null;
}

/** Product type the USER asked for (from the raw query), else null. */
export function requestedProductType(raw: string): ProductType | null {
  const t = raw.toLowerCase();
  if (/neckband/.test(t)) return "neckband";
  if (/\b(tws|earbuds?|buds|airpods|true wireless)\b/.test(t)) return "earbuds";
  if (/\bheadsets?\b/.test(t)) return "headset";
  if (/\bheadphones?\b|over[- ]ear|on[- ]ear/.test(t)) return "headphones";
  if (/\b(speaker|soundbar)s?\b/.test(t)) return "speaker";
  if (/\bmouse\b|\bmice\b/.test(t)) return "mouse";
  if (/\bkeyboards?\b/.test(t)) return "keyboard";
  if (/\b(controller|gamepad)s?\b/.test(t)) return "controller";
  if (/\bmonitors?\b/.test(t)) return "monitor";
  return null;
}

export interface RequirementCheck {
  ok: boolean;
  reason: string | null;
}

/**
 * Hard requirements: requested brand must match; requested product type must not contradict the name.
 * A name that does not state its type is kept (it cannot be shown to contradict), the brand is never relaxed.
 */
export function meetsRequirements(name: string, parsed: Pick<ParsedQuery, "brand" | "raw">): RequirementCheck {
  if (parsed.brand && !brandMatches(name, parsed.brand)) return { ok: false, reason: `not ${parsed.brand} (you asked for ${parsed.brand})` };
  const want = requestedProductType(parsed.raw);
  if (want) {
    const got = productTypeOf(name);
    if (got && got !== want) return { ok: false, reason: `${got}, not ${want}` };
  }
  return { ok: true, reason: null };
}

/** Honest empty-state text when the requirements removed everything. */
export function requirementsEmptyMessage(parsed: Pick<ParsedQuery, "brand" | "raw" | "budgetMax">): string | null {
  const want = requestedProductType(parsed.raw);
  if (!parsed.brand && !want) return null;
  const what = [parsed.brand ? parsed.brand.charAt(0).toUpperCase() + parsed.brand.slice(1) : null, want].filter(Boolean).join(" ");
  const budget = parsed.budgetMax !== null ? ` within ₹${parsed.budgetMax.toLocaleString("en-IN")}` : "";
  return `No verified ${what || "matching product"}${budget} was found. Other brands or product types are not shown because you asked for ${what}. Remove the brand or type from your search to see alternatives.`;
}
