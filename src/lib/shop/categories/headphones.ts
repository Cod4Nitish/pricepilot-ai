import type { ParsedQuery, SpecFact } from "../types";
import { budgetConstraint, composeScore, getFact, linear, makeWeightsFor, maxMatch, mk, numFact, priceScore, type CategoryConfig, type HardConstraint, type RawComponent } from "./scoring";

// Covers TWS earbuds, neckbands and over-ear headphones. Scores come ONLY from evidence-backed facts; missing => null.
const DEFAULTS = { sound: 0.2, anc: 0.18, battery: 0.18, mic: 0.1, latency: 0.1, price: 0.24 };
const BOOSTS: Record<string, Record<string, number>> = {
  gaming: { latency: 3, mic: 1.3 }, battery: { battery: 2.5 }, travel: { anc: 2, battery: 1.5 }, student: { price: 1.5 },
};

/** Did the user explicitly ask for ANC? Read from the query text (the parser has no ANC feature token). */
export function wantsAnc(parsed: Pick<ParsedQuery, "raw" | "normalized">): boolean {
  return /\b(anc|noise[- ]cancell?(?:ing|ation)|active noise)\b/i.test(`${parsed.raw} ${parsed.normalized}`);
}

function score(specs: SpecFact[], ctx: { price: number | null; priceRef: number | null; weights: Record<string, number> }) {
  const w = ctx.weights;
  const drv = numFact(specs, "driver_mm"), codec = getFact(specs, "codec"), anc = getFact(specs, "anc");
  const bat = numFact(specs, "battery_hours"), mic = getFact(specs, "mic"), lat = numFact(specs, "latency_ms");
  const snd: number[] = [];
  if (drv !== null) snd.push(linear(drv, 6, 40));
  if (codec) snd.push(/ldac|aptx|lhdc/i.test(String(codec.value)) ? 1 : 0.5);
  const p = priceScore(ctx.price, ctx.priceRef);
  const comps: RawComponent[] = [
    { name: "sound", weight: w.sound, score: snd.length ? snd.reduce((a, b) => a + b, 0) / snd.length : null, basis: snd.length ? `driver ${drv ?? "n/a"} mm (linear 6..40), codec ${codec?.value ?? "n/a"} (LDAC/aptX/LHDC=1, other=0.5); spec proxy, not a listening test` : "driver size and codec not found" },
    { name: "anc", weight: w.anc, score: anc ? (/^yes/i.test(String(anc.value)) ? 1 : 0) : null, basis: anc ? `ANC: ${anc.value}` : "ANC not stated" },
    { name: "battery", weight: w.battery, score: bat === null ? null : linear(bat, 10, 60), basis: bat === null ? "battery hours not found" : `${bat} h claimed playback, linear 10..60` },
    { name: "mic", weight: w.mic, score: mic ? (/enc|quad|4[- ]?mic|6[- ]?mic|environmental/i.test(String(mic.value)) ? 1 : 0.5) : null, basis: mic ? `mic: ${mic.value} (ENC/multi-mic=1, other=0.5)` : "mic details not found" },
    { name: "latency", weight: w.latency, score: lat === null ? null : linear(200 - lat, 0, 160), basis: lat === null ? "latency not found" : `${lat} ms, linear 200 ms (0) .. 40 ms (1)` },
    { name: "price", weight: w.price, score: p.score, basis: p.basis },
  ];
  return composeScore(comps);
}

function constraints(parsed: ParsedQuery): HardConstraint[] {
  const out = budgetConstraint(parsed);
  if (wantsAnc(parsed)) out.push({ id: "anc", describe: "Active noise cancellation", check: ({ specs }) => { const f = getFact(specs, "anc"); return !f ? "unknown" : /^yes/i.test(String(f.value)) ? "pass" : "fail"; } });
  return out;
}

function extractSpecs(text: string, url: string): SpecFact[] {
  const out: SpecFact[] = [];
  const anc = /\b(?:hybrid\s+)?(?:ANC|active noise cancell?(?:ing|ation))\b/i.exec(text);
  if (anc && !/\bno\s*$/i.test(text.slice(Math.max(0, anc.index - 4), anc.index))) out.push(mk(text, anc, "anc", "ANC", "yes", url));
  const bat = maxMatch(text, /(\d{1,3})\s?\+?\s?(?:hrs?|hours?)\b(?:\s+of)?\s+(?:total\s+)?(?:playback|playtime|battery|music)/i, (m) => parseInt(m[1], 10), (n) => n >= 2 && n <= 150);
  if (bat) out.push(mk(text, bat.m, "battery_hours", "Battery (playback)", bat.n, url, "h"));
  const drv = /(\d{1,2}(?:\.\d)?)\s?mm\s+(?:dynamic\s+|graphene\s+|titanium\s+)?drivers?/i.exec(text);
  if (drv && parseFloat(drv[1]) >= 4 && parseFloat(drv[1]) <= 60) out.push(mk(text, drv, "driver_mm", "Driver", parseFloat(drv[1]), url, "mm"));
  const lat = /(\d{2,3})\s?ms\b[^.\n]{0,20}latency|latency[^.\n]{0,20}?(\d{2,3})\s?ms\b/i.exec(text);
  if (lat) { const n = parseInt(lat[1] ?? lat[2], 10); if (n >= 20 && n <= 400) out.push(mk(text, lat, "latency_ms", "Latency", n, url, "ms")); }
  const bt = /Bluetooth\s?(?:v|version\s?)?([45]\.\d)/i.exec(text);
  if (bt) out.push(mk(text, bt, "bluetooth_version", "Bluetooth", bt[1], url));
  const codec = /\b(LDAC|aptX(?: Adaptive| HD| Lossless)?|LHDC|AAC|SBC)\b/.exec(text);
  if (codec) out.push(mk(text, codec, "codec", "Codec", codec[1], url));
  const mic = /\b(ENC|(?:quad|dual|4|6)[- ]?mics?|environmental noise cancell?(?:ing|ation))\b/i.exec(text);
  if (mic) out.push(mk(text, mic, "mic", "Mic", mic[1], url));
  return out;
}

export const headphonesConfig: CategoryConfig = {
  category: "headphones",
  specKeys: [
    { key: "anc", label: "ANC" }, { key: "battery_hours", label: "Battery (playback)", unit: "h" }, { key: "driver_mm", label: "Driver", unit: "mm" },
    { key: "latency_ms", label: "Latency", unit: "ms" }, { key: "bluetooth_version", label: "Bluetooth" }, { key: "codec", label: "Codec" }, { key: "mic", label: "Mic" },
  ],
  defaultWeights: DEFAULTS,
  featureBoosts: BOOSTS,
  weightsFor: makeWeightsFor(DEFAULTS, BOOSTS),
  constraints,
  score,
  extractSpecs,
};
