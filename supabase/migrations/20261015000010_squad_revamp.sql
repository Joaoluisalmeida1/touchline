-- Touchline — 0010: squad revamp (engine match-v1.1.0)
--   * 17 formations, per-slot player roles, captain + set-piece takers (lineups.instructions_json)
--   * preferred position (once per season) + positional familiarity learned from minutes
--   * squad numbers, tactic presets
--   * leave_game (re-applied here so remote projects that skipped it get it)
-- The three lookup functions below are GENERATED from src/engine (scripts/db/gen-lineup-sql.ts). Do not edit by hand.

create or replace function public.formation_slots(p_formation text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case p_formation
    when '4-3-3' then array['GK','LB','CB','CB','RB','CM','DM','CM','LW','ST','RW']
    when '4-2-3-1' then array['GK','LB','CB','CB','RB','DM','DM','LW','AM','RW','ST']
    when '4-4-2' then array['GK','LB','CB','CB','RB','LM','CM','CM','RM','ST','ST']
    when '4-1-4-1' then array['GK','LB','CB','CB','RB','DM','LM','CM','CM','RM','ST']
    when '3-5-2' then array['GK','CB','CB','CB','LWB','CM','DM','CM','RWB','ST','ST']
    when '5-3-2' then array['GK','LWB','CB','CB','CB','RWB','CM','CM','CM','ST','ST']
    when '4-1-2-1-2' then array['GK','LB','CB','CB','RB','DM','CM','CM','AM','ST','ST']
    when '4-2-2-2' then array['GK','LB','CB','CB','RB','DM','DM','AM','AM','ST','ST']
    when '4-3-2-1' then array['GK','LB','CB','CB','RB','CM','CM','CM','AM','AM','ST']
    when '4-4-1-1' then array['GK','LB','CB','CB','RB','LM','CM','CM','RM','AM','ST']
    when '4-5-1' then array['GK','LB','CB','CB','RB','LM','CM','CM','CM','RM','ST']
    when '4-2-4' then array['GK','LB','CB','CB','RB','CM','CM','LW','ST','ST','RW']
    when '3-4-3' then array['GK','CB','CB','CB','LM','CM','CM','RM','LW','ST','RW']
    when '3-4-2-1' then array['GK','CB','CB','CB','LWB','CM','CM','RWB','AM','AM','ST']
    when '3-4-1-2' then array['GK','CB','CB','CB','LWB','CM','CM','RWB','AM','ST','ST']
    when '5-4-1' then array['GK','LWB','CB','CB','CB','RWB','LM','CM','CM','RM','ST']
    when '5-2-3' then array['GK','LWB','CB','CB','CB','RWB','CM','CM','LW','ST','RW']
    else null end;
$$;

create or replace function public.slot_roles(p_slot text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case p_slot
    when 'GK' then array['gk','gk_sweeper']
    when 'LB' then array['fb_defensive','fb','fb_attacking']
    when 'CB' then array['cb','cb_ballplaying','cb_stopper']
    when 'RB' then array['fb_defensive','fb','fb_attacking']
    when 'LWB' then array['wb_defensive','wb','wb_attacking']
    when 'RWB' then array['wb_defensive','wb','wb_attacking']
    when 'DM' then array['dm_anchor','dm','dm_playmaker']
    when 'CM' then array['cm_defensive','cm','cm_playmaker','cm_attacking']
    when 'AM' then array['am','am_creator','am_shadow']
    when 'LM' then array['wm_defensive','wm','wm_winger','wm_inverted']
    when 'RM' then array['wm_defensive','wm','wm_winger','wm_inverted']
    when 'LW' then array['w_defensive','w','w_inside']
    when 'RW' then array['w_defensive','w','w_inside']
    when 'ST' then array['st','st_target','st_false9','st_runner']
    else null end;
$$;

create or replace function public.preferrable_slots(p_group text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case p_group
    when 'GK' then array['GK']
    when 'DEF' then array['CB','LB','RB','LWB','RWB']
    when 'MID' then array['DM','CM','AM','LM','RM']
    when 'ATT' then array['ST','LW','RW']
    else null end;
$$;


-- ----------------------------------------------------------------- tactics: any known formation
alter table public.tactics drop constraint if exists tactics_formation_check;
alter table public.tactics add constraint tactics_formation_check check (public.formation_slots(formation) is not null);

-- ----------------------------------------------------------------- player columns
alter table public.game_players
  add column if not exists preferred_slot text check (preferred_slot is null or preferred_slot in
    ('GK','LB','CB','RB','LWB','RWB','DM','CM','AM','LM','RM','LW','RW','ST')),
  add column if not exists preferred_slot_season integer,
  add column if not exists position_familiarity jsonb not null default '{}'::jsonb,
  add column if not exists shirt_number smallint check (shirt_number is null or shirt_number between 1 and 99);
create unique index if not exists game_players_shirt_unique on public.game_players(club_id, shirt_number)
  where shirt_number is not null and club_id is not null;
grant select (preferred_slot, preferred_slot_season, position_familiarity, shirt_number) on public.game_players to authenticated;

-- a player who changes club loses his shirt number
create or replace function public._reset_shirt_on_transfer() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.club_id is distinct from old.club_id then new.shirt_number := null; end if;
  return new;
end $$;
create trigger game_players_reset_shirt before update of club_id on public.game_players
  for each row execute function public._reset_shirt_on_transfer();

-- ----------------------------------------------------------------- tactic presets
create table if not exists public.tactic_presets (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  club_id     uuid not null references public.game_clubs(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  payload     jsonb not null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists tactic_presets_name_unique on public.tactic_presets(club_id, lower(name)) where archived_at is null;
alter table public.tactic_presets enable row level security;
revoke all on public.tactic_presets from anon, authenticated;
grant select on public.tactic_presets to authenticated;
create policy own_presets on public.tactic_presets for select to authenticated using (public.manages_club(club_id));

-- ----------------------------------------------------------------- player updates carry positional learning
create or replace function public._apply_player_updates(p_game_id uuid, p_updates jsonb, p_allowed_clubs uuid[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_expected integer := coalesce(jsonb_array_length(p_updates), 0); v_done integer;
begin
  if v_expected = 0 then return 0; end if;
  update public.game_players p set
    form = coalesce(u.form, p.form),
    morale = coalesce(u.morale, p.morale),
    fitness = coalesce(u.fitness, p.fitness),
    sharpness = coalesce(u.sharpness, p.sharpness),
    fatigue = coalesce(u.fatigue, p.fatigue),
    injured_matches = coalesce(u.injured_matches, p.injured_matches),
    injury_type = case when coalesce(u.injured_matches, p.injured_matches) = 0 then null
                       else coalesce(u.injury_type, p.injury_type) end,
    suspension_matches = coalesce(u.suspension_matches, p.suspension_matches),
    yellow_accumulation = coalesce(u.yellow_accumulation, p.yellow_accumulation),
    development_xp = coalesce(u.development_xp, p.development_xp),
    current_ovr = coalesce(u.current_ovr, p.current_ovr),
    potential_cap = coalesce(u.potential_cap, p.potential_cap),
    season_start_ovr = coalesce(u.season_start_ovr, p.season_start_ovr),
    market_value_cents = coalesce(u.market_value_cents, p.market_value_cents),
    wage_cents = coalesce(u.wage_cents, p.wage_cents),
    contract_end_season = coalesce(u.contract_end_season, p.contract_end_season),
    age = coalesce(u.age, p.age),
    career_minutes = p.career_minutes + coalesce(u.career_minutes_add, 0),
    season_stats_json = coalesce(u.season_stats, p.season_stats_json),
    position_familiarity = coalesce(u.position_familiarity, p.position_familiarity),
    -- inferred specialisation never overrides a manager's choice
    preferred_slot = coalesce(p.preferred_slot,
      case when u.preferred_slot = any(public.preferrable_slots(p.position_group)) then u.preferred_slot end),
    version = p.version + 1,
    updated_at = now()
  from jsonb_to_recordset(p_updates) as u(id uuid, expected_version integer, form numeric, morale smallint,
       fitness smallint, sharpness smallint, fatigue smallint, injured_matches smallint, injury_type text,
       suspension_matches smallint, yellow_accumulation smallint, development_xp numeric, current_ovr smallint,
       potential_cap smallint, season_start_ovr smallint, market_value_cents bigint, wage_cents bigint,
       contract_end_season integer, age smallint, career_minutes_add integer, season_stats jsonb,
       position_familiarity jsonb, preferred_slot text)
  where p.id = u.id and p.game_id = p_game_id and p.version = u.expected_version
    and (p_allowed_clubs is null or p.club_id = any(p_allowed_clubs));
  get diagnostics v_done = row_count;
  if v_done <> v_expected then
    perform public._fail('version_conflict', format('Conflito de versão em jogadores (%s/%s).', v_done, v_expected));
  end if;
  return v_done;
end $$;

-- ----------------------------------------------------------------- lineup v2 (roles + instructions)
-- v2 keeps the v1 signature untouched (old clients keep working during a rolling deploy); v1 never sees roles/instructions.
-- p_starters: [{"player_id": uuid, "slot": "GK", "role": "gk"}, ...] exactly 11 matching formation slots (role optional)
-- p_instructions: {"captain": uuid, "penalty_taker": uuid, "freekick_taker": uuid, "corner_taker": uuid} (all optional)
create or replace function public.save_lineup_v2(p_game_id uuid, p_formation text, p_starters jsonb, p_bench jsonb,
                                                 p_instructions jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.my_club_id(p_game_id); v_game public.games;
  v_slots text[]; v_given text[]; v_ids uuid[]; v_bench uuid[]; v_bad integer; v_ins jsonb := coalesce(p_instructions, '{}'::jsonb);
  v_key text; v_val uuid;
begin
  if v_club is null then perform public._fail('no_club', 'Não geres nenhum clube nesta liga.'); end if;
  select * into v_game from public.games where id = p_game_id;
  if public._game_is_processing(v_game) then perform public._fail('locked', 'Escalações bloqueadas: jornada em processamento.'); end if;
  v_slots := public.formation_slots(p_formation);
  if v_slots is null then perform public._fail('invalid_formation', 'Formação inválida.'); end if;
  if jsonb_typeof(p_starters) <> 'array' or jsonb_array_length(p_starters) <> 11 then
    perform public._fail('invalid_lineup', 'O onze tem de ter exatamente 11 jogadores.');
  end if;
  select array_agg(e->>'slot' order by e->>'slot'), array_agg((e->>'player_id')::uuid)
    into v_given, v_ids from jsonb_array_elements(p_starters) e;
  if v_given <> (select array_agg(s order by s) from unnest(v_slots) s) then
    perform public._fail('invalid_lineup', 'As posições não correspondem à formação.');
  end if;
  if exists (select 1 from jsonb_array_elements(p_starters) e
              where e ? 'role' and e->>'role' is not null and not ((e->>'role') = any(public.slot_roles(e->>'slot')))) then
    perform public._fail('invalid_role', 'Função inválida para a posição.');
  end if;
  select coalesce(array_agg(x::uuid), '{}') into v_bench from jsonb_array_elements_text(coalesce(p_bench, '[]'::jsonb)) x;
  if array_length(v_bench, 1) > 9 then perform public._fail('invalid_lineup', 'Máximo de 9 suplentes.'); end if;
  if (select count(distinct x) from unnest(v_ids || v_bench) x) <> 11 + coalesce(array_length(v_bench, 1), 0) then
    perform public._fail('invalid_lineup', 'Jogador repetido na escalação.');
  end if;
  select count(*) into v_bad from unnest(v_ids || v_bench) x
   where not exists (select 1 from public.game_players p where p.id = x and p.club_id = v_club and p.game_id = p_game_id);
  if v_bad > 0 then perform public._fail('invalid_lineup', 'Só podes escalar jogadores do teu plantel.'); end if;
  select count(*) into v_bad from unnest(v_ids) x join public.game_players p on p.id = x
   where p.injured_matches > 0 or p.suspension_matches > 0;
  if v_bad > 0 then perform public._fail('unavailable_player', 'Há titulares lesionados ou suspensos.'); end if;
  -- instructions
  if jsonb_typeof(v_ins) <> 'object' then perform public._fail('invalid_instructions', 'Instruções inválidas.'); end if;
  for v_key in select jsonb_object_keys(v_ins) loop
    if v_key not in ('captain', 'penalty_taker', 'freekick_taker', 'corner_taker') then
      perform public._fail('invalid_instructions', 'Instrução desconhecida.');
    end if;
    continue when jsonb_typeof(v_ins->v_key) = 'null';
    begin
      v_val := (v_ins->>v_key)::uuid;
    exception when invalid_text_representation then
      perform public._fail('invalid_instructions', 'Instruções inválidas.');
    end;
    if v_key = 'captain' and not (v_val = any(v_ids)) then
      perform public._fail('invalid_instructions', 'O capitão tem de ser titular.');
    end if;
    if not (v_val = any(v_ids || v_bench)) then
      perform public._fail('invalid_instructions', 'Os marcadores de bolas paradas têm de estar convocados.');
    end if;
  end loop;

  insert into public.lineups (game_id, club_id, fixture_id, formation, starters_json, bench_json, instructions_json, auto_generated)
  values (p_game_id, v_club, null, p_formation, p_starters, to_jsonb(v_bench), jsonb_strip_nulls(v_ins), false)
  on conflict (club_id, fixture_id) do update set
    formation = excluded.formation, starters_json = excluded.starters_json, bench_json = excluded.bench_json,
    instructions_json = excluded.instructions_json, auto_generated = false, warnings_json = '[]'::jsonb, updated_at = now();
  update public.tactics set formation = p_formation, updated_at = now() where club_id = v_club;
end $$;

-- ----------------------------------------------------------------- preferred position / shirt numbers
create or replace function public.set_preferred_slot(p_player_id uuid, p_slot text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p public.game_players; v_game public.games;
begin
  select * into v_p from public.game_players where id = p_player_id for update;
  if not found or not public.manages_club(v_p.club_id) then perform public._fail('forbidden', 'Este jogador não é teu.'); end if;
  select * into v_game from public.games where id = v_p.game_id;
  if public._game_is_processing(v_game) then perform public._fail('locked', 'Jornada em processamento, tenta daqui a pouco.'); end if;
  if p_slot is null or not (p_slot = any(public.preferrable_slots(v_p.position_group))) then
    perform public._fail('invalid_slot', 'Posição incompatível com o jogador.');
  end if;
  if v_p.preferred_slot = p_slot then return; end if;
  if v_p.preferred_slot_season is not null and v_p.preferred_slot_season >= v_game.current_season then
    perform public._fail('already_set', 'Só podes mudar a posição preferida uma vez por época.');
  end if;
  update public.game_players set preferred_slot = p_slot, preferred_slot_season = v_game.current_season,
         version = version + 1, updated_at = now() where id = p_player_id;
  perform public._audit(v_p.game_id, auth.uid(), 'player.preferred_slot', 'game_player', p_player_id::text, jsonb_build_object('slot', p_slot));
end $$;

create or replace function public.set_shirt_number(p_player_id uuid, p_number integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p public.game_players;
begin
  select * into v_p from public.game_players where id = p_player_id for update;
  if not found or not public.manages_club(v_p.club_id) then perform public._fail('forbidden', 'Este jogador não é teu.'); end if;
  if p_number is not null and p_number not between 1 and 99 then perform public._fail('invalid_number', 'Número entre 1 e 99.'); end if;
  update public.game_players set shirt_number = p_number, updated_at = now() where id = p_player_id;
exception when unique_violation then
  perform public._fail('number_taken', 'Esse número já está atribuído no plantel.');
end $$;

-- Give numbers to every player of my club without one: GK 1/12/13…, then by position and rating.
create or replace function public.auto_number_squad(p_game_id uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_club uuid := public.my_club_id(p_game_id); r record; v_n integer; v_count integer := 0;
  v_pref integer[]; v_try integer;
begin
  if v_club is null then perform public._fail('no_club', 'Não geres nenhum clube nesta liga.'); end if;
  for r in select id, position_group from public.game_players
            where club_id = v_club and shirt_number is null
            order by case position_group when 'GK' then 0 when 'DEF' then 1 when 'MID' then 2 else 3 end, current_ovr desc, id
  loop
    v_pref := case r.position_group
      when 'GK' then array[1,12,13,99,31]
      when 'DEF' then array[2,3,4,5,6,15,22,24,25,26,28,32,33,34]
      when 'MID' then array[8,6,10,14,16,17,18,20,21,23,27,30,35]
      else array[9,11,7,19,29,36,37,38,39,40] end;
    v_n := null;
    foreach v_try in array v_pref loop
      if not exists (select 1 from public.game_players where club_id = v_club and shirt_number = v_try) then v_n := v_try; exit; end if;
    end loop;
    if v_n is null then
      select min(x) into v_n from generate_series(1, 99) x
       where not exists (select 1 from public.game_players where club_id = v_club and shirt_number = x);
    end if;
    exit when v_n is null;
    update public.game_players set shirt_number = v_n where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ----------------------------------------------------------------- presets
create or replace function public.save_tactic_preset(p_game_id uuid, p_name text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_club uuid := public.my_club_id(p_game_id); v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if v_club is null then perform public._fail('no_club', 'Não geres nenhum clube nesta liga.'); end if;
  if char_length(v_name) not between 1 and 40 then perform public._fail('invalid_name', 'Nome entre 1 e 40 caracteres.'); end if;
  if jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 20000
     or public.formation_slots(p_payload->>'formation') is null then
    perform public._fail('invalid_preset', 'Predefinição inválida.');
  end if;
  update public.tactic_presets set payload = p_payload, updated_at = now()
   where club_id = v_club and lower(name) = lower(v_name) and archived_at is null returning id into v_id;
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.tactic_presets where club_id = v_club and archived_at is null) >= 8 then
    perform public._fail('too_many_presets', 'Máximo de 8 predefinições. Apaga uma primeiro.');
  end if;
  insert into public.tactic_presets (game_id, club_id, name, payload) values (p_game_id, v_club, v_name, p_payload) returning id into v_id;
  return v_id;
end $$;

create or replace function public.archive_tactic_preset(p_preset_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.tactic_presets set archived_at = now(), updated_at = now()
   where id = p_preset_id and archived_at is null and public.manages_club(club_id);
  if not found then perform public._fail('not_found', 'Predefinição não encontrada.'); end if;
end $$;

-- ----------------------------------------------------------------- leave_game (idempotent re-create)
create or replace function public.leave_game(p_game_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if exists (select 1 from public.games where id = p_game_id and owner_user_id = v_uid) then
    perform public._fail('owner_cannot_leave', 'O criador não pode sair da liga.');
  end if;
  if not public.is_game_member(p_game_id) then perform public._fail('forbidden', 'Não és membro desta liga.'); end if;
  update public.game_clubs c set reserved_cents = greatest(0, c.reserved_cents - coalesce((
      select sum(o.amount_cents) from public.transfer_offers o where o.buyer_club_id = c.id and o.status = 'pending'), 0))
   where c.game_id = p_game_id and c.manager_user_id = v_uid;
  update public.transfer_offers set status = 'cancelled', responded_at = now(), response_reason = 'manager_left'
   where status = 'pending' and buyer_club_id = (select id from public.game_clubs where game_id = p_game_id and manager_user_id = v_uid);
  update public.game_clubs set manager_user_id = null where game_id = p_game_id and manager_user_id = v_uid;
  delete from public.game_members where game_id = p_game_id and user_id = v_uid;
  perform public._audit(p_game_id, v_uid, 'member.leave', 'game', p_game_id::text);
end $$;

-- ----------------------------------------------------------------- privileges
revoke execute on function public.slot_roles(text), public.preferrable_slots(text), public._reset_shirt_on_transfer(),
  public._apply_player_updates(uuid, jsonb, uuid[]),
  public.save_lineup_v2(uuid, text, jsonb, jsonb, jsonb), public.set_preferred_slot(uuid, text), public.set_shirt_number(uuid, integer),
  public.auto_number_squad(uuid), public.save_tactic_preset(uuid, text, jsonb), public.archive_tactic_preset(uuid),
  public.leave_game(uuid), public.formation_slots(text)
  from public, anon, authenticated;
grant execute on function public.formation_slots(text), public.slot_roles(text), public.preferrable_slots(text),
  public.save_lineup_v2(uuid, text, jsonb, jsonb, jsonb), public.set_preferred_slot(uuid, text), public.set_shirt_number(uuid, integer),
  public.auto_number_squad(uuid), public.save_tactic_preset(uuid, text, jsonb), public.archive_tactic_preset(uuid),
  public.leave_game(uuid)
  to authenticated;
grant execute on all functions in schema public to service_role;
