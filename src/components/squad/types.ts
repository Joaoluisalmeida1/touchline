import type { Formation, LineupInstructions, PositionGroup, Slot, Tactics } from "@/engine/common/types";

/** Client-side view of a squad player (no hidden fields such as exact potential). */
export interface SquadP {
  id: string;
  name: string;
  group: PositionGroup;
  preferred_slot: Slot | null;
  preferred_slot_season: number | null;
  familiarity: Partial<Record<Slot, number>>;
  shirt: number | null;
  ovr: number;
  ovr_delta: number;
  potential_band: string;
  age: number | null;
  form: number;
  fitness: number;
  morale: number;
  sharpness: number;
  injured: number;
  injury_type: string | null;
  suspended: number;
  listed: boolean;
  value_cents: number;
  wage_cents: number;
  contract_end: number;
  stats: { apps: number; starts: number; goals: number; assists: number; minutes: number; avg: number | null; yellow: number; red: number; clean_sheets: number };
  recent: (number | null)[];
  profile: { attack: number; defense: number; creation: number; physical: number; set_pieces: number; keeper: number; individual: boolean };
}

export interface ClubLook {
  name: string;
  short: string;
  primary: string;
  secondary: string;
}

export interface EditorState {
  formation: Formation;
  /** player id per formation slot index (null = empty) */
  xi: (string | null)[];
  /** role id per formation slot index */
  roles: string[];
  bench: string[];
  tactics: Tactics;
  ins: LineupInstructions;
}

export interface PresetPayload {
  formation: Formation;
  starters: { player_id: string; slot: Slot; role?: string | null }[];
  bench: string[];
  tactics: Tactics;
  instructions: LineupInstructions;
}

export const isAvailableP = (p: SquadP) => p.injured === 0 && p.suspended === 0;
export const surname = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return /^(jr\.?|júnior|junior|filho|neto)$/i.test(last) && parts.length > 2 ? `${parts[parts.length - 2]} ${last}` : last;
};
