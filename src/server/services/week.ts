/**
 * "Semana de jornada": after a round is processed, prepares the next one — a press conference for every human club
 * with a fixture, and Gabinete events for every club (AI clubs get the same dice and take the default at kickoff).
 * Idempotent: a `week_prepared` row in game_events marks the (season, round) as done, so the roll happens once even if
 * this is called again later (lazily from pages) with a different squad state.
 */
import type { Pool } from "pg";
import { rollEvents, type EvPlayer } from "../../engine/narrative/events";
import { pressQuestions } from "../../engine/narrative/press";
import { asService } from "../pg";

type R = "W" | "D" | "L";

export async function prepareWeek(pool: Pool, gameId: string, season: number, round: number): Promise<{ prepared: boolean; press: number; events: number }> {
  return asService(pool, async (c) => {
    const se = await c.query<{ id: string; total_rounds: number }>(
      `select id, total_rounds from public.seasons where game_id = $1 and number = $2`, [gameId, season]);
    if (!se.rowCount) return { prepared: false, press: 0, events: 0 };
    const { id: seasonId, total_rounds } = se.rows[0];
    const fixtures = (await c.query<{ id: string; home_club_id: string; away_club_id: string; status: string }>(
      `select id, home_club_id, away_club_id, status from public.fixtures where season_id = $1 and round_number = $2`, [seasonId, round])).rows;
    if (!fixtures.length || fixtures.every((f) => f.status === "completed")) return { prepared: false, press: 0, events: 0 };

    await c.query("begin");
    try {
      const mark = await c.query(
        `insert into public.game_events (game_id, season, round, kind, key, payload) values ($1, $2, $3, 'week_prepared', 'week', '{}'::jsonb)
         on conflict (game_id, season, round, kind, key) do nothing returning id`, [gameId, season, round]);
      if (!mark.rowCount) { await c.query("rollback"); return { prepared: false, press: 0, events: 0 }; }

      const clubs = (await c.query<{ id: string; name_snapshot: string; reputation: number; manager_user_id: string | null; display_name: string | null }>(
        `select gc.id, gc.name_snapshot, gc.reputation, gc.manager_user_id, pr.display_name
           from public.game_clubs gc left join public.profiles pr on pr.id = gc.manager_user_id where gc.game_id = $1 order by gc.id`, [gameId])).rows;
      const table = (await c.query<{ club_id: string }>(
        `select club_id from public.standings where season_id = $1 order by points desc, gd desc, gf desc, won desc, club_id`, [seasonId])).rows;
      const position = new Map(table.map((r, i) => [r.club_id, i + 1]));
      const played = (await c.query<{ home_club_id: string; away_club_id: string; result_home: number; result_away: number }>(
        `select home_club_id, away_club_id, result_home, result_away from public.fixtures
          where season_id = $1 and status = 'completed' and round_number < $2 order by round_number`, [seasonId, round])).rows;
      const last = new Map<string, R[]>();
      const push = (id: string, r: R) => last.set(id, [...(last.get(id) ?? []), r].slice(-5));
      for (const f of played) {
        push(f.home_club_id, f.result_home > f.result_away ? "W" : f.result_home === f.result_away ? "D" : "L");
        push(f.away_club_id, f.result_away > f.result_home ? "W" : f.result_home === f.result_away ? "D" : "L");
      }
      const players = (await c.query<{ id: string; club_id: string; name_snapshot: string; current_ovr: number; morale: number; form: string; fitness: number;
        injured_matches: number; suspension_matches: number; season_stats_json: { apps?: number; minutes?: number } | null }>(
        `select id, club_id, name_snapshot, current_ovr, morale, form, fitness, injured_matches, suspension_matches, season_stats_json
           from public.game_players where game_id = $1 and club_id is not null order by id`, [gameId])).rows;
      const squad = new Map<string, EvPlayer[]>();
      for (const p of players) {
        const list = squad.get(p.club_id) ?? [];
        list.push({
          id: p.id, name: p.name_snapshot, ovr: p.current_ovr, morale: p.morale, form: Number(p.form), fitness: p.fitness,
          unavailable: p.injured_matches > 0 || p.suspension_matches > 0, apps: p.season_stats_json?.apps ?? 0, minutes: p.season_stats_json?.minutes ?? 0,
        });
        squad.set(p.club_id, list);
      }

      let pressN = 0, eventsN = 0;
      const perUser = new Map<string, { press: boolean; events: number }>();
      const byId = new Map(clubs.map((x) => [x.id, x]));
      // press conferences (humans with a fixture this round)
      for (const f of fixtures) {
        for (const [own, oppId, home] of [[f.home_club_id, f.away_club_id, true], [f.away_club_id, f.home_club_id, false]] as const) {
          const club = byId.get(own)!, opp = byId.get(oppId)!;
          if (!club.manager_user_id) continue;
          const rec = (await c.query<{ w: number; d: number; l: number }>(
            `select count(*) filter (where (home_club_id = $1 and result_home > result_away) or (away_club_id = $1 and result_away > result_home))::int w,
                    count(*) filter (where result_home = result_away)::int d,
                    count(*) filter (where (home_club_id = $1 and result_home < result_away) or (away_club_id = $1 and result_away < result_home))::int l
               from public.fixtures where game_id = $3 and status = 'completed'
                and ((home_club_id = $1 and away_club_id = $2) or (home_club_id = $2 and away_club_id = $1))`, [own, oppId, gameId])).rows[0];
          const questions = pressQuestions({
            gameId, season, round, total_rounds,
            club: { id: own, name: club.name_snapshot, position: position.get(own) ?? null, last_results: last.get(own) ?? [] },
            opponent: { id: oppId, name: opp.name_snapshot, position: position.get(oppId) ?? null, manager: opp.display_name, home: !home },
            record: rec,
          });
          const ins = await c.query(
            `insert into public.press_conferences (game_id, club_id, season, round, fixture_id, opponent_club_id, questions)
             values ($1,$2,$3,$4,$5,$6,$7) on conflict (club_id, season, round) do nothing returning id`,
            [gameId, own, season, round, f.id, oppId, JSON.stringify(questions)]);
          if (ins.rowCount) {
            pressN++;
            const u = perUser.get(club.manager_user_id) ?? { press: false, events: 0 };
            u.press = true;
            perUser.set(club.manager_user_id, u);
          }
        }
      }
      // Gabinete events (every club, same odds)
      for (const club of clubs) {
        const drafts = rollEvents({
          gameId, season, round, players: squad.get(club.id) ?? [],
          club: { id: club.id, name: club.name_snapshot, reputation: club.reputation, last_results: last.get(club.id) ?? [], position: position.get(club.id) ?? null, clubs: clubs.length },
        });
        for (const d of drafts) {
          const ins = await c.query(
            `insert into public.inbox_events (game_id, club_id, season, round, key, title, body, payload, choices, default_choice, deadline_round)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$4) on conflict (club_id, season, round, key) do nothing returning id`,
            [gameId, club.id, season, round, d.key, d.title, d.body, JSON.stringify(d.payload), JSON.stringify(d.choices), d.default_choice]);
          if (ins.rowCount) {
            eventsN++;
            if (club.manager_user_id) {
              const u = perUser.get(club.manager_user_id) ?? { press: false, events: 0 };
              u.events++;
              perUser.set(club.manager_user_id, u);
            }
          }
        }
      }
      for (const [userId, u] of perUser) {
        await c.query(`select public._notify($1, $2, 'week_ready', $3)`, [userId, gameId, JSON.stringify({ round, ...u })]);
      }
      await c.query("commit");
      return { prepared: true, press: pressN, events: eventsN };
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  });
}

/** Lazy back-fill for the upcoming round (first round of a season, or rounds processed before phase 2). */
export async function ensureWeek(pool: Pool, gameId: string): Promise<void> {
  const g = await asService(pool, async (c) => (await c.query<{ status: string; current_season: number; current_matchday: number }>(
    `select status, current_season, current_matchday from public.games where id = $1`, [gameId])).rows[0]);
  if (!g || g.status !== "active") return;
  await prepareWeek(pool, gameId, g.current_season, g.current_matchday + 1);
}
