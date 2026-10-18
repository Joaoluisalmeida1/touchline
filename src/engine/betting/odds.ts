/**
 * betting-v1 — 1X2 odds from the strength model (same inputs the board uses for "expected points"): strength
 * difference with home advantage → win/draw/loss probabilities → decimal odds with a 7% house margin.
 */
import { clamp, sigmoid } from "../common/rng";

export const BETTING_VERSION = "betting-v1";
export const MARGIN = 0.07;
export const MIN_STAKE_CENTS = 1_000_000; // €10k

export function probabilities(homeStrength: number, awayStrength: number): { home: number; draw: number; away: number } {
  const diff = homeStrength - awayStrength + 1.5;
  const draw = clamp(0.29 - 0.012 * Math.abs(diff), 0.14, 0.29);
  const s = sigmoid(0.22 * diff);
  return { home: (1 - draw) * s, draw, away: (1 - draw) * (1 - s) };
}

const toOdds = (p: number) => Math.round(clamp(1 / (p * (1 + MARGIN)), 1.05, 30) * 100) / 100;

export function odds(homeStrength: number, awayStrength: number): { "1": number; X: number; "2": number } {
  const p = probabilities(homeStrength, awayStrength);
  return { "1": toOdds(p.home), X: toOdds(p.draw), "2": toOdds(p.away) };
}

export function outcome(homeGoals: number, awayGoals: number): "1" | "X" | "2" {
  return homeGoals > awayGoals ? "1" : homeGoals === awayGoals ? "X" : "2";
}

export const payout = (stakeCents: number, oddsValue: number) => Math.round((stakeCents * Math.round(oddsValue * 100)) / 100);
