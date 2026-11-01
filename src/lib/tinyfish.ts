import { getCostConfig } from "./cost/config";
import { meter } from "./cost/meter";
import { requireTinyFishKey, userKey } from "./byok";

export type TinyFishErrorKind =
  | "auth" // 401
  | "insufficient_credits" // 402
  | "rate_limited" // 429
  | "unavailable" // 503
  | "timeout"
  | "network"
  | "bad_request"
  | "upstream"
  | "budget_exhausted"; // app-side paid-usage limit (daily runs / USD); never retried

export class TinyFishError extends Error {
  constructor(
    public kind: TinyFishErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "TinyFishError";
  }
  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "unavailable" || this.kind === "network";
  }
}

export interface SearchResult {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
}
export interface SearchOutput {
  query: string;
  results: SearchResult[];
  total_results: number;
  page: number;
}
export interface FetchedPage {
  url: string;
  final_url?: string;
  title?: string;
  description?: string;
  text?: string;
  image_links?: string[];
  links?: string[];
  latency_ms?: number;
}
export interface FetchPageError {
  url: string;
  error: string;
  status?: number;
}
export interface FetchOutput {
  results: FetchedPage[];
  errors: FetchPageError[];
}
export type AgentStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export interface AgentRunResult {
  runId: string;
  status: AgentStatus;
  result: unknown;
  error?: string;
  /** Provider-metered step count (GET /v1/runs num_of_steps); null when the provider did not return it. */
  steps?: number | null;
}

export interface ClientOptions {
  apiKey?: string;
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

const SEARCH_URL = "https://api.search.tinyfish.ai";
const FETCH_URL = "https://api.fetch.tinyfish.ai";
const AGENT_BASE = "https://agent.tinyfish.ai/v1";

// --- concurrency limiter ---
export class Limiter {
  private active = 0;
  private q: (() => void)[] = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.q.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.q.shift()?.();
    }
  }
}
const limiter = new Limiter(6);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// After a 429, pause that endpoint (search / fetch / agent) for Retry-After (or a backoff) instead of hammering it.
const cooldownUntil = new Map<string, number>();
const MAX_COOLDOWN_WAIT_MS = 8_000;
function endpointOf(url: string): string {
  return url.startsWith(SEARCH_URL) ? "search" : url.startsWith(FETCH_URL) ? "fetch" : "agent";
}
/** Retry-After as seconds or HTTP date -> ms (capped), else null. */
export function retryAfterMs(h: string | null): number | null {
  if (!h) return null;
  const s = Number(h);
  const ms = Number.isFinite(s) ? s * 1000 : Date.parse(h) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 60_000) : null;
}
export function resetCooldowns(): void {
  cooldownUntil.clear();
}

function statusToError(status: number, body: string): TinyFishError {
  const msg = `TinyFish HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ""}`;
  if (status === 401 || status === 403) return new TinyFishError("auth", "TinyFish rejected the API key.", status);
  if (status === 402) return new TinyFishError("insufficient_credits", "TinyFish credits are exhausted.", status);
  if (status === 429) return new TinyFishError("rate_limited", "TinyFish rate limit hit.", status);
  if (status === 503 || status === 502 || status === 504) return new TinyFishError("unavailable", msg, status);
  if (status >= 400 && status < 500) return new TinyFishError("bad_request", msg, status);
  return new TinyFishError("upstream", msg, status);
}

async function request<T>(
  url: string,
  init: { method: string; body?: unknown },
  opts: ClientOptions = {},
): Promise<T> {
  const apiKey = opts.apiKey ?? requireTinyFishKey();
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  let lastErr: TinyFishError | undefined;

  const ep = endpointOf(url);
  let hits429 = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = (cooldownUntil.get(ep) ?? 0) - Date.now();
    if (wait > MAX_COOLDOWN_WAIT_MS) throw new TinyFishError("rate_limited", `TinyFish ${ep} is rate limited; not retried (cooling down).`, 429);
    if (wait > 0) await sleep(wait);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await limiter.run(() =>
        fetch(url, {
          method: init.method,
          headers: {
            "X-API-Key": apiKey,
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: ac.signal,
        }),
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 429) {
          const ra = retryAfterMs(res.headers.get("retry-after")) ?? base * 2 ** (attempt + 2);
          cooldownUntil.set(ep, Math.max(cooldownUntil.get(ep) ?? 0, Date.now() + ra));
          // one retry at most for 429 (after the cooldown), never an aggressive loop
          if (++hits429 >= 2) throw new TinyFishError("rate_limited", "TinyFish rate limit hit twice; not retried again.", 429);
        }
        throw statusToError(res.status, text);
      }
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof TinyFishError) lastErr = e;
      else if ((e as Error)?.name === "AbortError") lastErr = new TinyFishError("timeout", `TinyFish request timed out after ${timeoutMs}ms.`);
      else lastErr = new TinyFishError("network", `TinyFish network error: ${(e as Error)?.message ?? "unknown"}`);
      // timeouts are not retried (cost/latency protection); 402/401/4xx never retried
      if (!lastErr.retryable || attempt === retries || (lastErr.kind === "rate_limited" && hits429 >= 2)) throw lastErr;
      if (lastErr.kind !== "rate_limited") await sleep(base * 2 ** attempt + Math.floor(Math.random() * (base / 2))); // 429 waits via the cooldown above
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new TinyFishError("upstream", "Unknown TinyFish failure.");
}

export async function search(
  p: { query: string; location?: string; includeDomains?: string[]; excludeDomains?: string[]; page?: number },
  opts?: ClientOptions,
): Promise<SearchOutput> {
  const qs = new URLSearchParams({ query: p.query });
  if (p.location) qs.set("location", p.location);
  if (p.includeDomains?.length) qs.set("include_domains", p.includeDomains.join(","));
  if (p.excludeDomains?.length) qs.set("exclude_domains", p.excludeDomains.join(","));
  if (p.page !== undefined) qs.set("page", String(Math.min(10, Math.max(0, p.page))));
  meter.searchCall();
  const out = await request<Partial<SearchOutput>>(`${SEARCH_URL}?${qs}`, { method: "GET" }, opts);
  return { query: out.query ?? p.query, results: out.results ?? [], total_results: out.total_results ?? 0, page: out.page ?? 0 };
}

export async function fetchPages(
  p: { urls: string[]; ttl?: number; perUrlTimeoutMs?: number; imageLinks?: boolean; links?: boolean },
  opts?: ClientOptions,
): Promise<FetchOutput> {
  if (p.urls.length === 0) return { results: [], errors: [] };
  if (p.urls.length > 10) throw new TinyFishError("bad_request", "fetchPages accepts at most 10 urls.");
  meter.fetchCall(p.urls.length);
  const out = await request<Partial<FetchOutput>>(
    FETCH_URL,
    {
      method: "POST",
      body: {
        urls: p.urls,
        format: "markdown",
        ttl: p.ttl ?? 3600,
        per_url_timeout_ms: Math.min(110_000, Math.max(1, p.perUrlTimeoutMs ?? getCostConfig().fetchTimeoutMs)),
        ...(p.imageLinks ? { image_links: true } : {}),
        ...(p.links ? { links: true } : {}),
      },
    },
    { timeoutMs: 120_000, ...opts },
  );
  return { results: out.results ?? [], errors: out.errors ?? [] };
}

/**
 * TinyFish rejects JSON-schema annotation keys in output_schema (HTTP 400 "field \"description\" is not supported",
 * observed 2026-11-01). Strip them recursively; field meanings belong in the goal text.
 */
const UNSUPPORTED_SCHEMA_KEYS = new Set(["description", "title", "examples", "default", "$comment"]);
export function sanitizeOutputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeOutputSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "properties" && v && typeof v === "object") {
      // property NAMES (e.g. a field called "title") are data, not annotations: keep every name, clean each value
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, sanitizeOutputSchema(pv)]));
    } else if (!UNSUPPORTED_SCHEMA_KEYS.has(k)) out[k] = sanitizeOutputSchema(v);
  }
  return out;
}

let agentLimiter: Limiter | null = null;
/** Process-wide cap on paid Agent runs in flight (PP_AGENT_MAX_CONCURRENT). */
function paidAgentLimiter(): Limiter {
  agentLimiter ??= new Limiter(getCostConfig().agentMaxConcurrent);
  return agentLimiter;
}
const stepsOf = (r: { num_of_steps?: unknown }) => (typeof r.num_of_steps === "number" && Number.isFinite(r.num_of_steps) ? r.num_of_steps : null);

/**
 * Paid TinyFish Agent run (async + poll). Gated by the daily paid-usage limits and the concurrency cap,
 * and metered with the provider's num_of_steps. Throws TinyFishError("budget_exhausted") when a limit blocks it.
 */
export async function runAgent(
  p: {
    url: string;
    goal: string;
    outputSchema?: Record<string, unknown>;
    stealth?: boolean;
    maxDurationSeconds?: number;
    pollIntervalMs?: number;
    overallTimeoutMs?: number;
  },
  opts?: ClientOptions & { onRunId?: (id: string) => void },
): Promise<AgentRunResult> {
  return paidAgentLimiter().run(async () => {
    // the server's daily paid limits protect the SERVER key; a user's own key is billed to their account
    const gate = userKey() ? ({ ok: true } as const) : meter.canStartAgent();
    if (!gate.ok) throw new TinyFishError("budget_exhausted", gate.message);
    const created = await request<{ run_id?: string; error?: unknown }>(
      `${AGENT_BASE}/automation/run-async`,
      {
        method: "POST",
        body: {
          url: p.url,
          goal: p.goal,
          ...(p.outputSchema ? { output_schema: sanitizeOutputSchema(p.outputSchema) } : {}),
          browser_profile: p.stealth ? "stealth" : "lite",
          proxy_config: { enabled: true, type: "tinyfish", country_code: "IN" },
          agent_config: { max_duration_seconds: p.maxDurationSeconds ?? getCostConfig().agentMaxDurationS },
        },
      },
      opts,
    );
    if (!created.run_id) {
      throw new TinyFishError("upstream", `TinyFish agent did not return a run_id${created.error ? `: ${JSON.stringify(created.error).slice(0, 200)}` : "."}`);
    }
    const runId = created.run_id;
    meter.agentStart();
    opts?.onRunId?.(runId);
    const poll = p.pollIntervalMs ?? 3000;
    const deadline = Date.now() + (p.overallTimeoutMs ?? getCostConfig().agentOverallTimeoutMs);
    try {
      while (Date.now() < deadline) {
        const r = await request<{ status: AgentStatus; result?: unknown; error?: unknown; num_of_steps?: unknown }>(
          `${AGENT_BASE}/runs/${encodeURIComponent(runId)}`,
          { method: "GET" },
          opts,
        );
        if (r.status === "COMPLETED" || r.status === "FAILED" || r.status === "CANCELLED") {
          const steps = stepsOf(r);
          meter.agentEnd(r.status === "COMPLETED" ? "completed" : "failed", steps);
          return {
            runId,
            status: r.status,
            result: r.result ?? null,
            error: r.error ? (typeof r.error === "string" ? r.error : JSON.stringify(r.error).slice(0, 300)) : undefined,
            steps,
          };
        }
        await sleep(poll);
      }
    } catch (e) {
      meter.agentEnd("failed", null);
      throw e;
    }
    await cancelAgentRun(runId, opts).catch(() => undefined);
    // best effort: read the metered steps of the cancelled run so the spend is still counted
    const fin = await request<{ num_of_steps?: unknown }>(`${AGENT_BASE}/runs/${encodeURIComponent(runId)}`, { method: "GET" }, { ...opts, retries: 0 }).catch(() => ({}));
    meter.agentEnd("timeout", stepsOf(fin));
    throw new TinyFishError("timeout", "TinyFish agent run timed out and was cancelled.");
  });
}

export async function cancelAgentRun(runId: string, opts?: ClientOptions): Promise<void> {
  await request(`${AGENT_BASE}/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST", body: {} }, { ...opts, retries: 0 });
}
