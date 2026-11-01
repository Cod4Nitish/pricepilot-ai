import type { IntentResult, Mode } from "@/lib/intent";
import type { FastBasketResponse } from "@/lib/fast/types";
import { ApiRequestError } from "@/lib/api-client";

export type SearchMode = "auto" | Mode;
export const MODE_LABEL: Record<Mode, string> = { ecommerce: "E-Commerce", quick: "Quick Commerce", both: "Both" };

async function post<T>(path: string, body: unknown, timeoutMs = 90_000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
  } catch {
    throw new ApiRequestError(0, "NETWORK", "Could not reach the server or it took too long.");
  } finally {
    clearTimeout(timer);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiRequestError(res.status, e?.code ?? "ERROR", e?.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}

const intentKey = (q: string) => `pricepilot:intent:${q.trim().toLowerCase()}`;

export function readCachedIntent(q: string): IntentResult | null {
  try {
    const raw = sessionStorage.getItem(intentKey(q));
    return raw ? (JSON.parse(raw) as IntentResult) : null;
  } catch {
    return null;
  }
}

export async function fetchIntent(text: string): Promise<IntentResult> {
  const cached = readCachedIntent(text);
  if (cached) return cached;
  const r = await post<IntentResult>("/api/intent", { text }, 8_000);
  try {
    sessionStorage.setItem(intentKey(text), JSON.stringify(r));
  } catch {
    /* ignore */
  }
  return r;
}

export const fastSearch = (pincode: string, query: string) => post<FastBasketResponse>("/api/fast/search", { pincode, query });
