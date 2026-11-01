// Intent router: decides whether a shopping request should go to
// E-Commerce (Amazon/Flipkart/...), Quick Commerce (Blinkit/Zepto/...) or BOTH.
// Heuristics run first and are always available; Claude refines ambiguous cases
// when ANTHROPIC_API_KEY is configured. Never invents products, only routes text.

export type Mode = "ecommerce" | "quick" | "both";

export interface RoutedItem {
  query: string;
  mode: Mode;
  reason: string;
}

export interface IntentResult {
  items: RoutedItem[];
  overall: Mode;
  source: "heuristic" | "claude";
}

const QUICK_WORDS = [
  "milk", "doodh", "curd", "dahi", "paneer", "butter", "ghee", "cheese", "egg", "eggs", "anda",
  "bread", "atta", "flour", "rice", "chawal", "dal", "sugar", "salt", "namak", "oil", "tea", "chai",
  "coffee", "biscuit", "biscuits", "chips", "namkeen", "maggi", "noodles", "chocolate", "icecream",
  "ice cream", "cold drink", "coke", "pepsi", "juice", "water bottle", "onion", "pyaz", "tomato",
  "tamatar", "potato", "aloo", "banana", "apple", "fruits", "vegetables", "sabzi", "coriander",
  "dhaniya", "garlic", "ginger", "lemon", "soap", "shampoo", "toothpaste", "detergent", "tissue",
  "sanitary", "diaper", "cereal", "oats", "honey", "jam", "ketchup", "masala", "spices", "snacks",
  "grocery", "groceries", "kirana",
];
const QUICK_UNITS = /\b\d+(\.\d+)?\s?(kg|g|gm|gram|grams|ml|l|ltr|litre|liter|litres|dozen|pcs|pc|pack|packs)\b/i;
const QUICK_URGENCY = /\b(10 ?min|minutes?|abhi|right now|deliver(ed)? now|today|instant|urgent|jaldi|ghar pe)\b/i;
const ECOM_HINT =
  /\b(\d+\s?(gb|tb)|ram|ssd|laptop|phone|mobile|smartphone|iphone|galaxy|pixel|oneplus|redmi|realme|tv|television|refrigerator|fridge|washing machine|ac|headphones?|earbuds?|airpods|watch|smartwatch|camera|tablet|ipad|macbook|monitor|keyboard|mouse|printer|router|speaker|soundbar|console|ps5|xbox|gaming|shoes|sneakers|backpack|trimmer|mixer|grinder|air fryer|vacuum|inverter|geyser|fan|cooler|sony|samsung|apple|lg|dell|hp|lenovo|asus|boat|jbl|bose|xiaomi|nothing)\b/i;
// Items that are plausibly sold both ways (get best of both).
const BOTH_WORDS = /\b(charger|cable|battery|batteries|power bank|bulb|torch|water bottle|lunch box|notebook|pen|umbrella|slippers|towel|bedsheet|candle|gift|chocolate box)\b/i;

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(^|[^a-z])${word.replace(/\s+/g, "\\s+")}([^a-z]|$)`, "i").test(text);
}

export function classifyOne(raw: string): RoutedItem {
  const query = raw.trim();
  const q = query.toLowerCase();
  const quickHit = QUICK_WORDS.find((w) => hasWord(q, w));
  const quick = Boolean(quickHit) || QUICK_UNITS.test(q);
  const urgent = QUICK_URGENCY.test(q);
  const ecom = ECOM_HINT.test(q);
  const both = BOTH_WORDS.test(q);

  if (both) {
    return { query, mode: "both", reason: "Could be bought either way: comparing both" };
  }
  if (ecom && !quickHit) {
    return { query, mode: urgent ? "both" : "ecommerce", reason: urgent ? "Product with urgency: checking both" : "Looks like a product/brand/spec search" };
  }
  if (quick && !ecom) {
    return { query, mode: "quick", reason: quickHit ? `Grocery item (${quickHit})` : "Grocery-style quantity" };
  }
  if (both || (quick && ecom) || urgent) {
    return { query, mode: "both", reason: "Could be bought either way: comparing both" };
  }
  // Unknown generic nouns: be safe and check both rather than guess.
  return { query, mode: "both", reason: "Unclear intent: checking both" };
}

/** Split a spoken/typed list ("milk, eggs and a Samsung S24") into separate requests. */
export function splitRequests(text: string): string[] {
  const cleaned = text
    .replace(/\b(please|can you|find me|i want|i need|mujhe chahiye|mujhe|chahiye|dikhao|dhundo|search for|compare)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned
    .split(/\s*(?:,|;|\band\b|\baur\b|\bplus\b|\balso\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
  // Do not split things like "Tom and Jerry" model names: only split when more than one part is a clear item.
  if (parts.length <= 1) return [cleaned || text.trim()];
  const strong = parts.filter((p) => classifyOne(p).mode !== "both").length;
  return strong >= 2 || parts.length >= 3 ? parts : [cleaned];
}

export function heuristicIntent(text: string): IntentResult {
  const items = splitRequests(text).map(classifyOne);
  return { items, overall: overallMode(items), source: "heuristic" };
}

export function overallMode(items: RoutedItem[]): Mode {
  const modes = new Set(items.map((i) => i.mode));
  if (modes.has("both") || (modes.has("quick") && modes.has("ecommerce"))) return "both";
  return modes.has("quick") ? "quick" : "ecommerce";
}

/** Claude refinement for ambiguous items only. Falls back to heuristics on any failure. */
export async function refineWithClaude(text: string, base: IntentResult, apiKey: string): Promise<IntentResult> {
  if (!base.items.some((i) => i.reason.includes("Unclear") || i.reason.includes("Could be"))) return base;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 400,
        system:
          'You route Indian shopping requests. For each item choose "quick" (groceries/daily essentials deliverable in minutes by Blinkit/Zepto), "ecommerce" (electronics, fashion, appliances, anything with specs/brands, bought from Amazon/Flipkart/Croma), or "both" only if truly ambiguous. Reply ONLY JSON: {"items":[{"query":"...","mode":"quick|ecommerce|both","reason":"<=8 words"}]}. Keep the user\'s item wording; never add items.',
        messages: [{ role: "user", content: text.slice(0, 500) }],
      }),
    });
    clearTimeout(t);
    if (!res.ok) return base;
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const raw = json.content?.find((c) => c.type === "text")?.text ?? "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return base;
    const parsed = JSON.parse(m[0]) as { items?: { query?: string; mode?: string; reason?: string }[] };
    const items: RoutedItem[] = (parsed.items ?? [])
      .filter((i) => i.query && (i.mode === "quick" || i.mode === "ecommerce" || i.mode === "both"))
      .map((i) => ({ query: String(i.query), mode: i.mode as Mode, reason: String(i.reason ?? "AI routed").slice(0, 80) }));
    if (!items.length || items.length > 8) return base;
    return { items, overall: overallMode(items), source: "claude" };
  } catch {
    return base;
  }
}
