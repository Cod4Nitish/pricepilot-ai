// Product entity extraction from free text (query or listing title), GTIN handling and fuzzy similarity.
import { createHash } from "node:crypto";
import { parseMaxPrice, parseStorageRam } from "../../match";

const BRAND_WORDS = new Set([
  "apple", "samsung", "oneplus", "xiaomi", "realme", "oppo", "vivo", "iqoo", "motorola", "nothing", "google", "sony", "lg", "hp", "dell",
  "lenovo", "asus", "acer", "msi", "boat", "jbl", "bose", "mi", "nokia", "honor", "infinix", "tecno", "lava", "panasonic", "whirlpool",
  "godrej", "voltas", "daikin", "bosch", "philips", "canon", "nikon", "amul", "nestle", "tata", "britannia",
]);
/** Sub-brands / product lines that imply a brand but remain part of the model name. */
export const BRAND_ALIAS: Record<string, string> = {
  galaxy: "samsung", iphone: "apple", ipad: "apple", macbook: "apple", airpods: "apple", pixel: "google", redmi: "xiaomi", poco: "xiaomi",
  thinkpad: "lenovo", ideapad: "lenovo", vivobook: "asus", zenbook: "asus", rog: "asus", inspiron: "dell", xps: "dell", pavilion: "hp",
  playstation: "sony", ps5: "sony", bravia: "sony", nord: "oneplus", mi: "xiaomi",
};
export const COLOR_WORDS = new Set([
  "black", "white", "blue", "green", "red", "gold", "silver", "grey", "gray", "purple", "pink", "yellow", "orange", "titanium", "graphite",
  "violet", "cream", "lavender", "midnight", "starlight", "natural", "desert", "cobalt", "onyx", "amber", "mint", "teal", "marble", "lilac",
]);
/** Generation/edition suffixes that denote a different product when they differ. */
export const SUFFIXES = new Set(["ultra", "plus", "pro", "max", "fe", "mini", "lite", "se", "neo", "edge", "fold", "flip", "gt", "turbo", "air", "note"]);
const STOP = new Set([
  "buy", "price", "best", "new", "phone", "mobile", "smartphone", "with", "for", "in", "india", "online", "5g", "4g", "lte", "the", "and", "gb", "tb", "ram",
  "storage", "under", "below", "cheapest", "cheap", "lowest", "of", "a", "an", "to", "latest", "original", "brand", "sealed", "refurbished", "renewed", "used",
  "pre", "owned", "unlocked", "dual", "sim", "rs", "inr", "from", "on", "at", "by", "or", "mobiles", "rom", "color", "colour", "upto", "my", "me", "get", "need", "want",
  "pcs", "pc", "pieces", "units", "pack", "packs", "open", "box", "certified", "second", "hand", "warranty", "year", "years", "smart", "display", "camera", "battery", "processor",
]);
const REFURB_RE = /\b(refurbished|renewed|pre[- ]owned|second[- ]hand|used|open box)\b/i;

export interface Entity {
  brand: string | null;
  /** tokens without brand/colour/storage words (line name, model numbers, suffixes) */
  tokens: string[];
  modelNumbers: string[];
  suffixes: string[];
  storageGb: number | null;
  ramGb: number | null;
  colors: string[];
  condition: "new" | "refurbished";
  gtins: string[];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/(\w)\+/g, "$1 plus")
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:gb|tb|mah|hz|mp|w|watt|watts|inch|inches|ltr|l|kg|ml|cm)\b/g, " ")
    .replace(/\b\d+\s*(?:pcs|pc|pieces|piece|units|packs|pack)\b/g, " ")
    .replace(/\bpack of \d+\b/g, " ")
    .replace(/[₹"(),|/\\\-_:;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitGlue(tok: string): string[] {
  const m = /^([a-z]{4,})(\d+)([a-z]*)$/.exec(tok);
  if (m) {
    const out = [m[1]];
    if (m[3] && SUFFIXES.has(m[3])) out.push(m[2], m[3]);
    else out.push(m[2] + m[3]);
    return out;
  }
  const m2 = /^([a-z]*\d+)(ultra|plus|pro|max|fe|mini|lite)$/.exec(tok);
  if (m2) return [m2[1], m2[2]];
  return [tok];
}

export function canonicalBrand(b: string | null | undefined): string | null {
  if (!b) return null;
  const x = b.toLowerCase();
  return BRAND_ALIAS[x] ?? x;
}

export function entityFromText(text: string): Entity {
  const { storageGb, ramGb } = parseStorageRam(text);
  const norm = normalize(text);
  const raw = norm.split(/[^a-z0-9]+/).filter(Boolean).flatMap(splitGlue);
  let brand: string | null = null;
  for (const w of raw) {
    if (BRAND_WORDS.has(w)) {
      brand = canonicalBrand(w);
      break;
    }
  }
  if (!brand) for (const w of raw) if (BRAND_ALIAS[w]) { brand = BRAND_ALIAS[w]; break; }
  const colors = [...new Set(raw.filter((w) => COLOR_WORDS.has(w)))];
  const tokens = [...new Set(raw.filter((w) => !STOP.has(w) && !COLOR_WORDS.has(w) && !BRAND_WORDS.has(w)))];
  return {
    brand,
    tokens,
    modelNumbers: tokens.filter((w) => /\d/.test(w) && !/^(19|20)\d\d$/.test(w)),
    suffixes: tokens.filter((w) => SUFFIXES.has(w)),
    storageGb: storageGb ?? null,
    ramGb: ramGb ?? null,
    colors,
    condition: REFURB_RE.test(text) ? "refurbished" : "new",
    gtins: extractGtins(text),
  };
}

// ---- GTIN ----
export function gtinCheckDigitValid(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  digits.reverse().forEach((d, i) => (sum += d * (i % 2 === 0 ? 3 : 1)));
  return (10 - (sum % 10)) % 10 === check;
}
export const normGtin = (c: string) => c.padStart(14, "0");

/** Extract GTIN/EAN/UPC from page markdown or JSON-LD. Only returns codes with a valid check digit. */
export function extractGtins(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  const re = /\b(?:gtin(?:8|12|13|14)?|ean(?:13)?|upc(?:-a)?|barcode)\b["']?\s*[:=#-]?\s*["']?\s*(\d{8,14})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (gtinCheckDigitValid(m[1])) out.add(normGtin(m[1]));
  return [...out];
}

/** A user query that is itself a GTIN (e.g. a scanned barcode). */
export function queryGtin(q: string): string | null {
  const m = /^\s*(\d{8}|\d{12,14})\s*$/.exec(q);
  return m && gtinCheckDigitValid(m[1]) ? normGtin(m[1]) : null;
}

// ---- Similarity ----
function trigrams(s: string): Set<string> {
  const t = ` ${s.replace(/[^a-z0-9]+/g, " ").trim()} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}
export function trigramJaccard(a: string, b: string): number {
  const A = trigrams(a.toLowerCase());
  const B = trigrams(b.toLowerCase());
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}
export function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(/[^a-z0-9]+/).filter(Boolean).flatMap(splitGlue).filter((w) => !STOP.has(w)));
}
/** Token-set ratio: blend of query-token coverage and Dice overlap (order independent). */
export function tokenSetRatio(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i++;
  return 0.7 * (i / A.size) + 0.3 * ((2 * i) / (A.size + B.size));
}
export function fuzzyScore(query: string, title: string): number {
  return Math.round((0.75 * tokenSetRatio(query, title) + 0.25 * Math.min(1, trigramJaccard(query, title) * 2)) * 1000) / 1000;
}

/** Stable product id = hash of the resolved entity key (GTIN when known, else brand+model+storage+ram+condition+suffix). */
export function entityKey(e: Entity): string {
  if (e.gtins[0]) return `gtin:${e.gtins[0]}`;
  return ["b", e.brand ?? "", "m", [...e.tokens].sort().join("-"), "s", e.storageGb ?? "", "r", e.ramGb ?? "", "c", e.condition].join("|");
}
export function productIdFor(e: Entity): string {
  return createHash("sha1").update(entityKey(e)).digest("hex").slice(0, 16);
}

// ---- Query parsing (extends match.parseMaxPrice with urgency/budget/GTIN) ----
export interface EcomQuery {
  raw: string;
  entity: Entity;
  budget: number | null;
  urgent: boolean;
  gtin: string | null;
}
export function parseEcomQuery(raw: string): EcomQuery {
  const { maxPrice, cleaned } = parseMaxPrice(raw);
  const gtin = queryGtin(raw);
  const entity = entityFromText(cleaned);
  if (gtin) entity.gtins = [gtin];
  return { raw, entity, budget: maxPrice ?? null, urgent: /\b(urgent|asap|today|tomorrow|fast delivery|immediately|now)\b/i.test(raw), gtin };
}
