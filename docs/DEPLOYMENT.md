# Deployment (Vercel + Supabase)

## 1. Supabase
1. Create a project (use a separate one for production).
2. Apply `supabase/migrations/*.sql` in order (SQL editor or `npx supabase db push`).
3. Note the project URL, anon key and service role key.

## 2. Vercel
1. Import the GitHub repo in Vercel (framework: Next.js, Node 22).
2. In Project Settings > Environment Variables, add for Production (and Preview if wanted, with non-production credentials):
   `TINYFISH_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET`.
3. Deploy. Update the Supabase Auth site URL and redirect URLs to the deployed domain.

## 3. Cron (suggestion)
To refresh watched prices periodically, schedule a request (Vercel Cron, GitHub Actions schedule, or an external scheduler) that calls the refresh endpoint with header `Authorization: Bearer <CRON_SECRET>`. Keep the secret in the scheduler's secret store. Choose a modest frequency to control TinyFish usage.

## 4. Post-deploy checklist
- [ ] `GET /api/health` reports expected `tinyfish`, `supabase`, `claude` values.
- [ ] A product search returns offers with verification badges.
- [ ] Unconfigured features return `503 NOT_CONFIGURED`, not sample data.
- [ ] Sign-in works; watchlist add/remove works.
- [ ] PWA installs (Android Chrome, iOS Add to Home Screen, desktop).
- [ ] No secrets appear in client bundles or logs.
- [ ] Cron endpoint rejects requests without the bearer secret.
