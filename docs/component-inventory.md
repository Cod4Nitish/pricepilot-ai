# Component inventory

Covers every file under `src/components/**` and the page files under `src/app/**` (API routes are in `API.md`). "Used by" was checked by searching imports at the time of writing. All components are React function components; Next.js client components are marked "client".

## Layout (`src/components/layout`)

| File | Purpose | Props | Used by |
| --- | --- | --- | --- |
| `AppShell.tsx` (default; also exports `Logo`, `ThemeToggle`) | App chrome: skip link, desktop sidebar (`lg+`), sticky header, `main#main-content`, mobile bottom nav, "More" sheet. Header search is hidden on `/` because the hero has its own. client | `children` | `app/layout.tsx` |
| `SmartSearch.tsx` | Unified search: type, speak (Web Speech API, English or Hindi) or paste a product link. Calls `/api/intent` to route to E-Commerce, Quick or Both, then opens `/discover`. Asks for location in a sheet when quick-delivery results need it. client | `variant?: "hero" \| "compact"`, `initial?`, `initialMode?: SearchMode`, `autoFocus?`, `inputId?` | `AppShell` (header), `HeroSearch` |
| `HeroSearch.tsx` | Home hero: verified-prices pill, headline with typed rotating word, `SmartSearch` hero variant, example chips, pause button. client | none | `app/page.tsx` |
| `HeroVisual.tsx` | Illustrative comparison panel labelled "Example layout / Not live data"; placeholder amounts, no real data | none | `app/page.tsx` |
| `LocationChip.tsx` | Header-style chip showing the saved pincode and opening a location sheet. client | `className?` | Not used anywhere (dead code at time of writing) |
| `SearchBar.tsx` | Older search form (type, paste, voice, `/search?q=`). Its `SearchBar` component is no longer rendered; only the exported `queryFromLink()` helper (derives a product name from a pasted URL) is imported, by `SmartSearch`. client | `compact?`, `initial?`, `autoFocus?`, `onSubmitQuery?`, `hero?`, `inputId?` | `queryFromLink` by `SmartSearch`; the component itself is unused |
| `nav.ts` | `NAV` list (href, label, icon, `mobile`, `short`) driving the sidebar, bottom nav and More sheet | n/a | `AppShell` |
| `discover-api.ts` | Client helpers: `fetchIntent`, `readCachedIntent`, `fastSearch`, `MODE_LABEL`, `SearchMode` type | n/a | `SmartSearch`, `AppShell` (type), `DiscoverView` |

## UI primitives (`src/components/ui`)

| File | Purpose | Props | Used by |
| --- | --- | --- | --- |
| `button.tsx` | `Button` and `buttonVariants` (cva). Variants: primary, secondary, ghost, danger, verified. Sizes: sm (40px), md (44px), lg (48px), icon | `variant?`, `size?`, `asChild?`, native button props | Many pages and components |
| `badge.tsx` | Pill label. Tones: neutral, good, warn, bad, brand | `tone?`, span props | Product, fast, battle, discover, basket |
| `card.tsx` | `Card` (surface level 1 to 3) and `CardTitle` | `level?: 1 \| 2 \| 3`, div props | Pages, fast, battle, product |
| `input.tsx` | Text input, 44px high, `aria-invalid` styling | native input props | `LocationSelector`, `ItemsEditor`, watchlist, basket, settings |
| `dialog.tsx` | Accessible modal (focus trap, Escape, focus restore, scroll lock) rendered in a portal. client | `open`, `onClose`, `title`, `description?`, `children`, `variant?: "sheet" \| "dialog"` | `Sheet` |
| `sheet.tsx` | Bottom sheet on mobile, centred dialog from `sm` up; thin wrapper over `Dialog`. client | `open`, `onClose`, `title`, `children` | `AppShell` (More), `SmartSearch` (location), `LocationChip` |
| `tabs.tsx` | Generic segmented tab control with arrow-key navigation. client | `items`, `value`, `onChange`, `label` | Settings, History, Discover |
| `mode-switch.tsx` | Segmented link control Fast Commerce / E-Commerce; active mode derived from the route (`/fast` and `/battle` count as Fast). client | `className?`, `compact?` | `AppShell` (sidebar and mobile header) |
| `location-selector.tsx` | "Use my location" button plus manual 6-digit pincode form; saves to `localStorage` (`pricepilot:pincode`). Also exports `PINCODE_KEY`, `isValidPincode`, `readSavedPincode`. client | `onChange?(pincode \| null)`, `className?` | `SmartSearch`, `LocationChip`, `FastView`, `BattleView`, `DiscoverView` |
| `state.tsx` | `EmptyState` (icon, title, children, action) and `ErrorState` (alert with retry) | `EmptyState`: `icon?`, `title`, `children?`, `action?`, `className?`; `ErrorState`: `title?`, `message?`, `onRetry?`, `className?` | `EmptyState`: search, product, discover, price history. `ErrorState`: unused |
| `skeleton.tsx` | Shimmer placeholder block | div props | Pages, `Skeletons`, `FastView` |

## Product (`src/components/product`)

| File | Purpose | Props | Used by |
| --- | --- | --- | --- |
| `ProductCard.tsx` (default; also `ProductImage`) | Offer card: image, title, price, MRP discount, availability, spec chips, verification badge, watch button | `offer`, `query?`, `detail?` (default true), `best?` | `SearchResults`, product page, assistant. `ProductImage` also used by watchlist |
| `RetailerPriceCard.tsx` (default; also `deliveryText`) | One retailer's price row with verification and delivery | `offer`, `best?`, `className?` | Product page |
| `VerificationBadge.tsx` (default; also `VERIFICATION_META`) | Icon plus text label for Verified, Agent verified, Snippet only, Unverified | `value`, `detail?` | `ProductCard`, `RetailerPriceCard`, `SearchResults`, basket |
| `SearchResults.tsx` (default; also `RunProgress`) | Results list for a search response with best verified offer, grouped lists and run progress | `data: SearchResponse`, `showRun?` | `SearchView`, `DiscoverView` |
| `RetailerStatusBar.tsx` | Per-retailer status chips (which retailers answered or were blocked) | `statuses` | `SearchResults` |
| `SpecComparison.tsx` | Spec comparison table across offers | `offers` | Product page |
| `PriceHistoryPanel.tsx` | Price history chart or list | `points`, `days` | Product page, `HistoryView` |
| `BuyVsWait.tsx` | Buy-or-wait advice derived from history | `points`, `current` | Product page |
| `buy-vs-wait.ts` | Pure logic for the advice (`deriveAdvice`, `MIN_POINTS`, `MIN_SPAN_DAYS`); unit test in `__tests__/buy-vs-wait.test.ts` | n/a | `BuyVsWait` |
| `ErrorCard.tsx` | Error card for API failures with optional retry | `error`, `onRetry?` | Many pages |
| `Skeletons.tsx` | `CardSkeleton`, `ResultsSkeleton` loading states | `ResultsSkeleton`: `note?` | `app/loading.tsx`, search, discover, basket |
| `useSearch.ts` | Data hook for the search query | `useSearch(query)` | `SearchView` |

## Fast Commerce and Battle

| File | Purpose | Props | Used by |
| --- | --- | --- | --- |
| `fast/FastView.tsx` (`FastView`, `battleHref`) | Fast Commerce screen: items editor, pincode, comparison | none | `app/fast/page.tsx` |
| `fast/ItemsEditor.tsx` (`ItemsEditor`, `linesFromParams`, `MAX_ITEMS` = 8) | Editable basket lines | `items`, `onChange`, `disabled?` | `FastView`, `BattleView` |
| `fast/ComparisonView.tsx` (`ComparisonView`, `StoreColumn`) | Store-by-store basket comparison and winner | `baskets`, `comparison` | `FastView`, `BattleView` |
| `fast/SetupCard.tsx` (`SetupCard`, `ProviderNotes`) | Setup guidance and provider status notes | `ProviderNotes`: `providers` | `FastView`, `BattleView` |
| `battle/BattleView.tsx` (`BattleView`) | Live Deal Battle: streams one lane per provider agent with status, log and result | none | `app/battle/page.tsx` |

## PWA (`src/components/pwa`)

| File | Purpose | Props | Used by |
| --- | --- | --- | --- |
| `RegisterSW.tsx` (default; also `useOnlineStatus`) | Registers `/sw.js` (production, or dev with `?sw=1`), shows the offline banner and an "Update available / Reload" toast. client | none | `app/layout.tsx` |
| `InstallPrompt.tsx` (default; also `InstallInstructions`) | Install card (Android/desktop via `beforeinstallprompt`, iOS Safari via share instructions). Sets `data-install` on `<html>` so the layout reserves space. client | `InstallInstructions`: `className?` | `app/layout.tsx`; `InstallInstructions` is unused (Settings has its own inline steps) |

## Pages (`src/app`)

| Route | File | Purpose |
| --- | --- | --- |
| `/` | `page.tsx` | Landing: search hero, trust points, mode cards, how it works, verification explainer, retailer list, install card |
| `/discover` | `discover/page.tsx`, `DiscoverView.tsx` | Smart results for `?q=&mode=`; location selector for quick results |
| `/search` | `search/page.tsx`, `SearchView.tsx` | E-Commerce search results |
| `/product/[key]` | `product/[key]/page.tsx` | Product detail: retailer prices, specs, history, buy-vs-wait |
| `/fast` | `fast/page.tsx` | Fast Commerce basket comparison |
| `/battle` | `battle/page.tsx` | Live Deal Battle |
| `/basket` | `basket/page.tsx` | Smart Basket planner |
| `/assistant` | `assistant/page.tsx` | AI assistant |
| `/history` | `history/page.tsx`, `HistoryView.tsx` | Price history |
| `/watchlist` | `watchlist/page.tsx` | Watchlist (sign-in required) |
| `/settings` | `settings/page.tsx` | Settings and install steps (`#install`) |
| n/a | `layout.tsx`, `providers.tsx` | Root layout (fonts, theme script, shell) and client providers (query client, theme context) |
| n/a | `loading.tsx`, `error.tsx`, `not-found.tsx` | Route fallbacks |

## Unused or stale items

- `layout/LocationChip.tsx`: no importers.
- `layout/SearchBar.tsx` component: unused; keep or move `queryFromLink` elsewhere before deleting.
- `ui/state.tsx` `ErrorState`: no importers (`ErrorCard` is used instead).
- `pwa/InstallPrompt.tsx` `InstallInstructions`: no importers.
- `HeroVisual`, `InstallPrompt` and the `RegisterSW` update toast still carry gradient or hard-coded navy styling; see "Known drift" in `design-system.md`.
