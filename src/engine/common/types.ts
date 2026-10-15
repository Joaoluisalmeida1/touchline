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

export type Formation = "4-3-3" | "4-2-3-1" | "4-4-2" | "4-1-4-1" | "3-5-2" | "5-3-2";
export const FORMATIONS: readonly Formation[] = ["4-3-3", "4-2-3-1", "4-4-2", "4-1-4-1", "3-5-2", "5-3-2"];

export type Slot = "GK" | "LB" | "CB" | "RB" | "LWB" | "RWB" | "DM" | "CM" | "AM" | "LM" | "RM" | "LW" | "RW" | "ST";

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
