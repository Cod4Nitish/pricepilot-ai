-- PricePilot AI initial schema. Writes to catalog tables go through the service role only.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.retailers (
  id text primary key,
  name text not null,
  domain text not null unique,
  enabled boolean not null default true
);
insert into public.retailers (id, name, domain) values
  ('amazon', 'Amazon.in', 'amazon.in'),
  ('flipkart', 'Flipkart', 'flipkart.com'),
  ('croma', 'Croma', 'croma.com'),
  ('reliance', 'Reliance Digital', 'reliancedigital.in'),
  ('vijay', 'Vijay Sales', 'vijaysales.com')
on conflict (id) do nothing;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  query_key text not null unique,
  title text not null,
  brand text,
  model text,
  spec jsonb not null default '{}'::jsonb,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.product_offers (
  offer_key text primary key,
  product_id uuid references public.products(id) on delete set null,
  retailer_id text not null references public.retailers(id),
  url text not null,
  title text not null,
  image_url text,
  last_price numeric(12,2),
  last_mrp numeric(12,2),
  availability text not null default 'unknown',
  verification text not null default 'unverified',
  match_confidence numeric(3,2) not null default 0,
  is_match boolean not null default false,
  last_checked_at timestamptz not null default now()
);
create index if not exists product_offers_product_idx on public.product_offers(product_id);
create index if not exists product_offers_retailer_idx on public.product_offers(retailer_id);

-- Only REAL observed prices (read from a retailer page) are inserted here.
create table if not exists public.price_observations (
  id bigint generated always as identity primary key,
  offer_key text not null references public.product_offers(offer_key) on delete cascade,
  retailer_id text not null references public.retailers(id),
  price numeric(12,2) not null check (price > 0),
  mrp numeric(12,2),
  verification text not null check (verification in ('verified','agent_verified')),
  observed_at timestamptz not null default now()
);
create index if not exists price_obs_key_time_idx on public.price_observations(offer_key, observed_at desc);

create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  run_id text,
  user_id uuid references auth.users(id) on delete set null,
  query text not null,
  parsed jsonb not null default '{}'::jsonb,
  offer_count int not null default 0,
  best_offer_key text,
  created_at timestamptz not null default now()
);
create index if not exists searches_user_idx on public.searches(user_id, created_at desc);

create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_query text not null,
  title text not null,
  image_url text,
  last_price numeric(12,2),
  target_price numeric(12,2),
  created_at timestamptz not null default now()
);
create index if not exists watchlists_user_idx on public.watchlists(user_id);

create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  target_price numeric(12,2) not null check (target_price > 0),
  active boolean not null default true,
  triggered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists price_alerts_user_idx on public.price_alerts(user_id);
create index if not exists price_alerts_watch_idx on public.price_alerts(watchlist_id) where active;

create table if not exists public.shopping_baskets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My basket',
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists baskets_user_idx on public.shopping_baskets(user_id);

create table if not exists public.agent_runs (
  id text primary key,
  kind text not null check (kind in ('search','refresh','assistant','verify')),
  status text not null check (status in ('pending','running','completed','failed')),
  steps jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text
);

-- Row level security
alter table public.profiles enable row level security;
alter table public.retailers enable row level security;
alter table public.products enable row level security;
alter table public.product_offers enable row level security;
alter table public.price_observations enable row level security;
alter table public.searches enable row level security;
alter table public.watchlists enable row level security;
alter table public.price_alerts enable row level security;
alter table public.shopping_baskets enable row level security;
alter table public.agent_runs enable row level security;

-- Public read-only catalog (writes: service role only, which bypasses RLS)
create policy "retailers readable" on public.retailers for select using (true);
create policy "products readable" on public.products for select using (true);
create policy "offers readable" on public.product_offers for select using (true);
create policy "observations readable" on public.price_observations for select using (true);

-- User-owned rows
create policy "profile own select" on public.profiles for select using (auth.uid() = id);
create policy "profile own update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "profile own insert" on public.profiles for insert with check (auth.uid() = id);

create policy "searches own select" on public.searches for select using (auth.uid() = user_id);

create policy "watchlists own select" on public.watchlists for select using (auth.uid() = user_id);
create policy "watchlists own insert" on public.watchlists for insert with check (auth.uid() = user_id);
create policy "watchlists own update" on public.watchlists for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "watchlists own delete" on public.watchlists for delete using (auth.uid() = user_id);

create policy "alerts own select" on public.price_alerts for select using (auth.uid() = user_id);
create policy "alerts own insert" on public.price_alerts for insert with check (
  auth.uid() = user_id and exists (select 1 from public.watchlists w where w.id = watchlist_id and w.user_id = auth.uid())
);
create policy "alerts own update" on public.price_alerts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "alerts own delete" on public.price_alerts for delete using (auth.uid() = user_id);

create policy "baskets own select" on public.shopping_baskets for select using (auth.uid() = user_id);
create policy "baskets own insert" on public.shopping_baskets for insert with check (auth.uid() = user_id);
create policy "baskets own update" on public.shopping_baskets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "baskets own delete" on public.shopping_baskets for delete using (auth.uid() = user_id);

-- agent_runs: no client policies (service role only)
