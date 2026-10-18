/**
 * Game creation: the server computes initial gameplay values (wages, contracts, cash — synthetic game rules,
 * not provider data) and commits everything atomically through public.create_game_tx.
 */
import type { Pool } from "pg";
import { z } from "zod";
import { hashUnit } from "../../engine/common/rng";
import { initialCashCents, initialContractEnd, weeklyWageCents } from "../../engine/economy/economy";
import { toHex } from "../../integrations/wikidata/colours";
import { asService, asUser } from "../pg";

export const CreateGameInput = z.object({
  name: z.string().trim().min(3).max(60),
  snapshotId: z.string().uuid(),
  leagueId: z.string().uuid(),
  maxManagers: z.coerce.number().int().min(2).max(20).default(20),
  tickMode: z.enum(["manual", "daily"]).default("manual"),
  timezone: z.string().default("Europe/Lisbon"),
  deadlineHour: z.coerce.number().int().min(0).max(23).default(20),
  roundIntervalHours: z.coerce.number().int().min(1).max(336).default(24),
});
export type CreateGameInputT = z.infer<typeof CreateGameInput>;

export const DEFAULT_GAME_SETTINGS = {
  points_win: 3,
  points_draw: 1,
  min_squad: 16,
  max_squad: 32,
  round_interval_hours: 24,
  deadline_hour: 20,
  ai_fills_empty_clubs: true,
};

const PALETTE = ["#1d4ed8", "#b91c1c", "#047857", "#7c3aed", "#c2410c", "#0f766e", "#be185d", "#4d7c0f", "#1e3a8a", "#a16207", "#0e7490", "#9f1239"];

export async function createGame(pool: Pool, userId: string, raw: CreateGameInputT): Promise<{ gameId: string; inviteCode: string }> {
  const input = CreateGameInput.parse(raw);
  const payload = await asService(pool, async (c) => {
    const snap = await c.query(`select id, status, league_ids from public.dataset_snapshots where id = $1`, [input.snapshotId]);
    if (!snap.rowCount || snap.rows[0].status !== "finalized") throw new Error("Dataset inválido.");
    const clubs = await c.query<{ source_club_id: string; name: string; short_name: string | null; strength: string; reputation: number; meta: Record<string, unknown> }>(
      `select dc.source_club_id, dc.name, dc.short_name, dc.strength, dc.reputation, sc.metadata_json as meta
         from public.dataset_snapshot_clubs dc join public.source_clubs sc on sc.id = dc.source_club_id
        where dc.snapshot_id = $1 and dc.league_id = $2 order by dc.name`,
      [input.snapshotId, input.leagueId],
    );
    if (clubs.rowCount! < 2) throw new Error("Esta liga não tem clubes suficientes no dataset.");
    const players = await c.query<{
      source_player_id: string; source_club_id: string; display_name: string; position_group: string; position_detail: string | null;
      initial_ovr: number; initial_potential: number; hidden_development_rate: string; base_value_eur: string; age_at_import: number | null;
      birth_date: string | null; derived_profile_json: Record<string, unknown>; derivation_json: Record<string, unknown>;
    }>(
      `select source_player_id, source_club_id, display_name, position_group, position_detail, initial_ovr, initial_potential,
              hidden_development_rate, base_value_eur, age_at_import, to_char(birth_date,'YYYY-MM-DD') birth_date,
              derived_profile_json, derivation_json
         from public.dataset_snapshot_players where snapshot_id = $1 and source_club_id = any($2) order by source_player_id`,
      [input.snapshotId, clubs.rows.map((r) => r.source_club_id)],
    );
    const repOf = new Map(clubs.rows.map((r) => [r.source_club_id, r.reputation]));
    const squadValue = new Map<string, number>();
    const playerRows = players.rows.map((p) => {
      const rep = repOf.get(p.source_club_id) ?? 50;
      const value = Number(p.base_value_eur) * 100;
      squadValue.set(p.source_club_id, (squadValue.get(p.source_club_id) ?? 0) + value);
      return {
        source_player_id: p.source_player_id, source_club_id: p.source_club_id, name: p.display_name, position_group: p.position_group,
        position_detail: p.position_detail, birth_date: p.birth_date, age: p.age_at_import, initial_ovr: p.initial_ovr,
        potential_cap: p.initial_potential, dev_rate: Number(p.hidden_development_rate),
        profile: { ...p.derived_profile_json, value_anchor_ratio: p.derivation_json?.value_anchor_ratio ?? 1 },
        morale: 60, fitness: 100, sharpness: 70, market_value_cents: value,
        wage_cents: weeklyWageCents(p.initial_ovr, rep), contract_end_season: initialContractEnd(p.source_player_id, 1),
      };
    });
    const clubRows = clubs.rows.map((cl) => ({
      source_club_id: cl.source_club_id, name: cl.name, short_name: (cl.short_name ?? cl.name.slice(0, 3)).toUpperCase(),
      // real colours from the catalog (scripts/wikidata/colours.ts) when known, else a stable palette colour
      primary_color: toHex(cl.meta?.primary_color as string) ?? PALETTE[Math.floor(hashUnit(cl.source_club_id) * PALETTE.length)],
      secondary_color: toHex(cl.meta?.secondary_color as string) ?? "#f8fafc", reputation: cl.reputation, strength: Number(cl.strength),
      cash_cents: initialCashCents(squadValue.get(cl.source_club_id) ?? 0, cl.reputation),
    }));
    return {
      name: input.name, snapshot_id: input.snapshotId, source_league_id: input.leagueId, max_managers: input.maxManagers,
      tick_mode: input.tickMode, timezone: input.timezone,
      settings: { ...DEFAULT_GAME_SETTINGS, deadline_hour: input.deadlineHour, round_interval_hours: input.roundIntervalHours },
      clubs: clubRows, players: playerRows,
    };
  });
  const gameId = await asService(pool, async (c) =>
    (await c.query<{ id: string }>(`select public.create_game_tx($1, $2) as id`, [userId, JSON.stringify(payload)])).rows[0].id);
  const inviteCode = await asUser(pool, userId, async (c) =>
    (await c.query<{ code: string }>(`select public.rotate_invite($1, 168) as code`, [gameId])).rows[0].code);
  return { gameId, inviteCode };
}
