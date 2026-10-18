-- Touchline — 0018: OSM-style Transfer List (market-v2). Additive.
-- The list fills up gradually with players from AI clubs (this league) and foreign clubs (rest of the dataset); their
-- price drops every round unsold. Managers list their own players at 50–150% of value (4 slots); AI clubs buy them at
-- the round. AI clubs no longer answer direct offers: they sell through the list. Offers between managers are unchanged.
-- Leagues can opt back into the old rules with settings_json.market = 'classic'.

alter table public.transfer_listings alter column player_id drop not null;
alter table public.transfer_listings alter column seller_club_id drop not null;
alter table public.transfer_listings add column if not exists origin text not null default 'manager';
alter table public.transfer_listings add column if not exists source_player_id uuid;
alter table public.transfer_listings add column if not exists external_club_name text;
alter table public.transfer_listings add column if not exists value_cents bigint;
alter table public.transfer_listings add column if not exists start_price_cents bigint;
alter table public.transfer_listings add column if not exists floor_price_cents bigint;
alter table public.transfer_listings add column if not exists rounds_unsold integer not null default 0;
alter table public.transfer_listings add column if not exists listed_season integer;
alter table public.transfer_listings add column if not exists listed_round integer;
alter table public.transfer_listings add column if not exists buyer_club_id uuid references public.game_clubs(id) on delete set null;
alter table public.transfer_listings add column if not exists sold_price_cents bigint;
alter table public.transfer_listings add column if not exists closed_round integer;
alter table public.transfer_listings add column if not exists closed_at timestamptz;
alter table public.transfer_listings add column if not exists buy_key text;
do $$ begin
  alter table public.transfer_listings add constraint transfer_listings_origin_check check (origin in ('manager','ai','external'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.transfer_listings add constraint transfer_listings_subject_check
    check ((player_id is not null and seller_club_id is not null) or (origin = 'external' and source_player_id is not null));
exception when duplicate_object then null; end $$;
create unique index if not exists transfer_listings_one_active_ext on public.transfer_listings(game_id, source_player_id)
  where status = 'active' and source_player_id is not null;
create index if not exists transfer_listings_open on public.transfer_listings(game_id, origin) where status = 'active';

create or replace function public._market_mode(p_game public.games) returns text
language sql stable set search_path = public, pg_temp as $$
  select coalesce(p_game.settings_json->>'market', 'osm');
$$;

-- ------------------------------------------------------------------ list / unlist (managers)
create or replace function public.list_player(p_player_id uuid, p_asking_cents bigint) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_p public.game_players; v_game public.games; v_id uuid; v_open int; v_min bigint; v_max bigint;
begin
  select * into v_p from public.game_players where id = p_player_id for update;
  if not found or not public.manages_club(v_p.club_id) then perform public._fail('forbidden', 'Este jogador não é teu.'); end if;
  select * into v_game from public.games where id = v_p.game_id;
  if v_game.status not in ('setup','active') then perform public._fail('game_closed', 'Liga fechada.'); end if;
  if public._game_is_processing(v_game) then perform public._fail('processing', 'Mercado bloqueado durante a jornada.'); end if;
  if p_asking_cents is null or p_asking_cents <= 0 or p_asking_cents > 100000000000 then
    perform public._fail('invalid_amount', 'Preço inválido.');
  end if;
  if public._market_mode(v_game) = 'osm' then
    v_min := greatest(10000000, round(v_p.market_value_cents * 0.5 / 1000000) * 1000000);
    v_max := greatest(10000000, round(v_p.market_value_cents * 1.5 / 1000000) * 1000000);
    if p_asking_cents < v_min or p_asking_cents > v_max then
      perform public._fail('price_range', format('O preço tem de estar entre €%s e €%s (50%%–150%% do valor).',
        to_char(v_min / 100, 'FM999G999G999'), to_char(v_max / 100, 'FM999G999G999')));
    end if;
    select count(*) into v_open from public.transfer_listings
     where seller_club_id = v_p.club_id and status = 'active' and player_id <> p_player_id;
    if v_open >= public._setting_int(v_game, 'market_slots', 4) then
      perform public._fail('slots_full', 'Já tens o máximo de jogadores à venda. Retira um primeiro.');
    end if;
  end if;
  update public.transfer_listings set status = 'withdrawn', closed_at = now() where player_id = p_player_id and status = 'active';
  insert into public.transfer_listings (game_id, player_id, seller_club_id, asking_price_cents, origin, value_cents,
                                        start_price_cents, floor_price_cents, listed_season, listed_round)
  values (v_p.game_id, p_player_id, v_p.club_id, p_asking_cents, 'manager', v_p.market_value_cents,
          p_asking_cents, p_asking_cents, v_game.current_season, v_game.current_matchday)
  returning id into v_id;
  perform public._audit(v_p.game_id, v_uid, 'market.list', 'game_player', p_player_id::text, jsonb_build_object('asking_cents', p_asking_cents));
  return v_id;
end $$;

-- ------------------------------------------------------------------ no direct offers to AI clubs (osm mode)
-- create_offer (the AI path of make_offer) as in 0006, plus the market-mode guard before anything is reserved.
create or replace function public.create_offer(p_player_id uuid, p_amount_cents bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_p public.game_players; v_game public.games; v_buyer public.game_clubs;
  v_seller public.game_clubs; v_offer public.transfer_offers; v_ask bigint; v_result jsonb; v_min_squad integer;
  v_count integer;
begin
  if v_uid is null then perform public._fail('unauthenticated', 'Sessão inválida.'); end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    perform public._fail('invalid', 'Chave de idempotência inválida.');
  end if;
  -- replay: same key returns the same offer, no double reservation
  select * into v_offer from public.transfer_offers where idempotency_key = p_idempotency_key;
  if found then
    if v_offer.created_by <> v_uid then perform public._fail('forbidden', 'Chave inválida.'); end if;
    return jsonb_build_object('status', v_offer.status, 'offer_id', v_offer.id, 'replayed', true,
                              'counter_amount_cents', v_offer.counter_amount_cents);
  end if;

  select * into v_p from public.game_players where id = p_player_id for update;
  if not found or not public.is_game_member(v_p.game_id) then perform public._fail('not_found', 'Jogador inexistente.'); end if;
  select * into v_game from public.games where id = v_p.game_id;
  if v_game.status not in ('setup','active') then perform public._fail('game_closed', 'Liga fechada.'); end if;
  if public._game_is_processing(v_game) then perform public._fail('processing', 'Mercado bloqueado durante a jornada.'); end if;
  select * into v_buyer from public.game_clubs where game_id = v_p.game_id and manager_user_id = v_uid for update;
  if not found then perform public._fail('no_club', 'Precisas de um clube para comprar.'); end if;
  if v_p.club_id is null then perform public._fail('not_available', 'Jogador sem clube (não suportado no MVP).'); end if;
  if v_p.club_id = v_buyer.id then perform public._fail('own_player', 'O jogador já é teu.'); end if;
  if p_amount_cents is null or p_amount_cents < 10000000 or p_amount_cents > 100000000000 then
    perform public._fail('invalid_amount', 'Valor inválido (mínimo €100 000).');
  end if;
  if v_buyer.cash_cents - v_buyer.reserved_cents < p_amount_cents then
    perform public._fail('insufficient_funds', 'Fundos disponíveis insuficientes (inclui propostas pendentes).');
  end if;
  select * into v_seller from public.game_clubs where id = v_p.club_id;
  -- market-v2: AI clubs sell only through the Transfer List
  if v_seller.manager_user_id is null and public._market_mode(v_game) = 'osm' then
    perform public._fail('ai_list_only', 'Os clubes da IA só vendem pela Lista de Transferências.');
  end if;

  insert into public.transfer_offers (game_id, player_id, buyer_club_id, seller_club_id, amount_cents, status,
                                      idempotency_key, created_by, expires_at)
  values (v_p.game_id, v_p.id, v_buyer.id, v_seller.id, p_amount_cents, 'pending', p_idempotency_key, v_uid,
          now() + interval '3 days')
  returning * into v_offer;
  update public.game_clubs set reserved_cents = reserved_cents + p_amount_cents where id = v_buyer.id;
  perform public._audit(v_p.game_id, v_uid, 'offer.create', 'transfer_offer', v_offer.id::text,
                        jsonb_build_object('player_id', v_p.id, 'amount_cents', p_amount_cents));

  if v_seller.manager_user_id is null then
    -- AI club answers immediately and deterministically
    v_ask := public.ai_asking_price(v_p.id);
    v_min_squad := public._setting_int(v_game, 'min_squad', 16);
    select count(*) into v_count from public.game_players where club_id = v_seller.id;
    if v_count - 1 < v_min_squad then
      update public.transfer_offers set status = 'rejected', responded_at = now(), response_reason = 'ai_squad_too_small'
       where id = v_offer.id;
      update public.game_clubs set reserved_cents = reserved_cents - p_amount_cents where id = v_buyer.id;
      return jsonb_build_object('status', 'rejected', 'offer_id', v_offer.id, 'reason', 'ai_squad_too_small');
    elsif p_amount_cents >= v_ask then
      v_result := public._execute_transfer(v_offer.id);
      return v_result || jsonb_build_object('ai', true);
    else
      update public.transfer_offers set status = 'rejected', responded_at = now(), counter_amount_cents = v_ask,
             response_reason = 'ai_below_asking' where id = v_offer.id;
      update public.game_clubs set reserved_cents = reserved_cents - p_amount_cents where id = v_buyer.id;
      return jsonb_build_object('status', 'rejected', 'offer_id', v_offer.id, 'counter_amount_cents', v_ask,
                                'reason', 'ai_below_asking');
    end if;
  end if;

  perform public._notify(v_seller.manager_user_id, v_p.game_id, 'offer_received',
    jsonb_build_object('offer_id', v_offer.id, 'player', v_p.name_snapshot, 'amount_cents', p_amount_cents,
                       'buyer', v_buyer.name_snapshot));
  return jsonb_build_object('status', 'pending', 'offer_id', v_offer.id);
exception when unique_violation then
  perform public._fail('duplicate_offer', 'Já tens uma proposta pendente por este jogador.');
end $$;

-- ------------------------------------------------------------------ buy from the list (service only)
-- The server action authenticates the user and computes wage/contract/profile for foreign players (economy rules are
-- TS-side); everything that matters is re-checked here atomically.
create or replace function public.buy_listing_tx(p_user_id uuid, p_listing_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_l public.transfer_listings; v_game public.games; v_buyer public.game_clubs; v_seller public.game_clubs; v_offer_id uuid;
  v_src public.dataset_snapshot_players; v_count int; v_player_id uuid; v_key text := p_payload->>'idempotency_key';
  v_expected bigint := (p_payload->>'expected_price_cents')::bigint; v_name text;
begin
  if v_key is null or char_length(v_key) not between 8 and 100 then perform public._fail('invalid', 'Chave de idempotência inválida.'); end if;
  select * into v_l from public.transfer_listings where id = p_listing_id for update;
  if not found or not exists (select 1 from public.game_members where game_id = v_l.game_id and user_id = p_user_id) then
    perform public._fail('not_found', 'Jogador inexistente na lista.');
  end if;
  -- replay: the same key already bought this listing
  if v_l.status = 'sold' and v_l.buy_key = v_key then
    return jsonb_build_object('status', 'bought', 'listing_id', v_l.id, 'replayed', true);
  end if;
  if v_l.status <> 'active' then perform public._fail('listing_closed', 'Este jogador já não está na lista.'); end if;
  select * into v_game from public.games where id = v_l.game_id for update;
  if v_game.status not in ('setup','active') then perform public._fail('game_closed', 'Liga fechada.'); end if;
  if public._game_is_processing(v_game) then perform public._fail('processing', 'Mercado bloqueado durante a jornada.'); end if;
  select * into v_buyer from public.game_clubs where game_id = v_l.game_id and manager_user_id = p_user_id for update;
  if not found then perform public._fail('no_club', 'Precisas de um clube para comprar.'); end if;
  if v_l.seller_club_id = v_buyer.id then perform public._fail('own_player', 'O jogador já é teu.'); end if;
  if v_expected is not null and v_expected <> v_l.asking_price_cents then
    perform public._fail('price_changed', 'O preço mudou entretanto. Vê o novo preço e tenta outra vez.');
  end if;
  if v_buyer.cash_cents - v_buyer.reserved_cents < v_l.asking_price_cents then
    perform public._fail('insufficient_funds', 'Fundos disponíveis insuficientes (inclui propostas pendentes).');
  end if;

  if v_l.player_id is not null then
    -- a club of this league (AI or a friend): same path as an accepted offer (ledger, squad checks, wall, notifications)
    insert into public.transfer_offers (game_id, player_id, buyer_club_id, seller_club_id, amount_cents, status, idempotency_key,
                                        created_by, expires_at, response_reason)
    values (v_l.game_id, v_l.player_id, v_buyer.id, v_l.seller_club_id, v_l.asking_price_cents, 'pending', v_key, p_user_id,
            now() + interval '1 hour', 'listing_buy')
    returning id into v_offer_id;
    update public.game_clubs set reserved_cents = reserved_cents + v_l.asking_price_cents where id = v_buyer.id;
    perform public._execute_transfer(v_offer_id);
    v_player_id := v_l.player_id;
  else
    select * into v_src from public.dataset_snapshot_players
     where snapshot_id = v_game.dataset_snapshot_id and source_player_id = v_l.source_player_id;
    if not found then perform public._fail('not_found', 'Jogador inexistente neste dataset.'); end if;
    if exists (select 1 from public.game_players where game_id = v_l.game_id and source_player_id = v_src.source_player_id) then
      perform public._fail('already_signed', 'Este jogador já foi contratado nesta liga.');
    end if;
    select count(*) into v_count from public.game_players where club_id = v_buyer.id;
    if v_count + 1 > public._setting_int(v_game, 'max_squad', 32) then perform public._fail('squad_max', 'O plantel está cheio.'); end if;
    insert into public.game_players (game_id, source_player_id, club_id, name_snapshot, position_group, position_detail,
      birth_date, age_known, age, initial_ovr, season_start_ovr, current_ovr, potential_cap, hidden_development_rate,
      profile_json, morale, fitness, sharpness, market_value_cents, wage_cents, contract_end_season)
    values (v_l.game_id, v_src.source_player_id, v_buyer.id, v_src.display_name, v_src.position_group, v_src.position_detail,
      v_src.birth_date, v_src.age_at_import is not null, v_src.age_at_import, v_src.initial_ovr, v_src.initial_ovr,
      v_src.initial_ovr, v_src.initial_potential, v_src.hidden_development_rate,
      coalesce(p_payload->'profile', v_src.derived_profile_json), 70, 100, 70, v_src.base_value_eur * 100,
      greatest(0, coalesce((p_payload->>'wage_cents')::bigint, 0)),
      greatest(v_game.current_season + 2, coalesce((p_payload->>'contract_end_season')::integer, 0)))
    returning id into v_player_id;
    perform public._ledger(v_l.game_id, v_buyer.id, 'transfer_purchase', -v_l.asking_price_cents, v_player_id::text,
                           'listing:' || v_l.id, v_game.current_season, v_game.current_matchday);
    insert into public.transfer_transactions (game_id, player_id, from_club_id, to_club_id, price_cents, season_number, external_from_name)
    values (v_l.game_id, v_player_id, null, v_buyer.id, v_l.asking_price_cents, v_game.current_season, coalesce(v_l.external_club_name, 'Clube estrangeiro'));
    update public.transfer_listings set status = 'sold', player_id = v_player_id where id = v_l.id;
    insert into public.wall_posts (game_id, kind, payload, dedupe_key)
    values (v_l.game_id, 'transfer', jsonb_build_object('player', v_src.display_name, 'player_id', v_player_id, 'amount_cents', v_l.asking_price_cents,
              'from', coalesce(v_l.external_club_name, 'Clube estrangeiro'), 'to', v_buyer.name_snapshot, 'swap', null, 'between_humans', false),
            'listing:' || v_l.id)
    on conflict (game_id, dedupe_key) do nothing;
    perform public._notify(p_user_id, v_l.game_id, 'transfer_completed',
      jsonb_build_object('player', v_src.display_name, 'amount_cents', v_l.asking_price_cents, 'direction', 'in'));
  end if;

  update public.transfer_listings set buyer_club_id = v_buyer.id, sold_price_cents = v_l.asking_price_cents,
         closed_round = v_game.current_matchday, closed_at = now(), status = 'sold', buy_key = v_key
   where id = v_l.id;
  perform public._audit(v_l.game_id, p_user_id, 'market.buy', 'transfer_listing', v_l.id::text,
    jsonb_build_object('player_id', v_player_id, 'price_cents', v_l.asking_price_cents, 'origin', v_l.origin));
  return jsonb_build_object('status', 'bought', 'listing_id', v_l.id, 'player_id', v_player_id);
exception when unique_violation then
  perform public._fail('already_signed', 'Este jogador já foi contratado.');
end $$;

-- AI club buys a manager's listing at the round (service only, called by the market tick).
create or replace function public._market_ai_buy(p_listing_id uuid, p_buyer_club_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_l public.transfer_listings; v_seller public.game_clubs; v_offer_id uuid; v_game public.games;
begin
  select * into v_l from public.transfer_listings where id = p_listing_id for update;
  if not found or v_l.status <> 'active' or v_l.origin <> 'manager' then return false; end if;
  select * into v_seller from public.game_clubs where id = v_l.seller_club_id;
  select * into v_game from public.games where id = v_l.game_id;
  insert into public.transfer_offers (game_id, player_id, buyer_club_id, seller_club_id, amount_cents, status, idempotency_key,
                                      created_by, expires_at, response_reason)
  values (v_l.game_id, v_l.player_id, p_buyer_club_id, v_l.seller_club_id, v_l.asking_price_cents, 'pending',
          'ai-list:' || v_l.id, v_seller.manager_user_id, now() + interval '1 hour', 'listing_ai')
  returning id into v_offer_id;
  update public.game_clubs set reserved_cents = reserved_cents + v_l.asking_price_cents where id = p_buyer_club_id;
  perform public._execute_transfer(v_offer_id);
  update public.transfer_listings set buyer_club_id = p_buyer_club_id, sold_price_cents = v_l.asking_price_cents,
         closed_round = v_game.current_matchday, closed_at = now(), status = 'sold'
   where id = v_l.id;
  return true;
end $$;

do $$
declare f text;
begin
  foreach f in array array['buy_listing_tx(uuid, uuid, jsonb)', '_market_ai_buy(uuid, uuid)', '_market_mode(public.games)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.list_player(uuid, bigint) to authenticated, service_role;
