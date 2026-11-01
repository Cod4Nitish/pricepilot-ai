import { errorResponse, handleError, limited, notConfigured, readJson } from "@/lib/api";
import { MAX_ACTIVE_BATTLES, activeBattleCount, encodeSse, getBattle, startBattle } from "@/lib/fast/battle";
import { isConfigured } from "@/lib/fast/providers";
import { basketBody, normalizeItems } from "@/lib/fast/schemas";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function sseResponse(battleId: string, after: number, signal: AbortSignal): Response {
  const battle = getBattle(battleId);
  if (!battle) return errorResponse(404, "NOT_FOUND", "Battle not found or expired. Start a new one.");
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const e of battle.tail(after, signal)) controller.enqueue(enc.encode(encodeSse(e)));
      } catch {
        /* client went away */
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });
  return new Response(stream, { headers: HEADERS });
}

/**
 * POST {pincode, items} starts a Blinkit-vs-Zepto battle and streams REAL TinyFish events as SSE.
 * The server keeps the event log so a dropped connection can resume via GET ?battleId=&after=<seq>.
 * Closing the connection does not cancel the runs; use POST /api/battle/cancel (bounded by max duration anyway).
 */
export async function POST(req: Request) {
  try {
    const rl = limited(req, "battle", 2);
    if (rl) return rl;
    const body = basketBody.parse(await readJson(req));
    if (!isConfigured()) return notConfigured("TinyFish");
    if (activeBattleCount() >= MAX_ACTIVE_BATTLES) return errorResponse(429, "BUSY", "Too many live battles are running. Try again in a minute.", { "Retry-After": "60" });
    const battle = startBattle(body.pincode, normalizeItems(body.items));
    return sseResponse(battle.id, 0, req.signal);
  } catch (e) {
    return handleError(e);
  }
}

/** Resume an existing battle's stream after the given event seq. */
export async function GET(req: Request) {
  try {
    const rl = limited(req, "battle-resume", 20);
    if (rl) return rl;
    const url = new URL(req.url);
    const id = url.searchParams.get("battleId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return errorResponse(400, "INVALID_INPUT", "battleId is required.");
    const after = Math.max(0, Number(url.searchParams.get("after") ?? req.headers.get("last-event-id") ?? 0) || 0);
    return sseResponse(id, after, req.signal);
  } catch (e) {
    return handleError(e);
  }
}
