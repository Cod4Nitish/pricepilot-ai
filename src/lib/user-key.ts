// Personal TinyFish keys are no longer kept in the browser: the server stores them encrypted in an httpOnly cookie
// (see src/lib/byok.ts and /api/key). This module only removes the key an earlier version kept in localStorage.
const LEGACY_LS = "pp.tinyfishKey";

export function purgeLegacyBrowserKey(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_LS);
  } catch {
    /* storage unavailable */
  }
}
if (typeof window !== "undefined") purgeLegacyBrowserKey();

/** Kept for existing callers: the cookie travels automatically with same-origin requests, so no header is needed. */
export function userKeyHeaders(): Record<string, string> {
  return {};
}
