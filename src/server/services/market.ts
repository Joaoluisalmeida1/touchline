/**
 * market-v2 orchestration (OSM-style Transfer List). One idempotent "tick" per (season, round), run after each processed
 * round and lazily when the market is opened (so round 0 of a season gets its first batch):
 *   1. AI / foreign listings that stayed unsold drop in price, or leave the list after a round at the floor;
 *   2. AI clubs buy some of the managers' listings;
 *   3. new players enter the list (AI clubs of this league + foreign clubs of the dataset).
 * Buying is a service command (`buy_listing_tx`) because foreign players need TS-side wage/contract/profile.
 */
import type { Pool, PoolClient } from "pg";
import type { PositionGroup } from "../../engine/common/types";
import { initialContractEnd, weeklyWageCents } from "../../engine/economy/economy";
import {
  MARKET, aiPurchases, listingAfter, newListingCount, pickNewListings, type AiClub, type Candidate,
} from "../../engine/market/market";
import { asService } from "../pg";

interface GameRow { id: string; status: string; season: number; round: number; total_rounds: number | null; snap: string; mode: string; max_squad: number; min_squad: number }

async function loadGame(c: PoolClient, gameId: string): Promise<GameRow | null> {
  return (await c.query<GameRow>(
    `select g.id, g.status, g.current_season season, g.current_matchday round, g.dataset_snapshot_id snap,
            coalesce(g.settings_json->>'market', 'osm') mode,
            coalesce((g.settings_json->>'max_squad')::int, 32) max_squad, coalesce((g.settings_json->>'min_squad')::int, 16) min_squad,
            (select total_rounds from public.seasons s where s.game_id = g.id and s.number = g.current_season) total_rounds
       from public.games g where g.id = $1`, [gameId])).rows[0] ?? null;
}

/** Runs the market for the game's current (season, round) once. Returns false when it already ran / doesn't apply. */
export async function marketTick(pool: Pool, gameId: string): Promise<boolean> {
  return asService(pool, async (c) => {
    const g = await loadGame(c, gameId);
    if (!g || g.status !== "active" || g.mode !== "osm") return false;
    await c.query("begin");
    try {
      const mark = await c.query(
        `insert into public.game_events (game_id, season, round, kind, key, payload) values ($1, $2, $3, 'market_tick', 'x', $4)
         on conflict (game_id, season, round, kind, key) do nothing returning id`,
        [gameId, g.season, g.round, JSON.stringify({ version: "market-v2" })]);
      if (!mark.rowCount) { await c.query("rollback"); return false; }
      const seed = `${gameId}:${g.season}:${g.round}`;
      if (g.round > 0) {
        await decay(c, g);
        await aiBuys(c, g, seed);
      }
      await addListings(c, g, seed);
      await c.query("commit");
      return true;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  });
}

async function decay(c: PoolClient, g: GameRow) {
  const open = (await c.query<{ id: string; start: string; floor: string; rounds: number }>(
    `select id, start_price_cents start, floor_price_cents floor, rounds_unsold rounds from public.transfer_listings
      where game_id = $1 and status = 'active' and origin in ('ai','external')
        and not (listed_season = $2 and listed_round = $3)`, [g.id, g.season, g.round])).rows;
  for (const l of open) {
    const next = listingAfter(Number(l.start), Number(l.floor), l.rounds + 1);
    if (next.expired) {
      await c.query(`update public.transfer_listings set status = 'expired', rounds_unsold = $2, closed_round = $3, closed_at = now() where id = $1`,
        [l.id, l.rounds + 1, g.round]);
    } else {
      await c.query(`update public.transfer_listings set asking_price_cents = $2, rounds_unsold = $3 where id = $1`, [l.id, next.price, l.rounds + 1]);
    }
  }
}

async function aiBuys(c: PoolClient, g: GameRow, seed: string) {
  const listings = (await c.query<{ id: string; price: string; value: string; grp: PositionGroup }>(
    `select l.id, l.asking_price_cents price, coalesce(l.value_cents, p.market_value_cents) value, p.position_group grp
       from public.transfer_listings l join public.game_players p on p.id = l.player_id
      where l.game_id = $1 and l.status = 'active' and l.origin = 'manager'`, [g.id])).rows;
  if (!listings.length) return;
  const clubs = (await c.query<{ id: string; cash: string; squad: number; gk: number; def: number; mid: number; att: number }>(
    `select gc.id, gc.cash_cents - gc.reserved_cents cash, count(p.id)::int squad,
            count(*) filter (where p.position_group = 'GK')::int gk, count(*) filter (where p.position_group = 'DEF')::int def,
            count(*) filter (where p.position_group = 'MID')::int mid, count(*) filter (where p.position_group = 'ATT')::int att
       from public.game_clubs gc left join public.game_players p on p.club_id = gc.id
      where gc.game_id = $1 and gc.manager_user_id is null group by gc.id`, [g.id])).rows;
  const ai: AiClub[] = clubs.map((x) => ({ id: x.id, cashCents: Number(x.cash), squad: x.squad, byGroup: { GK: x.gk, DEF: x.def, MID: x.mid, ATT: x.att } }));
  const frac = g.total_rounds ? g.round / g.total_rounds : 0.5;
  const buys = aiPurchases(seed, listings.map((l) => ({ id: l.id, priceCents: Number(l.price), valueCents: Number(l.value), group: l.grp })), ai, frac, g.max_squad);
  for (const b of buys) {
    // one failed purchase (e.g. the seller's squad would drop below the minimum) must not undo the tick
    await c.query("savepoint ai_buy");
    try {
      await c.query(`select public._market_ai_buy($1, $2)`, [b.listingId, b.buyerId]);
      await c.query("release savepoint ai_buy");
    } catch {
      await c.query("rollback to savepoint ai_buy");
    }
  }
}

async function addListings(c: PoolClient, g: GameRow, seed: string) {
  const counts = (await c.query<{ open: number; humans: number }>(
    `select (select count(*) from public.transfer_listings where game_id = $1 and status = 'active' and origin in ('ai','external'))::int open,
            (select count(*) from public.game_clubs where game_id = $1 and manager_user_id is not null)::int humans`, [g.id])).rows[0];
  const n = newListingCount(counts.humans, counts.open, g.round === 0);
  if (n <= 0) return;

  const league = (await c.query<{ id: string; club: string; value: string; ovr: number }>(
    `with ranked as (
       select p.id, p.club_id, p.market_value_cents, p.current_ovr, p.injured_matches,
              row_number() over (partition by p.club_id order by p.current_ovr desc, p.id) rk,
              count(*) over (partition by p.club_id) squad
         from public.game_players p join public.game_clubs gc on gc.id = p.club_id
        where p.game_id = $1 and gc.manager_user_id is null)
     select r.id, r.club_id club, r.market_value_cents value, r.current_ovr ovr from ranked r
      where r.rk > 3 and r.squad > $2 + 2 and r.injured_matches = 0
        and not exists (select 1 from public.transfer_listings l where l.player_id = r.id and l.status = 'active')`,
    [g.id, g.min_squad])).rows;
  const range = (await c.query<{ lo: number; hi: number }>(
    `select coalesce(min(current_ovr), 40)::int lo, coalesce(max(current_ovr), 80)::int hi from public.game_players where game_id = $1 and club_id is not null`, [g.id])).rows[0];
  const foreign = (await c.query<{ id: string; value: string; ovr: number; club: string | null }>(
    `select sp.source_player_id id, sp.base_value_eur * 100 value, sp.initial_ovr ovr, dc.name club
       from public.dataset_snapshot_players sp
       left join public.dataset_snapshot_clubs dc on dc.snapshot_id = sp.snapshot_id and dc.source_club_id = sp.source_club_id
      where sp.snapshot_id = $2 and sp.initial_ovr between $3 and $4 and sp.base_value_eur > 0
        and not exists (select 1 from public.game_clubs x where x.game_id = $1 and x.source_club_id = sp.source_club_id)
        and not exists (select 1 from public.game_players x where x.game_id = $1 and x.source_player_id = sp.source_player_id)
        and not exists (select 1 from public.transfer_listings l where l.game_id = $1 and l.source_player_id = sp.source_player_id and l.status = 'active')
      order by md5(sp.source_player_id::text || $5) limit 300`,
    [g.id, g.snap, range.lo - 3, range.hi + 2, seed])).rows;

  const nForeign = foreign.length ? Math.min(foreign.length, Math.ceil(n / 2)) : 0;
  const nLeague = Math.min(league.length, n - nForeign);
  const clubOf = new Map(league.map((p) => [p.id, p.club]));
  const foreignClub = new Map(foreign.map((p) => [p.id, p.club]));
  const toCand = (r: { id: string; value: string; ovr: number }): Candidate => ({ key: r.id, valueCents: Number(r.value), ovr: r.ovr });

  for (const p of pickNewListings(`${seed}:league`, league.map(toCand), nLeague)) {
    await c.query(
      `insert into public.transfer_listings (game_id, player_id, seller_club_id, asking_price_cents, origin, value_cents, start_price_cents,
                                             floor_price_cents, listed_season, listed_round)
       values ($1, $2, $3, $4, 'ai', $5, $4, $6, $7, $8) on conflict do nothing`,
      [g.id, p.key, clubOf.get(p.key), p.startCents, p.valueCents, p.floorCents, g.season, g.round]);
  }
  for (const p of pickNewListings(`${seed}:foreign`, foreign.map(toCand), nForeign)) {
    await c.query(
      `insert into public.transfer_listings (game_id, source_player_id, external_club_name, asking_price_cents, origin, value_cents,
                                             start_price_cents, floor_price_cents, listed_season, listed_round)
       values ($1, $2, $3, $4, 'external', $5, $4, $6, $7, $8) on conflict do nothing`,
      [g.id, p.key, foreignClub.get(p.key) ?? "Clube estrangeiro", p.startCents, p.valueCents, p.floorCents, g.season, g.round]);
  }
}

export type BuyResult = { status: "bought"; listing_id: string; player_id?: string; replayed?: boolean };

/** Buy a player from the Transfer List at its current price. */
export async function buyListing(pool: Pool, userId: string, listingId: string, expectedPriceCents: number | null, idempotencyKey: string): Promise<BuyResult> {
  return asService(pool, async (c) => {
    const ctx = (await c.query<{ ovr: number; reputation: number; season: number; profile: Record<string, unknown>; anchor: unknown; src: string }>(
      `select sp.initial_ovr ovr, gc.reputation, g.current_season season, sp.derived_profile_json profile,
              sp.derivation_json->'value_anchor_ratio' anchor, sp.source_player_id::text src
         from public.transfer_listings l
         join public.games g on g.id = l.game_id
         join public.game_clubs gc on gc.game_id = g.id and gc.manager_user_id = $2
         join public.dataset_snapshot_players sp on sp.snapshot_id = g.dataset_snapshot_id and sp.source_player_id = l.source_player_id
        where l.id = $1 and l.origin = 'external'`, [listingId, userId])).rows[0];
    const payload: Record<string, unknown> = { idempotency_key: idempotencyKey, expected_price_cents: expectedPriceCents };
    if (ctx) {
      payload.wage_cents = weeklyWageCents(ctx.ovr, ctx.reputation);
      payload.contract_end_season = initialContractEnd(ctx.src, ctx.season);
      payload.profile = { ...ctx.profile, value_anchor_ratio: ctx.anchor ?? 1 };
    }
    const r = await c.query<{ r: BuyResult }>(`select public.buy_listing_tx($1, $2, $3) as r`, [userId, listingId, JSON.stringify(payload)]);
    return r.rows[0].r;
  });
}

export const MANAGER_SLOTS = MARKET.managerSlots;
