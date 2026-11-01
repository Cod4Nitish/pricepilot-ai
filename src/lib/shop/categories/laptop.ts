import type { ParsedQuery, SpecFact } from "../types";
import { budgetConstraint, clamp01, composeScore, getFact, linear, makeWeightsFor, maxMatch, mk, numFact, priceScore, type CategoryConfig, type HardConstraint, type RawComponent } from "./scoring";

/** GPU tier table (basis: 'tier table'): laptop RTX/GTX by model number; wattage/variant not considered. Unknown => null. */
export const GPU_TIERS: Record<string, number> = {
  "rtx 5090": 1.0, "rtx 5080": 0.95, "rtx 5070": 0.85, "rtx 5060": 0.72, "rtx 5050": 0.6,
  "rtx 4090": 1.0, "rtx 4080": 0.93, "rtx 4070": 0.8, "rtx 4060": 0.66, "rtx 4050": 0.55,
  "rtx 3080": 0.8, "rtx 3070": 0.7, "rtx 3060": 0.55, "rtx 3050": 0.42, "gtx 1650": 0.3,
};
export function gpuTier(raw: string): number | null {
  const s = raw.toLowerCase().replace(/\s+/g, " ");
  const m = /(rtx|gtx)\s?(\d{4})/.exec(s);
  if (m) return GPU_TIERS[`${m[1]} ${m[2]}`] ?? null;
  if (/integrated|iris xe|uhd graphics|radeon graphics|intel graphics/.test(s)) return 0.1;
  return null;
}
const FAMILY: Record<number, number> = { 3: 0.3, 5: 0.55, 7: 0.75, 9: 0.9 };
/** CPU tier by family class only (generation not considered). */
export function cpuTier(raw: string): number | null {
  const s = raw.toLowerCase();
  let m = /core ultra ([579])/.exec(s);
  if (m) return ({ 5: 0.6, 7: 0.8, 9: 0.95 } as Record<number, number>)[Number(m[1])];
  m = /(?:core )?i([3579])[- ]\d/.exec(s) ?? /core i([3579])\b/.exec(s);
  if (m) return FAMILY[Number(m[1])];
  m = /ryzen ([3579])\b/.exec(s);
  if (m) return FAMILY[Number(m[1])];
  m = /\bm([1-4])(?:\s(pro|max))?\b/.exec(s);
  if (m) return clamp01(({ 1: 0.6, 2: 0.68, 3: 0.76, 4: 0.85 } as Record<number, number>)[Number(m[1])] + (m[2] === "max" ? 0.12 : m[2] === "pro" ? 0.07 : 0));
  return null;
}

const DEFAULTS = { cpu: 0.18, gpu: 0.17, ram: 0.14, storage: 0.09, display: 0.09, upgradeability: 0.05, battery: 0.08, portability: 0.06, price: 0.14 };
const BOOSTS: Record<string, Record<string, number>> = {
  gaming: { gpu: 2.5, cpu: 1.3, display: 1.4, portability: 0.6 }, coding: { cpu: 1.5, ram: 1.6, display: 1.2, upgradeability: 1.3 },
  "video editing": { cpu: 1.5, gpu: 1.6, ram: 1.5, display: 1.5, storage: 1.3 }, lightweight: { portability: 3, battery: 1.5 },
  travel: { portability: 2.5, battery: 2 }, battery: { battery: 2.5 }, display: { display: 2 }, amoled: { display: 2 }, student: { price: 1.5, portability: 1.5, battery: 1.3 },
};

function score(specs: SpecFact[], ctx: { price: number | null; priceRef: number | null; weights: Record<string, number> }) {
  const w = ctx.weights;
  const cpu = getFact(specs, "cpu"), gpu = getFact(specs, "gpu");
  const cpuT = cpu ? cpuTier(String(cpu.value)) : null;
  const gpuT = gpu ? gpuTier(String(gpu.value)) : null;
  const ram = numFact(specs, "ram_gb"), sto = numFact(specs, "storage_gb"), hz = numFact(specs, "refresh_hz");
  const panel = getFact(specs, "display_type"), wh = numFact(specs, "battery_wh"), kg = numFact(specs, "weight_kg"), up = getFact(specs, "ram_upgradable");
  const disp: number[] = [];
  if (hz !== null) disp.push(linear(hz, 60, 165));
  if (panel) disp.push(/oled/i.test(String(panel.value)) ? 1 : 0.5);
  const p = priceScore(ctx.price, ctx.priceRef);
  const comps: RawComponent[] = [
    { name: "cpu", weight: w.cpu, score: cpuT, basis: cpuT === null ? "CPU unknown or unrecognised" : `tier table by family: ${cpu?.value} (generation not considered)` },
    { name: "gpu", weight: w.gpu, score: gpuT, basis: gpuT === null ? "GPU unknown or not in tier table" : `tier table by model number: ${gpu?.value} (wattage not considered)` },
    { name: "ram", weight: w.ram, score: ram === null ? null : linear(ram, 4, 32), basis: ram === null ? "RAM not found" : `${ram} GB, linear 4..32` },
    { name: "storage", weight: w.storage, score: sto === null ? null : linear(sto, 128, 1024), basis: sto === null ? "storage not found" : `${sto} GB, linear 128..1024` },
    { name: "display", weight: w.display, score: disp.length ? disp.reduce((a, b) => a + b, 0) / disp.length : null, basis: disp.length ? `refresh ${hz ?? "n/a"} Hz (linear 60..165), panel ${panel?.value ?? "n/a"} (OLED=1, other=0.5)` : "refresh rate and panel not found" },
    { name: "upgradeability", weight: w.upgradeability, score: up ? (/^yes/i.test(String(up.value)) ? 1 : 0) : null, basis: up ? `RAM upgradable: ${up.value}` : "upgradeability not stated" },
    { name: "battery", weight: w.battery, score: wh === null ? null : linear(wh, 40, 90), basis: wh === null ? "battery Wh not found" : `${wh} Wh, linear 40..90 (capacity only, not runtime)` },
    { name: "portability", weight: w.portability, score: kg === null ? null : linear(2.8 - kg, 0, 1.6), basis: kg === null ? "weight not found" : `${kg} kg, linear 2.8 kg (0) .. 1.2 kg (1)` },
    { name: "price", weight: w.price, score: p.score, basis: p.basis },
  ];
  return composeScore(comps);
}

function seriesNum(raw: string | null): { series: string; n: number } | null {
  const m = raw ? /(rtx|gtx|rx)\s?(\d{3,4})/i.exec(raw) : null;
  return m ? { series: m[1].toLowerCase(), n: parseInt(m[2], 10) } : null;
}

function constraints(parsed: ParsedQuery): HardConstraint[] {
  const out = budgetConstraint(parsed);
  const need = seriesNum(parsed.variant.gpu);
  if (need) {
    out.push({
      id: "gpu_min",
      describe: `${parsed.variant.gpu} or better`,
      check: ({ specs }) => {
        const f = getFact(specs, "gpu");
        if (!f) return "unknown";
        const have = seriesNum(String(f.value));
        if (!have) return "fail"; // integrated / unrecognised GPU when a discrete one was required
        return have.series === need.series && have.n < need.n ? "fail" : "pass";
      },
    });
  }
  if (parsed.variant.ramGb !== null) { const r = parsed.variant.ramGb; out.push({ id: "ram_min", describe: `RAM >= ${r} GB`, check: ({ specs }) => { const n = numFact(specs, "ram_gb"); return n === null ? "unknown" : n >= r ? "pass" : "fail"; } }); }
  if (parsed.variant.storageGb !== null) { const r = parsed.variant.storageGb; out.push({ id: "storage_min", describe: `storage >= ${r} GB`, check: ({ specs }) => { const n = numFact(specs, "storage_gb"); return n === null ? "unknown" : n >= r ? "pass" : "fail"; } }); }
  if (parsed.preferredFeatures.includes("amoled")) out.push({ id: "amoled", describe: "OLED/AMOLED display", check: ({ specs }) => { const f = getFact(specs, "display_type"); return !f ? "unknown" : /oled/i.test(String(f.value)) ? "pass" : "fail"; } });
  return out;
}

function extractSpecs(text: string, url: string): SpecFact[] {
  const out: SpecFact[] = [];
  const cpu = /(Core Ultra [579]\s?\d{3}\w*|Core i[3579][- ]\d{4,5}\w*|Ryzen [3579] \d{4}\w*|Apple M[1-4](?: Pro| Max)?)/i.exec(text);
  if (cpu) out.push(mk(text, cpu, "cpu", "CPU", cpu[1], url));
  const gpu = /(RTX\s?\d{4}(?:\s?Ti)?|GTX\s?\d{4}|Radeon RX \d{4}\w*|Iris Xe)/i.exec(text);
  if (gpu) out.push(mk(text, gpu, "gpu", "GPU", gpu[1], url));
  const ram = maxMatch(text, /(\d{1,2})\s?GB\s+(?:of\s+)?(?:DDR\d\w*\s+|LPDDR\w*\s+)?RAM|RAM[:\s]+(\d{1,2})\s?GB/i, (m) => parseInt(m[1] ?? m[2], 10), (n) => n >= 4 && n <= 128);
  if (ram) out.push(mk(text, ram.m, "ram_gb", "RAM", ram.n, url, "GB"));
  const sto = maxMatch(text, /(\d{3,4})\s?GB\s+(?:NVMe\s+|PCIe\s+)?SSD|(\d)\s?TB\s+(?:NVMe\s+|PCIe\s+)?SSD/i, (m) => (m[1] ? parseInt(m[1], 10) : parseInt(m[2], 10) * 1024), (n) => n >= 128);
  if (sto) out.push(mk(text, sto.m, "storage_gb", "Storage", sto.n, url, "GB"));
  const hz = maxMatch(text, /(\d{2,3})\s?Hz/i, (m) => parseInt(m[1], 10), (n) => n >= 60 && n <= 360);
  if (hz) out.push(mk(text, hz.m, "refresh_hz", "Refresh rate", hz.n, url, "Hz"));
  const disp = /\b(OLED|AMOLED|IPS|Mini[- ]LED|TN)\b/.exec(text);
  if (disp) out.push(mk(text, disp, "display_type", "Display panel", disp[1], url));
  const wh = /(\d{2,3})\s?Wh\b/i.exec(text);
  if (wh) out.push(mk(text, wh, "battery_wh", "Battery", parseInt(wh[1], 10), url, "Wh"));
  const kg = /(\d(?:\.\d{1,2})?)\s?kg\b/i.exec(text);
  if (kg && parseFloat(kg[1]) >= 0.7 && parseFloat(kg[1]) <= 4) out.push(mk(text, kg, "weight_kg", "Weight", parseFloat(kg[1]), url, "kg"));
  const up = /(?:upgrad(?:e)?able|expandable)[^.\n]{0,20}RAM|RAM[^.\n]{0,20}(?:upgrad(?:e)?able|expandable)/i.exec(text);
  const sol = /soldered[^.\n]{0,15}RAM|RAM[^.\n]{0,15}soldered|onboard RAM/i.exec(text);
  if (up) out.push(mk(text, up, "ram_upgradable", "RAM upgradable", "yes", url));
  else if (sol) out.push(mk(text, sol, "ram_upgradable", "RAM upgradable", "no", url));
  return out;
}

export const laptopConfig: CategoryConfig = {
  category: "laptop",
  specKeys: [
    { key: "cpu", label: "CPU" }, { key: "gpu", label: "GPU" }, { key: "ram_gb", label: "RAM", unit: "GB" }, { key: "storage_gb", label: "Storage", unit: "GB" },
    { key: "display_type", label: "Display panel" }, { key: "refresh_hz", label: "Refresh rate", unit: "Hz" }, { key: "battery_wh", label: "Battery", unit: "Wh" },
    { key: "weight_kg", label: "Weight", unit: "kg" }, { key: "ram_upgradable", label: "RAM upgradable" },
  ],
  defaultWeights: DEFAULTS,
  featureBoosts: BOOSTS,
  weightsFor: makeWeightsFor(DEFAULTS, BOOSTS),
  constraints,
  score,
  extractSpecs,
};
