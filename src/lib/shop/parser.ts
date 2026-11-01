// QueryParser: free-text (Indian English / Hindi / Hinglish) -> ParsedQuery.
// Deterministic first; optional Claude Haiku refinement only when confidence < 0.6 and a key is set.
import { z } from "zod";
import { validateRetailerUrl } from "@/lib/ssrf";
import type { Category, ParsedQuery, SearchIntent } from "./types";

// ---------------- dictionaries ----------------

const BRANDS: Record<string, string> = {
  samsung: "Samsung", apple: "Apple", oneplus: "OnePlus", xiaomi: "Xiaomi", redmi: "Redmi", realme: "Realme", poco: "Poco",
  vivo: "Vivo", oppo: "Oppo", motorola: "Motorola", moto: "Motorola", nothing: "Nothing", google: "Google", iqoo: "iQOO",
  asus: "Asus", lenovo: "Lenovo", hp: "HP", dell: "Dell", acer: "Acer", msi: "MSI", sony: "Sony", lg: "LG", boat: "boAt",
  jbl: "JBL", infinix: "Infinix", tecno: "Tecno", lava: "Lava", honor: "Honor", nokia: "Nokia", huawei: "Huawei",
  bose: "Bose", noise: "Noise", fastrack: "Fastrack", garmin: "Garmin", canon: "Canon", nikon: "Nikon", gopro: "GoPro",
  whirlpool: "Whirlpool", godrej: "Godrej", panasonic: "Panasonic", haier: "Haier", voltas: "Voltas", tcl: "TCL", mi: "Xiaomi",
};
// product-line words that imply a brand
const BRAND_ALIASES: Record<string, string> = {
  iphone: "Apple", ipad: "Apple", macbook: "Apple", airpods: "Apple", galaxy: "Samsung", pixel: "Google",
  thinkpad: "Lenovo", ideapad: "Lenovo", legion: "Lenovo", loq: "Lenovo", yoga: "Lenovo",
  vivobook: "Asus", zenbook: "Asus", rog: "Asus", tuf: "Asus", pavilion: "HP", omen: "HP", victus: "HP", envy: "HP",
  inspiron: "Dell", xps: "Dell", alienware: "Dell", latitude: "Dell", nitro: "Acer", predator: "Acer", aspire: "Acer", swift: "Acer",
  airdopes: "boAt", rockerz: "boAt", bassheads: "boAt",
};
const CATEGORY_WORDS: Record<string, Category> = {
  phone: "smartphone", phones: "smartphone", mobile: "smartphone", mobiles: "smartphone", smartphone: "smartphone", smartphones: "smartphone",
  iphone: "smartphone", galaxy: "smartphone", pixel: "smartphone", redmi: "smartphone", realme: "smartphone", poco: "smartphone",
  laptop: "laptop", laptops: "laptop", notebook: "laptop", macbook: "laptop", thinkpad: "laptop", ideapad: "laptop", vivobook: "laptop",
  zenbook: "laptop", inspiron: "laptop", pavilion: "laptop", victus: "laptop", loq: "laptop", legion: "laptop",
  headphone: "headphones", headphones: "headphones", earbuds: "headphones", earphones: "headphones", tws: "headphones", airpods: "headphones",
  neckband: "headphones", airdopes: "headphones", earbud: "headphones", earphone: "headphones", headset: "headphones", headsets: "headphones", tv: "tv", tvs: "tv", television: "tv", televisions: "tv", purifier: "appliance", tablet: "tablet", tablets: "tablet", ipad: "tablet",
  smartwatch: "smartwatch", smartwatches: "smartwatch", watch: "smartwatch", dslr: "camera", mirrorless: "camera", gopro: "camera",
  fridge: "appliance", refrigerator: "appliance", ac: "appliance", microwave: "appliance", geyser: "appliance", "washing machine": "appliance",
};
const FEATURE_VOCAB = [
  "phone", "phones", "mobile", "smartphone", "laptop", "laptops", "headphones", "earbuds", "tablet", "smartwatch", "television",
  "camera", "battery", "gaming", "coding", "editing", "display", "lightweight", "travel", "travelling", "budget", "student", "performance",
  "charging", "processor", "storage", "amoled",
];
const BRAND_VOCAB = [...Object.keys(BRANDS), ...Object.keys(BRAND_ALIASES), "galaxy", "iphone", "macbook", "thinkpad"].filter((w) => w.length >= 4);
const TYPO_VOCAB = Array.from(new Set([...BRAND_VOCAB, ...FEATURE_VOCAB]));
// ordinary English words that must never be "corrected" into the dictionaries
const COMMON = new Set(
  "best good great with without under below above over about around between from that this have need want like some your more less nothing after before price prices cheap latest budget bottle better camera cameras phone phones watch watches games game online india indian buying looking should could would which where there their other series review reviews value money right tablet".split(" "),
);

// ---------------- helpers ----------------

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function fixTypos(text: string, corrections: { from: string; to: string }[]): string {
  return text.replace(/[a-z]{4,}/g, (w) => {
    if (COMMON.has(w) || TYPO_VOCAB.includes(w) || HINGLISH_WORDS.has(w) || SAFE_WORDS.has(w)) return w;
    const maxD = w.length >= 7 ? 2 : 1;
    let best: string | null = null, bestD = 99, tie = false;
    for (const v of TYPO_VOCAB) {
      if (v[0] !== w[0] || Math.abs(v.length - w.length) > maxD) continue;
      const d = editDistance(w, v);
      if (d <= maxD) {
        if (d < bestD) { best = v; bestD = d; tie = false; } else if (d === bestD) tie = true;
      }
    }
    if (!best || tie) return w;
    corrections.push({ from: w, to: best });
    return best;
  });
}
const SAFE_WORDS = new Set("pro max plus ultra lite note edge nord flip fold laptop gaming black white blue green red silver gold grey gray titanium refurbished renewed brand sealed model series watts inch inches rupees rupaye".split(" "));

const HINGLISH_WORDS = new Set(
  "sasta sasti sabse accha acha achha badhiya andar ander tak hazaar hazar chahiye mujhe dikhao dikha batao kam neeche niche upar zyada jyada wala wali kaun konsa kaunsa behtar ya ke ka ki mein me hai".split(" "),
);
const HINGLISH_DISTINCT = /\b(sasta|sasti|sabse|accha|acha|achha|badhiya|hazaar|hazar|andar|ander|chahiye|mujhe|dikhao|dikha|batao|neeche|niche|zyada|jyada|behtar|kaunsa|konsa|ke liye|ke andar|se kam|tak)\b/i;
const DEVANAGARI = /[ऀ-ॿ]/;
const DEV_MAP: [RegExp, string][] = [
  [/सस्ता|सस्ती/g, " sasta "], [/सबसे अच्छा|सबसे अच्छी|बढ़िया/g, " best "], [/फोन|मोबाइल/g, " phone "], [/लैपटॉप/g, " laptop "],
  [/के अंदर|के अन्दर/g, " ke andar "], [/से कम/g, " se kam "], [/तक/g, " tak "], [/हज़ार|हजार/g, " hazaar "], [/लाख/g, " lakh "],
  [/चाहिए/g, " chahiye "], [/या/g, " ya "],
];

const COLORS = ["black", "white", "blue", "green", "red", "silver", "gold", "grey", "gray", "titanium", "purple", "pink", "yellow", "orange", "cream", "lavender", "violet", "graphite", "midnight", "starlight"];

const FEATURES: { name: string; re: RegExp }[] = [
  { name: "camera", re: /\b(camera|cameras|photography|photos?|selfie|photographer)\b/ },
  { name: "battery", re: /\b(battery|backup|mah|long[- ]lasting)\b/ },
  { name: "gaming", re: /\b(gaming|gamer|bgmi|games?)\b/ },
  { name: "coding", re: /\b(coding|programming|programmer|developer|development)\b/ },
  { name: "video editing", re: /\b(video editing|editing|editor|rendering)\b/ },
  { name: "amoled", re: /\b(amoled|oled)\b/ },
  { name: "display", re: /\b(display|screen)\b/ },
  { name: "lightweight", re: /\b(lightweight|light[- ]weight|light|portable|thin)\b/ },
  { name: "travel", re: /\b(travel|travelling|traveling|trip|vacation)\b/ },
  { name: "5g", re: /\b5g\b/ },
  { name: "fast charging", re: /\b(fast charging|fast charge|quick charge)\b/ },
  { name: "performance", re: /\b(performance|fast|powerful|flagship)\b/ },
  { name: "student", re: /\b(student|college|school)\b/ },
];

const REC_WORDS = /\b(best|good|great|top|recommend(?:ed|ation)?s?|suggest(?:ion)?s?|which|better|worth|accha|badhiya|behtar|should i (?:buy|get))\b/;

// ---------------- amounts ----------------

const BUDGET_CTX = /(?:under|below|upto|up to|within|around|about|budget(?: of)?|max(?:imum)?|less than|between|above|over|more than|min(?:imum)?|from|and|to|<=?|>=?|~|-|₹)\s*$/;
const AFTER_CTX = /^\s*(?:tak|ke andar|ke ander|andar|se kam|ke neeche|ke niche|ke upar|se zyada|se jyada)/;

/** 50k -> 50000, 1.2 lakh -> 120000, 50 hazaar -> 50000, 10,000 -> 10000. Leaves 4k tv / 256 gb alone. */
export function convertAmounts(input: string): string {
  let t = input.replace(/(₹|\brs\.?|\binr)\s*(?=\d)/gi, "").replace(/(\d)\s*(rupees?|rupaye|rs\b|inr\b)/gi, "$1 ");
  t = t.replace(/\b\d{1,3}(?:,\d{2,3})+\b/g, (m) => m.replace(/,/g, ""));
  return t.replace(/(\d+(?:\.\d+)?)\s?(k|lakhs?|lacs?|lac|hazaar|hazar|thousand|l)\b(?!\s?(?:tv|display|video|uhd|resolution|camera|recording|ltr|litre))/gi, (m, num: string, suf: string, off: number, str: string) => {
    const s = suf.toLowerCase();
    const n = parseFloat(num);
    const before = str.slice(Math.max(0, off - 24), off).toLowerCase();
    const ctx = BUDGET_CTX.test(before) || AFTER_CTX.test(str.slice(off + m.length));
    if (/^(lakh|lakhs|lac|lacs|hazaar|hazar|thousand)$/.test(s)) return String(Math.round(n * (s.startsWith("l") ? 100000 : 1000)));
    if (s === "k") return n >= 10 || ctx ? String(Math.round(n * 1000)) : m;
    if (s === "l") return ctx ? String(Math.round(n * 100000)) : m;
    return m;
  });
}

const N = String.raw`(\d+(?:\.\d+)?)`;
const NOT_UNIT = String.raw`(?!\s*(?:gb|tb|mah|mp|inch|inches|hz|w\b|watt|kg|mm|"|x\b))`;
interface BudgetRule { re: RegExp; kind: "range" | "max" | "min" | "around" }
const BUDGET_RULES: BudgetRule[] = [
  { kind: "range", re: new RegExp(String.raw`\b(?:between|from)\s+${N}\s*(?:and|to|-)\s*${N}${NOT_UNIT}`, "g") },
  { kind: "range", re: new RegExp(String.raw`\b${N}\s*(?:-|to)\s*${N}${NOT_UNIT}\s*(?:budget|range|rupees)?`, "g") },
  { kind: "around", re: new RegExp(String.raw`(?:\baround|\bapprox(?:imately)?|\babout|\bnear|\broughly|~)\s*${N}${NOT_UNIT}`, "g") },
  { kind: "max", re: new RegExp(String.raw`(?:\bunder|\bbelow|\bupto|\bup to|\bwithin|\bless than|\blesser than|\bmax(?:imum)?|\bbudget(?: of)?|\bnot more than|\bat most|<=?)\s*${N}${NOT_UNIT}`, "g") },
  { kind: "max", re: new RegExp(String.raw`\b${N}${NOT_UNIT}\s*(?:tak|ke andar|ke ander|andar|se kam|ke neeche|ke niche|or less|and below|or below)\b`, "g") },
  { kind: "min", re: new RegExp(String.raw`(?:\babove|\bover|\bmore than|\bmin(?:imum)?|\bat least|\bstarting from|>=?)\s*${N}${NOT_UNIT}`, "g") },
  { kind: "min", re: new RegExp(String.raw`\b${N}${NOT_UNIT}\s*(?:se zyada|se jyada|ke upar|or more|and above|\+\s)`, "g") },
];

export function extractBudget(text: string): { min: number | null; max: number | null; stripped: string } {
  let min: number | null = null, max: number | null = null;
  let stripped = text;
  for (const rule of BUDGET_RULES) {
    stripped = stripped.replace(rule.re, (m: string, a: string, b?: string) => {
      const x = parseFloat(a);
      if (!(x >= 500)) return m; // ignore small numbers (kg, years, ...)
      if (rule.kind === "range") {
        const y = parseFloat(b as string);
        if (!(y >= 500)) return m;
        min = Math.min(x, y); max = Math.max(x, y);
      } else if (rule.kind === "around") {
        min = Math.round(x * 0.9); max = Math.round(x * 1.1);
      } else if (rule.kind === "max") max = x;
      else min = x;
      return " ";
    });
  }
  return { min, max, stripped: stripped.replace(/\s+/g, " ").trim() };
}

// ---------------- variant ----------------

export function extractVariant(text: string): ParsedQuery["variant"] {
  let ramGb: number | null = null, storageGb: number | null = null;
  const toGb = (n: string, u: string) => (u.toLowerCase() === "tb" ? Math.round(parseFloat(n) * 1024) : parseFloat(n));
  const pair = /\b(\d{1,2})\s*(?:gb)?\s*[+/]\s*(\d{2,4})\s*gb\b/.exec(text); // 8/256 gb, 8+128gb
  if (pair) { ramGb = parseInt(pair[1], 10); storageGb = parseInt(pair[2], 10); }
  const re = /\b(\d+(?:\.\d+)?)\s?(gb|tb)\b(?:\s+(ram|memory|ddr\d|ssd|storage|rom|hdd|nvme))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const v = toGb(m[1], m[2]);
    const tag = (m[3] ?? "").toLowerCase();
    const prefix = text.slice(Math.max(0, m.index - 8), m.index);
    if (tag === "ram" || tag === "memory" || tag.startsWith("ddr") || /ram\s*$/.test(prefix)) ramGb ??= v;
    else if (["ssd", "storage", "rom", "hdd", "nvme"].includes(tag) || /(ssd|storage)\s*$/.test(prefix)) storageGb ??= v;
    else if (m[2].toLowerCase() === "tb" || v >= 64) storageGb ??= v;
    else if ([2, 3, 4, 6, 8, 12, 16, 18, 24, 32].includes(v)) ramGb ??= v;
  }
  const gpu = /\b(rtx|gtx|rx)\s?(\d{3,4})(\s?(?:ti|super|xt))?\b/.exec(text);
  const scr = /\b(\d{2}(?:\.\d)?)\s?(?:inch|inches|in\b|")/.exec(text);
  const color = COLORS.find((c) => new RegExp(`\\b${c}\\b`).test(text)) ?? null;
  const condition: "new" | "refurbished" | "unknown" = /\b(refurbished|renewed|pre[- ]owned)\b/.test(text) ? "refurbished" : /\b(brand new|sealed)\b/.test(text) ? "new" : "unknown";
  return {
    storageGb, ramGb, color,
    gpu: gpu ? `${gpu[1].toUpperCase()} ${gpu[2]}${gpu[3] ? " " + gpu[3].trim().toUpperCase() : ""}` : null,
    screenInch: scr ? parseFloat(scr[1]) : null,
    condition,
  };
}

// ---------------- normalization ----------------

function expandAbbreviations(t: string): string {
  let s = t;
  s = s.replace(/\brtx\s?(\d{3,4})\b/g, "rtx $1").replace(/\bgtx\s?(\d{3,4})\b/g, "gtx $1");
  // samsung shorthand: s24 / s24+ / s24 ultra / a55 -> galaxy ...
  if (!/\bgalaxy\b/.test(s) && !/\b(iphone|pixel|oneplus|redmi|poco|realme|nothing|vivo|oppo|iqoo|moto|motorola)\b/.test(s)) {
    s = s.replace(/\bs(\d{2})(\+|\s?plus|\s?ultra|\s?fe)?(?![\w])/g, (_m, d: string, sfx?: string) => `galaxy s${d}${sfx ? (sfx.trim() === "+" ? " plus" : " " + sfx.trim()) : ""}`);
    s = s.replace(/\b([am])(\d{2})\b(?!\s?(?:gb|tb|mp|hz|k\b))/g, (_m, l: string, d: string) => (parseInt(d, 10) >= 5 ? `galaxy ${l}${d}` : _m));
  }
  s = s.replace(/\bsamsung\s+(s\d{2})\b/g, "samsung galaxy $1").replace(/\bsamsung\s+([am]\d{2})\b/g, "samsung galaxy $1");
  s = s.replace(/\bgalaxy galaxy\b/g, "galaxy");
  s = s.replace(/\b(\d+)\s?g\b(?!b)/g, (m, n: string) => (n === "5" || n === "4" ? `${n}g` : m));
  s = s.replace(/\b(\d+)\s+(gb|tb)\b/g, "$1$2");
  s = s.replace(/\bmbp\b/g, "macbook pro").replace(/\bmba\b/g, "macbook air");
  return s;
}

function mapHinglish(t: string): string {
  let s = t;
  s = s.replace(/\bsabse (?:accha|acha|achha|badhiya|behtar)\b/g, "best").replace(/\b(?:accha|acha|achha|badhiya)\b/g, "good");
  s = s.replace(/\b(?:sasta|sasti)\b/g, "cheap").replace(/\bmobile\b/g, "phone");
  s = s.replace(/\b(?:mujhe|chahiye|dikhao|dikha do|batao|dhundo)\b/g, " ").replace(/\bke liye\b/g, "for").replace(/\bke andar\b|\bke ander\b/g, "ke andar");
  return s;
}

const NOISE_TOKENS = new Set(["a", "an", "the", "me", "please", "plz"]);
function cleanSpaces(s: string): string {
  return s.replace(/[“”"']/g, (c) => (c === '"' ? '"' : "")).replace(/[,;!?]+/g, " ").replace(/\s+/g, " ").trim();
}

const FILLER = new RegExp(
  String.raw`\b(?:please|plz|show me|find me|get me|give me|i need a|i need|i want a|i want|i am looking for a|i am looking for|looking for a|looking for|need a|want a|price of|price|prices|cost|buy|online|in india|india|deliver(?:y)? to|delivery|pincode|pin|for me|which is|what is the|suggest|recommend|recommended|best|good|great|top|cheap|ke andar|tak|se kam|with|for|and|under|below)\b`,
  "g",
);

/** Strip budget / pincode / filler words, leaving the product-ish core ("samsung galaxy s24 256gb"). */
export function coreQuery(normalized: string): string {
  const b = extractBudget(normalized).stripped;
  return b.replace(/\b[1-9]\d{5}\b/g, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim();
}

function titleCase(s: string): string {
  return s.split(" ").filter(Boolean).map((w) => (/\d/.test(w) || w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
}

interface ModelInfo { brand: string | null; model: string | null; hasModel: boolean; modelLike: boolean }
const SPEC_TOKEN = /^(?:\d+(?:gb|tb|mah|mp|hz|w|g|k|inch|kg|mm)|\d+x\d+|(?:i[3579])|m[1-4]|r[3579]|rtx|gtx)$/;
const CPU_GPU_TOKEN = /^(?:rtx|gtx|rx|ryzen|core|i[3579](?:-\d+\w*)?|m[1-4]|r[3579]|intel|amd|nvidia|snapdragon|dimensity|ram|ssd|gb|tb|hz)$/;
const STOP = new Set("best good great top for with under below above and or the a an in of to me cheap latest new buy price phone phones laptop laptops mobile smartphone gaming coding travel travelling camera battery display video editing amoled lightweight student performance 5g online india".split(" "));

function detectModel(core: string, variantStripped: string): ModelInfo {
  const tokens = variantStripped.split(" ").filter(Boolean);
  let brand: string | null = null;
  const used = new Set<number>();
  tokens.forEach((tk, i) => {
    if (!brand && BRANDS[tk]) { brand = BRANDS[tk]; used.add(i); }
  });
  if (!brand) {
    for (const tk of tokens) if (BRAND_ALIASES[tk]) { brand = BRAND_ALIASES[tk]; break; }
  }
  const aliasLine = tokens.some((tk) => BRAND_ALIASES[tk] && /^(macbook|ipad)$/.test(tk));
  const rest = tokens.filter((tk, i) => !used.has(i) && !STOP.has(tk) && (aliasLine && /^m[1-4]$/.test(tk) ? true : !SPEC_TOKEN.test(tk) && !CPU_GPU_TOKEN.test(tk)) && !COLORS.includes(tk));
  const digitTok = rest.filter((tk) => /\d/.test(tk) && !/^\d{5,}$/.test(tk));
  const modelLike = rest.some((tk) => /^(?=.*[a-z])(?=.*\d)[a-z0-9-]{3,}$/.test(tk) && !SPEC_TOKEN.test(tk)); // s24, wh-1000xm5, a55
  const hasModel = digitTok.length > 0 && (brand !== null || modelLike);
  const model = rest.length && (digitTok.length || brand) ? titleCase(rest.join(" ")).replace(/\bIphone\b/, "iPhone").replace(/\bOneplus\b/, "OnePlus") : null;
  void core;
  return { brand, model: model && model.length ? model : null, hasModel, modelLike };
}

function detectCategory(t: string): Category {
  const tokens = t.split(" ");
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "washing" && tokens[i + 1] === "machine") return "appliance";
  }
  const hasPhoneWord = /\b(phone|phones|smartphone|mobile|iphone|galaxy|redmi|realme|poco|oneplus|pixel)\b/.test(t);
  // priority: laptop beats phone only when explicit
  if (/\b(laptop|laptops|notebook|macbook|thinkpad|ideapad|vivobook|zenbook|inspiron|pavilion|victus|loq|legion|nitro|predator)\b/.test(t)) return "laptop";
  if (hasPhoneWord) return "smartphone";
  for (const tk of tokens) {
    const c = CATEGORY_WORDS[tk];
    if (c) return c;
  }
  if (/\b(rtx|gtx)\b/.test(t)) return "laptop";
  return "other";
}

function detectFeatures(t: string): { preferred: string[]; excluded: string[] } {
  const excluded: string[] = [];
  let work = t;
  work = work.replace(/\b(?:without|no|not|bina|minus)\s+(?:a\s+)?([a-z0-9]+(?:\s[a-z0-9]+)?)/g, (m, w: string) => {
    for (const f of FEATURES) {
      if (f.re.test(w) || f.re.test(w.split(" ")[0])) { if (!excluded.includes(f.name)) excluded.push(f.name); return " "; }
    }
    return m;
  });
  const preferred: string[] = [];
  for (const f of FEATURES) if (f.re.test(work) && !excluded.includes(f.name) && !preferred.includes(f.name)) preferred.push(f.name);
  // "light" alone is too weak when it appears next to weight/other meaning; keep only explicit lightweight forms
  return { preferred, excluded };
}

function detectSort(t: string): ParsedQuery["sortPreference"] {
  if (/\b(cheapest|cheap|lowest price|lowest|sasta|sasti)\b/.test(t)) return "price";
  if (/\b(fastest delivery|fast delivery|quick delivery|jaldi|same day|next day)\b/.test(t)) return "delivery";
  if (/\b(top rated|best rated|highest rated|rating)\b/.test(t)) return "rating";
  return null;
}

const HARD_SPEC = /\b(?:rtx|gtx|rx)\s?\d{3,4}\b|\b\d{1,2}\s?gb\s?(?:ram|memory|ddr)|\b\d+(?:gb|tb)\s?(?:ssd|storage|rom)\b|\b\d{2,3}\s?hz\b|\b\d{4,5}\s?mah\b|\b\d{2,3}\s?mp\b|\bi[3579][- ]\d{4,5}|\bryzen\s?[3579]\b|\bsnapdragon\b|\bdimensity\b/;

function splitComparison(t: string): string[] | null {
  const m = t.split(/\s+(?:vs\.?|versus|v\/s|ya|or)\s+/);
  if (m.length >= 2) return m.map((s) => s.trim()).filter(Boolean);
  const c = /^(?:compare\s+)(.+?)\s+(?:and|with|aur)\s+(.+)$/.exec(t);
  if (c) return [c[1], c[2]];
  return null;
}

export function emptyVariant(): ParsedQuery["variant"] {
  return { storageGb: null, ramGb: null, color: null, gpu: null, screenInch: null, condition: "unknown" };
}

// ---------------- main deterministic parse ----------------

export function parseShopQuery(raw: string): ParsedQuery {
  const corrections: { from: string; to: string }[] = [];
  const original = raw.trim();
  const base: ParsedQuery = {
    raw: original, normalized: "", searchIntent: "EXACT_PRODUCT", category: "other", brand: null, model: null, variant: emptyVariant(),
    budgetMin: null, budgetMax: null, preferredFeatures: [], excludedFeatures: [], deliveryPincode: null, sortPreference: null,
    comparisonTargets: [], url: null, language: "en", corrections, source: "deterministic", confidence: 0.4,
  };

  // URL
  const urlMatch = /https?:\/\/\S+/i.exec(original);
  if (urlMatch) {
    const v = validateRetailerUrl(urlMatch[0].replace(/[),.;]+$/, ""));
    if (v.ok) {
      return { ...base, normalized: v.url, searchIntent: "PRODUCT_URL", url: v.url, confidence: 0.98 };
    }
  }
  let text = original.replace(/https?:\/\/\S+/gi, " ");

  // language
  const hasDev = DEVANAGARI.test(text);
  if (hasDev) { for (const [re, to] of DEV_MAP) text = text.replace(re, to); text = text.replace(/\s+/g, " "); }
  text = text.toLowerCase();
  const hinglish = HINGLISH_DISTINCT.test(text.replace(/\btak\b/, hasDev ? "tak" : "tak"));
  const language: ParsedQuery["language"] = hasDev ? (/[a-z]{3,}/.test(original.replace(/[ऀ-ॿ]/g, "")) ? "hinglish" : "hi") : hinglish ? "hinglish" : "en";

  // pincode
  let pincode: string | null = null;
  const pinCtx = /\b(?:pin(?:code)?|delivery (?:to|at)|deliver to|ship to)\s*:?\s*([1-9]\d{5})\b/.exec(text);
  if (pinCtx) { pincode = pinCtx[1]; text = text.replace(pinCtx[0], " "); }

  text = convertAmounts(text);
  if (!pincode) {
    const bare = /(?<!(?:under|below|upto|within|around|about|between|and|to|than|budget|above|over|max|[<>~-])\s?)\b([1-9]\d{5})\b(?!\s*(?:tak|ke andar|se kam|ke neeche))/.exec(text);
    if (bare && !/\d(?:gb|tb|mah)/.test(bare[0])) { pincode = bare[1]; text = text.replace(bare[1], " "); }
  }

  text = mapHinglish(text);
  text = expandAbbreviations(text);
  text = cleanSpaces(text).split(" ").filter((w) => !NOISE_TOKENS.has(w) || true).join(" ");
  text = fixTypos(text, corrections);
  text = expandAbbreviations(text); // typo-fixed brand may enable shorthand
  const normalized = cleanSpaces(text);

  const { min, max, stripped } = extractBudget(normalized);
  const variant = extractVariant(normalized);
  const feats = detectFeatures(normalized);
  const sort = detectSort(normalized);
  const category = detectCategory(normalized);

  const out: ParsedQuery = {
    ...base, normalized, language, category, variant, budgetMin: min, budgetMax: max, deliveryPincode: pincode,
    preferredFeatures: feats.preferred, excludedFeatures: feats.excluded, sortPreference: sort,
  };

  const coreText = coreQuery(normalized);
  // strip variant-ish tokens for model detection
  const forModel = coreText
    .replace(/\b\d+(?:\.\d+)?\s?(?:gb|tb)\b(?:\s?(?:ram|ssd|storage|rom))?/g, " ")
    .replace(/\b(?:rtx|gtx|rx)\s?\d{3,4}(?:\s?(?:ti|super|xt))?\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s?(?:inch|mah|mp|hz|w)\b/g, " ")
    .replace(/\bram\b|\bssd\b/g, " ")
    .replace(/\s+/g, " ").trim();

  // comparison
  const sidesRaw = splitComparison(stripped);
  if (sidesRaw && sidesRaw.length >= 2 && sidesRaw.length <= 4) {
    const sides = sidesRaw.map((s) => coreQuery(s)).filter((s) => /[a-z0-9]/.test(s));
    if (sides.length >= 2) {
      const infos = sides.map((s) => detectModel(s, s));
      const strong = infos.filter((i) => i.brand || i.modelLike || i.hasModel).length;
      const sep = /\b(vs\.?|versus|v\/s)\b|^compare\b/.test(stripped);
      if (sep || strong >= 2) {
        // inherit brand for sides like "iphone 15 vs 16 pro"
        const first = infos[0];
        const targets = sides.map((s, i) => {
          if (i > 0 && !infos[i].brand && /^\d/.test(s) && first.brand) {
            const lead = /\biphone\b/.test(sides[0]) ? "iphone" : first.brand.toLowerCase();
            return `${lead} ${s}`;
          }
          return s;
        });
        const cat = category !== "other" ? category : detectCategory(targets.join(" "));
        return {
          ...out, category: cat, searchIntent: "PRODUCT_COMPARISON", comparisonTargets: targets,
          brand: first.brand, model: null, confidence: strong >= 2 ? 0.88 : 0.7,
        };
      }
    }
  }

  const info = detectModel(coreText, forModel);
  out.brand = info.brand;
  out.model = info.model;
  const hardSpec = HARD_SPEC.test(normalized) || variant.gpu !== null;
  const recWord = REC_WORDS.test(normalized);

  let intent: SearchIntent;
  let confidence: number;
  if (info.hasModel && !(recWord && !info.brand)) {
    intent = "EXACT_PRODUCT";
    confidence = info.brand ? 0.9 : 0.7;
  } else if (out.category !== "other" && hardSpec && !info.hasModel) {
    intent = "FEATURE_SEARCH";
    confidence = 0.82;
  } else if (out.category !== "other" && (recWord || max !== null || min !== null || feats.preferred.length > 0)) {
    intent = "PRODUCT_RECOMMENDATION";
    confidence = recWord || max !== null ? 0.78 : 0.62;
  } else if (out.category !== "other") {
    intent = "PRODUCT_RECOMMENDATION";
    confidence = 0.5;
  } else {
    intent = "EXACT_PRODUCT";
    confidence = recWord ? 0.35 : info.brand ? 0.55 : 0.4;
  }
  out.searchIntent = intent;
  out.confidence = confidence;
  if (intent !== "EXACT_PRODUCT") { out.model = null; if (!hardSpec || true) out.brand = info.brand; }
  return out;
}

// ---------------- optional LLM refinement ----------------

const LlmSchema = z.object({
  searchIntent: z.enum(["EXACT_PRODUCT", "PRODUCT_RECOMMENDATION", "FEATURE_SEARCH", "PRODUCT_COMPARISON", "PRODUCT_URL"]),
  category: z.enum(["smartphone", "laptop", "headphones", "tv", "tablet", "smartwatch", "camera", "appliance", "other"]),
  brand: z.string().max(60).nullable(),
  model: z.string().max(80).nullable(),
  budgetMin: z.number().nonnegative().nullable(),
  budgetMax: z.number().nonnegative().nullable(),
  preferredFeatures: z.array(z.string().max(40)).max(10),
  excludedFeatures: z.array(z.string().max(40)).max(10),
  comparisonTargets: z.array(z.string().max(120)).max(4),
});

export interface ParserOptions {
  anthropicKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function refineWithLlm(det: ParsedQuery, opts: ParserOptions): Promise<ParsedQuery> {
  const key = opts.anthropicKey;
  if (!key || det.confidence >= 0.6 || det.searchIntent === "PRODUCT_URL") return det;
  const f = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 6000);
  try {
    const res = await f("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 500,
        system:
          'You parse Indian shopping queries. Reply with ONLY a JSON object: {"searchIntent":"EXACT_PRODUCT|PRODUCT_RECOMMENDATION|FEATURE_SEARCH|PRODUCT_COMPARISON|PRODUCT_URL","category":"smartphone|laptop|headphones|tv|tablet|smartwatch|camera|appliance|other","brand":string|null,"model":string|null,"budgetMin":number|null,"budgetMax":number|null (INR),"preferredFeatures":string[],"excludedFeatures":string[],"comparisonTargets":string[]}. Never invent products or numbers not implied by the query.',
        messages: [{ role: "user", content: det.raw.slice(0, 300) }],
      }),
    });
    if (!res.ok) return det;
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const txt = json.content?.find((c) => c.type === "text")?.text ?? "";
    const m = /\{[\s\S]*\}/.exec(txt);
    if (!m) return det;
    const v = LlmSchema.safeParse(JSON.parse(m[0]));
    if (!v.success) return det;
    const d = v.data;
    if (d.searchIntent === "PRODUCT_COMPARISON" && d.comparisonTargets.length < 2) return det;
    return {
      ...det,
      searchIntent: d.searchIntent === "PRODUCT_URL" ? det.searchIntent : d.searchIntent,
      category: d.category,
      brand: d.brand ?? det.brand,
      model: d.model ?? det.model,
      budgetMin: d.budgetMin ?? det.budgetMin,
      budgetMax: d.budgetMax ?? det.budgetMax,
      preferredFeatures: d.preferredFeatures.length ? d.preferredFeatures.map((s) => s.toLowerCase()) : det.preferredFeatures,
      excludedFeatures: d.excludedFeatures.length ? d.excludedFeatures.map((s) => s.toLowerCase()) : det.excludedFeatures,
      comparisonTargets: d.comparisonTargets,
      source: "llm",
      confidence: 0.75,
    };
  } catch {
    return det;
  } finally {
    clearTimeout(timer);
  }
}

/** Deterministic parse, then optional LLM refinement for low-confidence results. Always falls back to deterministic. */
export async function parseQueryAsync(raw: string, opts: ParserOptions = {}): Promise<ParsedQuery> {
  const det = parseShopQuery(raw);
  return refineWithLlm(det, opts);
}

/** Query string to hand to the retailer offer builder for one product. */
export function productQueryFor(p: ParsedQuery): string {
  return coreQuery(p.normalized) || p.normalized;
}
