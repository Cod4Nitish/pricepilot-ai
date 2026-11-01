// Anti-hallucination: every kept spec fact must carry a verbatim excerpt found in the fetched page it cites.
import type { SpecFact } from "../types";
import type { PriceHint } from "./types";

/** Whitespace/case/markdown-emphasis-normalized form used for substring checks. */
export function normText(s: string): string {
  return s
    .replace(/[   ]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*_`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function evidenceInPage(evidence: string, pageText: string): boolean {
  const e = normText(evidence);
  return e.length >= 3 && normText(pageText).includes(e);
}

const BOOL_VALUES = new Set(["yes", "no", "true", "false"]);

/** The claimed value must itself be visible in the evidence (digits for numbers, text for strings). */
export function valueInEvidence(value: string | number, evidence: string): boolean {
  const ev = normText(evidence).replace(/,/g, "");
  if (typeof value === "number") return ev.includes(String(value));
  const v = normText(String(value)).replace(/,/g, "");
  if (BOOL_VALUES.has(v)) return true;
  const num = Number(v);
  if (Number.isFinite(num) && v !== "") return ev.includes(String(num));
  return ev.includes(v);
}

export function verifyFacts(
  facts: SpecFact[],
  pages: Map<string, string>,
  allowedKeys: Set<string>,
): { kept: SpecFact[]; dropped: number } {
  const normPages = new Map<string, string>();
  const kept: SpecFact[] = [];
  let dropped = 0;
  for (const f of facts) {
    const page = pages.get(f.sourceUrl);
    if (!page || !allowedKeys.has(f.key)) { dropped++; continue; }
    let np = normPages.get(f.sourceUrl);
    if (np === undefined) { np = normText(page); normPages.set(f.sourceUrl, np); }
    const e = normText(f.evidence);
    if (e.length < 3 || !np.includes(e) || !valueInEvidence(f.value, f.evidence)) { dropped++; continue; }
    kept.push(f);
  }
  return { kept, dropped };
}

export function verifyPrice(p: PriceHint | null, pages: Map<string, string>): PriceHint | null {
  if (!p) return null;
  const page = pages.get(p.sourceUrl);
  if (!page || !Number.isFinite(p.price) || p.price <= 0) return null;
  if (!evidenceInPage(p.evidence, page)) return null;
  const digits = normText(p.evidence).replace(/,/g, "");
  return digits.includes(String(Math.round(p.price))) ? p : null;
}

/** Candidate is "mentioned" if its full name (or name minus the leading brand word) appears in a fetched page. */
export function mentionedIn(name: string, pages: Map<string, string>): string[] {
  const n = normText(name);
  const short = n.split(" ").length > 2 ? n.split(" ").slice(1).join(" ") : n;
  const urls: string[] = [];
  for (const [url, text] of pages) {
    const t = normText(text);
    if (t.includes(n) || (short.length >= 4 && t.includes(short))) urls.push(url);
  }
  return urls;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
