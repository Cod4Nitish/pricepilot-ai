# Security Policy

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's "Report a vulnerability" (Security tab, private advisory) on this repository. Expect an initial reply within 7 days. Please allow time for a fix before public disclosure.

## Key handling

- All keys live in environment variables (Vercel project settings, or gitignored `.env.local` locally). Never commit them.
- `TINYFISH_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are server-only and must never be prefixed `NEXT_PUBLIC_` or logged.
- Use separate keys and Supabase projects for development and production.
- If a key leaks, rotate it immediately at the provider, then update the environment.
- User data access relies on Supabase Row Level Security and Bearer tokens.

## SSRF policy

Server-side fetching must only target `http(s)` URLs on public hosts. Block private, loopback and link-local ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7), non-HTTP schemes, and credentials in URLs. Retailer fetches go through TinyFish rather than directly from our server where possible. Validate redirects.

## Cron endpoint

Scheduled endpoints require `Authorization: Bearer <CRON_SECRET>`.
