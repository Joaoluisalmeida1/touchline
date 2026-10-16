/**
 * Phase 4a: negotiation threads between humans (counter-offers, swaps), the league wall and achievements.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { seedSyntheticLeague, SYNTHETIC_ANCHORS } from "../../src/integrations/catalog/synthetic";
import { createGame } from "../../src/server/services/create-game";
import { processNextMatchday } from "../../src/server/services/matchday";
import { asUser, createUser, freshDb } from "../support/db";

const DB = "touchline_it_social";
let pool: Pool;
let A: string, B: string, C: string, gameId: string, clubA: string, clubB: string, clubAI: string;

beforeAll(async () => {
  pool = freshDb(DB);
  const leagueId = await seedSyntheticLeague(pool, { externalId: "it-soc", name: "Liga Social (fictícia)", clubs: 4 });
  const snap = await buildSnapshot(pool, { provider: "synthetic", leagueExternalIds: ["it-soc"], label: "IT social", anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01") });
  A = await createUser(pool, "a@test.dev", "Ana");
  B = await createUser(pool, "b@test.dev", "Bruno");
  C = await createUser(pool, "c@test.dev", "Carla");
  const g = await createGame(pool, A, { name: "Liga Social", snapshotId: snap.snapshotId, leagueId, maxManagers: 4, tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: 20, roundIntervalHours: 24 });
  gameId = g.gameId;
  await asUser(pool, B, (c) => c.query(`select public.join_game($1)`, [g.inviteCode]));
  const clubs = (await pool.query(`select id from game_clubs where game_id = $1 order by name_snapshot`, [gameId])).rows;
  clubA = clubs[0].id; clubB = clubs[1].id; clubAI = clubs[2].id;
  await asUser(pool, A, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubA]));
  await asUser(pool, B, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubB]));
  await asUser(pool, A, (c) => c.query(`select public.start_game($1)`, [gameId]));
});

afterAll(async () => {
  await pool.end();
});

const one = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0] as T;
const as = <T = Record<string, unknown>>(u: string, sql: string, args: unknown[]) => asUser(pool, u, (c) => c.query(sql, args)).then((r) => r.rows[0] as T);
const reserved = async (club: string) => Number((await one<{ r: string }>(`select reserved_cents r from game_clubs where id = $1`, [club])).r);

describe("negotiations", () => {
  it("counter-offer releases the reservation; accepting it completes the deal at the new price", async () => {
    const target = await one<{ id: string }>(`select id from game_players where club_id = $1 order by current_ovr desc offset 3 limit 1`, [clubB]);
    const o = (await as<{ r: { offer_id: string; status: string } }>(A, `select public.make_offer($1, $2, $3, null, $4, null) r`, [target.id, 500_000_000, randomUUID(), "Proposta séria"])).r;
    expect(o.status).toBe("pending");
    expect(await reserved(clubA)).toBe(500_000_000);
    await expect(as(A, `select public.counter_offer($1, 900000000, null)`, [o.offer_id])).rejects.toThrow(/inexistente/);
    await as(B, `select public.counter_offer($1, $2, $3)`, [o.offer_id, 800_000_000, "Vale mais"]);
    expect(await reserved(clubA)).toBe(0);
    expect(await one(`select status, counter_amount_cents::bigint c, counter_message m from transfer_offers where id = $1`, [o.offer_id])).toMatchObject({ status: "countered", m: "Vale mais" });
    const before = Number((await one<{ c: string }>(`select cash_cents c from game_clubs where id = $1`, [clubB])).c);
    const key = randomUUID();
    const done = (await as<{ r: { status: string } }>(A, `select public.accept_counter($1, $2) r`, [o.offer_id, key])).r;
    expect(done.status).toBe("accepted");
    expect((await as<{ r: { replayed: boolean } }>(A, `select public.accept_counter($1, $2) r`, [o.offer_id, key])).r.replayed).toBe(true);
    expect((await one<{ club_id: string }>(`select club_id from game_players where id = $1`, [target.id])).club_id).toBe(clubA);
    expect(Number((await one<{ c: string }>(`select cash_cents c from game_clubs where id = $1`, [clubB])).c) - before).toBe(800_000_000);
    expect(await reserved(clubA)).toBe(0);
    const post = await one<{ payload: { between_humans: boolean; amount_cents: number } }>(`select payload from wall_posts where game_id = $1 and kind = 'transfer'`, [gameId]);
    expect(post.payload).toMatchObject({ between_humans: true, amount_cents: 800_000_000 });
  });

  it("swaps move both players (cash can be €0); AI clubs refuse swaps", async () => {
    const want = await one<{ id: string }>(`select id from game_players where club_id = $1 order by current_ovr desc offset 5 limit 1`, [clubB]);
    const give = await one<{ id: string }>(`select id from game_players where club_id = $1 order by current_ovr asc limit 1`, [clubA]);
    const o = (await as<{ r: { offer_id: string } }>(A, `select public.make_offer($1, 0, $2, $3, null, null) r`, [want.id, randomUUID(), give.id])).r;
    await expect(as(A, `select public.make_offer($1, 0, $2, null, null, null) r`, [want.id, randomUUID()])).rejects.toThrow(/mínimo|pendente/);
    await as(B, `select public.respond_offer($1, true)`, [o.offer_id]);
    expect((await one<{ club_id: string }>(`select club_id from game_players where id = $1`, [want.id])).club_id).toBe(clubA);
    expect((await one<{ club_id: string }>(`select club_id from game_players where id = $1`, [give.id])).club_id).toBe(clubB);
    expect(Number((await one<{ n: string }>(`select count(*) n from transfer_transactions where game_id = $1 and player_id = $2 and price_cents = 0`, [gameId, give.id])).n)).toBe(1);

    const ai = await one<{ id: string }>(`select id from game_players where club_id = $1 limit 1`, [clubAI]);
    const mine = await one<{ id: string }>(`select id from game_players where club_id = $1 limit 1`, [clubA]);
    await expect(as(A, `select public.make_offer($1, 100000000, $2, $3, null, null)`, [ai.id, randomUUID(), mine.id])).rejects.toThrow(/IA só aceitam dinheiro/);
    await expect(as(A, `select public.make_offer($1, 0, $2, $3, null, null)`, [want.id, randomUUID(), want.id])).rejects.toThrow(/já é teu/);
  });
});

describe("league wall", () => {
  it("members post and react; only author or owner delete; outsiders see nothing", async () => {
    const id = (await as<{ post_wall: string }>(B, `select public.post_wall($1, $2)`, [gameId, "  Este ano é nosso!  "])).post_wall;
    expect((await one<{ body: string }>(`select body from wall_posts where id = $1`, [id])).body).toBe("Este ano é nosso!");
    await expect(as(B, `select public.post_wall($1, $2)`, [gameId, "x".repeat(281)])).rejects.toThrow(/280/);
    expect((await as<{ r: boolean }>(A, `select public.react_wall($1, '🔥') r`, [id])).r).toBe(true);
    expect((await as<{ r: boolean }>(A, `select public.react_wall($1, '🔥') r`, [id])).r).toBe(false);
    await expect(as(A, `select public.react_wall($1, '💩')`, [id])).rejects.toThrow(/inválida/);
    await expect(as(C, `select public.post_wall($1, 'olá')`, [gameId])).rejects.toThrow(/membro/);
    expect(Number((await as<{ n: string }>(C, `select count(*) n from wall_posts where game_id = $1`, [gameId])).n)).toBe(0);
    const aPost = (await as<{ post_wall: string }>(A, `select public.post_wall($1, 'Vamos ver')`, [gameId])).post_wall;
    await expect(as(B, `select public.delete_wall_post($1)`, [aPost])).rejects.toThrow(/autor ou o dono/);
    await as(A, `select public.delete_wall_post($1)`, [id]); // A owns the league
    expect(Number((await as<{ n: string }>(B, `select count(*) n from wall_posts where id = $1`, [id])).n)).toBe(0);
    await expect(asUser(pool, A, (c) => c.query(`insert into wall_posts (game_id, kind, body) values ($1, 'post', 'hack')`, [gameId]))).rejects.toThrow(/permission denied/);
  });
});

describe("achievements", () => {
  it("are evaluated after a round, notified and announced; the round headline is posted", async () => {
    await processNextMatchday(pool, gameId, { requestId: "soc-1" });
    await processNextMatchday(pool, gameId, { requestId: "soc-2" });
    expect(Number((await one<{ n: string }>(`select count(*) n from wall_posts where game_id = $1 and kind = 'headline'`, [gameId])).n)).toBe(2);
    const keys = (await pool.query(`select key from achievements where game_id = $1 and user_id = $2`, [gameId, A])).rows.map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["friends_deal", "swap"]));
    const posts = Number((await one<{ n: string }>(`select count(*) n from wall_posts where game_id = $1 and kind = 'achievement'`, [gameId])).n);
    expect(posts).toBe(Number((await one<{ n: string }>(`select count(*) n from achievements where game_id = $1`, [gameId])).n));
    // idempotent: a second evaluation adds nothing
    const { evaluateAchievements } = await import("../../src/server/services/social");
    expect(await evaluateAchievements(pool, gameId)).toEqual([]);
  });
});
