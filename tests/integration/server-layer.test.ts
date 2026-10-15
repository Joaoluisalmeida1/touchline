/**
 * The production server layer against a real Postgres (Supabase shim): src/server/queries.ts, the Server Actions and the
 * API routes. Only the session lookup (requireUser), revalidatePath and redirect are mocked — every query and command
 * runs through the real pool, role impersonation and RLS. Data: FICTIONAL synthetic snapshot.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { NextRequest } from "next/server";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { seedSyntheticLeague, SYNTHETIC_ANCHORS } from "../../src/integrations/catalog/synthetic";
import { createGame } from "../../src/server/services/create-game";
import * as Q from "../../src/server/queries";
import * as A from "../../src/server/actions";
import { GET as health } from "../../src/app/api/health/route";
import { GET as cron } from "../../src/app/api/cron/process/route";
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
  // same shape as Next's redirect error, so the actions' fail() lets it propagate
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
}));

const DB = "touchline_it_server";
const CRON_SECRET = "it-cron-secret-0123456789abcdef";
const GENERIC_ERROR = "Ocorreu um erro inesperado. Tenta novamente.";

let pool: Pool;
let owner: string, member: string, outsider: string;
let gameId: string, invite: string, ownerClub: string, memberClub: string;

const as = (id: string) => { session.user = { id, email: null }; };
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const m = /^NEXT_REDIRECT (.+)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeAll(async () => {
  pool = freshDb(DB);
  // env read lazily by serverEnv()/getPool() on first use
  Object.assign(process.env, {
    SUPABASE_DB_URL: `${LOCAL_PG}/${DB}`, AUTH_MODE: "dev", DEV_AUTH_SECRET: "it-dev-auth-secret-0123456789abcdef", CRON_SECRET,
  });
  const leagueId = await seedSyntheticLeague(pool, { externalId: "it-srv", name: "Liga Servidor (fictícia)", clubs: 4 });
  const snap = await buildSnapshot(pool, { provider: "synthetic", leagueExternalIds: ["it-srv"], label: "IT server", anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01") });
  owner = await createUser(pool, "owner@test.dev", "Olga");
  member = await createUser(pool, "member@test.dev", "Mário");
  outsider = await createUser(pool, "outsider@test.dev", "Óscar");
  const g = await createGame(pool, owner, { name: "Liga Servidor", snapshotId: snap.snapshotId, leagueId, maxManagers: 4, tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: 20, roundIntervalHours: 24 });
  gameId = g.gameId;
  invite = g.inviteCode;
});

afterAll(async () => {
  await (globalThis as { __touchlinePool?: Pool }).__touchlinePool?.end();
  await pool.end();
});

describe("server actions", () => {
  it("join: invalid code maps the SQL domain error; valid code redirects to the league", async () => {
    as(member);
    const bad = await A.joinGameAction({}, form({ code: "AAAA-AAAA-AAAA-AAAA" }));
    expect(bad.error).toBeTruthy();
    expect(bad.error).not.toBe(GENERIC_ERROR);
    expect(await redirectOf(A.joinGameAction({}, form({ code: invite.toLowerCase() })))).toBe(`/g/${gameId}`);
  });

  it("select club: members pick a club, outsiders get a domain error", async () => {
    const clubs = await Q.getClubs(owner, gameId);
    ownerClub = clubs[0].id;
    memberClub = clubs[1].id;
    as(owner);
    expect(await A.selectClubAction({}, form({ gameId, clubId: ownerClub }))).toMatchObject({ ok: true });
    as(member);
    expect(await A.selectClubAction({}, form({ gameId, clubId: memberClub }))).toMatchObject({ ok: true });
    as(outsider);
    const r = await A.selectClubAction({}, form({ gameId, clubId: clubs[2].id }));
    expect(r.error).toBeTruthy();
    expect(r.error).not.toBe(GENERIC_ERROR);
  });

  it("validates input before touching the database", async () => {
    as(owner);
    expect((await A.updateSettingsAction({}, form({ gameId, name: "x", tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: "20", roundIntervalHours: "24" }))).error).toBeTruthy();
    expect((await A.createOfferAction({}, form({ gameId, playerId: ownerClub, amountEur: "5000" }))).error).toBe("Mínimo €100 000.");
    const lineup = await A.saveLineupAction({
      gameId, formation: "4-3-3", starters: [], bench: [],
      tactics: { mentality: "balanced", tempo: "normal", pressing: "medium", defensive_line: "medium", width: "balanced", passing_directness: "mixed", transitions: "balanced" },
    });
    expect(lineup.error).toBe("Escolhe 11 titulares.");
  });

  it("only the owner starts the league and processes a matchday", async () => {
    as(member);
    expect((await A.startGameAction({}, form({ gameId }))).error).toBeTruthy();
    as(owner);
    expect(await A.startGameAction({}, form({ gameId }))).toMatchObject({ ok: true });
    as(member);
    expect((await A.processMatchdayAction({}, form({ gameId }))).error).toBe("Só o criador da liga pode avançar a jornada.");
    as(owner);
    expect(await A.processMatchdayAction({}, form({ gameId }))).toMatchObject({ ok: true, data: { round: 1 } });
  });
});

describe("queries (RLS on the real read path)", () => {
  it("members see the league; outsiders see nothing", async () => {
    expect(await Q.getGame(owner, gameId)).toMatchObject({ id: gameId, is_owner: true });
    expect((await Q.listMyGames(owner)).map((g) => g.id)).toContain(gameId);
    const fixtureId = (await Q.getFixtures(owner, gameId)).find((f) => f.status === "completed")!.id;
    const playerId = (await Q.getSquad(owner, gameId, ownerClub))[0].id;

    expect(await Q.getGame(outsider, gameId)).toBeNull();
    expect(await Q.listMyGames(outsider)).toEqual([]);
    expect(await Q.getClubs(outsider, gameId)).toEqual([]);
    expect(await Q.getMembers(outsider, gameId)).toEqual([]);
    expect(await Q.getStandings(outsider, gameId)).toEqual([]);
    expect(await Q.getFixtures(outsider, gameId)).toEqual([]);
    expect(await Q.getMatch(outsider, gameId, fixtureId)).toBeNull();
    expect(await Q.getSquad(outsider, gameId, ownerClub)).toEqual([]);
    expect(await Q.getPlayer(outsider, gameId, playerId)).toBeNull();
    expect((await Q.searchMarket(outsider, gameId, {})).rows).toEqual([]);
    expect(await Q.getOffers(outsider, gameId)).toEqual([]);
    expect(await Q.getNotifications(outsider, gameId)).toEqual([]);
  });

  it("club-private data (tactics, ledger) is only visible to that club's manager", async () => {
    const own = await Q.getFinances(owner, ownerClub);
    expect(own.club).not.toBeNull();
    expect(own.ledger.length).toBeGreaterThan(0);
    const peek = await Q.getFinances(member, ownerClub);
    // Note: the club row itself (cash, reserved, wage bill) comes from game_clubs, which every member can read
    // (policy member_read in 0004). Only the ledger is private (own_ledger_read).
    expect(peek.ledger).toEqual([]);
    expect(peek.byType).toEqual([]);
    expect((await Q.getTacticsAndLineup(member, ownerClub)).tactics).toBeNull();
  });

  it("never exposes hidden player columns", async () => {
    const squad = await Q.getSquad(owner, gameId, ownerClub);
    expect(squad.length).toBeGreaterThanOrEqual(16);
    for (const p of squad) {
      expect(p).not.toHaveProperty("potential_cap");
      expect(p).not.toHaveProperty("hidden_development_rate");
    }
  });

  it("returns a consistent processed matchday", async () => {
    const standings = await Q.getStandings(owner, gameId);
    expect(standings).toHaveLength(4);
    expect(standings.every((s) => s.played === 1)).toBe(true);
    const fx = (await Q.getFixtures(owner, gameId)).find((f) => f.status === "completed")!;
    const match = (await Q.getMatch(owner, gameId, fx.id))!;
    const goals = match.events.filter((e) => e.event_type === "goal" || e.event_type === "own_goal").length;
    expect(goals).toBe(fx.result_home + fx.result_away);
    expect(match.lineups).toHaveLength(2);
  });

  it("the market never lists the caller's own players", async () => {
    const { rows } = await Q.searchMarket(owner, gameId, { minOvr: 1, maxOvr: 99 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p) => p.manager_user_id !== owner)).toBe(true);
  });
});

describe("API routes", () => {
  const cronReq = (auth?: string) => new NextRequest("http://localhost/api/cron/process", { headers: auth ? { authorization: auth } : {} });

  it("/api/health reports the database and finalized snapshots", async () => {
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: "up", finalized_snapshots: 1 });
  });

  it("/api/cron/process rejects missing or wrong secrets", async () => {
    expect((await cron(cronReq())).status).toBe(401);
    expect((await cron(cronReq("Bearer wrong"))).status).toBe(401);
    expect((await cron(cronReq(CRON_SECRET))).status).toBe(401); // must be a Bearer token
  });

  it("/api/cron/process processes due daily-mode games only", async () => {
    let body = await (await cron(cronReq(`Bearer ${CRON_SECRET}`))).json();
    expect(body.processed).toBe(0); // the league is in manual mode
    await pool.query(`update games set tick_mode = 'daily', next_deadline_at = now() - interval '1 minute' where id = $1`, [gameId]);
    body = await (await cron(cronReq(`Bearer ${CRON_SECRET}`))).json();
    expect(body.processed).toBe(1);
    expect(body.results[0]).toMatchObject({ game_id: gameId, result: { status: "processed", round: 2 } });
  });
});
