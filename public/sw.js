/* PricePilot AI service worker. Bump VERSION to invalidate caches. */
const VERSION = "v1";
const SHELL_CACHE = `pricepilot-shell-${VERSION}`;
const PAGE_CACHE = `pricepilot-pages-${VERSION}`;
const STATIC_CACHE = `pricepilot-static-${VERSION}`;
const API_CACHE = `pricepilot-api-${VERSION}`;
const ALL_CACHES = [SHELL_CACHE, PAGE_CACHE, STATIC_CACHE, API_CACHE];

const NAV_TIMEOUT_MS = 4000;
const API_TIMEOUT_MS = 8000;

const PRECACHE = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
  "/icons/icon.svg",
];

// Auth/private data: never cached, never served from cache.
const PRIVATE_API = ["/api/watchlist", "/api/alerts", "/api/assistant", "/api/cron"];
// Private pages: never stored in the page cache.
const PRIVATE_PAGES = ["/watchlist", "/alerts", "/login", "/auth", "/account"];

const startsWithAny = (path, list) =>
  list.some((p) => path === p || path.startsWith(p + "/"));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        // Tolerate individual failures so install still succeeds.
        Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("pricepilot-") && !ALL_CACHES.includes(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING" || (event.data && event.data.type === "SKIP_WAITING")) {
    self.skipWaiting();
  }
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never touch (or cache) POST/PUT/etc.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (path.startsWith("/api/")) {
    if (startsWithAny(path, PRIVATE_API)) return; // straight to network, no caching
    event.respondWith(apiNetworkFirst(req));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(navigate(req, path));
    return;
  }

  if (
    path.startsWith("/_next/static/") ||
    path.startsWith("/icons/") ||
    path === "/manifest.webmanifest" ||
    req.destination === "font"
  ) {
    event.respondWith(staticAsset(req));
  }
});

async function navigate(req, path) {
  const cache = await caches.open(PAGE_CACHE);
  const isPrivate = startsWithAny(path, PRIVATE_PAGES);
  try {
    const res = await withTimeout(fetch(req), NAV_TIMEOUT_MS);
    if (res.ok && !isPrivate) {
      cache.put(req, res.clone()).catch(() => undefined);
    }
    return res;
  } catch (err) {
    if (!isPrivate) {
      const cached = (await cache.match(req)) || (await caches.match(req));
      if (cached) return cached;
    }
    const offline = await caches.match("/offline.html");
    return (
      offline ||
      new Response("You are offline. Live prices are unavailable.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    );
  }
}

// Stale-while-revalidate (hashed /_next/static files are immutable so this is effectively cache-first).
async function staticAsset(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = (await cache.match(req)) || (await caches.match(req));
  const refresh = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => undefined);
      return res;
    })
    .catch(() => undefined);
  if (cached) return cached;
  const res = await refresh;
  return res || Response.error();
}

// Network-first. Fresh responses are returned untouched. Cached copies are returned ONLY
// when the network is unreachable, and are always marked offline with a timestamp.
async function apiNetworkFirst(req) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await withTimeout(fetch(req), API_TIMEOUT_MS);
    if (res.ok) {
      const body = await res.clone().blob();
      const headers = new Headers(res.headers);
      headers.set("x-pricepilot-cached-at", new Date().toISOString());
      await cache
        .put(req, new Response(body, { status: res.status, statusText: res.statusText, headers }))
        .catch(() => undefined);
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) {
      const body = await cached.blob();
      const headers = new Headers(cached.headers);
      headers.set("x-pricepilot-offline", "1");
      if (!headers.has("x-pricepilot-cached-at")) {
        headers.set("x-pricepilot-cached-at", "unknown");
      }
      return new Response(body, { status: cached.status, statusText: cached.statusText, headers });
    }
    return new Response(
      JSON.stringify({ error: "offline", message: "Live data unavailable offline." }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
          "x-pricepilot-offline": "1",
          "cache-control": "no-store",
        },
      }
    );
  }
}
