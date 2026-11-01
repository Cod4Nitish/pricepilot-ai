import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const e = getEnv();
  return NextResponse.json({
    tinyfish: Boolean(e.TINYFISH_API_KEY),
    supabase: Boolean(e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY),
    claude: Boolean(e.ANTHROPIC_API_KEY),
  });
}
