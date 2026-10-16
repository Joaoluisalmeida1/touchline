import "server-only";
import { withUser } from "./db";

export interface CupTieRow {
  id: string; round: number; slot: number; status: "scheduled" | "bye" | "played"; after_league_round: number;
  home_club_id: string | null; away_club_id: string | null; winner_club_id: string | null;
  home_goals: number | null; away_goals: number | null; pens_home: number | null; pens_away: number | null;
  result_json: { events?: { minute: number; type: string; side: "home" | "away"; player: string | null }[]; kicks?: { side: string; player: string; scored: boolean }[] } | null;
}

export async function getCup(userId: string, gameId: string, season: number) {
  return withUser(userId, async (c) => {
    const ties = (await c.query<CupTieRow>(
      `select id, round, slot, status, after_league_round, home_club_id, away_club_id, winner_club_id, home_goals, away_goals, pens_home, pens_away, result_json
         from cup_ties where game_id = $1 and season = $2 order by round, slot`, [gameId, season])).rows;
    const meta = (await c.query<{ payload: { rounds: number; schedule: number[] } }>(
      `select payload from game_events where game_id = $1 and season = $2 and kind = 'cup_season'`, [gameId, season])).rows[0]?.payload ?? null;
    const winners = (await c.query<{ season: number; club_id: string }>(
      `select season, club_id from game_events where game_id = $1 and kind = 'cup_winner' order by season desc`, [gameId])).rows;
    return { ties, meta, winners };
  });
}

export async function getAcademy(userId: string, clubId: string) {
  return withUser(userId, async (c) => (await c.query<{ id: string; season: number; name: string; position_group: string; age: number; ovr: number; potential_band: string; wage_cents: string; status: string }>(
    `select id, season, name, position_group, age, ovr, potential_band, wage_cents, status from academy_prospects
      where club_id = $1 and (status = 'academy' or decided_at > now() - interval '14 days') order by status, ovr desc`, [clubId])).rows);
}

export async function getContractTalks(userId: string, clubId: string, season: number) {
  return withUser(userId, async (c) => (await c.query<{ id: string; player_id: string; name: string; position_group: string; current_ovr: number; wage_cents: string; refuses: boolean; options: { seasons: number; wage_cents: number }[]; status: string; chosen: { seasons: number; wage_cents: number } | null }>(
    `select t.id, t.player_id, p.name_snapshot name, p.position_group, p.current_ovr, p.wage_cents, t.refuses, t.options, t.status, t.chosen
       from contract_talks t join game_players p on p.id = t.player_id where t.club_id = $1 and t.season = $2 order by t.status, p.current_ovr desc`, [clubId, season])).rows);
}

export async function getFreeAgents(userId: string, gameId: string, season: number) {
  return withUser(userId, async (c) => (await c.query<{ id: string; name_snapshot: string; position_group: string; current_ovr: number; age: number | null; free_agent_wage_cents: string }>(
    `select id, name_snapshot, position_group, current_ovr, age, free_agent_wage_cents from game_players
      where game_id = $1 and club_id is null and free_agent_since = $2 order by current_ovr desc limit 40`, [gameId, season])).rows);
}
