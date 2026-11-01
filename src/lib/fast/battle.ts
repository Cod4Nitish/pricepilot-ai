import { randomUUID } from "node:crypto";
import { cancelRun, streamAgent } from "./agent";
import { buildStoreBasket, compareBaskets } from "./basket";
import { failedResult, normalizeAgentOutput } from "./goals";
import { ENABLED_PROVIDERS } from "./providers";
import { safePreviewUrl, type AgentEvent } from "./sse";
import type { BasketLine, BattleEvent, ProviderConfig, ProviderId, ProviderResult } from "./types";

export const MAX_ACTIVE_BATTLES = 2;
const KEEP_MS = 15 * 60_000;

type StreamFn = (p: { provider: ProviderConfig; pincode: string; queries: string[]; signal?: AbortSignal }) => AsyncGenerator<AgentEvent>;

/**
 * A live battle: one real TinyFish run-sse agent per provider (in parallel). Every emitted event is a
 * relay of a real upstream event or a result computed from real upstream output. The event log is kept
 * in memory so a dropped browser connection can resume with the last seq it saw.
 */
export class Battle {
  readonly id = randomUUID();
  readonly events: BattleEvent[] = [];
  done = false;
  cancelled = false;
  readonly createdAt = Date.now();
  private listeners = new Set<() => void>();
  private ac = new AbortController();
  private runIds = new Map<ProviderId, string>();
  private results = new Map<ProviderId, ProviderResult>();

  constructor(
    readonly pincode: string,
    readonly lines: BasketLine[],
    private providers: ProviderConfig[],
    private stream: StreamFn = streamAgent,
    private cancelFn: (runId: string) => Promise<boolean> = (id) => cancelRun(id),
  ) {}

  private push(e: Omit<BattleEvent, "seq" | "at">): void {
    this.events.push({ ...e, seq: this.events.length + 1, at: new Date().toISOString() });
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async run(): Promise<void> {
    this.push({ type: "battle_started", battleId: this.id, message: `Starting ${this.providers.map((p) => p.name).join(" vs ")} for pincode ${this.pincode}` });
    await Promise.all(this.providers.map((p) => this.runProvider(p)));
    if (!this.cancelled) {
      const results = this.providers.map((p) => this.results.get(p.id)).filter((r): r is ProviderResult => !!r);
      const baskets = results.map((r) => buildStoreBasket(r, this.lines));
      this.push({ type: "comparison", baskets, comparison: compareBaskets(baskets, this.lines) });
    }
    this.push({ type: "done" });
    this.done = true;
    for (const l of this.listeners) l();
  }

  private async runProvider(p: ProviderConfig): Promise<void> {
    const queries = this.lines.map((l) => l.query);
    try {
      for await (const ev of this.stream({ provider: p, pincode: this.pincode, queries, signal: this.ac.signal })) {
        switch (ev.type) {
          case "started":
            if (ev.runId) this.runIds.set(p.id, ev.runId);
            this.push({ type: "agent_started", provider: p.id, runId: ev.runId ?? undefined, message: `${p.name} agent started` });
            break;
          case "streaming_url": {
            const url = safePreviewUrl(ev.url);
            if (url) this.push({ type: "streaming_url", provider: p.id, streamingUrl: url });
            break;
          }
          case "progress":
            this.push({ type: "progress", provider: p.id, message: ev.purpose });
            break;
          case "heartbeat":
            this.push({ type: "heartbeat", provider: p.id });
            break;
          case "complete": {
            if (ev.runId) this.runIds.set(p.id, ev.runId);
            let result: ProviderResult;
            if (ev.status === "CANCELLED") result = failedResult(p, queries, "cancelled", null, ev.runId);
            else if (ev.status === "FAILED") result = failedResult(p, queries, /time/i.test(ev.error ?? "") ? "timeout" : "error", ev.error, ev.runId);
            else result = normalizeAgentOutput(p, queries, ev.result, ev.runId);
            this.results.set(p.id, result);
            if (result.state === "ok" || result.state === "partial" || result.state === "no_results") this.push({ type: "provider_result", provider: p.id, result });
            else this.push({ type: "provider_failed", provider: p.id, message: `unavailable: ${result.reason}`, result });
            return;
          }
        }
      }
    } catch (e) {
      const result = failedResult(p, queries, "error", (e as Error)?.message ?? "unexpected error", this.runIds.get(p.id) ?? null);
      this.results.set(p.id, result);
      this.push({ type: "provider_failed", provider: p.id, message: `unavailable: ${result.reason}`, result });
      return;
    }
    if (!this.results.has(p.id)) {
      const result = failedResult(p, queries, "error", "the agent stream ended without a result", this.runIds.get(p.id) ?? null);
      this.results.set(p.id, result);
      this.push({ type: "provider_failed", provider: p.id, message: `unavailable: ${result.reason}`, result });
    }
  }

  /** Abort local streams and ask TinyFish to cancel each known run (POST /v1/runs/{id}/cancel). */
  async cancel(): Promise<void> {
    if (this.done || this.cancelled) return;
    this.cancelled = true;
    this.ac.abort();
    await Promise.all([...this.runIds.values()].map((id) => this.cancelFn(id)));
    this.push({ type: "cancelled", message: "Battle cancelled by user" });
  }

  /** Async generator of events with seq > after; ends when the battle is done. */
  async *tail(after = 0, signal?: AbortSignal): AsyncGenerator<BattleEvent> {
    let i = after;
    for (;;) {
      while (i < this.events.length) yield this.events[i++];
      if (this.done || signal?.aborted) return;
      await new Promise<void>((resolve) => {
        const off = this.subscribe(() => {
          off();
          resolve();
        });
        signal?.addEventListener("abort", () => {
          off();
          resolve();
        }, { once: true });
      });
    }
  }
}

const battles = new Map<string, Battle>();

function sweep(): void {
  const now = Date.now();
  for (const [id, b] of battles) if (b.done && now - b.createdAt > KEEP_MS) battles.delete(id);
}

export function activeBattleCount(): number {
  let n = 0;
  for (const b of battles.values()) if (!b.done) n++;
  return n;
}

export function getBattle(id: string): Battle | undefined {
  return battles.get(id);
}

export function startBattle(pincode: string, lines: BasketLine[], opts?: { providers?: ProviderConfig[]; stream?: StreamFn; cancelFn?: (id: string) => Promise<boolean> }): Battle {
  sweep();
  const b = new Battle(pincode, lines, opts?.providers ?? ENABLED_PROVIDERS(), opts?.stream, opts?.cancelFn);
  battles.set(b.id, b);
  void b.run().catch((e) => console.error("[battle] run failed", e));
  return b;
}

/** Encode one event as an SSE frame. */
export function encodeSse(e: BattleEvent): string {
  return `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}
