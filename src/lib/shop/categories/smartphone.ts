import type { ParsedQuery, SpecFact } from "../types";
import { budgetConstraint, composeScore, getFact, linear, makeWeightsFor, maxMatch, mk, numFact, priceScore, type CategoryConfig, type HardConstraint, type RawComponent } from "./scoring";

/**
 * CHIPSET TIER TABLE (basis: 'tier table'). Coarse relative class 0..1 for chipsets we are certain about.
 * Not a benchmark score. Unknown chipset => performance = null (never guessed).
 */
export const CHIPSET_TIERS: Record<string, number> = {
  "snapdragon 8 elite": 1.0, "snapdragon 8 gen 3": 0.9, "snapdragon 8 gen 2": 0.82, "snapdragon 8 gen 1": 0.72,
  "snapdragon 8s gen 3": 0.8, "snapdragon 7+ gen 3": 0.7, "snapdragon 7 gen 3": 0.6, "snapdragon 7s gen 2": 0.5, "snapdragon 6 gen 1": 0.35,
  "dimensity 9400": 0.98, "dimensity 9300": 0.9, "dimensity 9200": 0.82, "dimensity 8300": 0.65, "dimensity 8200": 0.62,
  "a18 pro": 1.0, a18: 0.95, "a17 pro": 0.92, "a16 bionic": 0.85, "a15 bionic": 0.78,
  "exynos 2400": 0.82, "tensor g4": 0.7, "tensor g3": 0.64,
};
export function chipsetTier(raw: string): number | null {
  const s = raw.toLowerCase().replace(/qualcomm|mobile platform|®|™/g, "").replace(/gen(\d)/, "gen $1").replace(/\s+/g, " ").trim();
  const keys = Object.keys(CHIPSET_TIERS).sort((a, b) => b.length - a.length);
  for (const k of keys) if (new RegExp(`(^|\\s)${k.replace(/[+]/g, "\\+")}(\\s|$)`).test(s)) return CHIPSET_TIERS[k];
  return null;
}

const DEFAULTS = { performance: 0.25, camera: 0.15, battery: 0.15, display: 0.15, software: 0.1, price: 0.2 };
const BOOSTS: Record<string, Record<string, number>> = {
  camera: { camera: 2.5 }, travel: { camera: 1.6, battery: 1.5 }, battery: { battery: 2.5 }, "fast charging": { battery: 1.5 },
  gaming: { performance: 2, display: 1.3, battery: 1.2 }, performance: { performance: 2 }, amoled: { display: 2 }, display: { display: 2 },
};

function score(specs: SpecFact[], ctx: { price: number | null; priceRef: number | null; weights: Record<string, number> }) {
  const w = ctx.weights;
  const chip = getFact(specs, "chipset");
  const tier = chip ? chipsetTier(String(chip.value)) : null;
  const mah = numFact(specs, "battery_mah");
  const mp = numFact(specs, "camera_main_mp");
  const hz = numFact(specs, "refresh_hz");
  const panel = getFact(specs, "display_type");
  const years = numFact(specs, "update_years");
  const dispParts: number[] = [];
  if (hz !== null) dispParts.push(linear(hz, 60, 144));
  if (panel) dispParts.push(/oled/i.test(String(panel.value)) ? 1 : 0.4);
  const p = priceScore(ctx.price, ctx.priceRef);
  const comps: RawComponent[] = [
    { name: "performance", weight: w.performance, score: tier, basis: tier === null ? "chipset unknown or not in tier table" : `tier table: ${chip?.value} (coarse class, not a benchmark)` },
    { name: "camera", weight: w.camera, score: mp === null ? null : linear(mp, 12, 200), basis: mp === null ? "main camera MP not found" : `main sensor ${mp} MP, linear 12..200 MP (coarse proxy; not image quality)` },
    { name: "battery", weight: w.battery, score: mah === null ? null : linear(mah, 3000, 6500), basis: mah === null ? "battery capacity not found" : `${mah} mAh, linear 3000..6500` },
    { name: "display", weight: w.display, score: dispParts.length ? dispParts.reduce((a, b) => a + b, 0) / dispParts.length : null, basis: dispParts.length ? `refresh ${hz ?? "n/a"} Hz (linear 60..144), panel ${panel?.value ?? "n/a"} (OLED/AMOLED=1, other=0.4), averaged` : "refresh rate and panel not found" },
    { name: "software", weight: w.software, score: years === null ? null : linear(years, 2, 7), basis: years === null ? "update policy not found" : `${years} years of updates, linear 2..7` },
    { name: "price", weight: w.price, score: p.score, basis: p.basis },
  ];
  return composeScore(comps);
}

function constraints(parsed: ParsedQuery): HardConstraint[] {
  const out = budgetConstraint(parsed);
  const wants = (f: string) => parsed.preferredFeatures.includes(f);
  if (wants("5g")) out.push({ id: "5g", describe: "5G", check: ({ specs }) => { const f = getFact(specs, "5g"); return !f ? "unknown" : /no|false/i.test(String(f.value)) ? "fail" : "pass"; } });
  if (wants("amoled")) out.push({ id: "amoled", describe: "AMOLED/OLED display", check: ({ specs }) => { const f = getFact(specs, "display_type"); return !f ? "unknown" : /oled/i.test(String(f.value)) ? "pass" : "fail"; } });
  if (parsed.excludedFeatures.includes("amoled")) out.push({ id: "no_amoled", describe: "no AMOLED", check: ({ specs }) => { const f = getFact(specs, "display_type"); return !f ? "unknown" : /oled/i.test(String(f.value)) ? "fail" : "pass"; } });
  if (parsed.variant.ramGb !== null) { const need = parsed.variant.ramGb; out.push({ id: "ram_min", describe: `RAM >= ${need} GB`, check: ({ specs }) => { const n = numFact(specs, "ram_gb"); return n === null ? "unknown" : n >= need ? "pass" : "fail"; } }); }
  if (parsed.variant.storageGb !== null) { const need = parsed.variant.storageGb; out.push({ id: "storage_min", describe: `storage >= ${need} GB`, check: ({ specs }) => { const n = numFact(specs, "storage_gb"); return n === null ? "unknown" : n >= need ? "pass" : "fail"; } }); }
  return out;
}

/** RAM and storage report the MAXIMUM configuration found (so min-requirement constraints never fail a model that offers the size). */
function extractSpecs(text: string, url: string): SpecFact[] {
  const out: SpecFact[] = [];
  const bat = maxMatch(text, /(\d[\d,]{3,5})\s?mAh/i, (m) => parseInt(m[1].replace(/,/g, ""), 10), (n) => n >= 2000 && n <= 10000);
  if (bat) out.push(mk(text, bat.m, "battery_mah", "Battery", bat.n, url, "mAh"));
  const ram = maxMatch(text, /(\d{1,2})\s?GB\s+(?:of\s+)?(?:LPDDR\w*\s+)?RAM|RAM[:\s]+(\d{1,2})\s?GB/i, (m) => parseInt(m[1] ?? m[2], 10), (n) => n >= 2 && n <= 24);
  if (ram) out.push(mk(text, ram.m, "ram_gb", "RAM", ram.n, url, "GB"));
  const sto = maxMatch(text, /(\d{2,4})\s?GB\s+(?:internal\s+)?(?:storage|UFS\s?\d?\.?\d?|ROM)/i, (m) => parseInt(m[1], 10), (n) => n >= 32 && n <= 2048);
  if (sto) out.push(mk(text, sto.m, "storage_gb", "Storage", sto.n, url, "GB"));
  const hz = maxMatch(text, /(\d{2,3})\s?Hz/i, (m) => parseInt(m[1], 10), (n) => n >= 60 && n <= 240);
  if (hz) out.push(mk(text, hz.m, "refresh_hz", "Refresh rate", hz.n, url, "Hz"));
  const disp = /\b(Super AMOLED|Dynamic AMOLED(?: 2X)?|LTPO AMOLED|AMOLED|P-OLED|OLED|IPS LCD|LCD|Liquid Retina)\b/i.exec(text);
  if (disp) out.push(mk(text, disp, "display_type", "Display panel", disp[1], url));
  const cam = /(\d{2,3})\s?MP\s*\(?(?:main|primary|wide)/i.exec(text) ?? /(?:main|primary)\s+(?:camera\s+)?(?:\w+\s+){0,2}?(\d{2,3})\s?MP/i.exec(text);
  if (cam && parseInt(cam[1], 10) >= 8) out.push(mk(text, cam, "camera_main_mp", "Main camera", parseInt(cam[1], 10), url, "MP"));
  const chip = /(Snapdragon\s+8\s+(?:Elite|Gen\s?\d)|Snapdragon\s+8s\s+Gen\s?\d|Snapdragon\s+\d\+?\s+Gen\s?\d|Dimensity\s+\d{4}|Exynos\s+\d{4}|Tensor\s+G\d|A1\d\s+(?:Pro|Bionic)|A1\d\b)/i.exec(text);
  if (chip) out.push(mk(text, chip, "chipset", "Chipset", chip[1], url));
  const yrs = /(\d)\s+years?\s+of\s+(?:OS|software|security|Android|updates?)/i.exec(text);
  if (yrs) out.push(mk(text, yrs, "update_years", "Software updates", parseInt(yrs[1], 10), url, "years"));
  const g5 = /\b5G\b/.exec(text);
  if (g5) out.push(mk(text, g5, "5g", "5G", "yes", url));
  return out;
}

export const smartphoneConfig: CategoryConfig = {
  category: "smartphone",
  specKeys: [
    { key: "chipset", label: "Chipset" }, { key: "ram_gb", label: "RAM", unit: "GB" }, { key: "storage_gb", label: "Storage", unit: "GB" },
    { key: "battery_mah", label: "Battery", unit: "mAh" }, { key: "display_type", label: "Display panel" }, { key: "refresh_hz", label: "Refresh rate", unit: "Hz" },
    { key: "camera_main_mp", label: "Main camera", unit: "MP" }, { key: "update_years", label: "Software updates", unit: "years" }, { key: "5g", label: "5G" },
  ],
  defaultWeights: DEFAULTS,
  featureBoosts: BOOSTS,
  weightsFor: makeWeightsFor(DEFAULTS, BOOSTS),
  constraints,
  score,
  extractSpecs,
};
