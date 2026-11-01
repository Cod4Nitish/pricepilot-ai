import type { ClientOptions, FetchOutput, SearchOutput } from "@/lib/tinyfish";
import type { Decision, ParsedQuery, ShopOffer, ShopWeights, SourceStatus, SpecFact } from "../types";

export interface OffersResult {
  offers: ShopOffer[];
  excluded: { title: string; retailer: string; reason: string }[];
  statuses: SourceStatus[];
}
export type BuildOffersFn = (productQuery: string, ctx: { pincode: string | null; cards?: string[]; parsed?: Partial<ParsedQuery> }) => Promise<OffersResult>;
export type BuildDecisionFn = (offers: ShopOffer[], weights: ShopWeights) => Decision;

export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}
export type LlmFn = (req: LlmRequest) => Promise<string | null>;

export interface StepSink {
  id: string;
  step(label: string, status?: "ok" | "warn" | "error"): void;
  finish(error?: string): Promise<void>;
}

/** Injectable dependencies (all optional; real implementations are used lazily when absent). */
export interface ShopDeps {
  buildOffers?: BuildOffersFn;
  /** generic-category fallback: the e-commerce search pipeline (defaults to lib/search searchProducts) */
  searchProducts?: (query: string) => Promise<import("@/lib/types").SearchResponse>;
  buildDecision?: BuildDecisionFn;
  search?: (p: { query: string; location?: string; includeDomains?: string[]; excludeDomains?: string[]; page?: number }, opts?: ClientOptions) => Promise<SearchOutput>;
  fetchPages?: (p: { urls: string[]; ttl?: number; perUrlTimeoutMs?: number }, opts?: ClientOptions) => Promise<FetchOutput>;
  /** Claude call. When absent and anthropicKey is set, a fetch-based implementation is used. */
  llm?: LlmFn;
  /** null forces "no key". undefined => read ANTHROPIC_API_KEY from env. */
  anthropicKey?: string | null;
  fetchImpl?: typeof fetch;
  tracker?: StepSink;
  runId?: string;
  now?: () => Date;
  noCache?: boolean;
}

export interface PriceHint {
  price: number;
  sourceUrl: string;
  evidence: string;
}

export interface Candidate {
  id: string;
  name: string;
  brand: string | null;
  specs: SpecFact[];
  price: PriceHint | null;
  sourceUrls: string[];
}

export interface FetchedText {
  url: string;
  title: string;
  text: string;
}

export type Log = (label: string, status?: "ok" | "warn" | "error") => void;
