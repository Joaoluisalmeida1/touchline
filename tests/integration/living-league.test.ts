/**
 * Phase 1 "living league": newspaper editions, round awards and the event log are written after every matchday,
 * idempotently, readable by members only; old rounds are back-filled lazily; push flushing is a no-op without keys.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { seedSyntheticLeague, SYNTHETIC_ANCHORS } from "../../src/integrations/catalog/synthetic";
import { createGame } from "../../src/server/services/create-game";
import { processNextMatchday } from "../../src/server/services/matchday";
import { ensureEditions, publishRound } from "../../src/server/services/newspaper";
import { flushPush } from "../../src/server/services/push";
import { asUser, createUser, freshDb } from "../support/db";

const DB = "touchline_it_living";
let pool: Pool;
let A: string, B: string, C: string, gameId: string, clubA: string, clubB: string;

beforeAll(async () => {
  pool = freshDb(DB);
  const leagueId = await seedSyntheticLeague(pool, { externalId: "it-liv", name: "Liga Viva (fictícia)", clubs: 4 });
  const snap = await buildSnapshot(pool, { provider: "synthetic", leagueExternalIds: ["it-liv"], label: "IT living", anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01") });
  A = await createUser(pool, "a@test.dev", "Ana");
  B = await createUser(pool, "b@test.dev", "Bruno");
  C = await createUser(pool, "c@test.dev", "Carla");
  const g = await createGame(pool, A, { name: "Liga Viva", snapshotId: snap.snapshotId, leagueId, maxManagers: 4, tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: 20, roundIntervalHours: 24 });
  gameId = g.gameId;
  await asUser(pool, B, (c) => c.query(`select public.join_game($1)`, [g.inviteCode]));
  const clubs = (await pool.query(`select id from game_clubs where game_id = $1 order by name_snapshot`, [gameId])).rows;
  clubA = clubs[0].id; clubB = clubs[1].id;
  await asUser(pool, A, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubA]));
  await asUser(pool, B, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubB]));
  await asUser(pool, A, (c) => c.query(`select public.start_game($1)`, [gameId]));
  for (let i = 0; i < 3; i++) await processNextMatchday(pool, gameId, { requestId: `it-${i}` });
});

afterAll(async () => {
  await pool.end();
});

const count = async (table: string, extra = "") => Number((await pool.query(`select count(*) n from public.${table} where game_id = $1 ${extra}`, [gameId])).rows[0].n);

describe("living league", () => {
  it("publishes an edition, awards and log facts for every processed round", async () => {
    const rounds = (await pool.query(`select distinct round from news_items where game_id = $1 order by 1`, [gameId])).rows.map((r) => r.round);
    expect(rounds).toEqual([1, 2, 3]);
    expect(await count("round_awards")).toBe(3);
    expect(await count("game_events", "and kind = 'match_result'")).toBe(6); // 4 clubs => 2 fixtures per round
    const aw = (await pool.query(`select awards from round_awards where game_id = $1 and round = 1`, [gameId])).rows[0].awards;
    expect(aw.team.length).toBeGreaterThanOrEqual(10);
    expect(aw.player).toBeTruthy();
    // two humans in a 4-club league meet within 3 rounds of a round robin => a derby story/fact exists
    expect(await count("game_events", "and kind = 'derby'")).toBeGreaterThanOrEqual(1);
    const ranks = (await pool.query(`select rank from news_items where game_id = $1 and round = 2 order by rank`, [gameId])).rows.map((r) => r.rank);
    expect(ranks).toEqual(ranks.map((_, i) => i + 1));
  });

  it("is idempotent and back-fills missing rounds", async () => {
    const before = [await count("news_items"), await count("game_events"), await count("round_awards")];
    await publishRound(pool, gameId, 1, 2);
    expect([await count("news_items"), await count("game_events"), await count("round_awards")]).toEqual(before);
    const headline = (await pool.query(`select headline from news_items where game_id = $1 and round = 1 and rank = 1`, [gameId])).rows[0].headline;
    await pool.query(`delete from news_items where game_id = $1 and round = 1`, [gameId]);
    await pool.query(`delete from round_awards where game_id = $1 and round = 1`, [gameId]);
    await ensureEditions(pool, gameId);
    expect(await count("round_awards")).toBe(3);
    // deterministic: the regenerated front page is identical
    expect((await pool.query(`select headline from news_items where game_id = $1 and round = 1 and rank = 1`, [gameId])).rows[0].headline).toBe(headline);
    expect(await publishRound(pool, gameId, 1, 99)).toBe(false);
  });

  it("is readable by members only and never writable by clients", async () => {
    const asA = await asUser(pool, A, (c) => c.query(`select count(*) n from news_items where game_id = $1`, [gameId]));
    expect(Number(asA.rows[0].n)).toBeGreaterThan(0);
    const asC = await asUser(pool, C, (c) => c.query(`select count(*) n from news_items where game_id = $1`, [gameId]));
    expect(Number(asC.rows[0].n)).toBe(0);
    await expect(asUser(pool, A, (c) => c.query(`insert into news_items (game_id, season, round, rank, kind, headline, version) values ($1, 1, 9, 1, 'x', 'fake', 'v')`, [gameId])))
      .rejects.toThrow(/permission denied/);
    await expect(asUser(pool, A, (c) => c.query(`select * from push_subscriptions`))).rejects.toThrow(/permission denied/);
  });

  it("marks notifications as pushed even without VAPID keys (no-op send)", async () => {
    await flushPush(pool);
    const left = await pool.query(`select count(*) n from notifications where pushed_at is null and created_at > now() - interval '1 day'`);
    expect(Number(left.rows[0].n)).toBe(0);
    expect(await flushPush(pool)).toEqual({ sent: 0, failed: 0 });
  });
});
