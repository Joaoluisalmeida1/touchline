import "server-only";
import { withUser } from "./db";

/** Reads for the Roleta and the betting pages (as the user, RLS). */
export async function getSlotsView(userId: string, gameId: string, clubId: string | null) {
  return withUser(userId, async (c) => {
    const pot = (await c.query<{ pot_cents: string | null; last_won_cents: string | null; last_winner: string | null; last_won_at: string | null }>(
      `select sp.pot_cents, sp.last_won_cents, gc.name_snapshot last_winner, sp.last_won_at
         from games g left join slots_pots sp on sp.game_id = g.id left join game_clubs gc on gc.id = sp.last_winner_club_id where g.id = $1`, [gameId])).rows[0];
    const feed = (await c.query<{ id: string; club: string; label: string; rarity: string; reels: string[]; payload: { detail?: string }; created_at: string }>(
      `select s.id, gc.name_snapshot club, s.label, s.rarity, s.reels, s.payload, s.created_at
         from slot_spins s join game_clubs gc on gc.id = s.club_id where s.game_id = $1 order by s.created_at desc limit 14`, [gameId])).rows;
    const duels = (await c.query<{
      id: string; status: string; challenger_club_id: string; opponent_club_id: string; challenger: string; opponent: string; stake_cents: string;
      challenger_reels: string[] | null; opponent_reels: string[] | null; challenger_score: number | null; opponent_score: number | null; winner_club_id: string | null; created_at: string;
    }>(
      `select d.id, d.status, d.challenger_club_id, d.opponent_club_id, a.name_snapshot challenger, b.name_snapshot opponent, d.stake_cents,
              d.challenger_reels, d.opponent_reels, d.challenger_score, d.opponent_score, d.winner_club_id, d.created_at
         from slot_duels d join game_clubs a on a.id = d.challenger_club_id join game_clubs b on b.id = d.opponent_club_id
        where d.game_id = $1 order by (d.status = 'open') desc, d.created_at desc limit 12`, [gameId])).rows;
    const rivals = (await c.query<{ id: string; name: string; manager: string | null }>(
      `select gc.id, gc.name_snapshot name, pr.display_name manager from game_clubs gc join profiles pr on pr.id = gc.manager_user_id
        where gc.game_id = $1 and gc.manager_user_id <> $2 order by gc.name_snapshot`, [gameId, userId])).rows;
    if (!clubId) return { pot, feed, duels, rivals, me: null };
    const me = (await c.query<{
      spins_today: number; free_spins: number; available: string; crest_skin: string | null; name: string; short_name: string | null; primary_color: string; secondary_color: string; timezone: string;
    }>(
      `select (select count(*) from slot_spins s where s.club_id = gc.id and not s.free and s.spun_on = (now() at time zone g.timezone)::date)::int spins_today,
              (select count(*) from slot_cards k where k.club_id = gc.id and k.kind = 'free_spin' and k.status = 'held')::int free_spins,
              gc.cash_cents - gc.reserved_cents available, gc.crest_skin, gc.name_snapshot name, gc.short_name, gc.primary_color, gc.secondary_color, g.timezone
         from game_clubs gc join games g on g.id = gc.game_id where gc.id = $1`, [clubId])).rows[0];
    const cards = (await c.query<{ id: string; kind: string; status: string; active_round: number | null }>(
      `select id, kind, status, active_round from slot_cards where club_id = $1 and status in ('held','active') and kind <> 'free_spin' order by created_at`, [clubId])).rows;
    const skins = (await c.query<{ skin: string }>(`select skin from club_skins where club_id = $1 order by obtained_at`, [clubId])).rows.map((r) => r.skin);
    return { pot, feed, duels, rivals, me: { ...me, cards, skins } };
  });
}

export async function getBetsView(userId: string, gameId: string) {
  return withUser(userId, async (c) => {
    const g = (await c.query<{ season: number; round: number; settings: Record<string, unknown>; status: string }>(
      `select current_season season, current_matchday round, settings_json settings, status from games where id = $1`, [gameId])).rows[0];
    const fixtures = (await c.query<{
      id: string; home_id: string; away_id: string; home: string; away: string; home_short: string | null; away_short: string | null;
      home_color: string; away_color: string; home_color2: string | null; away_color2: string | null; home_skin: string | null; away_skin: string | null;
      hs: string; as: string; kickoff_at: string | null; home_mgr: string | null; away_mgr: string | null;
    }>(
      `select f.id, h.id home_id, a.id away_id, h.name_snapshot home, a.name_snapshot away, h.short_name home_short, a.short_name away_short,
              h.primary_color home_color, a.primary_color away_color, h.secondary_color home_color2, a.secondary_color away_color2,
              h.crest_skin home_skin, a.crest_skin away_skin, h.strength hs, a.strength "as", f.kickoff_at,
              hp.display_name home_mgr, ap.display_name away_mgr
         from fixtures f join seasons s on s.id = f.season_id
         join game_clubs h on h.id = f.home_club_id join game_clubs a on a.id = f.away_club_id
         left join profiles hp on hp.id = h.manager_user_id left join profiles ap on ap.id = a.manager_user_id
        where s.game_id = $1 and s.number = $2 and f.round_number = $3 and f.status <> 'completed'
        order by f.kickoff_at nulls last, f.id`, [gameId, g.season, g.round + 1])).rows;
    const mine = (await c.query<{ id: string; pick: string; stake_cents: string; odds: string; status: string; payout_cents: string | null; home: string; away: string; hg: number | null; ag: number | null; round: number }>(
      `select b.id, b.pick, b.stake_cents, b.odds, b.status, b.payout_cents, h.name_snapshot home, a.name_snapshot away, f.result_home hg, f.result_away ag, f.round_number round
         from bets b join fixtures f on f.id = b.fixture_id join game_clubs h on h.id = f.home_club_id join game_clubs a on a.id = f.away_club_id
        where b.game_id = $1 and b.user_id = $2 order by b.created_at desc limit 30`, [gameId, userId])).rows;
    const board = (await c.query<{ manager: string; club: string; bets: number; staked: string; returned: string; open_stake: string }>(
      `select pr.display_name manager, gc.name_snapshot club, count(*)::int bets, sum(b.stake_cents) filter (where b.status <> 'open') staked,
              coalesce(sum(b.payout_cents) filter (where b.status <> 'open'), 0) returned, coalesce(sum(b.stake_cents) filter (where b.status = 'open'), 0) open_stake
         from bets b join profiles pr on pr.id = b.user_id join game_clubs gc on gc.id = b.club_id
        where b.game_id = $1 group by pr.display_name, gc.name_snapshot order by coalesce(sum(b.payout_cents) filter (where b.status <> 'open'), 0) - coalesce(sum(b.stake_cents) filter (where b.status <> 'open'), 0) desc`, [gameId])).rows;
    const pool = (await c.query<{ fixture_id: string; pick: string; n: number; stake: string }>(
      `select b.fixture_id, b.pick, count(*)::int n, sum(b.stake_cents) stake from bets b join fixtures f on f.id = b.fixture_id
        where b.game_id = $1 and b.status = 'open' group by b.fixture_id, b.pick`, [gameId])).rows;
    return { game: g, fixtures, mine, board, pool };
  });
}
