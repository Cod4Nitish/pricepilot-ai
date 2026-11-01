// Discovery for PRODUCT_RECOMMENDATION / FEATURE_SEARCH:
// search -> fetch -> evidence-verified candidates -> hard constraints -> score/rank -> verified offers -> groups.
import { getCategoryConfig, scoreCoverage, unsupportedCategoryMessage, type CategoryConfig } from "../categories";
import type { ParsedQuery, ProductGroup, ShopWeights, SourceStatus, SpecFact } from "../types";
import { resolveBuildDecision, resolveBuildOffers, resolveLlm } from "./deps";
import { extractDeterministic, extractForTarget, extractWithLlm, type ExtractResult } from "./extract";
import { finalizeDecision, gamingMismatch, guardMedian, guardOffers, lookupQuery, lowestVerified, makeGroup, mergeStatuses, pickVariantBucket, whyFromScore } from "./group";
import { discoverPages, discoverSpecPages, pool } from "./pages";
import type { Candidate, Log, ShopDeps } from "./types";
import { meetsRequirements, requirementsEmptyMessage } from "../requirements";

export * from "./types";
export { verifyFacts, evidenceInPage, normText } from "./evidence";

const MAX_GROUPS = 5;
const OFFER_CONCURRENCY = 2; // each lookup fans out to 5 retailer searches: keep bursts small to avoid TinyFish 429s

export interface DiscoveryResult {
  groups: ProductGroup[];
  statuses: SourceStatus[];
  notes: string[];
  emptyReason: string | null;
  candidateCount: number;
}

const CAT_LABEL: Record<string, string> = { smartphone: "smartphone", laptop: "laptop" };

function scoreAll(cands: Candidate[], cfg: CategoryConfig, weights: Record<string, number>, prices: Map<string, number | null>, priceRef: number | null) {
  return cands.map((c) => ({ c, score: cfg.score(c.specs, { price: prices.get(c.id) ?? null, priceRef, weights }) }));
}

/** Scored candidates first (by total), then unscored by evidence coverage, then lowest price. */
function rankDesc<T extends { score: { total: number | null; components: { score: number | null; weight: number }[] }; c: Candidate; price?: number | null }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => {
    const at = a.score.total !== null, bt = b.score.total !== null;
    if (at !== bt) return at ? -1 : 1;
    if (at && bt && b.score.total !== a.score.total) return (b.score.total as number) - (a.score.total as number);
    const dc = scoreCoverage(b.score) - scoreCoverage(a.score);
    if (Math.abs(dc) > 1e-9) return dc;
    return (a.price ?? a.c.price?.price ?? Infinity) - (b.price ?? b.c.price?.price ?? Infinity) || b.c.specs.length - a.c.specs.length;
  });
}

export async function runDiscovery(parsed: ParsedQuery, ctx: { weights: ShopWeights; pincode: string | null; cards?: string[]; deps: ShopDeps; log: Log; year: number }): Promise<DiscoveryResult> {
  const { deps, log } = ctx;
  const statuses: SourceStatus[] = [];
  const notes: string[] = [];
  const cfg = getCategoryConfig(parsed.category);
  if (!cfg) {
    return {
      groups: [], statuses: [{ source: "discovery", state: "skipped", message: `Recommendations are not supported for category "${parsed.category}" yet.` }], notes,
      emptyReason: unsupportedCategoryMessage(parsed.category), candidateCount: 0,
    };
  }

  const pg = await discoverPages(parsed, deps, log, ctx.year);
  statuses.push(...pg.statuses);
  if (pg.pages.length === 0) {
    return { groups: [], statuses, notes, emptyReason: "Could not find or read any review/spec pages for this search, so no recommendation was made.", candidateCount: 0 };
  }

  // candidates
  const llm = resolveLlm(deps);
  let ex: ExtractResult;
  const t0 = Date.now();
  if (llm) {
    const r = await extractWithLlm(pg.pages, cfg, llm, { categoryLabel: CAT_LABEL[parsed.category] ?? parsed.category });
    if (r.ok) {
      ex = r;
      statuses.push({ source: "discovery:llm", state: "ok", message: `${r.candidates.length} candidates; ${r.keptFacts} spec facts verified against page text, ${r.droppedFacts} unverifiable facts dropped, ${r.droppedCandidates} candidates not found in any page dropped`, latencyMs: Date.now() - t0 });
    } else {
      ex = extractDeterministic(pg.pages, cfg);
      statuses.push({ source: "discovery:llm", state: "error", message: "AI extraction failed or returned invalid JSON; used the deterministic extractor instead.", latencyMs: Date.now() - t0 });
    }
  } else {
    ex = extractDeterministic(pg.pages, cfg);
    statuses.push({ source: "discovery:llm", state: "skipped", message: "ANTHROPIC_API_KEY not set: used deterministic extraction (regex over spec tables and headings); expect fewer candidates and specs." });
  }
  log(`Candidates extracted: ${ex.candidates.length} (${ex.keptFacts} verified facts, ${ex.droppedFacts} dropped)`, ex.candidates.length ? "ok" : "warn");
  if (ex.candidates.length === 0) return { groups: [], statuses, notes, emptyReason: "No candidate products with verifiable specifications were found in the pages read.", candidateCount: 0 };

  // hard constraints first
  const constraints = cfg.constraints(parsed);
  const passing: Candidate[] = [];
  const excludedMsgs: string[] = [];
  for (const c of ex.candidates) {
    const fails = constraints.filter((k) => k.check({ specs: c.specs, price: c.price?.price ?? null }, false) === "fail");
    if (fails.length) excludedMsgs.push(`${c.name}: ${fails.map((f) => f.describe).join(", ")} not met`);
    else {
      // stage 1 (candidates): explicitly requested brand / product type are hard requirements
      const req = meetsRequirements(c.name, parsed);
      if (req.ok) passing.push(c);
      else excludedMsgs.push(`${c.name}: ${req.reason}`);
    }
  }
  const gaming = parsed.category === "laptop" && parsed.preferredFeatures.includes("gaming");
  if (gaming) {
    for (const c of [...passing]) {
      const why = gamingMismatch(c);
      if (why) { excludedMsgs.push(`${c.name}: ${why}`); passing.splice(passing.indexOf(c), 1); }
    }
  }
  if (excludedMsgs.length) notes.push(`Excluded: ${excludedMsgs.slice(0, 6).join("; ")}${excludedMsgs.length > 6 ? `; +${excludedMsgs.length - 6} more` : ""}.`);
  log(`Hard constraints: ${passing.length} of ${ex.candidates.length} candidates remain`, passing.length ? "ok" : "warn");

  const weights = cfg.weightsFor(parsed);
  const pre = rankDesc(scoreAll(passing, cfg, weights, new Map(), null).filter((x) => scoreCoverage(x.score) > 0));
  if (pre.length === 0) return { groups: [], statuses, notes, emptyReason: requirementsEmptyMessage(parsed) ?? "No candidate met your requirements with enough evidence to rank.", candidateCount: ex.candidates.length };
  // Budget-aware shortlist ORDER (no data changes): with a budget, candidates whose editorial price is within it are
  // price-checked first, unknown-price ones next, flagship-tier names (Ultra / Pro Max / Fold / Flip) last. This spends the
  // limited Search/Fetch/Agent lookups on phones that can actually fit the budget.
  const budgetTier = (c: Candidate): number => {
    if (parsed.budgetMax === null) return 0;
    const ed = c.price?.price ?? null;
    if (ed !== null) return ed <= parsed.budgetMax ? 0 : 3;
    return /\b(ultra|pro\s*max|fold\d*|flip\d*)\b/i.test(c.name) ? 2 : 1;
  };
  const ordered = pre.map((x, i) => ({ x, i, t: budgetTier(x.c) })).sort((a, b) => a.t - b.t || a.i - b.i).map((y) => y.x);
  const top = ordered.slice(0, MAX_GROUPS);

  // verified offers
  const buildOffers = await resolveBuildOffers(deps);
  const buildDecision = await resolveBuildDecision(deps);
  if (!buildOffers) {
    statuses.push({ source: "retailers", state: "error", message: "Retailer offer lookup is unavailable." });
    return { groups: [], statuses, notes, emptyReason: "Retailer price lookup is unavailable, so no verified prices could be shown.", candidateCount: ex.candidates.length };
  }
  log(`Looking up verified offers for ${top.length} candidates`);
  const results = await pool(top, OFFER_CONCURRENCY, async ({ c }) => {
    const gpuFact = c.specs.find((f) => f.key === "gpu");
    const lk = lookupQuery(c.name, gpuFact ? String(gpuFact.value) : null);
    const q = [lk.query, parsed.variant.storageGb ? `${parsed.variant.storageGb}GB` : "", parsed.variant.ramGb && parsed.category === "smartphone" ? `${parsed.variant.ramGb}GB RAM` : ""].filter(Boolean).join(" ");
    try {
      const r = await buildOffers(q, { pincode: ctx.pincode, cards: ctx.cards, parsed: { category: parsed.category, variant: parsed.variant, brand: c.brand } });
      log(`Offers for ${c.name}: ${r.offers.length} verified, ${r.excluded.length} excluded`, r.offers.length ? "ok" : "warn");
      return { c, r, err: null as string | null };
    } catch (e) {
      log(`Offer lookup failed for ${c.name}`, "error");
      return { c, r: null, err: e instanceof Error ? e.message.slice(0, 120) : "failed" };
    }
  });

  const kept: { c: Candidate; offers: ReturnType<typeof pickVariantBucket>; low: number }[] = [];
  const dropped: string[] = [];
  for (const { c, r, err } of results) {
    if (!r) { statuses.push({ source: "retailers", state: "error", message: `Offer lookup failed for ${c.name}${err ? `: ${err}` : ""}` }); dropped.push(`${c.name}: offer lookup failed`); continue; }
    statuses.push(...r.statuses);
    // stage 2 (offers): a verified price never makes a listing match the request
    const reqOffers = r.offers.filter((o) => meetsRequirements(o.productName, parsed).ok);
    if (reqOffers.length < r.offers.length) notes.push(`${c.name}: ${r.offers.length - reqOffers.length} store listing(s) dropped (wrong brand or product type).`);
    const g1 = guardOffers(reqOffers, { category: parsed.category, editorialPrice: c.price?.price ?? null });
    const bucket = pickVariantBucket(g1.offers, { ramGb: parsed.variant.ramGb, storageGb: parsed.variant.storageGb });
    const g2 = guardMedian(bucket.offers);
    bucket.offers = g2.offers;
    const guardNotes = [...g1.notes, ...g2.notes];
    if (guardNotes.length) bucket.note = [bucket.note, ...guardNotes].filter(Boolean).join(" ");
    const low = lowestVerified(bucket.offers);
    if (!low) { dropped.push(`${c.name}: ${guardNotes.length ? "only implausible prices found, so none shown" : "no verified store price found"}`); continue; }
    if ((parsed.budgetMax !== null && low.price > parsed.budgetMax) || (parsed.budgetMin !== null && low.price < parsed.budgetMin)) {
      dropped.push(`${c.name}: verified price ${low.price} is outside your budget`);
      continue;
    }
    kept.push({ c, offers: bucket, low: low.price });
  }
  if (dropped.length) notes.push(`Dropped after price check: ${dropped.slice(0, 6).join("; ")}${dropped.length > 6 ? `; +${dropped.length - 6} more` : ""}.`);

  if (kept.length === 0) return { groups: [], statuses: mergeStatuses(statuses), notes, emptyReason: requirementsEmptyMessage(parsed) ?? "No candidate had a verified store price within your requirements.", candidateCount: ex.candidates.length };

  // rescore with verified prices and rank
  const priceRef = parsed.budgetMax ?? Math.max(...kept.map((k) => k.low));
  const rescored = kept
    .map((k) => ({ ...k, price: k.low, score: cfg.score(k.c.specs, { price: k.low, priceRef, weights }) }));
  const ranked = rankDesc(rescored);

  const groups = ranked.map((k): ProductGroup => {
    const why = whyFromScore(k.score, k.c.specs);
    const unknown = constraints.filter((x) => x.id !== "budget_max" && x.id !== "budget_min" && x.check({ specs: k.c.specs, price: k.low }, true) === "unknown");
    for (const u of unknown) why.push(`Not confirmed by sources: ${u.describe}.`);
    if (k.score.total === null) why.push("Too little evidence for an overall score (under 50% of the scoring weight is backed by sources); ranked by evidence coverage, then price.");
    if (k.score.provisional) why.push("Provisional score: some key specifications were not found in the sources.");
    if (k.offers.note) why.push(k.offers.note);
    const g = makeGroup({
      id: k.c.id, name: k.c.name, brand: k.c.brand, model: k.c.brand ? k.c.name.replace(new RegExp(`^${k.c.brand}\\s+`, "i"), "") : k.c.name,
      variant: { ...parsed.variant, gpu: (k.c.specs.find((f) => f.key === "gpu")?.value as string | undefined) ?? null, ramGb: k.offers.ramGb ?? parsed.variant.ramGb, storageGb: k.offers.storageGb ?? parsed.variant.storageGb },
      offers: k.offers.offers, decision: finalizeDecision(k.offers.offers, ctx.weights, buildDecision), specs: k.c.specs, score: k.score, why, provisional: k.score.provisional || unknown.length > 0,
    });
    return g;
  });
  groups.forEach((g, i) => (g.rank = i + 1));
  return { groups, statuses: mergeStatuses(statuses), notes, emptyReason: null, candidateCount: ex.candidates.length };
}

/** Evidence-backed spec facts for one named product (used by comparisons). */
export async function gatherSpecs(name: string, parsed: ParsedQuery, deps: ShopDeps, log: Log, year: number): Promise<{ specs: SpecFact[]; statuses: SourceStatus[] }> {
  const cfg = getCategoryConfig(parsed.category);
  if (!cfg) return { specs: [], statuses: [] };
  const pg = await discoverSpecPages(name, deps, log, year);
  if (!pg.pages.length) return { specs: [], statuses: pg.statuses };
  const llm = resolveLlm(deps);
  const r = await extractForTarget(name, pg.pages, cfg, llm, CAT_LABEL[parsed.category] ?? parsed.category);
  const statuses = [...pg.statuses];
  statuses.push(
    llm
      ? { source: "discovery:llm", state: r.llmFailed ? "error" : "ok", message: r.llmFailed ? "AI extraction failed; used deterministic extraction." : `${name}: ${r.specs.length} verified spec facts` }
      : { source: "discovery:llm", state: "skipped", message: "ANTHROPIC_API_KEY not set: used deterministic extraction." },
  );
  log(`Spec facts for "${name}": ${r.specs.length} verified`, r.specs.length ? "ok" : "warn");
  return { specs: r.specs, statuses };
}
