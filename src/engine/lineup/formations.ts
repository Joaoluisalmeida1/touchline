import type { Formation, PositionGroup, Slot } from "../common/types";
import { FORMATIONS } from "../common/types";

/**
 * Formation layouts: slot order + pitch coordinates (x 0..100 left→right, y 0..100 from own goal).
 * The slot order MUST match public.formation_slots() in SQL (generated from this file; checked by tests).
 */
type L = [Slot, number, number];
const BACK4: L[] = [["LB", 14, 28], ["CB", 37, 23], ["CB", 63, 23], ["RB", 86, 28]];
const BACK3: L[] = [["CB", 28, 24], ["CB", 50, 22], ["CB", 72, 24]];
const BACK5: L[] = [["LWB", 9, 32], ["CB", 30, 22], ["CB", 50, 21], ["CB", 70, 22], ["RWB", 91, 32]];
const GK: L = ["GK", 50, 6];

export const FORMATION_LAYOUTS: Record<Formation, L[]> = {
  "4-3-3": [GK, ...BACK4, ["CM", 30, 50], ["DM", 50, 40], ["CM", 70, 50], ["LW", 17, 76], ["ST", 50, 84], ["RW", 83, 76]],
  "4-2-3-1": [GK, ...BACK4, ["DM", 36, 41], ["DM", 64, 41], ["LW", 17, 66], ["AM", 50, 64], ["RW", 83, 66], ["ST", 50, 85]],
  "4-4-2": [GK, ...BACK4, ["LM", 14, 54], ["CM", 38, 50], ["CM", 62, 50], ["RM", 86, 54], ["ST", 38, 82], ["ST", 62, 82]],
  "4-1-4-1": [GK, ...BACK4, ["DM", 50, 38], ["LM", 14, 58], ["CM", 37, 55], ["CM", 63, 55], ["RM", 86, 58], ["ST", 50, 84]],
  "3-5-2": [GK, ...BACK3, ["LWB", 10, 50], ["CM", 32, 54], ["DM", 50, 42], ["CM", 68, 54], ["RWB", 90, 50], ["ST", 38, 82], ["ST", 62, 82]],
  "5-3-2": [GK, ...BACK5, ["CM", 28, 52], ["CM", 50, 48], ["CM", 72, 52], ["ST", 38, 82], ["ST", 62, 82]],
  "4-1-2-1-2": [GK, ...BACK4, ["DM", 50, 38], ["CM", 30, 52], ["CM", 70, 52], ["AM", 50, 65], ["ST", 38, 84], ["ST", 62, 84]],
  "4-2-2-2": [GK, ...BACK4, ["DM", 36, 42], ["DM", 64, 42], ["AM", 24, 64], ["AM", 76, 64], ["ST", 38, 84], ["ST", 62, 84]],
  "4-3-2-1": [GK, ...BACK4, ["CM", 28, 48], ["CM", 50, 44], ["CM", 72, 48], ["AM", 34, 67], ["AM", 66, 67], ["ST", 50, 85]],
  "4-4-1-1": [GK, ...BACK4, ["LM", 14, 52], ["CM", 38, 48], ["CM", 62, 48], ["RM", 86, 52], ["AM", 50, 68], ["ST", 50, 85]],
  "4-5-1": [GK, ...BACK4, ["LM", 12, 58], ["CM", 31, 52], ["CM", 50, 47], ["CM", 69, 52], ["RM", 88, 58], ["ST", 50, 83]],
  "4-2-4": [GK, ...BACK4, ["CM", 36, 48], ["CM", 64, 48], ["LW", 14, 76], ["ST", 38, 84], ["ST", 62, 84], ["RW", 86, 76]],
  "3-4-3": [GK, ...BACK3, ["LM", 12, 52], ["CM", 38, 49], ["CM", 62, 49], ["RM", 88, 52], ["LW", 18, 78], ["ST", 50, 86], ["RW", 82, 78]],
  "3-4-2-1": [GK, ...BACK3, ["LWB", 10, 50], ["CM", 38, 47], ["CM", 62, 47], ["RWB", 90, 50], ["AM", 34, 68], ["AM", 66, 68], ["ST", 50, 86]],
  "3-4-1-2": [GK, ...BACK3, ["LWB", 10, 50], ["CM", 38, 47], ["CM", 62, 47], ["RWB", 90, 50], ["AM", 50, 66], ["ST", 38, 85], ["ST", 62, 85]],
  "5-4-1": [GK, ...BACK5, ["LM", 14, 56], ["CM", 38, 51], ["CM", 62, 51], ["RM", 86, 56], ["ST", 50, 82]],
  "5-2-3": [GK, ...BACK5, ["CM", 36, 49], ["CM", 64, 49], ["LW", 18, 76], ["ST", 50, 85], ["RW", 82, 76]],
};

export const FORMATION_SLOTS: Record<Formation, Slot[]> = Object.fromEntries(
  FORMATIONS.map((f) => [f, FORMATION_LAYOUTS[f].map(([s]) => s)]),
) as Record<Formation, Slot[]>;

/** Coordinates in slot order (index i ↔ FORMATION_SLOTS[f][i]). */
export function slotCoordinates(formation: Formation): { slot: Slot; x: number; y: number }[] {
  return FORMATION_LAYOUTS[formation].map(([slot, x, y]) => ({ slot, x, y }));
}

export const SLOT_GROUP: Record<Slot, PositionGroup> = {
  GK: "GK",
  LB: "DEF", CB: "DEF", RB: "DEF", LWB: "DEF", RWB: "DEF",
  DM: "MID", CM: "MID", AM: "MID", LM: "MID", RM: "MID",
  LW: "ATT", RW: "ATT", ST: "ATT",
};

/** Lateral side of a slot, used by the engine for wide play. */
export const SLOT_SIDE: Record<Slot, "L" | "C" | "R"> = {
  GK: "C", LB: "L", CB: "C", RB: "R", LWB: "L", RWB: "R", DM: "C", CM: "C", AM: "C",
  LM: "L", RM: "R", LW: "L", RW: "R", ST: "C",
};

/** Portuguese short labels for slots (UI). */
export const SLOT_LABEL: Record<Slot, string> = {
  GK: "GR", LB: "DE", CB: "DC", RB: "DD", LWB: "AE", RWB: "AD", DM: "MDC", CM: "MC", AM: "MO",
  LM: "ME", RM: "MD", LW: "EE", RW: "ED", ST: "PL",
};
export const SLOT_NAME: Record<Slot, string> = {
  GK: "Guarda-redes", LB: "Defesa esquerdo", CB: "Defesa central", RB: "Defesa direito", LWB: "Ala esquerdo",
  RWB: "Ala direito", DM: "Médio defensivo", CM: "Médio centro", AM: "Médio ofensivo", LM: "Médio esquerdo",
  RM: "Médio direito", LW: "Extremo esquerdo", RW: "Extremo direito", ST: "Ponta de lança",
};

/**
 * How much each slot contributes to the defensive / midfield / attacking lines (sums to 1 for outfield slots),
 * and whether it provides width. Used for formation structure effects (see engine computeUnits).
 */
export const SLOT_SHAPE: Record<Slot, { def: number; mid: number; att: number; wide: number }> = {
  GK: { def: 0, mid: 0, att: 0, wide: 0 },
  CB: { def: 1, mid: 0, att: 0, wide: 0 },
  LB: { def: 0.85, mid: 0.15, att: 0, wide: 1 }, RB: { def: 0.85, mid: 0.15, att: 0, wide: 1 },
  LWB: { def: 0.55, mid: 0.4, att: 0.05, wide: 1 }, RWB: { def: 0.55, mid: 0.4, att: 0.05, wide: 1 },
  DM: { def: 0.35, mid: 0.65, att: 0, wide: 0 },
  CM: { def: 0.1, mid: 0.8, att: 0.1, wide: 0 },
  AM: { def: 0, mid: 0.55, att: 0.45, wide: 0 },
  LM: { def: 0.1, mid: 0.7, att: 0.2, wide: 1 }, RM: { def: 0.1, mid: 0.7, att: 0.2, wide: 1 },
  LW: { def: 0, mid: 0.2, att: 0.8, wide: 1 }, RW: { def: 0, mid: 0.2, att: 0.8, wide: 1 },
  ST: { def: 0, mid: 0, att: 1, wide: 0 },
};

/** Structure of a formation (line weights + width), relative to the 4-3-3 reference. */
export function formationShape(slots: readonly Slot[]): { def: number; mid: number; att: number; wide: number } {
  const s = { def: 0, mid: 0, att: 0, wide: 0 };
  for (const slot of slots) {
    const x = SLOT_SHAPE[slot];
    s.def += x.def; s.mid += x.mid; s.att += x.att; s.wide += x.wide;
  }
  return s;
}
export const REFERENCE_SHAPE = formationShape(FORMATION_SLOTS["4-3-3"]);

/* ------------------------------ positional fit ------------------------------ */

/** Fit of a specialist (preferred slot) when used in another slot. Missing pairs fall back to group rules. */
const RELATED: Partial<Record<Slot, Partial<Record<Slot, number>>>> = {
  CB: { LB: 0.9, RB: 0.9, LWB: 0.86, RWB: 0.86, DM: 0.87 },
  LB: { RB: 0.94, LWB: 0.97, RWB: 0.9, CB: 0.9, LM: 0.88 },
  RB: { LB: 0.94, RWB: 0.97, LWB: 0.9, CB: 0.9, RM: 0.88 },
  LWB: { LB: 0.96, RWB: 0.93, RB: 0.9, CB: 0.86, LM: 0.93 },
  RWB: { RB: 0.96, LWB: 0.93, LB: 0.9, CB: 0.86, RM: 0.93 },
  DM: { CM: 0.96, AM: 0.88, LM: 0.86, RM: 0.86, CB: 0.88 },
  CM: { DM: 0.95, AM: 0.95, LM: 0.92, RM: 0.92 },
  AM: { CM: 0.95, DM: 0.86, LM: 0.9, RM: 0.9, ST: 0.9, LW: 0.9, RW: 0.9 },
  LM: { RM: 0.94, CM: 0.92, AM: 0.9, DM: 0.85, LW: 0.93, LWB: 0.9 },
  RM: { LM: 0.94, CM: 0.92, AM: 0.9, DM: 0.85, RW: 0.93, RWB: 0.9 },
  LW: { RW: 0.95, ST: 0.9, LM: 0.92, AM: 0.89 },
  RW: { LW: 0.95, ST: 0.9, RM: 0.92, AM: 0.89 },
  ST: { LW: 0.9, RW: 0.9, AM: 0.88 },
};

/** In-group fit for a player with no preferred slot yet ("generalist"). */
export const GENERALIST_FIT = 0.97;
/** Familiarity (0..100 minutes-based) closes up to this share of the gap to 1.0. */
const FAMILIARITY_CLOSE = 0.8;

export interface FitPlayer {
  position_group: PositionGroup;
  position_detail?: string | null;
  preferred_slot?: Slot | null;
  familiarity?: Partial<Record<Slot, number>> | null;
}

function groupFit(group: PositionGroup, slot: Slot): number {
  const target = SLOT_GROUP[slot];
  if (group === target) return 1;
  if (target === "GK") return 0.35;
  if (group === "GK") return 0.4;
  const order: PositionGroup[] = ["DEF", "MID", "ATT"];
  const d = Math.abs(order.indexOf(group) - order.indexOf(target));
  return d === 1 ? 0.88 : 0.75;
}

/**
 * Positional fit multiplier of a player in a slot (0.35..1).
 *  - goalkeepers: 1 in goal; outfielders in goal 0.35; keepers outfield 0.40
 *  - specialists (preferred slot): 1.0 at it, RELATED values nearby, 0.9 elsewhere in-group, group rules otherwise
 *  - generalists (no preferred slot): 0.97 anywhere in their group
 *  - familiarity with the slot (grows with minutes played there) closes up to 80% of the remaining gap
 */
export function slotFit(p: FitPlayer, slot: Slot): number {
  const group = p.position_group;
  let base: number;
  if (group === "GK" || SLOT_GROUP[slot] === "GK") base = groupFit(group, slot);
  else if (p.preferred_slot) {
    if (p.preferred_slot === slot) base = 1;
    else base = RELATED[p.preferred_slot]?.[slot] ?? (SLOT_GROUP[slot] === group ? 0.9 : groupFit(group, slot));
  } else base = SLOT_GROUP[slot] === group ? GENERALIST_FIT : groupFit(group, slot);
  const fam = Math.max(0, Math.min(100, p.familiarity?.[slot] ?? 0));
  if (base < 1 && fam > 0) base += (1 - base) * FAMILIARITY_CLOSE * (fam / 100);
  return Math.round(base * 1000) / 1000;
}

/** Legacy helper (group-only fit); kept for callers that do not know the player's preferences. */
export function slotSuitability(group: PositionGroup, slot: Slot): number {
  return slotFit({ position_group: group }, slot);
}

/** Slots a player of a given group may declare as preferred. */
export const PREFERRABLE_SLOTS: Record<PositionGroup, Slot[]> = {
  GK: ["GK"],
  DEF: ["CB", "LB", "RB", "LWB", "RWB"],
  MID: ["DM", "CM", "AM", "LM", "RM"],
  ATT: ["ST", "LW", "RW"],
};

/** Familiarity gained per 90 minutes played in a slot (≈22 full matches to reach 100). */
export const FAMILIARITY_PER_90 = 4.5;
/** A generalist becomes a specialist of his most-played slot once familiarity reaches this level. */
export const AUTO_PREFERRED_THRESHOLD = 25;

export function addFamiliarity(
  fam: Partial<Record<Slot, number>> | null | undefined, slot: Slot, minutes: number,
): Partial<Record<Slot, number>> {
  const next = { ...(fam ?? {}) };
  if (minutes <= 0) return next;
  next[slot] = Math.min(100, Math.round(((next[slot] ?? 0) + (FAMILIARITY_PER_90 * minutes) / 90) * 10) / 10);
  return next;
}

/** Most familiar in-group slot if it passes the auto-specialisation threshold. */
export function inferPreferredSlot(group: PositionGroup, fam: Partial<Record<Slot, number>> | null | undefined): Slot | null {
  if (!fam) return null;
  let best: Slot | null = null, bestV = AUTO_PREFERRED_THRESHOLD - 1e-9;
  for (const s of PREFERRABLE_SLOTS[group]) {
    const v = fam[s] ?? 0;
    if (v > bestV) { best = s; bestV = v; }
  }
  return best;
}
