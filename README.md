<div align="center">

<img src="public/icons/icon-192.png" alt="PricePilot AI logo" width="96" height="96" />

# PricePilot AI

### Search Smarter. Compare Better. Pay Less.

AI-powered shopping intelligence and real-time price comparison for Indian shoppers, built on [TinyFish](https://tinyfish.ai) web agents.

[![CI](https://github.com/Cod4Nitish/pricepilot-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/Cod4Nitish/pricepilot-ai/actions/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e?logo=supabase&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8?logo=pwa&logoColor=white)
![Powered by TinyFish](https://img.shields.io/badge/Powered%20by-TinyFish-4af0c4)
![License](https://img.shields.io/badge/license-MIT-blue)

**[Live demo](https://pricepilot-ai-sigma.vercel.app)** &nbsp;|&nbsp; **[API docs](docs/API.md)** &nbsp;|&nbsp; **[Architecture](docs/ARCHITECTURE.md)** &nbsp;|&nbsp; **[Deploy](docs/DEPLOYMENT.md)**

</div>

---

## Why PricePilot?

Comparing prices in India means opening five tabs, squinting at EMI numbers, and wondering whether the "256GB" listing is really the same phone. PricePilot sends **real browser agents** to the retailers for you, checks that every listing is the **exact same product**, and shows you only prices it actually read from the page, each with a visible **verification level**.

> **The rule we never break:** no fabricated prices, no invented history, no fake deals. If a store can't be read, PricePilot says so.

## Screenshots

<!--
Add images to docs/screenshots/ and replace the lines below, e.g.
<img src="docs/screenshots/search.png" width="30%" /> <img src="docs/screenshots/compare.png" width="30%" /> <img src="docs/screenshots/basket.png" width="30%" />
-->

| Landing | Search results | Price comparison |
|:---:|:---:|:---:|
| _coming soon_ | _coming soon_ | _coming soon_ |

| Smart basket | AI assistant | Installed app |
|:---:|:---:|:---:|
| _coming soon_ | _coming soon_ | _coming soon_ |

## How it works (workflow)

```mermaid
flowchart LR
    U([User query<br/>or product URL]) --> P[Parse spec<br/>brand, model,<br/>storage, budget]
    P --> S[TinyFish Search<br/>per retailer, India]
    S --> F[TinyFish Fetch<br/>read product pages]
    F --> Q{Price found<br/>on page?}
    Q -- yes --> M[Match engine]
    Q -- "no (JS page)" --> A[TinyFish Web Agent<br/>reads the live page]
    A --> M
    M --> X{Same exact<br/>product?}
    X -- "yes, high confidence" --> R[Ranked offers<br/>+ verification badge]
    X -- "no / unsure" --> E[Excluded list<br/>never ranked cheapest]
    R --> D[Deal recommendation<br/>with caveats]
    R --> H[(Supabase<br/>price observations)]
```

1. **Parse**: the query becomes a structured spec (brand, model, storage, RAM, colour, condition, max price).
2. **Search**: TinyFish Search runs against each supported retailer (`location=IN`, domain-restricted).
3. **Fetch**: TinyFish Fetch reads the product pages (markdown) and the extractor pulls price, MRP, availability and offer text, keeping a short verbatim evidence string.
4. **Agent fallback**: JavaScript-heavy pages with no readable price are opened by a TinyFish Web Agent with a strict output schema (capped per request to protect your credits).
5. **Match**: a strict matcher rejects wrong storage, wrong generation, `Ultra`/`FE`/`Plus` variants and refurbished-vs-new. Uncertain matches are shown separately and excluded from the "cheapest" ranking.
6. **Verify and explain**: every offer carries a badge, and the recommendation lists its caveats (bank-offer conditions, unknown delivery charges, thin evidence).
7. **Remember**: genuinely observed prices are stored in Supabase so history charts and alerts are real.

## Verification levels

| Badge | Meaning |
|---|---|
| `verified` | Price read from the retailer's product page via TinyFish Fetch |
| `agent_verified` | Price read from the live page by a TinyFish Web Agent |
| `snippet_only` | Seen only in a search snippet, not confirmed on the page |
| `unverified` | Could not be confirmed, shown without a price claim |

## Features

| Feature | Needs |
|---|---|
| Universal product search (text, "under ₹X" budgets, pasted product URLs) | `TINYFISH_API_KEY` |
| Live price comparison across Amazon India, Flipkart, Croma, Reliance Digital, Vijay Sales | `TINYFISH_API_KEY` |
| Honest per-retailer status (ok, partial, blocked, no results, error) | `TINYFISH_API_KEY` |
| Strict AI product matching with confidence scores | none (logic) |
| Smart deal recommendation with caveats | `TINYFISH_API_KEY` |
| Smart Basket optimizer (store split, delivery thresholds) | `TINYFISH_API_KEY` |
| AI shopping assistant that triggers real searches | `ANTHROPIC_API_KEY` + `TINYFISH_API_KEY` |
| Price history (7/30/90 days) from real observations | Supabase |
| Watchlist and target-price alerts | Supabase |
| Installable PWA with offline shell and timestamped cache | none |
| Scheduled price refresh endpoint | `CRON_SECRET` + Supabase |

Without server configuration the API returns `503 NOT_CONFIGURED`. It never falls back to sample data.

## Supported retailers

| Retailer | Discovery | Price extraction |
|---|---|---|
| Amazon India | TinyFish Search | Fetch |
| Flipkart | TinyFish Search | Fetch |
| Croma | TinyFish Search | Web Agent fallback (page is JS-rendered) |
| Reliance Digital | TinyFish Search | Fetch / Web Agent, product-page filtered |
| Vijay Sales | TinyFish Search | Fetch / Web Agent, product-page filtered |

A retailer that cannot be read is reported as unavailable instead of being guessed.

## Tech stack

Next.js 15 (App Router) · TypeScript (strict) · Tailwind CSS 4 · Motion · TanStack Query · Recharts · Zod · Supabase (Postgres + Auth + RLS) · TinyFish Search / Fetch / Agent · Anthropic Claude · PWA (manifest + service worker) · Vercel

## Quick start

```bash
git clone https://github.com/Cod4Nitish/pricepilot-ai.git
cd pricepilot-ai
npm install
cp .env.example .env.local   # then fill in your own values
npm run dev
```

Open http://localhost:3000. `GET /api/health` shows which integrations are configured (booleans only, never secrets).

## Environment variables

| Variable | Scope | Purpose |
|---|---|---|
| `TINYFISH_API_KEY` | server | TinyFish Search / Fetch / Agent |
| `ANTHROPIC_API_KEY` | server | AI shopping assistant |
| `SUPABASE_URL` | server | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Privileged DB access. Never expose to the client |
| `NEXT_PUBLIC_SUPABASE_URL` | client | Supabase URL for browser auth |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | Public anon key (protected by RLS) |
| `CRON_SECRET` | server | Authorises scheduled refresh calls |

Never commit real values. `.env*` files are gitignored.

## Supabase setup

1. Create a project at supabase.com.
2. Apply the SQL files in `supabase/migrations/` in filename order (SQL editor, or the CLI):
   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```
3. Copy the project URL, anon key and service role key into your environment.
4. Confirm Row Level Security is enabled on user tables.

## Install as an app (PWA)

- **Android (Chrome)**: open the site, tap the menu (three dots), then **Install app**.
- **iPhone (Safari)**: tap **Share**, then **Add to Home Screen**, then **Add**.
- **Desktop (Chrome / Edge)**: click the install icon in the address bar, then **Install**.

Offline, the app opens its shell and shows cached data with timestamps. It never presents cached prices as live.

## Security

- API keys are read server-side only and never shipped to the browser.
- User-supplied URLs pass SSRF checks and an allow-list of retailer domains before any automation runs.
- Per-IP rate limiting, request timeouts, retries with backoff, concurrency caps and an agent-run budget protect usage costs.
- Supabase Row Level Security isolates user data.

See [SECURITY.md](SECURITY.md).

## Scripts

| Command | Action |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | Lint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (vitest) |
| `npm run icons` | Regenerate PWA icons |

## Limitations

- Prices come from public pages and can change or be blocked; always confirm at checkout.
- `snippet_only` and `unverified` offers are not confirmed prices.
- Delivery cost appears only when found; otherwise basket totals are marked unknown.
- Bank/card offers are shown as page text with unverified conditions, never as guaranteed discounts.
- Price history starts when tracking starts; nothing is backfilled.
- Not affiliated with any retailer.

## Roadmap

- [ ] **Quick Commerce Battle**: Blinkit vs Zepto basket comparison by pincode, with live TinyFish agent progress
- [ ] Swiggy Instamart, BigBasket, JioMart (only where access is permitted)
- [ ] More retailers and categories
- [ ] Push notifications for price alerts
- [ ] Browser extension

## Contributing

PRs are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Keep the no-fabrication rule intact.

## License

MIT, see [LICENSE](LICENSE).

<div align="center">

Built with TinyFish web agents for the hackathon.

</div>
