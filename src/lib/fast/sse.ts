// Pure SSE parsing + TinyFish event normalisation (no node-only imports; also used in the browser).

export interface RawSse {
  event: string | null;
  data: string;
  id: string | null;
}

/** Incrementally parse an SSE byte stream into events. Handles CRLF, multi-line data and comments. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<RawSse> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += dec.decode(value, { stream: !done });
      if (done) buf += dec.decode();
      buf = buf.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = parseBlock(block);
        if (ev) yield ev;
      }
      if (done) {
        const ev = buf.trim() ? parseBlock(buf) : null;
        if (ev) yield ev;
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): RawSse | null {
  let event: string | null = null;
  let id: string | null = null;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const c = line.indexOf(":");
    const field = c === -1 ? line : line.slice(0, c);
    const val = c === -1 ? "" : line.slice(c + 1).replace(/^ /, "");
    if (field === "event") event = val;
    else if (field === "data") data.push(val);
    else if (field === "id") id = val;
  }
  if (!data.length && !event) return null;
  return { event, data: data.join("\n"), id };
}

export type AgentEvent =
  | { type: "started"; runId: string | null }
  | { type: "streaming_url"; url: string }
  | { type: "progress"; purpose: string }
  | { type: "heartbeat" }
  | { type: "complete"; status: "COMPLETED" | "FAILED" | "CANCELLED"; result: unknown; error: string | null; runId: string | null };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/**
 * Map one raw TinyFish SSE message to a normalised event. Field names are read defensively
 * (type may be in the SSE `event:` field or in the JSON; run id as run_id/runId). Unknown events return null
 * and are never turned into synthetic ones.
 */
export function toAgentEvent(raw: RawSse): AgentEvent | null {
  let d: Record<string, unknown> = {};
  if (raw.data) {
    try {
      const j = JSON.parse(raw.data);
      if (j && typeof j === "object") d = j as Record<string, unknown>;
    } catch {
      /* non-JSON payload: only the event name is usable */
    }
  }
  const type = (str(d.type) ?? raw.event ?? "").toUpperCase();
  const runId = str(d.run_id) ?? str(d.runId);
  switch (type) {
    case "STARTED":
      return { type: "started", runId };
    case "STREAMING_URL": {
      const url = str(d.streaming_url) ?? str(d.streamingUrl) ?? str(d.url);
      return url ? { type: "streaming_url", url } : null;
    }
    case "PROGRESS": {
      const purpose = str(d.purpose) ?? str(d.message);
      return purpose ? { type: "progress", purpose } : null;
    }
    case "HEARTBEAT":
      return { type: "heartbeat" };
    case "COMPLETE": {
      const s = String(d.status ?? "COMPLETED").toUpperCase();
      const status = s === "FAILED" ? "FAILED" : s === "CANCELLED" ? "CANCELLED" : "COMPLETED";
      const err = d.error;
      return {
        type: "complete",
        status,
        result: d.result ?? d.resultJson ?? d.result_json ?? null,
        error: err ? (typeof err === "string" ? err : JSON.stringify(err).slice(0, 300)) : null,
        runId,
      };
    }
    default:
      return null;
  }
}

/** Only https streaming previews are ever embedded. */
export function safePreviewUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}
