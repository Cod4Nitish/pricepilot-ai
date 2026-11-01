import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "./env";
import type { AgentRun, Offer, PricePoint, SearchResponse, WatchlistItem } from "./types";

let cached: { key: string; client: SupabaseClient } | null = null;

/** Service-role client (server only). Returns null when unconfigured. */
export function getSupabase(): SupabaseClient | null {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const key = SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY;
  if (cached?.key === key) return cached.client;
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cached = { key, client };
  return client;
}

/** Verify a Supabase JWT via auth.getUser. Returns user id or null. */
export async function getUserIdFromToken(token: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

// ---------- persistence (all best-effort; failures are logged, never fatal to search) ----------

function log(where: string, err: unknown) {
  console.error(`[supabase:${where}]`, (err as { message?: string })?.message ?? err);
}

export function queryKey(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function persistSearch(resp: SearchResponse, userId?: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const best = resp.bestVerified ?? resp.offers[0] ?? null;
    const { data: product, error: pe } = await sb
      .from("products")
      .upsert(
        {
          query_key: queryKey(resp.query),
          title: best?.title ?? resp.query,
          brand: resp.parsed.brand ?? null,
          model: resp.parsed.model ?? null,
          spec: resp.parsed,
          image_url: best?.imageUrl ?? null,
        },
        { onConflict: "query_key" },
      )
      .select("id")
      .single();
    if (pe) throw pe;
    const productId = product?.id as string | undefined;

    const all: Offer[] = [...resp.offers, ...resp.excluded];
    if (all.length) {
      const { error: oe } = await sb.from("product_offers").upsert(
        all.map((o) => ({
          offer_key: o.id,
          product_id: productId ?? null,
          retailer_id: o.retailer,
          url: o.url,
          title: o.title,
          image_url: o.imageUrl ?? null,
          last_price: o.price,
          last_mrp: o.mrp,
          availability: o.availability,
          verification: o.verification,
          match_confidence: o.matchConfidence,
          is_match: resp.offers.includes(o),
          last_checked_at: o.checkedAt,
        })),
        { onConflict: "offer_key" },
      );
      if (oe) throw oe;
    }
    // REAL observed prices only: read from the page (verified / agent_verified) and a confident match.
    const obs = resp.offers.filter(
      (o) => o.price !== null && (o.verification === "verified" || o.verification === "agent_verified"),
    );
    if (obs.length) {
      const { error: ie } = await sb.from("price_observations").insert(
        obs.map((o) => ({
          offer_key: o.id,
          retailer_id: o.retailer,
          price: o.price,
          mrp: o.mrp,
          verification: o.verification,
          observed_at: o.checkedAt,
        })),
      );
      if (ie) throw ie;
    }
    const { error: se } = await sb.from("searches").insert({
      run_id: resp.runId,
      user_id: userId ?? null,
      query: resp.query,
      parsed: resp.parsed,
      offer_count: resp.offers.length,
      best_offer_key: resp.bestVerified?.id ?? null,
    });
    if (se) throw se;
  } catch (e) {
    log("persistSearch", e);
  }
}

export async function recordObservations(offers: Offer[]): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const obs = offers.filter((o) => o.price !== null && (o.verification === "verified" || o.verification === "agent_verified"));
  if (!obs.length) return;
  const { error } = await sb.from("price_observations").insert(
    obs.map((o) => ({ offer_key: o.id, retailer_id: o.retailer, price: o.price, mrp: o.mrp, verification: o.verification, observed_at: o.checkedAt })),
  );
  if (error) log("recordObservations", error);
}

export async function getHistory(offerKey: string, days: number): Promise<PricePoint[] | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await sb
    .from("price_observations")
    .select("offer_key, retailer_id, price, observed_at")
    .eq("offer_key", offerKey)
    .gte("observed_at", since)
    .order("observed_at", { ascending: true })
    .limit(2000);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    offerKey: r.offer_key as string,
    retailer: r.retailer_id as PricePoint["retailer"],
    price: Number(r.price),
    observedAt: r.observed_at as string,
  }));
}

// ---------- watchlist / alerts ----------

type WlRow = {
  id: string;
  product_query: string;
  title: string;
  image_url: string | null;
  last_price: number | null;
  target_price: number | null;
  created_at: string;
};
const toItem = (r: WlRow): WatchlistItem => ({
  id: r.id,
  productQuery: r.product_query,
  title: r.title,
  imageUrl: r.image_url ?? undefined,
  lastPrice: r.last_price === null ? null : Number(r.last_price),
  targetPrice: r.target_price === null ? null : Number(r.target_price),
  createdAt: r.created_at,
});

export async function listWatchlist(userId: string): Promise<WatchlistItem[]> {
  const sb = getSupabase()!;
  const { data, error } = await sb.from("watchlists").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data as WlRow[]).map(toItem);
}

export async function addWatchlist(
  userId: string,
  v: { productQuery: string; title: string; imageUrl?: string; lastPrice?: number | null; targetPrice?: number | null },
): Promise<WatchlistItem> {
  const sb = getSupabase()!;
  const { data, error } = await sb
    .from("watchlists")
    .insert({
      user_id: userId,
      product_query: v.productQuery,
      title: v.title,
      image_url: v.imageUrl ?? null,
      last_price: v.lastPrice ?? null,
      target_price: v.targetPrice ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return toItem(data as WlRow);
}

export async function deleteWatchlist(userId: string, id: string): Promise<void> {
  const sb = getSupabase()!;
  const { error } = await sb.from("watchlists").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}

export interface AlertRow {
  id: string;
  watchlistId: string;
  targetPrice: number;
  active: boolean;
  triggeredAt: string | null;
  createdAt: string;
}
const toAlert = (r: Record<string, unknown>): AlertRow => ({
  id: r.id as string,
  watchlistId: r.watchlist_id as string,
  targetPrice: Number(r.target_price),
  active: Boolean(r.active),
  triggeredAt: (r.triggered_at as string | null) ?? null,
  createdAt: r.created_at as string,
});

export async function listAlerts(userId: string): Promise<AlertRow[]> {
  const sb = getSupabase()!;
  const { data, error } = await sb.from("price_alerts").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toAlert);
}

/** Returns null if the watchlist item is not owned by the user. */
export async function addAlert(userId: string, watchlistId: string, targetPrice: number): Promise<AlertRow | null> {
  const sb = getSupabase()!;
  const { data: w } = await sb.from("watchlists").select("id").eq("id", watchlistId).eq("user_id", userId).maybeSingle();
  if (!w) return null;
  const { data, error } = await sb
    .from("price_alerts")
    .insert({ user_id: userId, watchlist_id: watchlistId, target_price: targetPrice, active: true })
    .select("*")
    .single();
  if (error) throw error;
  return toAlert(data);
}

export async function deleteAlert(userId: string, id: string): Promise<void> {
  const sb = getSupabase()!;
  const { error } = await sb.from("price_alerts").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}

// ---------- agent runs ----------

const memRuns = new Map<string, AgentRun>();

export function memSaveRun(run: AgentRun): void {
  memRuns.set(run.id, structuredClone(run));
  if (memRuns.size > 500) {
    const first = memRuns.keys().next().value;
    if (first) memRuns.delete(first);
  }
}

export async function saveRun(run: AgentRun): Promise<void> {
  memSaveRun(run);
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("agent_runs").upsert(
    {
      id: run.id,
      kind: run.kind,
      status: run.status,
      steps: run.steps,
      started_at: run.startedAt,
      finished_at: run.finishedAt ?? null,
      error: run.error ?? null,
    },
    { onConflict: "id" },
  );
  if (error) log("saveRun", error);
}

export async function loadRun(id: string): Promise<AgentRun | null> {
  const mem = memRuns.get(id);
  if (mem) return structuredClone(mem);
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from("agent_runs").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    kind: data.kind,
    status: data.status,
    steps: data.steps ?? [],
    startedAt: data.started_at,
    finishedAt: data.finished_at ?? undefined,
    error: data.error ?? undefined,
  };
}

export async function listAllWatchlists(limit = 100): Promise<(WatchlistItem & { userId: string })[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from("watchlists").select("*").order("created_at", { ascending: true }).limit(limit);
  if (error) throw error;
  return (data as (WlRow & { user_id: string })[]).map((r) => ({ ...toItem(r), userId: r.user_id }));
}

export async function updateWatchlistPrice(id: string, price: number | null): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("watchlists").update({ last_price: price }).eq("id", id);
}

export async function activeAlertsForWatchlist(watchlistId: string): Promise<AlertRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("price_alerts").select("*").eq("watchlist_id", watchlistId).eq("active", true);
  return (data ?? []).map(toAlert);
}

export async function markAlertTriggered(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("price_alerts").update({ active: false, triggered_at: new Date().toISOString() }).eq("id", id);
}
