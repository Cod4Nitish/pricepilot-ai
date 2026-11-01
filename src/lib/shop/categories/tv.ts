import type { ParsedQuery, SpecFact } from "../types";
import { budgetConstraint, composeScore, getFact, linear, makeWeightsFor, maxMatch, mk, numFact, priceScore, type CategoryConfig, type HardConstraint, type RawComponent } from "./scoring";

// Smart TVs. Scores come ONLY from evidence-backed facts; missing => null. Screen size is a constraint, not a score.
const DEFAULTS = { resolution: 0.2, panel: 0.18, refresh: 0.1, hdr: 0.1, ports: 0.08, price: 0.34 };
const BOOSTS: Record<string, Record<string, number>> = {
  gaming: { refresh: 3, ports: 1.5 }, amoled: { panel: 2 }, display: { panel: 1.5, hdr: 1.5 },
};

const RES_SCORE: Record<string, number> = { "8K": 1, "4K": 0.9, "Full HD": 0.5, HD: 0.25 };
export function normRes(raw: string): string | null {
  const s = raw.toLowerCase();
  if (/8k|7680/.test(s)) return "8K";
  if (/4k|ultra hd|uhd|3840/.test(s)) return "4K";
  if (/full hd|fhd|1080p|1920/.test(s)) return "Full HD";
  if (/hd ready|\bhd\b|720p|1366/.test(s)) return "HD";
  return null;
}
function panelScore(v: string): number {
  return /oled/i.test(v) && !/qled/i.test(v) ? 1 : /qled|mini[- ]?led/i.test(v) ? 0.75 : 0.5;
}

const qtext = (p: Pick<ParsedQuery, "raw" | "normalized">) => `${p.raw} ${p.normalized}`.toLowerCase();
/** Screen size requested in the query ("55 inch", "55-inch", 55"), or null. */
export function requestedInch(p: Pick<ParsedQuery, "raw" | "normalized">): number | null {
  const m = /\b(\d{2,3})\s?-?\s?(?:inch|inches|")/.exec(qtext(p));
  const n = m ? parseInt(m[1], 10) : NaN;
  return n >= 19 && n <= 100 ? n : null;
}

function score(specs: SpecFact[], ctx: { price: number | null; priceRef: number | null; weights: Record<string, number> }) {
  const w = ctx.weights;
  const res = getFact(specs, "resolution"), panel = getFact(specs, "panel_type"), hdr = getFact(specs, "hdr");
  const hz = numFact(specs, "refresh_hz"), hdmi = numFact(specs, "hdmi_ports");
  const rs = res ? RES_SCORE[String(res.value)] ?? null : null;
  const p = priceScore(ctx.price, ctx.priceRef);
  const comps: RawComponent[] = [
    { name: "resolution", weight: w.resolution, score: rs, basis: rs === null ? "resolution not found" : `${res?.value} (8K=1, 4K=0.9, FHD=0.5, HD=0.25)` },
    { name: "panel", weight: w.panel, score: panel ? panelScore(String(panel.value)) : null, basis: panel ? `${panel.value} (OLED=1, QLED/Mini LED=0.75, LED=0.5)` : "panel type not found" },
    { name: "refresh", weight: w.refresh, score: hz === null ? null : linear(hz, 50, 120), basis: hz === null ? "refresh rate not found" : `${hz} Hz, linear 50..120` },
    { name: "hdr", weight: w.hdr, score: hdr ? (/dolby vision/i.test(String(hdr.value)) ? 1 : /hdr10\+/i.test(String(hdr.value)) ? 0.8 : 0.6) : null, basis: hdr ? `HDR: ${hdr.value} (Dolby Vision=1, HDR10+=0.8, other=0.6)` : "HDR support not found" },
    { name: "ports", weight: w.ports, score: hdmi === null ? null : linear(hdmi, 1, 4), basis: hdmi === null ? "HDMI port count not found" : `${hdmi} HDMI ports, linear 1..4` },
    { name: "price", weight: w.price, score: p.score, basis: p.basis },
  ];
  return composeScore(comps);
}

function constraints(parsed: ParsedQuery): HardConstraint[] {
  const out = budgetConstraint(parsed);
  const t = qtext(parsed);
  if (/\b(4k|uhd|ultra hd)\b/.test(t)) out.push({ id: "resolution_4k", describe: "4K (or higher) resolution", check: ({ specs }) => { const f = getFact(specs, "resolution"); return !f ? "unknown" : ["4K", "8K"].includes(String(f.value)) ? "pass" : "fail"; } });
  const inch = requestedInch(parsed);
  if (inch !== null) out.push({ id: "screen_inch", describe: `${inch} inch screen`, check: ({ specs }) => { const n = numFact(specs, "screen_inch"); return n === null ? "unknown" : Math.abs(n - inch) <= 1 ? "pass" : "fail"; } });
  const wantPanel = /\boled\b/.test(t) ? "oled" : /\bqled\b/.test(t) ? "qled" : null;
  if (wantPanel) out.push({ id: "panel", describe: `${wantPanel.toUpperCase()} panel`, check: ({ specs }) => { const f = getFact(specs, "panel_type"); if (!f) return "unknown"; const v = String(f.value).toLowerCase(); return (wantPanel === "oled" ? v === "oled" : v.includes("qled")) ? "pass" : "fail"; } });
  return out;
}

function extractSpecs(text: string, url: string): SpecFact[] {
  const out: SpecFact[] = [];
  const res = /\b(8K|4K|Ultra HD|UHD|Full HD|FHD|HD Ready|3840\s?x\s?2160|1920\s?x\s?1080|1366\s?x\s?768)\b/i.exec(text);
  const rn = res ? normRes(res[1]) : null;
  if (res && rn) out.push(mk(text, res, "resolution", "Resolution", rn, url));
  const inch = /(\d{2,3})\s?-?\s?(?:inch(?:es)?\b|")/i.exec(text);
  if (inch && parseInt(inch[1], 10) >= 19 && parseInt(inch[1], 10) <= 100) out.push(mk(text, inch, "screen_inch", "Screen size", parseInt(inch[1], 10), url, "inch"));
  const panel = /\b(Neo QLED|QLED|OLED|Mini[- ]LED|LED)\b/i.exec(text);
  if (panel) out.push(mk(text, panel, "panel_type", "Panel", panel[1].toUpperCase().replace(/^NEO/, "Neo").replace(/^MINI/, "Mini"), url));
  const hz = maxMatch(text, /(\d{2,3})\s?Hz/i, (m) => parseInt(m[1], 10), (n) => n >= 50 && n <= 240);
  if (hz) out.push(mk(text, hz.m, "refresh_hz", "Refresh rate", hz.n, url, "Hz"));
  const hdr = /\b(Dolby Vision|HDR10\+|HDR10|HLG|HDR)/i.exec(text);
  if (hdr) out.push(mk(text, hdr, "hdr", "HDR", hdr[1], url));
  const os = /\b(Google TV|Android TV|webOS|Tizen|Fire TV|VIDAA|Roku TV)\b/i.exec(text);
  if (os) out.push(mk(text, os, "smart_os", "Smart OS", os[1], url));
  const hdmi = /(\d)\s?x?\s?HDMI|HDMI(?:\s?ports?)?[:\s]+(\d)\b/i.exec(text);
  if (hdmi) { const n = parseInt(hdmi[1] ?? hdmi[2], 10); if (n >= 1 && n <= 6) out.push(mk(text, hdmi, "hdmi_ports", "HDMI ports", n, url)); }
  return out;
}

export const tvConfig: CategoryConfig = {
  category: "tv",
  specKeys: [
    { key: "screen_inch", label: "Screen size", unit: "inch" }, { key: "resolution", label: "Resolution" }, { key: "panel_type", label: "Panel" },
    { key: "refresh_hz", label: "Refresh rate", unit: "Hz" }, { key: "hdr", label: "HDR" }, { key: "smart_os", label: "Smart OS" }, { key: "hdmi_ports", label: "HDMI ports" },
  ],
  defaultWeights: DEFAULTS,
  featureBoosts: BOOSTS,
  weightsFor: makeWeightsFor(DEFAULTS, BOOSTS),
  constraints,
  score,
  extractSpecs,
};
