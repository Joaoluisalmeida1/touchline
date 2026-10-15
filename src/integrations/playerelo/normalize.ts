/** Map raw PlayerElo rows to catalog records with per-field provenance. Never invents values. */
import type { PositionGroup } from "../../engine/common/types";
import type { ClubRow, LeagueRow, PlayerRow } from "./schemas";

export interface NormalizedPlayer {
  external_id: string;
  display_name: string;
  position_group: PositionGroup | null;
  position_detail: string | null;
  club_external_id: string | null;
  club_name: string | null;
  league_external_id: string | null;
  league_name: string | null;
  elo: number | null;
  ear_180: number | null;
  ear_12m: number | null;
  ear_career: number | null;
  games_played: number | null;
  total_minutes: number | null;
  birth_date: string | null;
  nationality: string | null;
  market_value_eur: number | null;
  attributes: Record<string, unknown>;
  flags: string[];
}

const pick = <T>(...vals: (T | null | undefined)[]): T | null => {
  for (const v of vals) if (v !== null && v !== undefined && v !== "") return v;
  return null;
};

export function mapPositionGroup(group: string | null, position: string | null): PositionGroup | null {
  const g = group?.toUpperCase();
  if (g === "GK" || g === "DEF" || g === "MID" || g === "ATT") return g;
  if (g === "FWD" || g === "FW") return "ATT";
  const p = (position ?? "").toLowerCase();
  if (!p) return null;
  if (/goal|keeper|^gk$/.test(p)) return "GK";
  if (/defen|back|^d$|^cb|^lb|^rb/.test(p)) return "DEF";
  if (/midfield|^m$|^cm|^dm|^am/.test(p)) return "MID";
  if (/forward|attack|striker|wing|^f$|^st|^cf/.test(p)) return "ATT";
  return null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizePlayer(r: PlayerRow, ctx: { endpoint: string; leagueExternalId?: string; clubExternalId?: string }): NormalizedPlayer | null {
  const external_id = pick(r.player_id, r.id);
  const name = pick(r.player_name, r.name);
  if (!external_id || !name) return null;
  const flags: string[] = [];
  const position_group = mapPositionGroup(r.position_group ?? null, r.position ?? null);
  if (!position_group) flags.push("position_unknown");
  const rawDob = pick(r.date_of_birth, r.birth_date, r.dob);
  const birth_date = rawDob && ISO_DATE.test(rawDob.slice(0, 10)) ? rawDob.slice(0, 10) : null;
  if (!birth_date) flags.push("birth_date_unavailable");
  const elo = r.elo ?? null;
  if (elo === null) flags.push("elo_missing");
  const club_external_id = pick(r.current_team_id, ctx.clubExternalId);
  if (!club_external_id && !r.current_team) flags.push("club_missing");

  // provenance: which fields came from the provider and from which endpoint
  const provided: Record<string, string> = {};
  for (const k of ["elo", "position", "position_group", "current_team", "current_team_id", "current_league", "current_league_id",
    "games_played", "total_minutes", "ear_180", "ear_12m", "ear_career", "ear_label", "date_of_birth", "nationality", "market_value"] as const) {
    if ((r as Record<string, unknown>)[k] !== undefined && (r as Record<string, unknown>)[k] !== null) provided[k] = ctx.endpoint;
  }
  return {
    external_id: String(external_id),
    display_name: String(name).trim(),
    position_group,
    position_detail: r.position ? String(r.position) : null,
    club_external_id: club_external_id ? String(club_external_id) : null,
    club_name: r.current_team ?? null,
    league_external_id: pick(r.current_league_id, ctx.leagueExternalId),
    league_name: r.current_league ?? null,
    elo,
    ear_180: r.ear_180 ?? null,
    ear_12m: r.ear_12m ?? null,
    ear_career: r.ear_career ?? null,
    games_played: r.games_played ?? null,
    total_minutes: r.total_minutes ?? null,
    birth_date,
    nationality: pick(r.nationality, r.country),
    market_value_eur: pick(r.market_value_eur, r.market_value, r.value_eur),
    attributes: { provider_fields: provided, ear_label: r.ear_label ?? null, current_rank: r.current_rank ?? null, is_estimated: { market_value_eur: true } },
    flags,
  };
}

/** Club key when the provider gives only a team name (no id) — namespaced so it can never clash with real ids. */
export const nameKey = (league: string, name: string) => `name:${league}:${name.toLowerCase().replace(/\s+/g, " ").trim()}`;

export function normalizeLeague(r: LeagueRow): { external_id: string; name: string; country: string | null; strength: number | null } | null {
  const id = pick(r.league_id, r.id);
  const name = pick(r.name, r.league_name);
  if (!id || !name) return null;
  return { external_id: String(id), name: String(name), country: r.country ?? null, strength: pick(r.strength, r.league_elo, r.elo) };
}

export function normalizeClub(r: ClubRow): { external_id: string; name: string; league_external_id: string | null; team_elo: number | null } | null {
  const id = pick(r.club_id, r.team_id, r.id);
  const name = pick(r.name, r.club_name, r.team_name);
  if (!id || !name) return null;
  return { external_id: String(id), name: String(name), league_external_id: r.league_id ?? null, team_elo: pick(r.team_elo, r.elo) };
}
