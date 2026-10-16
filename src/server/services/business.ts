/**
 * Phase 3 "club business" orchestration (business-v1). All writes run on the service connection, are idempotent and
 * guarded by markers in game_events so a re-run (lazy page load, cron retry) never rolls the dice twice:
 *  - ensureBusiness: first-time setup (stadium + starting staff) and per-season setup (board, budgets, staff pool,
 *    sponsor offers; AI clubs sign the safe offer immediately);
 *  - resolveSponsorDefaults: before a matchday, unanswered sponsor slots take the safe offer;
 *  - afterRound: fan mood, board confidence and board warnings after a processed round.
 */
import type { Pool, PoolClient } from "pg";
import {
  BOARD, baseCapacity, boardObjective, effectiveBudgets, expectedPoints, nextConfidence, nextFanMood, objectiveMet,
  safeOffer, seasonBudgets, sponsorOffers, staffPool, startingStaff, type Objective, type Slot, type SponsorOffer, type TicketPrice,
} from "../../engine/economy/business";
import { asService } from "../pg";

const SLOTS: Slot[] = ["main", "stadium", "sleeve", "kit"];

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return asService(pool, async (c) => {
    await c.query("begin");
    try {
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  });
}

async function marker(c: PoolClient, gameId: string, season: number, round: number, kind: string, key: string): Promise<boolean> {
  const r = await c.query(
    `insert into public.game_events (game_id, season, round, kind, key, payload) values ($1,$2,$3,$4,$5,'{}'::jsonb)
     on conflict (game_id, season, round, kind, key) do nothing returning id`, [gameId, season, round, kind, key]);
  return !!r.rowCount;
}

interface ClubRow { id: string; reputation: number; strength: string; cash_cents: string; manager_user_id: string | null }

export async function ensureBusiness(pool: Pool, gameId: string): Promise<void> {
  const g = await asService(pool, async (c) => (await c.query<{ status: string; current_season: number; current_matchday: number }>(
    `select status, current_season, current_matchday from public.games where id = $1`, [gameId])).rows[0]);
  if (!g || g.status !== "active") return;
  const S = g.current_season;
  await tx(pool, async (c) => {
    if (!(await marker(c, gameId, S, 0, "business_season", "setup"))) return;
    const clubs = (await c.query<ClubRow>(
      `select id, reputation, strength, cash_cents, manager_user_id from public.game_clubs where game_id = $1 order by strength desc, id`, [gameId])).rows;
    const n = clubs.length;
    for (const [i, club] of clubs.entries()) {
      // first time: stadium + starting staff
      const b = await c.query(
        `insert into public.club_business (club_id, game_id, base_capacity) values ($1,$2,$3) on conflict (club_id) do nothing returning club_id`,
        [club.id, gameId, baseCapacity(club.reputation)]);
      if (b.rowCount) {
        for (const s of startingStaff({ gameId, clubId: club.id, reputation: club.reputation })) {
          await c.query(
            `insert into public.club_staff (game_id, club_id, role, name, level, wage_cents, hired_season) values ($1,$2,$3,$4,$5,$6,$7)
             on conflict do nothing`, [gameId, club.id, s.role, s.name, s.level, s.wage_cents, S]);
        }
      }
      // board: objective, confidence carried from last season, budgets
      const prev = (await c.query<{ confidence: number; objective: Objective; final_position: number | null }>(
        `select confidence, objective, final_position from public.board_state where club_id = $1 and season = $2`, [club.id, S - 1])).rows[0];
      let confidence = 60;
      if (prev) confidence = Math.round(60 + (prev.confidence - 60) * 0.5 + (prev.final_position ? (objectiveMet(prev.objective, prev.final_position) ? 10 : -10) : 0));
      confidence = Math.max(10, Math.min(95, confidence));
      const objective = boardObjective(i + 1, n);
      const wageBill = Number((await c.query(
        `select coalesce(sum(wage_cents), 0) w from public.game_players where club_id = $1`, [club.id])).rows[0].w)
        + Number((await c.query(`select coalesce(sum(wage_cents), 0) w from public.club_staff where club_id = $1 and active`, [club.id])).rows[0].w);
      const budgets = seasonBudgets(Number(club.cash_cents), wageBill, confidence);
      await c.query(
        `insert into public.board_state (club_id, season, game_id, objective, confidence, base_transfer_cents, base_wage_cents)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (club_id, season) do nothing`,
        [club.id, S, gameId, JSON.stringify(objective), confidence, budgets.transfer, budgets.wage]);
      // staff market for the season
      for (const s of staffPool({ gameId, season: S, clubId: club.id, reputation: club.reputation })) {
        await c.query(
          `insert into public.staff_candidates (game_id, club_id, season, role, name, level, wage_cents) values ($1,$2,$3,$4,$5,$6,$7)
           on conflict do nothing`, [gameId, club.id, S, s.role, s.name, s.level, s.wage_cents]);
      }
      // sponsors for slots without a deal covering this season
      const covered = new Set((await c.query<{ slot: Slot }>(
        `select slot from public.sponsor_deals where club_id = $1 and start_season <= $2 and end_season >= $2`, [club.id, S])).rows.map((r) => r.slot));
      const open = SLOTS.filter((s) => !covered.has(s));
      if (!open.length) continue;
      const offers = sponsorOffers({ gameId, season: S, clubId: club.id, reputation: club.reputation, target: objective.target, slots: open });
      const ids = new Map<SponsorOffer, string>();
      for (const o of offers) {
        const r = await c.query<{ id: string }>(
          `insert into public.sponsor_offers (game_id, club_id, season, slot, brand, kind, base_cents, win_bonus_cents, clause, seasons, deadline_round)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (club_id, season, slot, brand) do nothing returning id`,
          [gameId, club.id, S, o.slot, o.brand, o.kind, o.base_cents, o.win_bonus_cents, o.clause ? JSON.stringify(o.clause) : null, o.seasons, g.current_matchday + 1]);
        if (r.rows[0]) ids.set(o, r.rows[0].id);
      }
      if (!club.manager_user_id) {
        for (const slot of open) {
          const o = safeOffer(offers, slot);
          if (o && ids.get(o)) await signOffer(c, ids.get(o)!, S, "ai");
        }
      }
    }
  });
}

async function signOffer(c: PoolClient, offerId: string, season: number, by: "ai" | "default") {
  const o = (await c.query(`select * from public.sponsor_offers where id = $1 and status = 'open'`, [offerId])).rows[0];
  if (!o) return;
  const exists = await c.query(`select 1 from public.sponsor_deals where club_id = $1 and slot = $2 and start_season <= $3 and end_season >= $3`, [o.club_id, o.slot, season]);
  if (exists.rowCount) return;
  await c.query(
    `insert into public.sponsor_deals (game_id, club_id, offer_id, slot, brand, kind, base_cents, win_bonus_cents, clause, start_season, end_season, signed_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict do nothing`,
    [o.game_id, o.club_id, o.id, o.slot, o.brand, o.kind, o.base_cents, o.win_bonus_cents, o.clause, season, season + o.seasons - 1, by]);
  await c.query(`update public.sponsor_offers set status = case when id = $1 then 'signed' else 'declined' end
                  where club_id = $2 and season = $3 and slot = $4 and status = 'open'`, [o.id, o.club_id, season, o.slot]);
}

/** Before simulating `round`: every open slot past its deadline signs the safe (fixed) offer. */
export async function resolveSponsorDefaults(pool: Pool, gameId: string, season: number, round: number): Promise<number> {
  return tx(pool, async (c) => {
    const due = (await c.query<{ club_id: string; slot: Slot }>(
      `select distinct club_id, slot from public.sponsor_offers where game_id = $1 and season = $2 and status = 'open' and deadline_round <= $3`,
      [gameId, season, round])).rows;
    let n = 0;
    for (const d of due) {
      const safe = (await c.query<{ id: string }>(
        `select id from public.sponsor_offers where club_id = $1 and season = $2 and slot = $3 and status = 'open' and kind = 'fixed' limit 1`,
        [d.club_id, season, d.slot])).rows[0];
      if (safe) { await signOffer(c, safe.id, season, "default"); n++; }
      await c.query(`update public.sponsor_offers set status = 'expired' where club_id = $1 and season = $2 and slot = $3 and status = 'open'`, [d.club_id, season, d.slot]);
    }
    return n;
  });
}

/** After `round` was processed: fan mood + board confidence (+ warnings, budget cut/boost) for every club. */
export async function afterRound(pool: Pool, gameId: string, season: number, round: number): Promise<boolean> {
  return tx(pool, async (c) => {
    const hasBoard = await c.query(`select 1 from public.board_state where game_id = $1 and season = $2 limit 1`, [gameId, season]);
    if (!hasBoard.rowCount) return false;
    if (!(await marker(c, gameId, season, round, "business_round", "round"))) return false;
    const total = (await c.query<{ total_rounds: number }>(`select total_rounds from public.seasons where game_id = $1 and number = $2`, [gameId, season])).rows[0]?.total_rounds ?? 34;
    const clubs = (await c.query<ClubRow & { fan_mood: number | null; ticket_price: TicketPrice | null; confidence: number; base_transfer_cents: string; base_wage_cents: string; shift_pct: number; flags: Record<string, boolean>; name_snapshot: string }>(
      `select gc.id, gc.reputation, gc.strength, gc.cash_cents, gc.manager_user_id, gc.name_snapshot, cb.fan_mood, cb.ticket_price,
              bs.confidence, bs.base_transfer_cents, bs.base_wage_cents, bs.shift_pct, bs.flags
         from public.game_clubs gc join public.board_state bs on bs.club_id = gc.id and bs.season = $2
         left join public.club_business cb on cb.club_id = gc.id where gc.game_id = $1`, [gameId, season])).rows;
    const strength = new Map(clubs.map((x) => [x.id, Number(x.strength)]));
    const fx = (await c.query<{ home_club_id: string; away_club_id: string; result_home: number; result_away: number }>(
      `select f.home_club_id, f.away_club_id, f.result_home, f.result_away from public.fixtures f join public.seasons s on s.id = f.season_id
        where f.game_id = $1 and s.number = $2 and f.round_number = $3 and f.status = 'completed'`, [gameId, season, round])).rows;
    for (const club of clubs) {
      const f = fx.find((x) => x.home_club_id === club.id || x.away_club_id === club.id);
      let res: "W" | "D" | "L" | null = null, pts: number | null = null, exp: number | null = null;
      if (f) {
        const home = f.home_club_id === club.id;
        const gf = home ? f.result_home : f.result_away, ga = home ? f.result_away : f.result_home;
        res = gf > ga ? "W" : gf === ga ? "D" : "L";
        pts = res === "W" ? 3 : res === "D" ? 1 : 0;
        exp = expectedPoints((strength.get(club.id) ?? 0) - (strength.get(home ? f.away_club_id : f.home_club_id) ?? 0), home);
      }
      if (club.fan_mood !== null) {
        await c.query(`update public.club_business set fan_mood = $2, updated_at = now() where club_id = $1`,
          [club.id, nextFanMood(club.fan_mood, res, club.ticket_price ?? "normal")]);
      }
      const wages = Number((await c.query(`select coalesce(sum(wage_cents),0) w from public.game_players where club_id = $1`, [club.id])).rows[0].w)
        + Number((await c.query(`select coalesce(sum(wage_cents),0) w from public.club_staff where club_id = $1 and active`, [club.id])).rows[0].w);
      const spent = -Number((await c.query(
        `select coalesce(sum(amount_cents),0) s from public.club_ledger where club_id = $1 and season_number = $2 and event_type = 'transfer_purchase'`,
        [club.id, season])).rows[0].s);
      const eff = effectiveBudgets({ transfer: Number(club.base_transfer_cents), wage: Number(club.base_wage_cents) }, club.shift_pct, total);
      const next = nextConfidence({
        confidence: club.confidence, points: pts, expected: exp, cash_cents: Number(club.cash_cents),
        wages_cents: wages, wage_budget_cents: eff.wage, transfer_spent_cents: spent, transfer_budget_cents: eff.transfer,
      });
      const flags = { ...(club.flags ?? {}) };
      const notes: { type: string; text: string }[] = [];
      let baseTransfer = Number(club.base_transfer_cents);
      if (next.confidence < BOARD.ultimatum && !flags.ultimatum) {
        flags.ultimatum = true;
        baseTransfer = Math.round(baseTransfer * (1 - BOARD.ultimatumCut));
        notes.push({ type: "board_ultimatum", text: "ultimato" });
      } else if (next.confidence < BOARD.warning && !flags.warning) {
        flags.warning = true;
        notes.push({ type: "board_warning", text: "aviso" });
      } else if (next.confidence >= BOARD.praise && !flags.praise) {
        flags.praise = true;
        baseTransfer = Math.round(baseTransfer * (1 + BOARD.praiseBoost));
        notes.push({ type: "board_praise", text: "elogio" });
      }
      await c.query(
        `update public.board_state set confidence = $3, flags = $4, base_transfer_cents = $5,
                history = history || $6::jsonb, updated_at = now() where club_id = $1 and season = $2`,
        [club.id, season, next.confidence, JSON.stringify(flags), baseTransfer, JSON.stringify(next.reasons.map((r) => ({ round, ...r })))]);
      if (club.manager_user_id) {
        for (const n of notes) await c.query(`select public._notify($1, $2, $3, $4)`, [club.manager_user_id, gameId, n.type, JSON.stringify({ confidence: next.confidence })]);
      }
    }
    return true;
  });
}

/** End-of-season sponsor clauses (top-N bonuses) and final positions on the board record. */
export async function seasonClauses(pool: Pool, gameId: string, season: number, table: { club_id: string }[]) {
  return asService(pool, async (c) => {
    const deals = (await c.query<{ id: string; club_id: string; clause: { top: number; bonus_cents: number } | null }>(
      `select id, club_id, clause from public.sponsor_deals where game_id = $1 and start_season <= $2 and end_season >= $2 and clause is not null`,
      [gameId, season])).rows;
    const pos = new Map(table.map((r, i) => [r.club_id, i + 1]));
    for (const [club, p] of pos) await c.query(`update public.board_state set final_position = $3 where club_id = $1 and season = $2`, [club, season, p]);
    return deals.filter((d) => d.clause && (pos.get(d.club_id) ?? 99) <= d.clause.top).map((d) => ({
      club_id: d.club_id, type: "sponsorship" as const, amount_cents: d.clause!.bonus_cents, key: `season:${gameId}:${season}:clause:${d.id}`,
    }));
  });
}
