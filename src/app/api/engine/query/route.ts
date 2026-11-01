import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, limited, readJson } from "@/lib/api";
import { requireEnv } from "@/lib/env";
import { defaultCollectors, runEngine } from "@/lib/engine/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  text: z.string().trim().min(2).max(500),
  pincode: z.string().regex(/^[1-9]\d{5}$/, "pincode must be a 6-digit Indian pincode").optional(),
  budget: z.number().positive().max(10_000_000).optional(),
  weights: z.object({ price: z.number().min(0).max(1000).optional(), speed: z.number().min(0).max(1000).optional(), trust: z.number().min(0).max(1000).optional() }).optional(),
  constraints: z
    .object({ maxEtaMinutes: z.number().positive().max(10_000).optional(), budget: z.number().positive().max(10_000_000).optional(), requireAllItems: z.boolean().optional() })
    .optional(),
  cards: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  coupons: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});

/** Unified engine: understands a request, collects real offers, resolves variants, ranks with explanations. Never sample data. */
export async function POST(req: Request) {
  try {
    const rl = limited(req, "engine", 3);
    if (rl) return rl;
    const input = Body.parse(await readJson(req));
    requireEnv("TINYFISH_API_KEY");
    const out = await runEngine(input, { collectors: defaultCollectors() });
    return NextResponse.json(out);
  } catch (e) {
    return handleError(e);
  }
}
