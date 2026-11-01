import { z } from "zod";
import { requireEnv } from "./env";
import { searchProducts } from "./search";
import type { SearchResponse } from "./types";

export const MODEL = "claude-sonnet-5-5";
const MAX_TURNS = 4;
const MAX_SEARCHES = 2;

export const messagesSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(20),
});

const SYSTEM = `You are PricePilot, a shopping price assistant for Indian retailers (Amazon.in, Flipkart, Croma, Reliance Digital, Vijay Sales).
Rules:
- To answer any question about prices, availability or "where is it cheapest", you MUST call the search_products tool. Never state prices from memory.
- Ground every claim ONLY in the tool result. Quote prices in INR exactly as returned. Mention the retailer and whether the price is verified (read from the page) or not.
- Only call something the cheapest if the tool result's bestVerified says so. If retailers were blocked, errored or unchecked, say so plainly.
- Bank offers, cashback and coupons are listed verbatim from pages and are NOT guaranteed; never promise a checkout discount or final price.
- If the tool returns no confident matches, say that and suggest a more specific query. Do not invent products or prices.
- Be concise.`;

const TOOLS = [
  {
    name: "search_products",
    description: "Search Indian retailers for a product and return verified price offers. Include brand, model and storage in the query.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Product search query, e.g. 'Samsung Galaxy S24 256GB'" } },
      required: ["query"],
    },
  },
];

const contentBlock = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }),
]);
const apiResponse = z.object({
  stop_reason: z.string().nullish(),
  content: z.array(z.object({ type: z.string() }).passthrough()),
});

type Msg = { role: "user" | "assistant"; content: unknown };

export function compactForModel(r: SearchResponse) {
  return {
    query: r.query,
    parsed: r.parsed,
    bestVerified: r.bestVerified ? { retailer: r.bestVerified.retailerName, title: r.bestVerified.title, price: r.bestVerified.price, url: r.bestVerified.url } : null,
    recommendation: r.recommendation,
    retailerStatuses: r.statuses.map((s) => ({ retailer: s.retailerName, state: s.state, message: s.message })),
    offers: r.offers.slice(0, 8).map((o) => ({
      retailer: o.retailerName,
      title: o.title,
      price: o.price,
      mrp: o.mrp,
      verification: o.verification,
      matchConfidence: o.matchConfidence,
      availability: o.availability,
      offerTexts: o.offers.slice(0, 3),
      url: o.url,
    })),
    excludedCount: r.excluded.length,
  };
}

export async function callClaude(messages: Msg[], fetchImpl: typeof fetch = fetch): Promise<z.infer<typeof apiResponse>> {
  const key = requireEnv("ANTHROPIC_API_KEY");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60_000);
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYSTEM, tools: TOOLS, messages }),
      signal: ac.signal,
    });
    if (!res.ok) throw new AssistantUpstreamError(res.status);
    return apiResponse.parse(await res.json());
  } finally {
    clearTimeout(t);
  }
}

export class AssistantUpstreamError extends Error {
  constructor(public status: number) {
    super(`Anthropic API error ${status}`);
    this.name = "AssistantUpstreamError";
  }
}

export async function runAssistant(
  input: { role: "user" | "assistant"; content: string }[],
  deps: { call?: typeof callClaude; search?: (q: string) => Promise<SearchResponse> } = {},
): Promise<{ reply: string; search?: SearchResponse }> {
  const call = deps.call ?? callClaude;
  const search = deps.search ?? ((q: string) => searchProducts(q));
  const msgs: Msg[] = input.map((m) => ({ role: m.role, content: m.content }));
  let lastSearch: SearchResponse | undefined;
  let searches = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const out = await call(msgs);
    const toolUses = out.content.map((b) => contentBlock.safeParse(b)).flatMap((p) => (p.success && p.data.type === "tool_use" ? [p.data] : []));
    if (toolUses.length === 0) {
      const reply = out.content
        .map((b) => contentBlock.safeParse(b))
        .flatMap((p) => (p.success && p.data.type === "text" ? [p.data.text] : []))
        .join("\n")
        .trim();
      return { reply: reply || "I could not produce an answer.", search: lastSearch };
    }
    msgs.push({ role: "assistant", content: out.content });
    const results = [];
    for (const tu of toolUses) {
      const q = z.object({ query: z.string().min(2).max(300) }).safeParse(tu.input);
      if (tu.name !== "search_products" || !q.success) {
        results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: "Invalid tool call." });
        continue;
      }
      if (searches >= MAX_SEARCHES) {
        results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: "Search limit reached for this request. Answer using earlier results only." });
        continue;
      }
      searches++;
      try {
        lastSearch = await search(q.data.query);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(compactForModel(lastSearch)) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Search failed: ${(e as Error).message}. Tell the user the lookup failed; do not guess prices.` });
      }
    }
    msgs.push({ role: "user", content: results });
  }
  return { reply: "I could not finish the lookup in time. Please try a more specific query.", search: lastSearch };
}
