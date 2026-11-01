// Fast Commerce (quick-commerce) shared contract. INR rupees. null = unknown (never guessed).

export type ProviderId = "blinkit" | "zepto" | "instamart" | "bigbasket" | "jiomart";

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  homeUrl: string;
  domain: string;
  status: "enabled" | "disabled";
  /** Honest reason: why disabled, or caveats for enabled. */
  reason: string;
  /** True only if proven against the live site. Nothing is proven in this build. */
  provenLive: boolean;
}

export type RunState =
  | "ok"
  | "partial"
  | "blocked"
  | "login_required"
  | "captcha"
  | "not_serviceable"
  | "location_failed"
  | "no_results"
  | "error"
  | "timeout"
  | "cancelled"
  | "disabled";

export interface PackSize {
  kind: "weight" | "volume" | "count";
  /** total in base unit: grams, millilitres, or item count */
  total: number;
  label: string;
}
export interface UnitPrice {
  value: number;
  per: "100g" | "100ml" | "unit";
}

export type Resolution = "found" | "out_of_stock" | "no_match" | "mismatch" | "not_checked";

export interface FastOffer {
  providerId: ProviderId;
  query: string;
  title: string;
  brand: string | null;
  packLabel: string | null;
  pack: PackSize | null;
  price: number | null;
  mrp: number | null;
  discountPct: number | null;
  available: boolean | null;
  deliveryEta: string | null; // verbatim as published
  etaMinutes: number | null; // parsed from deliveryEta only
  productUrl: string | null; // validated provider-domain https URL
  unitPrice: UnitPrice | null; // only when pack parsed
  matchConfidence: number;
  matchNotes: string[];
  evidence: string | null;
}

export interface StoreFees {
  delivery: number | null;
  handling: number | null;
  platform: number | null;
  discount: number | null;
  evidence: string | null;
}

export interface LineResult {
  query: string;
  resolution: Resolution;
  offer: FastOffer | null;
  rejected: FastOffer[];
  note: string;
}

export interface ProviderResult {
  providerId: ProviderId;
  providerName: string;
  state: RunState;
  /** Honest reason, shown as "unavailable: <reason>" when state is not ok/partial. */
  reason: string;
  locationVerified: boolean;
  locationEvidence: string | null;
  runId: string | null;
  lines: LineResult[];
  fees: StoreFees;
  etaText: string | null;
  etaMinutes: number | null;
  checkedAt: string;
  homeUrl: string;
}

export interface BasketLine {
  query: string;
  qty: number;
}

export type TotalKind = "verified" | "estimated" | "unavailable";

export interface StoreBasketLine {
  query: string;
  qty: number;
  resolution: Resolution;
  offer: FastOffer | null;
  lineTotal: number | null;
  note: string;
}

export interface StoreBasket {
  providerId: ProviderId;
  providerName: string;
  state: RunState;
  reason: string;
  lines: StoreBasketLine[];
  missing: string[];
  complete: boolean;
  itemsTotal: number | null; // sum of found lines (null if none found)
  fees: StoreFees;
  unknownComponents: string[]; // e.g. ["delivery fee","handling fee"]
  knownFeesTotal: number;
  total: number | null;
  totalKind: TotalKind;
  totalLabel: string;
  etaText: string | null;
  etaMinutes: number | null;
  homeUrl: string;
}

export interface SplitPlan {
  recommended: boolean;
  assignments: { query: string; providerId: ProviderId; providerName: string; lineTotal: number }[];
  perStore: { providerId: ProviderId; providerName: string; itemsTotal: number; knownFees: number; unknownComponents: string[] }[];
  total: number;
  totalKind: TotalKind;
  savings: number; // vs best single complete basket, after known fees (>0 when recommended)
  reason: string;
}

export interface Comparison {
  winner: {
    providerId: ProviderId;
    providerName: string;
    total: number;
    kind: TotalKind;
    savings: number;
    vsProviderName: string;
    why: string[];
  } | null;
  noWinnerReason: string | null;
  fastest: { providerId: ProviderId; providerName: string; etaText: string; etaMinutes: number } | null;
  fastestNote: string | null;
  split: SplitPlan | null;
  bestOverall: { text: string; reasons: string[] };
  comparabilityIssues: string[];
}

export interface FastBasketResponse {
  pincode: string;
  lines: BasketLine[];
  providers: ProviderResult[];
  baskets: StoreBasket[];
  comparison: Comparison;
  generatedAt: string;
  cached: boolean;
}

export type BattleEventType =
  | "battle_started"
  | "agent_started"
  | "streaming_url"
  | "progress"
  | "heartbeat"
  | "provider_result"
  | "provider_failed"
  | "comparison"
  | "cancelled"
  | "done";

export interface BattleEvent {
  seq: number;
  at: string;
  type: BattleEventType;
  provider?: ProviderId;
  /** progress purpose / failure reason depending on type */
  message?: string;
  runId?: string;
  streamingUrl?: string;
  result?: ProviderResult;
  baskets?: StoreBasket[];
  comparison?: Comparison;
  battleId?: string;
}
