-- Touchline — 0004: Row Level Security + explicit grants.
-- Principle: clients (anon/authenticated) can only SELECT what RLS allows.
-- Every mutation goes through SECURITY DEFINER functions (0005) or server-side service-role code (0006).

-- ---------- helpers ----------
create or replace function public.is_game_member(p_game_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.game_members m where m.game_id = p_game_id and m.user_id = auth.uid());
$$;

create or replace function public.my_club_id(p_game_id uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id from public.game_clubs c where c.game_id = p_game_id and c.manager_user_id = auth.uid();
$$;

create or replace function public.manages_club(p_club_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.game_clubs c where c.id = p_club_id and c.manager_user_id = auth.uid());
$$;

create or replace function public.shares_game_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.game_members a join public.game_members b on a.game_id = b.game_id
    where a.user_id = auth.uid() and b.user_id = p_user_id);
$$;

revoke all on function public.is_game_member(uuid), public.my_club_id(uuid),
  public.manages_club(uuid), public.shares_game_with(uuid) from public;
grant execute on function public.is_game_member(uuid), public.my_club_id(uuid),
  public.manages_club(uuid), public.shares_game_with(uuid) to authenticated;

-- ---------- baseline: nobody but the owner role/service_role can touch tables ----------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------- catalog: readable by signed-in users (no write) ----------
grant select on public.source_providers, public.source_leagues, public.source_clubs,
  public.dataset_snapshots, public.dataset_snapshot_clubs to authenticated;
create policy catalog_read on public.source_providers for select to authenticated using (true);
create policy catalog_read on public.source_leagues for select to authenticated using (true);
create policy catalog_read on public.source_clubs for select to authenticated using (true);
create policy snapshots_read on public.dataset_snapshots for select to authenticated using (status = 'finalized');
create policy snapshot_clubs_read on public.dataset_snapshot_clubs for select to authenticated
  using (exists (select 1 from public.dataset_snapshots s where s.id = snapshot_id and s.status = 'finalized'));
-- source_players / dataset_snapshot_players / import_* : service role only (game reads go via game_players)

-- ---------- profiles ----------
grant select on public.profiles to authenticated;
grant update (display_name, avatar_settings) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_game_with(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- membership-scoped reads ----------
grant select on public.games, public.game_members, public.game_clubs,
  public.seasons, public.fixtures, public.match_runs, public.match_events, public.match_player_stats,
  public.standings, public.transfer_listings, public.transfer_transactions,
  public.player_progression_log, public.audit_log to authenticated;

create policy member_read on public.games for select to authenticated using (public.is_game_member(id));
create policy member_read on public.game_members for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.game_clubs for select to authenticated using (public.is_game_member(game_id));
-- game_players: column-level grant hides potential_cap + hidden_development_rate (shown only as potential_band)
grant select (id, game_id, source_player_id, club_id, name_snapshot, position_group, position_detail,
  birth_date, age_known, age, initial_ovr, season_start_ovr, current_ovr, potential_band, profile_json,
  form, morale, fitness, sharpness, fatigue, injured_matches, injury_type, suspension_matches,
  yellow_accumulation, market_value_cents, wage_cents, contract_end_season, career_minutes,
  season_stats_json, version, updated_at) on public.game_players to authenticated;
create policy member_read on public.game_players for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.seasons for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.fixtures for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.match_events for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.match_player_stats for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.standings for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.transfer_listings for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.transfer_transactions for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.player_progression_log for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.audit_log for select to authenticated using (public.is_game_member(game_id));
create policy member_read on public.match_runs for select to authenticated
  using (exists (select 1 from public.fixtures f where f.id = fixture_id and public.is_game_member(f.game_id)));

-- ---------- private-to-club data ----------
grant select on public.tactics, public.lineups, public.transfer_offers, public.club_ledger, public.notifications to authenticated;

-- own tactics only (opponents never see them)
create policy own_club_read on public.tactics for select to authenticated using (public.manages_club(club_id));
-- own current lineup; locked lineups of completed fixtures are visible to every member
create policy lineup_read on public.lineups for select to authenticated using (
  public.manages_club(club_id)
  or (fixture_id is not null and public.is_game_member(game_id)
      and exists (select 1 from public.fixtures f where f.id = fixture_id and f.status = 'completed')));
-- offers: buyer or seller manager only
create policy offer_parties_read on public.transfer_offers for select to authenticated
  using (public.manages_club(buyer_club_id) or public.manages_club(seller_club_id));
-- ledger: own club only
create policy own_ledger_read on public.club_ledger for select to authenticated using (public.manages_club(club_id));
-- notifications: own only
create policy own_notifications on public.notifications for select to authenticated using (user_id = auth.uid());

-- game_invites, scheduled_jobs, import_*, source_players, dataset_snapshot_players: no client grants at all.
