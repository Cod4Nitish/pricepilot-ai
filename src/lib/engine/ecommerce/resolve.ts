// Two-stage entity resolution: (1) fuzzy candidate retrieval, (2) exact rule-based validation.
import { canonicalBrand, entityFromText, fuzzyScore, normGtin, type Entity } from "./entity";

export interface Candidate {
  id: string;
  title: string;
  /** GTINs read from the page (already check-digit validated) */
  gtins?: string[];
}

export type MismatchSeverity = "hard" | "soft" | "unverifiable";
export interface Mismatch {
  attribute: string;
  severity: MismatchSeverity;
  wanted: string | null;
  found: string | null;
  note: string;
}
export interface Resolution {
  id: string;
  decision: "match" | "possible" | "reject";
  confidence: number;
  reasons: string[];
  mismatches: Mismatch[];
  fuzzy: number;
  viaGtin: boolean;
}

export const RETRIEVAL_THRESHOLD = 0.25;
const clamp = (n: number) => Math.max(0, Math.min(1, Math.round(n * 100) / 100));

/** Stage 1: cheap fuzzy retrieval score (token-set ratio + trigram Jaccard, alias/model-number tolerant). */
export function retrieve(queryText: string, c: Candidate): number {
  return fuzzyScore(queryText, c.title);
}

/** Stage 2: hard-rule validation of one candidate against the wanted entity. */
export function validate(want: Entity, queryText: string, c: Candidate): Resolution {
  const fuzzy = retrieve(queryText, c);
  const have = entityFromText(c.title);
  const candGtins = (c.gtins ?? []).map(normGtin);
  const mismatches: Mismatch[] = [];
  const reasons: string[] = [];

  // GTIN overrides fuzzy matching in both directions.
  if (want.gtins.length && candGtins.length) {
    const eq = want.gtins.some((g) => candGtins.includes(g));
    if (eq) {
      return { id: c.id, decision: "match", confidence: 0.99, reasons: [`GTIN ${want.gtins.find((g) => candGtins.includes(g))} matches exactly (overrides fuzzy title score ${fuzzy}).`], mismatches: [], fuzzy, viaGtin: true };
    }
    return {
      id: c.id, decision: "reject", confidence: 0,
      reasons: ["Both sides publish a GTIN and they differ: different product."],
      mismatches: [{ attribute: "gtin", severity: "hard", wanted: want.gtins[0], found: candGtins[0], note: "GTIN differs" }],
      fuzzy, viaGtin: true,
    };
  }
  if (want.gtins.length && !candGtins.length && want.tokens.length === 0) {
    return { id: c.id, decision: "possible", confidence: 0.3, reasons: ["Query is a GTIN but the listing publishes none."], mismatches: [{ attribute: "gtin", severity: "unverifiable", wanted: want.gtins[0], found: null, note: "listing has no GTIN" }], fuzzy, viaGtin: false };
  }

  if (fuzzy < RETRIEVAL_THRESHOLD) {
    return { id: c.id, decision: "reject", confidence: clamp(fuzzy * 0.3), reasons: [`Title similarity ${fuzzy} is below the retrieval threshold.`], mismatches: [], fuzzy, viaGtin: false };
  }

  const hard = (attribute: string, wanted: string | null, found: string | null, note: string) => mismatches.push({ attribute, severity: "hard", wanted, found, note });
  const unver = (attribute: string, wanted: string | null, note: string) => mismatches.push({ attribute, severity: "unverifiable", wanted, found: null, note });
  let agreed = 0;

  // brand
  const wb = canonicalBrand(want.brand);
  const hb = canonicalBrand(have.brand);
  if (wb) {
    if (hb && hb !== wb) hard("brand", wb, hb, `Brand ${hb} differs from ${wb}.`);
    else if (!hb) unver("brand", wb, "Listing title does not state a brand.");
    else {
      agreed++;
      reasons.push(`Brand ${wb} agrees.`);
    }
  }

  // model numbers: every wanted model number must appear; extra model numbers on the listing that the query lacks are a mismatch
  const haveTokens = new Set(have.tokens);
  for (const mn of want.modelNumbers) {
    if (!haveTokens.has(mn)) hard("model", mn, have.modelNumbers.join(" ") || null, `Model "${mn}" not found in listing title.`);
    else {
      agreed++;
      reasons.push(`Model number ${mn} agrees.`);
    }
  }
  if (want.modelNumbers.length) {
    const extra = have.modelNumbers.filter((m) => !want.modelNumbers.includes(m));
    if (extra.length && extra.every((m) => /^[a-z]?\d{1,3}[a-z]?$/.test(m)) && have.modelNumbers.length > want.modelNumbers.length) {
      hard("model", want.modelNumbers.join(" "), have.modelNumbers.join(" "), `Listing has a different model number (${extra.join(", ")}).`);
    }
  }

  // generation suffix (Ultra/Plus/FE/Pro/Max/mini...) must agree in both directions
  const ws = new Set(want.suffixes);
  const hs = new Set(have.suffixes);
  const missingSuffix = [...ws].filter((s) => !hs.has(s));
  const extraSuffix = [...hs].filter((s) => !ws.has(s));
  if (missingSuffix.length) hard("suffix", missingSuffix.join(" "), [...hs].join(" ") || null, `Requested variant "${missingSuffix.join(" ")}" not in listing.`);
  if (extraSuffix.length) hard("suffix", [...ws].join(" ") || null, extraSuffix.join(" "), `Listing is a different variant ("${extraSuffix.join(" ")}") than requested.`);
  if (!missingSuffix.length && !extraSuffix.length) {
    agreed++;
    if (ws.size) reasons.push(`Variant suffix "${[...ws].join(" ")}" agrees.`);
  }

  // storage / RAM
  const numAttr = (name: string, w: number | null, h: number | null) => {
    if (w === null) return;
    if (h === null) unver(name, `${w}GB`, `${name} not stated in the listing title.`);
    else if (h !== w) hard(name, `${w}GB`, `${h}GB`, `${h}GB ${name} listed, ${w}GB requested.`);
    else {
      agreed++;
      reasons.push(`${name} ${w}GB agrees.`);
    }
  };
  numAttr("storage", want.storageGb, have.storageGb);
  numAttr("ram", want.ramGb, have.ramGb);

  // condition: new vs refurbished is hard
  if (want.condition !== have.condition) hard("condition", want.condition, have.condition, `Listing is ${have.condition}, ${want.condition} requested.`);
  else reasons.push(`Condition (${have.condition}) agrees.`);

  // colour: soft
  if (want.colors.length) {
    if (!have.colors.length) mismatches.push({ attribute: "color", severity: "unverifiable", wanted: want.colors.join("/"), found: null, note: "Colour not stated in the listing title." });
    else if (!want.colors.some((c0) => have.colors.includes(c0))) mismatches.push({ attribute: "color", severity: "soft", wanted: want.colors.join("/"), found: have.colors.join("/"), note: `Colour ${have.colors.join("/")} differs from requested ${want.colors.join("/")}.` });
    else reasons.push("Colour agrees.");
  }

  const hardList = mismatches.filter((m) => m.severity === "hard");
  if (hardList.length) {
    return { id: c.id, decision: "reject", confidence: clamp(Math.min(0.2, fuzzy * 0.3)), reasons: hardList.map((m) => m.note), mismatches, fuzzy, viaGtin: false };
  }

  const unverCore = mismatches.filter((m) => m.severity === "unverifiable" && m.attribute !== "color");
  const unverAll = mismatches.filter((m) => m.severity === "unverifiable");
  const soft = mismatches.filter((m) => m.severity === "soft");
  let conf = 0.5 + 0.25 * fuzzy + 0.04 * agreed - 0.12 * unverAll.length - 0.1 * soft.length;
  if (want.modelNumbers.length === 0) {
    conf = Math.min(conf, 0.6);
    reasons.push("Query has no model number, so the exact model cannot be validated.");
  }
  conf = clamp(Math.min(conf, 0.97));
  let decision: Resolution["decision"] = conf >= 0.4 ? "possible" : "reject";
  if (conf >= 0.72 && unverCore.length === 0 && want.modelNumbers.length > 0) decision = "match";
  if (decision === "reject") reasons.push("Confidence too low to treat as the same product.");
  return { id: c.id, decision, confidence: conf, reasons, mismatches, fuzzy, viaGtin: false };
}

/** Resolve many candidates (stage 1 + stage 2). Order of input is preserved. */
export function resolveCandidates(want: Entity, queryText: string, candidates: Candidate[]): Resolution[] {
  return candidates.map((c) => validate(want, queryText, c));
}
