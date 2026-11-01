# Architecture

```
Browser (Next.js PWA)
   |
Next.js route handlers (/api/*)
   |-- TinyFish layer: Search -> Fetch -> Agent fallback
   |-- Matching + verification
   |-- Claude (assistant)
   '-- Supabase (auth, watchlist, alerts, price observations)
```

## TinyFish layer
1. **Search** discovers candidate product URLs.
2. **Fetch** reads each page and extracts title and price.
3. **Agent** is used only when Fetch cannot produce a price; slower and costlier.

## Matching
Candidates are compared on brand, model and variant attributes (storage, RAM, size, colour). Any conflicting attribute (for example 128GB vs 256GB) excludes the candidate from the comparison.

## Verification levels
`verified` (Fetch), `agent_verified` (Agent), `snippet_only` (search snippet), `unverified` (no trustworthy price). Only verified levels contribute to basket totals and "best price" claims.

## Data and history
Price observations are stored when actually seen. History charts only plot stored points; nothing is interpolated or invented.

## Runs
Long operations create an `AgentRun` with steps, pollable at `/api/runs/:id`.

## Failure behaviour
Missing config returns `503 NOT_CONFIGURED`. Provider failures surface as errors or lower verification levels, never fabricated data.
