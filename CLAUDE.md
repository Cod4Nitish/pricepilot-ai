# PricePilot AI: project rules for Claude

Next.js 15 (App Router) + TypeScript strict + Tailwind 4 + Supabase + TinyFish. India, INR.
Repo: github.com/Cod4Nitish/pricepilot-ai. Live: https://pricepilot-ai-sigma.vercel.app

## Non-negotiable rules

1. **Never fabricate data.** No invented prices, MRP, stock, delivery dates/ETAs, fees, discounts, specs, benchmark scores, agent progress or price history. Unknown = `null` and the UI says "Unknown" / "Not verified". Never treat a missing fee as 0.
2. **Verification levels are sacred:** `verified` (read from the fetched retailer page), `agent_verified` (read by a TinyFish agent on the live page), `snippet_only`, `unverified`. Only the first two can win "cheapest" or "best".
3. **Never compare mismatched variants** (128 vs 256 GB, S24 vs S24 Ultra/FE, refurbished vs new). Low-confidence matches go to an "excluded" list.
4. **Conditional offers** (bank/coupon/EMI) are shown verbatim and never applied unless the user picked a matching card/coupon.
5. **Secrets:** keys live only in server env (`.env.local`, Vercel env). Never in code, docs, commits, logs or `NEXT_PUBLIC_*`. Never print a key. `.env*` is gitignored.
6. **Respect sites:** no CAPTCHA/anti-bot bypass, no checkout/payment automation, no logins without user consent, SSRF-validate every user URL (`src/lib/ssrf.ts`).
7. **Cost control:** bounded concurrency, caching, per-IP rate limits, capped agent runs. Do not run real TinyFish calls in unit tests.
8. **Missing config returns 503 `NOT_CONFIGURED`**, never sample data. Demo/mock paths must be hard-disabled in production.
9. **Ask before outward-facing actions** the user has not approved: deploy to production, push, creating/deleting remote resources, accepting terms. Preview on localhost first and wait for the user's approval before deploying.

## Where things live

- `src/lib/types.ts`: original e-commerce contract. `src/lib/shop/types.ts`: universal search contract (ParsedQuery, ProductGroup, ShopOffer, Decision, ShopResponse). `src/lib/engine/**`: unified engine (schema, entity resolution, ranking, quick-commerce basket solver, orchestrator). `src/lib/fast/**`: quick commerce (Blinkit/Zepto) + Live Deal Battle. `src/lib/tinyfish.ts`: the only TinyFish client (Search, Fetch, Agent).
- Routes: `/api/search`, `/api/engine/query`, `/api/shop*`, `/api/fast/*`, `/api/battle/*`, `/api/intent`, `/api/geo/pincode`, `/api/health`.
- UI: `src/app/**`, `src/components/**`. Design tokens in `src/app/globals.css`.

## TinyFish facts (verified against official docs)

- Auth header `X-API-Key`. Search `GET https://api.search.tinyfish.ai` (`include_domains`, `location=IN`). Fetch `POST https://api.fetch.tinyfish.ai` (`urls<=10`, `format`, `ttl`). Agent `POST https://agent.tinyfish.ai/v1/automation/run-async|run-sse`, poll `GET /v1/runs/{id}`, cancel `POST /v1/runs/{id}/cancel`.
- Search/Fetch are free within a daily allowance; Agent draws from the wallet. 402 = out of credits (non-retryable).

## Design system (portfolio theme)

Warm canvas `#fbfbf8`, ink `#202124`, brand blue `#405dea`, pastel chips (mint, lilac, peach, sun), pill buttons with a solid bottom edge, thin dark borders, Inter, heavy tight headings, mono uppercase `.eyebrow` labels. Light default, dark available. Light 3D only through `.lift-3d`, `.tilt-3d`, `.chip-3d` (disabled for touch and reduced motion). No gradients, glow or typing animations. Keep WCAG AA contrast, 44px touch targets, visible focus, never colour-only status. Skills in `.claude/skills` (web-design-guidelines, vercel-react-best-practices, ui-ux-pro-max) are guidance only.

## Workflow

- Before finishing any change run: `npx tsc --noEmit`, `npx vitest run`, and a production build (`NEXT_DIST_DIR=.next-check npx next build`, delete the folder after). Do not build in `.next` while the dev server or another agent is using it.
- Preview server: `NEXT_DIST_DIR=.next-qa npx next dev -p 3200`. Check 390px and 1440px, no horizontal overflow (`scrollWidth === clientWidth`).
- Multi-agent work: one owner per file/directory; shared contracts first; other agents' files are read-only to you.
- Commits end with the Co-Authored-By trailer. Never commit `.next*`, `.env*`, `.claude/`, logs or screenshots of competitors.
- Report honestly: what was actually tested (real TinyFish queries, tests, build) and what was not.
