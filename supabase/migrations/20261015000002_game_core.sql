-- Touchline — 0002: identities, private leagues (games), clubs, players, tactics, fixtures, matches

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text not null check (char_length(display_name) between 2 and 40),
  avatar_settings jsonb not null default '{}'::jsonb,
  is_admin        boolean not null default false,   -- platform admin (import tools); set manually
  created_at      timestamptz not null default now()
);

-- auto-create a profile row for every new auth user
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
                                split_part(coalesce(new.email, 'manager'), '@', 1), 'manager') || '', 40))
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.games (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (char_length(name) between 3 and 60),
  owner_user_id        uuid not null references public.profiles(id),
  dataset_snapshot_id  uuid not null references public.dataset_snapshots(id),
  source_league_id     uuid not null references public.source_leagues(id),
  status               text not null default 'setup' check (status in ('setup','active','finished','archived')),
  current_season       integer not null default 1 check (current_season >= 1),
  current_matchday     integer not null default 0 check (current_matchday >= 0),  -- last completed round
  timezone             text not null default 'Europe/Lisbon',
  tick_mode            text not null default 'manual' check (tick_mode in ('manual','daily')),
  max_managers         smallint not null default 20 check (max_managers between 2 and 20),
  settings_json        jsonb not null default '{}'::jsonb,
  next_deadline_at     timestamptz,
  processing_lease_until timestamptz,          -- non-null & in future => matchday processing in progress
  processing_round     integer,
  created_at           timestamptz not null default now()
);
create index games_owner_idx on public.games(owner_user_id);

-- invite secret kept out of the games table so it can never be selected by clients
create table public.game_invites (
  game_id     uuid primary key references public.games(id) on delete cascade,
  code_hash   text not null unique,      -- sha256(hex) of the invite code; plaintext never stored
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table public.game_members (
  id        uuid primary key default gen_random_uuid(),
  game_id   uuid not null references public.games(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'manager' check (role in ('owner','manager')),
  joined_at timestamptz not null default now(),
  unique (game_id, user_id)
);
create index game_members_user_idx on public.game_members(user_id);

create table public.game_clubs (
  id               uuid primary key default gen_random_uuid(),
  game_id          uuid not null references public.games(id) on delete cascade,
  source_club_id   uuid references public.source_clubs(id),
  manager_user_id  uuid references public.profiles(id) on delete set null,
  name_snapshot    text not null,
  short_name       text not null,
  primary_color    text not null default '#2d6a4f',
  secondary_color  text not null default '#e9ecef',
  cash_cents       bigint not null,
  reserved_cents   bigint not null default 0 check (reserved_cents >= 0),
  wage_budget_cents bigint not null default 0,
  reputation       smallint not null check (reputation between 1 and 100),
  strength         numeric not null default 0,
  created_at       timestamptz not null default now(),
  unique (game_id, source_club_id),
  -- debt allowed only from running costs (wages); transfers check available funds explicitly
  check (cash_cents >= -50000000000)
);
create unique index game_clubs_one_manager_per_game on public.game_clubs(game_id, manager_user_id)
  where manager_user_id is not null;
create index game_clubs_game_idx on public.game_clubs(game_id);

create table public.game_players (
  id                      uuid primary key default gen_random_uuid(),
  game_id                 uuid not null references public.games(id) on delete cascade,
  source_player_id        uuid references public.source_players(id),
  club_id                 uuid references public.game_clubs(id) on delete set null,
  name_snapshot           text not null,
  position_group          text not null check (position_group in ('GK','DEF','MID','ATT')),
  position_detail         text,
  birth_date              date,
  age_known               boolean not null default false,
  age                     smallint check (age is null or age between 14 and 50),
  initial_ovr             smallint not null check (initial_ovr between 1 and 99),
  season_start_ovr        smallint not null check (season_start_ovr between 1 and 99),
  current_ovr             smallint not null check (current_ovr between 1 and 99),
  potential_cap           smallint not null check (potential_cap between 1 and 99),
  potential_band          text not null default 'C',   -- qualitative, client-visible ('A'..'E')
  hidden_development_rate numeric(4,3) not null default 1.0 check (hidden_development_rate between 0.5 and 1.5),
  profile_json            jsonb not null default '{}'::jsonb,
  form                    numeric(4,2) not null default 0 check (form between -3 and 3),
  morale                  smallint not null default 60 check (morale between 0 and 100),
  fitness                 smallint not null default 100 check (fitness between 0 and 100),
  sharpness               smallint not null default 70 check (sharpness between 0 and 100),
  fatigue                 smallint not null default 0 check (fatigue between 0 and 100),
  injured_matches         smallint not null default 0 check (injured_matches >= 0),
  injury_type             text,
  suspension_matches      smallint not null default 0 check (suspension_matches >= 0),
  yellow_accumulation     smallint not null default 0 check (yellow_accumulation >= 0),
  market_value_cents      bigint not null check (market_value_cents >= 0),
  wage_cents              bigint not null check (wage_cents >= 0),     -- weekly wage
  contract_end_season     integer not null,
  development_xp          numeric(9,3) not null default 0,
  career_minutes          integer not null default 0,
  season_stats_json       jsonb not null default '{}'::jsonb,
  version                 integer not null default 1,
  updated_at              timestamptz not null default now()
);
-- the exact potential is hidden from clients; they only see a band
create or replace function public.set_potential_band() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.potential_band := case
    when new.potential_cap >= 88 then 'A'
    when new.potential_cap >= 82 then 'B'
    when new.potential_cap >= 75 then 'C'
    when new.potential_cap >= 68 then 'D'
    else 'E' end;
  new.updated_at := now();
  return new;
end $$;
create trigger game_players_band before insert or update of potential_cap on public.game_players
  for each row execute function public.set_potential_band();

create unique index game_players_unique_source on public.game_players(game_id, source_player_id)
  where source_player_id is not null;
create index game_players_club_idx on public.game_players(game_id, club_id);
create index game_players_ovr_idx on public.game_players(game_id, current_ovr desc);

create table public.tactics (
  id                 uuid primary key default gen_random_uuid(),
  game_id            uuid not null references public.games(id) on delete cascade,
  club_id            uuid not null unique references public.game_clubs(id) on delete cascade,
  formation          text not null default '4-3-3' check (formation in ('4-3-3','4-2-3-1','4-4-2','4-1-4-1','3-5-2','5-3-2')),
  mentality          text not null default 'balanced' check (mentality in ('defensive','balanced','attacking')),
  tempo              text not null default 'normal'   check (tempo in ('slow','normal','high')),
  pressing           text not null default 'medium'   check (pressing in ('low','medium','high')),
  defensive_line     text not null default 'medium'   check (defensive_line in ('low','medium','high')),
  width              text not null default 'balanced' check (width in ('narrow','balanced','wide')),
  passing_directness text not null default 'mixed'    check (passing_directness in ('short','mixed','direct')),
  transitions        text not null default 'balanced' check (transitions in ('possession','balanced','counter')),
  roles_json         jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now()
);

create table public.seasons (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  number       integer not null check (number >= 1),
  status       text not null default 'active' check (status in ('active','completed')),
  total_rounds integer not null default 0,
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  summary_json jsonb,
  unique (game_id, number)
);

create table public.fixtures (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games(id) on delete cascade,
  season_id     uuid not null references public.seasons(id) on delete cascade,
  round_number  integer not null check (round_number >= 1),
  home_club_id  uuid not null references public.game_clubs(id),
  away_club_id  uuid not null references public.game_clubs(id),
  kickoff_at    timestamptz,
  status        text not null default 'scheduled'
                  check (status in ('scheduled','lineup_locked','processing','completed','failed')),
  result_home   smallint check (result_home >= 0),
  result_away   smallint check (result_away >= 0),
  sim_seed      text,
  engine_version text,
  input_hash    text,
  stats_json    jsonb,
  completed_at  timestamptz,
  check (home_club_id <> away_club_id),
  check ((status = 'completed') = (result_home is not null and result_away is not null)),
  unique (season_id, home_club_id, away_club_id)
);
create index fixtures_round_idx on public.fixtures(game_id, season_id, round_number);
create unique index fixtures_home_once_per_round on public.fixtures(season_id, round_number, home_club_id);
create unique index fixtures_away_once_per_round on public.fixtures(season_id, round_number, away_club_id);

-- current lineup (fixture_id null) + immutable locked copy per fixture
create table public.lineups (
  id                uuid primary key default gen_random_uuid(),
  game_id           uuid not null references public.games(id) on delete cascade,
  club_id           uuid not null references public.game_clubs(id) on delete cascade,
  fixture_id        uuid references public.fixtures(id) on delete cascade,
  formation         text not null,
  starters_json     jsonb not null,   -- [{player_id, slot}]
  bench_json        jsonb not null default '[]'::jsonb,
  instructions_json jsonb not null default '{}'::jsonb,
  auto_generated    boolean not null default false,
  warnings_json     jsonb not null default '[]'::jsonb,
  locked_at         timestamptz,
  updated_at        timestamptz not null default now(),
  unique nulls not distinct (club_id, fixture_id)
);

create table public.match_runs (
  id                 uuid primary key default gen_random_uuid(),
  fixture_id         uuid not null unique references public.fixtures(id) on delete cascade,
  input_hash         text not null,
  simulation_version text not null,
  seed               text not null,
  status             text not null default 'completed' check (status in ('completed','failed')),
  input_snapshot     jsonb not null,
  result_json        jsonb not null,
  started_at         timestamptz not null default now(),
  completed_at       timestamptz not null default now()
);

create table public.match_events (
  id               bigint generated always as identity primary key,
  fixture_id       uuid not null references public.fixtures(id) on delete cascade,
  game_id          uuid not null references public.games(id) on delete cascade,
  sequence_number  integer not null,
  minute           smallint not null check (minute between 0 and 130),
  second           smallint not null default 0 check (second between 0 and 59),
  club_id          uuid references public.game_clubs(id),
  player_id        uuid references public.game_players(id) on delete set null,
  related_player_id uuid references public.game_players(id) on delete set null,
  event_type       text not null check (event_type in (
                     'kickoff','half_time','full_time','goal','own_goal','shot','shot_saved','shot_off_target',
                     'shot_blocked','penalty_awarded','penalty_missed','corner','foul','yellow_card','second_yellow',
                     'red_card','substitution','injury','big_chance','offside')),
  payload_json     jsonb not null default '{}'::jsonb,
  unique (fixture_id, sequence_number)
);
create index match_events_fixture_idx on public.match_events(fixture_id, sequence_number);

create table public.match_player_stats (
  fixture_id        uuid not null references public.fixtures(id) on delete cascade,
  game_player_id    uuid not null references public.game_players(id) on delete cascade,
  game_id           uuid not null references public.games(id) on delete cascade,
  club_id           uuid not null references public.game_clubs(id),
  started           boolean not null default false,
  minutes           smallint not null default 0 check (minutes between 0 and 130),
  rating            numeric(3,1) check (rating between 1 and 10),
  goals             smallint not null default 0,
  assists           smallint not null default 0,
  shots             smallint not null default 0,
  shots_on_target   smallint not null default 0,
  xg                numeric(6,3) not null default 0,
  passes_attempted  smallint not null default 0,
  passes_completed  smallint not null default 0,
  tackles           smallint not null default 0,
  interceptions     smallint not null default 0,
  saves             smallint not null default 0,
  fouls             smallint not null default 0,
  cards_yellow      smallint not null default 0,
  cards_red         smallint not null default 0,
  clean_sheet       boolean not null default false,
  metadata_json     jsonb not null default '{}'::jsonb,
  primary key (fixture_id, game_player_id),
  check (passes_completed <= passes_attempted),
  check (shots_on_target <= shots),
  check (goals <= shots_on_target + 0)   -- every goal is an on-target shot (own goals tracked separately)
);
create index mps_player_idx on public.match_player_stats(game_player_id);

create table public.standings (
  game_id    uuid not null references public.games(id) on delete cascade,
  season_id  uuid not null references public.seasons(id) on delete cascade,
  club_id    uuid not null references public.game_clubs(id) on delete cascade,
  played     smallint not null default 0,
  won        smallint not null default 0,
  drawn      smallint not null default 0,
  lost       smallint not null default 0,
  gf         smallint not null default 0,
  ga         smallint not null default 0,
  gd         smallint generated always as (gf - ga) stored,
  points     smallint not null default 0,
  form       text not null default '',     -- last 5 e.g. 'WDLWW'
  updated_at timestamptz not null default now(),
  primary key (season_id, club_id),
  check (played = won + drawn + lost),
  check (points >= 0)                       -- points rule configurable in games.settings_json
);
