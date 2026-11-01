import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, limited, readJson } from "@/lib/api";
import { searchProducts } from "@/lib/search";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({ query: z.string().trim().min(2).max(500) });

export async function POST(req: Request) {
  try {
    const rl = limited(req, "search", 8);
    if (rl) return rl;
    const { query } = bodySchema.parse(await readJson(req));
    const resp = await searchProducts(query);
    return NextResponse.json(resp);
  } catch (e) {
    return handleError(e);
  }
}
