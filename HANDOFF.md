# HANDOFF: PricePilot AI (saved 2026-11-01, end of hackathon day)

Read `CLAUDE.md` first. Everything below is committed, pushed (`main` = `wip/shop-engine`) and deployed.

## Live
- https://pricepilot-ai-sigma.vercel.app (Vercel project `pricepilot-ai`, team `nitish-team`). Deploy: `vercel deploy --prod --yes`.
- Production env (Vercel, secret): TINYFISH_API_KEY, ANTHROPIC_API_KEY, PP_KEY_SECRET (personal-key encryption),
  PP_AGENT_MAX_PER_SEARCH=1, PP_AGENT_MAX_DURATION_S=40, PP_AGENT_TIMEOUT_MS=45000. Supabase NOT connected.

## Working (verified live with real searches)
- /shop engine for all e-commerce searches (homepage + /discover forward there). Intents: recommendation, feature,
  exact, comparison, URL. Budget bands + gaming/camera/battery/student.
- Category configs: smartphone, laptop, headphones, tv. Any other category -> generic search fallback
  (pipeline.ts `generic()`), listings as product cards, verified first.
- Strict requirements (src/lib/shop/requirements.ts): requested brand + product type enforced at candidate, offer,
  final stages. "sony wireless headphone under 5000" -> Sony WH-CH520 Rs 2,690.
- Cost-aware routing (search.ts, tinyfish.ts, cost/*): Fetch first, paid Agent only when justified, early stop at 2
  verified retailers, 429 Retry-After/cooldown, metered num_of_steps, /api/cost, per-request usage.
- TrueCost (engine/ecommerce/truecost.ts), Deal Receipt (receipts/build.ts), Research Cost panel, live Research Monitor
  (POST /api/shop {stream:true} NDJSON), Save product / Save research (IndexedDB, /saved, zero API on reopen).
- Personal TinyFish key: Settings > TinyFish connection (AES-GCM httpOnly cookie, /api/key).
- Mobile UX pass, PWA manifest/SW v2 (never caches /api), homepage SVG hero + category cards.
- Tests: 368 passing (`npx vitest run`), tsc clean, build OK.

## Not done / known limits
- Local price monitor: code in src/components/saved/{LocalPriceMonitor,PriceMonitorPanel}.tsx but NOT mounted (untested).
- Budget Rescue not built. Monitor category not added.
- Generic categories: many cards unverified (fetch shows no price; agent capped at 1).
- Croma/Reliance/Vijay prices rarely readable. Shipping rarely shown -> totals are minimums.
- Saved data is per-browser only. Offline SW behaviour not verified in a real browser.
- Research cost panel buttons stack tall on mobile; settings "tinyfish.ai" link small.

## Measured (README has the table/chart)
- Legacy vs adaptive routing, 3 queries: 6 agent runs / 43 steps / $0.688 -> 0 / 0 / $0.
