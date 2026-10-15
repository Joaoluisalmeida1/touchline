/**
 * Squad revamp (migration 0010 / engine match-v1.1.0) on a real Postgres:
 * roles + instructions validation, preferred slot (once per season), shirt numbers, presets,
 * and positional familiarity learned through matchday processing. FICTIONAL synthetic data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { seedSyntheticLeague, SYNTHETIC_ANCHORS } from "../../src/integrations/catalog/synthetic";
import { createGame } from "../../src/server/services/create-game";
import { processNextMatchday } from "../../src/server/services/matchday";
import { asUser, createUser, expectPgError, freshDb } from "../support/db";

let pool: Pool;
let A: string, B: string;
let gameId: string, clubA: string, clubB: string;
type P = { id: string; position_group: string };
let squad: P[];

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

function xi(formation: string, slots: string[], roles: Record<string, string> = {}) {
  const gk = squad.find((p) => p.position_group === "GK")!;
  const by = (g: string) => squad.filter((p) => p.position_group === g && p.id !== gk.id);
  const pools: Record<string, P[]> = { DEF: by("DEF"), MID: by("MID"), ATT: by("ATT") };
  const group = (s: string) => (s === "GK" ? "GK" : ["LB", "CB", "RB", "LWB", "RWB"].includes(s) ? "DEF" : ["LW", "RW", "ST"].includes(s) ? "ATT" : "MID");
  const used = new Set<string>();
  const starters = slots.map((slot) => {
    const g = group(slot);
    const p = g === "GK" ? gk : pools[g].find((x) => !used.has(x.id)) ?? squad.find((x) => !used.has(x.id) && x.id !== gk.id)!;
    used.add(p.id);
    return { player_id: p.id, slot, ...(roles[slot] ? { role: roles[slot] } : {}) };
  });
  const bench = squad.filter((p) => !used.has(p.id)).slice(0, 7).map((p) => p.id);
  return { formation, starters, bench };
}

beforeAll(async () => {
  pool = freshDb("touchline_it_squad");
  await seedSyntheticLeague(pool, { externalId: "sq-liga", name: "Liga Plantel (fictícia)", clubs: 4 });
  const snap = await buildSnapshot(pool, { provider: "synthetic", leagueExternalIds: ["sq-liga"], label: "SQ", anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01") });
  const lg = await q<{ id: string }>(`select id from source_leagues where external_id = 'sq-liga'`);
  A = await createUser(pool, "sa@test.dev", "Sara");
  B = await createUser(pool, "sb@test.dev", "Beto");
  const g = await createGame(pool, A, { name: "Liga Plantel", snapshotId: snap.snapshotId, leagueId: lg[0].id, maxManagers: 4, tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: 20, roundIntervalHours: 24 });
  gameId = g.gameId;
  await asUser(pool, B, (c) => c.query(`select public.join_game($1)`, [g.inviteCode]));
  const clubs = await q<{ id: string }>(`select id from game_clubs where game_id = $1 order by reputation desc`, [gameId]);
  clubA = clubs[0].id;
  clubB = clubs[1].id;
  await asUser(pool, A, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubA]));
  await asUser(pool, B, (c) => c.query(`select public.select_club($1, $2)`, [gameId, clubB]));
  squad = await q<P>(`select id, position_group from game_players where club_id = $1 order by current_ovr desc, id`, [clubA]);
});
afterAll(async () => pool.end());

describe("lineup v2: new formations, roles and instructions", () => {
  it("accepts every new formation with valid roles and stores captain/takers", async () => {
    const l = xi("3-4-2-1", ["GK", "CB", "CB", "CB", "LWB", "CM", "CM", "RWB", "AM", "AM", "ST"], { AM: "am_shadow", ST: "st_false9", CB: "cb_ballplaying" });
    const ins = { captain: l.starters[1].player_id, penalty_taker: l.starters[10].player_id, corner_taker: l.bench[0] };
    await asUser(pool, A, (c) => c.query(`select public.save_lineup_v2($1,$2,$3,$4,$5)`, [gameId, l.formation, JSON.stringify(l.starters), JSON.stringify(l.bench), JSON.stringify(ins)]));
    const row = await q<{ formation: string; instructions_json: Record<string, string>; starters_json: { role?: string }[] }>(
      `select formation, instructions_json, starters_json from lineups where club_id = $1 and fixture_id is null`, [clubA]);
    expect(row[0].formation).toBe("3-4-2-1");
    expect(row[0].instructions_json.captain).toBe(ins.captain);
    expect(row[0].starters_json.filter((s) => s.role === "am_shadow")).toHaveLength(2);
    const t = await q<{ formation: string }>(`select formation from tactics where club_id = $1`, [clubA]);
    expect(t[0]?.formation ?? "3-4-2-1").toBe("3-4-2-1");
  });

  it("rejects roles that do not fit the slot and instructions pointing outside the squad", async () => {
    const bad = xi("4-4-2", ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"], { CB: "st_false9" });
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.save_lineup_v2($1,$2,$3,$4,'{}')`, [gameId, bad.formation, JSON.stringify(bad.starters), JSON.stringify(bad.bench)])), "invalid_role");
    const ok = xi("4-4-2", ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"]);
    const outsider = squad.find((p) => !ok.starters.some((s) => s.player_id === p.id) && !ok.bench.includes(p.id));
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.save_lineup_v2($1,$2,$3,$4,$5)`, [gameId, ok.formation, JSON.stringify(ok.starters), JSON.stringify(ok.bench), JSON.stringify({ captain: ok.bench[0] })])), "invalid_instructions");
    if (outsider) await expectPgError(asUser(pool, A, (c) => c.query(`select public.save_lineup_v2($1,$2,$3,$4,$5)`, [gameId, ok.formation, JSON.stringify(ok.starters), JSON.stringify(ok.bench), JSON.stringify({ penalty_taker: outsider.id })])), "invalid_instructions");
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.save_lineup_v2($1,$2,$3,$4,$5)`, [gameId, ok.formation, JSON.stringify(ok.starters), JSON.stringify(ok.bench), JSON.stringify({ hacker: "x" })])), "invalid_instructions");
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.save_tactics($1, $2)`, [gameId, JSON.stringify({ formation: "2-2-6" })])), "invalid_tactics");
  });
});

describe("player management", () => {
  it("preferred slot: only compatible positions, once per season, not for other clubs", async () => {
    const def = squad.find((p) => p.position_group === "DEF")!;
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.set_preferred_slot($1,'ST')`, [def.id])), "invalid_slot");
    await asUser(pool, A, (c) => c.query(`select public.set_preferred_slot($1,'LB')`, [def.id]));
    await asUser(pool, A, (c) => c.query(`select public.set_preferred_slot($1,'LB')`, [def.id])); // same value: no-op
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.set_preferred_slot($1,'RB')`, [def.id])), "already_set");
    await expectPgError(asUser(pool, B, (c) => c.query(`select public.set_preferred_slot($1,'CB')`, [def.id])), "forbidden");
    const seen = await asUser(pool, B, (c) => c.query(`select preferred_slot from game_players where id = $1`, [def.id]).then((r) => r.rows[0]));
    expect(seen.preferred_slot).toBe("LB"); // visible to league members, like the rest of the squad
  });

  it("shirt numbers are unique per club, auto-numbering fills the rest, transfers reset them", async () => {
    await asUser(pool, A, (c) => c.query(`select public.set_shirt_number($1, 10)`, [squad[0].id]));
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.set_shirt_number($1, 10)`, [squad[1].id])), "number_taken");
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.set_shirt_number($1, 100)`, [squad[1].id])), "invalid_number");
    const n = await asUser(pool, A, (c) => c.query(`select public.auto_number_squad($1) n`, [gameId]).then((r) => r.rows[0].n));
    expect(n).toBe(squad.length - 1);
    const nums = await q<{ shirt_number: number }>(`select shirt_number from game_players where club_id = $1`, [clubA]);
    expect(nums.every((x) => x.shirt_number >= 1 && x.shirt_number <= 99)).toBe(true);
    expect(new Set(nums.map((x) => x.shirt_number)).size).toBe(nums.length);
    await pool.query(`update game_players set club_id = $2 where id = $1`, [squad[squad.length - 1].id, clubB]);
    const moved = await q<{ shirt_number: number | null }>(`select shirt_number from game_players where id = $1`, [squad[squad.length - 1].id]);
    expect(moved[0].shirt_number).toBeNull();
    await pool.query(`update game_players set club_id = $2 where id = $1`, [squad[squad.length - 1].id, clubA]);
  });

  it("tactic presets: upsert by name, private to the club, max 8, archivable", async () => {
    const payload = { formation: "4-2-3-1", tactics: { pressing: "high" } };
    const id1 = await asUser(pool, A, (c) => c.query(`select public.save_tactic_preset($1,'Casa',$2) id`, [gameId, JSON.stringify(payload)]).then((r) => r.rows[0].id));
    const id2 = await asUser(pool, A, (c) => c.query(`select public.save_tactic_preset($1,'casa',$2) id`, [gameId, JSON.stringify({ ...payload, formation: "5-4-1" })]).then((r) => r.rows[0].id));
    expect(id2).toBe(id1);
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.save_tactic_preset($1,'X','{"formation":"9-9-9"}')`, [gameId])), "invalid_preset");
    for (let i = 0; i < 7; i++) await asUser(pool, A, (c) => c.query(`select public.save_tactic_preset($1,$2,$3)`, [gameId, `P${i}`, JSON.stringify(payload)]));
    await expectPgError(asUser(pool, A, (c) => c.query(`select public.save_tactic_preset($1,'Nona',$2)`, [gameId, JSON.stringify(payload)])), "too_many_presets");
    expect(await asUser(pool, B, (c) => c.query(`select * from tactic_presets`).then((r) => r.rowCount))).toBe(0);
    await expectPgError(asUser(pool, B, (c) => c.query(`select public.archive_tactic_preset($1)`, [id1])), "not_found");
    await asUser(pool, A, (c) => c.query(`select public.archive_tactic_preset($1)`, [id1]));
    await asUser(pool, A, (c) => c.query(`select public.save_tactic_preset($1,'Nona',$2)`, [gameId, JSON.stringify(payload)]));
    await expectPgError(asUser(pool, A, (c) => c.query(`insert into tactic_presets (game_id, club_id, name, payload) values ($1,$2,'x','{}')`, [gameId, clubA])), /permission denied/);
  });
});

describe("matchday with v1.1 lineups", () => {
  it("plays with roles/instructions and learns positional familiarity", async () => {
    await asUser(pool, A, (c) => c.query(`select public.start_game($1)`, [gameId]));
    const r = await processNextMatchday(pool, gameId);
    expect(r.status).toBe("processed");
    const run = await q<{ simulation_version: string; input_snapshot: { home: { club_id: string; instructions?: unknown }; away: { club_id: string; instructions?: unknown } } }>(
      `select mr.simulation_version, mr.input_snapshot from match_runs mr join fixtures f on f.id = mr.fixture_id where f.game_id = $1 and (f.home_club_id = $2 or f.away_club_id = $2)`, [gameId, clubA]);
    expect(run[0].simulation_version).toBe("match-v1.1.0");
    const mine = run[0].input_snapshot.home.club_id === clubA ? run[0].input_snapshot.home : run[0].input_snapshot.away;
    expect(mine.instructions).toBeTruthy();
    const fam = await q<{ position_familiarity: Record<string, number> }>(
      `select p.position_familiarity from game_players p join match_player_stats s on s.game_player_id = p.id
        where p.club_id = $1 and s.minutes >= 60 limit 3`, [clubA]);
    expect(fam.length).toBeGreaterThan(0);
    for (const f of fam) expect(Object.values(f.position_familiarity).some((v) => v > 0)).toBe(true);
  });
});
