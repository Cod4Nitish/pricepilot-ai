import { describe, expect, it, vi } from "vitest";
import { buildSplit, buildStoreBasket, compareBaskets } from "../basket";
import { normalizeAgentOutput } from "../goals";
import { scoreFastListing } from "../match";
import { parseEtaMinutes, parsePack, samePack, unitPrice } from "../pack";
import { PROVIDERS, PROVIDER_BY_ID, providerStatus, safeProductUrl } from "../providers";
import { parseSse, toAgentEvent, type AgentEvent } from "../sse";
import { streamAgent } from "../agent";
import { Battle } from "../battle";
import type { BasketLine, FastOffer, LineResult, ProviderResult, StoreFees } from "../types";

const blinkit = PROVIDER_BY_ID.blinkit;
const zepto = PROVIDER_BY_ID.zepto;

describe("pack parser", () => {
  it("parses volumes and weights", () => {
    expect(parsePack("Amul Gold Milk 500 ml")).toMatchObject({ kind: "volume", total: 500 });
    expect(parsePack("Toned milk 1 L")).toMatchObject({ kind: "volume", total: 1000 });
    expect(parsePack("Atta 5kg")).toMatchObject({ kind: "weight", total: 5000 });
    expect(parsePack("2 x 500 g")).toMatchObject({ kind: "weight", total: 1000 });
  });
  it("parses counts and distinguishes 6 vs 12", () => {
    expect(parsePack("Eggs pack of 12")).toMatchObject({ kind: "count", total: 12 });
    expect(parsePack("6 eggs")).toMatchObject({ kind: "count", total: 6 });
    expect(samePack(parsePack("12 eggs"), parsePack("6 eggs"))).toBe(false);
    expect(samePack(parsePack("1 L"), parsePack("1000 ml"))).toBe(true);
  });
  it("returns null when not stated", () => {
    expect(parsePack("Amul Butter")).toBeNull();
    expect(parsePack(null)).toBeNull();
  });
  it("parses published ETA only", () => {
    expect(parseEtaMinutes("8 minutes")).toBe(8);
    expect(parseEtaMinutes("10-15 mins")).toBe(15);
    expect(parseEtaMinutes("Tomorrow 6 AM")).toBeNull();
  });
});

describe("unit price", () => {
  it("computes only with a parsed pack", () => {
    expect(unitPrice(30, parsePack("500 ml"))).toEqual({ value: 6, per: "100ml" });
    expect(unitPrice(100, parsePack("250 g"))).toEqual({ value: 40, per: "100g" });
    expect(unitPrice(84, parsePack("12 eggs"))).toEqual({ value: 7, per: "unit" });
    expect(unitPrice(30, null)).toBeNull();
    expect(unitPrice(null, parsePack("1 L"))).toBeNull();
  });
});

describe("variant matching", () => {
  it("rejects a different pack size", () => {
    const m = scoreFastListing("amul gold milk 500 ml", { title: "Amul Gold Milk", packLabel: "1 L" });
    expect(m.hardExcluded).toBe(true);
  });
  it("accepts exact pack", () => {
    const m = scoreFastListing("amul gold milk 500 ml", { title: "Amul Gold Full Cream Milk", brand: "Amul", packLabel: "500 ml" });
    expect(m.hardExcluded).toBe(false);
    expect(m.confidence).toBeGreaterThanOrEqual(0.7);
  });
  it("does not confidently match when pack missing but requested", () => {
    const m = scoreFastListing("eggs 12", { title: "Farm Eggs" });
    expect(m.confidence).toBeLessThan(0.7);
  });
});

// --- helpers to build results ---
const noFees = (): StoreFees => ({ delivery: null, handling: null, platform: null, discount: null, evidence: null });
function offer(providerId: "blinkit" | "zepto", query: string, price: number, pack = "500 ml"): FastOffer {
  return {
    providerId, query, title: query, brand: null, packLabel: pack, pack: parsePack(pack), price, mrp: null, discountPct: null,
    available: true, deliveryEta: null, etaMinutes: null, productUrl: null, unitPrice: unitPrice(price, parsePack(pack)),
    matchConfidence: 0.95, matchNotes: [], evidence: "x",
  };
}
function result(id: "blinkit" | "zepto", prices: Record<string, number | null>, fees: Partial<StoreFees> = {}, eta: string | null = null): ProviderResult {
  const lines: LineResult[] = Object.entries(prices).map(([q, p]) =>
    p === null
      ? { query: q, resolution: "out_of_stock", offer: null, rejected: [], note: "" }
      : { query: q, resolution: "found", offer: offer(id, q, p), rejected: [], note: "" },
  );
  return {
    providerId: id, providerName: PROVIDER_BY_ID[id].name, state: lines.every((l) => l.resolution === "found") ? "ok" : "partial", reason: "",
    locationVerified: true, locationEvidence: "Delivering to 560001", runId: "r", lines, fees: { ...noFees(), ...fees },
    etaText: eta, etaMinutes: parseEtaMinutes(eta), checkedAt: "2026-01-01T00:00:00Z", homeUrl: PROVIDER_BY_ID[id].homeUrl,
  };
}
const lines: BasketLine[] = [{ query: "milk", qty: 2 }, { query: "bread", qty: 1 }];

describe("basket totals", () => {
  it("is estimated and lists unknown fees when fees are null", () => {
    const b = buildStoreBasket(result("blinkit", { milk: 30, bread: 40 }), lines);
    expect(b.itemsTotal).toBe(100);
    expect(b.total).toBe(100);
    expect(b.totalKind).toBe("estimated");
    expect(b.totalLabel).toBe("Estimated (excludes unknown fees)");
    expect(b.unknownComponents).toEqual(["delivery fee", "handling fee", "platform fee", "discount"]);
  });
  it("is verified only when every component is known", () => {
    const b = buildStoreBasket(result("blinkit", { milk: 30, bread: 40 }, { delivery: 0, handling: 5, platform: 2, discount: 10, evidence: "bill" }), lines);
    expect(b.totalKind).toBe("verified");
    expect(b.total).toBe(97);
  });
  it("marks partial baskets as incomplete", () => {
    const b = buildStoreBasket(result("blinkit", { milk: 30, bread: null }), lines);
    expect(b.complete).toBe(false);
    expect(b.missing).toEqual(["bread"]);
    expect(b.totalLabel).toMatch(/Partial estimate/);
  });
  it("failed provider is unavailable with reason", () => {
    const r = { ...result("zepto", {}), state: "captcha" as const, reason: "the site showed a CAPTCHA" };
    const b = buildStoreBasket({ ...r, lines: [] }, lines);
    expect(b.totalKind).toBe("unavailable");
    expect(b.totalLabel).toContain("Unavailable");
  });
});

describe("comparison and split", () => {
  it("names the cheapest complete basket with estimate kind", () => {
    const bs = [
      buildStoreBasket(result("blinkit", { milk: 30, bread: 40 }, {}, "8 minutes"), lines),
      buildStoreBasket(result("zepto", { milk: 28, bread: 45 }, {}, "12 minutes"), lines),
    ];
    const c = compareBaskets(bs, lines);
    expect(c.winner?.providerId).toBe("blinkit"); // 100 vs 101
    expect(c.winner?.kind).toBe("estimated");
    expect(c.winner?.savings).toBe(1);
    expect(c.fastest?.providerId).toBe("blinkit");
  });
  it("no winner when only one store is complete", () => {
    const bs = [buildStoreBasket(result("blinkit", { milk: 30, bread: 40 }), lines), buildStoreBasket(result("zepto", { milk: 28, bread: null }), lines)];
    const c = compareBaskets(bs, lines);
    expect(c.winner).toBeNull();
    expect(c.noWinnerReason).toMatch(/Only Blinkit/);
  });
  it("no winner when pack sizes differ across stores", () => {
    const z = result("zepto", { milk: 20, bread: 40 });
    z.lines[0].offer = offer("zepto", "milk", 20, "250 ml");
    const bs = [buildStoreBasket(result("blinkit", { milk: 30, bread: 40 }), lines), buildStoreBasket(z, lines)];
    const c = compareBaskets(bs, lines);
    expect(c.winner).toBeNull();
    expect(c.comparabilityIssues.length).toBe(1);
  });
  it("recommends split only when savings stay positive after known fees", () => {
    // blinkit: milk 30x2=60, bread 50 => 110 ; zepto: milk 40x2=80, bread 35 => 115
    const b1 = buildStoreBasket(result("blinkit", { milk: 30, bread: 50 }, { delivery: 0, handling: 0, platform: 0, discount: 0 }), lines);
    const z1 = buildStoreBasket(result("zepto", { milk: 40, bread: 35 }, { delivery: 0, handling: 0, platform: 0, discount: 0 }), lines);
    const s = buildSplit([b1, z1], lines, b1);
    expect(s?.total).toBe(95);
    expect(s?.recommended).toBe(true);
    expect(s?.savings).toBe(15);
    // zepto charges 20 delivery => split 115 vs 110 baseline: not recommended
    const z2 = buildStoreBasket(result("zepto", { milk: 40, bread: 35 }, { delivery: 20, handling: 0, platform: 0, discount: 0 }), lines);
    const s2 = buildSplit([b1, z2], lines, b1);
    expect(s2?.recommended).toBe(false);
    expect(s2?.savings).toBe(0);
  });
  it("fastest uses published ETA only and needs two", () => {
    const bs = [
      buildStoreBasket(result("blinkit", { milk: 30, bread: 40 }, {}, "9 minutes"), lines),
      buildStoreBasket(result("zepto", { milk: 31, bread: 40 }, {}, null), lines),
    ];
    const c = compareBaskets(bs, lines);
    expect(c.fastest).toBeNull();
    expect(c.fastestNote).toMatch(/Only Blinkit/);
  });
});

describe("provider states", () => {
  it("only blinkit and zepto are enabled; the rest carry reasons", () => {
    expect(PROVIDERS.filter((p) => p.status === "enabled").map((p) => p.id)).toEqual(["blinkit", "zepto"]);
    for (const p of PROVIDERS.filter((p) => p.status === "disabled")) expect(p.reason.length).toBeGreaterThan(10);
  });
  it("status reports not ready without a key", () => {
    const s = providerStatus(false);
    expect(s.providers.every((p) => !p.ready)).toBe(true);
    expect(s.providers.find((p) => p.id === "blinkit")?.reason).toMatch(/TINYFISH_API_KEY/);
    expect(providerStatus(true).providers.find((p) => p.id === "zepto")?.ready).toBe(true);
  });
  it("only provider-domain https product links are kept", () => {
    expect(safeProductUrl(blinkit, "https://blinkit.com/prn/x/prid/1")).toContain("blinkit.com");
    expect(safeProductUrl(blinkit, "https://evil.com/blinkit.com")).toBeNull();
    expect(safeProductUrl(blinkit, "http://blinkit.com/x")).toBeNull();
  });
});

describe("agent output normalisation", () => {
  it("refuses prices when the location was not confirmed", () => {
    const r = normalizeAgentOutput(blinkit, ["milk"], { status: "ok", location_set: false, items: [{ query: "milk", title: "Milk", price: 30 }] });
    expect(r.state).toBe("location_failed");
    expect(r.lines[0].offer).toBeNull();
  });
  it("reports blocked/captcha honestly", () => {
    const r = normalizeAgentOutput(zepto, ["milk"], { status: "captcha", location_set: false, items: [] });
    expect(r.state).toBe("captcha");
    expect(r.reason).toMatch(/CAPTCHA/);
  });
  it("extracts exact-variant items and rejects wrong pack", () => {
    const r = normalizeAgentOutput(blinkit, ["amul milk 500 ml"], {
      status: "ok", location_set: true, location_evidence: "560001", store_eta: "10 minutes",
      items: [
        { query: "amul milk 500 ml", title: "Amul Milk", pack_size: "1 L", price: "62", available: true },
        { query: "amul milk 500 ml", title: "Amul Milk", brand: "Amul", pack_size: "500 ml", price: "₹32", mrp: 34, available: true, product_url: "https://blinkit.com/prn/amul/prid/9", evidence: "Amul Milk 500 ml ₹32" },
      ],
    });
    expect(r.state).toBe("ok");
    expect(r.lines[0].offer?.price).toBe(32);
    expect(r.lines[0].offer?.unitPrice).toEqual({ value: 6.4, per: "100ml" });
    expect(r.etaMinutes).toBe(10);
    expect(r.fees.delivery).toBeNull();
  });
});

// --- SSE ---
function bodyOf(text: string, chunk = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    },
  });
}
const frame = (o: Record<string, unknown>) => `data: ${JSON.stringify(o)}\n\n`;
const sseText = (runId: string, result: unknown) =>
  frame({ type: "STARTED", run_id: runId }) +
  frame({ type: "STREAMING_URL", run_id: runId, streaming_url: "https://stream.example/live/1" }) +
  frame({ type: "PROGRESS", purpose: "Setting location" }) +
  ": comment\n\n" +
  frame({ type: "HEARTBEAT" }) +
  frame({ type: "COMPLETE", status: "COMPLETED", run_id: runId, result });

describe("SSE parsing", () => {
  it("parses chunked frames incl. CRLF", async () => {
    const out: string[] = [];
    for await (const e of parseSse(bodyOf("event: PROGRESS\r\ndata: {\"purpose\":\"a\"}\r\n\r\ndata: x\ndata: y\n\n", 5))) out.push(e.event + "|" + e.data);
    expect(out).toEqual(['PROGRESS|{"purpose":"a"}', "null|x\ny"]);
  });
  it("maps TinyFish events and ignores unknown ones", () => {
    expect(toAgentEvent({ event: null, data: '{"type":"PROGRESS","purpose":"Searching"}', id: null })).toEqual({ type: "progress", purpose: "Searching" });
    expect(toAgentEvent({ event: "STARTED", data: '{"run_id":"abc"}', id: null })).toEqual({ type: "started", runId: "abc" });
    expect(toAgentEvent({ event: null, data: '{"type":"WHATEVER"}', id: null })).toBeNull();
  });
});

describe("streamAgent + battle relay (mocked fetch)", () => {
  const good = (q: string) => ({
    status: "ok", location_set: true, location_evidence: "Delivering to 560001", store_eta: "9 minutes",
    items: [{ query: q, title: q + " 500 ml", pack_size: "500 ml", price: 30, available: true, evidence: "30" }],
  });

  it("relays only real upstream events in order, with API key header and body shape", async () => {
    const fetchImpl = vi.fn(async () => new Response(bodyOf(sseText("run1", good("milk"))))) as unknown as typeof fetch;
    const evs: AgentEvent[] = [];
    for await (const e of streamAgent({ provider: blinkit, pincode: "560001", queries: ["milk"], apiKey: "k", fetchImpl })) evs.push(e);
    expect(evs.map((e) => e.type)).toEqual(["started", "streaming_url", "progress", "heartbeat", "complete"]);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://agent.tinyfish.ai/v1/automation/run-sse");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("k");
    const body = JSON.parse(String(init.body));
    expect(body.proxy_config).toEqual({ enabled: true, type: "tinyfish", country_code: "IN" });
    expect(body.goal).toContain("560001");
    expect(body.goal).toMatch(/CAPTCHA/);
  });

  it("surfaces HTTP failure as a failed completion, not fake data", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 402 })) as unknown as typeof fetch;
    const evs: AgentEvent[] = [];
    for await (const e of streamAgent({ provider: zepto, pincode: "560001", queries: ["milk"], apiKey: "k", fetchImpl })) evs.push(e);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ type: "complete", status: "FAILED" });
  });

  it("falls back to GET /runs/{id} when stream ends without COMPLETE", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/run-sse")
        ? new Response(bodyOf(frame({ type: "STARTED", run_id: "r9" })))
        : new Response(JSON.stringify({ status: "FAILED", error: "boom" })),
    ) as unknown as typeof fetch;
    const evs: AgentEvent[] = [];
    for await (const e of streamAgent({ provider: zepto, pincode: "560001", queries: ["milk"], apiKey: "k", fetchImpl })) evs.push(e);
    expect(evs.at(-1)).toMatchObject({ type: "complete", status: "FAILED", error: "boom" });
  });

  it("runs two lanes in parallel and emits a comparison from real results", async () => {
    const stream = (p: { provider: { id: string }; queries: string[] }) =>
      streamAgent({
        provider: p.provider as typeof blinkit, pincode: "560001", queries: p.queries, apiKey: "k",
        fetchImpl: (async () => new Response(bodyOf(sseText("run-" + p.provider.id, good(p.queries[0]))))) as unknown as typeof fetch,
      });
    const battle = new Battle("560001", [{ query: "milk", qty: 1 }], [blinkit, zepto], stream);
    await battle.run();
    const types = battle.events.map((e) => e.type);
    expect(types[0]).toBe("battle_started");
    expect(types.filter((t) => t === "agent_started")).toHaveLength(2);
    expect(types.filter((t) => t === "provider_result")).toHaveLength(2);
    expect(types.filter((t) => t === "progress")).toHaveLength(2);
    expect(types.at(-1)).toBe("done");
    expect(types).toContain("comparison");
    expect(battle.events.map((e) => e.seq)).toEqual(battle.events.map((_, i) => i + 1));
    expect(battle.events.find((e) => e.type === "streaming_url")?.streamingUrl).toBe("https://stream.example/live/1");
    // resume
    const resumed: number[] = [];
    for await (const e of battle.tail(5)) resumed.push(e.seq);
    expect(resumed[0]).toBe(6);
  });

  it("a lane failing yields provider_failed 'unavailable' and cancel hits the cancel endpoint", async () => {
    const cancelFn = vi.fn(async () => true);
    const stream = async function* (p: { provider: { id: string } }): AsyncGenerator<AgentEvent> {
      yield { type: "started", runId: "run-" + p.provider.id };
      if (p.provider.id === "zepto") {
        yield { type: "complete", status: "COMPLETED", result: { status: "captcha", location_set: false, items: [] }, error: null, runId: "run-zepto" };
      } else {
        await new Promise((r) => setTimeout(r, 30));
        yield { type: "complete", status: "COMPLETED", result: good("milk"), error: null, runId: "run-blinkit" };
      }
    };
    const battle = new Battle("560001", [{ query: "milk", qty: 1 }], [blinkit, zepto], stream as never, cancelFn);
    await battle.run();
    const failed = battle.events.find((e) => e.type === "provider_failed");
    expect(failed?.provider).toBe("zepto");
    expect(failed?.message).toMatch(/^unavailable: /);
    const b2 = new Battle("560001", [{ query: "milk", qty: 1 }], [blinkit], (async function* () {
      yield { type: "started", runId: "rX" } as AgentEvent;
      await new Promise((r) => setTimeout(r, 200));
    }) as never, cancelFn);
    const p = b2.run();
    await new Promise((r) => setTimeout(r, 20));
    await b2.cancel();
    await p;
    expect(cancelFn).toHaveBeenCalledWith("rX");
    expect(b2.events.some((e) => e.type === "cancelled")).toBe(true);
  });
});
