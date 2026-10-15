-- Touchline — 0006: user commands (SECURITY DEFINER, authenticated via auth.uid()).
-- Each command: authenticate -> membership/ownership -> validate -> mutate in one transaction -> audit.

-- ======================= invites & membership =======================

create or replace function public.rotate_invite(p_game_id uuid, p_ttl_hours integer default 168)
returns text language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); v_code text; v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        v_bytes bytea; i integer;
begin
  if v_uid is null then perform public._fail('unauthenticated', 'Sessão inválida.'); end if;
  if not exists (select 1 from public.games where id = p_game_id and owner_user_id = v_uid) then
    perform public._fail('forbidden', 'Só o criador da liga pode gerir convites.');
  end if;
  if p_ttl_hours not between 1 and 24 * 30 then perform public._fail('invalid', 'Validade inválida.'); end if;
  v_bytes := extensions.gen_random_bytes(16);
  v_code := '';
  for i in 0 .. 15 loop
    v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 32), 1);
  end loop;  -- 16 chars * 5 bits = 80 bits of entropy
  insert into public.game_invites (game_id, code_hash, expires_at)
  values (p_game_id, encode(extensions.digest(v_code, 'sha256'), 'hex'), now() + make_interval(hours => p_ttl_hours))
  on conflict (game_id) do update
    set code_hash = excluded.code_hash, expires_at = excluded.expires_at, revoked_at = null, created_at = now();
  perform public._audit(p_game_id, v_uid, 'invite.rotate', 'game', p_game_id::text, jsonb_build_object('ttl_hours', p_ttl_hours));
  return v_code;
end $$;

create or replace function public.revoke_invite(p_game_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.games where id = p_game_id and owner_user_id = v_uid) then
    perform public._fail('forbidden', 'Só o criador da liga pode gerir convites.');
  end if;
  update public.game_invites set revoked_at = now() where game_id = p_game_id;
  perform public._audit(p_game_id, v_uid, 'invite.revoke', 'game', p_game_id::text);
end $$;

-- Returns the game id. Same error for unknown/expired/revoked codes to avoid enumeration hints.
create or replace function public.join_game(p_code text) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); v_game public.games; v_inv public.game_invites; v_count integer;
begin
  if v_uid is null then perform public._fail('unauthenticated', 'Sessão inválida.'); end if;
  if p_code is null or char_length(p_code) <> 16 then
    perform public._fail('invite_invalid', 'Convite inválido ou expirado.');
  end if;
  select * into v_inv from public.game_invites
   where code_hash = encode(extensions.digest(upper(p_code), 'sha256'), 'hex');
  if not found or v_inv.revoked_at is not null or v_inv.expires_at < now() then
    perform public._fail('invite_invalid', 'Convite inválido ou expirado.');
  end if;
  select * into v_game from public.games where id = v_inv.game_id for update;
  if v_game.status not in ('setup','active') then perform public._fail('game_closed', 'Esta liga já não aceita managers.'); end if;
  if exists (select 1 from public.game_members where game_id = v_game.id and user_id = v_uid) then
    return v_game.id;  -- idempotent
  end if;
  select count(*) into v_count from public.game_members where game_id = v_game.id;
  if v_count >= v_game.max_managers then perform public._fail('game_full', 'A liga está cheia.'); end if;
  insert into public.game_members (game_id, user_id, role) values (v_game.id, v_uid, 'manager');
  perform public._audit(v_game.id, v_uid, 'member.join', 'game', v_game.id::text);
  perform public._notify(v_game.owner_user_id, v_game.id, 'member_joined',
    jsonb_build_object('user_id', v_uid, 'display_name', (select display_name from public.profiles where id = v_uid)));
  return v_game.id;
end $$;

create or replace function public.select_club(p_game_id uuid, p_club_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_game public.games; v_club public.game_clubs;
begin
  if not public.is_game_member(p_game_id) then perform public._fail('forbidden', 'Não és membro desta liga.'); end if;
  select * into v_game from public.games where id = p_game_id;
  if v_game.status not in ('setup','active') then perform public._fail('game_closed', 'Liga fechada.'); end if;
  if public._game_is_processing(v_game) then perform public._fail('processing', 'Jornada em processamento, tenta daqui a pouco.'); end if;
  if exists (select 1 from public.game_clubs where game_id = p_game_id and manager_user_id = v_uid) then
    perform public._fail('already_has_club', 'Já geres um clube nesta liga.');
  end if;
  select * into v_club from public.game_clubs where id = p_club_id and game_id = p_game_id for update;
  if not found then perform public._fail('club_not_found', 'Clube inexistente nesta liga.'); end if;
  if v_club.manager_user_id is not null then perform public._fail('club_taken', 'Esse clube já tem treinador.'); end if;
  update public.game_clubs set manager_user_id = v_uid where id = p_club_id;
  perform public._audit(p_game_id, v_uid, 'club.select', 'game_club', p_club_id::text);
exception when unique_violation then
  perform public._fail('already_has_club', 'Já geres um clube nesta liga.');
end $$;

create or replace function public.leave_game(p_game_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if exists (select 1 from public.games where id = p_game_id and owner_user_id = v_uid) then
    perform public._fail('owner_cannot_leave', 'O criador não pode sair da liga.');
  end if;
  if not public.is_game_member(p_game_id) then perform public._fail('forbidden', 'Não és membro desta liga.'); end if;
  -- club returns to AI control; pending offers made by that club are cancelled and reservations released
  update public.game_clubs c set reserved_cents = greatest(0, c.reserved_cents - coalesce((
      select sum(o.amount_cents) from public.transfer_offers o where o.buyer_club_id = c.id and o.status = 'pending'), 0))
   where c.game_id = p_game_id and c.manager_user_id = v_uid;
  update public.transfer_offers set status = 'cancelled', responded_at = now(), response_reason = 'manager_left'
   where status = 'pending' and buyer_club_id = (select id from public.game_clubs where game_id = p_game_id and manager_user_id = v_uid);
  update public.game_clubs set manager_user_id = null where game_id = p_game_id and manager_user_id = v_uid;
  delete from public.game_members where game_id = p_game_id and user_id = v_uid;
  perform public._audit(p_game_id, v_uid, 'member.leave', 'game', p_game_id::text);
end $$;

-- Owner-only settings that do not affect integrity (names, schedule, AI)
create or replace function public.update_game_settings(p_game_id uuid, p_name text, p_tick_mode text,
  p_timezone text, p_deadline_hour integer, p_round_interval_hours integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.games where id = p_game_id and owner_user_id = v_uid) then
    perform public._fail('forbidden', 'Só o criador pode alterar definições.');
  end if;
  if p_tick_mode not in ('manual','daily') then perform public._fail('invalid', 'Modo inválido.'); end if;
  if p_deadline_hour not between 0 and 23 then perform public._fail('invalid', 'Hora inválida.'); end if;
  if p_round_interval_hours not between 1 and 24 * 14 then perform public._fail('invalid', 'Intervalo inválido.'); end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then perform public._fail('invalid', 'Timezone inválida.'); end if;
  update public.games set
    name = coalesce(nullif(trim(p_name), ''), name),
    tick_mode = p_tick_mode, timezone = p_timezone,
    settings_json = settings_json || jsonb_build_object('deadline_hour', p_deadline_hour,
                                                        'round_interval_hours', p_round_interval_hours)
  where id = p_game_id;
  perform public._audit(p_game_id, v_uid, 'game.settings', 'game', p_game_id::text,
    jsonb_build_object('tick_mode', p_tick_mode, 'timezone', p_timezone));
end $$;

create or replace function public.start_game(p_game_id uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_game public.games; v_season uuid; v_rounds integer; v_start timestamptz;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.owner_user_id <> v_uid then perform public._fail('forbidden', 'Só o criador pode iniciar a liga.'); end if;
  if v_game.status <> 'setup' then perform public._fail('already_started', 'A liga já começou.'); end if;
  insert into public.seasons (game_id, number) values (p_game_id, 1) returning id into v_season;
  v_start := date_trunc('day', now() at time zone v_game.timezone) at time zone v_game.timezone
             + make_interval(days => 1, hours => public._setting_int(v_game, 'deadline_hour', 20));
  v_rounds := public._generate_fixtures(p_game_id, v_season, v_start,
                                        public._setting_int(v_game, 'round_interval_hours', 24));
  update public.games set status = 'active', current_season = 1, current_matchday = 0, next_deadline_at = v_start
   where id = p_game_id;
  perform public._audit(p_game_id, v_uid, 'game.start', 'game', p_game_id::text, jsonb_build_object('rounds', v_rounds));
  perform public._notify(m.user_id, p_game_id, 'game_started', jsonb_build_object('rounds', v_rounds))
     from public.game_members m where m.game_id = p_game_id;
  return v_rounds;
end $$;

-- ======================= tactics & lineup =======================

create or replace function public.save_tactics(p_game_id uuid, p_tactics jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.my_club_id(p_game_id);
begin
  if v_club is null then perform public._fail('no_club', 'Não geres nenhum clube nesta liga.'); end if;
  insert into public.tactics (game_id, club_id, formation, mentality, tempo, pressing, defensive_line, width,
                              passing_directness, transitions)
  values (p_game_id, v_club,
          coalesce(p_tactics->>'formation', '4-3-3'), coalesce(p_tactics->>'mentality', 'balanced'),
          coalesce(p_tactics->>'tempo', 'normal'), coalesce(p_tactics->>'pressing', 'medium'),
          coalesce(p_tactics->>'defensive_line', 'medium'), coalesce(p_tactics->>'width', 'balanced'),
          coalesce(p_tactics->>'passing_directness', 'mixed'), coalesce(p_tactics->>'transitions', 'balanced'))
  on conflict (club_id) do update set
    formation = excluded.formation, mentality = excluded.mentality, tempo = excluded.tempo,
    pressing = excluded.pressing, defensive_line = excluded.defensive_line, width = excluded.width,
    passing_directness = excluded.passing_directness, transitions = excluded.transitions, updated_at = now();
exception when check_violation then
  perform public._fail('invalid_tactics', 'Valores táticos inválidos.');
end $$;

-- p_starters: [{"player_id": uuid, "slot": "GK"}, ...] exactly 11 matching formation slots.
create or replace function public.save_lineup(p_game_id uuid, p_formation text, p_starters jsonb, p_bench jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.my_club_id(p_game_id); v_game public.games;
  v_slots text[]; v_given text[]; v_ids uuid[]; v_bench uuid[]; v_bad integer;
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

  insert into public.lineups (game_id, club_id, fixture_id, formation, starters_json, bench_json, auto_generated)
  values (p_game_id, v_club, null, p_formation, p_starters, to_jsonb(v_bench), false)
  on conflict (club_id, fixture_id) do update set
    formation = excluded.formation, starters_json = excluded.starters_json, bench_json = excluded.bench_json,
    auto_generated = false, warnings_json = '[]'::jsonb, updated_at = now();
  update public.tactics set formation = p_formation, updated_at = now() where club_id = v_club;
end $$;

-- ======================= transfer market =======================

create or replace function public.list_player(p_player_id uuid, p_asking_cents bigint) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_p public.game_players; v_id uuid;
begin
  select * into v_p from public.game_players where id = p_player_id;
  if not found or not public.manages_club(v_p.club_id) then perform public._fail('forbidden', 'Este jogador não é teu.'); end if;
  if p_asking_cents is null or p_asking_cents <= 0 or p_asking_cents > 100000000000 then
    perform public._fail('invalid_amount', 'Preço inválido.');
  end if;
  update public.transfer_listings set status = 'withdrawn' where player_id = p_player_id and status = 'active';
  insert into public.transfer_listings (game_id, player_id, seller_club_id, asking_price_cents)
  values (v_p.game_id, p_player_id, v_p.club_id, p_asking_cents) returning id into v_id;
  perform public._audit(v_p.game_id, v_uid, 'market.list', 'game_player', p_player_id::text,
                        jsonb_build_object('asking_cents', p_asking_cents));
  return v_id;
end $$;

create or replace function public.unlist_player(p_player_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p public.game_players;
begin
  select * into v_p from public.game_players where id = p_player_id;
  if not found or not public.manages_club(v_p.club_id) then perform public._fail('forbidden', 'Este jogador não é teu.'); end if;
  update public.transfer_listings set status = 'withdrawn' where player_id = p_player_id and status = 'active';
end $$;

-- What an AI club wants for a player (deterministic). Exposed so the UI can show the asking price.
create or replace function public.ai_asking_price(p_player_id uuid) returns bigint
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_p public.game_players; v_rank integer; v_mult numeric; v_listing bigint;
begin
  select * into v_p from public.game_players where id = p_player_id;
  if not found or not public.is_game_member(v_p.game_id) then return null; end if;
  select asking_price_cents into v_listing from public.transfer_listings where player_id = p_player_id and status = 'active';
  if v_listing is not null then return v_listing; end if;
  select count(*) + 1 into v_rank from public.game_players q
   where q.club_id = v_p.club_id and q.current_ovr > v_p.current_ovr;
  v_mult := case when v_rank <= 3 then 1.60 when v_rank <= 11 then 1.35 else 1.15 end;
  -- contract running out => cheaper
  if v_p.contract_end_season <= (select current_season from public.games where id = v_p.game_id) then
    v_mult := v_mult - 0.20;
  end if;
  return greatest(10000000, round(v_p.market_value_cents * v_mult / 100000) * 100000);  -- min €100k, rounded to €1k
end $$;

-- Atomic transfer of an accepted offer. Caller must already hold row locks on the offer.
create or replace function public._execute_transfer(p_offer_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_o public.transfer_offers; v_p public.game_players; v_buyer public.game_clubs; v_seller public.game_clubs;
  v_game public.games; v_min_squad integer; v_max_squad integer; v_count integer; v_first uuid; v_second uuid;
begin
  select * into v_o from public.transfer_offers where id = p_offer_id for update;
  if v_o.status <> 'pending' then perform public._fail('offer_closed', 'Esta proposta já não está ativa.'); end if;
  select * into v_game from public.games where id = v_o.game_id;
  if public._game_is_processing(v_game) then perform public._fail('processing', 'Mercado bloqueado durante a jornada.'); end if;

  -- lock clubs in a stable order to avoid deadlocks
  v_first := least(v_o.buyer_club_id, v_o.seller_club_id);
  v_second := greatest(v_o.buyer_club_id, v_o.seller_club_id);
  perform 1 from public.game_clubs where id = v_first for update;
  perform 1 from public.game_clubs where id = v_second for update;
  select * into v_buyer from public.game_clubs where id = v_o.buyer_club_id;
  select * into v_seller from public.game_clubs where id = v_o.seller_club_id;
  select * into v_p from public.game_players where id = v_o.player_id for update;

  if v_p.club_id is distinct from v_o.seller_club_id then
    perform public._fail('player_moved', 'O jogador já não pertence ao clube vendedor.');
  end if;
  -- the reservation for this offer is included in reserved_cents
  if v_buyer.cash_cents - v_buyer.reserved_cents < 0 then
    perform public._fail('insufficient_funds', 'O comprador não tem fundos suficientes.');
  end if;
  v_min_squad := public._setting_int(v_game, 'min_squad', 16);
  v_max_squad := public._setting_int(v_game, 'max_squad', 32);
  select count(*) into v_count from public.game_players where club_id = v_seller.id;
  if v_count - 1 < v_min_squad then perform public._fail('squad_min', 'O vendedor ficaria com plantel abaixo do mínimo.'); end if;
  select count(*) into v_count from public.game_players where club_id = v_buyer.id;
  if v_count + 1 > v_max_squad then perform public._fail('squad_max', 'O comprador excede o máximo de plantel.'); end if;

  update public.game_clubs set reserved_cents = reserved_cents - v_o.amount_cents where id = v_buyer.id;
  perform public._ledger(v_o.game_id, v_buyer.id, 'transfer_purchase', -v_o.amount_cents, v_o.id::text,
                         'offer:' || v_o.id || ':buyer', v_game.current_season, v_game.current_matchday);
  perform public._ledger(v_o.game_id, v_seller.id, 'transfer_sale', v_o.amount_cents, v_o.id::text,
                         'offer:' || v_o.id || ':seller', v_game.current_season, v_game.current_matchday);

  update public.game_players set club_id = v_buyer.id, version = version + 1,
         morale = least(100, morale + 5),
         contract_end_season = greatest(contract_end_season, v_game.current_season + 2),
         updated_at = now()
   where id = v_p.id;

  -- remove from seller's current lineup (it will be auto-fixed at deadline)
  update public.lineups l set
    starters_json = coalesce((select jsonb_agg(e) from jsonb_array_elements(l.starters_json) e
                              where (e->>'player_id')::uuid <> v_p.id), '[]'::jsonb),
    bench_json = coalesce((select jsonb_agg(e) from jsonb_array_elements(l.bench_json) e
                           where (e#>>'{}')::uuid <> v_p.id), '[]'::jsonb),
    warnings_json = warnings_json || jsonb_build_array('player_sold'), updated_at = now()
   where l.club_id = v_seller.id and l.fixture_id is null;

  update public.transfer_offers set status = 'accepted', responded_at = now() where id = v_o.id;
  -- every other pending offer for this player is superseded; release their reservations
  update public.game_clubs c set reserved_cents = c.reserved_cents - s.total
    from (select buyer_club_id, sum(amount_cents) total from public.transfer_offers
           where player_id = v_p.id and status = 'pending' and id <> v_o.id group by buyer_club_id) s
   where c.id = s.buyer_club_id;
  update public.transfer_offers set status = 'superseded', responded_at = now()
   where player_id = v_p.id and status = 'pending' and id <> v_o.id;
  update public.transfer_listings set status = 'sold' where player_id = v_p.id and status = 'active';

  insert into public.transfer_transactions (game_id, player_id, from_club_id, to_club_id, price_cents, offer_id, season_number)
  values (v_o.game_id, v_p.id, v_seller.id, v_buyer.id, v_o.amount_cents, v_o.id, v_game.current_season);

  perform public._notify(v_buyer.manager_user_id, v_o.game_id, 'transfer_completed',
    jsonb_build_object('player', v_p.name_snapshot, 'amount_cents', v_o.amount_cents, 'direction', 'in'));
  perform public._notify(v_seller.manager_user_id, v_o.game_id, 'transfer_completed',
    jsonb_build_object('player', v_p.name_snapshot, 'amount_cents', v_o.amount_cents, 'direction', 'out'));
  perform public._audit(v_o.game_id, auth.uid(), 'transfer.complete', 'transfer_offer', v_o.id::text,
    jsonb_build_object('player_id', v_p.id, 'amount_cents', v_o.amount_cents, 'from', v_seller.id, 'to', v_buyer.id));
  return jsonb_build_object('status', 'accepted', 'offer_id', v_o.id);
end $$;

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

  select * into v_p from public.game_players where id = p_player_id;
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

create or replace function public.respond_offer(p_offer_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_o public.transfer_offers; v_buyer_mgr uuid;
begin
  select * into v_o from public.transfer_offers where id = p_offer_id for update;
  if not found or not public.manages_club(v_o.seller_club_id) then perform public._fail('forbidden', 'Proposta inexistente.'); end if;
  if v_o.status <> 'pending' then
    return jsonb_build_object('status', v_o.status, 'offer_id', v_o.id, 'replayed', true);
  end if;
  if v_o.expires_at < now() then
    update public.transfer_offers set status = 'expired', responded_at = now() where id = v_o.id;
    update public.game_clubs set reserved_cents = reserved_cents - v_o.amount_cents where id = v_o.buyer_club_id;
    return jsonb_build_object('status', 'expired', 'offer_id', v_o.id);
  end if;
  select manager_user_id into v_buyer_mgr from public.game_clubs where id = v_o.buyer_club_id;
  if p_accept then
    return public._execute_transfer(v_o.id);
  end if;
  update public.transfer_offers set status = 'rejected', responded_at = now(), response_reason = 'manager_rejected'
   where id = v_o.id;
  update public.game_clubs set reserved_cents = reserved_cents - v_o.amount_cents where id = v_o.buyer_club_id;
  perform public._notify(v_buyer_mgr, v_o.game_id, 'offer_rejected', jsonb_build_object('offer_id', v_o.id));
  perform public._audit(v_o.game_id, v_uid, 'offer.reject', 'transfer_offer', v_o.id::text);
  return jsonb_build_object('status', 'rejected', 'offer_id', v_o.id);
end $$;

create or replace function public.cancel_offer(p_offer_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_o public.transfer_offers;
begin
  select * into v_o from public.transfer_offers where id = p_offer_id for update;
  if not found or not public.manages_club(v_o.buyer_club_id) then perform public._fail('forbidden', 'Proposta inexistente.'); end if;
  if v_o.status <> 'pending' then return jsonb_build_object('status', v_o.status, 'replayed', true); end if;
  update public.transfer_offers set status = 'cancelled', responded_at = now() where id = v_o.id;
  update public.game_clubs set reserved_cents = reserved_cents - v_o.amount_cents where id = v_o.buyer_club_id;
  perform public._audit(v_o.game_id, auth.uid(), 'offer.cancel', 'transfer_offer', v_o.id::text);
  return jsonb_build_object('status', 'cancelled', 'offer_id', v_o.id);
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[]) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
$$;

-- ======================= grants =======================
revoke all on function public._execute_transfer(uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'rotate_invite(uuid, integer)', 'revoke_invite(uuid)', 'join_game(text)', 'select_club(uuid, uuid)',
    'leave_game(uuid)', 'update_game_settings(uuid, text, text, text, integer, integer)', 'start_game(uuid)',
    'save_tactics(uuid, jsonb)', 'save_lineup(uuid, text, jsonb, jsonb)', 'list_player(uuid, bigint)',
    'unlist_player(uuid)', 'ai_asking_price(uuid)', 'create_offer(uuid, bigint, text)',
    'respond_offer(uuid, boolean)', 'cancel_offer(uuid)', 'mark_notifications_read(uuid[])'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
