import type { LlmFn } from "./types";

/** Minimal Anthropic Messages API client (tool-free, text out). Returns null on any failure. */
export function makeAnthropicLlm(apiKey: string, fetchImpl: typeof fetch = fetch): LlmFn {
  return async (req) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
    try {
      const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: req.model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: "user", content: req.user }] }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { content?: { type: string; text?: string }[] };
      return json.content?.find((c) => c.type === "text")?.text ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Extract a JSON object from model text. Handles ```json fences and OUTPUT TRUNCATED mid-way
 * (max_tokens): in that case the last fully completed array element is kept and the rest dropped.
 */
export function parseJsonObject(text: string | null): unknown | null {
  if (!text) return null;
  const t = text.replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  if (start < 0) return null;
  const body = t.slice(start);
  const end = body.lastIndexOf("}");
  if (end > 0) {
    try {
      return JSON.parse(body.slice(0, end + 1));
    } catch {
      /* fall through to repair */
    }
  }
  // Repair: walk the text, remember the last position where an element of the top-level array completed.
  let depth = 0, inStr = false, esc = false, lastOk = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 2 && ch === "}") lastOk = i; // a candidate object inside {"candidates":[ ... ]}
    }
  }
  if (lastOk < 0) return null;
  try {
    return JSON.parse(body.slice(0, lastOk + 1) + "]}");
  } catch {
    return null;
  }
}
