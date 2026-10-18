import "server-only";
import { withService, withUser } from "./db";

/**
 * Transfer List reads. Foreign players live in dataset_snapshot_players (no client grants), so the list runs on the
 * service connection with an explicit membership check and returns public columns only (never potential/dev rate).
 */
export interface ListingRow {
  id: string; origin: "manager" | "ai" | "external"; player_id: string | null; name: string; position_group: "GK" | "DEF" | "MID" | "ATT";
  position_detail: string | null; age: number | null; ovr: number; potential_band: string; club_name: string; club_id: string | null;
  club_color: string | null; club_color2: string | null; seller_manager: string | null; mine: boolean;
  price_cents: string; value_cents: string; start_price_cents: string; floor_price_cents: string; rounds_unsold: number;
  listed_season: number | null; listed_round: number | null;
}

export interface ListFilters { position?: string; maxPrice?: number; minOvr?: number; sort?: "price" | "ratio" | "ovr" | "new" | "ending" }

export async function getTransferList(userId: string, gameId: string, f: ListFilters = {}): Promise<ListingRow[]> {
  const order = {
    price: "price_cents asc", ratio: "price_cents::numeric / greatest(value_cents, 1) asc", ovr: "ovr desc",
    new: "listed_season desc nulls last, listed_round desc nulls last", ending: "ending asc, price_cents asc",
  }[f.sort ?? "new"];
  return withService(async (c) => (await c.query<ListingRow>(
    `with g as (
       select g.id, g.dataset_snapshot_id snap from games g
        where g.id = $1 and exists (select 1 from game_members m where m.game_id = g.id and m.user_id = $2)
     ), me as (select id from game_clubs where game_id = $1 and manager_user_id = $2),
     rows as (
       select l.id, l.origin, l.player_id, p.name_snapshot name, p.position_group, p.position_detail, p.age, p.current_ovr ovr, p.potential_band,
              gc.name_snapshot club_name, gc.id club_id, gc.primary_color club_color, gc.secondary_color club_color2,
              pr.display_name seller_manager, gc.id = (select id from me) mine,
              l.asking_price_cents price_cents, coalesce(l.value_cents, p.market_value_cents) value_cents,
              coalesce(l.start_price_cents, l.asking_price_cents) start_price_cents, coalesce(l.floor_price_cents, l.asking_price_cents) floor_price_cents,
              l.rounds_unsold, l.listed_season, l.listed_round
         from g join transfer_listings l on l.game_id = g.id and l.status = 'active' and l.player_id is not null
         join game_players p on p.id = l.player_id
         join game_clubs gc on gc.id = l.seller_club_id
         left join profiles pr on pr.id = gc.manager_user_id
       union all
       select l.id, l.origin, null, sp.display_name, sp.position_group, sp.position_detail, sp.age_at_import, sp.initial_ovr,
              case when sp.initial_potential >= 88 then 'A' when sp.initial_potential >= 82 then 'B' when sp.initial_potential >= 75 then 'C'
                   when sp.initial_potential >= 68 then 'D' else 'E' end,
              coalesce(l.external_club_name, 'Clube estrangeiro'), null, null, null, null, false,
              l.asking_price_cents, l.value_cents, l.start_price_cents, l.floor_price_cents, l.rounds_unsold, l.listed_season, l.listed_round
         from g join transfer_listings l on l.game_id = g.id and l.status = 'active' and l.origin = 'external'
         join dataset_snapshot_players sp on sp.snapshot_id = g.snap and sp.source_player_id = l.source_player_id
     )
     select r.*, (case when r.origin = 'manager' then 999 else r.rounds_unsold end) ending from rows r
      where ($3::text is null or r.position_group = $3)
        and ($4::bigint is null or r.price_cents <= $4)
        and r.ovr >= $5
      order by ${order}, r.id
      limit 120`,
    [gameId, userId, f.position ?? null, f.maxPrice ? f.maxPrice * 100 : null, f.minOvr ?? 1])).rows);
}

/** Sales and purchases from the list in the last rounds (the "ticker"). */
export async function getListingActivity(userId: string, gameId: string, n = 8) {
  return withUser(userId, async (c) => (await c.query<{
    id: string; player_id: string | null; name: string | null; origin: string; status: string; sold_price_cents: string | null;
    buyer_name: string | null; seller_name: string | null; closed_round: number | null;
  }>(
    `select l.id, l.player_id, p.name_snapshot name, l.origin, l.status, l.sold_price_cents, b.name_snapshot buyer_name,
            coalesce(s.name_snapshot, l.external_club_name) seller_name, l.closed_round
       from transfer_listings l
       left join game_players p on p.id = l.player_id
       left join game_clubs b on b.id = l.buyer_club_id
       left join game_clubs s on s.id = l.seller_club_id
      where l.game_id = $1 and l.status = 'sold' and l.buyer_club_id is not null
      order by l.closed_at desc nulls last limit $2`, [gameId, n])).rows);
}

/** Players of my squad that could go on the list, with the allowed price range. */
export async function getSellable(userId: string, clubId: string) {
  return withUser(userId, async (c) => (await c.query<{ id: string; name: string; position_group: string; ovr: number; value_cents: string; listed: boolean }>(
    `select p.id, p.name_snapshot name, p.position_group, p.current_ovr ovr, p.market_value_cents value_cents,
            exists (select 1 from transfer_listings l where l.player_id = p.id and l.status = 'active') listed
       from game_players p where p.club_id = $1 order by p.current_ovr desc`, [clubId])).rows);
}

/** The active listing of one game player, if any (player page). */
export async function getPlayerListing(userId: string, playerId: string) {
  return withUser(userId, async (c) => (await c.query<{ id: string; origin: string; price_cents: string; floor_price_cents: string | null; start_price_cents: string | null; rounds_unsold: number }>(
    `select id, origin, asking_price_cents price_cents, floor_price_cents, start_price_cents, rounds_unsold
       from transfer_listings where player_id = $1 and status = 'active'`, [playerId])).rows[0] ?? null);
}
