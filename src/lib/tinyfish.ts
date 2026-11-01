import { requireEnv } from "./env";

export type TinyFishErrorKind =
  | "auth" // 401
  | "insufficient_credits" // 402
  | "rate_limited" // 429
  | "unavailable" // 503
  | "timeout"
  | "network"
  | "bad_request"
  | "upstream";

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
  const apiKey = opts.apiKey ?? requireEnv("TINYFISH_API_KEY");
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  let lastErr: TinyFishError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
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
        throw statusToError(res.status, text);
      }
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof TinyFishError) lastErr = e;
      else if ((e as Error)?.name === "AbortError") lastErr = new TinyFishError("timeout", `TinyFish request timed out after ${timeoutMs}ms.`);
      else lastErr = new TinyFishError("network", `TinyFish network error: ${(e as Error)?.message ?? "unknown"}`);
      // timeouts are not retried (cost/latency protection); 402/401/4xx never retried
      if (!lastErr.retryable || attempt === retries) throw lastErr;
      await sleep(base * 2 ** attempt + Math.floor(Math.random() * (base / 2)));
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
  const out = await request<Partial<SearchOutput>>(`${SEARCH_URL}?${qs}`, { method: "GET" }, opts);
  return { query: out.query ?? p.query, results: out.results ?? [], total_results: out.total_results ?? 0, page: out.page ?? 0 };
}

export async function fetchPages(
  p: { urls: string[]; ttl?: number; perUrlTimeoutMs?: number; imageLinks?: boolean; links?: boolean },
  opts?: ClientOptions,
): Promise<FetchOutput> {
  if (p.urls.length === 0) return { results: [], errors: [] };
  if (p.urls.length > 10) throw new TinyFishError("bad_request", "fetchPages accepts at most 10 urls.");
  const out = await request<Partial<FetchOutput>>(
    FETCH_URL,
    {
      method: "POST",
      body: {
        urls: p.urls,
        format: "markdown",
        ttl: p.ttl ?? 3600,
        per_url_timeout_ms: Math.min(110_000, Math.max(1, p.perUrlTimeoutMs ?? 45_000)),
        ...(p.imageLinks ? { image_links: true } : {}),
        ...(p.links ? { links: true } : {}),
      },
    },
    { timeoutMs: 120_000, ...opts },
  );
  return { results: out.results ?? [], errors: out.errors ?? [] };
}

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
  const created = await request<{ run_id?: string; error?: unknown }>(
    `${AGENT_BASE}/automation/run-async`,
    {
      method: "POST",
      body: {
        url: p.url,
        goal: p.goal,
        ...(p.outputSchema ? { output_schema: p.outputSchema } : {}),
        browser_profile: p.stealth ? "stealth" : "lite",
        proxy_config: { enabled: true, type: "tinyfish", country_code: "IN" },
        agent_config: { max_duration_seconds: p.maxDurationSeconds ?? 90 },
      },
    },
    opts,
  );
  if (!created.run_id) {
    throw new TinyFishError("upstream", `TinyFish agent did not return a run_id${created.error ? `: ${JSON.stringify(created.error).slice(0, 200)}` : "."}`);
  }
  const runId = created.run_id;
  opts?.onRunId?.(runId);
  const poll = p.pollIntervalMs ?? 3000;
  const deadline = Date.now() + (p.overallTimeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    const r = await request<{ status: AgentStatus; result?: unknown; error?: unknown }>(
      `${AGENT_BASE}/runs/${encodeURIComponent(runId)}`,
      { method: "GET" },
      opts,
    );
    if (r.status === "COMPLETED" || r.status === "FAILED" || r.status === "CANCELLED") {
      return {
        runId,
        status: r.status,
        result: r.result ?? null,
        error: r.error ? (typeof r.error === "string" ? r.error : JSON.stringify(r.error).slice(0, 300)) : undefined,
      };
    }
    await sleep(poll);
  }
  await cancelAgentRun(runId, opts).catch(() => undefined);
  throw new TinyFishError("timeout", "TinyFish agent run timed out and was cancelled.");
}

export async function cancelAgentRun(runId: string, opts?: ClientOptions): Promise<void> {
  await request(`${AGENT_BASE}/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST", body: {} }, { ...opts, retries: 0 });
}
