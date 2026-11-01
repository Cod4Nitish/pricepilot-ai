import { getEnv } from "../env";
import type { ProviderConfig, ProviderId } from "./types";

/**
 * Provider registry. Only Blinkit and Zepto are enabled. They run through a TinyFish web agent that
 * uses each site's own location UI. NOTHING here has been proven against the live sites in this
 * build (no real API calls were made), so enabled providers carry that caveat; any block, login wall
 * or CAPTCHA is reported honestly as "unavailable: <reason>" and never bypassed.
 */
export const PROVIDERS: ProviderConfig[] = [
  {
    id: "blinkit",
    name: "Blinkit",
    homeUrl: "https://blinkit.com/",
    domain: "blinkit.com",
    status: "enabled",
    reason: "Enabled via a TinyFish agent (location set through the site's own UI). Not yet verified against the live site; blocks or login walls are reported, never bypassed. Review the site's terms before relying on it.",
    provenLive: false,
  },
  {
    id: "zepto",
    name: "Zepto",
    homeUrl: "https://www.zeptonow.com/",
    domain: "zeptonow.com",
    status: "enabled",
    reason: "Enabled via a TinyFish agent (location set through the site's own UI). Not yet verified against the live site; blocks or login walls are reported, never bypassed. Review the site's terms before relying on it.",
    provenLive: false,
  },
  {
    id: "instamart",
    name: "Swiggy Instamart",
    homeUrl: "https://www.swiggy.com/instamart",
    domain: "swiggy.com",
    status: "disabled",
    reason: "Disabled: not proven to work without a logged-in session, and its terms have not been reviewed. We never automate logins.",
    provenLive: false,
  },
  {
    id: "bigbasket",
    name: "BigBasket",
    homeUrl: "https://www.bigbasket.com/",
    domain: "bigbasket.com",
    status: "disabled",
    reason: "Disabled: location-specific pricing has not been proven to work with the agent, and its terms have not been reviewed.",
    provenLive: false,
  },
  {
    id: "jiomart",
    name: "JioMart",
    homeUrl: "https://www.jiomart.com/",
    domain: "jiomart.com",
    status: "disabled",
    reason: "Disabled: pincode-specific pricing has not been proven to work with the agent, and its terms have not been reviewed.",
    provenLive: false,
  },
];

export const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p])) as Record<ProviderId, ProviderConfig>;

export const ENABLED_PROVIDERS = (): ProviderConfig[] => PROVIDERS.filter((p) => p.status === "enabled");

export function isConfigured(): boolean {
  return !!getEnv().TINYFISH_API_KEY;
}

export interface ProviderStatusView {
  id: ProviderId;
  name: string;
  status: "enabled" | "disabled";
  reason: string;
  provenLive: boolean;
  /** enabled AND server has an API key */
  ready: boolean;
}

export function providerStatus(configured: boolean = isConfigured()): { configured: boolean; providers: ProviderStatusView[] } {
  return {
    configured,
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      reason: p.status === "enabled" && !configured ? `${p.reason} Server has no TINYFISH_API_KEY, so it cannot run yet.` : p.reason,
      provenLive: p.provenLive,
      ready: p.status === "enabled" && configured,
    })),
  };
}

/** Only https URLs on the provider's own domain may be shown as "Buy on retailer" links. */
export function safeProductUrl(provider: ProviderConfig, raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    if (h !== provider.domain && !h.endsWith("." + provider.domain)) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}
