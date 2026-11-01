import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, handleError, limited } from "@/lib/api";

export const runtime = "nodejs";

const Query = z.object({
  lat: z.coerce.number().min(6).max(38),
  lon: z.coerce.number().min(68).max(98),
});

/**
 * Turns browser-provided coordinates (the user pressed "Use my location" and granted
 * permission) into an Indian pincode. Coordinates are used for this one lookup only and
 * are neither logged nor stored. Provider: OpenStreetMap Nominatim (public, rate-limited).
 */
export async function GET(req: Request) {
  try {
    const rl = limited(req, "geo", 10);
    if (rl) return rl;
    const url = new URL(req.url);
    const parsed = Query.safeParse({ lat: url.searchParams.get("lat"), lon: url.searchParams.get("lon") });
    if (!parsed.success) return errorResponse(400, "INVALID_INPUT", "Location is outside India or invalid.");
    const { lat, lon } = parsed.data;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lon}`,
      { signal: ctrl.signal, headers: { "User-Agent": "PricePilotAI/1.0 (https://github.com/Cod4Nitish/pricepilot-ai)", "Accept-Language": "en" } },
    ).finally(() => clearTimeout(timer));
    if (!res.ok) return errorResponse(502, "UPSTREAM_ERROR", "Could not look up your pincode. Enter it manually.");
    const data = (await res.json()) as { address?: { postcode?: string; city?: string; suburb?: string; state_district?: string } };
    const pin = (data.address?.postcode ?? "").replace(/\D/g, "");
    if (!/^[1-9][0-9]{5}$/.test(pin)) return errorResponse(404, "NO_PINCODE", "Could not find a pincode for this spot. Enter it manually.");
    const area = data.address?.suburb ?? data.address?.city ?? data.address?.state_district ?? null;
    return NextResponse.json({ pincode: pin, area });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return errorResponse(504, "TIMEOUT", "Location lookup timed out. Enter your pincode manually.");
    return handleError(e);
  }
}
