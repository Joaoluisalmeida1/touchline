-- Touchline — 0015: "Rivals & social" (phase 4a): negotiation threads between humans (counter-offers, player swaps,
-- notes), the league wall ("Balneário") with reactions and auto-posts, and achievements. Additive; the offer amount
-- and status checks are widened (supersets) and _execute_transfer is redefined to also move a swap player.

-- ------------------------------------------------------------------ negotiations
alter table public.transfer_offers add column if not exists parent_offer_id uuid references public.transfer_offers(id) on delete set null;
alter table public.transfer_offers add column if not exists swap_player_id uuid references public.game_players(id) on delete set null;
alter table public.transfer_offers add column if not exists message text check (message is null or char_length(message) <= 140);
alter table public.transfer_offers add column if not exists counter_message text check (counter_message is null or char_length(counter_message) <= 140);
alter table public.transfer_offers drop constraint if exists transfer_offers_amount_cents_check;
alter table public.transfer_offers add constraint transfer_offers_amount_cents_check check (amount_cents >= 0);
alter table public.transfer_offers drop constraint if exists transfer_offers_status_check;
alter table public.transfer_offers add constraint transfer_offers_status_check
  check (status in ('pending','accepted','rejected','cancelled','expired','superseded','countered'));
create index if not exists transfer_offers_parent_idx on public.transfer_offers(parent_offer_id);

-- ------------------------------------------------------------------ wall + achievements
create table if not exists public.wall_posts (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references public.games(id) on delete cascade,
  author_user_id uuid references public.profiles(id) on delete set null,
  kind           text not null check (kind in ('post','transfer','achievement','headline')),
  body           text check (body is null or char_length(body) between 1 and 280),
  payload        jsonb not null default '{}'::jsonb,
  dedupe_key     text,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid references public.profiles(id) on delete set null,
  unique (game_id, dedupe_key)
);
create index if not exists wall_posts_game_idx on public.wall_posts(game_id, created_at desc);

create table if not exists public.wall_reactions (
  post_id    uuid not null references public.wall_posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (emoji in ('👏','🔥','😂','😬','🤝')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);

create table if not exists public.achievements (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  club_id     uuid references public.game_clubs(id) on delete set null,
  key         text not null,
  season      integer not null,
  round       integer not null,
  payload     jsonb not null default '{}'::jsonb,
  unlocked_at timestamptz not null default now(),
  unique (game_id, user_id, key)
);

do $$
declare t text;
begin
  foreach t in array array['wall_posts','wall_reactions','achievements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy member_read on public.wall_posts for select to authenticated using (deleted_at is null and public.is_game_member(game_id));
create policy member_read on public.wall_reactions for select to authenticated
  using (exists (select 1 from public.wall_posts p where p.id = post_id and p.deleted_at is null and public.is_game_member(p.game_id)));
create policy member_read on public.achievements for select to authenticated using (public.is_game_member(game_id));

-- ------------------------------------------------------------------ wall commands
create or replace function public.post_wall(p_game_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_body text := btrim(coalesce(p_body, '')); v_id uuid;
begin
  if v_uid is null or not public.is_game_member(p_game_id) then perform public._fail('forbidden', 'Não és membro desta liga.'); end if;
  if char_length(v_body) not between 1 and 280 then perform public._fail('invalid', 'A mensagem tem de ter entre 1 e 280 caracteres.'); end if;
  if (select count(*) from public.wall_posts where game_id = p_game_id and author_user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    perform public._fail('rate_limited', 'Já publicaste 20 mensagens nas últimas 24 horas.');
  end if;
  insert into public.wall_posts (game_id, author_user_id, kind, body) values (p_game_id, v_uid, 'post', v_body) returning id into v_id;
  return v_id;
end $$;

create or replace function public.react_wall(p_post_id uuid, p_emoji text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_game uuid; v_on boolean;
begin
  select game_id into v_game from public.wall_posts where id = p_post_id and deleted_at is null;
  if v_game is null or not public.is_game_member(v_game) then perform public._fail('not_found', 'Mensagem inexistente.'); end if;
  -- same set as the wall_reactions check (code points: clap, fire, joy, grimace, handshake)
  if p_emoji is null or p_emoji <> all (array[chr(128079), chr(128293), chr(128514), chr(128556), chr(129309)]) then perform public._fail('invalid', 'Reação inválida.'); end if;
  -- toggle (rows are flipped, never removed)
  insert into public.wall_reactions (post_id, user_id, emoji) values (p_post_id, v_uid, p_emoji)
  on conflict (post_id, user_id, emoji) do update set active = not public.wall_reactions.active, created_at = now()
  returning active into v_on;
  return v_on;
end $$;

-- the author or the league owner can remove a post (soft delete)
create or replace function public.delete_wall_post(p_post_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_p public.wall_posts; v_owner uuid;
begin
  select * into v_p from public.wall_posts where id = p_post_id and deleted_at is null for update;
  if not found or not public.is_game_member(v_p.game_id) then perform public._fail('not_found', 'Mensagem inexistente.'); end if;
  select owner_user_id into v_owner from public.games where id = v_p.game_id;
  if v_p.author_user_id is distinct from v_uid and v_owner <> v_uid then perform public._fail('forbidden', 'Só o autor ou o dono da liga podem apagar.'); end if;
  update public.wall_posts set deleted_at = now(), deleted_by = v_uid where id = v_p.id;
end $$;

-- ------------------------------------------------------------------ transfers (redefined: swaps + wall auto-post)
create or replace function public._execute_transfer(p_offer_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_o public.transfer_offers; v_p public.game_players; v_s public.game_players; v_buyer public.game_clubs; v_seller public.game_clubs;
  v_game public.games; v_min_squad integer; v_max_squad integer; v_count integer; v_first uuid; v_second uuid;
begin
  perform 1 from public.game_players where id = (select player_id from public.transfer_offers where id = p_offer_id) for update;
  perform 1 from public.game_players where id = (select swap_player_id from public.transfer_offers where id = p_offer_id) for update;
  select * into v_o from public.transfer_offers where id = p_offer_id for update;
  if v_o.status <> 'pending' then perform public._fail('offer_closed', 'Esta proposta já não está ativa.'); end if;
  select * into v_game from public.games where id = v_o.game_id;
  if public._game_is_processing(v_game) then perform public._fail('processing', 'Mercado bloqueado durante a jornada.'); end if;

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
  if v_o.swap_player_id is not null then
    select * into v_s from public.game_players where id = v_o.swap_player_id for update;
    if not found or v_s.club_id is distinct from v_o.buyer_club_id then
      perform public._fail('player_moved', 'O jogador da troca já não pertence ao comprador.');
    end if;
  end if;
  if v_buyer.cash_cents - v_buyer.reserved_cents < 0 then
    perform public._fail('insufficient_funds', 'O comprador não tem fundos suficientes.');
  end if;
  if v_o.swap_player_id is null then
    v_min_squad := public._setting_int(v_game, 'min_squad', 16);
    v_max_squad := public._setting_int(v_game, 'max_squad', 32);
    select count(*) into v_count from public.game_players where club_id = v_seller.id;
    if v_count - 1 < v_min_squad then perform public._fail('squad_min', 'O vendedor ficaria com plantel abaixo do mínimo.'); end if;
    select count(*) into v_count from public.game_players where club_id = v_buyer.id;
    if v_count + 1 > v_max_squad then perform public._fail('squad_max', 'O comprador excede o máximo de plantel.'); end if;
  end if;

  update public.game_clubs set reserved_cents = reserved_cents - v_o.amount_cents where id = v_buyer.id;
  if v_o.amount_cents > 0 then
    perform public._ledger(v_o.game_id, v_buyer.id, 'transfer_purchase', -v_o.amount_cents, v_o.id::text,
                           'offer:' || v_o.id || ':buyer', v_game.current_season, v_game.current_matchday);
    perform public._ledger(v_o.game_id, v_seller.id, 'transfer_sale', v_o.amount_cents, v_o.id::text,
                           'offer:' || v_o.id || ':seller', v_game.current_season, v_game.current_matchday);
  end if;

  update public.game_players set club_id = v_buyer.id, version = version + 1, morale = least(100, morale + 5),
         contract_end_season = greatest(contract_end_season, v_game.current_season + 2), updated_at = now()
   where id = v_p.id;
  update public.lineups l set
    starters_json = coalesce((select jsonb_agg(e) from jsonb_array_elements(l.starters_json) e where (e->>'player_id')::uuid <> v_p.id), '[]'::jsonb),
    bench_json = coalesce((select jsonb_agg(e) from jsonb_array_elements(l.bench_json) e where (e#>>'{}')::uuid <> v_p.id), '[]'::jsonb),
    warnings_json = warnings_json || jsonb_build_array('player_sold'), updated_at = now()
   where l.club_id = v_seller.id and l.fixture_id is null;

  if v_o.swap_player_id is not null then
    update public.game_players set club_id = v_seller.id, version = version + 1, morale = least(100, morale + 3),
           contract_end_season = greatest(contract_end_season, v_game.current_season + 1), updated_at = now()
     where id = v_s.id;
    update public.lineups l set
      starters_json = coalesce((select jsonb_agg(e) from jsonb_array_elements(l.starters_json) e where (e->>'player_id')::uuid <> v_s.id), '[]'::jsonb),
      bench_json = coalesce((select jsonb_agg(e) from jsonb_array_elements(l.bench_json) e where (e#>>'{}')::uuid <> v_s.id), '[]'::jsonb),
      warnings_json = warnings_json || jsonb_build_array('player_sold'), updated_at = now()
     where l.club_id = v_buyer.id and l.fixture_id is null;
    -- offers on the swapped player are void too
    update public.game_clubs c set reserved_cents = c.reserved_cents - s.total
      from (select buyer_club_id, sum(amount_cents) total from public.transfer_offers
             where player_id = v_s.id and status = 'pending' group by buyer_club_id) s
     where c.id = s.buyer_club_id;
    update public.transfer_offers set status = 'superseded', responded_at = now() where player_id = v_s.id and status = 'pending';
    update public.transfer_listings set status = 'sold' where player_id = v_s.id and status = 'active';
    insert into public.transfer_transactions (game_id, player_id, from_club_id, to_club_id, price_cents, offer_id, season_number)
    values (v_o.game_id, v_s.id, v_buyer.id, v_seller.id, 0, null, v_game.current_season);
  end if;

  update public.transfer_offers set status = 'accepted', responded_at = now() where id = v_o.id;
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
  -- the wall announces deals that involve a human manager
  if v_buyer.manager_user_id is not null or v_seller.manager_user_id is not null then
    insert into public.wall_posts (game_id, kind, payload, dedupe_key)
    values (v_o.game_id, 'transfer', jsonb_build_object(
              'player', v_p.name_snapshot, 'player_id', v_p.id, 'amount_cents', v_o.amount_cents,
              'from', v_seller.name_snapshot, 'to', v_buyer.name_snapshot, 'swap', v_s.name_snapshot,
              'between_humans', v_buyer.manager_user_id is not null and v_seller.manager_user_id is not null),
            'transfer:' || v_o.id)
    on conflict (game_id, dedupe_key) do nothing;
  end if;
  perform public._audit(v_o.game_id, auth.uid(), 'transfer.complete', 'transfer_offer', v_o.id::text,
    jsonb_build_object('player_id', v_p.id, 'amount_cents', v_o.amount_cents, 'from', v_seller.id, 'to', v_buyer.id, 'swap_player_id', v_o.swap_player_id));
  return jsonb_build_object('status', 'accepted', 'offer_id', v_o.id);
end $$;

-- offers to human managers: optional swap player (+cash, may be €0), note, and a parent in a negotiation thread
create or replace function public.make_offer(p_player_id uuid, p_amount_cents bigint, p_idempotency_key text,
                                             p_swap_player_id uuid, p_message text, p_parent_offer_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_p public.game_players; v_game public.games; v_buyer public.game_clubs; v_seller public.game_clubs;
        v_offer public.transfer_offers; v_s public.game_players; v_depth int := 0; v_parent public.transfer_offers;
begin
  if v_uid is null then perform public._fail('unauthenticated', 'Sessão inválida.'); end if;
  select * into v_p from public.game_players where id = p_player_id;
  if not found or not public.is_game_member(v_p.game_id) then perform public._fail('not_found', 'Jogador inexistente.'); end if;
  select * into v_seller from public.game_clubs where id = v_p.club_id;
  -- AI clubs keep the instant cash-only flow
  if v_seller.manager_user_id is null then
    if p_swap_player_id is not null then perform public._fail('ai_no_swaps', 'Os clubes da IA só aceitam dinheiro.'); end if;
    return public.create_offer(p_player_id, p_amount_cents, p_idempotency_key);
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then perform public._fail('invalid', 'Chave de idempotência inválida.'); end if;
  select * into v_offer from public.transfer_offers where idempotency_key = p_idempotency_key;
  if found then
    if v_offer.created_by <> v_uid then perform public._fail('forbidden', 'Chave inválida.'); end if;
    return jsonb_build_object('status', v_offer.status, 'offer_id', v_offer.id, 'replayed', true);
  end if;
  perform 1 from public.game_players where id = p_player_id for update;
  select * into v_game from public.games where id = v_p.game_id;
  if v_game.status not in ('setup','active') then perform public._fail('game_closed', 'Liga fechada.'); end if;
  if public._game_is_processing(v_game) then perform public._fail('processing', 'Mercado bloqueado durante a jornada.'); end if;
  select * into v_buyer from public.game_clubs where game_id = v_p.game_id and manager_user_id = v_uid for update;
  if not found then perform public._fail('no_club', 'Precisas de um clube para comprar.'); end if;
  if v_p.club_id = v_buyer.id then perform public._fail('own_player', 'O jogador já é teu.'); end if;
  if p_swap_player_id is not null then
    select * into v_s from public.game_players where id = p_swap_player_id;
    if not found or v_s.club_id is distinct from v_buyer.id then perform public._fail('invalid_swap', 'Só podes oferecer jogadores teus na troca.'); end if;
  end if;
  if p_amount_cents is null or p_amount_cents < (case when p_swap_player_id is null then 10000000 else 0 end) or p_amount_cents > 100000000000 then
    perform public._fail('invalid_amount', case when p_swap_player_id is null then 'Valor inválido (mínimo €100 000).' else 'Valor inválido.' end);
  end if;
  if char_length(coalesce(p_message, '')) > 140 then perform public._fail('invalid', 'Nota demasiado longa (máx. 140).'); end if;
  if p_parent_offer_id is not null then
    select * into v_parent from public.transfer_offers where id = p_parent_offer_id;
    if not found or v_parent.buyer_club_id <> v_buyer.id or v_parent.player_id <> p_player_id then perform public._fail('invalid', 'Negociação inválida.'); end if;
    with recursive t as (select id, parent_offer_id from public.transfer_offers where id = p_parent_offer_id
                         union all select o.id, o.parent_offer_id from public.transfer_offers o join t on o.id = t.parent_offer_id)
    select count(*) into v_depth from t;
    if v_depth >= 6 then perform public._fail('thread_limit', 'Esta negociação já teve demasiadas rondas.'); end if;
  end if;
  if v_buyer.cash_cents - v_buyer.reserved_cents < p_amount_cents then
    perform public._fail('insufficient_funds', 'Fundos disponíveis insuficientes (inclui propostas pendentes).');
  end if;
  insert into public.transfer_offers (game_id, player_id, buyer_club_id, seller_club_id, amount_cents, status, idempotency_key,
                                      created_by, expires_at, swap_player_id, message, parent_offer_id)
  values (v_p.game_id, v_p.id, v_buyer.id, v_seller.id, p_amount_cents, 'pending', p_idempotency_key, v_uid, now() + interval '3 days',
          p_swap_player_id, nullif(btrim(coalesce(p_message, '')), ''), p_parent_offer_id)
  returning * into v_offer;
  update public.game_clubs set reserved_cents = reserved_cents + p_amount_cents where id = v_buyer.id;
  perform public._audit(v_p.game_id, v_uid, 'offer.create', 'transfer_offer', v_offer.id::text,
                        jsonb_build_object('player_id', v_p.id, 'amount_cents', p_amount_cents, 'swap_player_id', p_swap_player_id, 'parent', p_parent_offer_id));
  perform public._notify(v_seller.manager_user_id, v_p.game_id, 'offer_received',
    jsonb_build_object('offer_id', v_offer.id, 'player', v_p.name_snapshot, 'amount_cents', p_amount_cents,
                       'buyer', v_buyer.name_snapshot, 'swap', v_s.name_snapshot));
  return jsonb_build_object('status', 'pending', 'offer_id', v_offer.id);
exception when unique_violation then
  perform public._fail('duplicate_offer', 'Já tens uma proposta pendente por este jogador.');
end $$;

-- seller (human) answers with another amount; the buyer's reservation is released until they accept
create or replace function public.counter_offer(p_offer_id uuid, p_amount_cents bigint, p_message text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_o public.transfer_offers; v_game public.games; v_buyer_mgr uuid; v_player text;
begin
  perform 1 from public.game_players where id = (select player_id from public.transfer_offers where id = p_offer_id) for update;
  select * into v_o from public.transfer_offers where id = p_offer_id for update;
  if not found or not public.manages_club(v_o.seller_club_id) then perform public._fail('forbidden', 'Proposta inexistente.'); end if;
  if v_o.status <> 'pending' then perform public._fail('offer_closed', 'Esta proposta já não está ativa.'); end if;
  select * into v_game from public.games where id = v_o.game_id;
  if public._game_is_processing(v_game) then perform public._fail('processing', 'Mercado bloqueado durante a jornada.'); end if;
  if p_amount_cents is null or p_amount_cents < 0 or p_amount_cents > 100000000000 or p_amount_cents = v_o.amount_cents
     or (v_o.swap_player_id is null and p_amount_cents < 10000000) then
    perform public._fail('invalid_amount', 'Contraproposta inválida.');
  end if;
  if char_length(coalesce(p_message, '')) > 140 then perform public._fail('invalid', 'Nota demasiado longa (máx. 140).'); end if;
  update public.transfer_offers set status = 'countered', counter_amount_cents = p_amount_cents,
         counter_message = nullif(btrim(coalesce(p_message, '')), ''), response_reason = 'manager_countered', responded_at = now()
   where id = v_o.id;
  update public.game_clubs set reserved_cents = reserved_cents - v_o.amount_cents where id = v_o.buyer_club_id;
  select manager_user_id into v_buyer_mgr from public.game_clubs where id = v_o.buyer_club_id;
  select name_snapshot into v_player from public.game_players where id = v_o.player_id;
  perform public._notify(v_buyer_mgr, v_o.game_id, 'offer_countered',
    jsonb_build_object('offer_id', v_o.id, 'player', v_player, 'amount_cents', p_amount_cents));
  perform public._audit(v_o.game_id, auth.uid(), 'offer.counter', 'transfer_offer', v_o.id::text, jsonb_build_object('amount_cents', p_amount_cents));
  return jsonb_build_object('status', 'countered', 'offer_id', v_o.id, 'counter_amount_cents', p_amount_cents);
end $$;

-- buyer accepts the seller's counter: a new offer at that amount is created and executed at once (both agreed)
create or replace function public.accept_counter(p_offer_id uuid, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_o public.transfer_offers; v_new public.transfer_offers; v_buyer public.game_clubs; v_uid uuid := auth.uid();
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then perform public._fail('invalid', 'Chave de idempotência inválida.'); end if;
  select * into v_new from public.transfer_offers where idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('status', v_new.status, 'offer_id', v_new.id, 'replayed', true); end if;
  perform 1 from public.game_players where id = (select player_id from public.transfer_offers where id = p_offer_id) for update;
  select * into v_o from public.transfer_offers where id = p_offer_id for update;
  if not found or not public.manages_club(v_o.buyer_club_id) then perform public._fail('forbidden', 'Proposta inexistente.'); end if;
  if v_o.status <> 'countered' then perform public._fail('offer_closed', 'Esta contraproposta já não está ativa.'); end if;
  if v_o.responded_at < now() - interval '3 days' then perform public._fail('expired', 'A contraproposta expirou.'); end if;
  if exists (select 1 from public.transfer_offers where parent_offer_id = v_o.id) then perform public._fail('offer_closed', 'Já respondeste a esta contraproposta.'); end if;
  select * into v_buyer from public.game_clubs where id = v_o.buyer_club_id for update;
  if v_buyer.cash_cents - v_buyer.reserved_cents < v_o.counter_amount_cents then
    perform public._fail('insufficient_funds', 'Fundos disponíveis insuficientes (inclui propostas pendentes).');
  end if;
  insert into public.transfer_offers (game_id, player_id, buyer_club_id, seller_club_id, amount_cents, status, idempotency_key,
                                      created_by, expires_at, swap_player_id, parent_offer_id, message)
  values (v_o.game_id, v_o.player_id, v_o.buyer_club_id, v_o.seller_club_id, v_o.counter_amount_cents, 'pending', p_idempotency_key,
          v_uid, now() + interval '3 days', v_o.swap_player_id, v_o.id, 'Contraproposta aceite')
  returning * into v_new;
  update public.game_clubs set reserved_cents = reserved_cents + v_new.amount_cents where id = v_buyer.id;
  update public.transfer_offers set status = 'superseded' where id = v_o.id;
  return public._execute_transfer(v_new.id);
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function public._execute_transfer(uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['post_wall(uuid, text)', 'react_wall(uuid, text)', 'delete_wall_post(uuid)',
                           'make_offer(uuid, bigint, text, uuid, text, uuid)', 'counter_offer(uuid, bigint, text)', 'accept_counter(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
