import "server-only";
import { absRound, effectiveBudgets, stadiumFrom, type Objective, type Slot, type StaffRole, type TicketPrice, type Upgrade } from "@/engine/economy/business";
import { withUser } from "./db";

/** Reads for the "Clube" page (direção, patrocínios, estádio, staff) — as the user (RLS). */
export async function getClubOffice(userId: string, gameId: string) {
  return withUser(userId, async (c) => {
    const g = (await c.query<{ current_season: number; current_matchday: number; status: string; my_club_id: string | null; total_rounds: number | null }>(
      `select g.current_season, g.current_matchday, g.status,
              (select id from game_clubs where game_id = g.id and manager_user_id = $2) my_club_id,
              (select total_rounds from seasons where game_id = g.id and number = g.current_season) total_rounds
         from games g where g.id = $1`, [gameId, userId])).rows[0];
    if (!g?.my_club_id) return null;
    const club = g.my_club_id, S = g.current_season, rounds = g.total_rounds ?? 34;
    const info = (await c.query<{ name_snapshot: string; reputation: number; cash_cents: string; reserved_cents: string }>(
      `select name_snapshot, reputation, cash_cents, reserved_cents from game_clubs where id = $1`, [club])).rows[0];
    const biz = (await c.query<{ fan_mood: number; ticket_price: TicketPrice; base_capacity: number; upgrades: Upgrade[] }>(
      `select fan_mood, ticket_price, base_capacity, upgrades from club_business where club_id = $1`, [club])).rows[0] ?? null;
    const board = (await c.query<{ objective: Objective; confidence: number; base_transfer_cents: string; base_wage_cents: string; shift_pct: number; flags: Record<string, boolean>; history: { round: number; delta: number; reason: string }[] }>(
      `select objective, confidence, base_transfer_cents, base_wage_cents, shift_pct, flags, history from board_state where club_id = $1 and season = $2`, [club, S])).rows[0] ?? null;
    const wagePlayers = Number((await c.query(`select coalesce(sum(wage_cents),0) w from game_players where club_id = $1`, [club])).rows[0].w);
    const staff = (await c.query<{ id: string; role: StaffRole; name: string; level: number; wage_cents: string; hired_season: number }>(
      `select id, role, name, level, wage_cents, hired_season from club_staff where club_id = $1 and active order by role`, [club])).rows;
    const candidates = (await c.query<{ id: string; role: StaffRole; name: string; level: number; wage_cents: string }>(
      `select id, role, name, level, wage_cents from staff_candidates where club_id = $1 and season = $2 and not taken order by role, level desc`, [club, S])).rows;
    const deals = (await c.query<{ id: string; slot: Slot; brand: string; kind: string; base_cents: string; win_bonus_cents: string; clause: { top: number; bonus_cents: number } | null; start_season: number; end_season: number; signed_by: string }>(
      `select id, slot, brand, kind, base_cents, win_bonus_cents, clause, start_season, end_season, signed_by from sponsor_deals
        where club_id = $1 and start_season <= $2 and end_season >= $2`, [club, S])).rows;
    const offers = (await c.query<{ id: string; slot: Slot; brand: string; kind: string; base_cents: string; win_bonus_cents: string; clause: { top: number; bonus_cents: number } | null; seasons: number; deadline_round: number }>(
      `select id, slot, brand, kind, base_cents, win_bonus_cents, clause, seasons, deadline_round from sponsor_offers
        where club_id = $1 and season = $2 and status = 'open' order by slot, base_cents desc`, [club, S])).rows;
    const spent = -Number((await c.query(
      `select coalesce(sum(amount_cents),0) s from club_ledger where club_id = $1 and season_number = $2 and event_type = 'transfer_purchase'`, [club, S])).rows[0].s);
    const attendance = (await c.query<{ round_number: number; attendance: number; away: string }>(
      `select f.round_number, (r.result_json->>'attendance')::int attendance, a.name_snapshot away
         from fixtures f join match_runs r on r.fixture_id = f.id join game_clubs a on a.id = f.away_club_id
        where f.home_club_id = $1 and r.result_json ? 'attendance' order by f.completed_at desc nulls last limit 6`, [club])).rows;
    const staffWages = staff.reduce((s, x) => s + Number(x.wage_cents), 0);
    const stadium = biz ? stadiumFrom(biz.base_capacity, biz.upgrades ?? [], absRound(S, g.current_matchday)) : null;
    const budgets = board ? effectiveBudgets({ transfer: Number(board.base_transfer_cents), wage: Number(board.base_wage_cents) }, board.shift_pct, rounds) : null;
    return {
      ...g, club, info, biz, stadium, board, budgets, spent, wageBill: wagePlayers + staffWages, wagePlayers, staffWages,
      staff, candidates, deals, offers, attendance, rounds, now: absRound(S, g.current_matchday),
    };
  });
}

/** Per-type income/expense per block of 4 rounds for the current season (finances P&L). */
export async function getSeasonPnl(userId: string, clubId: string, season: number) {
  return withUser(userId, async (c) => (await c.query<{ block: number; event_type: string; total: string }>(
    `select ((coalesce(round_number, 0) - 1) / 4)::int block, event_type, sum(amount_cents)::bigint total
       from club_ledger where club_id = $1 and season_number = $2 and event_type <> 'initial_balance'
      group by 1, 2 order by 1, 2`, [clubId, season])).rows);
}

export async function getBoardMini(userId: string, gameId: string, clubId: string) {
  return withUser(userId, async (c) => (await c.query<{ confidence: number; objective: Objective; fan_mood: number | null }>(
    `select bs.confidence, bs.objective, cb.fan_mood from board_state bs join games g on g.id = bs.game_id and g.current_season = bs.season
       left join club_business cb on cb.club_id = bs.club_id where bs.club_id = $1 and g.id = $2`, [clubId, gameId])).rows[0] ?? null);
}
