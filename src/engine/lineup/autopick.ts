import type { Formation, PositionGroup, Slot } from "../common/types";
import { isFormation } from "../common/types";
import { FORMATION_SLOTS, SLOT_GROUP, slotFit } from "./formations";
import { resolveRole } from "./roles";

export interface SquadPlayer {
  id: string;
  position_group: PositionGroup;
  position_detail?: string | null;
  current_ovr: number;
  fitness: number;
  injured_matches: number;
  suspension_matches: number;
  preferred_slot?: Slot | null;
  familiarity?: Partial<Record<Slot, number>> | null;
  /** appearances this season (used by the "rotate" auto-pick mode) */
  apps?: number;
}

export interface LineupEntry {
  player_id: string;
  slot: Slot;
  role?: string | null;
}

/** best: strongest XI; rest: strongly avoid tired players; rotate: favour players with fewer appearances. */
export type AutoPickMode = "best" | "rest" | "rotate";

export interface ResolvedLineup {
  formation: Formation;
  starters: LineupEntry[];
  bench: string[];
  auto_generated: boolean;
  warnings: string[];
}

export const isAvailable = (p: SquadPlayer): boolean => p.injured_matches === 0 && p.suspension_matches === 0;

const fitnessFactor = (fitness: number, mode: AutoPickMode = "best"): number =>
  mode === "rest" ? 1 - Math.max(0, 95 - fitness) * 0.02 : 1 - Math.max(0, 85 - fitness) * 0.006;

function slotScore(p: SquadPlayer, slot: Slot, mode: AutoPickMode = "best"): number {
  const rot = mode === "rotate" ? 1 + 0.025 * Math.max(0, 12 - (p.apps ?? 0)) - 0.02 * Math.max(0, (p.apps ?? 0) - 12) : 1;
  return p.current_ovr * slotFit(p, slot) * fitnessFactor(p.fitness, mode) * rot;
}

/** Fill order: GK first, then scarce lines. Deterministic tie-break by id. */
function fillOrder(slots: Slot[]): number[] {
  const rank: Record<PositionGroup, number> = { GK: 0, DEF: 1, ATT: 2, MID: 3 };
  return slots.map((s, i) => i).sort((a, b) => rank[SLOT_GROUP[slots[a]]] - rank[SLOT_GROUP[slots[b]]] || a - b);
}

function pickBest(pool: SquadPlayer[], slot: Slot, mode: AutoPickMode = "best"): SquadPlayer | undefined {
  let best: SquadPlayer | undefined;
  let bestScore = -Infinity;
  for (const p of pool) {
    const s = slotScore(p, slot, mode);
    if (s > bestScore || (s === bestScore && best && p.id < best.id)) {
      best = p;
      bestScore = s;
    }
  }
  return best;
}

function buildBench(pool: SquadPlayer[], size = 9): string[] {
  const sorted = [...pool].sort((a, b) => b.current_ovr - a.current_ovr || (a.id < b.id ? -1 : 1));
  const bench: SquadPlayer[] = [];
  const gk = sorted.find((p) => p.position_group === "GK");
  if (gk) bench.push(gk);
  for (const p of sorted) {
    if (bench.length >= size) break;
    if (!bench.includes(p)) bench.push(p);
  }
  return bench.map((p) => p.id);
}

export function autoPickLineup(squad: SquadPlayer[], formation: Formation = "4-3-3", mode: AutoPickMode = "best"): ResolvedLineup {
  const slots = FORMATION_SLOTS[formation];
  const pool = squad.filter(isAvailable);
  const starters: (LineupEntry | null)[] = slots.map(() => null);
  const warnings: string[] = [];
  for (const idx of fillOrder(slots)) {
    const best = pickBest(pool, slots[idx], mode);
    if (!best) continue;
    starters[idx] = { player_id: best.id, slot: slots[idx], role: resolveRole(slots[idx], null).id };
    pool.splice(pool.indexOf(best), 1);
  }
  const filled = starters.filter((s): s is LineupEntry => s !== null);
  if (filled.length < 11) warnings.push(`only_${filled.length}_available`);
  return { formation, starters: filled, bench: buildBench(pool), auto_generated: true, warnings };
}

/**
 * Validate a saved lineup at deadline and deterministically correct it:
 * drops players that left / are unavailable and refills those slots with the best available.
 */
export function resolveLineup(
  squad: SquadPlayer[],
  saved: { formation: string; starters: LineupEntry[]; bench: string[] } | null,
  fallbackFormation: Formation = "4-3-3",
): ResolvedLineup {
  if (!saved || !isFormation(saved.formation)) {
    const r = autoPickLineup(squad, isFormation(fallbackFormation) ? fallbackFormation : "4-3-3");
    r.warnings.unshift(saved ? "invalid_formation_autopicked" : "no_lineup_autopicked");
    return r;
  }
  const formation = saved.formation as Formation;
  const slots = FORMATION_SLOTS[formation];
  const byId = new Map(squad.map((p) => [p.id, p]));
  const used = new Set<string>();
  const warnings: string[] = [];
  const starters: (LineupEntry | null)[] = slots.map(() => null);
  const remainingSlots = [...slots];

  for (const e of saved.starters) {
    const p = byId.get(e.player_id);
    const idx = starters.findIndex((s, i) => s === null && slots[i] === e.slot);
    if (!p) {
      warnings.push(`removed_not_in_squad:${e.player_id}`);
      continue;
    }
    if (!isAvailable(p)) {
      warnings.push(`removed_unavailable:${e.player_id}`);
      continue;
    }
    if (idx === -1 || used.has(p.id)) {
      warnings.push(`removed_invalid_slot:${e.player_id}`);
      continue;
    }
    starters[idx] = { player_id: p.id, slot: slots[idx], role: resolveRole(slots[idx], e.role).id };
    used.add(p.id);
    remainingSlots.splice(remainingSlots.indexOf(slots[idx]), 1);
  }

  const pool = squad.filter((p) => isAvailable(p) && !used.has(p.id));
  // Prefer the manager's bench order when refilling
  const benchPref = saved.bench.filter((id) => pool.some((p) => p.id === id));
  for (const idx of fillOrder(slots)) {
    if (starters[idx]) continue;
    const slot = slots[idx];
    const benchCandidate = benchPref
      .map((id) => byId.get(id)!)
      .filter((p) => pool.includes(p) && slotFit(p, slot) >= 0.88)
      .sort((a, b) => slotScore(b, slot) - slotScore(a, slot))[0];
    const best = benchCandidate ?? pickBest(pool, slot);
    if (!best) continue;
    starters[idx] = { player_id: best.id, slot, role: resolveRole(slot, null).id };
    pool.splice(pool.indexOf(best), 1);
    warnings.push(`autofilled:${slot}:${best.id}`);
  }

  const bench = saved.bench.filter((id) => pool.some((p) => p.id === id)).slice(0, 9);
  for (const id of buildBench(pool.filter((p) => !bench.includes(p.id)), 9 - bench.length)) bench.push(id);
  const filled = starters.filter((s): s is LineupEntry => s !== null);
  if (filled.length < 11) warnings.push(`only_${filled.length}_available`);
  return { formation, starters: filled, bench, auto_generated: false, warnings };
}
