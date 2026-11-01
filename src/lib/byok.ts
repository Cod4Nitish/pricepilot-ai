// Bring-your-own TinyFish key. The key comes from the user's browser in the X-TinyFish-Key header, is used only for the
// TinyFish calls of THAT request (AsyncLocalStorage), and is never stored, logged or returned. Without it, the server key is used.
import { AsyncLocalStorage } from "node:async_hooks";
import { requireEnv } from "./env";

const store = new AsyncLocalStorage<{ key: string }>();
const KEY_RE = /^[A-Za-z0-9_\-.:]{16,200}$/;

export const USER_KEY_HEADER = "x-tinyfish-key";

/** Valid-looking user key from the request header, else null (malformed values are ignored, never echoed). */
export function readUserKey(req: Request): string | null {
  const v = req.headers.get(USER_KEY_HEADER)?.trim();
  return v && KEY_RE.test(v) ? v : null;
}

export function userKey(): string | null {
  return store.getStore()?.key ?? null;
}

/** Run fn with the request's user key (if any) applied to every TinyFish call inside it. */
export function withUserKey<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  const key = readUserKey(req);
  return key ? store.run({ key }, fn) : fn();
}

/** The key TinyFish calls will use: the user's key for this request, else the server env key (503 NOT_CONFIGURED if neither). */
export function requireTinyFishKey(): string {
  return userKey() ?? requireEnv("TINYFISH_API_KEY");
}
