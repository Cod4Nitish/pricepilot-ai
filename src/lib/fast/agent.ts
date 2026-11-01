import { requireEnv } from "../env";
import { AGENT_MAX_SECONDS, OUTPUT_SCHEMA, buildGoal } from "./goals";
import { parseSse, toAgentEvent, type AgentEvent } from "./sse";
import type { ProviderConfig } from "./types";

const AGENT_BASE = "https://agent.tinyfish.ai/v1";

export interface StreamAgentParams {
  provider: ProviderConfig;
  pincode: string;
  queries: string[];
  signal?: AbortSignal;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function httpMessage(status: number): string {
  if (status === 401 || status === 403) return "the data provider rejected the API key";
  if (status === 402) return "the data provider has no remaining credits";
  if (status === 429) return "the data provider is rate limiting";
  return `the data provider returned HTTP ${status}`;
}

/**
 * Start a TinyFish run-sse agent and yield its REAL events. If the stream ends without COMPLETE
 * but we know the run id, one GET /v1/runs/{id} is made to read the true final status. Nothing is simulated.
 */
export async function* streamAgent(p: StreamAgentParams): AsyncGenerator<AgentEvent> {
  const f = p.fetchImpl ?? fetch;
  const apiKey = p.apiKey ?? requireEnv("TINYFISH_API_KEY");
  let runId: string | null = null;
  let completed = false;
  try {
    const res = await f(`${AGENT_BASE}/automation/run-sse`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        url: p.provider.homeUrl,
        goal: buildGoal(p.provider, p.pincode, p.queries),
        output_schema: OUTPUT_SCHEMA,
        browser_profile: "lite",
        proxy_config: { enabled: true, type: "tinyfish", country_code: "IN" },
        agent_config: { max_duration_seconds: AGENT_MAX_SECONDS },
      }),
      signal: p.signal,
    });
    if (!res.ok || !res.body) {
      completed = true;
      yield { type: "complete", status: "FAILED", result: null, error: httpMessage(res.status), runId: null };
      return;
    }
    for await (const raw of parseSse(res.body)) {
      const ev = toAgentEvent(raw);
      if (!ev) continue;
      if (ev.type === "started" && ev.runId) runId = ev.runId;
      if (ev.type === "complete") {
        completed = true;
        yield { ...ev, runId: ev.runId ?? runId };
        return;
      }
      yield ev;
    }
  } catch (e) {
    if (p.signal?.aborted) {
      completed = true;
      yield { type: "complete", status: "CANCELLED", result: null, error: null, runId };
      return;
    }
    if (!runId) {
      completed = true;
      yield { type: "complete", status: "FAILED", result: null, error: `network error: ${(e as Error)?.message ?? "unknown"}`, runId: null };
      return;
    }
  }
  if (completed) return;
  // Stream ended (or broke) without COMPLETE: read the run's true state once.
  if (runId) {
    try {
      const r = await f(`${AGENT_BASE}/runs/${encodeURIComponent(runId)}`, { headers: { "X-API-Key": apiKey }, signal: p.signal });
      if (r.ok) {
        const j = (await r.json()) as { status?: string; result?: unknown; error?: unknown };
        const s = String(j.status ?? "").toUpperCase();
        if (s === "COMPLETED" || s === "FAILED" || s === "CANCELLED") {
          yield { type: "complete", status: s, result: j.result ?? null, error: j.error ? (typeof j.error === "string" ? j.error : JSON.stringify(j.error).slice(0, 300)) : null, runId };
          return;
        }
      }
    } catch {
      /* fall through */
    }
  }
  yield { type: "complete", status: "FAILED", result: null, error: "the live stream ended before the agent reported a result", runId };
}

export async function cancelRun(runId: string, opts?: { apiKey?: string; fetchImpl?: typeof fetch }): Promise<boolean> {
  try {
    const f = opts?.fetchImpl ?? fetch;
    const res = await f(`${AGENT_BASE}/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: { "X-API-Key": opts?.apiKey ?? requireEnv("TINYFISH_API_KEY"), "Content-Type": "application/json" },
      body: "{}",
    });
    return res.ok;
  } catch {
    return false;
  }
}
