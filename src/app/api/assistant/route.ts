import { NextResponse } from "next/server";
import { errorResponse, handleError, limited, readJson } from "@/lib/api";
import { AssistantUpstreamError, messagesSchema, runAssistant } from "@/lib/assistant";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const rl = limited(req, "assistant", 6);
    if (rl) return rl;
    const { messages } = messagesSchema.parse(await readJson(req));
    requireEnv("ANTHROPIC_API_KEY");
    requireEnv("TINYFISH_API_KEY");
    return NextResponse.json(await runAssistant(messages));
  } catch (e) {
    if (e instanceof AssistantUpstreamError) return errorResponse(502, "UPSTREAM_ERROR", "The AI provider returned an error.");
    return handleError(e);
  }
}
