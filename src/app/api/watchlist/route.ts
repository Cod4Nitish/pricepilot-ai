import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, errorResponse, handleError, readJson } from "@/lib/api";
import { addWatchlist, deleteWatchlist, listWatchlist } from "@/lib/supabase";

export const runtime = "nodejs";

const postSchema = z.object({
  productQuery: z.string().trim().min(2).max(500),
  title: z.string().trim().min(1).max(300),
  imageUrl: z.string().url().max(1000).optional(),
  lastPrice: z.number().positive().nullable().optional(),
  targetPrice: z.number().positive().nullable().optional(),
});
const idSchema = z.string().uuid();

export async function GET(req: Request) {
  try {
    const auth = await authenticate(req); // authentication
    if ("response" in auth) return auth.response;
    return NextResponse.json(await listWatchlist(auth.userId)); // authorization: scoped to user_id
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authenticate(req);
    if ("response" in auth) return auth.response;
    const body = postSchema.parse(await readJson(req));
    const item = await addWatchlist(auth.userId, body);
    return NextResponse.json(item, { status: 201 });
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
    await deleteWatchlist(auth.userId, id.data); // ownership enforced by user_id filter
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
