// Personal TinyFish key ("bring your own key"), stored securely:
//  - The browser never keeps the key: the server encrypts it (AES-256-GCM, key derived from PP_KEY_SECRET) and sets it as an
//    httpOnly + SameSite=Strict (+ Secure in production) cookie scoped to /api. JavaScript cannot read it.
//  - On each request the server decrypts it and applies it ONLY to that request's TinyFish calls (AsyncLocalStorage).
//  - It is never logged, returned, cached, written to process.env or put in snapshots. Without it the server key is used.
//  - If PP_KEY_SECRET is not configured, personal keys are disabled (no insecure fallback).
import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { requireEnv } from "./env";

const store = new AsyncLocalStorage<{ key: string }>();
const KEY_RE = /^[A-Za-z0-9_\-.:]{16,200}$/;
export const KEY_COOKIE = "pp_tfk";
const MAX_AGE_S = 7 * 24 * 3600;

export function isKeyShaped(k: string): boolean {
  return KEY_RE.test(k);
}

function secret(): Buffer | null {
  const s = process.env.PP_KEY_SECRET?.trim();
  if (!s || s.length < 32) return null;
  return createHash("sha256").update(`pricepilot-byok-v1|${s}`).digest();
}
export function personalKeysEnabled(): boolean {
  return secret() !== null;
}

export function encryptKey(plain: string): string {
  const k = secret();
  if (!k) throw new Error("Personal key storage is not configured.");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
export function decryptKey(token: string): string | null {
  const k = secret();
  if (!k) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const d = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
    return isKeyShaped(plain) ? plain : null;
  } catch {
    return null; // tampered, wrong secret or old format
  }
}

function cookieValue(req: Request, name: string): string | null {
  const h = req.headers.get("cookie");
  if (!h) return null;
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** The personal key for this request (from the encrypted httpOnly cookie), else null. */
export function readUserKey(req: Request): string | null {
  const t = cookieValue(req, KEY_COOKIE);
  return t ? decryptKey(t) : null;
}

export function keyCookie(token: string | null): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return token
    ? `${KEY_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_S}${secure}`
    : `${KEY_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function maskKey(k: string): string {
  return k.length <= 8 ? "••••" : `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

export function userKey(): string | null {
  return store.getStore()?.key ?? null;
}

/** Run fn with this request's personal key (if any) applied to every TinyFish call inside it. */
export function withUserKey<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  const key = readUserKey(req);
  return key ? store.run({ key }, fn) : fn();
}
/** Run fn with an explicit key (used to test a key before saving it). */
export function withExplicitKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ key }, fn);
}

/** Key for TinyFish calls: the personal key of this request, else the server key (503 NOT_CONFIGURED if neither). */
export function requireTinyFishKey(): string {
  return userKey() ?? requireEnv("TINYFISH_API_KEY");
}
