import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, handleError } from "@/lib/api";
import { loadRun } from "@/lib/supabase";

export const runtime = "nodejs";

const idSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return errorResponse(400, "INVALID_INPUT", "Invalid run id.");
    const run = await loadRun(parsed.data);
    if (!run) return errorResponse(404, "NOT_FOUND", "Run not found.");
    return NextResponse.json(run);
  } catch (e) {
    return handleError(e);
  }
}
