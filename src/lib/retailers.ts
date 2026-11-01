import type { RetailerId } from "./types";

export interface RetailerConfig {
  id: RetailerId;
  name: string;
  domain: string; // registrable domain, also used for include_domains
  productUrlRegex: RegExp;
  enabled: boolean;
  /** Fetch markdown is known to contain price (else Agent fallback needed). */
  fetchHasPrice: boolean;
  proven: boolean;
  /** Electronics-only store: a paid Agent run here is only justified for electronics queries. */
  electronicsOnly: boolean;
}

export const RETAILERS: RetailerConfig[] = [
  { id: "amazon", name: "Amazon.in", domain: "amazon.in", productUrlRegex: /\/(?:dp|gp\/product)\/[A-Z0-9]{10}|\/[^/]+\/dp\/[A-Z0-9]{10}/i, enabled: true, fetchHasPrice: true, proven: true, electronicsOnly: false },
  { id: "flipkart", name: "Flipkart", domain: "flipkart.com", productUrlRegex: /\/p\/itm[a-z0-9]+|[?&]pid=[A-Z0-9]+/i, enabled: true, fetchHasPrice: true, proven: true, electronicsOnly: false },
  { id: "croma", name: "Croma", domain: "croma.com", productUrlRegex: /\/p\/\d+/i, enabled: true, fetchHasPrice: false, proven: true, electronicsOnly: true },
  { id: "reliance", name: "Reliance Digital", domain: "reliancedigital.in", productUrlRegex: /reliancedigital\.in\/(?:[a-z0-9-]+\/)?p\/\d{6,}/i, enabled: true, fetchHasPrice: false, proven: false, electronicsOnly: true },
  { id: "vijay", name: "Vijay Sales", domain: "vijaysales.com", productUrlRegex: /vijaysales\.com\/p\/[A-Za-z]{0,2}\d{4,}|vijaysales\.com\/(?!c\/|category|collections?\/|search|brand|pages?\/)[a-z0-9][a-z0-9-]{14,}\/\d{4,}(?:\/|$|\?)/i, enabled: true, fetchHasPrice: false, proven: false, electronicsOnly: true },
];

export const RETAILER_BY_ID: Record<RetailerId, RetailerConfig> = Object.fromEntries(
  RETAILERS.map((r) => [r.id, r]),
) as Record<RetailerId, RetailerConfig>;

export function retailerForHost(host: string): RetailerConfig | undefined {
  const h = host.toLowerCase();
  return RETAILERS.find((r) => h === r.domain || h.endsWith("." + r.domain));
}

export function isProductUrl(retailer: RetailerConfig, url: string): boolean {
  return retailer.productUrlRegex.test(url);
}

/** Stable per-retailer product identity from a URL (ASIN / Flipkart pid or itm / numeric id), else null. Used for dedupe. */
export function productKey(retailerId: string, url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const path = u.pathname;
  let id: string | null = null;
  if (retailerId === "amazon") id = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i.exec(path)?.[1]?.toUpperCase() ?? null;
  else if (retailerId === "flipkart") id = u.searchParams.get("pid")?.toUpperCase() ?? /\/p\/(itm[a-z0-9]+)/i.exec(path)?.[1]?.toLowerCase() ?? null;
  else if (retailerId === "croma") id = /\/p\/(\d+)/i.exec(path)?.[1] ?? null;
  else if (retailerId === "reliance") id = /\/p\/(\d{6,})/i.exec(path)?.[1] ?? null;
  else if (retailerId === "vijay") id = /\/p\/([A-Za-z]{0,2}\d{4,})/i.exec(path)?.[1]?.toUpperCase() ?? /\/(\d{4,})(?:\/|$)/.exec(path)?.[1] ?? null;
  return id ? `${retailerId}:${id}` : null;
}

export interface DiscoveredLink {
  url: string;
  text: string;
}

const TOKEN_STOP = new Set(["the", "and", "buy", "online", "for", "with", "gb", "tb", "ram", "price", "in", "india", "5g", "4g"]);
function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !TOKEN_STOP.has(w));
}

/**
 * Product-page discovery from a category/listing page: take product links (from Fetch `links:true` output and/or markdown
 * `[text](url)` links), keep only this retailer's product URLs, rank by overlap of the link text/slug with the query, drop zero-overlap links.
 */
export function discoverProductLinks(retailer: RetailerConfig, query: string, input: { links?: string[]; markdown?: string }, limit = 3): DiscoveredLink[] {
  const found = new Map<string, DiscoveredLink>();
  const add = (rawUrl: string, text: string) => {
    let abs = rawUrl.trim();
    if (abs.startsWith("//")) abs = "https:" + abs;
    else if (abs.startsWith("/")) abs = `https://www.${retailer.domain}${abs}`;
    if (!/^https:\/\//i.test(abs)) return;
    let host: string;
    try {
      host = new URL(abs).hostname.toLowerCase();
    } catch {
      return;
    }
    if (!(host === retailer.domain || host.endsWith("." + retailer.domain))) return;
    if (!retailer.productUrlRegex.test(abs)) return;
    const key = productKey(retailer.id, abs) ?? abs.split("?")[0];
    const prev = found.get(key);
    if (!prev || (!prev.text && text)) found.set(key, { url: abs.split("#")[0], text: text.trim() });
  };
  for (const l of input.links ?? []) add(l, "");
  if (input.markdown) {
    const re = /\[([^\]]{3,200})\]\((\S+?)(?:\s+"[^"]*")?\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input.markdown))) add(m[2], m[1].replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\s+/g, " "));
  }
  const q = new Set(tokens(query));
  const scored = [...found.values()].map((d) => {
    let slug = "";
    try {
      slug = decodeURIComponent(new URL(d.url).pathname).replace(/\/p\/.*$/, "");
    } catch {
      /* ignore */
    }
    const have = new Set([...tokens(d.text), ...tokens(slug)]);
    let hit = 0;
    for (const w of q) if (have.has(w)) hit++;
    return { d: { ...d, text: d.text || slug.replace(/[-/]+/g, " ").trim() }, score: q.size ? hit / q.size : 0 };
  });
  return scored.filter((x) => x.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.d);
}
