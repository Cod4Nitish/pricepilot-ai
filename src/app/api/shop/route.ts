import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, limited, readJson } from "@/lib/api";
import { requireEnv } from "@/lib/env";
import { runShop } from "@/lib/shop/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;

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
});

/** Universal E-Commerce search: parse -> discovery/offers -> ranked, evidence-backed groups. Never sample data. */
export async function POST(req: Request) {
  try {
    const rl = limited(req, "shop", 3);
    if (rl) return rl;
    const input = Body.parse(await readJson(req));
    requireEnv("TINYFISH_API_KEY");
    const out = await runShop(input);
    return NextResponse.json(out);
  } catch (e) {
    return handleError(e);
  }
}
