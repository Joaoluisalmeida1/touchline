/**
 * Publishes "O Apito" for a processed round: loads the round's facts, runs the pure narrative generator and stores
 * stories, awards and log facts. Idempotent (unique keys + on conflict do nothing) and safe to call lazily, so rounds
 * processed before this feature existed are back-filled the first time someone opens the newspaper.
 */
import type { Pool, PoolClient } from "pg";
import { buildEdition } from "../../engine/narrative/newspaper";
import type { NHeadToHead, NMatch, RoundFacts } from "../../engine/narrative/types";
import { asService } from "../pg";

export async function loadRoundFacts(c: PoolClient, gameId: string, season: number, round: number): Promise<RoundFacts | null> {
  const se = await c.query<{ id: string; total_rounds: number }>(`select id, total_rounds from public.seasons where game_id = $1 and number = $2`, [gameId, season]);
  if (!se.rowCount) return null;
  const seasonId = se.rows[0].id;
  const fx = await c.query(
    `select id, home_club_id, away_club_id, result_home, result_away, stats_json from public.fixtures
      where season_id = $1 and round_number = $2 and status = 'completed' order by id`, [seasonId, round]);
  if (!fx.rowCount) return null;
  const ids = fx.rows.map((f) => f.id);
  const clubs = await c.query(
    `select gc.id, gc.name_snapshot, gc.short_name, gc.strength, pr.display_name
       from public.game_clubs gc left join public.profiles pr on pr.id = gc.manager_user_id where gc.game_id = $1`, [gameId]);
  const ev = await c.query(
    `select e.fixture_id, e.minute, e.club_id, e.event_type, e.player_id, p.name_snapshot as player, r.name_snapshot as related, e.payload_json
       from public.match_events e left join public.game_players p on p.id = e.player_id left join public.game_players r on r.id = e.related_player_id
      where e.fixture_id = any($1) and e.event_type in ('goal','own_goal','red_card','second_yellow') order by e.fixture_id, e.sequence_number`, [ids]);
  const ps = await c.query(
    `select s.game_player_id, s.club_id, s.rating::float rating, s.goals, s.assists, s.minutes, p.name_snapshot, p.position_group
       from public.match_player_stats s join public.game_players p on p.id = s.game_player_id where s.fixture_id = any($1)`, [ids]);
  // standings after this round come from the table; "before" = after minus this round's points
  const st = await c.query<{ club_id: string; points: number; gd: number; gf: number }>(
    `select club_id, points, gd, gf from public.standings where season_id = $1`, [seasonId]);
  const later = await c.query<{ home_club_id: string; away_club_id: string; result_home: number; result_away: number; round_number: number }>(
    `select home_club_id, away_club_id, result_home, result_away, round_number from public.fixtures
      where season_id = $1 and round_number >= $2 and status = 'completed'`, [seasonId, round]);
  const cfg = (await c.query(`select settings_json from public.games where id = $1`, [gameId])).rows[0]?.settings_json ?? {};
  const win = Number(cfg.points_win ?? 3), draw = Number(cfg.points_draw ?? 1);
  const pts = (gf: number, ga: number) => (gf > ga ? win : gf === ga ? draw : 0);
  const after = new Map(st.rows.map((r) => [r.club_id, r.points]));
  const before = new Map(after);
  for (const f of later.rows) {
    // remove later rounds from "after", and this round too from "before"
    const dh = pts(f.result_home, f.result_away), da = pts(f.result_away, f.result_home);
    if (f.round_number > round) {
      after.set(f.home_club_id, (after.get(f.home_club_id) ?? 0) - dh);
      after.set(f.away_club_id, (after.get(f.away_club_id) ?? 0) - da);
    }
    before.set(f.home_club_id, (before.get(f.home_club_id) ?? 0) - dh);
    before.set(f.away_club_id, (before.get(f.away_club_id) ?? 0) - da);
  }
  const sortTable = (m: Map<string, number>) => [...m.entries()].map(([club_id, points]) => ({ club_id, points }))
    .sort((a, b) => b.points - a.points || a.club_id.localeCompare(b.club_id));

  const humans = clubs.rows.filter((r) => r.display_name).map((r) => r.id as string);
  const h2h: NHeadToHead[] = [];
  if (humans.length >= 2) {
    const hx = await c.query<{ home_club_id: string; away_club_id: string; result_home: number; result_away: number }>(
      `select f.home_club_id, f.away_club_id, f.result_home, f.result_away from public.fixtures f join public.seasons s on s.id = f.season_id
        where f.game_id = $1 and f.status = 'completed' and f.home_club_id = any($2) and f.away_club_id = any($2)
          and (s.number < $3 or (s.number = $3 and f.round_number <= $4))`, [gameId, humans, season, round]);
    const map = new Map<string, NHeadToHead>();
    for (const f of hx.rows) {
      const [a, b] = [f.home_club_id, f.away_club_id].sort();
      const k = `${a}|${b}`;
      const cur = map.get(k) ?? { a, b, a_wins: 0, b_wins: 0, draws: 0 };
      const ag = a === f.home_club_id ? f.result_home : f.result_away, bg = a === f.home_club_id ? f.result_away : f.result_home;
      if (ag > bg) cur.a_wins++; else if (bg > ag) cur.b_wins++; else cur.draws++;
      map.set(k, cur);
    }
    h2h.push(...map.values());
  }

  const matches: NMatch[] = fx.rows.map((f) => {
    const e = ev.rows.filter((x) => x.fixture_id === f.id);
    return {
      fixture_id: f.id, home_id: f.home_club_id, away_id: f.away_club_id, home_goals: f.result_home, away_goals: f.result_away,
      home_xg: Number(f.stats_json?.home?.xg ?? 0), away_xg: Number(f.stats_json?.away?.xg ?? 0),
      goals: e.filter((x) => x.event_type === "goal" || x.event_type === "own_goal").map((x) => ({
        minute: x.minute, club_id: x.club_id, scorer_id: x.player_id, scorer: x.player, assist: x.related,
        xg: typeof x.payload_json?.xg === "number" ? x.payload_json.xg : null, own_goal: x.event_type === "own_goal",
        penalty: x.payload_json?.kind === "penalty",
      })),
      reds: e.filter((x) => x.event_type === "red_card" || x.event_type === "second_yellow")
        .map((x) => ({ club_id: x.club_id, player: x.player, minute: x.minute })),
    };
  });
  const pc = await c.query<{ club_id: string; opponent_club_id: string | null; questions: { key: string; text: string }[]; answers: { key: string; tone: string; text: string }[] }>(
    `select club_id, opponent_club_id, questions, answers from public.press_conferences
      where game_id = $1 and season = $2 and round = $3 and answered_at is not null order by club_id`, [gameId, season, round]);
  const press = pc.rows.map((r) => ({
    club_id: r.club_id, opponent_id: r.opponent_club_id,
    answers: (r.answers ?? []).map((a) => ({
      question: r.questions.find((q) => q.key === a.key)?.text ?? "", tone: a.tone as "confident", text: String(a.text ?? ""),
    })),
  }));
  return {
    ...(press.length ? { press } : {}),
    game_id: gameId, season, round, total_rounds: se.rows[0].total_rounds,
    clubs: clubs.rows.map((r) => ({ id: r.id, name: r.name_snapshot, short: r.short_name, strength: Number(r.strength), manager: r.display_name ?? null })),
    matches,
    players: ps.rows.map((r) => ({ id: r.game_player_id, name: r.name_snapshot, club_id: r.club_id, group: r.position_group, rating: r.rating, goals: r.goals, assists: r.assists, minutes: r.minutes })),
    table_before: round > 1 ? sortTable(before) : [],
    table_after: sortTable(after),
    head_to_head: h2h,
  };
}

/** Builds and stores the edition for one round. Returns false when the round has no completed fixtures. */
export async function publishRound(pool: Pool, gameId: string, season: number, round: number): Promise<boolean> {
  return asService(pool, async (c) => {
    const facts = await loadRoundFacts(c, gameId, season, round);
    if (!facts) return false;
    const ed = buildEdition(facts);
    await c.query("begin");
    try {
      for (const s of ed.stories) {
        await c.query(
          `insert into public.news_items (game_id, season, round, rank, kind, headline, body, fixture_id, club_ids, player_ids, version)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (game_id, season, round, rank) do nothing`,
          [gameId, season, round, s.rank, s.kind, s.headline, s.body, s.fixture_id, s.club_ids, s.player_ids, ed.version]);
      }
      for (const f of ed.facts) {
        await c.query(
          `insert into public.game_events (game_id, season, round, kind, key, club_id, player_id, payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (game_id, season, round, kind, key) do nothing`,
          [gameId, season, round, f.kind, f.key, f.club_id, f.player_id, JSON.stringify(f.payload)]);
      }
      await c.query(
        `insert into public.round_awards (game_id, season, round, awards, version) values ($1,$2,$3,$4,$5)
         on conflict (game_id, season, round) do nothing`, [gameId, season, round, JSON.stringify(ed.awards), ed.version]);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
    return true;
  });
}

/** Back-fills every processed round of the current season that has no edition yet (cheap when nothing is missing). */
export async function ensureEditions(pool: Pool, gameId: string): Promise<void> {
  const missing = await asService(pool, async (c) => (await c.query<{ number: number; round_number: number }>(
    `select distinct s.number, f.round_number from public.fixtures f join public.seasons s on s.id = f.season_id
      where f.game_id = $1 and f.status = 'completed'
        and not exists (select 1 from public.round_awards a where a.game_id = f.game_id and a.season = s.number and a.round = f.round_number)
        -- a round counts once all its fixtures are completed
        and not exists (select 1 from public.fixtures x where x.season_id = f.season_id and x.round_number = f.round_number and x.status <> 'completed')
      order by 1, 2 limit 40`, [gameId])).rows);
  for (const m of missing) await publishRound(pool, gameId, m.number, m.round_number);
}
