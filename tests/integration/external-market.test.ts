/**
 * Market across the whole dataset: players from leagues outside the game are searchable and can be signed from their
 * (AI, non-league) club via public.sign_external_player_tx. Real Postgres, real actions; only session/redirect mocked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { seedSyntheticLeague, SYNTHETIC_ANCHORS } from "../../src/integrations/catalog/synthetic";
import { createGame } from "../../src/server/services/create-game";
import * as Q from "../../src/server/queries";
import * as A from "../../src/server/actions";
import { createUser, freshDb, LOCAL_PG } from "../support/db";

const session = vi.hoisted(() => ({ user: null as { id: string; email: string | null } | null }));
vi.mock("../../src/server/auth", () => ({
  getUser: async () => session.user,
  requireUser: async () => {
    if (!session.user) throw new Error("test: no session");
    return session.user;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
}));

const DB = "touchline_it_extmarket";
let pool: Pool;
let manager: string, outsider: string, gameId: string, homeLeague: string, otherLeague: string;

const as = (id: string) => { session.user = { id, email: null }; };
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeAll(async () => {
  pool = freshDb(DB);
  Object.assign(process.env, { SUPABASE_DB_URL: `${LOCAL_PG}/${DB}`, AUTH_MODE: "dev", DEV_AUTH_SECRET: "it-dev-auth-secret-0123456789abcdef" });
  homeLeague = await seedSyntheticLeague(pool, { externalId: "it-home", name: "Liga Casa (fictícia)", clubs: 4 });
  otherLeague = await seedSyntheticLeague(pool, { externalId: "it-away", name: "Liga Fora (fictícia)", clubs: 4 });
  const snap = await buildSnapshot(pool, { provider: "synthetic", leagueExternalIds: ["it-home", "it-away"], label: "IT ext", anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01") });
  manager = await createUser(pool, "mgr@test.dev", "Manuel");
  outsider = await createUser(pool, "out@test.dev", "Otávio");
  gameId = (await createGame(pool, manager, { name: "Liga Ext", snapshotId: snap.snapshotId, leagueId: homeLeague, maxManagers: 4, tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: 20, roundIntervalHours: 24 })).gameId;
  const club = (await pool.query(`select id from game_clubs where game_id = $1 order by name_snapshot limit 1`, [gameId])).rows[0].id;
  as(manager);
  expect((await A.selectClubAction({}, form({ gameId, clubId: club }))).ok).toBe(true);
});

afterAll(async () => {
  await (globalThis as { __touchlinePool?: Pool }).__touchlinePool?.end();
  await pool.end();
});

describe("external market", () => {
  it("search spans every league of the dataset, with a league filter", async () => {
    const all = await Q.searchMarket(manager, gameId, { page: 1 });
    expect(all.rows.some((r) => r.kind === "ext")).toBe(true);
    expect(all.rows.some((r) => r.kind === "game")).toBe(true);
    const own = await Q.searchMarket(manager, gameId, { league: "game" });
    expect(own.rows.every((r) => r.kind === "game")).toBe(true);
    const away = await Q.searchMarket(manager, gameId, { league: otherLeague });
    expect(away.rows.length).toBeGreaterThan(0);
    expect(away.rows.every((r) => r.kind === "ext" && r.league_name === "Liga Fora (fictícia)")).toBe(true);
    const leagues = await Q.getMarketLeagues(manager, gameId);
    expect(leagues.map((l) => l.own)).toEqual([true, false]);
    // never leaks to non-members
    expect((await Q.searchMarket(outsider, gameId, {})).rows).toHaveLength(0);
    expect(await Q.getExternalPlayer(outsider, gameId, away.rows[0].id)).toBeNull();
  });

  it("signs an external player at the asking price, exactly once", async () => {
    const target = (await Q.searchMarket(manager, gameId, { league: otherLeague })).rows.at(-1)!;
    const ext = (await Q.getExternalPlayer(manager, gameId, target.id))!;
    const ask = Number(ext.ask_cents) / 100;
    const before = (await pool.query(`select cash_cents from game_clubs where game_id = $1 and manager_user_id = $2`, [gameId, manager])).rows[0].cash_cents;

    const low = await A.signExternalAction({}, form({ gameId, sourcePlayerId: target.id, amountEur: String(Math.max(100_000, ask - 100_000)) }));
    expect(low.error).toMatch(/Recusada/);

    let redirected = "";
    try {
      await A.signExternalAction({}, form({ gameId, sourcePlayerId: target.id, amountEur: String(ask) }));
    } catch (e) {
      redirected = (e as Error).message;
    }
    expect(redirected).toMatch(new RegExp(`/g/${gameId}/players/[0-9a-f-]{36}\\?toast=signed`));

    const p = (await pool.query(`select p.*, gc.manager_user_id from game_players p join game_clubs gc on gc.id = p.club_id
                                  where p.game_id = $1 and p.source_player_id = $2`, [gameId, target.id])).rows[0];
    expect(p.manager_user_id).toBe(manager);
    expect(Number(p.wage_cents)).toBeGreaterThan(0);
    const after = (await pool.query(`select cash_cents from game_clubs where id = $1`, [p.club_id])).rows[0].cash_cents;
    expect(Number(before) - Number(after)).toBe(ask * 100);
    const tx = (await Q.getRecentTransfers(manager, gameId))[0];
    expect(tx.player_name).toBe(target.name_snapshot);
    expect(tx.from_name).toBe(ext.club_name);

    const again = await A.signExternalAction({}, form({ gameId, sourcePlayerId: target.id, amountEur: String(ask) }));
    expect(again.error).toMatch(/já foi contratado/);
    const still = await Q.searchMarket(manager, gameId, { league: otherLeague, q: target.name_snapshot });
    expect(still.rows.some((r) => r.id === target.id)).toBe(false);
  });

  it("is not callable by clients", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin; set local role authenticated");
      await expect(c.query(`select public.sign_external_player_tx($1, $2, '{}'::jsonb)`, [manager, gameId])).rejects.toThrow(/permission denied/);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});
