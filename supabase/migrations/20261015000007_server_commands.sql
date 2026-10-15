-- Touchline — 0007: server-only commands (service_role). The Next.js server authenticates the user,
-- runs the deterministic TypeScript engines and hands a versioned JSON payload to these functions,
-- which validate and commit atomically and idempotently.

create or replace function public.create_game_tx(p_user_id uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_game_id uuid; v_snapshot public.dataset_snapshots; v_league uuid := (p_payload->>'source_league_id')::uuid;
  v_club jsonb; v_club_id uuid; v_map jsonb := '{}'::jsonb; v_owned integer;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    perform public._fail('unauthenticated', 'Perfil inexistente.');
  end if;
  select count(*) into v_owned from public.games where owner_user_id = p_user_id and status in ('setup','active');
  if v_owned >= 10 then perform public._fail('too_many_games', 'Limite de 10 ligas ativas por criador.'); end if;
  select * into v_snapshot from public.dataset_snapshots where id = (p_payload->>'snapshot_id')::uuid;
  if not found or v_snapshot.status <> 'finalized' then perform public._fail('invalid_snapshot', 'Dataset inválido.'); end if;
  if not (v_league = any(v_snapshot.league_ids)) then perform public._fail('invalid_league', 'Liga não incluída no dataset.'); end if;
  if jsonb_array_length(p_payload->'clubs') < 2 then perform public._fail('not_enough_clubs', 'Clubes insuficientes.'); end if;

  insert into public.games (name, owner_user_id, dataset_snapshot_id, source_league_id, max_managers, tick_mode,
                            timezone, settings_json)
  values (p_payload->>'name', p_user_id, v_snapshot.id, v_league,
          coalesce((p_payload->>'max_managers')::smallint, 20), coalesce(p_payload->>'tick_mode', 'manual'),
          coalesce(p_payload->>'timezone', 'Europe/Lisbon'), coalesce(p_payload->'settings', '{}'::jsonb))
  returning id into v_game_id;
  insert into public.game_members (game_id, user_id, role) values (v_game_id, p_user_id, 'owner');

  for v_club in select * from jsonb_array_elements(p_payload->'clubs') loop
    if not exists (select 1 from public.dataset_snapshot_clubs
                   where snapshot_id = v_snapshot.id and source_club_id = (v_club->>'source_club_id')::uuid
                     and league_id = v_league) then
      perform public._fail('invalid_club', 'Clube fora do dataset/liga.');
    end if;
    insert into public.game_clubs (game_id, source_club_id, name_snapshot, short_name, primary_color, secondary_color,
                                   cash_cents, wage_budget_cents, reputation, strength)
    values (v_game_id, (v_club->>'source_club_id')::uuid, v_club->>'name', v_club->>'short_name',
            coalesce(v_club->>'primary_color', '#2d6a4f'), coalesce(v_club->>'secondary_color', '#e9ecef'),
            0, coalesce((v_club->>'wage_budget_cents')::bigint, 0), (v_club->>'reputation')::smallint,
            (v_club->>'strength')::numeric)
    returning id into v_club_id;
    v_map := v_map || jsonb_build_object(v_club->>'source_club_id', v_club_id);
    perform public._ledger(v_game_id, v_club_id, 'initial_balance', (v_club->>'cash_cents')::bigint, null,
                           'init:' || v_club_id, 1, 0);
    insert into public.tactics (game_id, club_id) values (v_game_id, v_club_id);
  end loop;

  insert into public.game_players (game_id, source_player_id, club_id, name_snapshot, position_group, position_detail,
    birth_date, age_known, age, initial_ovr, season_start_ovr, current_ovr, potential_cap, hidden_development_rate,
    profile_json, morale, fitness, sharpness, market_value_cents, wage_cents, contract_end_season)
  select v_game_id, x.source_player_id, (v_map->>(x.source_club_id::text))::uuid, x.name, x.position_group,
         x.position_detail, x.birth_date, x.age is not null, x.age, x.initial_ovr, x.initial_ovr, x.initial_ovr,
         x.potential_cap, x.dev_rate, coalesce(x.profile, '{}'::jsonb), coalesce(x.morale, 60),
         coalesce(x.fitness, 100), coalesce(x.sharpness, 70), x.market_value_cents, x.wage_cents, x.contract_end_season
    from jsonb_to_recordset(p_payload->'players') as x(source_player_id uuid, source_club_id uuid, name text,
         position_group text, position_detail text, birth_date date, age smallint, initial_ovr smallint,
         potential_cap smallint, dev_rate numeric, profile jsonb, morale smallint, fitness smallint, sharpness smallint,
         market_value_cents bigint, wage_cents bigint, contract_end_season integer)
   where exists (select 1 from public.dataset_snapshot_players sp
                  where sp.snapshot_id = v_snapshot.id and sp.source_player_id = x.source_player_id);

  if exists (select 1 from public.game_players where game_id = v_game_id and club_id is null) then
    perform public._fail('invalid_player_club', 'Jogador sem clube válido no payload.');
  end if;

  perform public._audit(v_game_id, p_user_id, 'game.create', 'game', v_game_id::text,
    jsonb_build_object('snapshot_id', v_snapshot.id, 'clubs', jsonb_array_length(p_payload->'clubs'),
                       'players', jsonb_array_length(p_payload->'players')));
  return v_game_id;
end $$;

-- Acquire the processing lease for the next round. Returns {acquired, round, season_id, season_number}.
create or replace function public.begin_matchday(p_game_id uuid, p_lease_seconds integer default 240) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_game public.games; v_season public.seasons; v_round integer;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then perform public._fail('not_found', 'Liga inexistente.'); end if;
  if v_game.status <> 'active' then return jsonb_build_object('acquired', false, 'reason', 'not_active'); end if;
  select * into v_season from public.seasons where game_id = p_game_id and number = v_game.current_season;
  if public._game_is_processing(v_game) then
    return jsonb_build_object('acquired', false, 'reason', 'lease_held', 'round', v_game.processing_round);
  end if;
  -- an expired lease means a crashed run: resume the same round (completed fixtures are skipped)
  v_round := coalesce(v_game.processing_round, v_game.current_matchday + 1);
  if v_round > v_season.total_rounds then
    return jsonb_build_object('acquired', false, 'reason', 'season_complete', 'season_number', v_season.number);
  end if;
  update public.games set processing_lease_until = now() + make_interval(secs => p_lease_seconds),
                          processing_round = v_round
   where id = p_game_id;
  update public.fixtures set status = 'lineup_locked'
   where season_id = v_season.id and round_number = v_round and status in ('scheduled','failed','processing');
  return jsonb_build_object('acquired', true, 'round', v_round, 'season_id', v_season.id,
                            'season_number', v_season.number);
end $$;

create or replace function public.release_matchday_lease(p_game_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.games set processing_lease_until = null where id = p_game_id;
$$;

-- Apply a batch of player state updates with optimistic version checks.
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
    version = p.version + 1,
    updated_at = now()
  from jsonb_to_recordset(p_updates) as u(id uuid, expected_version integer, form numeric, morale smallint,
       fitness smallint, sharpness smallint, fatigue smallint, injured_matches smallint, injury_type text,
       suspension_matches smallint, yellow_accumulation smallint, development_xp numeric, current_ovr smallint,
       potential_cap smallint, season_start_ovr smallint, market_value_cents bigint, wage_cents bigint,
       contract_end_season integer, age smallint, career_minutes_add integer, season_stats jsonb)
  where p.id = u.id and p.game_id = p_game_id and p.version = u.expected_version
    and (p_allowed_clubs is null or p.club_id = any(p_allowed_clubs));
  get diagnostics v_done = row_count;
  if v_done <> v_expected then
    perform public._fail('version_conflict', format('Conflito de versão em jogadores (%s/%s).', v_done, v_expected));
  end if;
  return v_done;
end $$;

create or replace function public._apply_ledger(p_game_id uuid, p_entries jsonb, p_season integer, p_round integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare e jsonb;
begin
  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    perform public._ledger(p_game_id, (e->>'club_id')::uuid, e->>'type', (e->>'amount_cents')::bigint,
                           e->>'reference', e->>'key', p_season, p_round);
  end loop;
end $$;

create or replace function public.finalize_fixture(p_fixture_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_f public.fixtures; v_game public.games; v_hg integer := (p_payload->'result'->>'home_goals')::integer;
  v_ag integer := (p_payload->'result'->>'away_goals')::integer; v_season integer;
  v_win integer; v_draw integer; v_lu jsonb;
begin
  select * into v_f from public.fixtures where id = p_fixture_id for update;
  if not found then perform public._fail('not_found', 'Jogo inexistente.'); end if;
  if v_f.status = 'completed' then
    -- exactly-once: a retried finalize changes nothing
    return jsonb_build_object('status', 'already_completed', 'same_input', v_f.input_hash = p_payload->>'input_hash',
                              'home_goals', v_f.result_home, 'away_goals', v_f.result_away);
  end if;
  select * into v_game from public.games where id = v_f.game_id for update;
  if not public._game_is_processing(v_game) or v_game.processing_round <> v_f.round_number then
    perform public._fail('no_lease', 'Lease de processamento ausente ou expirado.');
  end if;
  if v_hg is null or v_ag is null or v_hg < 0 or v_ag < 0 then perform public._fail('invalid_result', 'Resultado inválido.'); end if;
  if (select count(*) from jsonb_array_elements(p_payload->'events') e
       where e->>'event_type' in ('goal','own_goal') and (e->>'club_id')::uuid = v_f.home_club_id) <> v_hg
     or (select count(*) from jsonb_array_elements(p_payload->'events') e
       where e->>'event_type' in ('goal','own_goal') and (e->>'club_id')::uuid = v_f.away_club_id) <> v_ag then
    perform public._fail('inconsistent_events', 'Golos não batem certo com os eventos.');
  end if;
  v_season := v_game.current_season;

  insert into public.match_runs (fixture_id, input_hash, simulation_version, seed, input_snapshot, result_json)
  values (v_f.id, p_payload->>'input_hash', p_payload->>'engine_version', p_payload->>'seed',
          coalesce(p_payload->'input_snapshot', '{}'::jsonb), p_payload->'result');

  insert into public.match_events (fixture_id, game_id, sequence_number, minute, second, club_id, player_id,
                                   related_player_id, event_type, payload_json)
  select v_f.id, v_f.game_id, e.sequence_number, e.minute, coalesce(e.second, 0), e.club_id, e.player_id,
         e.related_player_id, e.event_type, coalesce(e.payload, '{}'::jsonb)
    from jsonb_to_recordset(p_payload->'events') as e(sequence_number integer, minute smallint, second smallint,
         club_id uuid, player_id uuid, related_player_id uuid, event_type text, payload jsonb);

  insert into public.match_player_stats (fixture_id, game_player_id, game_id, club_id, started, minutes, rating, goals,
    assists, shots, shots_on_target, xg, passes_attempted, passes_completed, tackles, interceptions, saves, fouls,
    cards_yellow, cards_red, clean_sheet, metadata_json)
  select v_f.id, s.player_id, v_f.game_id, s.club_id, s.started, s.minutes, s.rating, s.goals, s.assists, s.shots,
         s.shots_on_target, s.xg, s.passes_attempted, s.passes_completed, s.tackles, s.interceptions, s.saves,
         s.fouls, s.cards_yellow, s.cards_red, s.clean_sheet, coalesce(s.metadata, '{}'::jsonb)
    from jsonb_to_recordset(p_payload->'player_stats') as s(player_id uuid, club_id uuid, started boolean,
         minutes smallint, rating numeric, goals smallint, assists smallint, shots smallint, shots_on_target smallint,
         xg numeric, passes_attempted smallint, passes_completed smallint, tackles smallint, interceptions smallint,
         saves smallint, fouls smallint, cards_yellow smallint, cards_red smallint, clean_sheet boolean, metadata jsonb)
   where s.club_id in (v_f.home_club_id, v_f.away_club_id);

  for v_lu in select * from jsonb_array_elements(coalesce(p_payload->'lineups', '[]'::jsonb)) loop
    insert into public.lineups (game_id, club_id, fixture_id, formation, starters_json, bench_json, auto_generated,
                                warnings_json, locked_at)
    values (v_f.game_id, (v_lu->>'club_id')::uuid, v_f.id, v_lu->>'formation', v_lu->'starters', v_lu->'bench',
            coalesce((v_lu->>'auto_generated')::boolean, false), coalesce(v_lu->'warnings', '[]'::jsonb), now());
  end loop;

  update public.fixtures set status = 'completed', result_home = v_hg, result_away = v_ag,
         sim_seed = p_payload->>'seed', engine_version = p_payload->>'engine_version',
         input_hash = p_payload->>'input_hash', stats_json = p_payload->'result'->'team_stats', completed_at = now()
   where id = v_f.id;

  -- standings projection (exactly once because the fixture can only complete once)
  v_win := public._setting_int(v_game, 'points_win', 3);
  v_draw := public._setting_int(v_game, 'points_draw', 1);
  update public.standings s set
    played = played + 1,
    won = won + (case when x.gf > x.ga then 1 else 0 end),
    drawn = drawn + (case when x.gf = x.ga then 1 else 0 end),
    lost = lost + (case when x.gf < x.ga then 1 else 0 end),
    gf = s.gf + x.gf, ga = s.ga + x.ga,
    points = points + (case when x.gf > x.ga then v_win when x.gf = x.ga then v_draw else 0 end),
    form = right(s.form || (case when x.gf > x.ga then 'W' when x.gf = x.ga then 'D' else 'L' end), 5),
    updated_at = now()
  from (values (v_f.home_club_id, v_hg, v_ag), (v_f.away_club_id, v_ag, v_hg)) as x(club_id, gf, ga)
  where s.season_id = v_f.season_id and s.club_id = x.club_id;

  perform public._apply_player_updates(v_f.game_id, p_payload->'player_updates',
                                       array[v_f.home_club_id, v_f.away_club_id]);

  insert into public.player_progression_log (game_id, game_player_id, fixture_id, season_number, round_number,
    old_ovr, new_ovr, xp_before, xp_after, change_reason_json, algorithm_version, idempotency_key)
  select v_f.game_id, l.player_id, v_f.id, v_season, v_f.round_number, l.old_ovr, l.new_ovr, l.xp_before, l.xp_after,
         coalesce(l.reason, '{}'::jsonb), l.algorithm_version, 'fixture:' || v_f.id || ':' || l.player_id
    from jsonb_to_recordset(coalesce(p_payload->'progression_logs', '[]'::jsonb)) as l(player_id uuid,
         old_ovr smallint, new_ovr smallint, xp_before numeric, xp_after numeric, reason jsonb, algorithm_version text);

  perform public._apply_ledger(v_f.game_id, p_payload->'ledger', v_season, v_f.round_number);
  return jsonb_build_object('status', 'completed', 'home_goals', v_hg, 'away_goals', v_ag);
end $$;

create or replace function public.complete_matchday(p_game_id uuid, p_round integer, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_game public.games; v_season public.seasons; v_pending integer; v_interval integer;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if v_game.current_matchday >= p_round then
    return jsonb_build_object('status', 'already_completed', 'round', p_round);
  end if;
  if not public._game_is_processing(v_game) or v_game.processing_round <> p_round then
    perform public._fail('no_lease', 'Lease de processamento ausente ou expirado.');
  end if;
  select * into v_season from public.seasons where game_id = p_game_id and number = v_game.current_season;
  select count(*) into v_pending from public.fixtures
   where season_id = v_season.id and round_number = p_round and status <> 'completed';
  if v_pending > 0 then perform public._fail('round_incomplete', 'Ainda há jogos por concluir nesta jornada.'); end if;

  -- players of clubs without a fixture this round (bye) and any round-level state
  perform public._apply_player_updates(p_game_id, p_payload->'player_updates', null);
  perform public._apply_ledger(p_game_id, p_payload->'ledger', v_game.current_season, p_round);

  -- expire stale offers and release reservations
  update public.game_clubs c set reserved_cents = c.reserved_cents - s.total
    from (select buyer_club_id, sum(amount_cents) total from public.transfer_offers
           where game_id = p_game_id and status = 'pending' and expires_at < now() group by buyer_club_id) s
   where c.id = s.buyer_club_id;
  update public.transfer_offers set status = 'expired', responded_at = now()
   where game_id = p_game_id and status = 'pending' and expires_at < now();

  v_interval := public._setting_int(v_game, 'round_interval_hours', 24);
  update public.games set current_matchday = p_round, processing_lease_until = null, processing_round = null,
         next_deadline_at = case when p_round < v_season.total_rounds
                                 then greatest(coalesce(next_deadline_at, now()), now()) + make_interval(hours => v_interval)
                                 else null end
   where id = p_game_id;
  perform public._notify(m.user_id, p_game_id, 'matchday_completed', jsonb_build_object('round', p_round))
     from public.game_members m where m.game_id = p_game_id;
  perform public._audit(p_game_id, null, 'matchday.complete', 'game', p_game_id::text, jsonb_build_object('round', p_round));
  return jsonb_build_object('status', 'completed', 'round', p_round,
                            'season_complete', p_round >= v_season.total_rounds);
end $$;

create or replace function public.end_season(p_game_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_game public.games; v_season public.seasons; v_new uuid; v_rounds integer;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if (p_payload->>'season_number')::integer <> v_game.current_season then
    return jsonb_build_object('status', 'already_completed');
  end if;
  select * into v_season from public.seasons where game_id = p_game_id and number = v_game.current_season for update;
  if v_season.status <> 'active' or v_game.current_matchday < v_season.total_rounds then
    perform public._fail('season_not_finished', 'A época ainda não terminou.');
  end if;
  perform public._apply_ledger(p_game_id, p_payload->'ledger', v_game.current_season, v_season.total_rounds);
  perform public._apply_player_updates(p_game_id, p_payload->'player_updates', null);
  update public.seasons set status = 'completed', completed_at = now(), summary_json = p_payload->'summary'
   where id = v_season.id;
  insert into public.seasons (game_id, number) values (p_game_id, v_game.current_season + 1) returning id into v_new;
  v_rounds := public._generate_fixtures(p_game_id, v_new,
                now() + make_interval(hours => public._setting_int(v_game, 'round_interval_hours', 24)),
                public._setting_int(v_game, 'round_interval_hours', 24));
  update public.games set current_season = current_season + 1, current_matchday = 0,
         next_deadline_at = now() + make_interval(hours => public._setting_int(v_game, 'round_interval_hours', 24))
   where id = p_game_id;
  perform public._notify(m.user_id, p_game_id, 'season_completed', coalesce(p_payload->'summary', '{}'::jsonb))
     from public.game_members m where m.game_id = p_game_id;
  perform public._audit(p_game_id, null, 'season.end', 'season', v_season.id::text);
  return jsonb_build_object('status', 'completed', 'new_season', v_game.current_season + 1, 'rounds', v_rounds);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_game_tx(uuid, jsonb)', 'begin_matchday(uuid, integer)', 'release_matchday_lease(uuid)',
    '_apply_player_updates(uuid, jsonb, uuid[])', '_apply_ledger(uuid, jsonb, integer, integer)',
    'finalize_fixture(uuid, jsonb)', 'complete_matchday(uuid, integer, jsonb)', 'end_season(uuid, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
