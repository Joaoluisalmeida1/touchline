/** Helpers to build synthetic engine inputs for tests and calibration (FICTIONAL players). */
import { DEFAULT_TACTICS, type Formation, type Tactics } from "../common/types";
import { FORMATION_SLOTS, SLOT_GROUP } from "../lineup/formations";
import type { MatchPlayerInput, MatchTeamInput } from "./types";

export function syntheticTeam(
  clubId: string,
  ovr: number,
  opts: { formation?: Formation; tactics?: Partial<Tactics>; spread?: number; fitness?: number } = {},
): MatchTeamInput {
  const formation = opts.formation ?? "4-3-3";
  const slots = FORMATION_SLOTS[formation];
  const spread = opts.spread ?? 0;
  const starters: MatchPlayerInput[] = slots.map((slot, i) => ({
    id: `${clubId}-s${i}`,
    name: `${clubId} Starter ${i}`,
    position_group: SLOT_GROUP[slot],
    slot,
    ovr: Math.round(ovr + (i % 3 - 1) * spread),
    fitness: opts.fitness ?? 100,
    form: 0,
    morale: 60,
    sharpness: 80,
  }));
  const benchGroups = ["GK", "DEF", "DEF", "MID", "MID", "ATT", "ATT", "MID", "DEF"] as const;
  const bench: MatchPlayerInput[] = benchGroups.map((g, i) => ({
    id: `${clubId}-b${i}`, name: `${clubId} Sub ${i}`, position_group: g, ovr: ovr - 4, fitness: 100, form: 0, morale: 60, sharpness: 60,
  }));
  return { club_id: clubId, name: clubId, formation, tactics: { ...DEFAULT_TACTICS, ...opts.tactics }, starters, bench };
}
