// Browser-side storage of the user's own TinyFish key (this browser only). Sent as X-TinyFish-Key with API calls.
const LS = "pp.tinyfishKey";

export function getUserKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LS);
  } catch {
    return null;
  }
}
export function setUserKey(k: string): void {
  window.localStorage.setItem(LS, k.trim());
}
export function clearUserKey(): void {
  window.localStorage.removeItem(LS);
}
/** Masked for display: never show the full key back. */
export function maskKey(k: string): string {
  return k.length <= 8 ? "••••" : `${k.slice(0, 4)}••••${k.slice(-4)}`;
}
/** Headers to add to PricePilot API requests. */
export function userKeyHeaders(): Record<string, string> {
  const k = getUserKey();
  return k ? { "X-TinyFish-Key": k } : {};
}
