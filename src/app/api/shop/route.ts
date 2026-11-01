import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, limited, readJson } from "@/lib/api";
import { requireTinyFishKey, withUserKey } from "@/lib/byok";
import { withCostContext } from "@/lib/cost/context";
import { runShop } from "@/lib/shop/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  query: z.string().trim().min(2).max(300),
  pincode: z.string().trim().max(10).optional(),
  weights: z
    .object({ price: z.number().min(0).max(1000).optional(), delivery: z.number().min(0).max(1000).optional(), evidence: z.number().min(0).max(1000).optional() })
    .optional(),
  sort: z.enum(["price", "delivery", "relevance"]).optional(),
  cards: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  /** Optional client-generated run id so the UI can poll GET /api/shop/run/:id while the search runs. */
  runId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  /** user-triggered fresh check: bypass caches and re-read prices live */
  fresh: z.boolean().optional(),
});

/** Universal E-Commerce search: parse -> discovery/offers -> ranked, evidence-backed groups. Never sample data. */
export async function POST(req: Request) {
  try {
    const rl = limited(req, "shop", 3);
    if (rl) return rl;
    const { fresh, ...input } = Body.parse(await readJson(req));
    return await withUserKey(req, async () => {
    requireTinyFishKey();
    if (fresh) {
      const frl = limited(req, "shop-fresh", 2);
      if (frl) return frl;
    }
    const { result, usage } = await withCostContext(!!fresh, () => runShop(input, fresh ? { noCache: true } : {}));
    return NextResponse.json({ ...result, usage: result.cached ? { ...usage, cacheHits: usage.cacheHits + 1 } : usage });
    });
  } catch (e) {
    return handleError(e);
  }
}
