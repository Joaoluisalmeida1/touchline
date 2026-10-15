/**
 * Match engine calibration parameters. Defaults are prototype values tuned with
 * scripts/sim-calibration (see docs/game-balance.md). They are hypotheses, not empirical truth.
 * Changing any value that alters outcomes MUST bump ENGINE_VERSION.
 */
export const ENGINE_VERSION = "match-v1.1.0";

export const ENGINE_CONFIG = {
  /** mean seconds per possession before style multipliers */
  possessionSeconds: 25,
  /** logistic scale: rating points of difference per 1 logit (smaller => stronger effect of quality) */
  ratingScale: 22,
  /** per-team, per-match performance noise in rating points ("off days"), creates realistic upsets */
  matchDayNoiseSd: 2.2,

  // ---- build-up / pressing ----
  pressTurnoverBase: { low: 0.015, medium: 0.045, high: 0.085 },
  // ---- progression to final third ----
  progressionBase: -0.15,
  // ---- chance creation in final third ----
  chanceBase: -1.55,
  homeAdvantageLogit: 0.2,
  transitionChanceBonus: 0.45,
  // ---- fouls & cards ----
  foulPerPossession: 0.13,
  yellowPerFoul: 0.17,
  directRedPerFoul: 0.002,
  penaltyPerFinalThird: 0.0032,
  offsidePerFinalThird: 0.035,
  // ---- set pieces ----
  cornerAfterFailedAttack: 0.11,
  cornerAfterSaveOrBlock: 0.33,
  cornerShotProb: 0.27,
  freeKickShotProb: 0.16,
  // ---- shooting ----
  onTargetGivenNoGoal: 0.27,
  blockedShare: 0.24,
  finishingPerPoint: 0.008,
  keeperPerPoint: 0.008,
  xgQualityPerPoint: 0.015,
  ownGoalPerCross: 0.012,
  // ---- physical ----
  staminaDrainPer90: { low: 24, medium: 30, high: 38 },
  tempoDrainMult: { slow: 0.9, normal: 1, high: 1.12 },
  injuryPer90: 0.0085,
  // ---- substitutions ----
  maxSubs: 5,
  subStaminaThreshold: 90,
  // ---- form / morale influence (bounded, small) ----
  formEffect: 0.03, // +-3% at form +-3
  moraleEffect: 0.015,
  // ---- formation structure (v1.1) ----
  /** rating points per unit of line weight above/below the 4-3-3 reference (def/mid/att lines) */
  lineEffect: { def: 1.4, mid: 1.15, att: 1.55 },
  /** header chance weight multiplier per wide slot above/below reference */
  widthHeaderEffect: 0.1,
  // ---- captain (v1.1) ----
  captainBase: 0.25,
  captainPerPoint: 0.015,
} as const;

export type EngineConfig = typeof ENGINE_CONFIG;
