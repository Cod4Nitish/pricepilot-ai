import { NextResponse } from "next/server";
import { meter } from "@/lib/cost/meter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operating-cost telemetry for this server instance (aggregate counters only; no queries, IPs or secrets).
 * Counts are measured; USD is calculated from provider-metered agent steps × the documented TinyFish rate.
 */
export async function GET() {
  return NextResponse.json(
    {
      ...meter.snapshot(),
      pricing: {
        source: "TinyFish wallet rate card (read 2026-11-01): Agent $0.016/step; Search $0/query; Fetch $0/url.",
        overrideEnv: "PP_USD_PER_AGENT_STEP",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
