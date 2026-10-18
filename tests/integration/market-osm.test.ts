/**
 * market-v2 (OSM-style Transfer List): gradual listings from AI and foreign clubs, buying at the shown price, price
 * drops per round, expiry, manager listings within 50–150% and 4 slots, instant buys between friends, AI clubs buying
 * at the round, and no more direct offers to AI clubs.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { seedSyntheticLeague, SYNTHETIC_ANCHORS } from "../../src/integrations/catalog/synthetic";
import { createGame } from "../../src/server/services/create-game";
import { processNextMatchday } from "../../src/server/services/matchday";
import { buyListing, marketTick } from "../../src/server/services/market";
import { roundsOnList } from "../../src/engine/market/market";
import { asUser, createUser, freshDb } from "../support/db";

const DB = "touchline_it_market";
let pool: Pool;
let A: string, B: string, gameId: string, clubA: string, clubB: string;

beforeAll(async () => {
  pool = freshDb(DB);
  const home = await seedSyntheticLeague(pool, { externalId: "it-mk-home", name: "Liga Mercado (fictícia)", clubs: 6 });
  await seedSyntheticLeague(pool, { externalId: "it-mk-away", name: "Liga Estrangeira (fictícia)", clubs: 6 });
  const snap = await buildSnapshot(pool, { provider: "synthetic", leagueExternalIds: ["it-mk-home", "it-mk-away"], label: "IT mk", anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01") });
  A = await createUser(pool, "a@test.dev", "Ana");
  B = await createUser(pool, "b@test.dev", "Bruno");
  const g = await createGame(pool, A, { name: "Liga Mercado", snapshotId: snap.snapshotId, leagueId: home, maxManagers: 4, tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: 20, roundIntervalHours: 24 });
  gameId = g.gameId;
  await asUser(pool, B, (c) => c.query(`select public.join_game($1)`, [g.inviteCode]));
  const clubs = (await pool.query(`select id from game_clubs where game_id = $1 order by name_snapshot`, [gameId])).rows;
  clubA = clubs[0].id; clubB = clubs[1].id;
  await asUser(pool, A, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubA]));
  await asUser(pool, B, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubB]));
  await asUser(pool, A, (c) => c.query(`select public.start_game($1)`, [gameId]));
});

afterAll(async () => {
  await pool.end();
});

const n = async (sql: string, args: unknown[] = []) => Number((await pool.query(sql, args)).rows[0].n);
const as = (u: string, sql: string, args: unknown[]) => asUser(pool, u, (c) => c.query(sql, args));
const cash = async (club: string) => Number((await pool.query(`select cash_cents from game_clubs where id = $1`, [club])).rows[0].cash_cents);

describe("market-v2", () => {
  it("round 0: the first batch appears once (AI clubs of the league + foreign clubs)", async () => {
    expect(await marketTick(pool, gameId)).toBe(true);
    expect(await marketTick(pool, gameId)).toBe(false);
    const open = await n(`select count(*) n from transfer_listings where game_id = $1 and status = 'active'`, [gameId]);
    expect(open).toBeGreaterThanOrEqual(8);
    expect(await n(`select count(*) n from transfer_listings where game_id = $1 and origin = 'ai' and status = 'active'`, [gameId])).toBeGreaterThan(0);
    expect(await n(`select count(*) n from transfer_listings where game_id = $1 and origin = 'external' and status = 'active'`, [gameId])).toBeGreaterThan(0);
    // prices start at 1.15–1.35× value
    const bad = await n(`select count(*) n from transfer_listings where game_id = $1 and status = 'active'
                          and (asking_price_cents < value_cents * 1.14 or asking_price_cents > value_cents * 1.36)`, [gameId]);
    expect(bad).toBe(0);
  });

  it("buying from the list: AI club and foreign club, at the shown price only", async () => {
    const ai = (await pool.query(`select id, player_id, asking_price_cents p from transfer_listings where game_id = $1 and origin = 'ai' and status = 'active' order by asking_price_cents limit 1`, [gameId])).rows[0];
    await expect(buyListing(pool, A, ai.id, Number(ai.p) + 1, randomUUID())).rejects.toThrow(/preço mudou/);
    const before = await cash(clubA);
    const key = randomUUID();
    const r = await buyListing(pool, A, ai.id, Number(ai.p), key);
    expect(r.status).toBe("bought");
    expect((await pool.query(`select club_id from game_players where id = $1`, [ai.player_id])).rows[0].club_id).toBe(clubA);
    expect(await cash(clubA)).toBe(before - Number(ai.p));
    expect((await buyListing(pool, A, ai.id, Number(ai.p), key)).replayed).toBe(true);
    await expect(buyListing(pool, B, ai.id, Number(ai.p), randomUUID())).rejects.toThrow(/já não está na lista/);

    const ext = (await pool.query(`select id, source_player_id, asking_price_cents p from transfer_listings where game_id = $1 and origin = 'external' and status = 'active' order by asking_price_cents limit 1`, [gameId])).rows[0];
    const e = await buyListing(pool, B, ext.id, Number(ext.p), randomUUID());
    const signed = (await pool.query(`select club_id, wage_cents from game_players where id = $1`, [e.player_id])).rows[0];
    expect(signed.club_id).toBe(clubB);
    expect(Number(signed.wage_cents)).toBeGreaterThan(0);
    expect(await n(`select count(*) n from wall_posts where game_id = $1 and dedupe_key = $2`, [gameId, `listing:${ext.id}`])).toBe(1);
    // listing purchases don't show up as "offers"
    expect(await n(`select count(*) n from transfer_offers where game_id = $1 and response_reason like 'listing%'`, [gameId])).toBe(1);
  });

  it("no direct offers to AI clubs; managers list within 50–150% of value and 4 slots; friends buy instantly", async () => {
    const aiPlayer = (await pool.query(`select p.id from game_players p join game_clubs c on c.id = p.club_id where c.game_id = $1 and c.manager_user_id is null limit 1`, [gameId])).rows[0];
    await expect(as(A, `select public.make_offer($1, 500000000, $2, null, null, null)`, [aiPlayer.id, randomUUID()])).rejects.toThrow(/Lista de Transferências/);

    const mine = (await pool.query(`select id, market_value_cents v from game_players where club_id = $1 order by current_ovr limit 6`, [clubB])).rows;
    await expect(as(B, `select public.list_player($1, $2)`, [mine[0].id, Math.round(Number(mine[0].v) * 1.8)])).rejects.toThrow(/entre/);
    for (let i = 0; i < 4; i++) await as(B, `select public.list_player($1, $2)`, [mine[i].id, Math.round(Number(mine[i].v) / 1_000_000) * 1_000_000]);
    await expect(as(B, `select public.list_player($1, $2)`, [mine[4].id, Number(mine[4].v)])).rejects.toThrow(/máximo/);
    // re-pricing a listed player doesn't use a new slot
    await as(B, `select public.list_player($1, $2)`, [mine[0].id, Math.round(Number(mine[0].v) * 0.5 / 1_000_000) * 1_000_000 + 1_000_000]);

    const l = (await pool.query(`select id, asking_price_cents p from transfer_listings where player_id = $1 and status = 'active'`, [mine[1].id])).rows[0];
    const bBefore = await cash(clubB);
    await buyListing(pool, A, l.id, Number(l.p), randomUUID());
    expect((await pool.query(`select club_id from game_players where id = $1`, [mine[1].id])).rows[0].club_id).toBe(clubA);
    expect(await cash(clubB)).toBe(bBefore + Number(l.p));
    await expect(buyListing(pool, B, (await pool.query(`select id from transfer_listings where player_id = $1 and status = 'active'`, [mine[0].id])).rows[0].id, null, randomUUID())).rejects.toThrow(/já é teu/);
  });

  it("each round: prices drop, AI clubs buy cheap listings, new players appear, old ones expire", async () => {
    // B's remaining listings at 50% of value: AI clubs snap them up at the round
    const cheap = (await pool.query(`select l.id, l.player_id from transfer_listings l where l.seller_club_id = $1 and l.status = 'active'`, [clubB])).rows;
    for (const c of cheap) {
      const v = Number((await pool.query(`select market_value_cents v from game_players where id = $1`, [c.player_id])).rows[0].v);
      await as(B, `select public.list_player($1, $2)`, [c.player_id, Math.max(10_000_000, Math.round(v * 0.5 / 1_000_000) * 1_000_000 + 1_000_000)]);
    }
    const before = (await pool.query(`select id, asking_price_cents p, start_price_cents s, floor_price_cents f from transfer_listings where game_id = $1 and status = 'active' and origin <> 'manager'`, [gameId])).rows;
    // make one listing sit at the floor for its last round
    const old = before[0];
    await pool.query(`update transfer_listings set rounds_unsold = $2, asking_price_cents = floor_price_cents where id = $1`, [old.id, roundsOnList(Number(old.s), Number(old.f)) - 1]);
    const openedBefore = await n(`select count(*) n from transfer_listings where game_id = $1`, [gameId]);

    await processNextMatchday(pool, gameId, { requestId: "mk-1" });

    const after = new Map((await pool.query(`select id, status, asking_price_cents p, rounds_unsold r from transfer_listings where game_id = $1`, [gameId])).rows.map((r) => [r.id, r]));
    expect(after.get(old.id)!.status).toBe("expired");
    const survivor = before.find((b) => b.id !== old.id && after.get(b.id)?.status === "active")!;
    expect(Number(after.get(survivor.id)!.p)).toBeLessThan(Number(survivor.p));
    expect(after.get(survivor.id)!.r).toBe(1);
    expect(await n(`select count(*) n from transfer_listings where game_id = $1`, [gameId])).toBeGreaterThan(openedBefore);
    const soldToAi = await n(`select count(*) n from transfer_listings l join game_clubs c on c.id = l.buyer_club_id
                                where l.seller_club_id = $1 and l.status = 'sold' and c.manager_user_id is null`, [clubB]);
    expect(soldToAi).toBeGreaterThanOrEqual(1);
    expect(await n(`select count(*) n from game_events where game_id = $1 and kind = 'market_tick'`, [gameId])).toBe(2);
  });

  it("classic leagues keep the old rules", async () => {
    await pool.query(`update games set settings_json = settings_json || '{"market":"classic"}' where id = $1`, [gameId]);
    expect(await marketTick(pool, gameId)).toBe(false);
    const p = (await pool.query(`select id, market_value_cents v from game_players where club_id = $1 order by current_ovr limit 1 offset 6`, [clubB])).rows[0];
    await as(B, `select public.list_player($1, $2)`, [p.id, Number(p.v) * 5]);
    await pool.query(`update games set settings_json = settings_json - 'market' where id = $1`, [gameId]);
  });
});
