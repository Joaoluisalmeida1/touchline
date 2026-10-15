-- Touchline — 0001: extensions + global reference catalog (read-only for players)
-- Catalog = data imported from providers (PlayerElo) or synthetic dev seeds.
-- Game state per private league lives in 0002 and only *references* the catalog.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Never let PUBLIC execute new functions by default; we grant explicitly.
alter default privileges in schema public revoke execute on functions from public;
revoke create on schema public from public;

create table public.source_providers (
  id            text primary key,              -- 'playerelo' | 'synthetic'
  name          text not null,
  base_url      text,
  license_notes text not null default '',
  is_synthetic  boolean not null default false
);

insert into public.source_providers (id, name, base_url, license_notes, is_synthetic) values
  ('playerelo', 'PlayerElo', 'https://data-api.playerelo.football',
   'Ver docs/data-licensing.md. Termos de retenção/redistribuição não publicados; uso comercial só em planos pagos.', false),
  ('synthetic', 'Synthetic dev data (FICTIONAL)', null,
   'Dados 100% fictícios gerados localmente para desenvolvimento. Não representam pessoas reais.', true);

create table public.source_leagues (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null references public.source_providers(id),
  external_id   text not null,
  name          text not null,
  country       text,
  strength      numeric,                        -- provider league rating if exposed (nullable)
  metadata_json jsonb not null default '{}'::jsonb,
  enabled       boolean not null default false, -- admin selection for import
  updated_at    timestamptz not null default now(),
  unique (provider, external_id)
);

create table public.source_clubs (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null references public.source_providers(id),
  external_id   text not null,
  league_id     uuid references public.source_leagues(id) on delete set null,
  name          text not null,
  short_name    text,
  team_elo      numeric,
  metadata_json jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  unique (provider, external_id)
);
create index source_clubs_league_idx on public.source_clubs(league_id);

create table public.source_players (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null references public.source_providers(id),
  external_id        text not null,
  display_name       text not null,
  position_group     text check (position_group in ('GK','DEF','MID','ATT')),
  position_detail    text,
  birth_date         date,          -- only if provider supplies it; never invented for real people
  nationality        text,
  club_id            uuid references public.source_clubs(id) on delete set null,
  league_id          uuid references public.source_leagues(id) on delete set null,
  provider_elo       numeric,
  ear_180            numeric,
  ear_12m            numeric,
  ear_career         numeric,
  market_value_eur   bigint,
  games_played       integer,
  total_minutes      integer,
  attributes_json    jsonb not null default '{}'::jsonb,  -- per-field provenance + optional extras
  data_quality_flags text[] not null default '{}',
  source_updated_at  timestamptz,
  imported_at        timestamptz not null default now(),
  unique (provider, external_id)
);
create index source_players_club_idx on public.source_players(club_id);
create index source_players_league_idx on public.source_players(league_id);

create table public.import_runs (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null references public.source_providers(id),
  selected_league_ids text[] not null,             -- provider external ids
  options_json        jsonb not null default '{}'::jsonb,
  status              text not null default 'running'
                        check (status in ('running','paused','completed','failed','cancelled')),
  pages_done          integer not null default 0,
  requests_used       integer not null default 0,
  errors_json         jsonb not null default '[]'::jsonb,
  report_json         jsonb,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create table public.import_checkpoints (
  run_id        uuid not null references public.import_runs(id) on delete cascade,
  resource      text not null,     -- e.g. 'league_players:94'
  page_key      text not null,     -- e.g. 'offset:200'
  status        text not null check (status in ('done','empty','error')),
  response_hash text,
  rows_count    integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (run_id, resource, page_key)
);

-- Raw payload retention is OFF by default (licence unclear) -> hash + metadata only.
create table public.import_raw_records (
  id           bigint generated always as identity primary key,
  run_id       uuid not null references public.import_runs(id) on delete cascade,
  resource     text not null,
  page_key     text not null,
  payload_hash text not null,
  payload      jsonb,             -- null unless PLAYERELO_RETAIN_RAW=true and licence allows
  fetched_at   timestamptz not null default now()
);

create table public.dataset_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  label               text not null,
  source              text not null references public.source_providers(id),
  is_synthetic        boolean not null default false,
  scoring_version     text not null,
  league_ids          uuid[] not null default '{}',
  status              text not null default 'draft' check (status in ('draft','finalized','archived')),
  params_json         jsonb not null default '{}'::jsonb,   -- calibration params used by rating engine
  data_quality_report jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  finalized_at        timestamptz
);

create table public.dataset_snapshot_clubs (
  snapshot_id    uuid not null references public.dataset_snapshots(id) on delete cascade,
  source_club_id uuid not null references public.source_clubs(id),
  league_id      uuid not null references public.source_leagues(id),
  name           text not null,
  short_name     text,
  strength       numeric not null,     -- avg OVR of best XI at snapshot
  reputation     smallint not null check (reputation between 1 and 100),
  primary key (snapshot_id, source_club_id)
);

create table public.dataset_snapshot_players (
  snapshot_id          uuid not null references public.dataset_snapshots(id) on delete cascade,
  source_player_id     uuid not null references public.source_players(id),
  source_club_id       uuid references public.source_clubs(id),
  display_name         text not null,
  position_group       text not null check (position_group in ('GK','DEF','MID','ATT')),
  position_detail      text,
  initial_ovr          smallint not null check (initial_ovr between 1 and 99),
  initial_potential    smallint not null check (initial_potential between 1 and 99),
  hidden_development_rate numeric(4,3) not null default 1.0,
  base_value_eur       bigint not null check (base_value_eur >= 0),
  age_at_import        smallint,
  birth_date           date,
  confidence           numeric(4,3) not null default 1.0,
  derived_profile_json jsonb not null default '{}'::jsonb,
  derivation_json      jsonb not null default '{}'::jsonb,
  primary key (snapshot_id, source_player_id),
  check (initial_potential >= initial_ovr or age_at_import >= 30)
);
create index dsp_club_idx on public.dataset_snapshot_players(snapshot_id, source_club_id);
