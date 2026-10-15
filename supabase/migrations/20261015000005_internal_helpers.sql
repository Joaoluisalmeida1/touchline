-- Touchline — 0005: internal helpers (NOT executable by clients)

-- Raise a user-facing error with a stable code in the DETAIL field (mapped to friendly pt-PT in the app).
create or replace function public._fail(p_code text, p_message text) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_message, detail = p_code;
end $$;

create or replace function public._setting_int(p_game public.games, p_key text, p_default integer) returns integer
language sql immutable as $$
  select coalesce((p_game.settings_json->>p_key)::integer, p_default);
$$;

create or replace function public._game_is_processing(p_game public.games) returns boolean
language sql stable as $$
  select p_game.processing_lease_until is not null and p_game.processing_lease_until > now();
$$;

-- Append to club ledger and update cash atomically. Idempotent by key: a replay returns the
-- previously recorded balance and changes nothing.
create or replace function public._ledger(
  p_game_id uuid, p_club_id uuid, p_type text, p_amount bigint, p_reference text, p_key text,
  p_season integer default null, p_round integer default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_balance bigint; v_existing bigint;
begin
  select balance_after_cents into v_existing from public.club_ledger where idempotency_key = p_key;
  if found then return v_existing; end if;
  update public.game_clubs set cash_cents = cash_cents + p_amount
    where id = p_club_id and game_id = p_game_id
    returning cash_cents into v_balance;
  if not found then perform public._fail('club_not_found', 'Clube inexistente nesta liga.'); end if;
  insert into public.club_ledger (game_id, club_id, event_type, amount_cents, reference_id, idempotency_key,
                                  balance_after_cents, season_number, round_number)
  values (p_game_id, p_club_id, p_type, p_amount, p_reference, p_key, v_balance, p_season, p_round);
  return v_balance;
end $$;

create or replace function public._notify(p_user_id uuid, p_game_id uuid, p_type text, p_payload jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, game_id, type, payload_json)
  select p_user_id, p_game_id, p_type, p_payload where p_user_id is not null;
$$;

create or replace function public._audit(p_game_id uuid, p_actor uuid, p_action text, p_entity_type text,
                                         p_entity_id text, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_log (game_id, actor_user_id, action, entity_type, entity_id, metadata_json)
  values (p_game_id, p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_meta, '{}'::jsonb));
$$;

-- Formation slot catalogue. MUST match src/engine/lineup/formations.ts (checked by tests).
create or replace function public.formation_slots(p_formation text) returns text[]
language sql immutable as $$
  select case p_formation
    when '4-3-3'   then array['GK','LB','CB','CB','RB','CM','DM','CM','LW','ST','RW']
    when '4-2-3-1' then array['GK','LB','CB','CB','RB','DM','DM','LW','AM','RW','ST']
    when '4-4-2'   then array['GK','LB','CB','CB','RB','LM','CM','CM','RM','ST','ST']
    when '4-1-4-1' then array['GK','LB','CB','CB','RB','DM','LM','CM','CM','RM','ST']
    when '3-5-2'   then array['GK','CB','CB','CB','LWB','CM','DM','CM','RWB','ST','ST']
    when '5-3-2'   then array['GK','LWB','CB','CB','CB','RWB','CM','CM','CM','ST','ST']
    else null end;
$$;

-- Double round-robin (circle method), balanced home/away, byes for odd counts.
create or replace function public._generate_fixtures(p_game_id uuid, p_season_id uuid, p_start timestamptz,
                                                     p_interval_hours integer)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clubs uuid[]; v_n integer; v_rounds integer; v_r integer; v_i integer;
  v_home uuid; v_away uuid; v_tmp uuid; v_fixed uuid; v_rest uuid[];
begin
  select array_agg(id order by md5(p_game_id::text || id::text)) into v_clubs
    from public.game_clubs where game_id = p_game_id;
  v_n := coalesce(array_length(v_clubs, 1), 0);
  if v_n < 2 then perform public._fail('not_enough_clubs', 'São precisos pelo menos 2 clubes.'); end if;
  if v_n % 2 = 1 then v_clubs := v_clubs || array[null::uuid]; v_n := v_n + 1; end if;
  v_rounds := v_n - 1;

  for v_r in 0 .. v_rounds - 1 loop
    for v_i in 0 .. (v_n / 2) - 1 loop
      v_home := v_clubs[1 + v_i];
      v_away := v_clubs[v_n - v_i];
      if (v_i = 0 and v_r % 2 = 1) or (v_i > 0 and v_i % 2 = 1) then
        v_tmp := v_home; v_home := v_away; v_away := v_tmp;
      end if;
      if v_home is not null and v_away is not null then
        insert into public.fixtures (game_id, season_id, round_number, home_club_id, away_club_id, kickoff_at)
        values (p_game_id, p_season_id, v_r + 1, v_home, v_away, p_start + make_interval(hours => p_interval_hours * v_r));
        insert into public.fixtures (game_id, season_id, round_number, home_club_id, away_club_id, kickoff_at)
        values (p_game_id, p_season_id, v_r + 1 + v_rounds, v_away, v_home,
                p_start + make_interval(hours => p_interval_hours * (v_r + v_rounds)));
      end if;
    end loop;
    -- rotate all but the first element
    v_fixed := v_clubs[1];
    v_rest := v_clubs[2:v_n];
    v_clubs := array[v_fixed] || (array[v_rest[v_n - 1]] || v_rest[1:v_n - 2]);
  end loop;

  update public.seasons set total_rounds = v_rounds * 2 where id = p_season_id;
  insert into public.standings (game_id, season_id, club_id)
    select p_game_id, p_season_id, id from public.game_clubs where game_id = p_game_id
    on conflict do nothing;
  return v_rounds * 2;
end $$;

revoke all on function public._fail(text, text), public._setting_int(public.games, text, integer),
  public._game_is_processing(public.games), public._ledger(uuid, uuid, text, bigint, text, text, integer, integer),
  public._notify(uuid, uuid, text, jsonb), public._audit(uuid, uuid, text, text, text, jsonb),
  public._generate_fixtures(uuid, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.formation_slots(text) to authenticated, service_role;
