/**
 * End-to-end domain flow on a real Postgres (Supabase shim): RLS, ownership, invites, lineups, matchday
 * processing exactly-once, transfers atomicity/concurrency, ledger reconciliation, season rollover.
 * Data: FICTIONAL synthetic snapshot.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { seedSyntheticLeague, SYNTHETIC_ANCHORS } from "../../src/integrations/catalog/synthetic";
import { createGame } from "../../src/server/services/create-game";
import { processNextMatchday } from "../../src/server/services/matchday";
import { asUser, createUser, expectPgError, freshDb } from "../support/db";

let pool: Pool;
let A: string, B: string, C: string;
let snapshotId: string, leagueId: string, smallLeagueId: string;
let gameId: string, invite: string;
let clubA: string, clubB: string;

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

beforeAll(async () => {
  pool = freshDb("touchline_it_flow");
  leagueId = await seedSyntheticLeague(pool, { externalId: "it-liga", name: "Liga Teste (fictícia)", clubs: 6 });
  smallLeagueId = await seedSyntheticLeague(pool, { externalId: "it-mini", name: "Mini (fictícia)", clubs: 4 });
  const snap = await buildSnapshot(pool, { provider: "synthetic", leagueExternalIds: ["it-liga", "it-mini"], label: "IT", anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01") });
  snapshotId = snap.snapshotId;
  A = await createUser(pool, "a@test.dev", "Ana");
  B = await createUser(pool, "b@test.dev", "Bruno");
  C = await createUser(pool, "c@test.dev", "Carla");
});
afterAll(async () => pool.end());

describe("league lifecycle & security", () => {
  it("creates a private league with AI-controlled clubs and a ledger-backed balance", async () => {
    const r = await createGame(pool, A, { name: "Liga dos Amigos", snapshotId, leagueId, maxManagers: 4, tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: 20, roundIntervalHours: 24 });
    gameId = r.gameId;
    invite = r.inviteCode;
    // this suite exercises the classic market (direct offers to AI clubs); market-v2 is covered by market-osm.test.ts
    await pool.query(`update games set settings_json = settings_json || '{"market":"classic"}' where id = $1`, [gameId]);
    expect(invite).toMatch(/^[A-Z2-9]{16}$/);
    const clubs = await q<{ id: string; cash_cents: string }>(`select id, cash_cents from game_clubs where game_id = $1`, [gameId]);
    expect(clubs).toHaveLength(6);
    for (const c of clubs) {
      const l = await q<{ s: string }>(`select sum(amount_cents)::text s from club_ledger where club_id = $1`, [c.id]);
      expect(l[0].s).toBe(String(c.cash_cents));
    }
    const plain = await q(`select * from game_invites where game_id = $1`, [gameId]);
    expect(JSON.stringify(plain)).not.toContain(invite); // only the hash is stored
  });

  it("outsiders cannot see the league; invite works once and is idempotent", async () => {
    expect(await asUser(pool, C, (c) => c.query(`select * from games where id = $1`, [gameId]).then((r) => r.rowCount))).toBe(0);
    expect(await asUser(pool, C, (c) => c.query(`select * from game_players where game_id = $1`, [gameId]).then((r) => r.rowCount)).catch(() => 0)).toBe(0);
    await expectPgError(asUser(pool, C, (c) => c.query(`select public.join_game('AAAAAAAAAAAAAAAA')`)), "invite_invalid");
    const g1 = await asUser(pool, B, (c) => c.query(`select public.join_game($1) g`, [invite]).then((r) => r.rows[0].g));
    const g2 = await asUser(pool, B, (c) => c.query(`select public.join_game($1) g`, [invite.toLowerCase()]).then((r) => r.rows[0].g));
    expect(g1).toBe(gameId);
    expect(g2).toBe(gameId);
    expect((await q(`select * from game_members where game_id = $1`, [gameId]))).toHaveLength(2);
  });

  it("each club has at most one manager; one club per manager", async () => {
    const clubs = await asUser(pool, A, (c) => c.query(`select id from game_clubs where game_id = $1 order by reputation desc`, [gameId]).then((r) => r.rows));
    clubA = clubs[0].id;
    clubB = clubs[1].id;
    await asUser(pool, A, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubA]));
    await expectPgError(asUser(pool, B, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubA])), "club_taken");
    await asUser(pool, B, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubB]));
    await expectPgError(asUser(pool, B, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubs[2].id])), "already_has_club");
    await expectPgError(asUser(pool, C, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubs[2].id])), "forbidden");
  });

  it("clients cannot write money, ratings, results or ledger directly", async () => {
    await expectPgError(asUser(pool, A, (c) => c.query(`update game_clubs set cash_cents = 1e15 where id = $1`, [clubA])), /permission denied/);
    await expectPgError(asUser(pool, A, (c) => c.query(`update game_players set current_ovr = 99 where club_id = $1`, [clubA])), /permission denied/);
    await expectPgError(asUser(pool, A, (c) => c.query(`insert into club_ledger (game_id, club_id, event_type, amount_cents, idempotency_key, balance_after_cents) values ($1,$2,'adjustment',1,'x',1)`, [gameId, clubA])), /permission denied/);
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.finalize_fixture(gen_random_uuid(), '{}'::jsonb)`)), /permission denied/);
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.create_game_tx($1, '{}'::jsonb)`, [A])), /permission denied/);
    await expectPgError(asUser(pool, A, (c) => c.query(`select potential_cap from game_players limit 1`)), /permission denied/);
    await expectPgError(asUser(pool, A, (c) => c.query(`select * from game_invites`)), /permission denied/);
  });

  it("managers only see their own tactics, ledger and offers", async () => {
    await asUser(pool, A, (c) => c.query(`select public.save_tactics($1, $2)`, [gameId, JSON.stringify({ formation: "4-4-2", pressing: "high" })]));
    const seenByB = await asUser(pool, B, (c) => c.query(`select * from tactics where club_id = $1`, [clubA]).then((r) => r.rowCount));
    expect(seenByB).toBe(0);
    const ledgerByB = await asUser(pool, B, (c) => c.query(`select * from club_ledger where club_id = $1`, [clubA]).then((r) => r.rowCount));
    expect(ledgerByB).toBe(0);
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.save_tactics($1, $2)`, [gameId, JSON.stringify({ pressing: "insane" })])), "invalid_tactics");
  });

  it("validates lineups (11 players, formation slots, own squad only)", async () => {
    const mine = await asUser(pool, A, (c) => c.query(`select id, position_group from game_players where club_id = $1 order by current_ovr desc`, [clubA]).then((r) => r.rows));
    const theirs = await asUser(pool, A, (c) => c.query(`select id from game_players where club_id = $1 limit 1`, [clubB]).then((r) => r.rows));
    const slots = ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"];
    const gk = mine.find((p) => p.position_group === "GK")!;
    const outfield = mine.filter((p) => p.id !== gk.id);
    const starters = slots.map((slot, i) => ({ player_id: i === 0 ? gk.id : outfield[i - 1].id, slot }));
    await asUser(pool, A, (c) => c.query(`select public.save_lineup($1,'4-4-2',$2,$3)`, [gameId, JSON.stringify(starters), JSON.stringify(outfield.slice(10, 15).map((p) => p.id))]));
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.save_lineup($1,'4-4-2',$2,'[]')`, [gameId, JSON.stringify(starters.slice(0, 10))])), "invalid_lineup");
    const stolen = [...starters.slice(0, 10), { player_id: theirs[0].id, slot: "ST" }];
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.save_lineup($1,'4-4-2',$2,'[]')`, [gameId, JSON.stringify(stolen)])), "invalid_lineup");
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.save_lineup($1,'4-3-3',$2,'[]')`, [gameId, JSON.stringify(starters)])), "invalid_lineup");
  });

  it("only the owner can start; fixtures form a valid double round robin", async () => {
    await expectPgError(asUser(pool, B, (c) => c.query(`select public.start_game($1)`, [gameId])), "forbidden");
    const rounds = await asUser(pool, A, (c) => c.query(`select public.start_game($1) r`, [gameId]).then((r) => r.rows[0].r));
    expect(rounds).toBe(10);
    const fx = await q<{ round_number: number; home_club_id: string; away_club_id: string }>(`select round_number, home_club_id, away_club_id from fixtures where game_id = $1`, [gameId]);
    expect(fx).toHaveLength(30);
    expect(new Set(fx.map((f) => `${f.home_club_id}>${f.away_club_id}`)).size).toBe(30);
  });
});

describe("matchday processing", () => {
  it("processes a round exactly once and the standings reconcile with results", async () => {
    const r = await processNextMatchday(pool, gameId);
    expect(r.status).toBe("processed");
    expect(r.round).toBe(1);
    const fx = await q<{ id: string; result_home: number; result_away: number; status: string }>(
      `select id, result_home, result_away, status from fixtures where game_id = $1 and round_number = 1`, [gameId]);
    expect(fx.every((f) => f.status === "completed")).toBe(true);
    for (const f of fx) {
      const goals = await q<{ n: number; club_id: string }>(`select count(*)::int n, club_id from match_events where fixture_id = $1 and event_type in ('goal','own_goal') group by club_id`, [f.id]);
      expect(goals.reduce((s, g) => s + g.n, 0)).toBe(f.result_home + f.result_away);
    }
    const st = await q<{ points: number; played: number; gf: number; ga: number }>(`select points, played, gf, ga from standings s join seasons se on se.id = s.season_id where se.game_id = $1`, [gameId]);
    expect(st.reduce((s, x) => s + x.played, 0)).toBe(6);
    expect(st.reduce((s, x) => s + x.gf, 0)).toBe(st.reduce((s, x) => s + x.ga, 0));
    const g = await q<{ current_matchday: number; processing_lease_until: string | null }>(`select current_matchday, processing_lease_until from games where id = $1`, [gameId]);
    expect(g[0].current_matchday).toBe(1);
    expect(g[0].processing_lease_until).toBeNull();
  });

  it("replaying a finalize is a no-op (no double standings, ledger or progression)", async () => {
    const fx = await q<{ id: string }>(`select id from fixtures where game_id = $1 and round_number = 1 limit 1`, [gameId]);
    const before = await q(`select (select count(*) from club_ledger where game_id = $1)::int l, (select sum(points) from standings where game_id = $1)::int p, (select count(*) from match_events where game_id = $1)::int e`, [gameId]);
    const r = await pool.query(`select public.finalize_fixture($1, '{"result":{"home_goals":9,"away_goals":9},"events":[]}'::jsonb) r`, [fx[0].id]);
    expect(r.rows[0].r.status).toBe("already_completed");
    const again = await processNextMatchday(pool, gameId); // processes round 2, not round 1 again
    expect(again.round).toBe(2);
    const after = await q(`select (select sum(points) from standings where game_id = $1)::int p`, [gameId]);
    expect(after[0].p).toBeGreaterThan(before[0].p as number);
    const dupKeys = await q(`select idempotency_key from club_ledger where game_id = $1 group by 1 having count(*) > 1`, [gameId]);
    expect(dupKeys).toHaveLength(0);
  });

  it("concurrent processors cannot double-process a round", async () => {
    const [r1, r2] = await Promise.all([processNextMatchday(pool, gameId), processNextMatchday(pool, gameId)]);
    const processed = [r1, r2].filter((r) => r.status === "processed");
    expect(processed).toHaveLength(1);
    const g = await q<{ current_matchday: number }>(`select current_matchday from games where id = $1`, [gameId]);
    expect(g[0].current_matchday).toBe(3);
    const perRound = await q<{ n: number }>(`select count(*)::int n from fixtures where game_id = $1 and round_number = 3 and status = 'completed'`, [gameId]);
    expect(perRound[0].n).toBe(3);
  });

  it("locks lineups while processing", async () => {
    await pool.query(`update games set processing_lease_until = now() + interval '1 minute' where id = $1`, [gameId]);
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.save_lineup($1,'4-3-3','[]','[]')`, [gameId])), "locked");
    await pool.query(`update games set processing_lease_until = null where id = $1`, [gameId]);
  });
});

describe("transfer market", () => {
  it("AI clubs counter low bids and accept at their asking price, atomically", async () => {
    const aiPlayer = await asUser(pool, A, (c) => c.query(
      `select p.id, p.club_id from game_players p join game_clubs gc on gc.id = p.club_id where p.game_id = $1 and gc.manager_user_id is null order by p.current_ovr asc limit 1`, [gameId]).then((r) => r.rows[0]));
    const low = await asUser(pool, A, (c) => c.query(`select public.create_offer($1, 10000000, 'key-low-0001') r`, [aiPlayer.id]).then((r) => r.rows[0].r));
    expect(low.status).toBe("rejected");
    expect(Number(low.counter_amount_cents)).toBeGreaterThan(0);
    const cashBefore = (await q<{ cash_cents: string; reserved_cents: string }>(`select cash_cents, reserved_cents from game_clubs where id = $1`, [clubA]))[0];
    expect(cashBefore.reserved_cents).toBe("0");
    const ok = await asUser(pool, A, (c) => c.query(`select public.create_offer($1, $2, 'key-ok-00001') r`, [aiPlayer.id, low.counter_amount_cents]).then((r) => r.rows[0].r));
    expect(ok.status).toBe("accepted");
    // replay with the same idempotency key does not buy twice
    const replay = await asUser(pool, A, (c) => c.query(`select public.create_offer($1, $2, 'key-ok-00001') r`, [aiPlayer.id, low.counter_amount_cents]).then((r) => r.rows[0].r));
    expect(replay.replayed).toBe(true);
    const p = await q<{ club_id: string }>(`select club_id from game_players where id = $1`, [aiPlayer.id]);
    expect(p[0].club_id).toBe(clubA);
    const cashAfter = (await q<{ cash_cents: string }>(`select cash_cents from game_clubs where id = $1`, [clubA]))[0];
    expect(BigInt(cashBefore.cash_cents) - BigInt(cashAfter.cash_cents)).toBe(BigInt(low.counter_amount_cents));
    expect((await q(`select * from transfer_transactions where player_id = $1`, [aiPlayer.id]))).toHaveLength(1);
  });

  it("reservations prevent overspending with concurrent offers", async () => {
    const cash = BigInt((await q<{ cash_cents: string }>(`select cash_cents - reserved_cents as cash_cents from game_clubs where id = $1`, [clubB]))[0].cash_cents);
    const targets = await q<{ id: string }>(`select id from game_players where club_id = $1 order by current_ovr desc limit 2`, [clubA]);
    const amount = (cash * 7n) / 10n; // each offer 70% of available cash
    const r1 = await asUser(pool, B, (c) => c.query(`select public.create_offer($1, $2, 'key-b-000001') r`, [targets[0].id, amount.toString()]).then((r) => r.rows[0].r));
    expect(r1.status).toBe("pending");
    await expectPgError(asUser(pool, B, (c) => c.query(`select public.create_offer($1, $2, 'key-b-000002')`, [targets[1].id, amount.toString()])), "insufficient_funds");
    await expectPgError(asUser(pool, B, (c) => c.query(`select public.create_offer($1, 20000000, 'key-b-000003')`, [targets[0].id])), "duplicate_offer");
    // B cannot accept its own offer; C cannot see it
    await expectPgError(asUser(pool, B, (c) => c.query(`select public.respond_offer($1, true)`, [r1.offer_id])), "forbidden");
    expect(await asUser(pool, C, (c) => c.query(`select * from transfer_offers`).then((r) => r.rowCount))).toBe(0);
    const res = await asUser(pool, B, (c) => c.query(`select public.cancel_offer($1) r`, [r1.offer_id]).then((r) => r.rows[0].r));
    expect(res.status).toBe("cancelled");
    expect((await q<{ reserved_cents: string }>(`select reserved_cents from game_clubs where id = $1`, [clubB]))[0].reserved_cents).toBe("0");
  });

  it("two simultaneous accepts of competing offers move the player only once", async () => {
    // Carla joins and manages a third club so two humans bid for A's player
    await asUser(pool, C, (c) => c.query(`select public.join_game($1)`, [invite]));
    const clubC = await asUser(pool, C, (c) => c.query(`select id from game_clubs where game_id = $1 and manager_user_id is null order by reputation desc limit 1`, [gameId]).then((r) => r.rows[0].id));
    await asUser(pool, C, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubC]));
    const target = (await q<{ id: string }>(`select id from game_players where club_id = $1 order by current_ovr asc limit 1`, [clubA]))[0];
    const ob = await asUser(pool, B, (c) => c.query(`select public.create_offer($1, 20000000, 'race-key-b01') r`, [target.id]).then((r) => r.rows[0].r));
    const oc = await asUser(pool, C, (c) => c.query(`select public.create_offer($1, 25000000, 'race-key-c01') r`, [target.id]).then((r) => r.rows[0].r));
    const results = await Promise.allSettled([
      asUser(pool, A, (c) => c.query(`select public.respond_offer($1, true) r`, [ob.offer_id]).then((r) => r.rows[0].r)),
      asUser(pool, A, (c) => c.query(`select public.respond_offer($1, true) r`, [oc.offer_id]).then((r) => r.rows[0].r)),
    ]);
    const accepted = results.filter((r) => r.status === "fulfilled" && (r.value as { status: string }).status === "accepted");
    // the losing accept sees the offer already superseded (no deadlock thanks to player->offer->club lock order)
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(accepted).toHaveLength(1);
    expect((await q(`select * from transfer_transactions where offer_id = any($1)`, [[ob.offer_id, oc.offer_id]]))).toHaveLength(1);
    const reserved = await q<{ reserved_cents: string }>(`select reserved_cents from game_clubs where id = any($1)`, [[clubB, clubC]]);
    expect(reserved.every((r) => r.reserved_cents === "0")).toBe(true);
  });

  it("ledger always reconciles with cash and no player belongs to two clubs", async () => {
    const clubs = await q<{ id: string; cash_cents: string }>(`select id, cash_cents from game_clubs where game_id = $1`, [gameId]);
    for (const c of clubs) {
      const l = await q<{ s: string; last: string }>(`select sum(amount_cents)::text s, (select balance_after_cents::text from club_ledger where club_id = $1 order by id desc limit 1) last from club_ledger where club_id = $1`, [c.id]);
      expect(l[0].s).toBe(c.cash_cents);
      expect(l[0].last).toBe(c.cash_cents);
    }
    const dup = await q(`select source_player_id from game_players where game_id = $1 group by 1 having count(*) > 1`, [gameId]);
    expect(dup).toHaveLength(0);
  });
});

describe("season rollover & isolation", () => {
  it("plays the full season, pays prizes, rolls into season 2 with new fixtures", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await processNextMatchday(pool, gameId);
      if (r.season_completed) break;
    }
    const g = await q<{ current_season: number; current_matchday: number }>(`select current_season, current_matchday from games where id = $1`, [gameId]);
    expect(g[0].current_season).toBe(2);
    expect(g[0].current_matchday).toBe(0);
    const s1 = await q<{ status: string; summary_json: { champion_club_id: string } }>(`select status, summary_json from seasons where game_id = $1 and number = 1`, [gameId]);
    expect(s1[0].status).toBe("completed");
    expect(s1[0].summary_json.champion_club_id).toBeTruthy();
    expect((await q(`select * from club_ledger where game_id = $1 and event_type = 'prize_money' and idempotency_key like 'season:%'`, [gameId]))).toHaveLength(6);
    expect((await q(`select * from fixtures f join seasons s on s.id = f.season_id where s.game_id = $1 and s.number = 2`, [gameId]))).toHaveLength(30);
    const prog = await q<{ n: number }>(`select count(*)::int n from player_progression_log where game_id = $1`, [gameId]);
    expect(prog[0].n).toBeGreaterThan(0);
  });

  it("a second league evolves independently from the same snapshot", async () => {
    const other = await createGame(pool, C, { name: "Outra Liga", snapshotId, leagueId, maxManagers: 4, tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: 20, roundIntervalHours: 24 });
    const sp = await q<{ source_player_id: string }>(`select source_player_id from game_players where game_id = $1 limit 1`, [gameId]);
    const rows = await q<{ game_id: string; current_ovr: number; version: number }>(`select game_id, current_ovr, version from game_players where source_player_id = $1`, [sp[0].source_player_id]);
    expect(rows.find((r) => r.game_id === other.gameId)!.version).toBe(1);
    expect(rows.find((r) => r.game_id === gameId)!.version).toBeGreaterThan(1);
    // A (not a member) cannot read the other league
    expect(await asUser(pool, A, (c) => c.query(`select * from game_clubs where game_id = $1`, [other.gameId]).then((r) => r.rowCount))).toBe(0);
    void smallLeagueId;
  });
});
