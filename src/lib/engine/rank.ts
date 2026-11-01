// Generic, deterministic ranking shared by e-commerce offers and quick-commerce plans.

export interface Weights {
  price: number;
  speed: number;
  trust: number;
}
export const DEFAULT_WEIGHTS: Weights = { price: 0.6, speed: 0.25, trust: 0.15 };

/** Fill from defaults, drop negatives/NaN, normalise to sum 1. */
export function normalizeWeights(w?: Partial<Weights> | null): Weights {
  const pick = (v: number | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  const given = w ?? {};
  const hasAny = ["price", "speed", "trust"].some((k) => typeof (given as Record<string, unknown>)[k] === "number");
  const raw = hasAny
    ? { price: pick(given.price, 0), speed: pick(given.speed, 0), trust: pick(given.trust, 0) }
    : { ...DEFAULT_WEIGHTS };
  const sum = raw.price + raw.speed + raw.trust;
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  return { price: raw.price / sum, speed: raw.speed / sum, trust: raw.trust / sum };
}

export interface RankCand<T> {
  key: string;
  item: T;
  /** known portion of the total cost (null = no price) */
  total: number | null;
  totalIsLowerBound: boolean;
  etaMinutes: number | null;
  /** 0..1 completeness/trust signal */
  trust: number;
}

export interface Scored<T> extends RankCand<T> {
  score: number;
  parts: { price: number; speed: number; trust: number };
}

/** Lowest total, but a lower-bound total never wins against a fully-known total within `tol` (1%). */
export function pickCheapest<T>(cands: RankCand<T>[], tol = 0.01): RankCand<T> | null {
  const priced = cands.filter((c) => c.total !== null).sort((a, b) => (a.total as number) - (b.total as number) || a.key.localeCompare(b.key));
  if (!priced.length) return null;
  const top = priced[0];
  if (!top.totalIsLowerBound) return top;
  const known = priced.find((c) => !c.totalIsLowerBound && (c.total as number) <= (top.total as number) * (1 + tol));
  return known ?? top;
}

export function pickFastest<T>(cands: RankCand<T>[]): RankCand<T> | null {
  const withEta = cands.filter((c) => c.etaMinutes !== null).sort((a, b) => (a.etaMinutes as number) - (b.etaMinutes as number) || (a.total ?? Infinity) - (b.total ?? Infinity) || a.key.localeCompare(b.key));
  return withEta[0] ?? null;
}

const minmax = (vals: number[]) => ({ min: Math.min(...vals), max: Math.max(...vals) });
const norm01 = (v: number, mm: { min: number; max: number }) => (mm.max === mm.min ? 0 : (v - mm.min) / (mm.max - mm.min));

/** Weighted score with min-max normalisation over the given (already feasible) candidates. */
export function scoreCandidates<T>(cands: RankCand<T>[], weightsIn?: Partial<Weights> | null): Scored<T>[] {
  const w = normalizeWeights(weightsIn);
  const priced = cands.filter((c) => c.total !== null);
  const pmm = priced.length ? minmax(priced.map((c) => c.total as number)) : { min: 0, max: 0 };
  const etas = cands.filter((c) => c.etaMinutes !== null).map((c) => c.etaMinutes as number);
  const emm = etas.length ? minmax(etas) : { min: 0, max: 0 };
  return cands
    .map((c) => {
      const price = c.total === null ? 0 : 1 - norm01(c.total, pmm);
      const speed = c.etaMinutes === null ? 0 : 1 - norm01(c.etaMinutes, emm);
      const trust = c.trust - (c.totalIsLowerBound ? 0.1 : 0);
      const parts = { price, speed, trust: Math.max(0, Math.min(1, trust)) };
      return { ...c, parts, score: Math.round((w.price * parts.price + w.speed * parts.speed + w.trust * parts.trust) * 10000) / 10000 };
    })
    .sort((a, b) => b.score - a.score || (a.total ?? Infinity) - (b.total ?? Infinity) || a.key.localeCompare(b.key));
}
