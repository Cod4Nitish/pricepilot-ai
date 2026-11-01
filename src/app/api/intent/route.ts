import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, limited, readJson } from "@/lib/api";
import { heuristicIntent, refineWithClaude } from "@/lib/intent";

export const runtime = "nodejs";

const Body = z.object({ text: z.string().trim().min(1).max(300) });

/** Routes a typed or spoken request to E-Commerce, Quick Commerce or both. No sample data. */
export async function POST(req: Request) {
  try {
    const rl = limited(req, "intent", 30);
    if (rl) return rl;
    const { text } = Body.parse(await readJson(req));
    const base = heuristicIntent(text);
    const key = process.env.ANTHROPIC_API_KEY;
    const result = key ? await refineWithClaude(text, base, key) : base;
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
