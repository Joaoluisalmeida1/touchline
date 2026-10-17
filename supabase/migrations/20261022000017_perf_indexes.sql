-- Touchline — 0017: indexes for hot read paths and league deletion. Indexes only: no schema or behaviour change.
-- Chosen from an unindexed-foreign-key audit (Supabase linter 0001) filtered by real access patterns; FKs on small
-- per-club tables (tactics, standings, board_state, …) are intentionally left unindexed.

-- ---------- hot read paths ----------
-- getRecentRatings (squad form sparklines) filters match_player_stats by club across every fixture of the league
create index if not exists mps_club_idx on public.match_player_stats(club_id);
-- match page: lineups used in a fixture
create index if not exists lineups_fixture_idx on public.lineups(fixture_id) where fixture_id is not null;
-- dashboard: unread notification count per league
create index if not exists notifications_unread_idx on public.notifications(user_id, game_id) where read_at is null;
-- cron (processDueGames): active daily-mode leagues past their deadline
create index if not exists games_due_idx on public.games(next_deadline_at) where status = 'active' and tick_mode = 'daily';
-- weekly inbox / sponsor offers are read per league and season
create index if not exists inbox_events_game_season_idx on public.inbox_events(game_id, season);
create index if not exists sponsor_offers_game_season_idx on public.sponsor_offers(game_id, season);

-- ---------- league deletion (on delete cascade from games) ----------
-- the append-only tables that grow every matchday; without these each cascade step is a sequential scan
create index if not exists match_events_game_idx on public.match_events(game_id);
create index if not exists mps_game_idx on public.match_player_stats(game_id);
create index if not exists club_ledger_game_idx on public.club_ledger(game_id);
create index if not exists ppl_game_idx on public.player_progression_log(game_id);
create index if not exists notifications_game_idx on public.notifications(game_id);
create index if not exists staff_candidates_game_idx on public.staff_candidates(game_id);
-- game_players are deleted with their league: match_events.{player_id, related_player_id} are "on delete set null"
create index if not exists match_events_player_idx on public.match_events(player_id) where player_id is not null;
create index if not exists match_events_related_player_idx on public.match_events(related_player_id) where related_player_id is not null;
