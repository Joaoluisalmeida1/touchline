-- Touchline — 0019: "Roleta" (slot machine) and match betting. Additive.
-- Spins, duels and bets are decided by server code (crypto randomness for the slot, odds from the strength model) and
-- written through the service connection; members can read the league-wide feed, cards stay private to their club.
-- In-game money only: there is no way to buy spins or chips with real money.

-- ------------------------------------------------------------------ shared
alter table public.club_ledger drop constraint if exists club_ledger_event_type_check;
alter table public.club_ledger add constraint club_ledger_event_type_check check (event_type in (
  'initial_balance','transfer_sale','transfer_purchase','gate_receipts','sponsorship',
  'wages','prize_money','result_bonus','adjustment','staff_wages','infrastructure','slots','betting'));

alter table public.wall_posts drop constraint if exists wall_posts_kind_check;
alter table public.wall_posts add constraint wall_posts_kind_check check (kind in ('post','transfer','achievement','headline','slots','duel','bet'));

alter table public.game_clubs add column if not exists crest_skin text;

-- the roleta's −1 point can take a club below zero (as in real points deductions)
alter table public.standings drop constraint if exists standings_points_check;
alter table public.standings add constraint standings_points_check check (points >= -50);

-- ------------------------------------------------------------------ slots
create table if not exists public.slots_pots (
  game_id    uuid primary key references public.games(id) on delete cascade,
  pot_cents  bigint not null default 200000000 check (pot_cents >= 0),
  last_winner_club_id uuid references public.game_clubs(id) on delete set null,
  last_won_cents bigint,
  last_won_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.slot_spins (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  club_id    uuid not null references public.game_clubs(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  spun_on    date not null,
  cost_cents bigint not null default 0,
  free       boolean not null default false,
  prize      text not null,
  rarity     text not null check (rarity in ('common','rare','epic','legendary','bad','disaster')),
  label      text not null,
  reels      jsonb not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists slot_spins_club_day on public.slot_spins(club_id, spun_on);
create index if not exists slot_spins_game_idx on public.slot_spins(game_id, created_at desc);

create table if not exists public.slot_cards (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  club_id     uuid not null references public.game_clubs(id) on delete cascade,
  kind        text not null check (kind in ('shield','immunity','gate','free_spin')),
  status      text not null default 'held' check (status in ('held','active','used')),
  active_season integer,
  active_round  integer,
  payload     jsonb not null default '{}'::jsonb,
  spin_id     uuid references public.slot_spins(id) on delete set null,
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);
create index if not exists slot_cards_club_idx on public.slot_cards(club_id, status);

create table if not exists public.club_skins (
  club_id     uuid not null references public.game_clubs(id) on delete cascade,
  game_id     uuid not null references public.games(id) on delete cascade,
  skin        text not null,
  obtained_at timestamptz not null default now(),
  primary key (club_id, skin)
);

create table if not exists public.slot_duels (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games(id) on delete cascade,
  challenger_club_id uuid not null references public.game_clubs(id) on delete cascade,
  opponent_club_id   uuid not null references public.game_clubs(id) on delete cascade,
  stake_cents   bigint not null check (stake_cents > 0),
  status        text not null default 'open' check (status in ('open','done','declined','cancelled','expired')),
  challenger_reels jsonb, opponent_reels jsonb,
  challenger_score integer, opponent_score integer,
  winner_club_id uuid references public.game_clubs(id) on delete set null,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  check (challenger_club_id <> opponent_club_id)
);
create index if not exists slot_duels_game_idx on public.slot_duels(game_id, status);

-- ------------------------------------------------------------------ betting
create table if not exists public.bets (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  club_id      uuid not null references public.game_clubs(id) on delete cascade,
  fixture_id   uuid not null references public.fixtures(id) on delete cascade,
  pick         text not null check (pick in ('1','X','2')),
  stake_cents  bigint not null check (stake_cents > 0),
  odds         numeric(6,2) not null check (odds >= 1.01),
  status       text not null default 'open' check (status in ('open','won','lost','void')),
  payout_cents bigint,
  idempotency_key text not null unique,
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);
create index if not exists bets_fixture_idx on public.bets(fixture_id, status);
create index if not exists bets_game_idx on public.bets(game_id, created_at desc);

-- ------------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array['slots_pots','slot_spins','slot_cards','club_skins','slot_duels','bets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy member_read on public.slots_pots for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.slot_spins for select to authenticated using (public.is_game_member(game_id));
create policy own_club_read on public.slot_cards for select to authenticated using (public.manages_club(club_id));
create policy member_read on public.club_skins for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.slot_duels for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.bets for select to authenticated using (public.is_game_member(game_id));

-- ------------------------------------------------------------------ user commands (no randomness involved)
-- Equip a crest skin the club owns (null = original crest).
create or replace function public.equip_skin(p_game_id uuid, p_skin text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_club uuid;
begin
  v_club := public._my_active_club(p_game_id);
  if p_skin is not null and not exists (select 1 from public.club_skins where club_id = v_club and skin = p_skin) then
    perform public._fail('not_owned', 'Ainda não tens esse emblema.');
  end if;
  update public.game_clubs set crest_skin = p_skin where id = v_club;
end $$;

-- Play a held card for the next round (immunity / gate). The shield and free spins are used automatically.
create or replace function public.activate_card(p_card_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c public.slot_cards; v_game public.games; v_injured jsonb;
begin
  select * into v_c from public.slot_cards where id = p_card_id for update;
  if not found or not public.manages_club(v_c.club_id) then perform public._fail('not_found', 'Carta inexistente.'); end if;
  perform public._my_active_club(v_c.game_id);
  if v_c.status <> 'held' then perform public._fail('used', 'Esta carta já foi usada.'); end if;
  if v_c.kind not in ('immunity','gate') then perform public._fail('passive', 'Esta carta é usada automaticamente.'); end if;
  select * into v_game from public.games where id = v_c.game_id;
  if v_game.status <> 'active' then perform public._fail('not_active', 'A liga não está a decorrer.'); end if;
  if public._game_is_processing(v_game) then perform public._fail('processing', 'Jornada a ser processada.'); end if;
  if exists (select 1 from public.slot_cards where club_id = v_c.club_id and kind = v_c.kind and status = 'active'
               and active_season = v_game.current_season and active_round = v_game.current_matchday + 1) then
    perform public._fail('already_active', 'Já tens uma carta destas ativa para a próxima jornada.');
  end if;
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_injured from public.game_players where club_id = v_c.club_id and injured_matches > 0;
  update public.slot_cards set status = 'active', active_season = v_game.current_season, active_round = v_game.current_matchday + 1,
         payload = payload || jsonb_build_object('injured_before', v_injured)
   where id = v_c.id;
  return jsonb_build_object('round', v_game.current_matchday + 1);
end $$;

-- Challenge another manager to a duel (fixed stake, reserved until answered).
create or replace function public.create_duel(p_game_id uuid, p_opponent_club_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_club uuid; v_me public.game_clubs; v_opp public.game_clubs; v_id uuid; v_stake bigint := 50000000;
begin
  v_club := public._my_active_club(p_game_id);
  select * into v_me from public.game_clubs where id = v_club for update;
  select * into v_opp from public.game_clubs where id = p_opponent_club_id and game_id = p_game_id;
  if not found or v_opp.manager_user_id is null then perform public._fail('invalid', 'Só podes desafiar treinadores humanos.'); end if;
  if v_opp.id = v_club then perform public._fail('invalid', 'Não te podes desafiar a ti próprio.'); end if;
  if exists (select 1 from public.slot_duels where status = 'open' and game_id = p_game_id
               and ((challenger_club_id = v_club and opponent_club_id = v_opp.id) or (challenger_club_id = v_opp.id and opponent_club_id = v_club))) then
    perform public._fail('duplicate', 'Já há um duelo pendente entre vocês.');
  end if;
  if v_me.cash_cents - v_me.reserved_cents < v_stake then perform public._fail('insufficient_funds', 'Precisas de €500 000 disponíveis.'); end if;
  insert into public.slot_duels (game_id, challenger_club_id, opponent_club_id, stake_cents) values (p_game_id, v_club, v_opp.id, v_stake) returning id into v_id;
  update public.game_clubs set reserved_cents = reserved_cents + v_stake where id = v_club;
  perform public._notify(v_opp.manager_user_id, p_game_id, 'duel_challenge', jsonb_build_object('duel_id', v_id, 'club', v_me.name_snapshot));
  return v_id;
end $$;

-- Decline (opponent) or cancel (challenger) an open duel.
create or replace function public.close_duel(p_duel_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_d public.slot_duels;
begin
  select * into v_d from public.slot_duels where id = p_duel_id for update;
  if not found or not (public.manages_club(v_d.challenger_club_id) or public.manages_club(v_d.opponent_club_id)) then
    perform public._fail('not_found', 'Duelo inexistente.');
  end if;
  if v_d.status <> 'open' then perform public._fail('closed', 'Este duelo já terminou.'); end if;
  update public.slot_duels set status = case when public.manages_club(v_d.opponent_club_id) then 'declined' else 'cancelled' end, resolved_at = now()
   where id = v_d.id;
  update public.game_clubs set reserved_cents = reserved_cents - v_d.stake_cents where id = v_d.challenger_club_id;
end $$;

-- Owner: what the slot and betting can do in this league.
create or replace function public.set_fun_settings(p_game_id uuid, p_negatives boolean, p_point_penalty boolean, p_betting boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.games where id = p_game_id and owner_user_id = auth.uid()) then
    perform public._fail('forbidden', 'Só o criador pode alterar definições.');
  end if;
  update public.games set settings_json = settings_json || jsonb_build_object(
    'slots_negatives', coalesce(p_negatives, true), 'slots_point_penalty', coalesce(p_point_penalty, false), 'betting', coalesce(p_betting, true))
   where id = p_game_id;
  perform public._audit(p_game_id, auth.uid(), 'game.fun_settings', 'game', p_game_id::text,
    jsonb_build_object('negatives', p_negatives, 'point_penalty', p_point_penalty, 'betting', p_betting));
end $$;

do $$
declare f text;
begin
  foreach f in array array['equip_skin(uuid, text)', 'activate_card(uuid)', 'create_duel(uuid, uuid)', 'close_duel(uuid)', 'set_fun_settings(uuid, boolean, boolean, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
