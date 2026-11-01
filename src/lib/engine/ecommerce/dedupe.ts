// Offer hygiene before resolution: drop non-product widget rows and collapse duplicates.
import { isJunkTitle } from "../../match";
import { canonicalUrl } from "../../ssrf";
import { productKey } from "../../retailers";
import type { UnifiedOffer } from "../schema";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const rank = (o: UnifiedOffer) => (o.verificationStatus === "verified" ? 3 : o.verificationStatus === "agent_verified" ? 2 : o.listedPrice !== null ? 1 : 0);

/**
 * Removes junk rows (e.g. Amazon "Add to your order") and duplicate offers:
 * same retailer + canonical product URL/ID, or same retailer + title + price. The best-verified duplicate is kept; input order is preserved.
 */
export function cleanOffers(offers: UnifiedOffer[]): UnifiedOffer[] {
  const real = offers.filter((o) => !isJunkTitle(o.productName));
  const keyOf = (o: UnifiedOffer) => productKey(o.retailer, o.sourceUrl) ?? `${o.retailer}:${canonicalUrl(o.sourceUrl)}`;
  const best = new Map<string, UnifiedOffer>();
  for (const o of real) {
    for (const k of [keyOf(o), o.listedPrice !== null ? `${o.retailer}|${norm(o.productName)}|${o.listedPrice}` : null]) {
      if (!k) continue;
      const prev = best.get(k);
      if (!prev || rank(o) > rank(prev)) best.set(k, o);
    }
  }
  const out: UnifiedOffer[] = [];
  const emitted = new Set<UnifiedOffer>();
  for (const o of real) {
    const k1 = keyOf(o);
    const k2 = o.listedPrice !== null ? `${o.retailer}|${norm(o.productName)}|${o.listedPrice}` : null;
    const winner = best.get(k1) ?? o;
    const w2 = k2 ? best.get(k2) : undefined;
    const pick = w2 && rank(w2) > rank(winner) ? w2 : winner;
    if (pick !== o) continue;
    if (!emitted.has(o)) {
      emitted.add(o);
      out.push(o);
    }
  }
  return out;
}
