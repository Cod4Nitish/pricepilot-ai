// Deterministic parsing of structured product data (JSON-LD Product/Offer, OpenGraph/meta tags,
// warranty/return lines) from fetched page text. Nothing is inferred: missing stays undefined.

export interface StructuredProduct {
  name?: string;
  price?: number;
  priceCurrency?: string;
  mrp?: number;
  availability?: "in_stock" | "out_of_stock";
  gtin?: string;
  mpn?: string;
  sku?: string;
  image?: string;
  brand?: string;
  ratingValue?: number;
  ratingCount?: number;
  seller?: string;
  warranty?: string;
  returnPolicy?: string;
  source: "json-ld" | "meta";
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
const arr = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function toNum(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s₹]|rs\.?|inr/gi, ""));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

/** Balanced-brace JSON object extraction around every `"@type":"Product"` marker. */
export function findJsonLdProducts(text: string): Json[] {
  const out: Json[] = [];
  const seen = new Set<number>();
  const re = /"@type"\s*:\s*(?:"Product"|\[[^\]]*"Product"[^\]]*\])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // walk back to the enclosing '{'
    let depth = 0;
    let start = -1;
    for (let i = m.index; i >= 0; i--) {
      const ch = text[i];
      if (ch === "}") depth++;
      else if (ch === "{") {
        if (depth === 0) {
          start = i;
          break;
        }
        depth--;
      }
    }
    if (start < 0 || seen.has(start)) continue;
    seen.add(start);
    // walk forward to the matching '}' (string-aware)
    let d = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let i = start; i < text.length && i - start < 200_000; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") d++;
      else if (ch === "}") {
        d--;
        if (d === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) continue;
    try {
      const o = JSON.parse(text.slice(start, end + 1));
      if (isObj(o)) out.push(o);
    } catch {
      /* malformed blob: ignore */
    }
  }
  return out;
}

function availabilityOf(v: unknown): StructuredProduct["availability"] {
  const s = str(v)?.toLowerCase() ?? "";
  if (/instock|limitedavailability|onlineonly|instoreonly/.test(s)) return "in_stock";
  if (/outofstock|soldout|discontinued/.test(s)) return "out_of_stock";
  return undefined;
}

function returnText(p: unknown): string | undefined {
  for (const r of arr(p as Json | Json[] | undefined)) {
    if (!isObj(r)) continue;
    const days = toNum(r.merchantReturnDays);
    const cat = str(r.returnPolicyCategory)?.replace(/^.*\//, "");
    if (cat && /NotPermitted/i.test(cat)) return "Returns not permitted";
    if (days) return `${days}-day return`;
    if (cat && /Finite|Unlimited/i.test(cat)) return `Return policy: ${cat.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}`;
  }
  return undefined;
}

function productFromLd(p: Json): StructuredProduct {
  const out: StructuredProduct = { source: "json-ld" };
  out.name = str(p.name);
  out.sku = str(p.sku);
  out.mpn = str(p.mpn);
  out.gtin = str(p.gtin) ?? str(p.gtin13) ?? str(p.gtin12) ?? str(p.gtin14) ?? str(p.gtin8);
  const img = arr(p.image as unknown)[0];
  out.image = isObj(img) ? str(img.url) : str(img);
  const b = p.brand;
  out.brand = isObj(b) ? str(b.name) : str(b);
  if (isObj(p.aggregateRating)) {
    out.ratingValue = toNum(p.aggregateRating.ratingValue);
    out.ratingCount = toNum(p.aggregateRating.ratingCount) ?? toNum(p.aggregateRating.reviewCount);
  }
  const w = p.warranty;
  out.warranty = isObj(w) ? str(w.description) ?? str(w.name) : str(w);
  const offers = arr(p.offers as unknown).flatMap((o) => (isObj(o) && Array.isArray(o.offers) ? (o.offers as unknown[]) : [o])).filter(isObj);
  // lowest valid price among offers (AggregateOffer.lowPrice also honoured)
  let best: Json | undefined;
  let bestPrice = Infinity;
  for (const o of offers) {
    const ps = isObj(o.priceSpecification) ? o.priceSpecification : undefined;
    const pr = toNum(o.price) ?? toNum(ps?.price) ?? toNum(o.lowPrice);
    if (pr !== undefined && pr < bestPrice) {
      bestPrice = pr;
      best = o;
    }
  }
  if (best) {
    out.price = bestPrice;
    out.priceCurrency = str(best.priceCurrency) ?? (isObj(best.priceSpecification) ? str(best.priceSpecification.priceCurrency) : undefined);
    out.availability = availabilityOf(best.availability);
    const s = best.seller;
    out.seller = isObj(s) ? str(s.name) : str(s);
    out.returnPolicy = returnText(best.hasMerchantReturnPolicy);
    const high = toNum(best.highPrice);
    if (high && high > bestPrice) out.mrp = high;
    for (const sp of arr(best.priceSpecification as Json | Json[] | undefined)) {
      if (isObj(sp) && /list|msrp|mrp|strikethrough/i.test(str(sp.priceType) ?? "")) {
        const lp = toNum(sp.price);
        if (lp && lp > bestPrice) out.mrp = lp;
      }
    }
  }
  if (!out.returnPolicy) out.returnPolicy = returnText(p.hasMerchantReturnPolicy);
  return out;
}

function metaContent(text: string, key: string): string | undefined {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${k}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`, "i").exec(text);
  if (a) return a[1].trim() || undefined;
  const b = new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${k}["']`, "i").exec(text);
  return b?.[1].trim() || undefined;
}

export function productFromMeta(text: string): StructuredProduct | null {
  const price = toNum(metaContent(text, "product:price:amount") ?? metaContent(text, "og:price:amount"));
  const name = metaContent(text, "og:title");
  const image = metaContent(text, "og:image");
  if (price === undefined && !name && !image) return null;
  const av = metaContent(text, "product:availability") ?? metaContent(text, "og:availability");
  const avail = av ? (/out/i.test(av) ? "out_of_stock" : /in\s*stock|instock|available/i.test(av) ? "in_stock" : undefined) : undefined;
  return {
    source: "meta",
    name,
    image,
    price,
    priceCurrency: metaContent(text, "product:price:currency") ?? metaContent(text, "og:price:currency"),
    availability: avail,
    brand: metaContent(text, "product:brand"),
  };
}

/** Best structured product found in the text: JSON-LD (richest) merged over meta tags. */
export function parseStructuredProduct(text: string): StructuredProduct | null {
  const lds = findJsonLdProducts(text).map(productFromLd);
  const meta = productFromMeta(text);
  const ld = lds.find((p) => p.price !== undefined) ?? lds[0] ?? null;
  if (!ld) return meta;
  if (!meta) return ld;
  return { ...meta, ...Object.fromEntries(Object.entries(ld).filter(([, v]) => v !== undefined)), source: "json-ld" } as StructuredProduct;
}

/** INR (or unstated currency) price only: never treat USD etc. as rupees. */
export function structuredInrPrice(p: StructuredProduct | null): number | null {
  if (!p || p.price === undefined) return null;
  if (p.priceCurrency && p.priceCurrency.toUpperCase() !== "INR") return null;
  return p.price;
}

// ---- warranty / return lines from visible text (verbatim, no inference) ----
const WARRANTY_RE = /\b(?:\d+|one|two|three)[\s-]*(?:years?|yrs?|months?)\b[^.\n]{0,40}\bwarranty\b|\bwarranty\b[^.\n]{0,20}\b(?:\d+|one|two|three)[\s-]*(?:years?|yrs?|months?)\b/i;
const RETURN_RE = /\b\d{1,2}[\s-]*days?\b[^.\n]{0,30}\b(?:return|replacement)s?\b|\b(?:return|replacement)s?\b[^.\n]{0,20}\b\d{1,2}[\s-]*days?\b|\bnon[- ]returnable\b|\bno returns?\b/i;

function lineWith(text: string, re: RegExp): string | undefined {
  for (const raw of text.split("\n")) {
    const l = raw.replace(/^[\s>*\-•#]+/, "").replace(/\s+/g, " ").trim();
    if (l.length >= 6 && l.length <= 160 && re.test(l)) return l;
  }
  return undefined;
}
export function extractWarranty(text: string): string | undefined {
  return lineWith(text, WARRANTY_RE);
}
export function extractReturnPolicy(text: string): string | undefined {
  return lineWith(text, RETURN_RE);
}
