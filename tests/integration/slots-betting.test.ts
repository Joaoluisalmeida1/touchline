/**
 * Roleta (slots-v1), duels and betting (betting-v1) against real Postgres: costs and the jackpot pot, daily limit and
 * free spins, every effect (cash, players, skins, cards, injuries, fines, −1 point, shield), cards after a round,
 * duels moving the stake, bets on the next round (never your own match) settled after the matchday.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { seedSyntheticLeague, SYNTHETIC_ANCHORS } from "../../src/integrations/catalog/synthetic";
import { createGame } from "../../src/server/services/create-game";
import { processNextMatchday } from "../../src/server/services/matchday";
import { acceptDuel, applyCards, placeBet, spin } from "../../src/server/services/fun";
import { JACKPOT_BASE_CENTS, SPIN_COST_CENTS } from "../../src/engine/slots/slots";
import { asUser, createUser, freshDb } from "../support/db";

const DB = "touchline_it_fun";
let pool: Pool;
let A: string, B: string, gameId: string, clubA: string, clubB: string;

beforeAll(async () => {
  pool = freshDb(DB);
  const home = await seedSyntheticLeague(pool, { externalId: "it-fun-home", name: "Liga Sorte (fictícia)", clubs: 6 });
  await seedSyntheticLeague(pool, { externalId: "it-fun-away", name: "Liga Fora (fictícia)", clubs: 4 });
  const snap = await buildSnapshot(pool, { provider: "synthetic", leagueExternalIds: ["it-fun-home", "it-fun-away"], label: "IT fun", anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01") });
  A = await createUser(pool, "a@test.dev", "Ana");
  B = await createUser(pool, "b@test.dev", "Bruno");
  const g = await createGame(pool, A, { name: "Liga Sorte", snapshotId: snap.snapshotId, leagueId: home, maxManagers: 4, tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: 20, roundIntervalHours: 24 });
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
const cash = async (club: string) => Number((await pool.query(`select cash_cents from game_clubs where id = $1`, [club])).rows[0].cash_cents);
const pot = async () => Number((await pool.query(`select pot_cents from slots_pots where game_id = $1`, [gameId])).rows[0].pot_cents);
const as = (u: string, sql: string, args: unknown[]) => asUser(pool, u, (c) => c.query(sql, args));

describe("roleta", () => {
  it("costs €500k, feeds the jackpot, pays cash prizes and has no daily limit", async () => {
    const before = await cash(clubA);
    const out = await spin(pool, A, gameId, { prize: "cash_mid" });
    expect(out.reels.length).toBe(3);
    expect(await cash(clubA)).toBe(before - SPIN_COST_CENTS + out.amount_cents!);
    expect(await pot()).toBe(JACKPOT_BASE_CENTS + SPIN_COST_CENTS * 0.2);
    for (let i = 1; i < 8; i++) await spin(pool, A, gameId, { prize: "cash_small" });
    // a free-spin card costs nothing
    await pool.query(`insert into slot_cards (game_id, club_id, kind) values ($1, $2, 'free_spin')`, [gameId, clubA]);
    const c0 = await cash(clubA);
    const free = await spin(pool, A, gameId, { prize: "morale" });
    expect(free.free).toBe(true);
    expect(await cash(clubA)).toBe(c0);
    expect(await n(`select count(*) n from slot_spins where club_id = $1`, [clubA])).toBe(9);
  });

  it("player, skin, cards and jackpot prizes", async () => {
    const squad = await n(`select count(*) n from game_players where club_id = $1`, [clubB]);
    const p = await spin(pool, B, gameId, { prize: "player" });
    expect(p.player?.id).toBeTruthy();
    expect(await n(`select count(*) n from game_players where club_id = $1`, [clubB])).toBe(squad + 1);

    const s1 = await spin(pool, B, gameId, { prize: "skin_legendary" });
    expect(s1.skin).toMatch(/chama|relampago/);
    await as(B, `select public.equip_skin($1, $2)`, [gameId, s1.skin]);
    expect((await pool.query(`select crest_skin from game_clubs where id = $1`, [clubB])).rows[0].crest_skin).toBe(s1.skin);
    await expect(as(A, `select public.equip_skin($1, 'ouro')`, [gameId])).rejects.toThrow(/Ainda não tens/);

    await spin(pool, B, gameId, { prize: "card_gate" });
    expect(await n(`select count(*) n from slot_cards where club_id = $1 and kind = 'gate' and status = 'held'`, [clubB])).toBe(1);

    const potNow = await pot();
    const c0 = await cash(clubB);
    const j = await spin(pool, B, gameId, { prize: "jackpot" });
    expect(j.amount_cents).toBe(potNow + SPIN_COST_CENTS * 0.2);
    expect(await cash(clubB)).toBe(c0 - SPIN_COST_CENTS + j.amount_cents!);
    expect(await pot()).toBe(JACKPOT_BASE_CENTS);
    expect(await n(`select count(*) n from notifications where game_id = $1 and type = 'jackpot'`, [gameId])).toBe(2);
    expect(await n(`select count(*) n from wall_posts where game_id = $1 and kind = 'slots'`, [gameId])).toBeGreaterThanOrEqual(2);
  });

  it("punishments: injury, fine into the pot, −1 point only when the owner allows it, and the shield", async () => {
    // B already used 4 paid spins today; reset the day for B by moving them to yesterday
    await pool.query(`update slot_spins set spun_on = spun_on - 1 where club_id = $1`, [clubB]);
    const inj = await spin(pool, B, gameId, { prize: "injury" });
    expect(inj.detail).toMatch(/lesionou-se|lesionados/);
    expect(await n(`select count(*) n from game_players where club_id = $1 and injured_matches > 0`, [clubB])).toBeGreaterThanOrEqual(1);

    const p0 = await pot();
    const fine = await spin(pool, B, gameId, { prize: "fine" });
    expect(await pot()).toBe(p0 + SPIN_COST_CENTS * 0.2 - fine.amount_cents!);

    const pts = async () => n(`select st.points n from standings st join seasons s on s.id = st.season_id where s.game_id = $1 and st.club_id = $2`, [gameId, clubB]);
    const before = await pts();
    await spin(pool, B, gameId, { prize: "point" });
    expect(await pts()).toBe(before - 1);

    await pool.query(`insert into slot_cards (game_id, club_id, kind) values ($1, $2, 'shield')`, [gameId, clubB]);
    await pool.query(`update slot_spins set spun_on = spun_on - 1 where club_id = $1`, [clubB]);
    const sh = await spin(pool, B, gameId, { prize: "point" });
    expect(sh.shielded).toBe(true);
    expect(await pts()).toBe(before - 1);

    await expect(as(B, `select public.set_fun_settings($1, false, true, true)`, [gameId])).rejects.toThrow(/criador/);
    await as(A, `select public.set_fun_settings($1, true, false, true)`, [gameId]);
    expect((await pool.query(`select settings_json s from games where id = $1`, [gameId])).rows[0].s.slots_point_penalty).toBe(false);
  });

  it("cards played for a round: immunity heals that round's injuries, gate doubles the home gate", async () => {
    const g = (await pool.query(`select current_season s, current_matchday m from games where id = $1`, [gameId])).rows[0];
    const card = (await pool.query(`insert into slot_cards (game_id, club_id, kind) values ($1, $2, 'immunity') returning id`, [gameId, clubA])).rows[0].id;
    await as(A, `select public.activate_card($1)`, [card]);
    const victim = (await pool.query(`select id from game_players where club_id = $1 limit 1`, [clubA])).rows[0].id;
    await pool.query(`update game_players set injured_matches = 2 where id = $1`, [victim]);
    const gate = (await pool.query(`select id from slot_cards where club_id = $1 and kind = 'gate' and status = 'held'`, [clubB])).rows[0].id;
    await as(B, `select public.activate_card($1)`, [gate]);
    await pool.query(`select public._ledger($1, $2, 'gate_receipts', 30000000, 'x', 'test-gate', $3, $4)`, [gameId, clubB, g.s, g.m + 1]);
    const c0 = await cash(clubB);
    await applyCards(pool, gameId, g.s, g.m + 1);
    expect((await pool.query(`select injured_matches i from game_players where id = $1`, [victim])).rows[0].i).toBe(0);
    expect(await cash(clubB)).toBe(c0 + 30_000_000);
    expect(await n(`select count(*) n from slot_cards where id in ($1, $2) and status = 'used'`, [card, gate])).toBe(2);
  });

  it("duels move the stake between the two managers", async () => {
    const d = (await as(A, `select public.create_duel($1, $2) id`, [gameId, clubB])).rows[0].id;
    expect(Number((await pool.query(`select reserved_cents r from game_clubs where id = $1`, [clubA])).rows[0].r)).toBeGreaterThanOrEqual(SPIN_COST_CENTS);
    await expect(acceptDuel(pool, A, gameId, d)).rejects.toThrow(/inexistente/);
    const a0 = await cash(clubA), b0 = await cash(clubB);
    const r = await acceptDuel(pool, B, gameId, d);
    const da = (await cash(clubA)) - a0, db = (await cash(clubB)) - b0;
    if (r.winner === "draw") expect([da, db]).toEqual([0, 0]);
    else expect(da + db).toBe(0);
    expect(Number((await pool.query(`select reserved_cents r from game_clubs where id = $1`, [clubA])).rows[0].r)).toBe(0);
  });
});

describe("apostas", () => {
  it("bets on the next round (not your own match), settled after the matchday", async () => {
    const g = (await pool.query(`select current_season s, current_matchday m from games where id = $1`, [gameId])).rows[0];
    const fx = (await pool.query(
      `select f.id, f.home_club_id h, f.away_club_id a from fixtures f join seasons s on s.id = f.season_id
        where s.game_id = $1 and s.number = $2 and f.round_number = $3`, [gameId, g.s, g.m + 1])).rows;
    const own = fx.find((f) => f.h === clubA || f.a === clubA)!;
    const other = fx.find((f) => f.h !== clubA && f.a !== clubA)!;
    await expect(placeBet(pool, A, gameId, own.id, "1", 1_000_000, randomUUID())).rejects.toThrow(/teu próprio jogo/);
    await expect(placeBet(pool, A, gameId, other.id, "1", 1, randomUUID())).rejects.toThrow(/mínima/);
    await expect(placeBet(pool, A, gameId, other.id, "1", 10 ** 15, randomUUID())).rejects.toThrow(/disponível/);
    const c0 = await cash(clubA);
    const key = randomUUID();
    const picks = ["1", "X", "2"] as const;
    for (const p of picks) await placeBet(pool, A, gameId, other.id, p, 10_000_000, p === "1" ? key : randomUUID());
    expect((await placeBet(pool, A, gameId, other.id, "1", 10_000_000, key)).replayed).toBe(true);
    expect(await cash(clubA)).toBe(c0 - 30_000_000);

    await processNextMatchday(pool, gameId, { requestId: "fun-1" });
    const bets = (await pool.query(`select status, payout_cents p, stake_cents s, odds from bets where fixture_id = $1`, [other.id])).rows;
    expect(bets.filter((b) => b.status === "won")).toHaveLength(1);
    expect(bets.filter((b) => b.status === "lost")).toHaveLength(2);
    const w = bets.find((b) => b.status === "won")!;
    expect(Number(w.p)).toBe(Math.round(Number(w.s) * Number(w.odds)));
    // a round already played can't take bets any more
    await expect(placeBet(pool, A, gameId, other.id, "1", 1_000_000, randomUUID())).rejects.toThrow(/próxima jornada/);
  });
});
