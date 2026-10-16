import "server-only";
import { withUser } from "./db";

/** Reads for the "living league" pages (newspaper, awards, history, rivalries). All run as the user (RLS). */

export interface NewsRow {
  id: string; season: number; round: number; rank: number; kind: string; headline: string; body: string;
  fixture_id: string | null; club_ids: string[]; player_ids: string[];
}
export interface AwardsJson {
  team: { id: string; name: string; club_id: string; group: "GK" | "DEF" | "MID" | "ATT"; rating: number; goals: number; assists: number }[];
  player: AwardsJson["team"][number] | null;
  goal: { fixture_id: string; minute: number; scorer: string; club_id: string; xg: number } | null;
}

export async function getEditions(userId: string, gameId: string) {
  return withUser(userId, async (c) => (await c.query<{ season: number; round: number; stories: number }>(
    `select season, round, count(*)::int stories from news_items where game_id = $1 group by 1, 2 order by 1 desc, 2 desc`, [gameId])).rows);
}

export async function getEdition(userId: string, gameId: string, season: number, round: number) {
  return withUser(userId, async (c) => {
    const news = (await c.query<NewsRow>(
      `select id, season, round, rank, kind, headline, body, fixture_id, club_ids, player_ids from news_items
        where game_id = $1 and season = $2 and round = $3 order by rank`, [gameId, season, round])).rows;
    const awards = (await c.query<{ awards: AwardsJson }>(
      `select awards from round_awards where game_id = $1 and season = $2 and round = $3`, [gameId, season, round])).rows[0]?.awards ?? null;
    return { news, awards };
  });
}

export async function getLatestHeadlines(userId: string, gameId: string, n = 3) {
  return withUser(userId, async (c) => (await c.query<NewsRow>(
    `select id, season, round, rank, kind, headline, body, fixture_id, club_ids, player_ids from news_items
      where game_id = $1 and (season, round) = (select season, round from news_items where game_id = $1 order by season desc, round desc limit 1)
      order by rank limit $2`, [gameId, n])).rows);
}

export async function getClubsLook(userId: string, gameId: string) {
  return withUser(userId, async (c) => (await c.query<{
    id: string; name_snapshot: string; short_name: string; primary_color: string; secondary_color: string; manager_user_id: string | null; manager_name: string | null;
  }>(
    `select gc.id, gc.name_snapshot, gc.short_name, gc.primary_color, gc.secondary_color, gc.manager_user_id, pr.display_name as manager_name
       from game_clubs gc left join profiles pr on pr.id = gc.manager_user_id where gc.game_id = $1`, [gameId])).rows);
}

/** All-time record between two clubs in this game (every completed meeting, all seasons). */
export async function getHeadToHead(userId: string, gameId: string, a: string, b: string) {
  return withUser(userId, async (c) => {
    const rows = (await c.query<{ id: string; season: number; round_number: number; home_club_id: string; result_home: number; result_away: number }>(
      `select f.id, s.number season, f.round_number, f.home_club_id, f.result_home, f.result_away
         from fixtures f join seasons s on s.id = f.season_id
        where f.game_id = $1 and f.status = 'completed'
          and ((f.home_club_id = $2 and f.away_club_id = $3) or (f.home_club_id = $3 and f.away_club_id = $2))
        order by s.number desc, f.round_number desc`, [gameId, a, b])).rows;
    let aw = 0, bw = 0, d = 0, ag = 0, bg = 0;
    for (const r of rows) {
      const ga = r.home_club_id === a ? r.result_home : r.result_away, gb = r.home_club_id === a ? r.result_away : r.result_home;
      ag += ga; bg += gb;
      if (ga > gb) aw++; else if (gb > ga) bw++; else d++;
    }
    return { a_wins: aw, b_wins: bw, draws: d, a_goals: ag, b_goals: bg, meetings: rows };
  });
}

/** Every pair of human-managed clubs with their record — the league's rivalries. */
export async function getRivalries(userId: string, gameId: string) {
  return withUser(userId, async (c) => (await c.query<{
    a: string; b: string; a_wins: number; b_wins: number; draws: number; a_goals: number; b_goals: number; played: number;
  }>(
    `with h as (select id from game_clubs where game_id = $1 and manager_user_id is not null),
     m as (
       select least(f.home_club_id, f.away_club_id) a, greatest(f.home_club_id, f.away_club_id) b,
              case when f.home_club_id < f.away_club_id then f.result_home else f.result_away end ga,
              case when f.home_club_id < f.away_club_id then f.result_away else f.result_home end gb
         from fixtures f where f.game_id = $1 and f.status = 'completed'
          and f.home_club_id in (select id from h) and f.away_club_id in (select id from h))
     select a, b, count(*) filter (where ga > gb)::int a_wins, count(*) filter (where gb > ga)::int b_wins,
            count(*) filter (where ga = gb)::int draws, sum(ga)::int a_goals, sum(gb)::int b_goals, count(*)::int played
       from m group by a, b order by played desc, a, b`, [gameId])).rows);
}

/** Hall of Fame: champions, all-time scorers/appearances, records, award counts. */
export async function getHallOfFame(userId: string, gameId: string) {
  return withUser(userId, async (c) => {
    const champions = (await c.query<{ season: number; club_id: string; points: number; completed: boolean }>(
      `select distinct on (s.number) s.number season, st.club_id, st.points, s.status = 'completed' completed
         from seasons s join standings st on st.season_id = s.id where s.game_id = $1
        order by s.number, st.points desc, st.gd desc, st.gf desc, st.won desc, st.club_id`, [gameId])).rows;
    const scorers = (await c.query<{ id: string; name: string; club_id: string | null; goals: number; assists: number; apps: number }>(
      `select p.id, p.name_snapshot name, p.club_id, sum(s.goals)::int goals, sum(s.assists)::int assists, count(*)::int apps
         from match_player_stats s join game_players p on p.id = s.game_player_id
        where s.game_id = $1 group by p.id order by goals desc, assists desc, apps, p.id limit 10`, [gameId])).rows;
    const apps = (await c.query<{ id: string; name: string; club_id: string | null; apps: number; avg: number | null }>(
      `select p.id, p.name_snapshot name, p.club_id, count(*)::int apps, round(avg(s.rating), 2)::float avg
         from match_player_stats s join game_players p on p.id = s.game_player_id
        where s.game_id = $1 and s.minutes > 0 group by p.id order by apps desc, avg desc nulls last, p.id limit 10`, [gameId])).rows;
    const biggest = (await c.query<{ id: string; season: number; round_number: number; home_club_id: string; away_club_id: string; result_home: number; result_away: number }>(
      `select f.id, s.number season, f.round_number, f.home_club_id, f.away_club_id, f.result_home, f.result_away
         from fixtures f join seasons s on s.id = f.season_id where f.game_id = $1 and f.status = 'completed'
        order by abs(f.result_home - f.result_away) desc, f.result_home + f.result_away desc, f.completed_at limit 5`, [gameId])).rows;
    const awards = (await c.query<{ player_id: string; name: string; club_id: string | null; n: number }>(
      `select e.player_id, p.name_snapshot name, p.club_id, count(*)::int n from game_events e join game_players p on p.id = e.player_id
        where e.game_id = $1 and e.kind = 'player_of_round' group by e.player_id, p.name_snapshot, p.club_id order by n desc, name limit 5`, [gameId])).rows;
    const feats = (await c.query<{ kind: string; n: number }>(
      `select kind, count(*)::int n from game_events where game_id = $1 and kind in ('hat_trick','upset','comeback','late_winner','big_win','red_card')
        group by kind`, [gameId])).rows;
    // longest unbeaten run per club, over all seasons in order
    const seq = (await c.query<{ home_club_id: string; away_club_id: string; result_home: number; result_away: number }>(
      `select f.home_club_id, f.away_club_id, f.result_home, f.result_away from fixtures f join seasons s on s.id = f.season_id
        where f.game_id = $1 and f.status = 'completed' order by s.number, f.round_number`, [gameId])).rows;
    const run = new Map<string, number>(), best = new Map<string, number>();
    for (const f of seq) {
      for (const [club, gf, ga] of [[f.home_club_id, f.result_home, f.result_away], [f.away_club_id, f.result_away, f.result_home]] as const) {
        const cur = gf >= ga ? (run.get(club) ?? 0) + 1 : 0;
        run.set(club, cur);
        if (cur > (best.get(club) ?? 0)) best.set(club, cur);
      }
    }
    const unbeaten = [...best.entries()].map(([club_id, n]) => ({ club_id, n })).sort((a, b) => b.n - a.n || a.club_id.localeCompare(b.club_id)).slice(0, 5);
    return { champions, scorers, apps, biggest, awards, feats: Object.fromEntries(feats.map((f) => [f.kind, f.n])), unbeaten };
  });
}
