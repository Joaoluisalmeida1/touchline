/**
 * Game economy rules (synthetic gameplay values — NOT provider data). All money in integer cents.
 * Parameters are documented in docs/game-balance.md and validated by the multi-season simulation test.
 */
import { clamp, hashUnit } from "../common/rng";
import type { PositionGroup } from "../common/types";
import { ageValueFactor, formulaValueEur } from "../rating/initial-rating";

export const ECONOMY_VERSION = "economy-v1";

export const ECONOMY = {
  wageBaseEur: 3000, // weekly wage at OVR 65, average club
  wagePerOvr: 0.13, // exp growth per OVR point
  cashSquadValueShare: 0.12,
  cashReputationEur: 40_000, // * reputation
  gateBaseEur: 150_000,
  gateRepSqEur: 60, // * rep^2 per home game
  sponsorBaseEur: 60_000,
  sponsorRepSqEur: 28, // * rep^2 per round
  winBonusEur: 120_000,
  drawBonusEur: 40_000,
  prizePoolEur: 40_000_000, // per season, split by final position
  championBonusEur: 8_000_000,
  valueSmoothing: 0.15, // share of target value adopted per checkpoint
} as const;

export const euroToCents = (eur: number): number => Math.round(eur) * 100;

export function reputationFromStrength(strength: number): number {
  return Math.round(clamp(10 + (strength - 60) * 3, 1, 100));
}

export function weeklyWageCents(ovr: number, reputation: number): number {
  const eur = ECONOMY.wageBaseEur * Math.exp(ECONOMY.wagePerOvr * (ovr - 65)) * (0.6 + 0.8 * reputation / 100);
  return euroToCents(Math.max(500, Math.round(eur / 100) * 100));
}

/** Contract end season (1..4) — deterministic per player. */
export function initialContractEnd(playerKey: string, currentSeason = 1): number {
  return currentSeason + Math.floor(hashUnit(`contract|${playerKey}`) * 4);
}

export function initialCashCents(squadValueCents: number, reputation: number): number {
  return Math.round(squadValueCents * ECONOMY.cashSquadValueShare) + euroToCents(ECONOMY.cashReputationEur * reputation);
}

export function gateReceiptsCents(homeReputation: number): number {
  return euroToCents(ECONOMY.gateBaseEur + ECONOMY.gateRepSqEur * homeReputation * homeReputation);
}

export function sponsorshipCents(reputation: number): number {
  return euroToCents(ECONOMY.sponsorBaseEur + ECONOMY.sponsorRepSqEur * reputation * reputation);
}

export function resultBonusCents(goalsFor: number, goalsAgainst: number): number {
  if (goalsFor > goalsAgainst) return euroToCents(ECONOMY.winBonusEur);
  if (goalsFor === goalsAgainst) return euroToCents(ECONOMY.drawBonusEur);
  return 0;
}

/** Prize money by final position (1-based) — linear split of the pool + champion bonus. */
export function prizeMoneyCents(position: number, clubs: number): number {
  const weights = Array.from({ length: clubs }, (_, i) => clubs - i);
  const total = weights.reduce((a, b) => a + b, 0);
  const share = (ECONOMY.prizePoolEur * weights[position - 1]) / total;
  return euroToCents(share + (position === 1 ? ECONOMY.championBonusEur : 0));
}

/**
 * In-game market value target (cents). Anchored to the provider's initial valuation ratio (brand / market premium),
 * decaying towards the formula as the game universe diverges. Form and contract length adjust it moderately.
 */
export function targetValueCents(args: {
  ovr: number; position: PositionGroup; age: number | null; form: number; anchorRatio: number;
  seasonsLeft: number; potentialBand?: string;
}): number {
  const formula = formulaValueEur(args.ovr, args.position, args.age);
  const anchor = clamp(args.anchorRatio || 1, 0.4, 2.5);
  const formF = 1 + 0.05 * clamp(args.form, -3, 3);
  const contractF = args.seasonsLeft <= 0 ? 0.7 : args.seasonsLeft === 1 ? 0.85 : 1;
  const potF = args.potentialBand === "A" ? 1.15 : args.potentialBand === "B" ? 1.07 : 1;
  return euroToCents(formula * Math.sqrt(anchor) * formF * contractF * potF);
}

/** Gradual revaluation: never jumps — moves `ECONOMY.valueSmoothing` of the way, floor €50k. */
export function smoothValueCents(currentCents: number, targetCents: number): number {
  const v = currentCents + (targetCents - currentCents) * ECONOMY.valueSmoothing;
  return Math.max(euroToCents(50_000), Math.round(v / 100_000) * 100_000);
}

export { ageValueFactor };
