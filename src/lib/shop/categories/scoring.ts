// Shared scoring helpers. RULE: scores are derived ONLY from evidence-backed spec facts; missing => null (never 0, never guessed).
import type { ParsedQuery, ProductScore, ScoreComponent, SpecFact } from "../types";

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Linear monotonic normalization: lo -> 0, hi -> 1. */
export const linear = (v: number, lo: number, hi: number): number => clamp01((v - lo) / (hi - lo));

export function getFact(specs: SpecFact[], key: string): SpecFact | undefined {
  return specs.find((s) => s.key === key);
}
export function numFact(specs: SpecFact[], key: string): number | null {
  const f = getFact(specs, key);
  if (!f) return null;
  const n = typeof f.value === "number" ? f.value : parseFloat(String(f.value));
  return Number.isFinite(n) ? n : null;
}

export const MIN_COVERAGE = 0.5;

/** Share (0..1) of total weight that has evidence. */
export function scoreCoverage(score: { components: { score: number | null; weight: number }[] }): number {
  const all = score.components.reduce((a, c) => a + c.weight, 0) || 1;
  return score.components.filter((c) => c.score !== null).reduce((a, c) => a + c.weight, 0) / all;
}

export interface RawComponent {
  name: string;
  weight: number;
  score: number | null;
  basis: string;
}

/**
 * total = sum(w_i * s_i) / sum(w_i) over components WITH evidence, scaled 0..100.
 * provisional = any missing component whose weight share (over all weights) is >= 0.2.
 */
export function composeScore(components: RawComponent[]): ProductScore {
  const totalW = components.reduce((a, c) => a + c.weight, 0) || 1;
  const have = components.filter((c) => c.score !== null && c.weight > 0);
  const haveW = have.reduce((a, c) => a + c.weight, 0);
  // Honesty rule: no headline score unless evidenced components cover >= 50% of the total weight.
  const covered = haveW / totalW >= MIN_COVERAGE;
  const total = haveW > 0 && covered ? Math.round((have.reduce((a, c) => a + c.weight * (c.score as number), 0) / haveW) * 1000) / 10 : null;
  const missing = components.filter((c) => c.score === null && c.weight > 0).map((c) => c.name);
  const provisional = components.some((c) => c.score === null && c.weight / totalW >= 0.2) || total === null;
  const out: ScoreComponent[] = components.map((c) => ({
    name: c.name,
    score: c.score === null ? null : Math.round(c.score * 1000) / 1000,
    weight: Math.round((c.weight / totalW) * 1000) / 1000,
    basis: c.basis,
  }));
  return { total, components: out, provisional, missing };
}

/** Price component: monotonic decreasing; needs a reference (budget max or highest candidate price). */
export function priceScore(price: number | null, ceiling: number | null): { score: number | null; basis: string } {
  if (price === null || !ceiling || ceiling <= 0) return { score: null, basis: "no verified price yet" };
  return { score: clamp01(1 - 0.8 * (price / ceiling)), basis: `1 - 0.8 x (price ${price} / reference ${ceiling}); reference = budget max or highest candidate price` };
}

export interface ScoreCtx {
  price: number | null;
  priceRef: number | null;
  weights: Record<string, number>;
}

export type ConstraintResult = "pass" | "fail" | "unknown";
export interface HardConstraint {
  id: string;
  describe: string;
  /** strict=false is used on editorial-evidence prices (stale/launch prices): only gross violations fail. */
  check: (c: { specs: SpecFact[]; price: number | null }, strict: boolean) => ConstraintResult;
}

export interface SpecKeyDef {
  key: string;
  label: string;
  unit?: string;
}

export interface CategoryConfig {
  category: "smartphone" | "laptop" | "headphones" | "tv";
  specKeys: SpecKeyDef[];
  defaultWeights: Record<string, number>;
  /** multiplicative boosts applied to default weights per preferred feature (configurable). */
  featureBoosts: Record<string, Record<string, number>>;
  weightsFor: (parsed: Pick<ParsedQuery, "preferredFeatures">, override?: Record<string, number>) => Record<string, number>;
  constraints: (parsed: ParsedQuery) => HardConstraint[];
  score: (specs: SpecFact[], ctx: ScoreCtx) => ProductScore;
  extractSpecs: (text: string, sourceUrl: string) => SpecFact[];
}

export function makeWeightsFor(defaults: Record<string, number>, boosts: Record<string, Record<string, number>>) {
  return (parsed: Pick<ParsedQuery, "preferredFeatures">, override?: Record<string, number>): Record<string, number> => {
    const w: Record<string, number> = { ...defaults };
    for (const f of parsed.preferredFeatures) for (const [k, m] of Object.entries(boosts[f] ?? {})) if (k in w) w[k] *= m;
    for (const [k, v] of Object.entries(override ?? {})) if (k in w && v >= 0) w[k] = v;
    const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    for (const k of Object.keys(w)) w[k] = w[k] / sum;
    return w;
  };
}

export function budgetConstraint(parsed: ParsedQuery): HardConstraint[] {
  const out: HardConstraint[] = [];
  const { budgetMax, budgetMin } = parsed;
  if (budgetMax !== null) {
    out.push({
      id: "budget_max",
      describe: `price <= ${budgetMax}`,
      check: (c, strict) => (c.price === null ? "unknown" : c.price <= budgetMax * (strict ? 1 : 1.25) ? "pass" : "fail"),
    });
  }
  if (budgetMin !== null) {
    out.push({
      id: "budget_min",
      describe: `price >= ${budgetMin}`,
      check: (c, strict) => (c.price === null ? "unknown" : c.price >= budgetMin * (strict ? 1 : 0.75) ? "pass" : "fail"),
    });
  }
  return out;
}

/** Evidence-snippet builder: match plus a little context, single-spaced, taken verbatim from the source text. */
export function mk(text: string, m: RegExpExecArray, key: string, label: string, value: string | number, sourceUrl: string, unit?: string): SpecFact {
  const start = Math.max(0, m.index - 15);
  const end = Math.min(text.length, m.index + m[0].length + 15);
  return { key, label, value, ...(unit ? { unit } : {}), sourceUrl, evidence: text.slice(start, end).replace(/\s+/g, " ").trim() };
}

export function maxMatch(
  text: string,
  re: RegExp,
  parse: (m: RegExpExecArray) => number | null,
  ok: (n: number) => boolean,
): { n: number; m: RegExpExecArray } | null {
  let best: { n: number; m: RegExpExecArray } | null = null;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    const n = parse(m);
    if (n !== null && ok(n) && (!best || n > best.n)) best = { n, m };
  }
  return best;
}
