/**
 * progression-v1 — form / fitness / morale / sharpness / injuries / suspensions after each round,
 * development XP accumulation and OVR checkpoints. Pure & deterministic.
 * Coefficients are prototype defaults (see docs/game-balance.md), validated by multi-season simulation.
 */
import { clamp } from "../common/rng";
import type { PositionGroup } from "../common/types";
import { smoothValueCents, targetValueCents, weeklyWageCents } from "../economy/economy";

export const PROGRESSION_VERSION = "progression-v1";

export const PROGRESSION = {
  checkpointEveryRounds: 4,
  xpPerOvr: 3.0,
  learningRate: 0.75,
  formHalfLifeMatches: 5,
  weights: { performance: 0.4, training: 0.25, age: 0.2, consistency: 0.15 },
  trainingBaseline: 0.5,
  benchTrainingXp: 0.06,
  idleDecayXp: 0.05,
  veteranDeclinePerYear: 0.045,
  yellowBanThreshold: 5,
  maxOvrAbovePotential: 2,
} as const;

export interface SeasonStats {
  apps: number; starts: number; minutes: number; goals: number; assists: number; rating_sum: number; rated: number;
  yellow: number; red: number; clean_sheets: number;
  window: { minutes: number; rating_sum: number; rated: number };
}

export const emptySeasonStats = (): SeasonStats => ({
  apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, rating_sum: 0, rated: 0, yellow: 0, red: 0, clean_sheets: 0,
  window: { minutes: 0, rating_sum: 0, rated: 0 },
});

export interface PlayerState {
  id: string;
  version: number;
  club_id: string | null;
  position_group: PositionGroup;
  age: number | null;
  current_ovr: number;
  potential_cap: number;
  potential_band: string;
  hidden_development_rate: number;
  form: number;
  morale: number;
  fitness: number;
  sharpness: number;
  fatigue: number;
  injured_matches: number;
  injury_type: string | null;
  suspension_matches: number;
  yellow_accumulation: number;
  development_xp: number;
  market_value_cents: number;
  wage_cents: number;
  contract_end_season: number;
  season_stats: Partial<SeasonStats> | null;
  value_anchor_ratio: number;
  physical: number; // profile physical 0..100
}

export interface MatchPerformance {
  minutes: number;
  started: boolean;
  rating: number | null;
  goals: number;
  assists: number;
  cards_yellow: number;
  cards_red: number;
  clean_sheet: boolean;
  stamina_end: number;
  injury: { matches: number; type: string } | null;
  team_result: "W" | "D" | "L";
  own_strength: number;
  opp_strength: number;
}

export interface RoundContext {
  season: number;
  round: number;
  /** false for clubs with a bye this round: suspensions are only served in matches */
  clubPlayed: boolean;
  /** player's club reputation (wages on renewal) */
  reputation: number;
}

export interface PlayerUpdate {
  id: string;
  expected_version: number;
  form: number;
  morale: number;
  fitness: number;
  sharpness: number;
  fatigue: number;
  injured_matches: number;
  injury_type: string | null;
  suspension_matches: number;
  yellow_accumulation: number;
  development_xp: number;
  current_ovr: number;
  market_value_cents: number;
  career_minutes_add: number;
  season_stats: SeasonStats;
}

export interface ProgressionLog {
  player_id: string;
  old_ovr: number;
  new_ovr: number;
  xp_before: number;
  xp_after: number;
  reason: Record<string, unknown>;
  algorithm_version: string;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export const isCheckpointRound = (round: number): boolean => round % PROGRESSION.checkpointEveryRounds === 0;

function normaliseStats(s: Partial<SeasonStats> | null): SeasonStats {
  const e = emptySeasonStats();
  return { ...e, ...(s ?? {}), window: { ...e.window, ...(s?.window ?? {}) } };
}

/** Age development factor (-1..1). Unknown age => small neutral value (age progression disabled). */
function ageFactor(age: number | null): number {
  if (age === null) return 0.1;
  return clamp((24 - age) / 6, -1, 1);
}

export function progressPlayer(
  s: PlayerState, perf: MatchPerformance | null, ctx: RoundContext,
): { update: PlayerUpdate; log: ProgressionLog | null } {
  const stats = normaliseStats(s.season_stats);
  const played = perf !== null && perf.minutes > 0;
  const alpha = 1 - Math.pow(0.5, 1 / PROGRESSION.formHalfLifeMatches);

  // ---- form (EWMA of opponent-adjusted performance) ----
  let form = s.form;
  if (played && perf!.rating !== null) {
    const dev = perf!.rating - 6.6 + 0.04 * (perf!.opp_strength - perf!.own_strength);
    const w = alpha * clamp(perf!.minutes / 60, 0.3, 1);
    form = form + w * (clamp(dev, -3, 3) - form);
  } else {
    form = form * 0.9; // regress to neutral
  }

  // ---- fatigue / fitness / sharpness ----
  const minutes = played ? perf!.minutes : 0;
  const fatigue = clamp(s.fatigue * 0.6 + (minutes / 90) * 20, 0, 100);
  const recovery = 30 - fatigue * 0.15 + (s.physical - 60) * 0.05;
  const base = played ? perf!.stamina_end : s.fitness;
  const fitness = Math.round(clamp(base + recovery, 0, 100));
  const sharpness = Math.round(clamp(played ? s.sharpness + Math.min(15, minutes / 6) : s.sharpness - 6, 0, 100));

  // ---- morale ----
  let morale = s.morale + (60 - s.morale) * 0.1;
  if (played) {
    morale += perf!.team_result === "W" ? 4 : perf!.team_result === "L" ? -4 : 0;
    if (perf!.rating !== null && perf!.rating >= 7.5) morale += 3;
    if (perf!.rating !== null && perf!.rating < 5.5) morale -= 3;
  } else if (ctx.clubPlayed && s.injured_matches === 0 && s.current_ovr >= 75) {
    morale -= 1.5; // good players dislike the bench
  }
  morale = Math.round(clamp(morale, 0, 100));

  // ---- injuries & suspensions ----
  let injured = Math.max(0, s.injured_matches - 1);
  let injuryType = injured > 0 ? s.injury_type : null;
  if (perf?.injury) {
    injured = perf.injury.matches;
    injuryType = perf.injury.type;
  }
  let suspension = s.suspension_matches;
  if (ctx.clubPlayed && suspension > 0 && !played) suspension -= 1; // served
  let yellowAcc = s.yellow_accumulation;
  if (perf && perf.cards_red > 0) {
    suspension += perf.cards_yellow > 0 ? 1 : 2;
  } else if (perf && perf.cards_yellow > 0) {
    yellowAcc += perf.cards_yellow;
    if (yellowAcc >= PROGRESSION.yellowBanThreshold) {
      suspension += 1;
      yellowAcc -= PROGRESSION.yellowBanThreshold;
    }
  }

  // ---- development XP ----
  const headroom = clamp((s.potential_cap - s.current_ovr) / 6, -0.6, 1.2);
  let xpGain: number;
  let perfTerm = 0;
  if (played) {
    const minutesFactor = minutes / 90;
    const oppFactor = clamp(1 + (perf!.opp_strength - s.current_ovr) / 40, 0.7, 1.3);
    perfTerm = perf!.rating !== null ? clamp((perf!.rating - 6.6) / 1.5, -1, 1) : 0;
    const W = PROGRESSION.weights;
    const contribution = minutesFactor * oppFactor * (
      W.performance * perfTerm + W.training * PROGRESSION.trainingBaseline + W.age * ageFactor(s.age) + W.consistency * (sharpness / 100));
    const load = fatigue > 70 ? 0.8 : 1;
    // positive contributions are scaled by headroom; above potential the soft cap pulls back
    xpGain = PROGRESSION.learningRate * s.hidden_development_rate * load * (contribution >= 0 ? contribution * headroom : contribution);
  } else {
    xpGain = PROGRESSION.benchTrainingXp * Math.max(0, headroom) * s.hidden_development_rate * (s.age !== null && s.age <= 21 ? 1.5 : 1);
    if (sharpness < 30) xpGain -= PROGRESSION.idleDecayXp;
  }
  if (s.age !== null && s.age >= 30) xpGain -= PROGRESSION.veteranDeclinePerYear * (s.age - 29) * 0.25;
  let xp = s.development_xp + xpGain;

  // ---- season stats ----
  if (played) {
    stats.apps += 1;
    if (perf!.started) stats.starts += 1;
    stats.minutes += minutes;
    stats.goals += perf!.goals;
    stats.assists += perf!.assists;
    if (perf!.rating !== null) {
      stats.rating_sum = r2(stats.rating_sum + perf!.rating);
      stats.rated += 1;
      stats.window.rating_sum = r2(stats.window.rating_sum + perf!.rating);
      stats.window.rated += 1;
    }
    stats.yellow += perf!.cards_yellow;
    stats.red += perf!.cards_red;
    if (perf!.clean_sheet) stats.clean_sheets += 1;
    stats.window.minutes += minutes;
  }

  // ---- OVR checkpoint ----
  let ovr = s.current_ovr;
  let log: ProgressionLog | null = null;
  let value = s.market_value_cents;
  if (isCheckpointRound(ctx.round)) {
    const xpBefore = xp;
    let delta = 0;
    if (xp >= PROGRESSION.xpPerOvr && ovr < Math.min(99, s.potential_cap + PROGRESSION.maxOvrAbovePotential)) {
      delta = 1;
      xp -= PROGRESSION.xpPerOvr;
    } else if (xp <= -PROGRESSION.xpPerOvr && ovr > 1) {
      delta = -1;
      xp += PROGRESSION.xpPerOvr;
    }
    // keep XP bounded so a stored surplus cannot cause a later burst
    xp = clamp(xp, -PROGRESSION.xpPerOvr * 1.5, PROGRESSION.xpPerOvr * 1.5);
    ovr = clamp(ovr + delta, 1, 99);
    const avg = stats.window.rated ? stats.window.rating_sum / stats.window.rated : null;
    if (delta !== 0) {
      log = {
        player_id: s.id, old_ovr: s.current_ovr, new_ovr: ovr, xp_before: r3(xpBefore), xp_after: r3(xp),
        algorithm_version: PROGRESSION_VERSION,
        reason: {
          delta, window_minutes: stats.window.minutes, window_avg_rating: avg === null ? null : r2(avg),
          headroom: r2(headroom), age_known: s.age !== null, text: explain(delta, stats.window.minutes, avg, s.age),
        },
      };
    }
    stats.window = { minutes: 0, rating_sum: 0, rated: 0 };
    const target = targetValueCents({
      ovr, position: s.position_group, age: s.age, form, anchorRatio: s.value_anchor_ratio,
      seasonsLeft: s.contract_end_season - ctx.season, potentialBand: s.potential_band,
    });
    value = smoothValueCents(s.market_value_cents, target);
  }

  return {
    update: {
      id: s.id, expected_version: s.version, form: r2(clamp(form, -3, 3)), morale, fitness, sharpness,
      fatigue: Math.round(fatigue), injured_matches: injured, injury_type: injuryType, suspension_matches: suspension,
      yellow_accumulation: yellowAcc, development_xp: r3(xp), current_ovr: ovr, market_value_cents: value,
      career_minutes_add: minutes, season_stats: stats,
    },
    log,
  };
}

function explain(delta: number, minutes: number, avg: number | null, age: number | null): string {
  const parts: string[] = [];
  if (delta > 0) parts.push("desenvolvimento consistente");
  else parts.push(age !== null && age >= 30 ? "declínio físico gradual" : "falta de ritmo/rendimento abaixo do esperado");
  parts.push(`${minutes.toLocaleString("pt-PT")} minutos no período`);
  if (avg !== null) parts.push(`nota média ${avg.toFixed(1)}`);
  return `${delta > 0 ? "+" : ""}${delta} OVR: ${parts.join(", ")}`;
}

export interface SeasonEndUpdate {
  id: string;
  expected_version: number;
  age: number | null;
  season_start_ovr: number;
  potential_cap: number;
  contract_end_season: number;
  wage_cents: number;
  form: number;
  fitness: number;
  fatigue: number;
  sharpness: number;
  season_stats: SeasonStats;
}

/** End-of-season rollover: aging (only when age is verified), auto-renewals (MVP), resets. */
export function endOfSeasonPlayer(s: PlayerState, ctx: { endingSeason: number; reputation: number }): SeasonEndUpdate {
  const age = s.age !== null ? s.age + 1 : null;
  let potential = s.potential_cap;
  if (age !== null && age >= 31) potential = Math.max(s.current_ovr, potential - 1);
  let contractEnd = s.contract_end_season;
  let wage = s.wage_cents;
  if (contractEnd <= ctx.endingSeason) {
    contractEnd = ctx.endingSeason + 2; // MVP: automatic 2-season renewal at the game wage scale
    wage = weeklyWageCents(s.current_ovr, ctx.reputation);
  }
  return {
    id: s.id, expected_version: s.version, age, season_start_ovr: s.current_ovr, potential_cap: potential,
    contract_end_season: contractEnd, wage_cents: wage, form: 0, fitness: 100, fatigue: 0,
    sharpness: Math.min(s.sharpness, 70), season_stats: emptySeasonStats(),
  };
}
