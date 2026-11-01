import { afterEach, describe, expect, it, vi } from "vitest";
import { readUserKey, requireTinyFishKey, userKey, withUserKey } from "../byok";
import { search } from "../tinyfish";

const req = (key?: string) => new Request("http://x/api/shop", { method: "POST", headers: key ? { "X-TinyFish-Key": key } : {} });

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TINYFISH_API_KEY;
});

describe("bring-your-own TinyFish key", () => {
  it("accepts only key-shaped header values", () => {
    expect(readUserKey(req("sk-tinyfish-abcdefghijklmnop"))).toBe("sk-tinyfish-abcdefghijklmnop");
    expect(readUserKey(req("short"))).toBeNull();
    expect(readUserKey(req("has spaces in it but long enough"))).toBeNull();
    expect(readUserKey(req())).toBeNull();
  });

  it("uses the user's key only inside that request, else the server key", async () => {
    process.env.TINYFISH_API_KEY = "server-key-0123456789abcdef";
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      seen.push((init.headers as Record<string, string>)["X-API-Key"]);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }));
    await withUserKey(req("user-key-0123456789abcdef"), () => search({ query: "a" }));
    await search({ query: "b" });
    expect(seen).toEqual(["user-key-0123456789abcdef", "server-key-0123456789abcdef"]);
    expect(userKey()).toBeNull();
  });

  it("a user key works even when the server has no key", async () => {
    await withUserKey(req("user-key-0123456789abcdef"), async () => {
      expect(requireTinyFishKey()).toBe("user-key-0123456789abcdef");
    });
    expect(() => requireTinyFishKey()).toThrow(/not configured/);
  });
});
