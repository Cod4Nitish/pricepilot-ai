// SHARED CONTRACT between backend (API routes) and frontend. Do not change shapes
// without updating both sides. All prices are INR numbers (rupees, not paise).

export type RetailerId = "amazon" | "flipkart" | "croma" | "reliance" | "vijay";

/** How trustworthy a value is. Never show "verified" for anything not read from the page. */
export type Verification =
  | "verified" // price read from the fetched retailer product page
  | "agent_verified" // price read by a TinyFish Web Agent run on the live page
  | "snippet_only" // only seen in a search snippet, page not confirmed
  | "unverified"; // could not confirm

export interface ProductSpec {
  brand?: string;
  model?: string;
  storageGb?: number;
  ramGb?: number;
  color?: string;
  condition?: "new" | "refurbished" | "unknown";
}

export interface Offer {
  id: string; // stable hash of retailer + canonical url
  retailer: RetailerId;
  retailerName: string;
  title: string;
  url: string; // original retailer product link
  imageUrl?: string;
  price: number | null; // listed price, INR
  mrp: number | null;
  discountPct: number | null; // computed from price/mrp only when both known
  deliveryCharge: number | null; // null = unknown (never guess)
  availability: "in_stock" | "out_of_stock" | "unknown";
  seller?: string;
  offers: string[]; // offer text found on the page, verbatim; conditions unverified
  spec: ProductSpec;
  matchConfidence: number; // 0..1 vs. the user's query
  matchNotes: string[]; // why it matched / why excluded
  verification: Verification;
  checkedAt: string; // ISO
  evidence?: string; // short verbatim page excerpt the price came from
  // Additive, optional: ONLY set when read from the fetched page text / JSON-LD (never inferred)
  warranty?: string;
  returnPolicy?: string;
  gtin?: string;
  sku?: string;
  rating?: { value: number; count: number | null };
  deliveryText?: string; // delivery line shown on the page (verbatim); not pincode-specific
}

export type RetailerStatusState =
  | "ok"
  | "partial"
  | "blocked"
  | "login_required"
  | "no_results"
  | "error"
  | "disabled";

export interface RetailerStatus {
  retailer: RetailerId;
  retailerName: string;
  state: RetailerStatusState;
  message: string; // honest human-readable status
  offerCount: number;
  latencyMs?: number;
}

export interface SearchResponse {
  query: string;
  parsed: ProductSpec & { rawQuery: string; maxPrice?: number };
  offers: Offer[]; // confident matches, sorted by price asc (nulls last)
  excluded: Offer[]; // low-confidence / mismatched; never ranked as cheapest
  statuses: RetailerStatus[];
  bestVerified: Offer | null; // lowest listed price among verified, confident offers
  recommendation: { text: string; enoughEvidence: boolean; caveats: string[] };
  runId: string;
  generatedAt: string;
  cached: boolean;
  /** seconds since generatedAt when served from the response cache */
  cacheAgeSeconds?: number;
  /** what this request cost (TinyFish calls, paid agent runs/steps, cache use) */
  usage?: import("./search").SearchUsage;
}

export interface PricePoint {
  offerKey: string;
  retailer: RetailerId;
  price: number;
  observedAt: string;
}

export interface WatchlistItem {
  id: string;
  productQuery: string;
  title: string;
  imageUrl?: string;
  lastPrice: number | null;
  targetPrice: number | null;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  kind: "search" | "refresh" | "assistant" | "verify";
  status: "pending" | "running" | "completed" | "failed";
  steps: { at: string; label: string; status: "ok" | "warn" | "error" }[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface BasketLine {
  query: string;
  qty: number;
}
export interface BasketPlan {
  stores: {
    retailer: RetailerId;
    retailerName: string;
    lines: { query: string; offer: Offer; qty: number }[];
    subtotal: number;
    delivery: number | null;
    total: number | null; // null if delivery unknown
    freeShippingNote?: string;
  }[];
  unresolved: string[]; // queries with no verified offer
  totalVerified: number | null;
  caveats: string[];
}

export interface ApiError {
  error: { code: string; message: string };
}
export const NOT_CONFIGURED = "NOT_CONFIGURED";

/**
 * API surface (all JSON):
 *  POST /api/search        {query:string}                -> SearchResponse | ApiError
 *  GET  /api/runs/:id                                    -> AgentRun
 *  GET  /api/history?key=<offerKey>&days=7|30|90         -> {points: PricePoint[]}
 *  GET/POST/DELETE /api/watchlist   (Bearer supabase token) -> WatchlistItem[]
 *  GET/POST/DELETE /api/alerts      (Bearer supabase token) -> {alerts: {...}[]}
 *  POST /api/basket        {lines: BasketLine[]}         -> BasketPlan | ApiError
 *  POST /api/assistant     {messages:{role,content}[]}   -> {reply:string, search?:SearchResponse}
 *  GET  /api/health                                      -> {tinyfish:boolean, supabase:boolean, claude:boolean}
 * Missing server config returns 503 with {error:{code:"NOT_CONFIGURED",message}} (never sample data).
 */
