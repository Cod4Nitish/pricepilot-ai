import type { ProductSpec } from "./types";

export interface ParsedQuery extends ProductSpec {
  rawQuery: string;
  maxPrice?: number;
  /** normalized model tokens (brand/storage/color/price phrases removed) */
  modelTokens: string[];
}

const BRANDS = [
  "apple", "samsung", "oneplus", "xiaomi", "redmi", "poco", "realme", "oppo", "vivo", "iqoo", "motorola", "nothing",
  "google", "sony", "lg", "hp", "dell", "lenovo", "asus", "acer", "msi", "boat", "jbl", "bose", "mi", "nokia", "honor",
  "infinix", "tecno", "lava", "panasonic", "whirlpool", "godrej", "voltas", "daikin", "bosch", "philips", "canon", "nikon",
];
const COLORS = [
  "black", "white", "blue", "green", "red", "gold", "silver", "grey", "gray", "purple", "pink", "yellow", "orange",
  "titanium", "graphite", "violet", "cream", "lavender", "midnight", "starlight", "natural", "desert", "cobalt", "onyx", "amber", "mint", "teal",
];
const VARIANTS = new Set(["ultra", "plus", "pro", "max", "fe", "mini", "lite", "se", "air", "neo", "edge", "fold", "flip", "note", "turbo", "gt", "prime"]);
const STOP = new Set([
  "buy", "price", "best", "new", "phone", "mobile", "smartphone", "with", "for", "in", "india", "online", "5g", "4g", "the", "and",
  "gb", "tb", "ram", "storage", "under", "below", "cheapest", "cheap", "lowest", "of", "a", "an", "to", "latest", "original", "brand", "sealed",
  "refurbished", "renewed", "used", "pre", "owned", "unlocked", "dual", "sim", "rs", "inr",
]);
// "max" is both a variant (Pro Max) and a stop word in "max price"; treat as variant only when not preceded by price words.

const REFURB_RE = /\b(refurbished|renewed|pre[- ]owned|second[- ]hand|used|open box|certified refurbished)\b/i;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(\d{1,2})[/+](\d{2,4})\s*(?:gb)?\b/g, "$1x$2gb")
    .replace(/(\w)\+/g, "$1 plus")
    .replace(/₹/g, " ₹")
    .replace(/[(),|/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseStorageRam(text: string): { storageGb?: number; ramGb?: number } {
  const t = normalize(text);
  let ram: number | undefined;
  let storage: number | undefined;
  const rest: number[] = [];
  const re = /(\d+)\s*(gb|tb)\b(\s*(?:ram|memory))?/g;
  let m: RegExpExecArray | null;
  const t2 = t.replace(/\b\d{1,2}x\d{2,4}\s*gb\b/g, " ");
  while ((m = re.exec(t2))) {
    const n = Number(m[1]) * (m[2] === "tb" ? 1024 : 1);
    if (m[3]) ram = ram ?? n;
    else rest.push(n);
  }
  // "8/256" or "8 + 256" patterns without units on the first number
  const pair = /\b(\d{1,2})x(\d{2,4})\s*gb\b/.exec(t);
  if (pair) {
    ram = ram ?? Number(pair[1]);
    storage = Number(pair[2]);
  }
  for (const n of rest) {
    if (storage === undefined && n >= 32) storage = n;
    else if (ram === undefined && n < 32) ram = n;
  }
  if (storage === undefined && rest.length === 0) return { ramGb: ram };
  return { storageGb: storage, ramGb: ram };
}

export function parseMaxPrice(q: string): { maxPrice?: number; cleaned: string } {
  const re = /\b(?:under|below|less than|within|upto|up to|max(?:imum)?(?: price)?|budget)\s*(?:of\s*)?(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(k|l|lakh|lac)?\b/i;
  const m = re.exec(q) ?? /[<]\s*(?:₹|rs\.?)?\s*([\d,]+)\s*(k)?/i.exec(q);
  if (!m) return { cleaned: q };
  let n = Number(m[1].replace(/,/g, ""));
  const u = (m[2] ?? "").toLowerCase();
  if (u === "k") n *= 1000;
  else if (u) n *= 100000;
  return { maxPrice: Number.isFinite(n) && n > 0 ? n : undefined, cleaned: q.replace(m[0], " ") };
}

export function parseQuery(raw: string): ParsedQuery {
  const { maxPrice, cleaned } = parseMaxPrice(raw);
  const norm = normalize(cleaned);
  const { storageGb, ramGb } = parseStorageRam(norm);
  const condition: ProductSpec["condition"] = REFURB_RE.test(norm) ? "refurbished" : "new";

  const words = norm.replace(/\b\d{1,2}x\d{2,4}\s*gb\b/g, " ").replace(/\d+\s*(gb|tb)\b/g, " ").split(/[^a-z0-9₹]+/).filter(Boolean);
  const brand = words.find((w) => BRANDS.includes(w));
  const color = words.find((w) => COLORS.includes(w));
  const tokens = [...new Set(words.filter((w) => w !== brand && !COLORS.includes(w) && !/^₹/.test(w) && !STOP.has(w)))];
  return {
    rawQuery: raw,
    maxPrice,
    brand: brand === "mi" ? "xiaomi" : brand,
    model: tokens.join(" ") || undefined,
    storageGb,
    ramGb,
    color,
    condition,
    modelTokens: tokens,
  };
}

export interface MatchResult {
  confidence: number;
  notes: string[];
  hardExcluded: boolean;
  spec: ProductSpec;
}

export function specFromTitle(title: string): ProductSpec {
  const t = normalize(title);
  const { storageGb, ramGb } = parseStorageRam(t);
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  return {
    brand: words.find((w) => BRANDS.includes(w)),
    storageGb,
    ramGb,
    color: words.find((w) => COLORS.includes(w)),
    condition: REFURB_RE.test(t) ? "refurbished" : "new",
  };
}

export function scoreListing(q: ParsedQuery, title: string): MatchResult {
  const notes: string[] = [];
  const spec = specFromTitle(title);
  const t = normalize(title);
  const tTokens = new Set(t.split(/[^a-z0-9]+/).filter(Boolean));
  // "s24ultra" style / "iphone15" glue: also index prefix-split tokens
  const exclude = (why: string): MatchResult => ({ confidence: 0, notes: [...notes, why], hardExcluded: true, spec });

  // condition
  const wantRefurb = q.condition === "refurbished";
  const isRefurb = spec.condition === "refurbished";
  if (wantRefurb !== isRefurb) {
    return exclude(isRefurb ? "Excluded: listing is refurbished/used but a new product was requested." : "Excluded: refurbished was requested but listing appears new.");
  }

  // strict model tokens (contain a digit) and variants
  const strict = q.modelTokens.filter((w) => /\d/.test(w));
  for (const w of strict) {
    if (!tTokens.has(w) && !t.replace(/[^a-z0-9]/g, "").includes(w)) return exclude(`Excluded: model/generation "${w}" not found in listing title.`);
  }
  const qVariants = new Set(q.modelTokens.filter((w) => VARIANTS.has(w)));
  const lVariants = new Set([...tTokens].filter((w) => VARIANTS.has(w) && !(w === "max" && !tTokens.has("pro"))));
  // "air"/"note"/"prime" etc. in marketing copy are weak; only compare the core variant set
  const core = new Set(["ultra", "plus", "pro", "max", "fe", "mini", "lite", "se", "neo", "edge", "fold", "flip", "gt", "turbo"]);
  for (const v of lVariants) if (core.has(v) && !qVariants.has(v)) return exclude(`Excluded: different variant "${v}" (query did not ask for it).`);
  for (const v of qVariants) if (!lVariants.has(v)) return exclude(`Excluded: requested variant "${v}" not in listing.`);

  // storage / ram
  let score = 0.8;
  if (q.storageGb !== undefined) {
    if (spec.storageGb === undefined) {
      score -= 0.25;
      notes.push("Storage not stated in listing title.");
    } else if (spec.storageGb !== q.storageGb) {
      return exclude(`Excluded: ${spec.storageGb}GB storage listed, ${q.storageGb}GB requested.`);
    } else {
      score += 0.08;
      notes.push(`Storage ${q.storageGb}GB matches.`);
    }
  }
  if (q.ramGb !== undefined && spec.ramGb !== undefined) {
    if (spec.ramGb !== q.ramGb) return exclude(`Excluded: ${spec.ramGb}GB RAM listed, ${q.ramGb}GB requested.`);
    score += 0.04;
  }

  // soft tokens
  const soft = q.modelTokens.filter((w) => !/\d/.test(w) && !VARIANTS.has(w));
  if (soft.length) {
    const hit = soft.filter((w) => tTokens.has(w)).length;
    const frac = hit / soft.length;
    if (frac < 0.5) {
      score -= 0.35;
      notes.push("Several query words are missing from the listing title.");
    } else if (frac < 1) score -= 0.1;
  }
  if (strict.length === 0 && soft.length === 0) score -= 0.3;

  if (q.brand) {
    if (spec.brand && spec.brand !== q.brand && !(q.brand === "xiaomi" && spec.brand === "mi")) return exclude(`Excluded: brand ${spec.brand} differs from ${q.brand}.`);
    if (spec.brand === q.brand) score += 0.05;
  }
  if (q.color) {
    if (spec.color && spec.color !== q.color) {
      score -= 0.25;
      notes.push(`Colour ${spec.color} differs from requested ${q.color}.`);
    } else if (spec.color === q.color) score += 0.03;
  }
  if (notes.length === 0) notes.push("Title matches query terms.");
  return { confidence: Math.max(0, Math.min(1, Math.round(score * 100) / 100)), notes, hardExcluded: false, spec };
}
