import { z } from "zod";
import { MAX_ITEMS, PINCODE_RE } from "./goals";

export const pincodeSchema = z.string().trim().regex(PINCODE_RE, "Pincode must be a 6-digit Indian pincode");
const querySchema = z.string().trim().min(2, "Item name is too short").max(80, "Item name is too long");

export const searchBody = z.object({ pincode: pincodeSchema, query: querySchema });

export const basketBody = z.object({
  pincode: pincodeSchema,
  items: z
    .array(z.object({ query: querySchema, qty: z.number().int().min(1).max(20).default(1) }))
    .min(1, "Add at least one item")
    .max(MAX_ITEMS, `At most ${MAX_ITEMS} items`),
});

/** De-duplicate by query (case-insensitive), summing quantities. */
export function normalizeItems(items: { query: string; qty: number }[]): { query: string; qty: number }[] {
  const m = new Map<string, { query: string; qty: number }>();
  for (const i of items) {
    const k = i.query.toLowerCase();
    const e = m.get(k);
    if (e) e.qty = Math.min(20, e.qty + i.qty);
    else m.set(k, { query: i.query, qty: i.qty });
  }
  return [...m.values()];
}

export const battleCancelBody = z.object({ battleId: z.string().uuid() });
