import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEY_COOKIE, decryptKey, encryptKey, keyCookie, personalKeysEnabled, readUserKey, requireTinyFishKey, userKey, withUserKey } from "../byok";
import { search } from "../tinyfish";

const SECRET = "test-secret-0123456789abcdef0123456789";
const USER = "user-key-0123456789abcdef";
const reqWith = (cookie?: string) => new Request("http://x/api/shop", { method: "POST", headers: cookie ? { cookie } : {} });

beforeEach(() => {
  process.env.PP_KEY_SECRET = SECRET;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PP_KEY_SECRET;
  delete process.env.TINYFISH_API_KEY;
});

describe("personal TinyFish key (encrypted httpOnly cookie)", () => {
  it("round-trips through AES-GCM and rejects tampering or a different server secret", () => {
    const t = encryptKey(USER);
    expect(t).not.toContain(USER);
    expect(decryptKey(t)).toBe(USER);
    const bad = t.slice(0, -2) + (t.endsWith("A") ? "BB" : "AA");
    expect(decryptKey(bad)).toBeNull();
    process.env.PP_KEY_SECRET = "another-secret-0123456789abcdef012345";
    expect(decryptKey(t)).toBeNull();
  });

  it("the cookie is httpOnly, SameSite=Strict and scoped to /api; removal expires it", () => {
    const c = keyCookie(encryptKey(USER));
    expect(c).toMatch(new RegExp(`^${KEY_COOKIE}=`));
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Path=/api");
    expect(c).not.toContain(USER);
    expect(keyCookie(null)).toContain("Max-Age=0");
  });

  it("ignores headers: only the encrypted cookie counts", () => {
    const r = new Request("http://x", { headers: { "X-TinyFish-Key": USER } });
    expect(readUserKey(r)).toBeNull();
    expect(readUserKey(reqWith(`other=1; ${KEY_COOKIE}=${encryptKey(USER)}`))).toBe(USER);
  });

  it("applies the personal key only inside its own request; others use the server key", async () => {
    process.env.TINYFISH_API_KEY = "server-key-0123456789abcdef";
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      seen.push((init.headers as Record<string, string>)["X-API-Key"]);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }));
    await Promise.all([withUserKey(reqWith(`${KEY_COOKIE}=${encryptKey(USER)}`), () => search({ query: "a" })), withUserKey(reqWith(), () => search({ query: "b" }))]);
    expect(seen.sort()).toEqual(["server-key-0123456789abcdef", USER].sort());
    expect(userKey()).toBeNull();
  });

  it("without PP_KEY_SECRET personal keys are disabled (no insecure fallback)", () => {
    const t = encryptKey(USER);
    delete process.env.PP_KEY_SECRET;
    expect(personalKeysEnabled()).toBe(false);
    expect(() => encryptKey(USER)).toThrow();
    expect(readUserKey(reqWith(`${KEY_COOKIE}=${t}`))).toBeNull();
    expect(() => requireTinyFishKey()).toThrow(/not configured/);
  });
});
