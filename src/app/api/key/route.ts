import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, limited, readJson } from "@/lib/api";
import { encryptKey, isKeyShaped, keyCookie, maskKey, personalKeysEnabled, readUserKey, withExplicitKey, withUserKey } from "@/lib/byok";
import { getEnv } from "@/lib/env";
import { TinyFishError, search } from "@/lib/tinyfish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

/** Test a key with one TinyFish Search call (Search is $0). */
async function testKey(run: <T>(fn: () => Promise<T>) => Promise<T>): Promise<{ ok: boolean; message: string }> {
  return run(async () => {
    try {
      await search({ query: "smartphone", location: "IN" }, { retries: 0, timeoutMs: 20_000 });
      return { ok: true, message: "Connection works: TinyFish Search accepted the key." };
    } catch (e) {
      if (e instanceof TinyFishError && e.kind === "auth") return { ok: false, message: "TinyFish rejected this key." };
      if (e instanceof TinyFishError && e.kind === "insufficient_credits") return { ok: false, message: "Key accepted, but the TinyFish account has no credits." };
      return { ok: false, message: "Could not reach TinyFish to test the key. Try again." };
    }
  });
}

/** Status only: never returns a key (personal key is masked). */
export async function GET(req: Request) {
  const k = readUserKey(req);
  return NextResponse.json(
    {
      serverKeyConfigured: Boolean(getEnv().TINYFISH_API_KEY),
      personalKeyStorage: personalKeysEnabled() ? "enabled" : "disabled",
      personalKeyStorageNote: personalKeysEnabled()
        ? "Encrypted on the server (AES-256-GCM) into an httpOnly cookie for this browser only; JavaScript cannot read it."
        : "Personal keys are disabled: the server has no PP_KEY_SECRET configured for encryption.",
      personalKey: k ? { set: true, masked: maskKey(k) } : { set: false },
      using: k ? "personal" : "server",
    },
    { headers: noStore },
  );
}

const Body = z.object({ action: z.enum(["save", "test"]), key: z.string().trim().max(200).optional() });

export async function POST(req: Request) {
  try {
    const rl = limited(req, "key", 5);
    if (rl) return rl;
    const { action, key } = Body.parse(await readJson(req));
    if (action === "test") {
      if (!readUserKey(req)) return NextResponse.json({ ok: false, message: "No personal key is saved; searches use the server key." }, { headers: noStore });
      return NextResponse.json(await testKey((fn) => withUserKey(req, fn)), { headers: noStore });
    }
    if (!personalKeysEnabled()) return NextResponse.json({ ok: false, message: "Personal keys are disabled on this server (PP_KEY_SECRET not configured)." }, { status: 503, headers: noStore });
    if (!key || !isKeyShaped(key)) return NextResponse.json({ ok: false, message: "That does not look like a TinyFish API key." }, { status: 400, headers: noStore });
    const t = await testKey((fn) => withExplicitKey(key, fn));
    if (!t.ok) return NextResponse.json(t, { headers: noStore });
    return NextResponse.json({ ok: true, message: "Saved. Searches from this browser now use your key.", masked: maskKey(key) }, { headers: { ...noStore, "Set-Cookie": keyCookie(encryptKey(key)) } });
  } catch (e) {
    return handleError(e);
  }
}

/** Remove the personal key: back to the server default. */
export async function DELETE() {
  return NextResponse.json({ ok: true, message: "Removed. Searches use the server key." }, { headers: { ...noStore, "Set-Cookie": keyCookie(null) } });
}
