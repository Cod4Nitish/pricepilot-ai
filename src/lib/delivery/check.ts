// Pincode delivery check via a TinyFish Web Agent (Amazon.in and Flipkart). Reports ONLY what the page displays.
import { TtlCache } from "../cache";
import { canonicalUrl } from "../ssrf";
import * as tf from "../tinyfish";
import type { DeliveryInfo } from "../shop/types";
import { parseEta } from "./parse";

export const PINCODE_RE = /^[1-9]\d{5}$/;
export const SUPPORTED = new Set(["amazon", "flipkart"]);

/** Named so lib/api.ts handleError maps it to 400 INVALID_INPUT. */
export class DeliveryInputError extends Error {
  name = "SearchInputError";
}

export interface DeliveryOfferRef {
  offerId: string;
  url: string;
  retailer: string;
}
export interface DeliveryDeps {
  runAgent: typeof tf.runAgent;
  now: () => Date;
  cache: TtlCache<DeliveryInfo> | null;
  limiter: tf.Limiter;
}

export const DELIVERY_CACHE_MS = 30 * 60_000;
const sharedCache = new TtlCache<DeliveryInfo>(DELIVERY_CACHE_MS, 500);
const sharedLimiter = new tf.Limiter(3);
export function clearDeliveryCache() {
  sharedCache.clear();
}

const defaultDeps = (): DeliveryDeps => ({ runAgent: tf.runAgent, now: () => new Date(), cache: sharedCache, limiter: sharedLimiter });

export const DELIVERY_SCHEMA = {
  type: "object",
  properties: {
    serviceable: { type: ["boolean", "null"], description: "true only if the page says it delivers to this pincode; false only if it says it cannot; null if the page shows neither" },
    etaText: { type: ["string", "null"], description: "The delivery date/time text exactly as displayed, else null" },
    message: { type: ["string", "null"], description: "Any other delivery message or blocker (CAPTCHA, login) exactly as displayed, else null" },
  },
  required: ["serviceable", "etaText", "message"],
};

export function deliveryGoal(retailer: string, pincode: string): string {
  const widget = retailer === "amazon" ? "the 'Deliver to' / location link near the top of the page or the delivery block beside the Buy box" : "the 'Enter Delivery Pincode' / 'Check' box under the price or in the delivery section";
  return (
    `Open this product page without logging in. Find ${widget} and use the site's own pincode widget to enter ${pincode}, then apply or check it. ` +
    "Return ONLY what the page displays after that: serviceable (true if it shows a delivery option for this pincode, false if it says the item cannot be delivered / is not deliverable there, null if neither is shown), " +
    "etaText (the delivery date text verbatim, e.g. 'Delivery by Tue, 4 Nov'), message (any other delivery message verbatim). " +
    "Never infer or compute a date. Never add to cart, never start checkout, never sign in. " +
    "If a CAPTCHA, bot check or login wall appears, stop immediately and return serviceable null, etaText null, and message describing the blocker."
  );
}

function base(pincode: string, now: Date): DeliveryInfo {
  return { pincode, serviceable: null, kind: "not_verified", etaText: null, etaDate: null, etaDays: null, guaranteed: false, checkedAt: now.toISOString(), evidence: null, note: null };
}

const BLOCKED = /captcha|robot|bot check|verify you are human|unusual traffic|sign[- ]?in required|log ?in (?:required|to continue)|access denied|blocked/i;

export function interpretAgentResult(raw: unknown, pincode: string, now: Date): DeliveryInfo {
  const info = base(pincode, now);
  let r: unknown = raw;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch {
      r = null;
    }
  }
  if (r && typeof r === "object" && !("etaText" in r) && !("serviceable" in r) && "result" in r) r = (r as { result: unknown }).result;
  const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, 300) : null);
  const serviceable = typeof o.serviceable === "boolean" ? o.serviceable : null;
  const etaText = s(o.etaText);
  const message = s(o.message);
  info.evidence = etaText ?? message;
  if (!etaText && !message && serviceable === null) {
    info.note = "The page did not display any delivery information for this pincode.";
    return info;
  }
  if (!etaText && message && BLOCKED.test(message)) {
    info.note = `Retailer blocked the automated pincode check (${message}). Not bypassed.`;
    return info;
  }
  const parsed = parseEta(etaText ?? message, now);
  if (serviceable === false || parsed.kind === "unserviceable") {
    return { ...info, serviceable: false, kind: "unserviceable", etaText, note: message ?? "The retailer shows this item as not deliverable to this pincode." };
  }
  if (etaText) {
    return {
      ...info,
      serviceable: serviceable ?? true,
      kind: "published_estimate",
      etaText,
      etaDate: parsed.kind === "date" ? parsed.etaDate : null,
      etaDays: parsed.kind === "date" ? parsed.etaDays : null,
      note: parsed.kind === "date" ? "Estimate published by the retailer; not guaranteed." : "Retailer published a delivery estimate that could not be reduced to a single date; shown verbatim. Not guaranteed.",
    };
  }
  return { ...info, serviceable, note: serviceable ? "The page shows delivery is available but displayed no delivery date." : (message ?? "No delivery information displayed.") };
}

export async function checkDelivery(offer: DeliveryOfferRef, pincode: string, depsIn?: Partial<DeliveryDeps>): Promise<DeliveryInfo> {
  if (!PINCODE_RE.test(pincode)) throw new DeliveryInputError("pincode must be a 6-digit Indian pincode.");
  const deps = { ...defaultDeps(), ...depsIn };
  const now = deps.now();
  if (!SUPPORTED.has(offer.retailer)) {
    return { ...base(pincode, now), note: `Pincode check not supported for ${offer.retailer} yet.` };
  }
  const key = `${offer.retailer}|${canonicalUrl(offer.url)}|${pincode}`;
  const hit = deps.cache?.get(key);
  if (hit) return hit;
  let info: DeliveryInfo;
  try {
    const r = await deps.limiter.run(() =>
      deps.runAgent({ url: offer.url, goal: deliveryGoal(offer.retailer, pincode), outputSchema: DELIVERY_SCHEMA, stealth: true, maxDurationSeconds: 90, overallTimeoutMs: 110_000 }),
    );
    if (r.status !== "COMPLETED") {
      info = { ...base(pincode, now), kind: "error", note: `The browser agent run ${r.status.toLowerCase()}${r.error ? ` (${r.error.slice(0, 120)})` : ""}; delivery could not be verified.` };
    } else {
      info = interpretAgentResult(r.result, pincode, now);
    }
  } catch (e) {
    if (e instanceof tf.TinyFishError && (e.kind === "insufficient_credits" || e.kind === "auth")) throw e;
    const kind = e instanceof tf.TinyFishError ? e.kind : "unknown";
    return { ...base(pincode, now), kind: "error", note: kind === "timeout" ? "The pincode check timed out; delivery could not be verified." : `The pincode check failed (${kind}); delivery could not be verified.` };
  }
  if (info.kind === "published_estimate" || info.kind === "unserviceable") deps.cache?.set(key, info);
  return info;
}
