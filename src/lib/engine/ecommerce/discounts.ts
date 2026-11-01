// Bank / coupon / EMI offer parsing and eligibility. Default: nothing is applied.
import type { ConditionalDiscount, UnifiedOffer } from "../schema";

export interface PaymentOptions {
  cards?: string[];
  coupons?: string[];
}

const INSTRUMENTS = [
  "hdfc", "icici", "sbi", "axis", "kotak", "amex", "american express", "bob", "bank of baroda", "idfc", "yes bank", "citi", "rbl", "onecard", "federal", "indusind", "au bank", "pnb", "canara", "hsbc", "standard chartered", "amazon pay", "paytm", "upi",
];
const inr = (s: string) => Number(s.replace(/,/g, ""));
const AMT = String.raw`(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)`;

export function parseDiscountText(text: string, listedPrice: number | null = null): ConditionalDiscount {
  const t = text.replace(/\s+/g, " ").trim();
  const low = t.toLowerCase();
  const instruments = INSTRUMENTS.filter((i) => new RegExp(`\\b${i}\\b`).test(low)).map((i) => (i === "american express" ? "amex" : i === "bank of baroda" ? "bob" : i));
  const isEmi = /\bemi\b/.test(low);
  const codeM = /\b(?:coupon|code|promo)\b[^A-Za-z0-9]{0,12}([A-Z0-9]{4,15})\b/.exec(t);
  const kind: ConditionalDiscount["kind"] = codeM || /\bcoupon\b/.test(low) ? "coupon" : isEmi ? "emi" : instruments.length || /\b(bank|card)\b/.test(low) ? "bank" : "other";

  let amount: number | null = null;
  const flat = new RegExp(`(?:flat|get|save|extra|instant)?\\s*${AMT}\\s*(?:instant\\s*)?(?:off|discount|cashback)`, "i").exec(t) ?? new RegExp(`(?:off|discount|cashback)\\s*(?:of\\s*)?${AMT}`, "i").exec(t);
  const pct = /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:instant\s*)?(?:off|discount|cashback)/i.exec(t);
  const cap = new RegExp(`(?:up\\s*to|upto|max(?:imum)?)\\s*${AMT}`, "i").exec(t);
  if (pct) {
    // percentage: amount only when computable from a known price (respecting an explicit cap)
    if (listedPrice !== null) {
      const raw = (listedPrice * Number(pct[1])) / 100;
      amount = Math.round((cap ? Math.min(raw, inr(cap[1])) : raw) * 100) / 100;
    }
  } else if (flat) {
    amount = inr(flat[1]);
  } else if (cap && /off|discount|cashback/i.test(t)) {
    amount = null; // "up to X" is a ceiling, not an explicit amount
  }
  if (isEmi && !flat && !pct) amount = null;

  const minM = new RegExp(`(?:min(?:imum)?\\.?\\s*(?:purchase|order|spend|cart|transaction)?(?:\\s*of)?|on\\s+(?:orders?|purchases?)\\s+(?:of|above|over)|above|over|valid on)\\s*${AMT}`, "i").exec(t);
  const minOrder = minM ? inr(minM[1]) : null;

  const condParts: string[] = [];
  if (instruments.length) condParts.push(`Payment with ${instruments.map((i) => i.toUpperCase()).join("/")} ${/debit/i.test(t) ? "debit card" : /credit/i.test(t) ? "credit card" : "card/instrument"}`);
  if (codeM) condParts.push(`Apply code ${codeM[1]}`);
  if (isEmi) condParts.push("EMI transaction");
  if (minOrder !== null) condParts.push(`Minimum order ₹${minOrder}`);
  if (pct && cap) condParts.push(`Capped at ₹${inr(cap[1])}`);
  const condition = condParts.length ? condParts.join("; ") : "Conditions not stated; unverified";
  return { text: t, amount, condition, applied: false, kind, instruments, code: codeM ? codeM[1] : null, minOrder };
}

export function parseDiscountTexts(texts: string[], listedPrice: number | null): ConditionalDiscount[] {
  const out: ConditionalDiscount[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    if (!t || !/(off|discount|cashback|emi|coupon|bank|offer)/i.test(t)) continue;
    const d = parseDiscountText(t, listedPrice);
    if (seen.has(d.text)) continue;
    seen.add(d.text);
    out.push(d);
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Is this discount's condition satisfied by what the USER selected? Never true by default. */
export function isEligible(d: ConditionalDiscount, listedPrice: number | null, opts: PaymentOptions): boolean {
  if (d.amount === null || d.amount <= 0) return false;
  if (d.minOrder != null && (listedPrice === null || listedPrice < d.minOrder)) return false;
  if (d.kind === "coupon" && d.code) return (opts.coupons ?? []).some((c) => norm(c) === norm(d.code ?? ""));
  if ((d.kind === "bank" || d.kind === "emi") && d.instruments?.length) {
    const cards = (opts.cards ?? []).map(norm);
    return d.instruments.some((i) => cards.some((c) => c.includes(i) || i.includes(c)));
  }
  return false; // unknown/unspecific conditions are never auto-applied
}

export interface PricedOffer {
  listedTotal: number | null; // listed + known fees
  eligibleDiscount: number;
  effectiveTotal: number | null; // listedTotal - eligibleDiscount
  bestCaseEffective: number | null; // CONDITIONAL: also assumes best unapplied bank + coupon offer is honoured
  totalIsLowerBound: boolean;
  unknownFees: string[];
  applied: ConditionalDiscount[];
  stillConditional: ConditionalDiscount[];
}

/** Which fees must be known for the total to be exact, by mode. */
function feeComponents(o: UnifiedOffer): { name: string; v: number | null }[] {
  return o.commerceMode === "ecommerce"
    ? [{ name: "shipping fee", v: o.shippingFee }]
    : [{ name: "delivery fee", v: o.shippingFee }, { name: "handling fee", v: o.handlingFee }, { name: "platform fee", v: o.platformFee }];
}

export function priceOffer(o: UnifiedOffer, opts: PaymentOptions = {}): PricedOffer {
  const comps = feeComponents(o);
  const unknownFees = comps.filter((c) => c.v === null).map((c) => c.name);
  const fees = comps.reduce((s, c) => s + (c.v ?? 0), 0) + (o.commerceMode === "ecommerce" ? (o.handlingFee ?? 0) + (o.platformFee ?? 0) : 0);
  const applied = o.conditionalDiscounts.filter((d) => isEligible(d, o.listedPrice, opts));
  const rest = o.conditionalDiscounts.filter((d) => !applied.includes(d));
  const best = (kinds: string[], list: ConditionalDiscount[]) => Math.max(0, ...list.filter((d) => kinds.includes(d.kind ?? "other") && d.amount !== null).map((d) => d.amount as number));
  // one bank/EMI offer + one coupon may stack; take the largest of each
  const eligible = (o.eligibleDiscount ?? 0) + best(["bank", "emi"], applied) + best(["coupon"], applied);
  if (o.listedPrice === null) {
    return { listedTotal: null, eligibleDiscount: eligible, effectiveTotal: null, bestCaseEffective: null, totalIsLowerBound: true, unknownFees, applied, stillConditional: rest };
  }
  const listedTotal = Math.round((o.listedPrice + fees) * 100) / 100;
  const effectiveTotal = Math.max(0, Math.round((listedTotal - eligible) * 100) / 100);
  const extra = best(["bank", "emi"], rest) + best(["coupon"], rest);
  return {
    listedTotal,
    eligibleDiscount: eligible,
    effectiveTotal,
    bestCaseEffective: Math.max(0, Math.round((effectiveTotal - extra) * 100) / 100),
    totalIsLowerBound: unknownFees.length > 0,
    unknownFees,
    applied,
    stillConditional: rest,
  };
}
