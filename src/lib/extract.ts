import { extractReturnPolicy, extractWarranty, parseStructuredProduct, structuredInrPrice } from "./structured";

export interface Extracted {
  title: string | null;
  price: number | null;
  mrp: number | null;
  availability: "in_stock" | "out_of_stock" | "unknown";
  offers: string[];
  imageUrl?: string;
  evidence?: string;
  /** structured / policy fields: ONLY present when read from the fetched page (JSON-LD, meta tags or visible text) */
  gtin?: string;
  sku?: string;
  mpn?: string;
  brand?: string;
  seller?: string;
  rating?: { value: number; count: number | null };
  warranty?: string;
  returnPolicy?: string;
  structuredSource?: "json-ld" | "meta";
}

/** Parse "1,79,999" / "179999" / "1,299.50" -> number. */
export function parseInr(s: string): number | null {
  const cleaned = s.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const PRICE_RE = /(?:₹|Rs\.?|INR)\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;
const MRP_MARK = /m\.?\s?r\.?\s?p|list price|original price|was\b/i;
const NOISE_NEAR = /\bemi\b|per month|\/\s?month|\/\s?mo\b|\bmonth(?:ly)?\b|\boff\b|save[ds]?\b|cashback|bank offer|exchange|ex-?price|upto|up to|coupon|discount of|delivery|shipping|extra\b|reward|protect|warranty|insurance|\bgst\b/i;

interface Cand {
  value: number;
  index: number;
  line: number;
  lineText: string;
  before: string;
  after: string;
}

function candidates(lines: string[]): Cand[] {
  const out: Cand[] = [];
  lines.forEach((lineText, line) => {
    PRICE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PRICE_RE.exec(lineText))) {
      const value = parseInr(m[1]);
      if (value === null || value < 10) continue;
      out.push({
        value,
        index: m.index,
        line,
        lineText,
        before: lineText.slice(Math.max(0, m.index - 40), m.index),
        after: lineText.slice(m.index + m[0].length, m.index + m[0].length + 40),
      });
    }
  });
  return out;
}

const isStruck = (c: Cand) => /~~\s*$/.test(c.before) || /^~~/.test(c.after);
const isMrp = (c: Cand) => MRP_MARK.test(c.before.slice(-25)) || isStruck(c);
const isNoise = (c: Cand) => NOISE_NEAR.test(c.before.slice(-30)) || /^\s*(?:off|cashback|\/\s?mo|per month|emi|discount|instant)/i.test(c.after);

const RELATED_RE = /^\s*(?:#+\s*)?(?:\*\*)?(?:similar products|similar items|customers (?:also )?(?:viewed|bought)|related products|you may also like|sponsored|frequently bought together|recommended for you|people also (?:viewed|bought)|products related to this item|more from)/i;
const NL = String.fromCharCode(10);
/** Drop everything after the first recommendation/related-products heading. */
function cutRelated(text: string): string {
  const lines = text.split(NL);
  const i = lines.findIndex((l, idx) => idx > 3 && RELATED_RE.test(l));
  return i > 0 ? lines.slice(0, i).join(NL) : text;
}

export function extractFromMarkdown(md: string, hint?: { title?: string; imageLinks?: string[] }): Extracted {
  const text = md.replace(/\r/g, "");
  const lines = text.split("\n");
  const cands = candidates(lines);

  // Price: prefer candidates on/near "Buy"/"Deal"/"Price" lines, never MRP/EMI/offer noise.
  const clean = cands.filter((c) => !isMrp(c) && !isNoise(c));
  const preferred = clean.find((c) => /\bbuy\b|deal( price)?|\bprice\b|with offer|selling price/i.test(c.before.slice(-25) + " " + c.lineText.slice(0, 40)));
  const priceC = preferred ?? clean[0];
  const price = priceC?.value ?? null;

  // MRP: marked candidate greater than price, nearest to the price candidate.
  let mrp: number | null = null;
  if (price !== null && priceC) {
    const mc = cands
      .filter((c) => isMrp(c) && c.value > price && !/\bemi\b/i.test(c.before.slice(-20)))
      .sort((a, b) => Math.abs(a.line - priceC.line) - Math.abs(b.line - priceC.line))[0];
    mrp = mc?.value ?? null;
  }

  // Title
  let title: string | null = null;
  const h1 = lines.find((l) => /^#\s+\S/.test(l));
  if (h1) title = h1.replace(/^#+\s*/, "").trim();
  if (!title && hint?.title) title = hint.title.trim();
  if (title) title = title.replace(/\s+/g, " ").slice(0, 300);

  // Availability: only the main product region counts (not "similar products" carousels); conflicting signals => unknown
  const lower = cutRelated(text).toLowerCase();
  const strongOos = /currently unavailable|out of stock|sold out|temporarily unavailable/.test(lower);
  const weakOos = /notify me/.test(lower);
  const buySignal = /add to cart|buy now|add to basket/.test(lower);
  let availability: Extracted["availability"] = "unknown";
  if (strongOos && !buySignal) availability = "out_of_stock";
  else if (weakOos && !buySignal) availability = "out_of_stock";
  else if (strongOos && buySignal) availability = "unknown";
  else if (buySignal || /\bin stock\b/.test(lower)) availability = "in_stock";

  // Offers (verbatim lines)
  const offerRe = /bank offer|cashback|no[- ]cost emi|partner offer|coupon|exchange offer|instant discount|card offer|\d+% (?:instant )?(?:off|discount)/i;
  const offers: string[] = [];
  for (const l of lines) {
    const t = l.replace(/^[\s>*\-•]+/, "").replace(/\s+/g, " ").trim();
    if (t.length >= 8 && t.length <= 300 && offerRe.test(t) && !offers.includes(t)) offers.push(t);
    if (offers.length >= 8) break;
  }

  // Image
  const imgMd = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(text);
  const imageUrl = imgMd?.[1] ?? hint?.imageLinks?.find((u) => /^https?:\/\//.test(u));

  const evidence = priceC ? priceC.lineText.replace(/\s+/g, " ").trim().slice(0, 200) : undefined;

  // Structured data (JSON-LD / meta) when the fetched text contains it
  const sp = parseStructuredProduct(text);
  const out: Extracted = { title, price, mrp, availability, offers, imageUrl, evidence };
  if (sp) {
    out.structuredSource = sp.source;
    const ldPrice = structuredInrPrice(sp);
    if (ldPrice !== null) {
      out.price = ldPrice;
      out.evidence = `${sp.source === "json-ld" ? "JSON-LD offers.price" : "meta product:price:amount"} ₹${ldPrice}`;
      if (sp.mrp && sp.mrp > ldPrice) out.mrp = sp.mrp;
      else if (out.mrp !== null && out.mrp <= ldPrice) out.mrp = null;
    }
    if (sp.availability && out.availability === "unknown") out.availability = sp.availability;
    if (!title && sp.name) out.title = sp.name.replace(/\s+/g, " ").slice(0, 300);
    if (!out.imageUrl && sp.image && /^https?:\/\//.test(sp.image)) out.imageUrl = sp.image;
    if (sp.gtin) out.gtin = sp.gtin;
    if (sp.sku) out.sku = sp.sku;
    if (sp.mpn) out.mpn = sp.mpn;
    if (sp.brand) out.brand = sp.brand;
    if (sp.seller) out.seller = sp.seller;
    if (sp.ratingValue) out.rating = { value: sp.ratingValue, count: sp.ratingCount ?? null };
    if (sp.warranty) out.warranty = sp.warranty;
    if (sp.returnPolicy) out.returnPolicy = sp.returnPolicy;
  }
  out.warranty = out.warranty ?? extractWarranty(text);
  out.returnPolicy = out.returnPolicy ?? extractReturnPolicy(text);
  return out;
}

export function discountPct(price: number | null, mrp: number | null): number | null {
  if (price === null || mrp === null || mrp <= 0 || mrp <= price) return null;
  return Math.round(((mrp - price) / mrp) * 1000) / 10;
}
