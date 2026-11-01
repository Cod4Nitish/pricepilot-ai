import { retailerForHost, type RetailerConfig } from "./retailers";

const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|ref|ref_|tag|linkcode|linkid|camid|creative|creativeasin|psc|pd_rd_[a-z]+|pf_rd_[a-z]+|qid|sr|keywords|crid|sprefix|sid|spm|cv_ct_[a-z]+|ascsubtag|affid|affExtParam\d|otracker\d*|lid|marketplace|srno|fm|iid|ppt|ppn|ssid|store)$/i;
// Flipkart needs pid/lid sometimes; keep pid only (lid stripped is safe).
const KEEP = new Set(["pid", "variant", "color"]);

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "169.254.169.254",
  "100.100.100.200",
]);

export function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  if (h.includes(":")) return true; // IPv6
  if (/^\d+$/.test(h)) return true; // decimal-int IPv4
  if (/^0x[0-9a-f]+$/i.test(h)) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
}

export type SsrfResult =
  | { ok: true; url: string; retailer: RetailerConfig }
  | { ok: false; reason: string };

/** Validate a user/search-supplied URL for automation. Retailer domains only, https only. */
export function validateRetailerUrl(input: string): SsrfResult {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "Only https URLs are allowed." };
  if (u.username || u.password) return { ok: false, reason: "Credentials in URLs are not allowed." };
  if (u.port && u.port !== "443") return { ok: false, reason: "Non-standard ports are not allowed." };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: "Host is not allowed." };
  }
  if (isIpLiteral(host)) return { ok: false, reason: "IP addresses are not allowed." };
  const retailer = retailerForHost(host);
  if (!retailer) return { ok: false, reason: "Only supported retailer domains are allowed." };
  if (!retailer.enabled) return { ok: false, reason: `${retailer.name} is disabled.` };
  return { ok: true, url: stripTracking(u).toString(), retailer };
}

export function stripTracking(u: URL): URL {
  const out = new URL(u.toString());
  out.hash = "";
  for (const k of [...out.searchParams.keys()]) {
    if (KEEP.has(k.toLowerCase())) continue;
    if (TRACKING.test(k)) out.searchParams.delete(k);
  }
  return out;
}

/** Canonical URL used for stable offer ids. */
export function canonicalUrl(url: string): string {
  try {
    const u = stripTracking(new URL(url));
    u.search = [...u.searchParams.entries()].filter(([k]) => KEEP.has(k.toLowerCase())).map(([k, v]) => `${k}=${v}`).join("&");
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** Looks like the user pasted a URL (as opposed to a product query). */
export function looksLikeUrl(q: string): boolean {
  return /^https?:\/\/\S+$/i.test(q.trim());
}
