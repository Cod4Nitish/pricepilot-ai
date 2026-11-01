import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, handleError, limited, readJson } from "@/lib/api";
import { checkDelivery, PINCODE_RE } from "@/lib/delivery";
import { requireEnv } from "@/lib/env";
import { validateRetailerUrl } from "@/lib/ssrf";
import type { DeliveryInfo } from "@/lib/shop/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  pincode: z.string().regex(PINCODE_RE, "pincode must be a 6-digit Indian pincode"),
  // offerId is the offer's sourceUrl by UI convention; echoed back unchanged
  offers: z
    .array(z.object({ offerId: z.string().min(1).max(1000), url: z.string().min(1).max(1000), retailer: z.string().min(1).max(30) }))
    .min(1)
    .max(6),
});

/** On-demand pincode delivery check (TinyFish Agent, Amazon.in and Flipkart). Public, read-only; protected by per-IP rate limit. */
export async function POST(req: Request) {
  try {
    const rl = limited(req, "shop-delivery", 4);
    if (rl) return rl;
    const body = Body.parse(await readJson(req));
    const checked = body.offers.map((o) => {
      const v = validateRetailerUrl(o.url);
      return { o, v };
    });
    for (const { o, v } of checked) {
      if (!v.ok) return errorResponse(400, "INVALID_INPUT", `offers: ${v.reason}`);
      if (v.retailer.id !== o.retailer) return errorResponse(400, "INVALID_INPUT", `offers: retailer "${o.retailer}" does not match the URL.`);
    }
    requireEnv("TINYFISH_API_KEY");
    const results: { offerId: string; delivery: DeliveryInfo }[] = await Promise.all(
      checked.map(async ({ o, v }) => ({
        offerId: o.offerId,
        delivery: await checkDelivery({ offerId: o.offerId, url: v.ok ? v.url : o.url, retailer: o.retailer }, body.pincode),
      })),
    );
    return NextResponse.json({ results });
  } catch (e) {
    return handleError(e);
  }
}
