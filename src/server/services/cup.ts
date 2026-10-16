/**
 * League cup orchestration (cup-v1). Bracket created once per season (marker `cup_season`); each cup round is played
 * right after its league round inside the matchday job. Idempotent: ties are only played while `scheduled`, the next
 * round is inserted with on-conflict-do-nothing, ledger keys are unique.
 */
import type { Pool } from "pg";
import { CUP_VERSION, cupPrizeCents, cupSchedule, firstRound, playCupTie, roundName } from "../../engine/cup/cup";
import { asService } from "../pg";
import { loadLeagueState } from "./matchday";

export async function ensureCup(pool: Pool, gameId: string): Promise<void> {
  await asService(pool, async (c) => {
    const g = (await c.query<{ status: string; current_season: number; total_rounds: number }>(
      `select g.status, g.current_season, s.total_rounds from public.games g join public.seasons s on s.game_id = g.id and s.number = g.current_season
        where g.id = $1`, [gameId])).rows[0];
    if (!g || g.status !== "active") return;
    await c.query("begin");
    try {
      const clubs = (await c.query<{ id: string }>(`select id from public.game_clubs where game_id = $1 order by strength desc, id`, [gameId])).rows.map((r) => r.id);
      const { rounds, ties } = firstRound(clubs);
      const schedule = cupSchedule(g.total_rounds, rounds);
      const mark = await c.query(
        `insert into public.game_events (game_id, season, round, kind, key, payload) values ($1, $2, 0, 'cup_season', 'bracket', $3)
         on conflict (game_id, season, round, kind, key) do nothing returning id`,
        [gameId, g.current_season, JSON.stringify({ rounds, schedule, version: CUP_VERSION })]);
      if (!mark.rowCount) { await c.query("rollback"); return; }
      for (const t of ties) {
        const bye = t.away === null;
        await c.query(
          `insert into public.cup_ties (game_id, season, round, slot, home_club_id, away_club_id, after_league_round, status, winner_club_id)
           values ($1,$2,1,$3,$4,$5,$6,$7,$8) on conflict do nothing`,
          [gameId, g.current_season, t.slot, t.home, t.away, schedule[0], bye ? "bye" : "scheduled", bye ? t.home : null]);
      }
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  });
}

/** Plays every cup round scheduled after `leagueRound` (normally one). Returns the number of ties played. */
export async function playDueCupRounds(pool: Pool, gameId: string, season: number, leagueRound: number): Promise<number> {
  const meta = await asService(pool, async (c) => (await c.query<{ payload: { rounds: number; schedule: number[] } }>(
    `select payload from public.game_events where game_id = $1 and season = $2 and kind = 'cup_season'`, [gameId, season])).rows[0]?.payload);
  if (!meta) return 0;
  let played = 0;
  for (let k = 1; k <= meta.rounds; k++) {
    if (meta.schedule[k - 1] !== leagueRound) continue;
    played += await playRound(pool, gameId, season, k, meta.rounds, meta.schedule);
  }
  return played;
}

async function playRound(pool: Pool, gameId: string, season: number, k: number, rounds: number, schedule: number[]): Promise<number> {
  const ties = await asService(pool, async (c) => (await c.query<{ id: string; slot: number; home_club_id: string; away_club_id: string | null; status: string; winner_club_id: string | null }>(
    `select id, slot, home_club_id, away_club_id, status, winner_club_id from public.cup_ties where game_id = $1 and season = $2 and round = $3 order by slot`,
    [gameId, season, k])).rows);
  const due = ties.filter((t) => t.status === "scheduled" && t.away_club_id);
  let played = 0;
  if (due.length) {
    const state = await loadLeagueState(pool, gameId);
    const club = new Map(state.clubs.map((x) => [x.id, x]));
    const name = new Map(state.players.map((p) => [p.id, p.name]));
    for (const t of due) {
      const home = club.get(t.home_club_id)!, away = club.get(t.away_club_id!)!;
      const o = playCupTie({ gameId, season, tieId: t.id, home, away, players: state.players });
      const loser = o.winner === home.id ? away.id : home.id;
      await asService(pool, async (c) => {
        await c.query("begin");
        try {
          const upd = await c.query(
            `update public.cup_ties set status = 'played', home_goals = $2, away_goals = $3, pens_home = $4, pens_away = $5, winner_club_id = $6,
                    result_json = $7, played_at = now() where id = $1 and status = 'scheduled'`,
            [t.id, o.result.home_goals, o.result.away_goals, o.pens?.home ?? null, o.pens?.away ?? null, o.winner, JSON.stringify({
              events: o.result.events.filter((e) => ["goal", "own_goal", "red_card", "second_yellow", "penalty_missed"].includes(e.event_type))
                .map((e) => ({ minute: e.minute, type: e.event_type, side: e.side, player: e.player_id ? name.get(e.player_id) ?? null : null })),
              stats: { home: { xg: o.result.team_stats.home.xg, shots: o.result.team_stats.home.shots }, away: { xg: o.result.team_stats.away.xg, shots: o.result.team_stats.away.shots } },
              kicks: o.pens?.kicks ?? null,
            })]);
          if (!upd.rowCount) { await c.query("rollback"); return; }
          for (const e of o.player_effects) {
            await c.query(
              `update public.game_players set fitness = $2, injured_matches = case when $3::int > 0 then greatest(injured_matches, $3::int) else injured_matches end,
                      injury_type = case when $3::int > 0 then coalesce(injury_type, $4) else injury_type end, version = version + 1, updated_at = now()
                where id = $1`, [e.id, e.fitness, e.injury?.matches ?? 0, e.injury?.type ?? null]);
          }
          for (const [clubId, won] of [[o.winner, true], [loser, false]] as const) {
            const prize = cupPrizeCents(k, rounds, won);
            if (prize > 0) {
              await c.query(`select public._ledger($1, $2, 'prize_money', $3, $4, $5, $6, $7)`,
                [gameId, clubId, prize, t.id, `cup:${gameId}:${season}:${k}:${clubId}`, season, schedule[k - 1]]);
            }
          }
          await c.query("commit");
          played++;
        } catch (e) {
          await c.query("rollback");
          throw e;
        }
      });
    }
  }
  await advance(pool, gameId, season, k, rounds, schedule);
  return played;
}

/** When round k is complete: create round k+1 ties (winners of slots 2i−1 and 2i), or crown the winner. */
async function advance(pool: Pool, gameId: string, season: number, k: number, rounds: number, schedule: number[]) {
  await asService(pool, async (c) => {
    const ties = (await c.query<{ slot: number; winner_club_id: string | null; status: string }>(
      `select slot, winner_club_id, status from public.cup_ties where game_id = $1 and season = $2 and round = $3 order by slot`, [gameId, season, k])).rows;
    if (!ties.length || ties.some((t) => !t.winner_club_id)) return;
    if (k === rounds) {
      const champ = ties[0].winner_club_id!;
      const ins = await c.query(
        `insert into public.game_events (game_id, season, round, kind, key, club_id, payload) values ($1,$2,$3,'cup_winner','cup',$4,'{}'::jsonb)
         on conflict (game_id, season, round, kind, key) do nothing returning id`, [gameId, season, schedule[k - 1], champ]);
      if (ins.rowCount) {
        const club = (await c.query<{ name_snapshot: string }>(`select name_snapshot from public.game_clubs where id = $1`, [champ])).rows[0];
        await c.query(`insert into public.wall_posts (game_id, kind, payload, dedupe_key) values ($1, 'headline', $2, $3) on conflict (game_id, dedupe_key) do nothing`,
          [gameId, JSON.stringify({ headline: `${club.name_snapshot} conquista a Taça da Liga dos Amigos`, round: schedule[k - 1], season }), `cup:${season}`]);
        await c.query(`select public._notify(m.user_id, $1, 'cup_winner', $2) from public.game_members m where m.game_id = $1`,
          [gameId, JSON.stringify({ club: club.name_snapshot, season })]);
      }
      return;
    }
    for (let i = 0; i < ties.length; i += 2) {
      const a = ties[i].winner_club_id!, b = ties[i + 1]?.winner_club_id ?? null;
      await c.query(
        `insert into public.cup_ties (game_id, season, round, slot, home_club_id, away_club_id, after_league_round, status, winner_club_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing`,
        [gameId, season, k + 1, i / 2 + 1, a, b, schedule[k], b ? "scheduled" : "bye", b ? null : a]);
    }
  });
}

export { roundName };
