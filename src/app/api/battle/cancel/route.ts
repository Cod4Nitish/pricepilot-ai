import { NextResponse } from "next/server";
import { errorResponse, handleError, limited, readJson } from "@/lib/api";
import { getBattle } from "@/lib/fast/battle";
import { battleCancelBody } from "@/lib/fast/schemas";

export const runtime = "nodejs";

/**
 * POST {battleId}: cancels the battle's TinyFish runs (POST /v1/runs/{id}/cancel upstream).
 * Authorization: the unguessable battle id (UUID v4) issued to the creator is the capability;
 * only runs registered by this server's own battles can be cancelled, never arbitrary run ids.
 */
export async function POST(req: Request) {
  try {
    const rl = limited(req, "battle-cancel", 10);
    if (rl) return rl;
    const { battleId } = battleCancelBody.parse(await readJson(req));
    const battle = getBattle(battleId);
    if (!battle) return errorResponse(404, "NOT_FOUND", "Battle not found or already expired.");
    await battle.cancel();
    return NextResponse.json({ cancelled: battle.cancelled, done: battle.done });
  } catch (e) {
    return handleError(e);
  }
}
