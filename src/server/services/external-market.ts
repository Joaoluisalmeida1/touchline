/**
 * Signing a player from outside the game's league. The economy rules (wage, contract) are TS-side like game creation;
 * public.sign_external_player_tx re-checks membership, price, funds, squad size and uniqueness atomically.
 */
import type { Pool } from "pg";
import { initialContractEnd, weeklyWageCents } from "../../engine/economy/economy";
import { asService } from "../pg";

export type ExternalSignResult =
  | { status: "accepted"; player_id: string }
  | { status: "rejected"; reason: string; counter_amount_cents: number };

export async function signExternalPlayer(pool: Pool, userId: string, gameId: string, sourcePlayerId: string, amountCents: number): Promise<ExternalSignResult> {
  return asService(pool, async (c) => {
    // market-v2: players from other leagues are bought through the Transfer List only
    const mode = (await c.query<{ m: string }>(`select coalesce(settings_json->>'market', 'osm') m from public.games where id = $1`, [gameId])).rows[0]?.m;
    if (mode === "osm") await c.query(`select public._fail('ai_list_only', 'Os jogadores de outras ligas aparecem na Lista de Transferências.')`);
    const ctx = await c.query<{ ovr: number; reputation: number; season: number; profile: Record<string, unknown>; anchor: unknown }>(
      `select sp.initial_ovr ovr, gc.reputation, g.current_season season, sp.derived_profile_json profile,
              sp.derivation_json->'value_anchor_ratio' anchor
         from games g
         join game_clubs gc on gc.game_id = g.id and gc.manager_user_id = $2
         join dataset_snapshot_players sp on sp.snapshot_id = g.dataset_snapshot_id and sp.source_player_id = $3
        where g.id = $1`, [gameId, userId, sourcePlayerId]);
    const row = ctx.rows[0];
    // missing club / player: let the SQL command produce the proper user-facing error
    const payload = {
      source_player_id: sourcePlayerId,
      amount_cents: amountCents,
      wage_cents: row ? weeklyWageCents(row.ovr, row.reputation) : 0,
      contract_end_season: row ? initialContractEnd(sourcePlayerId, row.season) : null,
      profile: row ? { ...row.profile, value_anchor_ratio: row.anchor ?? 1 } : undefined,
    };
    const r = await c.query<{ r: ExternalSignResult }>(`select public.sign_external_player_tx($1, $2, $3) as r`, [userId, gameId, JSON.stringify(payload)]);
    return r.rows[0].r;
  });
}
