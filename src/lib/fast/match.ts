import { parsePack, samePack } from "./pack";
import type { PackSize } from "./types";

const STOP = new Set(["buy", "price", "best", "the", "and", "of", "a", "an", "for", "in", "online", "pack", "fresh", "new", "with", "pcs", "pc", "units", "eggs", "egg", "nos", "set", "box"]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const MEAS = "kg|kgs|g|gm|gms|gram|grams|l|ltr|ltrs|litre|litres|liter|liters|ml";
/** Remove the pack phrase from text so the remaining words are the product name. */
function stripPack(s: string): string {
  return s
    .replace(new RegExp(`\\d+\\s*(?:x|×)\\s*\\d+(?:\\.\\d+)?\\s*(?:${MEAS})\\b`, "gi"), " ")
    .replace(new RegExp(`\\d+(?:\\.\\d+)?\\s*(?:${MEAS})\\b`, "gi"), " ")
    .replace(/\b(?:pack|set|box|carton)\s*of\s*\d+\b/gi, " ")
    .replace(/\d+\s*(?:pcs|pc|pieces|piece|units|unit|nos|eggs|egg|sachets|sachet|bars|bar|tablets|count|ct|packs|pouches)\b/gi, " ");
}

export interface FastMatch {
  confidence: number;
  notes: string[];
  hardExcluded: boolean;
  pack: PackSize | null;
  queryPack: PackSize | null;
}

/** A listing is only treated as a real match at or above this confidence. */
export const MATCH_THRESHOLD = 0.7;

/**
 * Score a listing against a grocery query. Exact pack size is enforced when the query states one:
 * 500 ml never matches 1 L, 12 eggs never matches 6 eggs. A listing without a parseable pack
 * can never be a confident match for a query that asked for a pack.
 */
export function scoreFastListing(query: string, listing: { title: string; brand?: string | null; packLabel?: string | null }): FastMatch {
  const notes: string[] = [];
  const queryPack = parsePack(query);
  const pack = parsePack(listing.packLabel) ?? parsePack(listing.title);
  const fail = (why: string): FastMatch => ({ confidence: 0, notes: [...notes, why], hardExcluded: true, pack, queryPack });

  if (queryPack) {
    if (pack) {
      if (!samePack(queryPack, pack)) return fail(`Excluded: pack ${pack.label} listed, ${queryPack.label} requested.`);
      notes.push(`Pack size ${pack.label} matches.`);
    } else {
      notes.push("Pack size not stated in listing; cannot confirm the requested size.");
    }
  }

  const qWords = tokens(stripPack(query)).filter((w) => !STOP.has(w));
  const hay = new Set(tokens(`${listing.brand ?? ""} ${stripPack(listing.title)}`));
  const hayStr = [...hay].join("");
  if (qWords.length === 0) return { confidence: 0.3, notes: [...notes, "Query has no product words."], hardExcluded: false, pack, queryPack };
  const strict = qWords.filter((w) => /\d/.test(w));
  for (const w of strict) if (!hay.has(w) && !hayStr.includes(w)) return fail(`Excluded: "${w}" not found in listing title.`);
  const hit = qWords.filter((w) => hay.has(w) || (w.length > 3 && hayStr.includes(w))).length;
  const frac = hit / qWords.length;
  let score = 0.4 + 0.5 * frac;
  if (frac < 0.5) {
    notes.push("Several query words are missing from the listing title.");
    score -= 0.2;
  } else notes.push("Title matches query words.");
  if (queryPack && !pack) score -= 0.3;
  if (queryPack && pack) score += 0.05;
  return { confidence: Math.max(0, Math.min(1, Math.round(score * 100) / 100)), notes, hardExcluded: false, pack, queryPack };
}
