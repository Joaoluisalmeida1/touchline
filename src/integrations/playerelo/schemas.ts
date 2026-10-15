/**
 * Defensive schemas for the PlayerElo API.
 *
 * VERIFIED against public docs (playerelo.football/docs, 2026-10-15):
 *   GET /v1/players        -> bare array of { player_id, player_name, elo, position, current_team, current_league, ear_label }
 *   GET /v1/players/{id}   -> { player_id, player_name, player_type, elo, position, position_group, current_team,
 *                               current_team_id, current_league, current_league_id, current_rank, games_played,
 *                               total_minutes, ear_career, ear_label, ear_12m, ear_label_12m, ear_180, ear_label_180 }
 * NOT documented (listed on /api-access without response schema): /v1/leagues, /v1/leagues/{id}/players,
 *   /v1/clubs, /v1/clubs/{id}/players, /v1/players/{id}/value, /v1/players/{id}/style, /v1/usage.
 * => every field is optional, unknown keys are preserved, and normalisers try documented names first.
 */
import { z } from "zod";

const num = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]).nullable().optional();
const str = z.union([z.string(), z.number().transform(String)]).nullable().optional();

export const PlayerRowSchema = z
  .object({
    player_id: str, id: str, player_name: str, name: str, elo: num, position: str, position_group: str,
    current_team: str, current_team_id: str, current_league: str, current_league_id: str, current_rank: num,
    games_played: num, total_minutes: num, ear_career: num, ear_label: str, ear_12m: num, ear_180: num,
    date_of_birth: str, birth_date: str, dob: str, age: num, nationality: str, country: str,
    market_value: num, market_value_eur: num, value_eur: num,
  })
  .passthrough();
export type PlayerRow = z.infer<typeof PlayerRowSchema>;

export const LeagueRowSchema = z
  .object({ league_id: str, id: str, name: str, league_name: str, country: str, elo: num, league_elo: num, strength: num })
  .passthrough();
export type LeagueRow = z.infer<typeof LeagueRowSchema>;

export const ClubRowSchema = z
  .object({ club_id: str, team_id: str, id: str, name: str, club_name: str, team_name: str, league_id: str, league: str, team_elo: num, elo: num })
  .passthrough();
export type ClubRow = z.infer<typeof ClubRowSchema>;

export const UsageSchema = z.object({ used: num, cap: num, remaining: num }).passthrough();
export type Usage = z.infer<typeof UsageSchema>;

/** Accept a bare array or a wrapped list ({data|items|players|results|leagues|clubs: [...]}). */
export function extractArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const k of ["data", "items", "players", "results", "leagues", "clubs", "squad", "rows"]) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return null;
}

export function parseRows<T>(raw: unknown, schema: z.ZodType<T>): { rows: T[]; invalid: number; shape: "array" | "wrapped" | "unknown" } {
  const arr = extractArray(raw);
  if (!arr) return { rows: [], invalid: 0, shape: "unknown" };
  const rows: T[] = [];
  let invalid = 0;
  for (const item of arr) {
    const r = schema.safeParse(item);
    if (r.success) rows.push(r.data);
    else invalid++;
  }
  return { rows, invalid, shape: Array.isArray(raw) ? "array" : "wrapped" };
}
