# HANDOFF: PricePilot AI (state saved 2026-11-01)

Read `CLAUDE.md` first (rules). This file says where the work stands so any session can continue.

## Live and repo
- Live (OLD build, before theme/shop work): https://pricepilot-ai-sigma.vercel.app. Vercel project `pricepilot-ai`, team `nitish-team`. Deployment protection is off. TinyFish + Anthropic keys are set in Vercel production env (secret). Supabase NOT connected yet.
- GitHub: Cod4Nitish/pricepilot-ai. `main` = last deployed state. Branch `wip/shop-engine` = everything below (work in progress).
- Preview locally: `NEXT_DIST_DIR=.next-qa npx next dev -p 3200` then http://localhost:3200. Local keys live in `.env.local` (gitignored). User wants to approve on localhost BEFORE any production deploy.

## Done (verified)
- Portfolio-style flat theme + light 3D utilities (`globals.css`), top navbar, one smart search (type + voice), Uber-style location ask (`/api/geo/pincode`), automatic E-Commerce/Quick routing (`/api/intent`).
- Fast Commerce (Blinkit/Zepto) + Live Deal Battle (`/fast`, `/battle`), unified engine (`src/lib/engine`, `/api/engine/query`).
- Query A "Samsung Galaxy S24 256GB" tested with real TinyFish: Flipkart Rs 53,199 verified (Croma price unreadable, Amazon offers excluded).
- Universal search backend: `src/lib/shop/*` (parser, discovery, pipeline, offers, decision), `/api/shop`, `/api/shop/delivery`, `/api/shop/run/[id]`; UI `/shop` + `src/components/shop/*` (tested with dev-only `?mock=1`).
- Tests: ~256 passing (`npx vitest run`), `npx tsc --noEmit` clean at last check.

## LATEST STATUS (updated just before the Claude usage limit)
- Query B re-tested with real TinyFish after guards: PASS-ish. 1 pick, Google Pixel 10A, Flipkart Rs 48,499 verified, 7 offers, score 51.6 (camera/display/software missing, honest). No absurd prices anymore.
- Query C: parser + LLM extraction OK; waiting on agent D's engine fix (laptop GPU = spec, not model) in src/lib/engine/ecommerce/{entity,resolve}.ts + src/lib/match.ts. Last `tsc` showed `src/lib/match.ts(101): Cannot find name 'sp'` = agent D was mid-edit: FIX THIS FIRST (`npx tsc --noEmit`), then run `npx vitest run`, then re-test C: `python /tmp/shopq.py "Gaming laptop RTX 4050 under 70000"` (script: POST localhost:3200/api/shop, prints groups/prices; recreate if /tmp was cleared).
- Pending user decisions: Supabase terms, which account to switch to, approval to deploy after localhost preview.

## Known problems (older notes, partly fixed above)
1. Query B "Best phone under 50000": discovery works, but offer prices were implausible (Rs 274 / 128 / 3,199: accessories/EMI numbers). Guards + honest scoring (score null unless >= 50% evidence) were requested from the P agent. RE-TEST.
2. Query C "Gaming laptop RTX 4050 under 70000": parsed correctly, LLM extraction fixed, but no verified store prices: (a) retailer lookups used long part numbers, (b) engine rejected real "MSI Katana 15" offers because GPU "4050" was treated as a model number (agent D was asked to treat GPU as a spec). RE-TEST.
3. Croma price not readable (agent fallback with `stealth` untested), Reliance/Vijay mostly no results, stock often "unknown".
4. Blinkit/Zepto pincode flow never tested live.

## Not done yet
- Supabase (user must run `vercel integration accept-terms supabase` interactively, or give URL + anon + service_role keys; then run `supabase/migrations/0001_init.sql`).
- Live Deal Battle for e-commerce products, Lighthouse/axe measurements (docs/visual-qa.md says NOT MEASURED), docs/screenshots refresh, README update for new features.
- Final: typecheck + tests + `NEXT_DIST_DIR=.next-check npx next build`, show on localhost, user approves, then `vercel deploy --prod --yes` and verify the live URL.

## Commands
- Real-query harness used for testing: POST `http://localhost:3200/api/shop` `{"query": "..."}` (needs `.env.local` TINYFISH_API_KEY; consumes credits).
- Never commit `.env*`, `.next*`, `.claude/`, logs.
