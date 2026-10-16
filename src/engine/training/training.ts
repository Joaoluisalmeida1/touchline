/**
 * training-v1: the weekly plan a club sets between matchdays.
 *  - before the match: the focus gives a small additive boost to one team unit (rating points, same scale as units);
 *  - after the match: intensity scales development XP and fitness recovery, and has a training-injury risk.
 * The default plan (normal, no focus) changes nothing, so clubs without a plan behave exactly as before.
 */
import { createRng } from "../common/rng";

export const TRAINING_VERSION = "training-v1";

export type Intensity = "light" | "normal" | "intense";
export type Focus = "none" | "attack" | "defense" | "possession" | "set_pieces" | "fitness" | "tactics";
export interface TrainingPlan { intensity: Intensity; focus: Focus }

export const DEFAULT_PLAN: TrainingPlan = { intensity: "normal", focus: "none" };

export const TRAINING = {
  /** unit boost (rating points) of the focus at normal intensity; ×0.5 light, ×1.5 intense */
  focusPoints: 1.0,
  intensityFocus: { light: 0.5, normal: 1, intense: 1.5 } as Record<Intensity, number>,
  xpMultiplier: { light: 0.7, normal: 1, intense: 1.3 } as Record<Intensity, number>,
  /** extra fitness recovered after the round */
  fitnessBonus: { light: 6, normal: 0, intense: -3 } as Record<Intensity, number>,
  fitnessFocusBonus: 4,
  /** per player per round */
  injuryChance: { light: 0, normal: 0.003, intense: 0.012 } as Record<Intensity, number>,
} as const;

export function planModifiers(plan: TrainingPlan | null | undefined): { control?: number; attack?: number; defense?: number } | undefined {
  if (!plan || plan.focus === "none" || plan.focus === "fitness") return undefined;
  const k = TRAINING.focusPoints * TRAINING.intensityFocus[plan.intensity];
  switch (plan.focus) {
    case "attack": return { attack: k };
    case "defense": return { defense: k };
    case "possession": return { control: k };
    case "set_pieces": return { attack: round2(k * 0.5) };
    case "tactics": return { control: round2(k * 0.4), attack: round2(k * 0.3), defense: round2(k * 0.3) };
  }
}

export interface TrainingPlayerIn {
  id: string;
  fitness: number;
  development_xp: number;
  injured_matches: number;
}

export interface TrainingAdjust {
  fitness: number;
  development_xp: number;
  injury: { matches: number; type: string } | null;
}

/**
 * Post-round adjustment of one player's already-progressed values.
 * `before` = state at the start of the round, `after` = values from progressPlayer.
 */
export function applyTraining(
  plan: TrainingPlan | null | undefined, before: TrainingPlayerIn, after: { fitness: number; development_xp: number; injured_matches: number },
  seed: string,
): TrainingAdjust {
  const p = plan ?? DEFAULT_PLAN;
  const xpGain = after.development_xp - before.development_xp;
  const xp = before.development_xp + xpGain * TRAINING.xpMultiplier[p.intensity];
  const fit = after.fitness + TRAINING.fitnessBonus[p.intensity] + (p.focus === "fitness" ? TRAINING.fitnessFocusBonus : 0);
  let injury: TrainingAdjust["injury"] = null;
  const chance = TRAINING.injuryChance[p.intensity];
  if (chance > 0 && after.injured_matches === 0) {
    const rng = createRng(`${seed}|${before.id}`);
    if (rng.chance(chance)) injury = { matches: rng.int(1, 3), type: "Lesão no treino" };
  }
  return { fitness: Math.max(0, Math.min(100, Math.round(fit))), development_xp: Math.round(xp * 1000) / 1000, injury };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
