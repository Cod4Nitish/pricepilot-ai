// Candidate extraction from fetched page text: Claude (JSON, evidence-verified) or a deterministic fallback.
import { z } from "zod";
import { parseShopQuery } from "../parser";
import type { CategoryConfig } from "../categories";
import type { SpecFact } from "../types";
import { mentionedIn, normText, verifyFacts, verifyPrice } from "./evidence";
import { parseJsonObject } from "./llm";
import type { Candidate, FetchedText, LlmFn, PriceHint } from "./types";

const MAX_CANDIDATES = 12;
const PRICE_RE = /(?:₹|Rs\.?|INR)\s?(\d{1,3}(?:,\d{2,3})+|\d{4,7})/;

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function brandOf(name: string): string | null {
  return parseShopQuery(name).brand;
}

const LlmOut = z.object({
  candidates: z
    .array(
      z.object({
        name: z.string().min(2).max(100),
        price_inr: z.number().positive().nullable().optional(),
        price_evidence: z.string().max(300).nullable().optional(),
        price_source_url: z.string().max(500).nullable().optional(),
        specs: z
          .array(
            z.object({
              key: z.string().max(40),
              value: z.union([z.string().max(100), z.number()]),
              unit: z.string().max(20).nullable().optional(),
              sourceUrl: z.string().max(500),
              evidence: z.string().min(3).max(300),
            }),
          )
          .max(30),
      }),
    )
    .max(30),
});

const LenientCand = z.object({
  name: z.string().min(2),
  price_inr: z.number().positive().nullable().optional(),
  price_evidence: z.string().nullable().optional(),
  price_source_url: z.string().nullable().optional(),
  specs: z
    .array(
      z.object({
        key: z.string(),
        value: z.union([z.string(), z.number()]),
        unit: z.string().nullable().optional(),
        sourceUrl: z.string(),
        evidence: z.string().min(3),
      }),
    )
    .catch([]),
});

export interface ExtractResult {
  candidates: Candidate[];
  keptFacts: number;
  droppedFacts: number;
  droppedCandidates: number;
  ok: boolean; // false when the LLM call/JSON failed (caller falls back)
}

export async function extractWithLlm(
  pages: FetchedText[],
  cfg: CategoryConfig,
  llm: LlmFn,
  opts: { targets?: string[]; categoryLabel: string },
): Promise<ExtractResult> {
  const pageMap = new Map(pages.map((p) => [p.url, p.text]));
  const keys = cfg.specKeys.map((k) => `${k.key}${k.unit ? ` (${k.unit})` : ""}`).join(", ");
  const system =
    `You extract product data from web page text. Reply with ONLY a JSON object: {"candidates":[{"name":string,"price_inr":number|null,"price_evidence":string|null,"price_source_url":string|null,"specs":[{"key":string,"value":string|number,"unit":string|null,"sourceUrl":string,"evidence":string}]}]}. ` +
    `Rules: list at most ${MAX_CANDIDATES} ${opts.categoryLabel} models that are actually mentioned in the pages${opts.targets ? ` (ONLY these: ${opts.targets.join("; ")})` : ""}. ` +
    `Allowed spec keys: ${keys}. Every spec MUST include sourceUrl (exactly one of the page URLs given) and evidence = a SHORT VERBATIM excerpt copied character-for-character from that page that states the value. ` +
    `Never infer, never use outside knowledge, omit anything you cannot quote. price_inr only if a rupee price for that model is quoted (with verbatim price_evidence).`;
  const user = pages.map((p) => `=== PAGE ${p.url}\n${p.text.slice(0, 6000)}`).join("\n\n");
  const raw = await llm({ model: "claude-sonnet-5-5", system, user, maxTokens: 8000, timeoutMs: 60_000 });
  // Lenient: one malformed candidate must not discard the others. Facts are still verified verbatim below.
  const obj = parseJsonObject(raw) as { candidates?: unknown[] } | null;
  if (!obj || !Array.isArray(obj.candidates)) {
    console.warn("[shop/discovery] LLM returned no parseable JSON", raw ? raw.slice(0, 200) : "(null response)");
    return { candidates: [], keptFacts: 0, droppedFacts: 0, droppedCandidates: 0, ok: false };
  }
  const goodCands: z.infer<typeof LenientCand>[] = [];
  for (const c of obj.candidates) {
    const r = LenientCand.safeParse(c);
    if (r.success) goodCands.push(r.data);
  }
  if (goodCands.length === 0 && obj.candidates.length > 0) {
    console.warn("[shop/discovery] no candidate passed validation");
    return { candidates: [], keptFacts: 0, droppedFacts: 0, droppedCandidates: obj.candidates.length, ok: false };
  }
  const parsed = { data: { candidates: goodCands } };

  const allowed = new Set(cfg.specKeys.map((k) => k.key));
  const out: Candidate[] = [];
  let kept = 0, dropped = 0, droppedCands = 0;
  for (const c of parsed.data.candidates.slice(0, 30)) {
    const urls = mentionedIn(c.name, pageMap);
    if (urls.length === 0) { droppedCands++; continue; } // not present in any fetched page
    const facts: SpecFact[] = c.specs.map((s) => {
      const def = cfg.specKeys.find((k) => k.key === s.key);
      return { key: s.key, label: def?.label ?? s.key, value: s.value, ...(s.unit || def?.unit ? { unit: (s.unit ?? def?.unit) as string } : {}), sourceUrl: s.sourceUrl, evidence: s.evidence };
    });
    const v = verifyFacts(facts, pageMap, allowed);
    kept += v.kept.length;
    dropped += v.dropped;
    const seen = new Set<string>();
    const specs = v.kept.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true)));
    const price = verifyPrice(
      c.price_inr && c.price_evidence && c.price_source_url ? { price: c.price_inr, evidence: c.price_evidence, sourceUrl: c.price_source_url } : null,
      pageMap,
    );
    out.push({ id: slug(c.name), name: c.name.trim(), brand: brandOf(c.name), specs, price, sourceUrls: urls });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return { candidates: dedupe(out), keptFacts: kept, droppedFacts: dropped, droppedCandidates: droppedCands, ok: true };
}

function dedupe(cs: Candidate[]): Candidate[] {
  const m = new Map<string, Candidate>();
  for (const c of cs) {
    const ex = m.get(c.id);
    if (!ex) { m.set(c.id, c); continue; }
    const have = new Set(ex.specs.map((s) => s.key));
    ex.specs.push(...c.specs.filter((s) => !have.has(s.key)));
    ex.price ??= c.price;
    ex.sourceUrls = Array.from(new Set([...ex.sourceUrls, ...c.sourceUrls]));
  }
  return [...m.values()];
}

// ---------------- deterministic fallback ----------------

function cleanHeading(line: string): string | null {
  let h = line.replace(/^#{1,5}\s*/, "").replace(/[*_`]/g, "").replace(/^\(?\d{1,2}[.)]\s*/, "").trim();
  h = h.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  h = h.split(/\s[–—-]\s|:\s|\s\|\s/)[0].replace(/\s+review$/i, "").trim();
  if (h.length < 4 || h.length > 60 || h.split(" ").length > 7 || !/\d/.test(h)) return null;
  const p = parseShopQuery(h);
  return p.brand ? h : null;
}

interface Section { name: string; text: string; url: string }

function sectionsOf(page: FetchedText): Section[] {
  const lines = page.text.split(/\r?\n/);
  const heads: { idx: number; name: string }[] = [];
  let offset = 0;
  const starts: number[] = [];
  for (const l of lines) { starts.push(offset); offset += l.length + 1; }
  lines.forEach((l, i) => {
    if (/^\s*(#{1,5}\s|\*\*|\(?\d{1,2}[.)]\s)/.test(l)) {
      const name = cleanHeading(l.trim());
      if (name) heads.push({ idx: starts[i], name });
    }
  });
  return heads.map((h, i) => ({ name: h.name, url: page.url, text: page.text.slice(h.idx, Math.min(heads[i + 1]?.idx ?? page.text.length, h.idx + 3500)) }));
}

function priceIn(text: string, url: string): PriceHint | null {
  const m = PRICE_RE.exec(text);
  if (!m) return null;
  const price = parseInt(m[1].replace(/,/g, ""), 10);
  if (!(price >= 3000)) return null;
  const start = Math.max(0, m.index - 15);
  return { price, sourceUrl: url, evidence: text.slice(start, m.index + m[0].length + 10).replace(/\s+/g, " ").trim() };
}

export function extractDeterministic(pages: FetchedText[], cfg: CategoryConfig): ExtractResult {
  const pageMap = new Map(pages.map((p) => [p.url, p.text]));
  const allowed = new Set(cfg.specKeys.map((k) => k.key));
  const out: Candidate[] = [];
  let kept = 0, dropped = 0;
  for (const page of pages) {
    for (const s of sectionsOf(page)) {
      const v = verifyFacts(cfg.extractSpecs(s.text, s.url), pageMap, allowed);
      kept += v.kept.length;
      dropped += v.dropped;
      if (v.kept.length < 2) continue; // a heading with no spec evidence is not a candidate
      out.push({ id: slug(s.name), name: s.name, brand: brandOf(s.name), specs: v.kept, price: verifyPrice(priceIn(s.text, s.url), pageMap), sourceUrls: [s.url] });
    }
  }
  const candidates = dedupe(out).slice(0, MAX_CANDIDATES);
  return { candidates, keptFacts: kept, droppedFacts: dropped, droppedCandidates: 0, ok: true };
}

/** Spec facts for one named product (comparison sides). LLM when available, else a window around the first mention. */
export async function extractForTarget(
  name: string,
  pages: FetchedText[],
  cfg: CategoryConfig,
  llm: LlmFn | null,
  categoryLabel: string,
): Promise<{ specs: SpecFact[]; llmUsed: boolean; llmFailed: boolean }> {
  const pageMap = new Map(pages.map((p) => [p.url, p.text]));
  const allowed = new Set(cfg.specKeys.map((k) => k.key));
  let llmFailed = false;
  if (llm) {
    const r = await extractWithLlm(pages, cfg, llm, { targets: [name], categoryLabel });
    if (r.ok) {
      const n = normText(name);
      const hit = r.candidates.find((c) => normText(c.name) === n) ?? r.candidates.find((c) => normText(c.name).includes(n) || n.includes(normText(c.name)));
      return { specs: hit?.specs ?? [], llmUsed: true, llmFailed: false };
    }
    llmFailed = true;
  }
  const specs: SpecFact[] = [];
  const seen = new Set<string>();
  const n = normText(name);
  for (const p of pages) {
    const low = p.text.toLowerCase();
    const idx = low.indexOf(n);
    if (idx < 0) continue;
    const v = verifyFacts(cfg.extractSpecs(p.text.slice(idx, idx + 4000), p.url), pageMap, allowed);
    for (const f of v.kept) if (!seen.has(f.key)) { seen.add(f.key); specs.push(f); }
  }
  return { specs, llmUsed: false, llmFailed };
}
