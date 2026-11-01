import { NextResponse } from "next/server";
import { handleError, limited, notConfigured, readJson } from "@/lib/api";
import { isConfigured } from "@/lib/fast/providers";
import { basketBody, normalizeItems } from "@/lib/fast/schemas";
import { compareFast } from "@/lib/fast/service";

export const runtime = "nodejs";
export const maxDuration = 300;

/** POST {pincode, items:[{query,qty}]} (max 8 items) -> FastBasketResponse. Public, rate limited. */
export async function POST(req: Request) {
  try {
    const rl = limited(req, "fast-basket", 3);
    if (rl) return rl;
    const body = basketBody.parse(await readJson(req));
    if (!isConfigured()) return notConfigured("TinyFish");
    return NextResponse.json(await compareFast(body.pincode, normalizeItems(body.items)));
  } catch (e) {
    return handleError(e);
  }
}
