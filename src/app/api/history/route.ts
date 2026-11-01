import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, notConfigured } from "@/lib/api";
import { getHistory, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

const querySchema = z.object({
  key: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
  days: z.enum(["7", "30", "90"]).default("30"),
});

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const q = querySchema.parse({ key: sp.get("key") ?? undefined, days: sp.get("days") ?? undefined });
    if (!getSupabase()) return notConfigured("Supabase");
    const points = (await getHistory(q.key, Number(q.days))) ?? [];
    return NextResponse.json({ points });
  } catch (e) {
    return handleError(e);
  }
}
