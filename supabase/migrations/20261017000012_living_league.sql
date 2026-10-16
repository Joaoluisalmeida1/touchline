-- Touchline — 0012: "Living league" (phase 1): event log, newspaper, round awards, web push.
-- Additive and drop-free. Everything here is written by the server (service connection) after a matchday;
-- members only read.

-- Append-only log of facts per game (results, hat-tricks, upsets, awards…). One row per (round, kind, key).
create table if not exists public.game_events (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references public.games(id) on delete cascade,
  season      integer not null,
  round       integer not null,
  kind        text not null,
  key         text not null,
  club_id     uuid references public.game_clubs(id) on delete set null,
  player_id   uuid references public.game_players(id) on delete set null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (game_id, season, round, kind, key)
);
create index if not exists game_events_game_idx on public.game_events(game_id, season, round);
create index if not exists game_events_kind_idx on public.game_events(game_id, kind);

-- One newspaper edition per round: ranked stories.
create table if not exists public.news_items (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  season      integer not null,
  round       integer not null,
  rank        integer not null,
  kind        text not null,
  headline    text not null,
  body        text not null default '',
  fixture_id  uuid references public.fixtures(id) on delete set null,
  club_ids    uuid[] not null default '{}',
  player_ids  uuid[] not null default '{}',
  version     text not null,
  created_at  timestamptz not null default now(),
  unique (game_id, season, round, rank)
);
create index if not exists news_items_game_idx on public.news_items(game_id, season desc, round desc, rank);

create table if not exists public.round_awards (
  game_id     uuid not null references public.games(id) on delete cascade,
  season      integer not null,
  round       integer not null,
  awards      jsonb not null,
  version     text not null,
  created_at  timestamptz not null default now(),
  primary key (game_id, season, round)
);

alter table public.game_events enable row level security;
alter table public.news_items enable row level security;
alter table public.round_awards enable row level security;
-- Supabase's default privileges grant everything on new tables to anon/authenticated: reset, then allow reads only
revoke all on public.game_events, public.news_items, public.round_awards from anon, authenticated;
grant select on public.game_events, public.news_items, public.round_awards to authenticated;
create policy member_read on public.game_events for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.news_items for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.round_awards for select to authenticated using (public.is_game_member(game_id));

-- Web push: one row per browser/device. Users manage their own subscriptions through the server (no direct grants).
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

alter table public.notifications add column if not exists pushed_at timestamptz;
create index if not exists notifications_unpushed_idx on public.notifications(created_at) where pushed_at is null;
