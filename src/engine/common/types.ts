export type PositionGroup = "GK" | "DEF" | "MID" | "ATT";
export const POSITION_GROUPS: readonly PositionGroup[] = ["GK", "DEF", "MID", "ATT"] as const;

/** Optional per-player profile on a 0..100 scale. Missing values => position defaults. */
export interface PlayerProfile {
  attack: number;
  defense: number;
  creation: number;
  physical: number;
  keeper: number;
  set_pieces: number;
  source?: "position_default" | "provider_style" | "synthetic";
}

/** All supported formations. Layouts (slots + pitch coordinates) live in lineup/formations.ts. */
export const FORMATIONS = [
  "4-3-3", "4-2-3-1", "4-4-2", "4-1-4-1", "3-5-2", "5-3-2",
  "4-1-2-1-2", "4-2-2-2", "4-3-2-1", "4-4-1-1", "4-5-1", "4-2-4",
  "3-4-3", "3-4-2-1", "3-4-1-2", "5-4-1", "5-2-3",
] as const;
export type Formation = (typeof FORMATIONS)[number];
export const isFormation = (f: unknown): f is Formation => typeof f === "string" && (FORMATIONS as readonly string[]).includes(f);

export const SLOTS = ["GK", "LB", "CB", "RB", "LWB", "RWB", "DM", "CM", "AM", "LM", "RM", "LW", "RW", "ST"] as const;
export type Slot = (typeof SLOTS)[number];
export const isSlot = (s: unknown): s is Slot => typeof s === "string" && (SLOTS as readonly string[]).includes(s);

/** Per-match manager instructions attached to a lineup. Player ids must belong to the XI (captain) or matchday squad. */
export interface LineupInstructions {
  captain?: string | null;
  penalty_taker?: string | null;
  freekick_taker?: string | null;
  corner_taker?: string | null;
}

export interface Tactics {
  mentality: "defensive" | "balanced" | "attacking";
  tempo: "slow" | "normal" | "high";
  pressing: "low" | "medium" | "high";
  defensive_line: "low" | "medium" | "high";
  width: "narrow" | "balanced" | "wide";
  passing_directness: "short" | "mixed" | "direct";
  transitions: "possession" | "balanced" | "counter";
}

export const DEFAULT_TACTICS: Tactics = {
  mentality: "balanced",
  tempo: "normal",
  pressing: "medium",
  defensive_line: "medium",
  width: "balanced",
  passing_directness: "mixed",
  transitions: "balanced",
};
