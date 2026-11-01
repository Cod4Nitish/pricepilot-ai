import { afterEach, describe, expect, it, vi } from "vitest";
import { TinyFishError, fetchPages, runAgent, search } from "../tinyfish";

const opts = { apiKey: "test-key", baseDelayMs: 1 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("tinyfish client", () => {
  it("sends auth header and query params", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { query: "q", results: [], total_results: 0, page: 0 }));
    vi.stubGlobal("fetch", f);
    await search({ query: "iphone 15", location: "IN", includeDomains: ["amazon.in"] }, opts);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain("query=iphone+15");
    expect(String(url)).toContain("include_domains=amazon.in");
    expect(init.headers["X-API-Key"]).toBe("test-key");
  });

  it("retries on 503 then succeeds", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(429, {}))
      .mockResolvedValueOnce(json(200, { results: [], errors: [] }));
    vi.stubGlobal("fetch", f);
    const r = await fetchPages({ urls: ["https://www.amazon.in/dp/B0CMDRCZBH"] }, opts);
    expect(f).toHaveBeenCalledTimes(3);
    expect(r.results).toEqual([]);
  });

  it("does not retry 402 and throws typed error", async () => {
    const f = vi.fn().mockResolvedValue(json(402, { error: "credits" }));
    vi.stubGlobal("fetch", f);
    await expect(search({ query: "x" }, opts)).rejects.toMatchObject({ name: "TinyFishError", kind: "insufficient_credits", status: 402 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("gives up after retries on persistent 503", async () => {
    const f = vi.fn().mockResolvedValue(json(503, {}));
    vi.stubGlobal("fetch", f);
    await expect(search({ query: "x" }, { ...opts, retries: 2 })).rejects.toBeInstanceOf(TinyFishError);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("times out via AbortController", async () => {
    const f = vi.fn().mockImplementation(
      (_u: string, init: { signal: AbortSignal }) =>
        new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    );
    vi.stubGlobal("fetch", f);
    await expect(search({ query: "x" }, { ...opts, timeoutMs: 20 })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("retries network errors", async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(json(200, { results: [] }));
    vi.stubGlobal("fetch", f);
    const r = await search({ query: "x" }, opts);
    expect(r.results).toEqual([]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("rejects >10 urls", async () => {
    await expect(fetchPages({ urls: Array.from({ length: 11 }, (_, i) => `https://amazon.in/dp/B0000000${i}`) }, opts)).rejects.toMatchObject({ kind: "bad_request" });
  });

  it("runAgent creates run and polls to completion", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(200, { run_id: "r1", error: null }))
      .mockResolvedValueOnce(json(200, { status: "RUNNING" }))
      .mockResolvedValueOnce(json(200, { status: "COMPLETED", result: { price: 100 } }));
    vi.stubGlobal("fetch", f);
    const r = await runAgent({ url: "https://www.croma.com/p/1", goal: "g", pollIntervalMs: 1 }, opts);
    expect(r).toMatchObject({ runId: "r1", status: "COMPLETED", result: { price: 100 } });
    expect(String(f.mock.calls[0][0])).toBe("https://agent.tinyfish.ai/v1/automation/run-async");
    expect(String(f.mock.calls[1][0])).toBe("https://agent.tinyfish.ai/v1/runs/r1");
  });
});

describe("429 handling", () => {
  it("honours Retry-After once, then succeeds; never loops on 429", async () => {
    const { resetCooldowns } = await import("../tinyfish");
    resetCooldowns();
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "0.05" } }) : new Response(JSON.stringify({ results: [] }), { status: 200 }))));
    await search({ query: "a" }, { apiKey: "k", baseDelayMs: 1 });
    expect(n).toBe(2);
    resetCooldowns();
    n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (n++, new Response("slow down", { status: 429, headers: { "retry-after": "0.05" } }))));
    await expect(search({ query: "b" }, { apiKey: "k", baseDelayMs: 1, retries: 3 })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(n).toBe(2);
    resetCooldowns();
    vi.unstubAllGlobals();
  });
});

