import type { Formation, PositionGroup, Slot } from "../common/types";

/** MUST match public.formation_slots() in SQL (checked by tests/integration). */
export const FORMATION_SLOTS: Record<Formation, Slot[]> = {
  "4-3-3": ["GK", "LB", "CB", "CB", "RB", "CM", "DM", "CM", "LW", "ST", "RW"],
  "4-2-3-1": ["GK", "LB", "CB", "CB", "RB", "DM", "DM", "LW", "AM", "RW", "ST"],
  "4-4-2": ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"],
  "4-1-4-1": ["GK", "LB", "CB", "CB", "RB", "DM", "LM", "CM", "CM", "RM", "ST"],
  "3-5-2": ["GK", "CB", "CB", "CB", "LWB", "CM", "DM", "CM", "RWB", "ST", "ST"],
  "5-3-2": ["GK", "LWB", "CB", "CB", "CB", "RWB", "CM", "CM", "CM", "ST", "ST"],
};

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

/** 2D pitch coordinates (0..100, own goal at y=0) for the tactics board UI. */
export function slotCoordinates(formation: Formation): { slot: Slot; x: number; y: number }[] {
  const slots = FORMATION_SLOTS[formation];
  const byRow = new Map<number, Slot[]>();
  const rowOf = (s: Slot): number =>
    s === "GK" ? 0 : ["LB", "CB", "RB", "LWB", "RWB"].includes(s) ? 1 : s === "DM" ? 2 : ["CM", "LM", "RM"].includes(s) ? 3 : s === "AM" ? 4 : 5;
  slots.forEach((s) => byRow.set(rowOf(s), [...(byRow.get(rowOf(s)) ?? []), s]));
  const ys = [6, 26, 42, 54, 68, 84];
  const out: { slot: Slot; x: number; y: number }[] = [];
  const sideOrder = { L: 0, C: 1, R: 2 } as const;
  for (const [row, list] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...list].sort((a, b) => sideOrder[SLOT_SIDE[a]] - sideOrder[SLOT_SIDE[b]]);
    sorted.forEach((slot, i) => out.push({ slot, x: ((i + 1) * 100) / (sorted.length + 1), y: ys[row] }));
  }
  return out;
}

/**
 * Suitability multiplier of a player (by position group) in a slot.
 * Same group 1.0; adjacent outfield lines 0.88; DEF<->ATT 0.75; outfield in goal 0.35; GK outfield 0.40.
 */
export function slotSuitability(group: PositionGroup, slot: Slot, positionDetail?: string | null): number {
  const target = SLOT_GROUP[slot];
  if (group === target) {
    if (positionDetail && group !== "GK") return detailFit(positionDetail, slot);
    return 1;
  }
  if (target === "GK") return 0.35;
  if (group === "GK") return 0.4;
  const order: PositionGroup[] = ["DEF", "MID", "ATT"];
  const d = Math.abs(order.indexOf(group) - order.indexOf(target));
  return d === 1 ? 0.88 : 0.75;
}

/** Finer fit when the provider exposes a detailed position (only if verified). Conservative. */
function detailFit(detail: string, slot: Slot): number {
  const d = detail.toLowerCase();
  const wide = ["LB", "RB", "LWB", "RWB", "LM", "RM", "LW", "RW"].includes(slot);
  if (/(back|full|wing-?back)/.test(d) && slot === "CB") return 0.94;
  if (/centre-?back|center-?back/.test(d) && wide) return 0.94;
  if (/wing/.test(d) && slot === "ST") return 0.95;
  if (/(striker|centre-?forward|center-?forward)/.test(d) && wide) return 0.94;
  return 1;
}
