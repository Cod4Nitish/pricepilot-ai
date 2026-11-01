import { NextResponse } from "next/server";
import { authorizeCron, handleError, notConfigured } from "@/lib/api";
import { requireEnv } from "@/lib/env";
import { RunTracker } from "@/lib/runs";
import { searchProducts } from "@/lib/search";
import { activeAlertsForWatchlist, getSupabase, listAllWatchlists, markAlertTriggered, updateWatchlistPrice } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_QUERIES = 10; // cost protection per cron invocation

async function handle(req: Request) {
  const denied = authorizeCron(req); // authentication via CRON_SECRET
  if (denied) return denied;
  try {
    if (!getSupabase()) return notConfigured("Supabase");
    requireEnv("TINYFISH_API_KEY");
    const tracker = new RunTracker("refresh");
    const items = await listAllWatchlists(200);
    const queries = [...new Set(items.map((i) => i.productQuery.toLowerCase()))].slice(0, MAX_QUERIES);
    const bestByQuery = new Map<string, number | null>();
    for (const q of queries) {
      try {
        const r = await searchProducts(q, { skipCache: true }); // persists real observations
        bestByQuery.set(q, r.bestVerified?.price ?? null);
        tracker.step(`Refreshed "${q}"`);
      } catch (e) {
        tracker.step(`Failed "${q}": ${(e as Error).message}`, "error");
      }
    }
    let triggered = 0;
    for (const it of items) {
      const price = bestByQuery.get(it.productQuery.toLowerCase());
      if (price === undefined) continue;
      if (price !== null) await updateWatchlistPrice(it.id, price);
      if (price === null) continue;
      for (const a of await activeAlertsForWatchlist(it.id)) {
        if (price <= a.targetPrice) {
          await markAlertTriggered(a.id);
          triggered++;
        }
      }
    }
    tracker.step(`Evaluated alerts: ${triggered} triggered`);
    await tracker.finish();
    return NextResponse.json({ refreshed: bestByQuery.size, skipped: Math.max(0, new Set(items.map((i) => i.productQuery.toLowerCase())).size - queries.length), alertsTriggered: triggered, runId: tracker.id });
  } catch (e) {
    return handleError(e);
  }
}

export const GET = handle;
export const POST = handle;
