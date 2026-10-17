/**
 * Phase 4b: the league cup (bracket, ties played between league rounds, prizes, champion), the academy intake and
 * promotions, contract renewals, Bosman releases at season end and the free-agent window.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { seedSyntheticLeague, SYNTHETIC_ANCHORS } from "../../src/integrations/catalog/synthetic";
import { createGame } from "../../src/server/services/create-game";
import { processNextMatchday } from "../../src/server/services/matchday";
import { ensureContractTalks } from "../../src/server/services/career";
import { getTodayItems } from "../../src/server/today-queries";
import { asUser, createUser, freshDb } from "../support/db";

const DB = "touchline_it_cups";
let pool: Pool;
let A: string, B: string, gameId: string, clubA: string, clubB: string;

beforeAll(async () => {
  pool = freshDb(DB);
  const leagueId = await seedSyntheticLeague(pool, { externalId: "it-cup", name: "Liga Taça (fictícia)", clubs: 4 });
  const snap = await buildSnapshot(pool, { provider: "synthetic", leagueExternalIds: ["it-cup"], label: "IT cup", anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01") });
  A = await createUser(pool, "a@test.dev", "Ana");
  B = await createUser(pool, "b@test.dev", "Bruno");
  const g = await createGame(pool, A, { name: "Liga Taça", snapshotId: snap.snapshotId, leagueId, maxManagers: 4, tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: 20, roundIntervalHours: 24 });
  gameId = g.gameId;
  await asUser(pool, B, (c) => c.query(`select public.join_game($1)`, [g.inviteCode]));
  const clubs = (await pool.query(`select id from game_clubs where game_id = $1 order by name_snapshot`, [gameId])).rows;
  clubA = clubs[0].id; clubB = clubs[1].id;
  await asUser(pool, A, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubA]));
  await asUser(pool, B, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubB]));
  await asUser(pool, A, (c) => c.query(`select public.start_game($1)`, [gameId]));
  // three of Ana's players are in their final contract year
  await pool.query(`update game_players set contract_end_season = greatest(contract_end_season, 2) where game_id = $1`, [gameId]);
  await pool.query(`update game_players set contract_end_season = 1 where id in (select id from game_players where club_id = $1 order by current_ovr desc limit 3)`, [clubA]);
});

afterAll(async () => {
  await pool.end();
});

const n = async (sql: string, args: unknown[] = []) => Number((await pool.query(sql, args)).rows[0].n);
const as = <T = Record<string, unknown>>(u: string, sql: string, args: unknown[]) => asUser(pool, u, (c) => c.query(sql, args)).then((r) => r.rows[0] as T);

describe("cups & careers", () => {
  it("contract talks: renew one, a refusing player cannot be renewed", async () => {
    await ensureContractTalks(pool, gameId);
    const talks = (await pool.query(`select id, player_id, options from contract_talks where club_id = $1 order by player_id`, [clubA])).rows;
    expect(talks).toHaveLength(3);
    await pool.query(`update contract_talks set refuses = true where id = $1`, [talks[2].id]);
    await as(A, `select public.renew_contract($1, 2)`, [talks[0].id]);
    expect((await pool.query(`select contract_end_season c from game_players where id = $1`, [talks[0].player_id])).rows[0].c).toBe(3);
    await expect(as(A, `select public.renew_contract($1, 2)`, [talks[0].id])).rejects.toThrow(/terminou/);
    await expect(as(A, `select public.renew_contract($1, 1)`, [talks[2].id])).rejects.toThrow(/não quer renovar/);
    await expect(as(B, `select public.renew_contract($1, 1)`, [talks[1].id])).rejects.toThrow(/inexistente/);
  });

  it("the cup runs between league rounds and crowns a winner; the academy delivers after round 4", async () => {
    for (let r = 1; r <= 2; r++) await processNextMatchday(pool, gameId, { requestId: `cup-${r}` });
    expect(await n(`select count(*) n from cup_ties where game_id = $1 and round = 1 and status = 'played' and winner_club_id is not null`, [gameId])).toBe(2);
    expect(await n(`select count(*) n from cup_ties where game_id = $1 and round = 2 and status = 'scheduled'`, [gameId])).toBe(1);
    expect(await n(`select count(*) n from club_ledger where game_id = $1 and idempotency_key like 'cup:%'`, [gameId])).toBe(2);
    for (let r = 3; r <= 4; r++) await processNextMatchday(pool, gameId, { requestId: `cup-${r}` });
    const final = (await pool.query(`select winner_club_id, home_goals, away_goals, pens_home, pens_away from cup_ties where game_id = $1 and round = 2`, [gameId])).rows[0];
    expect(final.winner_club_id).toBeTruthy();
    if (final.home_goals === final.away_goals) expect(final.pens_home).not.toBe(final.pens_away);
    expect(await n(`select count(*) n from game_events where game_id = $1 and kind = 'cup_winner' and club_id = $2`, [gameId, final.winner_club_id])).toBe(1);
    expect(await n(`select count(*) n from wall_posts where game_id = $1 and dedupe_key = 'cup:1'`, [gameId])).toBe(1);

    // academy (intake after round 4 of 6): every club gets prospects; AI clubs promote their best
    expect(await n(`select count(distinct club_id) n from academy_prospects where game_id = $1`, [gameId])).toBe(4);
    expect(await n(`select count(*) n from academy_prospects x join game_clubs c on c.id = x.club_id where x.game_id = $1 and c.manager_user_id is null and x.status = 'promoted'`, [gameId])).toBe(2);
    const mine = (await pool.query(`select id from academy_prospects where club_id = $1 and status = 'academy' order by potential_cap desc`, [clubA])).rows;
    const pid = (await as<{ promote_prospect: string }>(A, `select public.promote_prospect($1)`, [mine[0].id])).promote_prospect;
    expect((await pool.query(`select club_id, age_known, potential_band from game_players where id = $1`, [pid])).rows[0]).toMatchObject({ club_id: clubA, age_known: true });
    await as(A, `select public.release_prospect($1)`, [mine[1].id]);
    await expect(as(A, `select public.promote_prospect($1)`, [mine[1].id])).rejects.toThrow(/já não está/);
    await expect(as(B, `select public.promote_prospect($1)`, [mine[2].id])).rejects.toThrow(/inexistente/);

    // UI v2 "Por decidir" drawer: one RLS query, grouped per kind, only the caller's club
    (globalThis as unknown as { __touchlinePool?: Pool }).__touchlinePool = pool;
    const today = await getTodayItems(A, gameId, clubA);
    expect(today.filter((i) => i.kind === "academy")).toHaveLength(1);
    expect(today.filter((i) => i.kind === "contract").length).toBeLessThanOrEqual(1);
    expect(today.every((i) => i.href.startsWith(`/g/${gameId}/`))).toBe(true);
    expect(await getTodayItems(B, gameId, clubA)).toEqual([]);
  });

  it("season end: unrenewed contracts leave as free agents; the window lets humans sign them, then the AI takes the rest", async () => {
    for (let r = 5; r <= 6; r++) await processNextMatchday(pool, gameId, { requestId: `cup-${r}` });
    const g = (await pool.query(`select current_season s, current_matchday m from games where id = $1`, [gameId])).rows[0];
    expect(g).toMatchObject({ s: 2, m: 0 });
    const free = (await pool.query(`select id, free_agent_wage_cents from game_players where game_id = $1 and club_id is null and free_agent_since = 2`, [gameId])).rows;
    expect(free).toHaveLength(2);
    // members can list free agents (column grants include the new columns)
    expect(Number((await as<{ n: string }>(A, `select count(*) n from game_players where game_id = $1 and club_id is null and free_agent_since = 2 and free_agent_wage_cents > 0`, [gameId])).n)).toBe(2);
    expect(await n(`select count(*) n from notifications where user_id = $1 and type = 'contracts_expired'`, [A])).toBe(1);
    await as(B, `select public.sign_free_agent($1)`, [free[0].id]);
    const signed = (await pool.query(`select club_id, wage_cents from game_players where id = $1`, [free[0].id])).rows[0];
    expect(signed.club_id).toBe(clubB);
    expect(Number(signed.wage_cents)).toBe(Number(free[0].free_agent_wage_cents));
    for (let r = 1; r <= 3; r++) await processNextMatchday(pool, gameId, { requestId: `s2-${r}` });
    await expect(as(A, `select public.sign_free_agent($1)`, [free[1].id])).rejects.toThrow(/fecha|não está livre/);
    expect(await n(`select count(*) n from game_players where game_id = $1 and club_id is null and free_agent_since = 2`, [gameId])).toBe(0);
    // a new cup for season 2
    expect(await n(`select count(*) n from cup_ties where game_id = $1 and season = 2 and round = 1`, [gameId])).toBe(2);
  });
});
