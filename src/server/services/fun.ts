/**
 * "Roleta" (slots-v1), duels and match betting (betting-v1). Everything that involves chance or money runs here, on
 * the service connection, inside one transaction with the club row locked; the randomness is crypto (not seeded), so
 * nobody can predict a spin from the open-source code. In-game money only.
 */
import { randomInt } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { initialContractEnd, weeklyWageCents } from "../../engine/economy/economy";
import { BETTING_VERSION, MIN_STAKE_CENTS, odds as oddsFor, outcome, payout } from "../../engine/betting/odds";
import {
  DAILY_SPINS, DUEL_STAKE_CENTS, JACKPOT_BASE_CENTS, JACKPOT_SHARE, PRIZE_LABEL, SKIN_LABEL, SLOTS_VERSION, SPIN_COST_CENTS,
  PRIZES, cashAmount, drawPrize, duelReels, pickPrizePlayer, reelsFor, skinFor, type PrizeKind, type Rarity, type Symbol,
} from "../../engine/slots/slots";
import { asService } from "../pg";

const rand = () => randomInt(0, 2 ** 32) / 2 ** 32;

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
/** Raise a user-facing domain error (same shape as the SQL commands' _fail). */
async function bad(c: PoolClient, code: string, message: string): Promise<never> {
  await c.query(`select public._fail($1, $2)`, [code, message]);
  throw new Error(message);
}

interface Ctx {
  game_id: string; status: string; season: number; round: number; timezone: string; processing: boolean; settings: Record<string, unknown>;
  club_id: string; club_name: string; reputation: number; cash: string; reserved: string; season_id: string | null;
}
async function context(c: PoolClient, userId: string, gameId: string): Promise<Ctx> {
  const r = (await c.query<Ctx>(
    `select g.id game_id, g.status, g.current_season season, g.current_matchday round, g.timezone,
            coalesce(g.processing_lease_until > now(), false) processing, g.settings_json settings,
            gc.id club_id, gc.name_snapshot club_name, gc.reputation, gc.cash_cents cash, gc.reserved_cents reserved,
            (select id from public.seasons s where s.game_id = g.id and s.number = g.current_season) season_id
       from public.games g join public.game_clubs gc on gc.game_id = g.id and gc.manager_user_id = $2
      where g.id = $1 for update of gc`, [gameId, userId])).rows[0];
  if (!r) return bad(c, "no_club", "Precisas de um clube nesta liga.");
  if (!["setup", "active"].includes(r.status)) return bad(c, "game_closed", "Liga fechada.");
  return r;
}
const available = (x: Ctx) => Number(x.cash) - Number(x.reserved);

/* ======================================================================== slots */

export interface SpinOutcome {
  id: string; prize: PrizeKind; rarity: Rarity; label: string; detail: string; reels: Symbol[]; free: boolean;
  amount_cents?: number; skin?: string; player?: { id: string; name: string; ovr: number; position_group: string } | null;
  shielded?: boolean; pot_cents: number; spins_left: number;
}

/** `opts.prize` forces the outcome (integration tests only; the server action never passes it). */
export async function spin(pool: Pool, userId: string, gameId: string, opts: { prize?: PrizeKind } = {}): Promise<SpinOutcome> {
  return tx(pool, async (c) => {
    const x = await context(c, userId, gameId);
    if (x.processing) await bad(c, "processing", "A jornada está a ser processada. Tenta daqui a pouco.");
    const today = (await c.query<{ d: string; n: number }>(
      `select (now() at time zone $2)::date::text d,
              (select count(*) from public.slot_spins where club_id = $1 and not free and spun_on = (now() at time zone $2)::date)::int n`,
      [x.club_id, x.timezone])).rows[0];
    const freeCard = (await c.query<{ id: string }>(`select id from public.slot_cards where club_id = $1 and kind = 'free_spin' and status = 'held' order by created_at limit 1 for update`, [x.club_id])).rows[0];
    const free = !!freeCard;
    if (!free && today.n >= DAILY_SPINS) await bad(c, "daily_limit", `Já fizeste os ${DAILY_SPINS} giros de hoje. Volta amanhã!`);
    if (!free && available(x) < SPIN_COST_CENTS) await bad(c, "insufficient_funds", "Precisas de €500 000 disponíveis para girar.");

    await c.query(`insert into public.slots_pots (game_id) values ($1) on conflict do nothing`, [gameId]);
    const potRow = (await c.query<{ pot: string }>(`select pot_cents pot from public.slots_pots where game_id = $1 for update`, [gameId])).rows[0];
    let pot = Number(potRow.pot);
    const spinId = (await c.query<{ id: string }>(`select gen_random_uuid() id`)).rows[0].id;
    if (free) {
      await c.query(`update public.slot_cards set status = 'used', used_at = now() where id = $1`, [freeCard.id]);
    } else {
      await c.query(`select public._ledger($1, $2, 'slots', $3, $4, $5, $6, $7)`, [gameId, x.club_id, -SPIN_COST_CENTS, spinId, `spin:${spinId}`, x.season, x.round]);
      pot += Math.round(SPIN_COST_CENTS * JACKPOT_SHARE);
    }

    const negatives = x.settings.slots_negatives !== false;
    const pointPenalty = x.settings.slots_point_penalty === true && !!x.season_id && x.status === "active";
    const forced = opts.prize ? PRIZES.find((p) => p.kind === opts.prize) : undefined;
    const prize = forced ?? drawPrize(rand(), { negatives, pointPenalty });
    const reels = reelsFor(prize, rand);
    const out: SpinOutcome = { id: spinId, prize: prize.kind, rarity: prize.rarity, label: PRIZE_LABEL[prize.kind], detail: "", reels, free, pot_cents: pot, spins_left: 0 };
    const ledger = (amount: number, tag: string) => c.query(`select public._ledger($1, $2, 'slots', $3, $4, $5, $6, $7)`,
      [gameId, x.club_id, amount, spinId, `spin:${spinId}:${tag}`, x.season, x.round]);

    // the shield stops the next punishment
    if (prize.negative) {
      const shield = (await c.query<{ id: string }>(`select id from public.slot_cards where club_id = $1 and kind = 'shield' and status = 'held' order by created_at limit 1 for update`, [x.club_id])).rows[0];
      if (shield) {
        await c.query(`update public.slot_cards set status = 'used', used_at = now() where id = $1`, [shield.id]);
        out.shielded = true;
        out.detail = "O Escudo travou o azar. Nada aconteceu.";
      }
    }

    if (!out.shielded) switch (prize.kind) {
      case "cash_small": case "cash_mid": case "cash_big": {
        const amt = cashAmount(prize.kind, rand());
        await ledger(amt, "cash");
        out.amount_cents = amt;
        out.detail = `+€${(amt / 100).toLocaleString("pt-PT")} no saldo.`;
        break;
      }
      case "morale": {
        const r = await c.query<{ name: string }>(
          `update public.game_players set morale = least(100, morale + 6), version = version + 1, updated_at = now()
            where id in (select id from public.game_players where club_id = $1 order by random() limit 3) returning name_snapshot name`, [x.club_id]);
        out.detail = `+6 moral: ${r.rows.map((p) => p.name).join(", ")}.`;
        break;
      }
      case "fitness":
        await c.query(`update public.game_players set fitness = least(100, fitness + 8), version = version + 1, updated_at = now() where club_id = $1`, [x.club_id]);
        out.detail = "+8% de condição física para todo o plantel.";
        break;
      case "skin": case "skin_epic": case "skin_legendary": {
        const skin = skinFor(prize.kind, rand());
        const ins = await c.query(`insert into public.club_skins (club_id, game_id, skin) values ($1, $2, $3) on conflict do nothing`, [x.club_id, gameId, skin]);
        out.skin = skin;
        if (!ins.rowCount) {
          await ledger(25_000_000, "dup");
          out.amount_cents = 25_000_000;
          out.detail = `Emblema "${SKIN_LABEL[skin]}" repetido — vendido por €250 000.`;
        } else out.detail = `Emblema "${SKIN_LABEL[skin]}" desbloqueado. Equipa-o na tua coleção.`;
        break;
      }
      case "player": {
        const pool2 = (await c.query<{ id: string; name: string; ovr: number; grp: string; value: string; profile: Record<string, unknown>; anchor: unknown; snap: string }>(
          `select sp.source_player_id id, sp.display_name name, sp.initial_ovr ovr, sp.position_group grp, sp.base_value_eur * 100 value,
                  sp.derived_profile_json profile, sp.derivation_json->'value_anchor_ratio' anchor, g.dataset_snapshot_id snap
             from public.games g join public.dataset_snapshot_players sp on sp.snapshot_id = g.dataset_snapshot_id
            where g.id = $1 and sp.base_value_eur > 0
              and not exists (select 1 from public.game_clubs x where x.game_id = g.id and x.source_club_id = sp.source_club_id)
              and not exists (select 1 from public.game_players x where x.game_id = g.id and x.source_player_id = sp.source_player_id)
              and not exists (select 1 from public.transfer_listings l where l.game_id = g.id and l.source_player_id = sp.source_player_id and l.status = 'active')
            order by random() limit 400`, [gameId])).rows;
        const p = pickPrizePlayer(pool2.map((r) => ({ ...r, valueCents: Number(r.value) })), rand());
        if (!p) { await ledger(100_000_000, "noplayer"); out.amount_cents = 100_000_000; out.detail = "Não havia jogadores disponíveis — recebes €1 000 000."; break; }
        const max = Number(x.settings.max_squad ?? 32);
        const squad = (await c.query<{ n: number }>(`select count(*)::int n from public.game_players where club_id = $1`, [x.club_id])).rows[0].n;
        if (squad >= max) {
          const amt = Math.round(p.valueCents / 2 / 1_000_000) * 1_000_000;
          await ledger(amt, "fullsquad");
          out.amount_cents = amt;
          out.player = { id: "", name: p.name, ovr: p.ovr, position_group: p.grp };
          out.detail = `Saiu ${p.name} (${p.ovr}), mas o plantel está cheio: recebes metade do valor (€${(amt / 100).toLocaleString("pt-PT")}).`;
          break;
        }
        const id = (await c.query<{ id: string }>(
          `insert into public.game_players (game_id, source_player_id, club_id, name_snapshot, position_group, position_detail, birth_date, age_known, age,
             initial_ovr, season_start_ovr, current_ovr, potential_cap, hidden_development_rate, profile_json, morale, fitness, sharpness,
             market_value_cents, wage_cents, contract_end_season)
           select $1, sp.source_player_id, $2, sp.display_name, sp.position_group, sp.position_detail, sp.birth_date, sp.age_at_import is not null,
                  sp.age_at_import, sp.initial_ovr, sp.initial_ovr, sp.initial_ovr, sp.initial_potential, sp.hidden_development_rate, $3::jsonb,
                  80, 100, 60, sp.base_value_eur * 100, $4, $5
             from public.dataset_snapshot_players sp where sp.snapshot_id = $6 and sp.source_player_id = $7 returning id`,
          [gameId, x.club_id, JSON.stringify({ ...p.profile, value_anchor_ratio: p.anchor ?? 1 }), weeklyWageCents(p.ovr, x.reputation),
            initialContractEnd(p.id, x.season), p.snap, p.id])).rows[0].id;
        await c.query(`insert into public.transfer_transactions (game_id, player_id, from_club_id, to_club_id, price_cents, season_number, external_from_name)
                       values ($1, $2, null, $3, 0, $4, 'Roleta')`, [gameId, id, x.club_id, x.season]);
        out.player = { id, name: p.name, ovr: p.ovr, position_group: p.grp };
        out.detail = `${p.name} (${p.grp} · ${p.ovr}) junta-se ao plantel, sem custo de transferência.`;
        break;
      }
      case "card_shield": case "card_immunity": case "card_gate": case "free_spin": {
        const kind = prize.kind === "free_spin" ? "free_spin" : prize.kind.replace("card_", "");
        await c.query(`insert into public.slot_cards (game_id, club_id, kind, spin_id) values ($1, $2, $3, null)`, [gameId, x.club_id, kind]);
        out.detail = { shield: "Guarda-a: anula o próximo azar da roleta.", immunity: "Ativa-a antes de uma jornada: as lesões dessa jornada não contam.",
          gate: "Ativa-a antes de um jogo em casa: a bilheteira dessa jornada vem a dobrar.", free_spin: "O próximo giro é grátis e não conta para o limite diário." }[kind]!;
        break;
      }
      case "jackpot": {
        const won = pot;
        await ledger(won, "jackpot");
        out.amount_cents = won;
        pot = JACKPOT_BASE_CENTS;
        await c.query(`update public.slots_pots set last_winner_club_id = $2, last_won_cents = $3, last_won_at = now() where game_id = $1`, [gameId, x.club_id, won]);
        await c.query(`select public._notify(m.user_id, $1, 'jackpot', $2) from public.game_members m where m.game_id = $1`,
          [gameId, JSON.stringify({ club: x.club_name, amount_cents: won })]);
        out.detail = `JACKPOT! +€${(won / 100).toLocaleString("pt-PT")}.`;
        break;
      }
      case "injury": {
        const r = (await c.query<{ name: string; m: number }>(
          `update public.game_players set injured_matches = 1 + floor(random() * 3)::int, injury_type = 'Lesão no treino', version = version + 1, updated_at = now()
            where id = (select id from public.game_players where club_id = $1 and injured_matches = 0 order by random() limit 1)
           returning name_snapshot name, injured_matches m`, [x.club_id])).rows[0];
        out.detail = r ? `${r.name} lesionou-se no treino: ${r.m} ${r.m === 1 ? "jornada" : "jornadas"} de fora.` : "Todos já estavam lesionados… nada mudou.";
        break;
      }
      case "fine": {
        const amt = cashAmount("fine", rand());
        await ledger(-amt, "fine");
        pot += amt;
        out.amount_cents = -amt;
        out.detail = `Multa de €${(amt / 100).toLocaleString("pt-PT")} — vai direitinha para o jackpot.`;
        break;
      }
      case "sulk": {
        const r = (await c.query<{ name: string }>(
          `update public.game_players set morale = greatest(0, morale - 12), version = version + 1, updated_at = now()
            where id = (select id from public.game_players where club_id = $1 order by current_ovr desc, random() limit 1) returning name_snapshot name`, [x.club_id])).rows[0];
        out.detail = r ? `${r.name} ficou amuado: −12 moral.` : "Ninguém se chateou.";
        break;
      }
      case "point": {
        await c.query(`update public.standings set points = points - 1, updated_at = now() where season_id = $1 and club_id = $2`, [x.season_id, x.club_id]);
        await c.query(`insert into public.game_events (game_id, season, round, kind, key, club_id, payload) values ($1, $2, $3, 'point_penalty', $4, $5, '{}'::jsonb)`,
          [gameId, x.season, x.round, spinId, x.club_id]);
        out.detail = "A Liga tirou-te 1 ponto na classificação.";
        break;
      }
    }

    await c.query(`update public.slots_pots set pot_cents = $2, updated_at = now() where game_id = $1`, [gameId, pot]);
    out.pot_cents = pot;
    await c.query(
      `insert into public.slot_spins (id, game_id, club_id, user_id, spun_on, cost_cents, free, prize, rarity, label, reels, payload)
       values ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12)`,
      [spinId, gameId, x.club_id, userId, today.d, free ? 0 : SPIN_COST_CENTS, free, prize.kind, prize.rarity, out.label, JSON.stringify(reels),
        JSON.stringify({ version: SLOTS_VERSION, detail: out.detail, amount_cents: out.amount_cents ?? null, skin: out.skin ?? null, player: out.player ?? null, shielded: !!out.shielded })]);
    if (["epic", "legendary", "disaster"].includes(prize.rarity) && !out.shielded) {
      await c.query(`insert into public.wall_posts (game_id, kind, payload, dedupe_key) values ($1, 'slots', $2, $3) on conflict do nothing`,
        [gameId, JSON.stringify({ club: x.club_name, label: out.label, detail: out.detail, rarity: prize.rarity }), `spin:${spinId}`]);
    }
    out.spins_left = Math.max(0, DAILY_SPINS - today.n - (free ? 0 : 1));
    return out;
  });
}

/* ======================================================================== duels */

export async function acceptDuel(pool: Pool, userId: string, gameId: string, duelId: string) {
  return tx(pool, async (c) => {
    const x = await context(c, userId, gameId);
    const d = (await c.query<{ id: string; status: string; challenger: string; opponent: string; stake: string; cname: string; cmgr: string }>(
      `select d.id, d.status, d.challenger_club_id challenger, d.opponent_club_id opponent, d.stake_cents stake, ch.name_snapshot cname, ch.manager_user_id cmgr
         from public.slot_duels d join public.game_clubs ch on ch.id = d.challenger_club_id where d.id = $1 and d.game_id = $2 for update of d`, [duelId, gameId])).rows[0];
    if (!d || d.opponent !== x.club_id) return bad(c, "not_found", "Duelo inexistente.");
    if (d.status !== "open") return bad(c, "closed", "Este duelo já terminou.");
    const stake = Number(d.stake);
    if (available(x) < stake) return bad(c, "insufficient_funds", "Precisas de €500 000 disponíveis para aceitar.");
    await c.query(`update public.game_clubs set reserved_cents = reserved_cents - $2 where id = $1`, [d.challenger, stake]);
    const a = duelReels(rand), b = duelReels(rand);
    const winner = a.score > b.score ? d.challenger : b.score > a.score ? d.opponent : null;
    if (winner) {
      const loser = winner === d.challenger ? d.opponent : d.challenger;
      await c.query(`select public._ledger($1, $2, 'slots', $3, $4, $5, $6, $7)`, [gameId, loser, -stake, d.id, `duel:${d.id}:loser`, x.season, x.round]);
      await c.query(`select public._ledger($1, $2, 'slots', $3, $4, $5, $6, $7)`, [gameId, winner, stake, d.id, `duel:${d.id}:winner`, x.season, x.round]);
    }
    await c.query(`update public.slot_duels set status = 'done', challenger_reels = $2, opponent_reels = $3, challenger_score = $4, opponent_score = $5,
                     winner_club_id = $6, resolved_at = now() where id = $1`,
      [d.id, JSON.stringify(a.reels), JSON.stringify(b.reels), a.score, b.score, winner]);
    await c.query(`select public._notify($1, $2, 'duel_result', $3)`, [d.cmgr, gameId,
      JSON.stringify({ opponent: x.club_name, won: winner === d.challenger, draw: !winner, amount_cents: stake })]);
    await c.query(`insert into public.wall_posts (game_id, kind, payload, dedupe_key) values ($1, 'duel', $2, $3) on conflict do nothing`,
      [gameId, JSON.stringify({ a: d.cname, b: x.club_name, a_score: a.score, b_score: b.score, a_reels: a.reels, b_reels: b.reels,
        winner: winner === d.challenger ? d.cname : winner ? x.club_name : null, stake_cents: stake }), `duel:${d.id}`]);
    return { challenger: a, opponent: b, winner: winner === d.challenger ? "challenger" : winner ? "opponent" : "draw", stake_cents: stake };
  });
}

/* ======================================================================== betting */

export async function placeBet(pool: Pool, userId: string, gameId: string, fixtureId: string, pick: "1" | "X" | "2", stakeCents: number, key: string) {
  return tx(pool, async (c) => {
    const x = await context(c, userId, gameId);
    if (x.settings.betting === false) return bad(c, "disabled", "As apostas estão desligadas nesta liga.");
    if (x.status !== "active") return bad(c, "not_active", "A liga ainda não começou.");
    if (x.processing) return bad(c, "processing", "A jornada está a ser processada.");
    const replay = (await c.query(`select id from public.bets where idempotency_key = $1`, [key])).rows[0];
    if (replay) return { id: replay.id as string, replayed: true };
    if (!Number.isInteger(stakeCents) || stakeCents < MIN_STAKE_CENTS) return bad(c, "invalid_amount", "Aposta mínima: €10 000.");
    if (available(x) < stakeCents) return bad(c, "insufficient_funds", "Não tens esse dinheiro disponível.");
    const f = (await c.query<{ id: string; home: string; away: string; status: string; round: number; hs: string; as: string }>(
      `select f.id, f.home_club_id home, f.away_club_id away, f.status, f.round_number round, h.strength hs, a.strength "as"
         from public.fixtures f join public.seasons s on s.id = f.season_id
         join public.game_clubs h on h.id = f.home_club_id join public.game_clubs a on a.id = f.away_club_id
        where f.id = $1 and s.game_id = $2 and s.number = $3`, [fixtureId, gameId, x.season])).rows[0];
    if (!f) return bad(c, "not_found", "Jogo inexistente.");
    if (f.status === "completed" || f.round !== x.round + 1) return bad(c, "closed", "Só se aposta nos jogos da próxima jornada.");
    if (f.home === x.club_id || f.away === x.club_id) return bad(c, "own_match", "Não podes apostar no teu próprio jogo.");
    const o = oddsFor(Number(f.hs), Number(f.as))[pick];
    const id = (await c.query<{ id: string }>(
      `insert into public.bets (game_id, user_id, club_id, fixture_id, pick, stake_cents, odds, idempotency_key) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [gameId, userId, x.club_id, f.id, pick, stakeCents, o, key])).rows[0].id;
    await c.query(`select public._ledger($1, $2, 'betting', $3, $4, $5, $6, $7)`, [gameId, x.club_id, -stakeCents, id, `bet:${id}`, x.season, x.round]);
    return { id, odds: o, replayed: false };
  });
}

/** After a round: pay winning bets of completed fixtures (idempotent: only open bets are settled, ledger keys are unique). */
export async function settleBets(pool: Pool, gameId: string, season: number, round: number): Promise<number> {
  return tx(pool, async (c) => {
    const rows = (await c.query<{ id: string; club: string; user_id: string; pick: "1" | "X" | "2"; stake: string; odds: string; hg: number; ag: number; home: string; away: string }>(
      `select b.id, b.club_id club, b.user_id, b.pick, b.stake_cents stake, b.odds, f.result_home hg, f.result_away ag, h.name_snapshot home, a.name_snapshot away
         from public.bets b join public.fixtures f on f.id = b.fixture_id
         join public.game_clubs h on h.id = f.home_club_id join public.game_clubs a on a.id = f.away_club_id
        where b.game_id = $1 and b.status = 'open' and f.status = 'completed' for update of b`, [gameId])).rows;
    for (const b of rows) {
      const won = outcome(b.hg, b.ag) === b.pick;
      const pay = won ? payout(Number(b.stake), Number(b.odds)) : 0;
      if (won) {
        await c.query(`select public._ledger($1, $2, 'betting', $3, $4, $5, $6, $7)`, [gameId, b.club, pay, b.id, `bet:${b.id}:payout`, season, round]);
        const match = `${b.home} ${b.hg}–${b.ag} ${b.away}`;
        await c.query(`select public._notify($1, $2, 'bet_won', $3)`, [b.user_id, gameId, JSON.stringify({ match, payout_cents: pay })]);
        if (pay >= 200_000_000 || Number(b.odds) >= 5) {
          const club = (await c.query<{ n: string }>(`select name_snapshot n from public.game_clubs where id = $1`, [b.club])).rows[0].n;
          await c.query(`insert into public.wall_posts (game_id, kind, payload, dedupe_key) values ($1, 'bet', $2, $3) on conflict do nothing`,
            [gameId, JSON.stringify({ club, match, odds: Number(b.odds), payout_cents: pay, pick: b.pick, version: BETTING_VERSION }), `bet:${b.id}`]);
        }
      }
      await c.query(`update public.bets set status = $2, payout_cents = $3, settled_at = now() where id = $1`, [b.id, won ? "won" : "lost", pay]);
    }
    return rows.length;
  });
}

/** After a round: cards played for it (immunity heals the round's new injuries; gate pays the home gate again). */
export async function applyCards(pool: Pool, gameId: string, season: number, round: number): Promise<void> {
  await tx(pool, async (c) => {
    const cards = (await c.query<{ id: string; club: string; kind: string; payload: { injured_before?: string[] } }>(
      `select id, club_id club, kind, payload from public.slot_cards where game_id = $1 and status = 'active' and active_season = $2 and active_round = $3 for update`,
      [gameId, season, round])).rows;
    for (const card of cards) {
      if (card.kind === "immunity") {
        await c.query(`update public.game_players set injured_matches = 0, injury_type = null, version = version + 1, updated_at = now()
                        where club_id = $1 and injured_matches > 0 and not (id::text = any($2::text[]))`, [card.club, card.payload.injured_before ?? []]);
      } else if (card.kind === "gate") {
        const gate = Number((await c.query<{ s: string }>(
          `select coalesce(sum(amount_cents), 0) s from public.club_ledger where club_id = $1 and event_type = 'gate_receipts' and season_number = $2 and round_number = $3`,
          [card.club, season, round])).rows[0].s);
        if (gate > 0) await c.query(`select public._ledger($1, $2, 'slots', $3, $4, $5, $6, $7)`, [gameId, card.club, gate, card.id, `card:${card.id}`, season, round]);
      }
      await c.query(`update public.slot_cards set status = 'used', used_at = now() where id = $1`, [card.id]);
    }
  });
}

export { DAILY_SPINS, DUEL_STAKE_CENTS, SPIN_COST_CENTS };
