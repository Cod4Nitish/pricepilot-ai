import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { NotConfiguredError, getEnv } from "./env";
import { getSupabase, getUserIdFromToken } from "./supabase";
import { TinyFishError } from "./tinyfish";
import { clientIp, rateLimit } from "./ratelimit";
import type { ApiError } from "./types";

export function errorResponse(status: number, code: string, message: string, headers?: Record<string, string>) {
  const body: ApiError = { error: { code, message } };
  return NextResponse.json(body, { status, headers });
}

export function notConfigured(what: string) {
  return errorResponse(503, "NOT_CONFIGURED", `${what} is not configured on the server.`);
}

/** Map thrown errors to a consistent ApiError response. */
export function handleError(e: unknown) {
  if (e instanceof NotConfiguredError) return notConfigured(e.what);
  if (e instanceof ZodError) return errorResponse(400, "INVALID_INPUT", e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  if (e instanceof TinyFishError) {
    if (e.kind === "insufficient_credits") return errorResponse(502, "UPSTREAM_CREDITS", "The TinyFish account has no remaining credits. Add credits or use another TinyFish API key in Settings.");
    if (e.kind === "auth") return errorResponse(502, "UPSTREAM_AUTH", "TinyFish rejected the API key. Check the key in Settings.");
    if (e.kind === "rate_limited") return errorResponse(503, "UPSTREAM_RATE_LIMITED", "The data provider is rate limiting; try again shortly.");
    if (e.kind === "budget_exhausted") return errorResponse(503, "PAID_BUDGET_EXHAUSTED", e.message);
    return errorResponse(502, "UPSTREAM_ERROR", `Data provider error (${e.kind}).`);
  }
  if (e instanceof Error && e.name === "SearchInputError") return errorResponse(400, "INVALID_INPUT", e.message);
  console.error("[api] unhandled", e);
  return errorResponse(500, "INTERNAL", "Unexpected server error.");
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ZodError([{ code: "custom", path: [], message: "Body must be valid JSON", input: undefined }]);
  }
}

export function limited(req: Request, bucket: string, limit: number) {
  const r = rateLimit(`${bucket}:${clientIp(req)}`, limit, 60_000);
  if (r.ok) return null;
  return errorResponse(429, "RATE_LIMITED", "Too many requests. Please slow down.", { "Retry-After": String(r.retryAfterSec) });
}

/**
 * Authentication: verifies the Bearer Supabase JWT with supabase auth.getUser.
 * Returns {userId} or an error response.
 */
export async function authenticate(req: Request): Promise<{ userId: string } | { response: Response }> {
  if (!getSupabase()) return { response: notConfigured("Supabase") };
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return { response: errorResponse(401, "UNAUTHENTICATED", "Missing Bearer token.") };
  const userId = await getUserIdFromToken(m[1]);
  if (!userId) return { response: errorResponse(401, "UNAUTHENTICATED", "Invalid or expired token.") };
  return { userId };
}

/** Cron authorization: constant-time-ish compare of CRON_SECRET bearer. */
export function authorizeCron(req: Request): Response | null {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return notConfigured("CRON_SECRET");
  const h = req.headers.get("authorization") ?? "";
  const given = h.replace(/^Bearer\s+/i, "");
  if (given.length !== secret.length) return errorResponse(401, "UNAUTHENTICATED", "Invalid cron credentials.");
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0 ? null : errorResponse(401, "UNAUTHENTICATED", "Invalid cron credentials.");
}
