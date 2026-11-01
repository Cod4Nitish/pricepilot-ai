// Client helpers for the /shop UI: fetch wrappers + pure formatting/sorting helpers.
// Rule: unknown (null) is never rendered as 0 and never guessed.
import type { DeliveryInfo, ProductGroup, ShopOffer, ShopResponse, ShopWeights } from "@/lib/shop/types";

export class ShopApiError extends Error {
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

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ShopApiError(0, "NETWORK", "Could not reach the server. Check your connection.");
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ShopApiError(res.status, e?.code ?? "ERROR", e?.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}

export type ShopSort = "relevance" | "price" | "delivery";

export function fetchShop(
  args: { query: string; pincode?: string | null; weights?: Partial<ShopWeights>; sort?: ShopSort },
  signal?: AbortSignal,
): Promise<ShopResponse> {
  const body: Record<string, unknown> = { query: args.query };
  if (args.pincode) body.pincode = args.pincode;
  if (args.weights) body.weights = args.weights;
  if (args.sort) body.sort = args.sort;
  return post<ShopResponse>("/api/shop", body, signal);
}

export function fetchDelivery(pincode: string, offers: ShopOffer[]): Promise<{ results: { offerId: string; delivery: DeliveryInfo }[] }> {
  return post("/api/shop/delivery", {
    pincode,
    offers: offers.slice(0, 6).map((o) => ({ offerId: offerKey(o), url: o.sourceUrl, retailer: o.retailer })),
  });
}

/** Stable per-offer id. The contract has no offerId on ShopOffer; Pick.offerId must match what the backend derives. */
export function offerKey(o: ShopOffer): string {
  return o.sourceUrl;
}

// ---------- formatting ----------
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export function rupees(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? "Not found" : `Rs ${inr.format(Math.round(n))}`;
}

export function shippingLabel(fee: number | null): string {
  if (fee === null) return "Unknown";
  return fee === 0 ? "Free" : rupees(fee);
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "unknown";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function discountLabel(o: { mrp: number | null; discountPct: number | null; listedPrice: number | null }): string | null {
  if (o.discountPct !== null && o.discountPct > 0) return `${Math.round(o.discountPct)}% off`;
  return null;
}

const CATEGORY_LABEL: Record<string, string> = { smartphone: "Smartphone", laptop: "Laptop", headphones: "Headphones", tv: "TV", tablet: "Tablet", smartwatch: "Smartwatch", camera: "Camera", appliance: "Appliance", other: "Other" };
export function categoryLabel(c: string): string {
  return CATEGORY_LABEL[c] ?? c;
}
const INTENT_LABEL: Record<string, string> = {
  EXACT_PRODUCT: "Exact product",
  PRODUCT_RECOMMENDATION: "Product recommendation",
  FEATURE_SEARCH: "Feature search",
  PRODUCT_COMPARISON: "Product comparison",
  PRODUCT_URL: "Product link",
};
export function intentLabel(i: string): string {
  return INTENT_LABEL[i] ?? i;
}

export function budgetLabel(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return `Budget ${rupees(min)} to ${rupees(max)}`;
  if (max !== null) return `Budget under ${rupees(max)}`;
  if (min !== null) return `Budget above ${rupees(min)}`;
  return null;
}

export function scoreLabel(name: string): string {
  return name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** "Not found" for null, else percentage 0..100. Never 0 for missing. */
export function componentPct(score: number | null): number | null {
  if (score === null || Number.isNaN(score)) return null;
  return Math.round(Math.min(1, Math.max(0, score)) * 100);
}

// ---------- weights ----------
export function normalizeWeights(w: ShopWeights): ShopWeights {
  const p = Math.max(0, w.price), d = Math.max(0, w.delivery), e = Math.max(0, w.evidence);
  const sum = p + d + e;
  if (sum <= 0) return { price: 1 / 3, delivery: 1 / 3, evidence: 1 / 3 };
  return { price: p / sum, delivery: d / sum, evidence: e / sum };
}

// ---------- delivery ----------
export function deliveryHeadline(d: DeliveryInfo, pin: string | null): { text: string; tone: "good" | "warn" | "bad" | "neutral"; sub: string | null } {
  switch (d.kind) {
    case "published_estimate":
      return { text: d.etaText ?? "Delivery estimate published", tone: "good", sub: "Estimate, not guaranteed" };
    case "unserviceable":
      return { text: `Not deliverable to ${d.pincode ?? pin ?? "this pincode"}`, tone: "bad", sub: d.note };
    case "error":
      return { text: "Delivery check failed", tone: "warn", sub: d.note ?? "The check could not be completed." };
    default:
      return { text: "Not verified", tone: "neutral", sub: d.note };
  }
}

export function mergeDelivery(offers: ShopOffer[], map: Record<string, DeliveryInfo>): ShopOffer[] {
  return offers.map((o) => (map[offerKey(o)] ? { ...o, delivery: map[offerKey(o)] } : o));
}

// ---------- sorting (verified values only; unknown last) ----------
export function isVerifiedOffer(o: ShopOffer): boolean {
  return o.verificationStatus === "verified" || o.verificationStatus === "agent_verified";
}

function cmpNullLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

export function offerEtaDays(o: ShopOffer): number | null {
  return o.delivery.kind === "published_estimate" ? o.delivery.etaDays : null;
}

export function sortOffers(offers: ShopOffer[], sort: ShopSort): ShopOffer[] {
  if (sort === "relevance") return offers.slice();
  const key = sort === "price" ? (o: ShopOffer) => (isVerifiedOffer(o) ? o.listedPrice : null) : offerEtaDays;
  return offers.map((o, i) => ({ o, i })).sort((a, b) => cmpNullLast(key(a.o), key(b.o)) || a.i - b.i).map((x) => x.o);
}

export function groupMinEta(g: ProductGroup): number | null {
  const v = g.offers.map(offerEtaDays).filter((n): n is number => n !== null);
  return v.length ? Math.min(...v) : null;
}

export function sortGroups(groups: ProductGroup[], sort: ShopSort): ProductGroup[] {
  const idx = groups.map((g, i) => ({ g, i }));
  if (sort === "relevance") return idx.sort((a, b) => a.g.rank - b.g.rank || a.i - b.i).map((x) => x.g);
  const key = sort === "price" ? (g: ProductGroup) => g.lowestVerified?.price ?? null : groupMinEta;
  return idx.sort((a, b) => cmpNullLast(key(a.g), key(b.g)) || a.g.rank - b.g.rank).map((x) => x.g);
}

export function badSources(r: ShopResponse): { source: string; message: string; state: string }[] {
  return r.statuses
    .filter((s) => ["blocked", "error", "timeout", "login_required", "partial"].includes(s.state))
    .map((s) => ({ source: s.source, message: s.message, state: s.state }));
}

export function sourceName(source: string): string {
  const s = source.replace(/^delivery:/, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
