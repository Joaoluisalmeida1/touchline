/**
 * Phase 3 "club business": season setup is idempotent, sponsors/staff/stadium/budget commands are validated in SQL,
 * the matchday pays the new revenue lines (attendance-based gate, sponsor deals, staff wages) and the board reacts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { seedSyntheticLeague, SYNTHETIC_ANCHORS } from "../../src/integrations/catalog/synthetic";
import { createGame } from "../../src/server/services/create-game";
import { processNextMatchday } from "../../src/server/services/matchday";
import { ensureBusiness } from "../../src/server/services/business";
import { asUser, createUser, freshDb } from "../support/db";

const DB = "touchline_it_business";
let pool: Pool;
let A: string, B: string, gameId: string, clubA: string, clubB: string;

beforeAll(async () => {
  pool = freshDb(DB);
  const leagueId = await seedSyntheticLeague(pool, { externalId: "it-biz", name: "Liga Negócio (fictícia)", clubs: 4 });
  const snap = await buildSnapshot(pool, { provider: "synthetic", leagueExternalIds: ["it-biz"], label: "IT biz", anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01") });
  A = await createUser(pool, "a@test.dev", "Ana");
  B = await createUser(pool, "b@test.dev", "Bruno");
  const g = await createGame(pool, A, { name: "Liga Negócio", snapshotId: snap.snapshotId, leagueId, maxManagers: 4, tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: 20, roundIntervalHours: 24 });
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
const asA = <T,>(sql: string, args: unknown[]) => asUser(pool, A, (c) => c.query(sql, args)).then((r) => r.rows[0] as T);

describe("club business", () => {
  it("sets up the season once: stadium, staff, board, staff pool, sponsor offers (AI signs the safe deal)", async () => {
    await ensureBusiness(pool, gameId);
    await ensureBusiness(pool, gameId);
    expect(await n(`select count(*) n from club_business where game_id = $1`, [gameId])).toBe(4);
    expect(await n(`select count(*) n from club_staff where game_id = $1 and active`, [gameId])).toBe(20);
    expect(await n(`select count(*) n from board_state where game_id = $1`, [gameId])).toBe(4);
    expect(await n(`select count(*) n from staff_candidates where game_id = $1`, [gameId])).toBe(60);
    expect(await n(`select count(*) n from sponsor_offers where club_id = $1 and status = 'open'`, [clubA])).toBe(12);
    expect(await n(`select count(*) n from sponsor_deals d join game_clubs c on c.id = d.club_id where c.game_id = $1 and c.manager_user_id is null and d.signed_by = 'ai' and d.kind = 'fixed'`, [gameId])).toBe(8);
  });

  it("validates sponsor, ticket, staff, upgrade and budget commands", async () => {
    const perf = await asA<{ id: string }>(`select id from sponsor_offers where club_id = $1 and slot = 'main' and kind = 'performance'`, [clubA]);
    await asA(`select public.sign_sponsor($1)`, [perf.id]);
    const other = await asA<{ id: string }>(`select id from sponsor_offers where club_id = $1 and slot = 'main' and kind = 'fixed'`, [clubA]);
    await expect(asA(`select public.sign_sponsor($1)`, [other.id])).rejects.toThrow(/disponível|Já tens/);
    await expect(asUser(pool, B, (c) => c.query(`select public.sign_sponsor($1)`, [other.id]))).rejects.toThrow(/inexistente/);

    await asA(`select public.set_ticket_price($1, 'high')`, [gameId]);
    await expect(asA(`select public.set_ticket_price($1, 'free')`, [gameId])).rejects.toThrow(/inválido/);

    const old = await asA<{ id: string; wage_cents: string }>(`select id, wage_cents from club_staff where club_id = $1 and role = 'fitness' and active`, [clubA]);
    const cand = await asA<{ id: string; level: number }>(`select id, level from staff_candidates where club_id = $1 and role = 'fitness' order by level desc limit 1`, [clubA]);
    await asA(`select public.hire_staff($1)`, [cand.id]);
    expect(await n(`select count(*) n from club_staff where club_id = $1 and role = 'fitness' and active and level = $2`, [clubA, cand.level])).toBe(1);
    const comp = (await pool.query(`select amount_cents from club_ledger where idempotency_key = $1`, [`staff:fire:${old.id}`])).rows[0];
    expect(Number(comp.amount_cents)).toBe(-2 * Number(old.wage_cents));
    await expect(asA(`select public.hire_staff($1)`, [cand.id])).rejects.toThrow(/disponível/);

    await pool.query(`update game_clubs set cash_cents = cash_cents + 1000000000 where id = $1`, [clubA]);
    await asA(`select public.start_upgrade($1, 'capacity')`, [gameId]);
    await expect(asA(`select public.start_upgrade($1, 'vip')`, [gameId])).rejects.toThrow(/obra em curso/);
    expect(await n(`select count(*) n from club_ledger where club_id = $1 and event_type = 'infrastructure' and amount_cents = -300000000`, [clubA])).toBe(1);

    await asA(`select public.set_budget_shift($1, 20)`, [gameId]);
    await expect(asA(`select public.set_budget_shift($1, 30)`, [gameId])).rejects.toThrow(/20%/);
  });

  it("keeps offers and the board private; stadium, staff and deals are visible to the league", async () => {
    const r = await asUser(pool, B, (c) => c.query(
      `select (select count(*) from board_state where club_id = $1) b, (select count(*) from sponsor_offers where club_id = $1) o,
              (select count(*) from club_business where club_id = $1) s, (select count(*) from sponsor_deals where club_id = $1) d`, [clubA]));
    expect(r.rows[0]).toMatchObject({ b: "0", o: "0", s: "1", d: "1" });
    await expect(asUser(pool, B, (c) => c.query(`update club_business set fan_mood = 100 where club_id = $1`, [clubB]))).rejects.toThrow(/permission denied/);
  });

  it("the matchday pays gate by attendance, sponsor deals (defaults signed) and staff wages; the board reacts", async () => {
    await processNextMatchday(pool, gameId, { requestId: "biz-1" });
    // every slot of every club now has a deal (B and A's empty slots took the safe offer by default)
    expect(await n(`select count(*) n from sponsor_deals d join game_clubs c on c.id = d.club_id where c.game_id = $1`, [gameId])).toBe(16);
    expect(await n(`select count(*) n from sponsor_deals where club_id = $1 and signed_by = 'default'`, [clubB])).toBe(4);
    const base = await n(`select coalesce(sum(base_cents),0) n from sponsor_deals where club_id = $1`, [clubA]);
    expect(await n(`select amount_cents n from club_ledger where club_id = $1 and event_type = 'sponsorship' and round_number = 1 and idempotency_key like 'round:%'`, [clubA])).toBe(base);
    expect(await n(`select count(*) n from club_ledger where club_id = $1 and event_type = 'staff_wages' and round_number = 1`, [clubA])).toBe(1);
    expect(await n(`select count(*) n from match_runs r join fixtures f on f.id = r.fixture_id where f.game_id = $1 and f.round_number = 1 and (r.result_json->>'attendance')::int > 0`, [gameId])).toBe(2);
    expect(await n(`select count(*) n from game_events where game_id = $1 and kind = 'business_round' and round = 1`, [gameId])).toBe(1);
    expect(await n(`select count(*) n from board_state where game_id = $1 and jsonb_array_length(history) > 0`, [gameId])).toBeGreaterThan(0);
  });
});
