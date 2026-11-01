/* PricePilot AI service worker. Bump VERSION to invalidate caches.
 * Policy (see CLAUDE.md): /api/** is NEVER cached or served from cache (prices, keys, cookies).
 * Cache-first only for the static shell + hashed assets. HTML is network-first with offline fallback.
 */
const VERSION = "v2";
const SHELL_CACHE = `pricepilot-shell-${VERSION}`;
const PAGE_CACHE = `pricepilot-pages-${VERSION}`;
const STATIC_CACHE = `pricepilot-static-${VERSION}`;
const ALL_CACHES = [SHELL_CACHE, PAGE_CACHE, STATIC_CACHE];

const NAV_TIMEOUT_MS = 4000;

const PRECACHE = [
  "/offline.html",
  "/saved",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
  "/icons/icon.svg",
];

// Only these page shells are stored for offline use. They render no server-fetched prices:
// /saved reads IndexedDB on the device; it renders no server data.
const OFFLINE_PAGES = ["/saved"];
// Never stored in any cache.
const PRIVATE_PAGES = ["/watchlist", "/alerts", "/login", "/auth", "/account"];

const startsWithAny = (path, list) => list.some((p) => path === p || path.startsWith(p + "/"));

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await Promise.all(PRECACHE.map((url) => shell.add(url).catch(() => undefined)));
      // Warm the JS/CSS chunks the /saved shell needs so it can boot offline.
      try {
        const res = await fetch("/saved", { credentials: "same-origin" });
        if (res.ok) {
          const html = await res.text();
          const assets = Array.from(html.matchAll(/["'](\/_next\/static\/[^"'\s]+)["']/g), (m) => m[1]);
          const stat = await caches.open(STATIC_CACHE);
          await Promise.all([...new Set(assets)].map((u) => stat.add(u).catch(() => undefined)));
        }
      } catch (e) {
        /* offline during install: chunks get cached on first visit instead */
      }
      await self.skipWaiting();
    })()
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
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  // Hard rule: API traffic always goes straight to the network, untouched.
  if (path.startsWith("/api/")) return;

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
    event.respondWith(cacheFirst(req));
  }
});

// Network-first for HTML. Only local-data page shells are kept for offline use;
// pages that render prices are never served from cache (cached prices must never look live).
async function navigate(req, path) {
  const canStore = startsWithAny(path, OFFLINE_PAGES) && !startsWithAny(path, PRIVATE_PAGES);
  try {
    const res = await withTimeout(fetch(req), NAV_TIMEOUT_MS);
    if (res.ok && canStore) {
      const cache = await caches.open(PAGE_CACHE);
      cache.put(path, res.clone()).catch(() => undefined);
    }
    return res;
  } catch (err) {
    if (canStore) {
      const cached =
        (await caches.match(path, { ignoreSearch: true })) ||
        (path === "/saved" ? await caches.match("/saved") : undefined);
      if (cached) return cached;
    }
    const offline = await caches.match("/offline.html");
    return (
      offline ||
      new Response("You're offline. Saved products (on this device) are still available at /saved.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    );
  }
}

// Cache-first: hashed /_next/static files are immutable; icons/fonts rarely change.
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(req, res.clone()).catch(() => undefined);
    }
    return res;
  } catch (err) {
    return Response.error();
  }
}
