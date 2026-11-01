import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, limited, readJson } from "@/lib/api";
import { withUserKey } from "@/lib/byok";
import { searchProducts } from "@/lib/search";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({
  query: z.string().trim().min(2).max(500),
  /** user-triggered fresh check: bypass caches, ask TinyFish Fetch for a live page */
  fresh: z.boolean().optional(),
});

const isProd = process.env.NODE_ENV === "production";

export async function POST(req: Request) {
  try {
    const rl = limited(req, "search", 8);
    if (rl) return rl;
    const { query, fresh } = bodySchema.parse(await readJson(req));
    if (fresh) {
      const frl = limited(req, "search-fresh", 3);
      if (frl) return frl;
    }
    // Benchmark switches (A/B of routing, no response cache): development only, ignored in production.
    const routingHeader = req.headers.get("x-pp-routing");
    const routing = !isProd && (routingHeader === "legacy" || routingHeader === "adaptive") ? routingHeader : undefined;
    const bench = !isProd && req.headers.get("x-pp-bench") === "1";
    const resp = await withUserKey(req, () => searchProducts(query, { fresh, routing, skipCache: bench }));
    return NextResponse.json(resp);
  } catch (e) {
    return handleError(e);
  }
}
