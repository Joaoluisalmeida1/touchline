-- Touchline — 0003: transfer market, ledger, progression log, notifications, audit, jobs

create table public.transfer_listings (
  id                 uuid primary key default gen_random_uuid(),
  game_id            uuid not null references public.games(id) on delete cascade,
  player_id          uuid not null references public.game_players(id) on delete cascade,
  seller_club_id     uuid not null references public.game_clubs(id) on delete cascade,
  asking_price_cents bigint not null check (asking_price_cents > 0),
  status             text not null default 'active' check (status in ('active','sold','withdrawn','expired')),
  created_at         timestamptz not null default now(),
  expires_at         timestamptz
);
create unique index transfer_listings_one_active on public.transfer_listings(player_id) where status = 'active';
create index transfer_listings_game_idx on public.transfer_listings(game_id, status);

create table public.transfer_offers (
  id                  uuid primary key default gen_random_uuid(),
  game_id             uuid not null references public.games(id) on delete cascade,
  player_id           uuid not null references public.game_players(id) on delete cascade,
  buyer_club_id       uuid not null references public.game_clubs(id) on delete cascade,
  seller_club_id      uuid not null references public.game_clubs(id) on delete cascade,
  amount_cents        bigint not null check (amount_cents > 0),
  wage_offer_cents    bigint check (wage_offer_cents is null or wage_offer_cents >= 0),
  status              text not null default 'pending'
                        check (status in ('pending','accepted','rejected','cancelled','expired','superseded')),
  counter_amount_cents bigint,
  response_reason     text,
  idempotency_key     text not null unique,
  created_by          uuid not null references public.profiles(id),
  expires_at          timestamptz not null,
  created_at          timestamptz not null default now(),
  responded_at        timestamptz,
  check (buyer_club_id <> seller_club_id)
);
create unique index transfer_offers_one_pending on public.transfer_offers(buyer_club_id, player_id) where status = 'pending';
create index transfer_offers_seller_idx on public.transfer_offers(seller_club_id, status);
create index transfer_offers_buyer_idx on public.transfer_offers(buyer_club_id, status);

create table public.transfer_transactions (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games(id) on delete cascade,
  player_id     uuid not null references public.game_players(id) on delete cascade,
  from_club_id  uuid references public.game_clubs(id),
  to_club_id    uuid references public.game_clubs(id),
  price_cents   bigint not null check (price_cents >= 0),
  offer_id      uuid unique references public.transfer_offers(id),
  season_number integer not null,
  completed_at  timestamptz not null default now()
);
create index transfer_tx_game_idx on public.transfer_transactions(game_id, completed_at desc);

create table public.club_ledger (
  id                 bigint generated always as identity primary key,
  game_id            uuid not null references public.games(id) on delete cascade,
  club_id            uuid not null references public.game_clubs(id) on delete cascade,
  event_type         text not null check (event_type in (
                       'initial_balance','transfer_sale','transfer_purchase','gate_receipts','sponsorship',
                       'wages','prize_money','result_bonus','adjustment')),
  amount_cents       bigint not null,
  reference_id       text,
  idempotency_key    text not null unique,
  balance_after_cents bigint not null,
  season_number      integer,
  round_number       integer,
  created_at         timestamptz not null default now()
);
create index club_ledger_club_idx on public.club_ledger(club_id, id desc);

create table public.player_progression_log (
  id                bigint generated always as identity primary key,
  game_id           uuid not null references public.games(id) on delete cascade,
  game_player_id    uuid not null references public.game_players(id) on delete cascade,
  fixture_id        uuid references public.fixtures(id) on delete set null,
  season_number     integer not null,
  round_number      integer,
  old_ovr           smallint not null,
  new_ovr           smallint not null,
  xp_before         numeric(9,3),
  xp_after          numeric(9,3),
  change_reason_json jsonb not null default '{}'::jsonb,
  algorithm_version text not null,
  idempotency_key   text not null unique,
  created_at        timestamptz not null default now()
);
create index ppl_player_idx on public.player_progression_log(game_player_id, id);

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid references public.games(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  type         text not null,
  payload_json jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

create table public.audit_log (
  id            bigint generated always as identity primary key,
  game_id       uuid references public.games(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index audit_log_game_idx on public.audit_log(game_id, id desc);

create table public.scheduled_jobs (
  id              uuid primary key default gen_random_uuid(),
  game_id         uuid references public.games(id) on delete cascade,
  fixture_id      uuid references public.fixtures(id) on delete cascade,
  job_type        text not null check (job_type in ('process_matchday','end_season','import')),
  status          text not null default 'queued' check (status in ('queued','running','done','failed','dead')),
  attempts        smallint not null default 0,
  run_after       timestamptz not null default now(),
  lease_until     timestamptz,
  idempotency_key text not null unique,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index scheduled_jobs_due_idx on public.scheduled_jobs(status, run_after);
