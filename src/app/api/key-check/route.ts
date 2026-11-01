import { NextResponse } from "next/server";
import { handleError, limited } from "@/lib/api";
import { readUserKey, withUserKey } from "@/lib/byok";
import { TinyFishError, search } from "@/lib/tinyfish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Checks a user's TinyFish key with one TinyFish Search call (Search is $0). Never returns or logs the key. */
export async function POST(req: Request) {
  try {
    const rl = limited(req, "key-check", 5);
    if (rl) return rl;
    if (!readUserKey(req)) return NextResponse.json({ ok: false, message: "That does not look like a TinyFish API key." }, { status: 400 });
    return await withUserKey(req, async () => {
      try {
        await search({ query: "smartphone", location: "IN" }, { retries: 0, timeoutMs: 20_000 });
        return NextResponse.json({ ok: true, message: "Key works: TinyFish Search accepted it." });
      } catch (e) {
        if (e instanceof TinyFishError && e.kind === "auth") return NextResponse.json({ ok: false, message: "TinyFish rejected this key." });
        if (e instanceof TinyFishError && e.kind === "insufficient_credits") return NextResponse.json({ ok: false, message: "Key accepted, but the account has no credits." });
        throw e;
      }
    });
  } catch (e) {
    return handleError(e);
  }
}
