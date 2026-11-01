// Saved products / saved research reports: pure build + sanitize + identity helpers. No I/O.
//
// Rules (see CLAUDE.md):
// - Everything here is copied from a ShopResponse that was already on screen. Nothing is invented;
//   unknown stays null. Price history only ever contains real observations (from a save or a refresh).
// - Only an explicit allow-list of fields is copied. URLs are validated: retailer offer links must pass
//   validateRetailerUrl (else the link is dropped, the offer is kept); other URLs must be http(s) (else dropped).
// - No API keys, tokens or headers are ever stored (they are not in the data and are not added).
import type { ParsedQuery, ProductGroup, ShopOffer, ShopResponse, SourceStatus, Pick as ShopPick, DeliveryInfo } from "@/lib/shop/types";
import type { UsageSummary } from "@/lib/cost/context";
import { TrueCostSchema, type TrueCost, type TrueCostVerdict } from "@/lib/engine/ecommerce/truecost";
import type { VerificationStatus } from "@/lib/engine/schema";
import { validateRetailerUrl } from "@/lib/ssrf";

export const SNAPSHOT_SCHEMA_VERSION = 1;
/** Local monitor: at most one check per product per this interval. */
export const MONITOR_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Local monitor: at most this many products checked per app session. */
export const MONITOR_MAX_PER_SESSION = 3;
const MAX_HISTORY = 200;

// ---------- types ----------
export interface SavedVariant {
  storageGb: number | null;
  ramGb: number | null;
  color: string | null;
  gpu: string | null;
  condition: "new" | "refurbished" | "unknown";
}

export interface SavedSpec {
  key: string;
  label: string;
  value: string | number;
  unit: string | null;
  sourceUrl: string;
  evidence: string;
}

export interface SavedOffer {
  retailer: string;
  productName: string;
  listedPrice: number | null;
  verificationStatus: VerificationStatus;
  observedAt: string;
  /** null when the original link failed retailer URL validation */
  sourceUrl: string | null;
  stockStatus: "in_stock" | "out_of_stock" | "unknown";
  commerceMode: "ecommerce" | "quick";
  delivery: DeliveryInfo;
  trueCost: TrueCost | null;
}

export interface SavedPick {
  retailer: string;
  value: number | string | null;
  reasons: string[];
  conditions: string[];
  evidence: string[];
}

export interface SavedDecision {
  cheapestListed: SavedPick | null;
  cheapestPayable: SavedPick | null;
  fastest: SavedPick | null;
  bestOverall: SavedPick | null;
  notes: string[];
  singleStoreOnly: boolean;
}

type SavedRanked = { retailer: string; value: number };
export interface SavedVerdict {
  cheapestConfirmed: SavedRanked | null;
  lowestListed: SavedRanked | null;
  lowestKnownMinimum: SavedRanked | null;
  tiedLowestListedCount: number;
  notes: string[];
}

/** One product group as saved (shared by saved products and saved reports). */
export interface SavedGroup {
  key: string;
  name: string;
  brand: string | null;
  model: string | null;
  variant: SavedVariant;
  imageUrl: string | null;
  specs: SavedSpec[];
  why: string[];
  offers: SavedOffer[];
  decision: SavedDecision;
  verdict: SavedVerdict | null;
  lowestVerified: { price: number; retailer: string } | null;
  provisional: boolean;
  evidenceUrls: string[];
}

export interface PriceObservation {
  at: string;
  retailer: string;
  price: number;
  verificationStatus: VerificationStatus;
}

export interface MonitorSettings {
  enabled: boolean;
  targetPrice: number | null;
  dropAlert: boolean;
  lastCheckedAt: string | null;
  lastResult: string | null;
}

export interface SavedProduct extends SavedGroup {
  schemaVersion: number;
  /** = key (dedupe identity) */
  id: string;
  query: string;
  researchGeneratedAt: string;
  savedAt: string;
  updatedAt: string;
  history: PriceObservation[];
  monitor: MonitorSettings;
  /** dev-only: saved from ?mock=1 data. Such records never trigger real network checks. */
  devMock?: boolean;
}

export interface SavedResearchCost {
  productSearches: number;
  cacheHits: number;
  freshCheck: boolean;
  tinyfishSearchRequests: number;
  tinyfishFetchUrls: number;
  paidAgentRuns: number;
  paidAgentSteps: number;
  agentRunsWithoutStepCount: number;
  latencyMs: number;
  computedUsd: number | null;
  basis: string;
  billed: string;
}

export interface SavedReport {
  schemaVersion: number;
  id: string;
  query: string;
  normalizedQuery: string;
  intent: ParsedQuery["searchIntent"];
  category: ParsedQuery["category"];
  budgetMin: number | null;
  budgetMax: number | null;
  preferredFeatures: string[];
  excludedFeatures: string[];
  summary: string;
  emptyReason: string | null;
  recommendationProvisional: boolean;
  groups: SavedGroup[];
  sourcesChecked: { source: string; state: SourceStatus["state"]; message: string }[];
  researchCost: SavedResearchCost | null;
  cached: boolean;
  generatedAt: string;
  savedAt: string;
  /** id of the report this one was refreshed from (new dated version) */
  previousId: string | null;
  /** dev-only: saved from ?mock=1 data */
  devMock?: boolean;
}

// ---------- small sanitizers ----------
/** http(s) only, no credentials; returns the normalised URL or null. */
export function safeHttpUrl(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Retailer offer link: must pass the SSRF retailer allow-list. */
export function safeRetailerUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const r = validateRetailerUrl(input);
  return r.ok ? r.url : null;
}

const str = (v: unknown, max = 600): string => (typeof v === "string" ? v.slice(0, max) : "");
const strOrNull = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strList = (v: unknown, maxItems = 20, max = 600): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, maxItems).map((x) => x.slice(0, max)) : []);
const looksLikeUrl = (s: string) => /^[a-z][a-z0-9+.-]*:/i.test(s.trim());
/** Evidence strings: plain text kept; anything that looks like a URL must be http(s). */
const evidenceList = (v: unknown): string[] => strList(v).flatMap((s) => (looksLikeUrl(s) ? (safeHttpUrl(s) ? [safeHttpUrl(s)!] : []) : [s]));

const VSTATUS = new Set(["verified", "agent_verified", "snippet_only", "unverified"]);
const STOCK = new Set(["in_stock", "out_of_stock", "unknown"]);
const DKIND = new Set(["published_estimate", "not_verified", "unserviceable", "error"]);

export function isVerifiedStatus(s: string): boolean {
  return s === "verified" || s === "agent_verified";
}

// ---------- identity ----------
export function normalizeText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Dedupe/identity key: normalised brand + model + variant (storage, RAM, refurbished, GPU, colour).
 * "new" and "unknown" condition share a key (listings rarely state "new"); "refurbished" is always distinct.
 * Falls back to the normalised name when brand/model are missing.
 */
export function identityKey(g: { name: string; brand: string | null; model: string | null; variant: Partial<SavedVariant> | null | undefined }): string {
  const brand = normalizeText(g.brand);
  let model = normalizeText(g.model);
  if (brand && model.startsWith(brand + " ")) model = model.slice(brand.length + 1);
  const base = brand || model ? [brand, model].filter(Boolean).join(" ") : normalizeText(g.name);
  const v = g.variant ?? {};
  const parts = [base];
  if (typeof v.storageGb === "number") parts.push(`${v.storageGb}gb`);
  if (typeof v.ramGb === "number") parts.push(`ram ${v.ramGb}gb`);
  if (v.condition === "refurbished") parts.push("refurbished");
  if (v.gpu) parts.push(`gpu ${normalizeText(v.gpu)}`);
  if (v.color) parts.push(`colour ${normalizeText(v.color)}`);
  return parts.join(" | ");
}

/** Query used for "Refresh prices": clean name + variant bits that are not already in the name. */
export function refreshQuery(p: { name: string; variant: SavedVariant }): string {
  let q = p.name.replace(/\s+/g, " ").trim();
  const has = (re: RegExp) => re.test(q);
  const { storageGb, ramGb } = p.variant;
  if (typeof ramGb === "number" && !has(new RegExp(`\\b${ramGb}\\s?gb\\s?ram\\b|\\bram\\s?${ramGb}\\s?gb\\b`, "i"))) {
    // only add RAM when storage is also present in the name, so "8GB" alone is not mistaken for storage
    if (typeof storageGb === "number") q += ` ${ramGb}GB RAM`;
  }
  if (typeof storageGb === "number") {
    const label = storageGb >= 1024 && storageGb % 1024 === 0 ? `${storageGb / 1024}TB` : `${storageGb}GB`;
    const re = new RegExp(`\\b${storageGb}\\s?gb\\b|\\b${label.replace(/TB$/, "")}\\s?tb\\b`, "i");
    if (!has(re)) q += ` ${label}`;
  }
  if (p.variant.condition === "refurbished" && !has(/refurbished/i)) q += " refurbished";
  return q;
}

// ---------- builders ----------
function sanitizeVariant(v: ParsedQuery["variant"] | null | undefined): SavedVariant {
  const c = v?.condition;
  return {
    storageGb: num(v?.storageGb),
    ramGb: num(v?.ramGb),
    color: strOrNull(v?.color, 60),
    gpu: strOrNull(v?.gpu, 80),
    condition: c === "new" || c === "refurbished" ? c : "unknown",
  };
}

function sanitizeDelivery(d: DeliveryInfo | null | undefined): DeliveryInfo {
  return {
    pincode: strOrNull(d?.pincode, 6),
    serviceable: typeof d?.serviceable === "boolean" ? d.serviceable : null,
    kind: d && DKIND.has(d.kind) ? d.kind : "not_verified",
    etaText: strOrNull(d?.etaText, 200),
    etaDate: strOrNull(d?.etaDate, 40),
    etaDays: num(d?.etaDays),
    guaranteed: false,
    checkedAt: strOrNull(d?.checkedAt, 40),
    evidence: strOrNull(d?.evidence, 300),
    note: strOrNull(d?.note, 300),
  };
}

export function sanitizeOffer(o: ShopOffer): SavedOffer {
  const tc = o.trueCost ? TrueCostSchema.safeParse(o.trueCost) : null;
  return {
    retailer: str(o.retailer, 80) || "Unknown",
    productName: str(o.productName, 300),
    listedPrice: num(o.listedPrice),
    verificationStatus: VSTATUS.has(o.verificationStatus) ? o.verificationStatus : "unverified",
    observedAt: str(o.observedAt, 40),
    sourceUrl: safeRetailerUrl(o.sourceUrl),
    stockStatus: STOCK.has(o.stockStatus) ? o.stockStatus : "unknown",
    commerceMode: o.commerceMode === "quick" ? "quick" : "ecommerce",
    delivery: sanitizeDelivery(o.delivery),
    trueCost: tc && tc.success ? tc.data : null,
  };
}

function sanitizePick(p: ShopPick | null | undefined): SavedPick | null {
  if (!p) return null;
  const value = typeof p.value === "number" ? num(p.value) : typeof p.value === "string" ? p.value.slice(0, 200) : null;
  return { retailer: str(p.retailer, 80), value, reasons: strList(p.reasons), conditions: strList(p.conditions), evidence: evidenceList(p.evidence) };
}

function sanitizeVerdict(v: TrueCostVerdict | null | undefined): SavedVerdict | null {
  if (!v) return null;
  const r = (x: { retailer: string; value: number } | null) => (x && num(x.value) !== null ? { retailer: str(x.retailer, 80), value: x.value } : null);
  return { cheapestConfirmed: r(v.cheapestConfirmed), lowestListed: r(v.lowestListed), lowestKnownMinimum: r(v.lowestKnownMinimum), tiedLowestListedCount: Array.isArray(v.tiedLowestListed) ? v.tiedLowestListed.length : 0, notes: strList(v.notes) };
}

export function sanitizeGroup(g: ProductGroup): SavedGroup {
  const variant = sanitizeVariant(g.variant);
  const specs: SavedSpec[] = (g.specs ?? []).flatMap((s) => {
    const sourceUrl = safeHttpUrl(s.sourceUrl);
    const value = typeof s.value === "number" ? num(s.value) : typeof s.value === "string" ? s.value.slice(0, 200) : null;
    // a spec without a valid source is not a verified spec: drop it
    if (!sourceUrl || value === null) return [];
    return [{ key: str(s.key, 60), label: str(s.label, 80), value, unit: strOrNull(s.unit, 20), sourceUrl, evidence: str(s.evidence, 300) }];
  });
  const offers = (g.offers ?? []).map(sanitizeOffer);
  const evidenceUrls = Array.from(
    new Set([
      ...specs.map((s) => s.sourceUrl),
      ...offers.map((o) => o.sourceUrl).filter((u): u is string => !!u),
      ...(g.offers ?? []).flatMap((o) => (o.evidence ?? []).map((e) => safeHttpUrl(e.source)).filter((u): u is string => !!u)),
    ]),
  ).slice(0, 40);
  const d = g.decision;
  const lv = g.lowestVerified && num(g.lowestVerified.price) !== null ? { price: g.lowestVerified.price, retailer: str(g.lowestVerified.retailer, 80) } : null;
  const name = str(g.name, 300) || "Unnamed product";
  return {
    key: identityKey({ name, brand: g.brand, model: g.model, variant }),
    name,
    brand: strOrNull(g.brand, 80),
    model: strOrNull(g.model, 120),
    variant,
    imageUrl: safeHttpUrl(g.imageUrl),
    specs,
    why: strList(g.why),
    offers,
    decision: {
      cheapestListed: sanitizePick(d?.cheapestListed),
      cheapestPayable: sanitizePick(d?.cheapestPayable),
      fastest: sanitizePick(d?.fastest),
      bestOverall: sanitizePick(d?.bestOverall),
      notes: strList(d?.notes),
      singleStoreOnly: !!d?.singleStoreOnly,
    },
    verdict: sanitizeVerdict(g.trueCostVerdict),
    lowestVerified: lv,
    provisional: !!g.provisional,
    evidenceUrls,
  };
}

/** Real price observations from a group's offers (listed price present). */
export function observationsFrom(offers: SavedOffer[]): PriceObservation[] {
  return offers
    .filter((o) => o.listedPrice !== null && o.observedAt)
    .map((o) => ({ at: o.observedAt, retailer: o.retailer, price: o.listedPrice as number, verificationStatus: o.verificationStatus }));
}

/** Append observations, de-duplicated by (at, retailer, price), sorted oldest first, capped. */
export function mergeHistory(prev: PriceObservation[], add: PriceObservation[]): PriceObservation[] {
  const seen = new Set<string>();
  const out: PriceObservation[] = [];
  for (const o of [...prev, ...add]) {
    const k = `${o.at}|${o.retailer}|${o.price}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(o);
  }
  out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return out.slice(-MAX_HISTORY);
}

export const DEFAULT_MONITOR: MonitorSettings = { enabled: false, targetPrice: null, dropAlert: false, lastCheckedAt: null, lastResult: null };

/**
 * Build a saved product from a group on screen. If `existing` has the same key, the snapshot is updated
 * (history appended, monitor settings and savedAt kept).
 */
export function buildSavedProduct(
  group: ProductGroup,
  res: Pick<ShopResponse, "parsed" | "generatedAt">,
  now: Date,
  existing?: SavedProduct | null,
  opts: { devMock?: boolean } = {},
): SavedProduct {
  const g = sanitizeGroup(group);
  const same = existing && existing.key === g.key ? existing : null;
  const at = now.toISOString();
  return {
    ...g,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: g.key,
    query: str(res.parsed?.raw ?? "", 300),
    researchGeneratedAt: str(res.generatedAt, 40),
    savedAt: same?.savedAt ?? at,
    updatedAt: at,
    history: mergeHistory(same?.history ?? [], observationsFrom(g.offers)),
    monitor: same?.monitor ?? { ...DEFAULT_MONITOR },
    ...(opts.devMock || same?.devMock ? { devMock: true } : {}),
  };
}

function sanitizeUsage(u: UsageSummary | undefined): SavedResearchCost | null {
  if (!u) return null;
  return {
    productSearches: num(u.productSearches) ?? 0,
    cacheHits: num(u.cacheHits) ?? 0,
    freshCheck: !!u.freshCheck,
    tinyfishSearchRequests: num(u.tinyfishSearchRequests) ?? 0,
    tinyfishFetchUrls: num(u.tinyfishFetchUrls) ?? 0,
    paidAgentRuns: num(u.paidAgentRuns) ?? 0,
    paidAgentSteps: num(u.paidAgentSteps) ?? 0,
    agentRunsWithoutStepCount: num(u.agentRunsWithoutStepCount) ?? 0,
    latencyMs: num(u.latencyMs) ?? 0,
    computedUsd: num(u.cost?.computedUsd),
    basis: str(u.cost?.basis, 400),
    billed: str(u.cost?.billed, 400),
  };
}

export function buildSavedReport(res: ShopResponse, now: Date, id: string, previousId: string | null = null, devMock = false): SavedReport {
  const p = res.parsed;
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id,
    query: str(p?.raw, 300),
    normalizedQuery: str(p?.normalized, 300),
    intent: p?.searchIntent ?? "EXACT_PRODUCT",
    category: p?.category ?? "other",
    budgetMin: num(p?.budgetMin),
    budgetMax: num(p?.budgetMax),
    preferredFeatures: strList(p?.preferredFeatures, 20, 60),
    excludedFeatures: strList(p?.excludedFeatures, 20, 60),
    summary: str(res.summary, 2000),
    emptyReason: strOrNull(res.emptyReason, 600),
    recommendationProvisional: !!res.recommendationProvisional,
    groups: (res.groups ?? []).map(sanitizeGroup),
    sourcesChecked: (res.statuses ?? []).slice(0, 40).map((s) => ({ source: str(s.source, 60), state: s.state, message: str(s.message, 300) })),
    researchCost: sanitizeUsage(res.usage),
    cached: !!res.cached,
    generatedAt: str(res.generatedAt, 40),
    savedAt: now.toISOString(),
    previousId,
    ...(devMock ? { devMock: true } : {}),
  };
}

// ---------- refresh / monitor ----------
/** Lowest verified listed price in a saved group (verified / agent_verified only). */
export function bestVerifiedPrice(offers: SavedOffer[]): { price: number; retailer: string; at: string } | null {
  let best: { price: number; retailer: string; at: string } | null = null;
  for (const o of offers) {
    if (!isVerifiedStatus(o.verificationStatus) || o.listedPrice === null) continue;
    if (!best || o.listedPrice < best.price) best = { price: o.listedPrice, retailer: o.retailer, at: o.observedAt };
  }
  return best;
}

export type RefreshOutcome =
  | { kind: "updated"; product: SavedProduct; added: number }
  | { kind: "different"; message: string };

export const DIFFERENT_PRODUCT_MSG = "Refresh returned a different product; snapshot not changed.";

/** Apply a refreshed ShopResponse to a saved product: only a group with the same identity key may update it. */
export function applyRefresh(saved: SavedProduct, res: ShopResponse, now: Date): RefreshOutcome {
  const match = (res.groups ?? []).find((g) => sanitizeGroup(g).key === saved.key);
  if (!match) return { kind: "different", message: DIFFERENT_PRODUCT_MSG };
  const next = buildSavedProduct(match, res, now, saved);
  // keep the original query the user saved from
  next.query = saved.query || next.query;
  return { kind: "updated", product: next, added: next.history.length - saved.history.length };
}

/** Products due for a local monitor check (enabled, older than the interval), oldest check first, capped. */
export function dueForCheck(products: SavedProduct[], now: number, limit = MONITOR_MAX_PER_SESSION, skipIds: ReadonlySet<string> = new Set()): SavedProduct[] {
  return products
    .filter((p) => p.monitor?.enabled && !skipIds.has(p.id))
    .filter((p) => {
      const t = p.monitor.lastCheckedAt ? new Date(p.monitor.lastCheckedAt).getTime() : NaN;
      return Number.isNaN(t) || now - t >= MONITOR_INTERVAL_MS;
    })
    .sort((a, b) => (a.monitor.lastCheckedAt ?? "").localeCompare(b.monitor.lastCheckedAt ?? ""))
    .slice(0, Math.max(0, limit));
}

/** Whether a check may claim this product now (cross-tab dedupe is done by writing lastCheckedAt first). */
export function canClaimCheck(p: SavedProduct, now: number): boolean {
  if (!p.monitor?.enabled) return false;
  const t = p.monitor.lastCheckedAt ? new Date(p.monitor.lastCheckedAt).getTime() : NaN;
  return Number.isNaN(t) || now - t >= MONITOR_INTERVAL_MS;
}

/** Did a verified observed price reach the target? Never true for unverified prices or a missing target. */
export function targetHit(target: number | null, best: { price: number } | null): boolean {
  return target !== null && target > 0 && best !== null && best.price <= target;
}

// ---------- text export ----------
const inr = (n: number | null) => (n === null ? "Unknown" : `Rs ${Math.round(n).toLocaleString("en-IN")}`);

export function reportSummaryText(r: SavedReport): string {
  const lines: string[] = [];
  lines.push(`PricePilot research: "${r.query}"`);
  lines.push(`Research generated ${r.generatedAt}; saved ${r.savedAt}. Saved snapshot: prices may be outdated.`);
  const budget = r.budgetMax !== null ? `under ${inr(r.budgetMax)}` : r.budgetMin !== null ? `above ${inr(r.budgetMin)}` : null;
  lines.push(`Intent: ${r.intent}; category: ${r.category}${budget ? `; budget ${budget}` : ""}`);
  if (r.summary) lines.push("", r.summary);
  r.groups.forEach((g, i) => {
    lines.push("", `${i + 1}. ${g.name}`);
    lines.push(`   Lowest verified price: ${g.lowestVerified ? `${inr(g.lowestVerified.price)} at ${g.lowestVerified.retailer}` : "Not verified"}`);
    for (const o of g.offers) {
      lines.push(`   - ${o.retailer}: ${inr(o.listedPrice)} (${o.verificationStatus.replace("_", " ")}, observed ${o.observedAt || "unknown"})`);
    }
    for (const w of g.why) lines.push(`   * ${w}`);
  });
  if (r.sourcesChecked.length) {
    lines.push("", "Sources checked: " + r.sourcesChecked.map((s) => `${s.source} (${s.state})`).join(", "));
  }
  return lines.join("\n");
}
