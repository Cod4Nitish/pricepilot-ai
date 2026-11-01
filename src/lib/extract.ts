import { isWidgetTitle } from "./match";
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
const NOISE_NEAR = /\bemi\b|per month|\/\s?month|\/\s?mo\b|\bmonth(?:ly)?\b|\boff\b|save[ds]?\b|cashback|bank offer|exchange|ex-?price|upto|up to|coupon|discount of|delivery|shipping|extra\b|reward|protect|warranty|insurance|\bgst\b|\bworth\b|more than|less than|\bfree\b|\bgift\b|\bfreebie|installation|exchange value|bonus/i;

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
const isNoise = (c: Cand) =>
  NOISE_NEAR.test(c.before.slice(-30)) ||
  /^\s*(?:off|cashback|\/\s?mo|per month|emi|discount|instant|free\b)/i.test(c.after) ||
  // ranges such as "Phones Between Rs 50,001-70,000" (insurance/protection plans) are never a selling price
  /^\s*[-–]\s*(?:₹|rs\.?)?\s*\d/i.test(c.after) ||
  /\b(?:between|from|for phones|above|below|under)\s*$/i.test(c.before);
/** Explicit selling-price markers (Amazon "One-time purchase: ₹X" / "₹X with 27 percent savings"). */
const isStrongPrice = (c: Cand) => /one-time purchase:?\s*$/i.test(c.before) || /^\s*with \d+ percent savings/i.test(c.after);

const RELATED_RE = /^\s*(?:#+\s*)?(?:\*\*)?(?:similar products|similar items|customers (?:also )?(?:viewed|bought)|related products|you may also like|sponsored|frequently bought together|recommended for you|people also (?:viewed|bought)|products related to this item|more from)/i;
const NL = String.fromCharCode(10);
/** Drop everything after the first recommendation/related-products heading. */
function cutRelated(text: string): string {
  const lines = text.split(NL);
  const i = lines.findIndex((l, idx) => idx > 3 && RELATED_RE.test(l));
  return i > 0 ? lines.slice(0, i).join(NL) : text;
}

/** Remove sections under non-product H1 headings (Amazon "# Add to your order" insurance/add-on blocks). */
export function dropJunkSections(text: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const l of text.split(NL)) {
    if (/^#\s+\S/.test(l)) skipping = isWidgetTitle(l.replace(/^#+\s*/, ""));
    if (!skipping) out.push(l);
  }
  return out.join(NL);
}

const BAD_IMG = /\.svg(?:$|\?)|\.gif(?:$|\?)|sprite|logo|pixel|uedata|fls-[a-z]+\.amazon|\/images\/G\/|\/images\/S\/|flixcart\.com\/www\/|promos|cms-|brand-images|icon|badge|banner|placeholder|play-icon/i;
/** Declared pixel size of a retailer CDN image URL, if the URL encodes one. */
function declaredSize(u: string): number | null {
  const fk = /\/image\/(\d+)\/(\d+)\//.exec(u);
  if (fk) return Math.min(Number(fk[1]), Number(fk[2]));
  const sizes = [...u.matchAll(/[._](?:SL|SX|SY|SS|UL|UX|UY|AC_SL|AC_SX|AC_SY)(\d{2,4})/g)].map((m) => Number(m[1]));
  return sizes.length ? Math.min(...sizes) : null;
}
/** The main product photo: no logos/sprites/promos/tracking pixels/tiny thumbnails; on Amazon the largest gallery image. */
export function pickProductImage(urls: string[]): string | undefined {
  const ok = urls.filter((u) => /^https:\/\//.test(u) && !BAD_IMG.test(u)).filter((u) => (declaredSize(u) ?? 300) >= 200);
  if (!ok.length) return undefined;
  const amazon = ok.filter((u) => /media-amazon\.com\/images\/I\//.test(u));
  if (amazon.length) return [...amazon].sort((a, b) => (declaredSize(b) ?? 0) - (declaredSize(a) ?? 0))[0];
  return ok[0];
}

export function extractFromMarkdown(md: string, hint?: { title?: string; description?: string; imageLinks?: string[] }): Extracted {
  const text = dropJunkSections(md.replace(/\r/g, ""));
  const lines = text.split("\n");
  const cands = candidates(lines);

  // Price: explicit selling-price markers first, then candidates on/near "Buy"/"Deal"/"Price" lines; never MRP/EMI/offer noise.
  const clean = cands.filter((c) => !isMrp(c) && !isNoise(c));
  const strong = clean.find(isStrongPrice);
  const preferred = clean.find((c) => /\bbuy\b|deal( price)?|\bprice\b|with offer|selling price/i.test(c.before.slice(-25) + " " + c.lineText.slice(0, 40)));
  const priceC = strong ?? preferred ?? clean[0];
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
  const h1 = lines.map((l) => (/^#\s+\S/.test(l) ? l.replace(/^#+\s*/, "").trim() : "")).find((t) => t && !isWidgetTitle(t));
  if (h1) title = h1;
  if (!title && hint?.title && !isWidgetTitle(hint.title)) title = hint.title.trim();
  // Amazon's meta description carries the full variant: "<title> (Colour, 8GB, 128GB Storage) : Amazon.in: Electronics"
  const desc = hint?.description?.replace(/\s*:\s*Amazon\.in\b.*$/i, "").trim();
  if (desc && desc !== hint?.description?.trim() && (!title || desc.toLowerCase().startsWith(title.toLowerCase().slice(0, 20)))) title = desc;
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
  const mdImgs = [...text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
  const imageUrl = pickProductImage([...mdImgs, ...(hint?.imageLinks ?? [])]);

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
