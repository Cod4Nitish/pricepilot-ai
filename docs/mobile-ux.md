# Mobile UX

PricePilot is designed mobile-first. The mobile layout applies below 1024px (`lg`); from `lg` up a fixed sidebar replaces the bottom nav.

## Layout, top to bottom

1. Sticky header (`AppShell`): logo mark, the Fast Commerce / E-Commerce mode switch, theme toggle and a "More pages" menu button. On notched phones it adds `env(safe-area-inset-top)`.
2. Search directly under the header on every page except Home (`SmartSearch`, compact variant). On Home the hero contains the search instead, so the header copy is hidden to avoid two search boxes.
3. Page content in `main#main-content`, with extra bottom padding for the bottom nav (and more while the install card is showing).
4. Bottom nav, exactly five items: Home, Fast, Search, Battle, Watchlist. Each is at least 56px tall. Remaining pages (Discover, Smart Basket, Assistant, Price History, Settings) are in the "More" bottom sheet.

The list of items lives in `src/components/layout/nav.ts` (`mobile: true` marks bottom-nav items).

## Search: type, speak or paste

- One field accepts a product name, several items, or a pasted product link. A link is reduced to a readable product name (`queryFromLink`); the page tells the user when it did that.
- The hero variant has a clipboard-paste button (hidden below `sm`, where long-press paste is available) and falls back to a message if clipboard access is denied.
- Smart routing: `/api/intent` decides E-Commerce, Quick or Both, and a status line explains the choice. If routing fails, Discover decides.

## Voice search

- Uses the Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`), which in practice means Chrome and Edge. Elsewhere the mic shows a message to use Chrome or Edge or to type.
- Language toggle English (`en-IN`) or Hindi (`hi-IN`); the toggle is hidden below `sm`.
- Interim results fill the field live; when recognition ends with a final result, the search runs automatically.
- Errors are explained in words: microphone permission denied, nothing heard, or generic failure. The listening state is shown by `aria-pressed`, a changed label and the status line, not colour alone.

## Asking for location, like a ride app

Location is requested only when it is needed, not on page load.

- After a search is routed, if the route is Quick, Both or Auto and no valid pincode is saved, `SmartSearch` opens a bottom sheet titled "Where should we check delivery?" explaining that quick-delivery prices and stock differ by area.
- The sheet contains `LocationSelector`:
  - "Use my location" asks the browser for geolocation (low accuracy, 10s timeout, 5-minute cache), then calls `GET /api/geo/pincode?lat=&lon=` to turn coordinates into a pincode. The endpoint accepts coordinates inside India only, is rate-limited, and does not log or store them. It uses OpenStreetMap Nominatim.
  - "Or enter pincode" accepts a 6-digit Indian PIN (cannot start with 0), saved with the Save button.
  - Denied permission, an unsupported browser or a failed lookup each show a message pointing to manual entry.
- The pincode is stored only in this browser (`localStorage`, key `pricepilot:pincode`), and the consent text says so. A saved pincode can be removed at any time.
- "Skip, compare online stores only" (or closing the sheet) continues the search as E-Commerce only.
- The detected area name is shown ("Detected <area> (<pincode>). Edit it if this is not your delivery address.") so the user can correct it.

`LocationChip` (a header chip showing the saved pincode) exists but is not currently mounted.

## Touch targets and spacing

- Minimum 44px (`--tap`) for buttons, icon buttons, nav links and chips; bottom-nav items are 56px.
- Inputs are 16px text on mobile so iOS does not zoom on focus.
- Sheets use `max-h-88dvh` and scroll internally; the page body is locked while one is open.

## Safe-area insets

- Viewport uses `viewportFit: "cover"`.
- Header uses `.safe-top` (`env(safe-area-inset-top)`); bottom nav and bottom sheets use `.safe-bottom` (`env(safe-area-inset-bottom)`); the install card offsets itself by the same inset.

## Install prompt

`InstallPrompt` shows a small card above the bottom nav (bottom right on desktop) only when there is something actionable:

- Chrome/Edge/Android: after the browser fires `beforeinstallprompt`, an Install button triggers the native prompt.
- iPhone Safari: no install event exists, so it shows two steps (tap Share, choose Add to Home Screen).
- Hidden when the app already runs standalone, after install (`appinstalled`), and after the user dismisses it (stored under `pricepilot-install-dismissed`; dismissal is not time-limited).
- While visible it sets `data-install` on `<html>`; `AppShell` then adds extra bottom padding so the card never covers page content (a fixed earlier bug).

## PWA install steps

- Android Chrome: open the site, tap the install banner or the menu then "Install app" / "Add to Home screen".
- iPhone Safari (other iOS browsers cannot install): Share, then "Add to Home Screen", then Add.
- Desktop Chrome or Edge: click the install icon at the right of the address bar, then Install.

The same steps appear in Settings under "Install the app" (`/settings#install`).

## Offline and service worker rules

Source: `public/sw.js` and `src/components/pwa/RegisterSW.tsx`. Principle: a cached price is never presented as a live price.

- Registration happens in production only (or in dev with `?sw=1`). A new worker triggers an "Update available" toast with a Reload button.
- Offline banner: `RegisterSW` listens to `online` and `offline` events and shows a banner: "You are offline - showing cached data with timestamps. Live prices unavailable."
- Only same-origin GET requests are handled. POST and other methods are never intercepted or cached.
- Never cached or served from cache: `/api/watchlist`, `/api/alerts`, `/api/assistant`, `/api/cron`, and the private pages `/watchlist`, `/alerts`, `/login`, `/auth`, `/account`.
- Other `/api/*` GETs are network-first (8s timeout). A cached copy is returned only when the network fails, and it is marked with response headers `x-pricepilot-offline: 1` and `x-pricepilot-cached-at` (an ISO timestamp, or `unknown`). With nothing cached, a 503 JSON `{ error: "offline" }` is returned.
- Page navigations are network-first (4s timeout), falling back to a cached page, then `/offline.html`.
- Static assets (`/_next/static/`, `/icons/`, the manifest, fonts) use stale-while-revalidate.
- Bump `VERSION` in `sw.js` to invalidate all `pricepilot-*` caches.

Known gap: the `x-pricepilot-offline` and `x-pricepilot-cached-at` headers are set by the worker, but no code under `src/` reads them yet. The only offline signal in the UI is the generic banner. Until screens read the headers and label API data as cached with its timestamp, treat the cached-API path as unverified in QA.
