import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, limited, readJson } from "@/lib/api";
import { optimizeBasket } from "@/lib/basket";
import { requireEnv } from "@/lib/env";
import { searchProducts } from "@/lib/search";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({
  lines: z.array(z.object({ query: z.string().trim().min(2).max(300), qty: z.number().int().min(1).max(20) })).min(1).max(8),
});

export async function POST(req: Request) {
  try {
    const rl = limited(req, "basket", 3);
    if (rl) return rl;
    const { lines } = bodySchema.parse(await readJson(req));
    requireEnv("TINYFISH_API_KEY");
    const results = [];
    // limited concurrency (2) to protect upstream credits
    for (let i = 0; i < lines.length; i += 2) {
      const chunk = lines.slice(i, i + 2);
      results.push(
        ...(await Promise.all(
          chunk.map(async (l) => {
            const r = await searchProducts(l.query);
            return { query: l.query, qty: l.qty, offers: r.offers };
          }),
        )),
      );
    }
    return NextResponse.json(optimizeBasket(results));
  } catch (e) {
    return handleError(e);
  }
}
