import "server-only";
import { withUser } from "./db";

/** Reads for the "Semana" page (Gabinete, imprensa, treino, adversário, plano de jogo). All as the user (RLS). */

export interface InboxRow {
  id: string; round: number; key: string; title: string; body: string;
  choices: { label: string; detail: string; effects: unknown[] }[]; default_choice: number; deadline_round: number;
  chosen: number | null; resolution: "answered" | "default" | null; resolved_at: string | null;
}
export interface PressRow {
  id: string; season: number; round: number; opponent_club_id: string | null; questions: { key: string; text: string }[];
  answers: { key: string; tone: string; text: string }[] | null;
  effects: { morale: number; own_control: number; opp_control: number; calm: boolean } | null; answered_at: string | null;
}
export interface OppPlayer {
  id: string; name: string; position_group: "GK" | "DEF" | "MID" | "ATT"; position_detail: string | null; current_ovr: number;
  form: number; goals: number; assists: number; apps: number; unavailable: boolean; injury_type: string | null;
}

export async function getWeek(userId: string, gameId: string) {
  return withUser(userId, async (c) => {
    const g = (await c.query<{ current_season: number; current_matchday: number; status: string; total_rounds: number | null; season_id: string | null; my_club_id: string | null; next_deadline_at: string | null }>(
      `select g.current_season, g.current_matchday, g.status, g.next_deadline_at,
              (select id from game_clubs where game_id = g.id and manager_user_id = $2) my_club_id,
              (select id from seasons where game_id = g.id and number = g.current_season) season_id,
              (select total_rounds from seasons where game_id = g.id and number = g.current_season) total_rounds
         from games g where g.id = $1`, [gameId, userId])).rows[0];
    if (!g?.my_club_id) return null;
    const club = g.my_club_id;
    const round = g.current_matchday + 1;
    const inbox = (await c.query<InboxRow>(
      `select id, round, key, title, body, choices, default_choice, deadline_round, chosen, resolution, resolved_at
         from inbox_events where club_id = $1 and (resolved_at is null or resolved_at > now() - interval '7 days')
        order by resolved_at nulls first, created_at desc limit 12`, [club])).rows;
    const press = (await c.query<PressRow>(
      `select id, season, round, opponent_club_id, questions, answers, effects, answered_at from press_conferences
        where club_id = $1 and season = $2 and round = $3`, [club, g.current_season, round])).rows[0] ?? null;
    const training = (await c.query<{ intensity: "light" | "normal" | "intense"; focus: string }>(
      `select intensity, focus from training_plans where club_id = $1`, [club])).rows[0] ?? null;
    const plan = (await c.query<{ rules: { minute: number; when: string; mentality?: string; sub?: { out: string; in: string } }[]; marking: string[] }>(
      `select rules, marking from match_plans where club_id = $1`, [club])).rows[0] ?? null;
    const fixture = g.season_id ? (await c.query<{ id: string; home_club_id: string; away_club_id: string; kickoff_at: string | null }>(
      `select id, home_club_id, away_club_id, kickoff_at from fixtures
        where season_id = $1 and round_number = $2 and $3 in (home_club_id, away_club_id)`, [g.season_id, round, club])).rows[0] ?? null : null;
    const mySquad = (await c.query<{ id: string; name_snapshot: string; position_group: string; current_ovr: number }>(
      `select id, name_snapshot, position_group, current_ovr from game_players where club_id = $1
        order by case position_group when 'GK' then 0 when 'DEF' then 1 when 'MID' then 2 else 3 end, current_ovr desc`, [club])).rows;
    return { ...g, club, round, inbox, press, training, plan, fixture, mySquad };
  });
}

/** Scouting report on a club: form, goals, xG, last formation, key players and absentees. */
export async function getOpponentReport(userId: string, gameId: string, seasonId: string, oppId: string, myClubId: string) {
  return withUser(userId, async (c) => {
    const club = (await c.query<{ id: string; name_snapshot: string; short_name: string; primary_color: string; secondary_color: string; strength: string; manager_name: string | null }>(
      `select gc.id, gc.name_snapshot, gc.short_name, gc.primary_color, gc.secondary_color, gc.strength, pr.display_name manager_name
         from game_clubs gc left join profiles pr on pr.id = gc.manager_user_id where gc.id = $1 and gc.game_id = $2`, [oppId, gameId])).rows[0];
    if (!club) return null;
    const played = (await c.query<{ id: string; round_number: number; home_club_id: string; away_club_id: string; result_home: number; result_away: number; stats_json: { home?: { xg?: number }; away?: { xg?: number } } | null }>(
      `select id, round_number, home_club_id, away_club_id, result_home, result_away, stats_json from fixtures
        where season_id = $1 and status = 'completed' and $2 in (home_club_id, away_club_id) order by round_number desc`, [seasonId, oppId])).rows;
    const st = (await c.query<{ points: number; gf: number; ga: number; position: number }>(
      `select points, gf, ga, position from (select club_id, points, gf, ga,
              row_number() over (order by points desc, gd desc, gf desc, won desc, club_id) position from standings where season_id = $1) t
        where club_id = $2`, [seasonId, oppId])).rows[0] ?? null;
    const lastLineup = (await c.query<{ formation: string }>(
      `select l.formation from lineups l join fixtures f on f.id = l.fixture_id
        where l.club_id = $1 and f.status = 'completed' order by f.round_number desc, f.completed_at desc nulls last limit 1`, [oppId])).rows[0] ?? null;
    const players = (await c.query<OppPlayer>(
      `select id, name_snapshot name, position_group, position_detail, current_ovr, form::float form,
              coalesce((season_stats_json->>'goals')::int, 0) goals, coalesce((season_stats_json->>'assists')::int, 0) assists,
              coalesce((season_stats_json->>'apps')::int, 0) apps, (injured_matches > 0 or suspension_matches > 0) unavailable, injury_type
         from game_players where club_id = $1 order by current_ovr desc`, [oppId])).rows;
    const h2h = (await c.query<{ w: number; d: number; l: number }>(
      `select count(*) filter (where (home_club_id = $1 and result_home > result_away) or (away_club_id = $1 and result_away > result_home))::int w,
              count(*) filter (where result_home = result_away)::int d,
              count(*) filter (where (home_club_id = $1 and result_home < result_away) or (away_club_id = $1 and result_away < result_home))::int l
         from fixtures where game_id = $3 and status = 'completed'
          and ((home_club_id = $1 and away_club_id = $2) or (home_club_id = $2 and away_club_id = $1))`, [myClubId, oppId, gameId])).rows[0];
    const quotes = (await c.query<{ round: number; answers: { key: string; tone: string; text: string }[]; questions: { key: string; text: string }[] }>(
      `select round, answers, questions from press_conferences where club_id = $1 and answered_at is not null order by season desc, round desc limit 1`, [oppId])).rows[0] ?? null;
    const form = played.slice(0, 5).map((f) => {
      const gf = f.home_club_id === oppId ? f.result_home : f.result_away, ga = f.home_club_id === oppId ? f.result_away : f.result_home;
      return gf > ga ? "W" : gf === ga ? "D" : "L";
    }).reverse().join("");
    const xg = played.map((f) => ({
      for: Number((f.home_club_id === oppId ? f.stats_json?.home?.xg : f.stats_json?.away?.xg) ?? 0),
      against: Number((f.home_club_id === oppId ? f.stats_json?.away?.xg : f.stats_json?.home?.xg) ?? 0),
    }));
    const n = Math.max(1, played.length);
    return {
      club, standing: st, form, played: played.length, formation: lastLineup?.formation ?? null, players, h2h, quotes,
      avg: { gf: played.length ? (st?.gf ?? 0) / n : 0, ga: played.length ? (st?.ga ?? 0) / n : 0,
             xgf: xg.reduce((s, x) => s + x.for, 0) / n, xga: xg.reduce((s, x) => s + x.against, 0) / n },
    };
  });
}

/** Pending decisions for the overview card. */
export async function getWeekPending(userId: string, gameId: string, clubId: string) {
  return withUser(userId, async (c) => (await c.query<{ events: number; press: number }>(
    `select (select count(*) from inbox_events where club_id = $2 and resolved_at is null)::int events,
            (select count(*) from press_conferences p join games g on g.id = p.game_id
              where p.club_id = $2 and p.answered_at is null and p.season = g.current_season and p.round = g.current_matchday + 1 and g.id = $1)::int press`,
    [gameId, clubId])).rows[0]);
}
