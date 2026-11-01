import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, errorResponse, handleError, readJson } from "@/lib/api";
import { addAlert, deleteAlert, listAlerts } from "@/lib/supabase";

export const runtime = "nodejs";

const postSchema = z.object({ watchlistId: z.string().uuid(), targetPrice: z.number().positive() });
const idSchema = z.string().uuid();

export async function GET(req: Request) {
  try {
    const auth = await authenticate(req);
    if ("response" in auth) return auth.response;
    return NextResponse.json({ alerts: await listAlerts(auth.userId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authenticate(req);
    if ("response" in auth) return auth.response;
    const body = postSchema.parse(await readJson(req));
    const alert = await addAlert(auth.userId, body.watchlistId, body.targetPrice);
    // authorization: watchlist must belong to the caller
    if (!alert) return errorResponse(404, "NOT_FOUND", "Watchlist item not found.");
    return NextResponse.json({ alert }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await authenticate(req);
    if ("response" in auth) return auth.response;
    const id = idSchema.safeParse(new URL(req.url).searchParams.get("id"));
    if (!id.success) return errorResponse(400, "INVALID_INPUT", "id (uuid) query parameter is required.");
    await deleteAlert(auth.userId, id.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
