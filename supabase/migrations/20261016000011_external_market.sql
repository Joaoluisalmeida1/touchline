-- Touchline — 0011: transfer market across the whole dataset ("mercado externo").
-- A game only materialises the clubs/players of its own league. Every other player of the game's dataset snapshot is
-- buyable from an external (AI, non-league) club: the player row is created in game_players only when signed.
-- Additive and drop-free: one column + one service-only command.

alter table public.transfer_transactions add column if not exists external_from_name text;

-- Deterministic asking price of an external club (same multipliers as ai_asking_price: rank inside the source club).
create or replace function public.external_asking_price(p_snapshot_id uuid, p_source_player_id uuid) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  with p as (
    select * from public.dataset_snapshot_players where snapshot_id = p_snapshot_id and source_player_id = p_source_player_id
  ), r as (
    select count(*) + 1 as rnk from public.dataset_snapshot_players q, p
     where q.snapshot_id = p_snapshot_id and q.source_club_id is not distinct from p.source_club_id and q.initial_ovr > p.initial_ovr
  )
  select greatest(10000000, round(p.base_value_eur * 100 *
           (case when r.rnk <= 3 then 1.60 when r.rnk <= 11 then 1.35 else 1.15 end) / 100000) * 100000)::bigint
    from p, r;
$$;

-- Sign a player from outside the game's league. SERVICE ROLE ONLY: the server action authenticates the user and computes
-- wage/contract/profile (economy rules live in TS); everything that matters for integrity is re-checked here.
create or replace function public.sign_external_player_tx(p_user_id uuid, p_game_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_game public.games; v_buyer public.game_clubs; v_src public.dataset_snapshot_players; v_ask bigint;
  v_amount bigint := (p_payload->>'amount_cents')::bigint; v_count integer; v_player_id uuid; v_club_name text;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or not exists (select 1 from public.game_members where game_id = p_game_id and user_id = p_user_id) then
    perform public._fail('not_found', 'Liga inexistente.');
  end if;
  if v_game.status not in ('setup','active') then perform public._fail('game_closed', 'Liga fechada.'); end if;
  if public._game_is_processing(v_game) then perform public._fail('processing', 'Mercado bloqueado durante a jornada.'); end if;

  select * into v_buyer from public.game_clubs where game_id = p_game_id and manager_user_id = p_user_id for update;
  if not found then perform public._fail('no_club', 'Precisas de um clube para comprar.'); end if;

  select * into v_src from public.dataset_snapshot_players
   where snapshot_id = v_game.dataset_snapshot_id and source_player_id = (p_payload->>'source_player_id')::uuid;
  if not found then perform public._fail('not_found', 'Jogador inexistente neste dataset.'); end if;
  if exists (select 1 from public.game_clubs where game_id = p_game_id and source_club_id = v_src.source_club_id) then
    perform public._fail('not_external', 'Este jogador joga nesta liga — usa a proposta normal.');
  end if;
  if exists (select 1 from public.game_players where game_id = p_game_id and source_player_id = v_src.source_player_id) then
    perform public._fail('already_signed', 'Este jogador já foi contratado nesta liga.');
  end if;

  if v_amount is null or v_amount < 10000000 or v_amount > 100000000000 then
    perform public._fail('invalid_amount', 'Valor inválido (mínimo €100 000).');
  end if;
  v_ask := public.external_asking_price(v_game.dataset_snapshot_id, v_src.source_player_id);
  if v_amount < v_ask then
    return jsonb_build_object('status', 'rejected', 'reason', 'ai_below_asking', 'counter_amount_cents', v_ask);
  end if;
  if v_buyer.cash_cents - v_buyer.reserved_cents < v_amount then
    perform public._fail('insufficient_funds', 'Fundos disponíveis insuficientes (inclui propostas pendentes).');
  end if;
  select count(*) into v_count from public.game_players where club_id = v_buyer.id;
  if v_count + 1 > public._setting_int(v_game, 'max_squad', 32) then
    perform public._fail('squad_max', 'O comprador excede o máximo de plantel.');
  end if;

  insert into public.game_players (game_id, source_player_id, club_id, name_snapshot, position_group, position_detail,
    birth_date, age_known, age, initial_ovr, season_start_ovr, current_ovr, potential_cap, hidden_development_rate,
    profile_json, morale, fitness, sharpness, market_value_cents, wage_cents, contract_end_season)
  values (p_game_id, v_src.source_player_id, v_buyer.id, v_src.display_name, v_src.position_group, v_src.position_detail,
    v_src.birth_date, v_src.age_at_import is not null, v_src.age_at_import, v_src.initial_ovr, v_src.initial_ovr,
    v_src.initial_ovr, v_src.initial_potential, v_src.hidden_development_rate,
    coalesce(p_payload->'profile', v_src.derived_profile_json), 65, 100, 70, v_src.base_value_eur * 100,
    greatest(0, (p_payload->>'wage_cents')::bigint),
    greatest(v_game.current_season + 2, coalesce((p_payload->>'contract_end_season')::integer, 0)))
  returning id into v_player_id;

  perform public._ledger(p_game_id, v_buyer.id, 'transfer_purchase', -v_amount, v_player_id::text,
                         'external:' || p_game_id || ':' || v_src.source_player_id, v_game.current_season, v_game.current_matchday);

  select name into v_club_name from public.dataset_snapshot_clubs
   where snapshot_id = v_game.dataset_snapshot_id and source_club_id = v_src.source_club_id;
  insert into public.transfer_transactions (game_id, player_id, from_club_id, to_club_id, price_cents, season_number, external_from_name)
  values (p_game_id, v_player_id, null, v_buyer.id, v_amount, v_game.current_season, coalesce(v_club_name, 'Clube externo'));

  perform public._notify(p_user_id, p_game_id, 'transfer_completed',
    jsonb_build_object('player', v_src.display_name, 'amount_cents', v_amount, 'direction', 'in'));
  perform public._audit(p_game_id, p_user_id, 'transfer.external', 'game_player', v_player_id::text,
    jsonb_build_object('source_player_id', v_src.source_player_id, 'amount_cents', v_amount, 'from', v_club_name));
  return jsonb_build_object('status', 'accepted', 'player_id', v_player_id);
exception when unique_violation then
  perform public._fail('already_signed', 'Este jogador já foi contratado nesta liga.');
end $$;

revoke all on function public.external_asking_price(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sign_external_player_tx(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.external_asking_price(uuid, uuid) to service_role;
grant execute on function public.sign_external_player_tx(uuid, uuid, jsonb) to service_role;
