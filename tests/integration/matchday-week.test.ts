/**
 * Phase 2 "matchday week": training + match plans feed the engine, press conferences (free text + tone) apply bounded
 * effects and show up in O Apito, Gabinete events resolve by choice or by default at kickoff — all server-validated.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { seedSyntheticLeague, SYNTHETIC_ANCHORS } from "../../src/integrations/catalog/synthetic";
import { createGame } from "../../src/server/services/create-game";
import { processNextMatchday } from "../../src/server/services/matchday";
import { ensureWeek, prepareWeek } from "../../src/server/services/week";
import { asUser, createUser, freshDb } from "../support/db";

const DB = "touchline_it_week";
let pool: Pool;
let A: string, B: string, C: string, gameId: string, clubA: string, clubB: string;

beforeAll(async () => {
  pool = freshDb(DB);
  const leagueId = await seedSyntheticLeague(pool, { externalId: "it-week", name: "Liga Semana (fictícia)", clubs: 4 });
  const snap = await buildSnapshot(pool, { provider: "synthetic", leagueExternalIds: ["it-week"], label: "IT week", anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01") });
  A = await createUser(pool, "a@test.dev", "Ana");
  B = await createUser(pool, "b@test.dev", "Bruno");
  C = await createUser(pool, "c@test.dev", "Carla");
  const g = await createGame(pool, A, { name: "Liga Semana", snapshotId: snap.snapshotId, leagueId, maxManagers: 4, tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: 20, roundIntervalHours: 24 });
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

const one = async <T = Record<string, unknown>>(sql: string, args: unknown[]) => (await pool.query(sql, args)).rows[0] as T;

describe("matchday week", () => {
  it("prepares round 1 lazily and only once", async () => {
    await ensureWeek(pool, gameId);
    const n = await one<{ n: string }>(`select count(*) n from press_conferences where game_id = $1 and round = 1`, [gameId]);
    expect(Number(n.n)).toBe(2); // two humans, everyone plays in a 4-club round
    expect((await prepareWeek(pool, gameId, 1, 1)).prepared).toBe(false);
    const q = await one<{ questions: { key: string; text: string }[] }>(`select questions from press_conferences where club_id = $1`, [clubA]);
    expect(q.questions).toHaveLength(3);
    const note = await one<{ n: string }>(`select count(*) n from notifications where user_id = $1 and type = 'week_ready'`, [A]);
    expect(Number(note.n)).toBe(1);
  });

  it("validates training and match plans", async () => {
    await asUser(pool, A, (c) => c.query(`select public.save_training_plan($1, 'intense', 'attack')`, [gameId]));
    await expect(asUser(pool, A, (c) => c.query(`select public.save_training_plan($1, 'brutal', 'attack')`, [gameId]))).rejects.toThrow(/inválido/);
    const mine = (await pool.query(`select id from game_players where club_id = $1 order by current_ovr desc limit 2`, [clubA])).rows.map((r) => r.id);
    const fx = await one<{ home_club_id: string; away_club_id: string }>(
      `select f.home_club_id, f.away_club_id from fixtures f where f.game_id = $1 and f.round_number = 1 and $2 in (f.home_club_id, f.away_club_id)`, [gameId, clubA]);
    const oppId = fx.home_club_id === clubA ? fx.away_club_id : fx.home_club_id;
    const theirs = (await pool.query(`select id from game_players where club_id = $1 order by current_ovr desc limit 2`, [oppId])).rows.map((r) => r.id);
    await expect(asUser(pool, A, (c) => c.query(`select public.save_match_plan($1, '[]', $2)`, [gameId, JSON.stringify(mine)]))).rejects.toThrow(/adversários/);
    await expect(asUser(pool, A, (c) => c.query(`select public.save_match_plan($1, $2, '[]')`, [gameId, JSON.stringify([{ minute: 30, when: "losing", mentality: "attacking" }])]))).rejects.toThrow(/inválida/);
    await asUser(pool, A, (c) => c.query(`select public.save_match_plan($1, $2, $3)`, [gameId,
      JSON.stringify([{ minute: 65, when: "losing", mentality: "attacking" }]), JSON.stringify(theirs)]));
    // plans are private
    const asB = await asUser(pool, B, (c) => c.query(`select count(*) n from match_plans where club_id = $1`, [clubA]));
    expect(Number(asB.rows[0].n)).toBe(0);
  });

  it("press: validates, applies morale, is private until answered", async () => {
    const pc = await one<{ id: string; questions: { key: string }[] }>(`select id, questions from press_conferences where club_id = $1`, [clubA]);
    const beforeB = await asUser(pool, B, (c) => c.query(`select count(*) n from press_conferences where id = $1`, [pc.id]));
    expect(Number(beforeB.rows[0].n)).toBe(0);
    const answers = pc.questions.map((q, i) => ({ key: q.key, tone: i === 0 ? "confident" : "calm", text: i === 0 ? "Vamos ganhar este jogo, sem dúvida." : "Respeito total." }));
    await expect(asUser(pool, B, (c) => c.query(`select public.answer_press($1, $2)`, [pc.id, JSON.stringify(answers)]))).rejects.toThrow(/inexistente/);
    await expect(asUser(pool, A, (c) => c.query(`select public.answer_press($1, $2)`, [pc.id, JSON.stringify([{ ...answers[0], text: "x".repeat(281) }, ...answers.slice(1)])]))).rejects.toThrow(/280/);
    const m0 = await one<{ m: string }>(`select avg(morale) m from game_players where club_id = $1`, [clubA]);
    const eff = (await asUser(pool, A, (c) => c.query(`select public.answer_press($1, $2) r`, [pc.id, JSON.stringify(answers)]))).rows[0].r;
    expect(eff).toMatchObject({ morale: 3, own_control: 0.15, opp_control: 0, calm: true });
    const m1 = await one<{ m: string }>(`select avg(morale) m from game_players where club_id = $1`, [clubA]);
    expect(Number(m1.m)).toBeGreaterThan(Number(m0.m));
    await expect(asUser(pool, A, (c) => c.query(`select public.answer_press($1, $2)`, [pc.id, JSON.stringify(answers)]))).rejects.toThrow(/Já respondeste/);
    const afterB = await asUser(pool, B, (c) => c.query(`select count(*) n from press_conferences where id = $1`, [pc.id]));
    expect(Number(afterB.rows[0].n)).toBe(1);
    const afterC = await asUser(pool, C, (c) => c.query(`select count(*) n from press_conferences where id = $1`, [pc.id]));
    expect(Number(afterC.rows[0].n)).toBe(0);
  });

  it("Gabinete: answer applies effects once; unanswered events default at kickoff; internals are service-only", async () => {
    const choices = (cash: number) => JSON.stringify([
      { label: "Sim", detail: "", effects: [{ type: "cash", delta_cents: cash, reason: "teste" }] },
      { label: "Não", detail: "", effects: [{ type: "morale", scope: "squad", delta: -2 }] },
    ]);
    const e1 = await one<{ id: string }>(
      `insert into inbox_events (game_id, club_id, season, round, key, title, body, choices, default_choice, deadline_round)
       values ($1, $2, 1, 1, 'it_cash', 'T', 'B', $3, 1, 1) returning id`, [gameId, clubA, choices(1_000_000)]);
    const e2 = await one<{ id: string }>(
      `insert into inbox_events (game_id, club_id, season, round, key, title, body, choices, default_choice, deadline_round)
       values ($1, $2, 1, 1, 'it_default', 'T', 'B', $3, 0, 1) returning id`, [gameId, clubA, choices(500_000)]);
    await expect(asUser(pool, B, (c) => c.query(`select public.answer_inbox_event($1, 0)`, [e1.id]))).rejects.toThrow(/inexistente/);
    await expect(asUser(pool, A, (c) => c.query(`select public.answer_inbox_event($1, 5)`, [e1.id]))).rejects.toThrow(/inválida/);
    await asUser(pool, A, (c) => c.query(`select public.answer_inbox_event($1, 0)`, [e1.id]));
    const again = (await asUser(pool, A, (c) => c.query(`select public.answer_inbox_event($1, 1) r`, [e1.id]))).rows[0].r;
    expect(again.status).toBe("already");
    const led = await one<{ n: string; s: string }>(`select count(*) n, sum(amount_cents) s from club_ledger where club_id = $1 and idempotency_key like 'event:%'`, [clubA]);
    expect(Number(led.n)).toBe(1);
    expect(Number(led.s)).toBe(1_000_000);
    await expect(asUser(pool, A, (c) => c.query(`select public.resolve_due_events($1, 1)`, [gameId]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, A, (c) => c.query(`select public._apply_effects($1, $2, '[]', 'x')`, [gameId, clubA]))).rejects.toThrow(/permission denied/);

    await processNextMatchday(pool, gameId, { requestId: "week-1" });
    const r2 = await one<{ resolution: string; chosen: number }>(`select resolution, chosen from inbox_events where id = $1`, [e2.id]);
    expect(r2).toEqual({ resolution: "default", chosen: 0 });
    const open = await one<{ n: string }>(`select count(*) n from inbox_events where game_id = $1 and round = 1 and resolved_at is null`, [gameId]);
    expect(Number(open.n)).toBe(0);
  });

  it("the match used the plans, and the newspaper quotes the manager", async () => {
    type Side = { club_id: string; modifiers?: unknown; marking?: string[]; plans?: unknown };
    const run = await one<{ input_snapshot: { home: Side; away: Side } }>(
      `select r.input_snapshot from match_runs r join fixtures f on f.id = r.fixture_id
        where f.game_id = $1 and f.round_number = 1 and $2 in (f.home_club_id, f.away_club_id)`, [gameId, clubA]);
    const side = run.input_snapshot.home.club_id === clubA ? run.input_snapshot.home : run.input_snapshot.away;
    expect(side.modifiers).toEqual({ attack: 1.5, control: 0.15 });
    expect(side.marking?.length).toBe(2);
    expect(side.plans).toEqual([{ minute: 65, when: "losing", mentality: "attacking" }]);
    const press = await one<{ n: string }>(`select count(*) n from news_items where game_id = $1 and round = 1 and kind = 'press' and body like '%Vamos ganhar este jogo%'`, [gameId]);
    expect(Number(press.n)).toBe(1);
    // the next round is prepared right after the matchday
    const next = await one<{ n: string }>(`select count(*) n from press_conferences where game_id = $1 and round = 2`, [gameId]);
    expect(Number(next.n)).toBe(2);
  });
});
