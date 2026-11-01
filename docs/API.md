# API Reference

All endpoints return JSON. Types are in `src/lib/types.ts`.

If server configuration is missing, endpoints return `503` with:

```json
{ "error": { "code": "NOT_CONFIGURED", "message": "..." } }
```

Sample data is never returned.

| Method | Path | Body / Query | Response |
|---|---|---|---|
| POST | `/api/search` | `{ "query": string }` | `SearchResponse` or `ApiError` |
| GET | `/api/runs/:id` | none | `AgentRun` (status and steps of a run) |
| GET | `/api/history` | `key=<offerKey>&days=7, 30 or 90` | `{ "points": PricePoint[] }` |
| GET/POST/DELETE | `/api/watchlist` | Bearer Supabase token | `WatchlistItem[]` |
| GET/POST/DELETE | `/api/alerts` | Bearer Supabase token | `{ "alerts": [...] }` |
| POST | `/api/basket` | `{ "lines": BasketLine[] }` | `BasketPlan` or `ApiError` |
| POST | `/api/assistant` | `{ "messages": {role, content}[] }` | `{ "reply": string, "search"?: SearchResponse }` |
| GET | `/api/health` | none | `{ "tinyfish": boolean, "supabase": boolean, "claude": boolean }` |

Authenticated routes expect `Authorization: Bearer <supabase access token>`.

## Key types

- `BasketLine`: `{ query: string, qty: number }`
- `BasketPlan`: per-store lines, subtotal, delivery (nullable), total (null if delivery unknown), plus `unresolved` queries, `totalVerified` and `caveats`.
- `AgentRun`: `kind` (search, refresh, assistant, verify), `status` (pending, running, completed, failed), `steps[]`.
- `PricePoint`: `{ price, observedAt }`, only real observations.
- Offers carry a verification level: `verified`, `agent_verified`, `snippet_only`, `unverified`.
