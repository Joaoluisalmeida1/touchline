import "server-only";
import { withService, withUser } from "./db";

/** All reads run as the signed-in user (RLS enforced). Columns are explicit (game_players has hidden columns). */

const PLAYER_COLS = `p.id, p.club_id, p.name_snapshot, p.position_group, p.position_detail, p.age, p.age_known, p.initial_ovr,
  p.season_start_ovr, p.current_ovr, p.potential_band, p.form, p.morale, p.fitness, p.sharpness, p.fatigue, p.injured_matches,
  p.injury_type, p.suspension_matches, p.market_value_cents, p.wage_cents, p.contract_end_season, p.season_stats_json, p.profile_json,
  p.preferred_slot, p.preferred_slot_season, p.position_familiarity, p.shirt_number`;

export interface PlayerRow {
  id: string; club_id: string | null; name_snapshot: string; position_group: "GK" | "DEF" | "MID" | "ATT"; position_detail: string | null;
  age: number | null; age_known: boolean; initial_ovr: number; season_start_ovr: number; current_ovr: number; potential_band: string;
  form: string; morale: number; fitness: number; sharpness: number; fatigue: number; injured_matches: number; injury_type: string | null;
  suspension_matches: number; market_value_cents: string; wage_cents: string; contract_end_season: number;
  season_stats_json: { apps?: number; goals?: number; assists?: number; minutes?: number; rating_sum?: number; rated?: number } | null;
  profile_json: Record<string, unknown>;
  preferred_slot: string | null; preferred_slot_season: number | null;
  position_familiarity: Record<string, number> | null; shirt_number: number | null;
}

export async function listMyGames(userId: string) {
  return withUser(userId, async (c) => (await c.query(
    `select g.id, g.name, g.status, g.current_season, g.current_matchday, g.next_deadline_at, g.owner_user_id = $1 as is_owner,
            ds.is_synthetic, gc.id as club_id, gc.name_snapshot as club_name, gc.short_name as club_short, gc.primary_color, gc.secondary_color,
            sl.name as league_name, (select total_rounds from seasons where game_id = g.id and number = g.current_season) as total_rounds,
            (select count(*) from game_members m where m.game_id = g.id)::int as members,
            (select count(*) from notifications n where n.game_id = g.id and n.user_id = $1 and n.read_at is null)::int as unread
       from games g
       join dataset_snapshots ds on ds.id = g.dataset_snapshot_id
       left join source_leagues sl on sl.id = g.source_league_id
       left join game_clubs gc on gc.game_id = g.id and gc.manager_user_id = $1
      order by g.created_at desc`, [userId])).rows);
}

export async function getGame(userId: string, gameId: string) {
  return withUser(userId, async (c) => {
    const g = await c.query(
      `select g.*, g.owner_user_id = $2 as is_owner, ds.is_synthetic, ds.label as snapshot_label, sl.name as league_name,
              (select id from game_clubs where game_id = g.id and manager_user_id = $2) as my_club_id,
              (select id from seasons where game_id = g.id and number = g.current_season) as season_id,
              (select total_rounds from seasons where game_id = g.id and number = g.current_season) as total_rounds
         from games g
         join dataset_snapshots ds on ds.id = g.dataset_snapshot_id
         join source_leagues sl on sl.id = g.source_league_id
        where g.id = $1`, [gameId, userId]);
    return g.rows[0] ?? null;
  });
}

export async function getClubs(userId: string, gameId: string) {
  return withUser(userId, async (c) => (await c.query(
    `select gc.id, gc.name_snapshot, gc.short_name, gc.primary_color, gc.secondary_color, gc.reputation, gc.strength, gc.manager_user_id,
            pr.display_name as manager_name, (select count(*) from game_players p where p.club_id = gc.id)::int as squad_size
       from game_clubs gc left join profiles pr on pr.id = gc.manager_user_id
      where gc.game_id = $1 order by gc.strength desc, gc.name_snapshot`, [gameId])).rows);
}

export async function getMembers(userId: string, gameId: string) {
  return withUser(userId, async (c) => (await c.query(
    `select m.user_id, m.role, m.joined_at, pr.display_name, gc.name_snapshot as club_name
       from game_members m join profiles pr on pr.id = m.user_id
       left join game_clubs gc on gc.game_id = m.game_id and gc.manager_user_id = m.user_id
      where m.game_id = $1 order by m.joined_at`, [gameId])).rows);
}

export async function getSquad(userId: string, gameId: string, clubId: string, position?: string) {
  return withUser(userId, async (c) => (await c.query<PlayerRow & { listed_price: string | null }>(
    `select ${PLAYER_COLS}, (select asking_price_cents from transfer_listings tl where tl.player_id = p.id and tl.status = 'active') as listed_price
       from game_players p where p.game_id = $1 and p.club_id = $2 and ($3::text is null or p.position_group = $3)
      order by array_position(array['GK','DEF','MID','ATT'], p.position_group), p.current_ovr desc`,
    [gameId, clubId, position ?? null])).rows);
}

export async function getTacticsAndLineup(userId: string, clubId: string) {
  return withUser(userId, async (c) => {
    const t = await c.query(`select * from tactics where club_id = $1`, [clubId]);
    const l = await c.query(`select formation, starters_json, bench_json, instructions_json, warnings_json, updated_at from lineups where club_id = $1 and fixture_id is null`, [clubId]);
    const pr = await c.query(`select id, name, payload, updated_at from tactic_presets where club_id = $1 and archived_at is null order by name`, [clubId]);
    return { tactics: t.rows[0] ?? null, lineup: l.rows[0] ?? null, presets: pr.rows as { id: string; name: string; payload: Record<string, unknown>; updated_at: string }[] };
  });
}

/** Last N match ratings per player of a club (most recent first), for form sparklines. */
export async function getRecentRatings(userId: string, clubId: string, n = 5) {
  return withUser(userId, async (c) => {
    const r = await c.query<{ player_id: string; ratings: (number | null)[] }>(
      `select game_player_id as player_id, array_agg(rating order by kickoff desc) as ratings from (
         select s.game_player_id, s.rating::float as rating, f.kickoff_at as kickoff,
                row_number() over (partition by s.game_player_id order by f.kickoff_at desc) rn
           from match_player_stats s join fixtures f on f.id = s.fixture_id
          where s.club_id = $1 and s.minutes > 0) x
        where rn <= $2 group by game_player_id`, [clubId, n]);
    return Object.fromEntries(r.rows.map((x) => [x.player_id, x.ratings])) as Record<string, (number | null)[]>;
  });
}

export async function getClubColors(userId: string, clubId: string) {
  return withUser(userId, async (c) => (await c.query<{ name_snapshot: string; short_name: string; primary_color: string; secondary_color: string }>(
    `select name_snapshot, short_name, primary_color, secondary_color from game_clubs where id = $1`, [clubId])).rows[0] ?? null);
}

export async function getStandings(userId: string, gameId: string, seasonNumber?: number) {
  return withUser(userId, async (c) => (await c.query(
    `select s.club_id, gc.name_snapshot, gc.short_name, gc.primary_color, gc.secondary_color, gc.manager_user_id, pr.display_name as manager_name,
            s.played, s.won, s.drawn, s.lost, s.gf, s.ga, s.gd, s.points, s.form
       from standings s join seasons se on se.id = s.season_id join game_clubs gc on gc.id = s.club_id
       left join profiles pr on pr.id = gc.manager_user_id
      where se.game_id = $1 and se.number = coalesce($2, (select current_season from games where id = $1))
      order by s.points desc, s.gd desc, s.gf desc, s.won desc, s.club_id`, [gameId, seasonNumber ?? null])).rows);
}

export async function getFixtures(userId: string, gameId: string, seasonNumber?: number) {
  return withUser(userId, async (c) => (await c.query(
    `select f.id, f.round_number, f.status, f.result_home, f.result_away, f.kickoff_at, f.home_club_id, f.away_club_id,
            h.name_snapshot as home_name, h.short_name as home_short, h.primary_color as home_color, h.secondary_color as home_color2,
            a.name_snapshot as away_name, a.short_name as away_short, a.primary_color as away_color, a.secondary_color as away_color2
       from fixtures f join seasons se on se.id = f.season_id
       join game_clubs h on h.id = f.home_club_id join game_clubs a on a.id = f.away_club_id
      where f.game_id = $1 and se.number = coalesce($2, (select current_season from games where id = $1))
      order by f.round_number, h.name_snapshot`, [gameId, seasonNumber ?? null])).rows);
}

export async function getMatch(userId: string, gameId: string, fixtureId: string) {
  return withUser(userId, async (c) => {
    const f = await c.query(
      `select f.*, h.name_snapshot as home_name, h.short_name as home_short, h.primary_color as home_color, h.secondary_color as home_color2,
              a.name_snapshot as away_name, a.short_name as away_short, a.primary_color as away_color, a.secondary_color as away_color2,
              mr.result_json, mr.seed, mr.simulation_version, mr.input_hash
         from fixtures f join game_clubs h on h.id = f.home_club_id join game_clubs a on a.id = f.away_club_id
         left join match_runs mr on mr.fixture_id = f.id
        where f.id = $1 and f.game_id = $2`, [fixtureId, gameId]);
    if (!f.rowCount) return null;
    const events = await c.query(
      `select e.sequence_number, e.minute, e.second, e.club_id, e.event_type, e.payload_json,
              p.name_snapshot as player_name, rp.name_snapshot as related_name, e.player_id, e.related_player_id
         from match_events e left join game_players p on p.id = e.player_id left join game_players rp on rp.id = e.related_player_id
        where e.fixture_id = $1 order by e.sequence_number`, [fixtureId]);
    const stats = await c.query(
      `select s.*, p.name_snapshot, p.position_group from match_player_stats s join game_players p on p.id = s.game_player_id
        where s.fixture_id = $1 order by s.started desc, s.rating desc nulls last`, [fixtureId]);
    const lineups = await c.query(`select club_id, formation, starters_json, bench_json, auto_generated, warnings_json from lineups where fixture_id = $1`, [fixtureId]);
    return { fixture: f.rows[0], events: events.rows, stats: stats.rows, lineups: lineups.rows };
  });
}

export async function getPlayer(userId: string, gameId: string, playerId: string) {
  return withUser(userId, async (c) => {
    const p = await c.query<PlayerRow & { club_name: string | null; club_short: string | null; club_color: string | null; club_color2: string | null; manager_user_id: string | null; listed_price: string | null }>(
      `select ${PLAYER_COLS}, gc.name_snapshot as club_name, gc.short_name as club_short, gc.primary_color as club_color, gc.secondary_color as club_color2, gc.manager_user_id,
              (select asking_price_cents from transfer_listings tl where tl.player_id = p.id and tl.status = 'active') as listed_price
         from game_players p left join game_clubs gc on gc.id = p.club_id where p.id = $1 and p.game_id = $2`, [playerId, gameId]);
    if (!p.rowCount) return null;
    const log = await c.query(
      `select season_number, round_number, old_ovr, new_ovr, change_reason_json, algorithm_version, created_at
         from player_progression_log where game_player_id = $1 order by id`, [playerId]);
    const matches = await c.query(
      `select s.fixture_id, s.minutes, s.rating, s.goals, s.assists, s.cards_yellow, s.cards_red, f.round_number,
              f.result_home, f.result_away, f.home_club_id, h.short_name as home_short, a.short_name as away_short
         from match_player_stats s join fixtures f on f.id = s.fixture_id
         join game_clubs h on h.id = f.home_club_id join game_clubs a on a.id = f.away_club_id
        where s.game_player_id = $1 order by f.completed_at desc nulls last limit 10`, [playerId]);
    const ask = await c.query<{ ask: string | null }>(`select public.ai_asking_price($1) as ask`, [playerId]);
    const transfers = await c.query(
      `select t.price_cents, t.completed_at, coalesce(fc.name_snapshot, t.external_from_name) as from_name, tc.name_snapshot as to_name
         from transfer_transactions t left join game_clubs fc on fc.id = t.from_club_id left join game_clubs tc on tc.id = t.to_club_id
        where t.player_id = $1 order by t.completed_at desc`, [playerId]);
    return { player: p.rows[0], log: log.rows, matches: matches.rows, askingPrice: ask.rows[0]?.ask ?? null, transfers: transfers.rows };
  });
}

export interface MarketFilters {
  position?: string; minOvr?: number; maxOvr?: number; maxPrice?: number; q?: string; listedOnly?: boolean; page?: number;
  /** "" = every league in the dataset, "game" = only this game's league, otherwise a source_leagues id */
  league?: string;
}
export interface MarketRow {
  kind: "game" | "ext"; id: string; name_snapshot: string; position_group: PlayerRow["position_group"]; current_ovr: number;
  potential_band: string; age: number | null; form: string; market_value_cents: string; listed_price: string | null;
  club_name: string | null; manager_user_id: string | null; league_name: string | null;
}

/**
 * Market search across the whole dataset: players already in this game (own league, RLS-equivalent filters) plus every
 * other snapshot player not yet signed in this game ("external", bought from an AI club outside the league).
 * Runs with the service connection because dataset_snapshot_players has no client grants — membership is checked
 * inside the query and only public columns are returned (never potential_cap / development rate).
 */
export async function searchMarket(userId: string, gameId: string, f: MarketFilters) {
  const pageSize = 40;
  const league = f.league ?? "";
  return withService(async (c) => {
    const rows = await c.query<MarketRow>(
      `with g as (
         select g.id, g.dataset_snapshot_id snap, g.source_league_id lg from games g
          where g.id = $1 and exists (select 1 from game_members m where m.game_id = g.id and m.user_id = $8)
       ), own as (
         select 'game'::text kind, p.id, p.name_snapshot, p.position_group, p.current_ovr, p.potential_band, p.age, p.form::text form,
                p.market_value_cents::text market_value_cents, tl.asking_price_cents::text listed_price, gc.name_snapshot club_name,
                gc.manager_user_id, sl.name league_name, coalesce(tl.asking_price_cents, p.market_value_cents) price
           from g join game_players p on p.game_id = g.id
           left join game_clubs gc on gc.id = p.club_id
           left join transfer_listings tl on tl.player_id = p.id and tl.status = 'active'
           left join source_leagues sl on sl.id = g.lg
          where (gc.manager_user_id is distinct from $8)
            and ($11::text = '' or $11 = 'game' or $11 = g.lg::text)
       ), ext as (
         select 'ext'::text kind, sp.source_player_id id, sp.display_name name_snapshot, sp.position_group, sp.initial_ovr current_ovr,
                case when sp.initial_potential >= 88 then 'A' when sp.initial_potential >= 82 then 'B' when sp.initial_potential >= 75 then 'C'
                     when sp.initial_potential >= 68 then 'D' else 'E' end potential_band,
                sp.age_at_import age, '0' form, (sp.base_value_eur * 100)::text market_value_cents, null::text listed_price,
                dc.name club_name, null::uuid manager_user_id, sl.name league_name, sp.base_value_eur * 100 price
           from g join dataset_snapshot_players sp on sp.snapshot_id = g.snap
           join dataset_snapshot_clubs dc on dc.snapshot_id = g.snap and dc.source_club_id = sp.source_club_id
           left join source_leagues sl on sl.id = dc.league_id
          where not $7 and $11 <> 'game' and ($11 = '' or $11 = dc.league_id::text)
            and not exists (select 1 from game_clubs x where x.game_id = g.id and x.source_club_id = sp.source_club_id)
            and not exists (select 1 from game_players x where x.game_id = g.id and x.source_player_id = sp.source_player_id)
       ), allp as (select * from own union all select * from ext)
       select kind, id, name_snapshot, position_group, current_ovr, potential_band, age, form, market_value_cents, listed_price,
              club_name, manager_user_id, league_name
         from allp
        where ($2::text is null or position_group = $2)
          and current_ovr between $3 and $4
          and ($5::bigint is null or price <= $5)
          and ($6::text is null or name_snapshot ilike '%' || $6 || '%')
          and (not $7 or listed_price is not null)
        order by current_ovr desc, id limit $9 offset $10`,
      [gameId, f.position ?? null, f.minOvr ?? 1, f.maxOvr ?? 99, f.maxPrice ? f.maxPrice * 100 : null, f.q || null, !!f.listedOnly,
        userId, pageSize + 1, ((f.page ?? 1) - 1) * pageSize, league]);
    return { rows: rows.rows.slice(0, pageSize), hasMore: rows.rows.length > pageSize, page: f.page ?? 1 };
  });
}

/** Leagues available in this game's dataset (for the market filter). */
export async function getMarketLeagues(userId: string, gameId: string) {
  return withService(async (c) => (await c.query<{ id: string; name: string; country: string | null; own: boolean }>(
    `select distinct l.id, l.name, l.country, l.id = g.source_league_id own
       from games g join dataset_snapshot_clubs dc on dc.snapshot_id = g.dataset_snapshot_id join source_leagues l on l.id = dc.league_id
      where g.id = $1 and exists (select 1 from game_members m where m.game_id = g.id and m.user_id = $2)
      order by own desc, l.name`, [gameId, userId])).rows);
}

/** A not-yet-signed player from outside the game's league, with the external club's asking price. */
export async function getExternalPlayer(userId: string, gameId: string, sourcePlayerId: string) {
  return withService(async (c) => (await c.query<{
    id: string; name: string; position_group: PlayerRow["position_group"]; position_detail: string | null; ovr: number; potential_band: string;
    age: number | null; value_cents: string; ask_cents: string; club_id: string; club_name: string; club_short: string | null; league_name: string | null;
    signed_player_id: string | null; in_league: boolean;
  }>(
    `select sp.source_player_id id, sp.display_name name, sp.position_group, sp.position_detail, sp.initial_ovr ovr,
            case when sp.initial_potential >= 88 then 'A' when sp.initial_potential >= 82 then 'B' when sp.initial_potential >= 75 then 'C'
                 when sp.initial_potential >= 68 then 'D' else 'E' end potential_band,
            sp.age_at_import age, (sp.base_value_eur * 100)::text value_cents,
            public.external_asking_price(g.dataset_snapshot_id, sp.source_player_id)::text ask_cents,
            sp.source_club_id club_id, dc.name club_name, dc.short_name club_short, l.name league_name,
            (select x.id from game_players x where x.game_id = g.id and x.source_player_id = sp.source_player_id) signed_player_id,
            exists (select 1 from game_clubs x where x.game_id = g.id and x.source_club_id = sp.source_club_id) in_league
       from games g join dataset_snapshot_players sp on sp.snapshot_id = g.dataset_snapshot_id
       left join dataset_snapshot_clubs dc on dc.snapshot_id = g.dataset_snapshot_id and dc.source_club_id = sp.source_club_id
       left join source_leagues l on l.id = dc.league_id
      where g.id = $1 and sp.source_player_id = $3
        and exists (select 1 from game_members m where m.game_id = g.id and m.user_id = $2)`,
    [gameId, userId, sourcePlayerId])).rows[0] ?? null);
}

export async function getOffers(userId: string, gameId: string) {
  return withUser(userId, async (c) => (await c.query(
    `select o.id, o.status, o.amount_cents, o.counter_amount_cents, o.response_reason, o.created_at, o.expires_at, o.responded_at,
            o.buyer_club_id, o.seller_club_id, p.id as player_id, p.name_snapshot as player_name, p.current_ovr, p.position_group,
            b.name_snapshot as buyer_name, s.name_snapshot as seller_name, b.manager_user_id = $2 as i_am_buyer,
            s.manager_user_id is not null as seller_human, o.message, o.counter_message, o.parent_offer_id,
            sw.name_snapshot as swap_name, sw.id as swap_player_id,
            exists (select 1 from transfer_offers c where c.parent_offer_id = o.id) as has_reply
       from transfer_offers o join game_players p on p.id = o.player_id
       left join game_players sw on sw.id = o.swap_player_id
       join game_clubs b on b.id = o.buyer_club_id join game_clubs s on s.id = o.seller_club_id
      where o.game_id = $1 order by (o.status = 'pending') desc, o.created_at desc limit 50`, [gameId, userId])).rows);
}

export async function getMySquadLight(userId: string, clubId: string) {
  return withUser(userId, async (c) => (await c.query<{ id: string; name: string; ovr: number; position_group: string }>(
    `select id, name_snapshot name, current_ovr ovr, position_group from game_players where club_id = $1 order by current_ovr desc`, [clubId])).rows);
}

export async function getRecentTransfers(userId: string, gameId: string) {
  return withUser(userId, async (c) => (await c.query(
    `select t.price_cents, t.completed_at, p.id as player_id, p.name_snapshot as player_name, coalesce(fc.name_snapshot, t.external_from_name) as from_name, tc.name_snapshot as to_name
       from transfer_transactions t join game_players p on p.id = t.player_id
       left join game_clubs fc on fc.id = t.from_club_id left join game_clubs tc on tc.id = t.to_club_id
      where t.game_id = $1 order by t.completed_at desc limit 20`, [gameId])).rows);
}

export async function getFinances(userId: string, clubId: string) {
  return withUser(userId, async (c) => {
    const club = await c.query(
      `select gc.cash_cents, gc.reserved_cents, gc.reputation,
              (select coalesce(sum(wage_cents),0) from game_players where club_id = gc.id) as wage_bill
         from game_clubs gc where gc.id = $1`, [clubId]);
    const ledger = await c.query(
      `select id, event_type, amount_cents, balance_after_cents, season_number, round_number, created_at
         from club_ledger where club_id = $1 order by id desc limit 100`, [clubId]);
    const byType = await c.query(
      `select event_type, sum(amount_cents)::bigint as total from club_ledger where club_id = $1 group by event_type order by 2 desc`, [clubId]);
    return { club: club.rows[0] ?? null, ledger: ledger.rows, byType: byType.rows };
  });
}

export async function getNotifications(userId: string, gameId: string) {
  return withUser(userId, async (c) => (await c.query(
    `select id, type, payload_json, read_at, created_at from notifications where game_id = $1 order by created_at desc limit 20`, [gameId])).rows);
}

export async function getNextFixture(userId: string, gameId: string, clubId: string) {
  return withUser(userId, async (c) => (await c.query(
    `select f.id, f.round_number, f.kickoff_at, f.home_club_id, f.away_club_id, h.name_snapshot as home_name, a.name_snapshot as away_name,
            h.short_name as home_short, a.short_name as away_short, h.primary_color as home_color, a.primary_color as away_color,
            h.secondary_color as home_color2, a.secondary_color as away_color2
       from fixtures f join games g on g.id = f.game_id join seasons se on se.id = f.season_id and se.number = g.current_season
       join game_clubs h on h.id = f.home_club_id join game_clubs a on a.id = f.away_club_id
      where f.game_id = $1 and f.status <> 'completed' and $2 in (f.home_club_id, f.away_club_id)
      order by f.round_number limit 1`, [gameId, clubId])).rows[0] ?? null);
}

export async function getLastResult(userId: string, gameId: string, clubId: string | null) {
  return withUser(userId, async (c) => (await c.query(
    `select f.id, f.round_number, f.result_home, f.result_away, f.home_club_id, f.away_club_id, h.name_snapshot as home_name, a.name_snapshot as away_name,
            h.short_name as home_short, a.short_name as away_short, h.primary_color as home_color, a.primary_color as away_color,
            h.secondary_color as home_color2, a.secondary_color as away_color2
       from fixtures f join game_clubs h on h.id = f.home_club_id join game_clubs a on a.id = f.away_club_id
      where f.game_id = $1 and f.status = 'completed' and ($2::uuid is null or $2 in (f.home_club_id, f.away_club_id))
      order by f.completed_at desc limit 1`, [gameId, clubId])).rows[0] ?? null);
}

export async function listSnapshotsForCreation(userId: string) {
  return withUser(userId, async (c) => (await c.query(
    `select ds.id, ds.label, ds.is_synthetic, ds.created_at, l.id as league_id, l.name as league_name, l.country,
            (select count(*) from dataset_snapshot_clubs dc where dc.snapshot_id = ds.id and dc.league_id = l.id)::int as clubs
       from dataset_snapshots ds cross join lateral unnest(ds.league_ids) as lid
       join source_leagues l on l.id = lid
      where ds.status = 'finalized' order by ds.created_at desc, l.name`)).rows);
}

export async function getProfile(userId: string) {
  return withUser(userId, async (c) => (await c.query(`select id, display_name, is_admin from profiles where id = $1`, [userId])).rows[0] ?? null);
}
