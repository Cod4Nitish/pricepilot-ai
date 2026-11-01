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
}

export const RETAILERS: RetailerConfig[] = [
  { id: "amazon", name: "Amazon.in", domain: "amazon.in", productUrlRegex: /\/(?:dp|gp\/product)\/[A-Z0-9]{10}|\/[^/]+\/dp\/[A-Z0-9]{10}/i, enabled: true, fetchHasPrice: true, proven: true },
  { id: "flipkart", name: "Flipkart", domain: "flipkart.com", productUrlRegex: /\/p\/itm[a-z0-9]+|[?&]pid=[A-Z0-9]+/i, enabled: true, fetchHasPrice: true, proven: true },
  { id: "croma", name: "Croma", domain: "croma.com", productUrlRegex: /\/p\/\d+/i, enabled: true, fetchHasPrice: false, proven: true },
  { id: "reliance", name: "Reliance Digital", domain: "reliancedigital.in", productUrlRegex: /\/(?:product\/|[^/]+\/p\/\d+|p\/\d+)/i, enabled: true, fetchHasPrice: false, proven: false },
  { id: "vijay", name: "Vijay Sales", domain: "vijaysales.com", productUrlRegex: /vijaysales\.com\/(?:p|[^/]+)\/\d{4,}(?:\/|$|\?)|\/p\/\d+/i, enabled: true, fetchHasPrice: false, proven: false },
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
