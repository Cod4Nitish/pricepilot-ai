import { NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { providerStatus } from "@/lib/fast/providers";

export const runtime = "nodejs";

/** Which fast-commerce providers are enabled/disabled and why. Never exposes the key itself. */
export async function GET() {
  try {
    return NextResponse.json(providerStatus());
  } catch (e) {
    return handleError(e);
  }
}
