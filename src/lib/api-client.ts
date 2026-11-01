import type { AgentRun, BasketLine, BasketPlan, PricePoint, SearchResponse, WatchlistItem } from "./types";
import { getAccessToken } from "./supabase-browser";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
  get notConfigured() {
    return this.status === 503 || this.code === "NOT_CONFIGURED";
  }
}

async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (auth) {
    const token = await getAccessToken();
    if (!token) throw new ApiRequestError(401, "UNAUTHENTICATED", "Sign in to use this feature.");
    headers.set("Authorization", `Bearer ${token}`);
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiRequestError(0, "NETWORK", "Could not reach the server. Check your connection.");
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiRequestError(res.status, e?.code ?? "ERROR", e?.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}

export const api = {
  search: (query: string) => request<SearchResponse>("/api/search", { method: "POST", body: JSON.stringify({ query }) }),
  run: (id: string) => request<AgentRun>(`/api/runs/${encodeURIComponent(id)}`),
  history: (key: string, days: 7 | 30 | 90) =>
    request<{ points: PricePoint[] }>(`/api/history?key=${encodeURIComponent(key)}&days=${days}`),
  watchlist: () => request<WatchlistItem[]>("/api/watchlist", {}, true),
  addWatch: (body: { productQuery: string; title?: string; imageUrl?: string; lastPrice?: number | null }) =>
    request<unknown>("/api/watchlist", { method: "POST", body: JSON.stringify(body) }, true),
  removeWatch: (id: string) => request<unknown>(`/api/watchlist?id=${encodeURIComponent(id)}`, { method: "DELETE" }, true),
  setAlert: (body: { watchlistId: string; targetPrice: number }) =>
    request<unknown>("/api/alerts", { method: "POST", body: JSON.stringify(body) }, true),
  basket: (lines: BasketLine[]) => request<BasketPlan>("/api/basket", { method: "POST", body: JSON.stringify({ lines }) }),
  assistant: (messages: { role: "user" | "assistant"; content: string }[]) =>
    request<{ reply: string; search?: SearchResponse }>("/api/assistant", {
      method: "POST",
      body: JSON.stringify({ messages }),
    }),
  health: () => request<{ tinyfish: boolean; supabase: boolean; claude: boolean }>("/api/health"),
};

/** Remember the most recent search so /product/[key] can render without re-fetching. */
const LAST_KEY = "pricepilot:lastSearch";
export function saveLastSearch(r: SearchResponse) {
  try {
    sessionStorage.setItem(LAST_KEY, JSON.stringify(r));
  } catch {
    /* quota or private mode */
  }
}
export function loadLastSearch(): SearchResponse | null {
  try {
    const s = sessionStorage.getItem(LAST_KEY);
    return s ? (JSON.parse(s) as SearchResponse) : null;
  } catch {
    return null;
  }
}
