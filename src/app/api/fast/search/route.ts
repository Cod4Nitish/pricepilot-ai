import { NextResponse } from "next/server";
import { handleError, limited, notConfigured, readJson } from "@/lib/api";
import { isConfigured } from "@/lib/fast/providers";
import { searchBody } from "@/lib/fast/schemas";
import { compareFast } from "@/lib/fast/service";

export const runtime = "nodejs";
export const maxDuration = 300;

/** POST {pincode, query} -> FastBasketResponse for a single item (qty 1). Public, rate limited. */
export async function POST(req: Request) {
  try {
    const rl = limited(req, "fast-search", 4);
    if (rl) return rl;
    const { pincode, query } = searchBody.parse(await readJson(req));
    if (!isConfigured()) return notConfigured("TinyFish");
    return NextResponse.json(await compareFast(pincode, [{ query, qty: 1 }]));
  } catch (e) {
    return handleError(e);
  }
}
