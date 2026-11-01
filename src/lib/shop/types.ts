// SHARED CONTRACT for the universal E-Commerce search engine ("shop").
// Backend (parser, discovery, pipeline, delivery) and frontend (/shop UI) both depend on this file.
// Do not change existing shapes without telling the other side; additive optional fields are fine.
// Rules: unknown = null (never invented defaults). Prices are INR numbers.

import type { UnifiedOffer } from "@/lib/engine/schema";

export type SearchIntent =
  | "EXACT_PRODUCT" //          "Samsung Galaxy S24 256GB"
  | "PRODUCT_RECOMMENDATION" // "Best phone under 50000", "good laptop for coding under 80k"
  | "FEATURE_SEARCH" //         "Gaming laptop RTX 4050 16GB RAM below 70000"
  | "PRODUCT_COMPARISON" //     "Samsung S24 vs OnePlus 13"
  | "PRODUCT_URL"; //           pasted retailer link

export type Category = "smartphone" | "laptop" | "headphones" | "tv" | "tablet" | "smartwatch" | "camera" | "appliance" | "other";

export interface ParsedQuery {
  raw: string;
  normalized: string; // typo-corrected, abbreviations expanded (e.g. 80k -> 80000), Hinglish mapped
  searchIntent: SearchIntent;
  category: Category;
  brand: string | null;
  model: string | null;
  variant: { storageGb: number | null; ramGb: number | null; color: string | null; gpu: string | null; screenInch: number | null; condition: "new" | "refurbished" | "unknown" };
  budgetMin: number | null;
  budgetMax: number | null;
  preferredFeatures: string[]; // e.g. "camera", "gaming", "coding", "battery", "amoled"
  excludedFeatures: string[];
  deliveryPincode: string | null;
  sortPreference: "relevance" | "price" | "delivery" | "rating" | null;
  comparisonTargets: string[]; // for PRODUCT_COMPARISON: each side's product query
  url: string | null; // for PRODUCT_URL (validated by ssrf.ts)
  language: "en" | "hi" | "hinglish";
  corrections: { from: string; to: string }[];
  source: "deterministic" | "llm";
  confidence: number; // 0..1
}

/** A single spec fact with its evidence. Missing specs stay missing: never guessed. */
export interface SpecFact {
  key: string; // 'chipset' | 'ram_gb' | 'storage_gb' | 'battery_mah' | 'display' | 'camera_main_mp' | 'gpu' | 'cpu' | ...
  label: string;
  value: string | number;
  unit?: string;
  sourceUrl: string;
  evidence: string; // short verbatim excerpt
}

export interface ScoreComponent {
  name: string; // 'performance' | 'camera' | 'battery' | 'display' | 'software' | 'cpu' | 'gpu' | 'ram' | 'storage' | 'portability' | 'upgradeability' | 'price'
  score: number | null; // 0..1, null when evidence is missing (not zero)
  weight: number;
  basis: string; // how it was derived from evidence
}

export interface ProductScore {
  total: number | null; // 0..100 over components that have evidence
  components: ScoreComponent[];
  provisional: boolean; // true when key evidence is missing
  missing: string[]; // which specs were not found
}

export interface DeliveryInfo {
  pincode: string | null;
  serviceable: boolean | null; // null = not checked / unknown
  kind: "published_estimate" | "not_verified" | "unserviceable" | "error";
  etaText: string | null; // verbatim published text, e.g. 'Delivery by Tue, 4 Nov'
  etaDate: string | null; // ISO date parsed from etaText when unambiguous
  etaDays: number | null; // whole days from checkedAt when etaDate known
  guaranteed: false; // estimates are NEVER guaranteed
  checkedAt: string | null;
  evidence: string | null;
  note: string | null; // honest explanation, e.g. 'Retailer blocked automated pincode check'
}

export interface ConditionalOffer {
  text: string; // verbatim
  amount: number | null;
  condition: string; // e.g. 'HDFC credit card'
  applied: boolean; // true only if user selected a matching card/coupon
}

export interface ShopOffer extends UnifiedOffer {
  imageUrl: string | null;
  mrp: number | null;
  discountPct: number | null;
  seller: string | null;
  warranty: string | null;
  returnPolicy: string | null;
  conditionalOffers: ConditionalOffer[];
  effectiveTotal: number | null; // only when listed price and all relevant fees known
  totalIsLowerBound: boolean;
  delivery: DeliveryInfo;
  /** false => identity matched but some spec (GPU/CPU/RAM/storage) could not be confirmed from the listing title; listed, never "cheapest/best" */
  specConfirmed?: boolean;
  specNotes?: string[];
}

export interface Pick {
  offerId: string;
  retailer: string;
  value: number | string | null; // price for cheapest, ETA text for fastest, score for best
  reasons: string[];
  conditions: string[]; // conditional bank/coupon requirements, uncertainty
  evidence: string[]; // source excerpts / URLs
}

export interface Decision {
  cheapestListed: Pick | null; // lowest listed price among verified matches (separate from payable total)
  cheapestPayable: Pick | null; // lowest verified effective total (only when fees known)
  fastest: Pick | null; // earliest published delivery estimate
  bestOverall: Pick | null; // transparent weighted balance
  notes: string[]; // why a category is null, what differs between stores, uncertainty
  singleStoreOnly: boolean; // true => multi-store comparison not possible yet
}

export interface ProductGroup {
  id: string; // stable id of the resolved product identity
  name: string;
  brand: string | null;
  model: string | null;
  variant: ParsedQuery["variant"];
  imageUrl: string | null;
  specs: SpecFact[];
  score: ProductScore | null; // for recommendation groups
  why: string[]; // reasons for recommending (evidence-backed)
  offers: ShopOffer[]; // verified same-product offers only
  decision: Decision;
  lowestVerified: { price: number; retailer: string } | null;
  comparable: boolean; // >= 2 verified retailers
  provisional: boolean;
  rank: number; // 1-based among groups
}

export interface SourceStatus {
  source: string; // 'amazon' | 'flipkart' | ... | 'discovery' | 'delivery:amazon'
  state: "ok" | "partial" | "blocked" | "login_required" | "no_results" | "error" | "timeout" | "skipped" | "disabled";
  message: string;
  latencyMs?: number;
}

export interface ShopWeights {
  price: number;
  delivery: number;
  evidence: number; // availability / warranty / return / evidence quality
}

export interface ShopResponse {
  parsed: ParsedQuery;
  groups: ProductGroup[]; // recommendations (<=5) or the exact product group(s)
  comparison?: { sides: string[]; table: { key: string; label: string; values: (string | number | null)[] }[] }; // PRODUCT_COMPARISON
  statuses: SourceStatus[];
  recommendationProvisional: boolean;
  summary: string; // plain-language explanation of the outcome incl. caveats
  emptyReason: string | null; // zero relevant results, invalid pincode, etc.
  weights: ShopWeights;
  runId: string;
  generatedAt: string;
  cached: boolean;
  /** measured TinyFish usage + calculated agent cost for this request */
  usage?: import("@/lib/cost/context").UsageSummary;
}

/**
 * Endpoints:
 *  POST /api/shop {query, pincode?, weights?: Partial<ShopWeights>, sort?: 'price'|'delivery'|'relevance', cards?: string[]} -> ShopResponse | ApiError
 *       (fast path: discovery + offers; delivery for each offer defaults to kind 'not_verified')
 *  POST /api/shop/delivery {pincode, offers: {offerId, url, retailer}[]} (max 6) -> {results: {offerId, delivery: DeliveryInfo}[]}
 *       (TinyFish Agent per retailer, on demand, bounded concurrency; honest 'not_verified' on block/timeout)
 *  GET  /api/shop/run/:id -> AgentRun-like progress {steps[], status}  (real step log of the run, no synthetic steps)
 * Errors: {error:{code,message}}; 503 NOT_CONFIGURED when keys are missing; never sample data.
 */
