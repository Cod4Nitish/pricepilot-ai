// Shared engine result types.
import type { UnifiedOffer } from "./schema";

export interface Pick {
  key: string;
  productId: string;
  productName: string;
  retailer: string;
  commerceMode: "ecommerce" | "quick";
  sourceUrl: string;
  /** known total; exact unless totalIsLowerBound */
  total: number | null;
  totalIsLowerBound: boolean;
  etaMinutes: number | null;
  note?: string;
}
export interface Reason {
  code: string;
  text: string;
  evidence: { text: string; source: string }[];
}
export interface Recommendation {
  best: Pick | null;
  cheapest: Pick | null;
  fastest: Pick | null;
  overall: Pick | null;
  reasons: Reason[];
  caveats: string[];
  /** plain-language explanation */
  text: string;
  enoughEvidence: boolean;
}
export type SourceState = "ok" | "partial" | "failed" | "skipped" | "unavailable";
export interface SourceStatus {
  source: string; // e.g. "ecommerce:search", "quick:blinkit"
  state: SourceState;
  message: string;
  offerCount: number;
}
export interface ExcludedOffer {
  offer: UnifiedOffer;
  reason: string;
  decision?: "possible" | "reject";
}
