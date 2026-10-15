/**
 * initial-rating-v1 — maps provider Elo (+ small EAR / market-value adjustments) to an initial OVR,
 * derives a hidden potential, development rate, base value and confidence.
 *
 * Design rules (see docs/game-balance.md):
 *  - Elo is mapped through an ABSOLUTE reference (global PlayerElo ranking anchors) when available,
 *    never through per-league percentiles (a regular in a weak league must not out-rate an elite reserve).
 *  - Elo already aggregates performance: EAR and goals are NOT re-added as primary signals (no double counting).
 *    EAR180 is a bounded form nudge (±1.5); market value a bounded residual nudge (±1.5).
 *  - Works with Elo + position only (value/style optional).
 *  - Deterministic: same data + version + snapshot id => identical output.
 */
import { clamp, hashUnit, sigmoid } from "../common/rng";
import type { PlayerProfile, PositionGroup } from "../common/types";
import { POSITION_GROUPS } from "../common/types";

export const INITIAL_RATING_VERSION = "initial-rating-v1";

export interface RatingInputPlayer {
  key: string; // stable id (source_player_id)
  position_group: PositionGroup | null;
  elo: number | null;
  ear_180: number | null;
  market_value_eur: number | null;
  total_minutes: number | null;
  games_played: number | null;
  age: number | null; // only when verified from a licensed source
  league_key: string;
}

/** Global ranking anchors: Elo of the player at a given global rank (from GET /v1/players?offset=rank-1&limit=1). */
export interface EloAnchors {
  source: "playerelo_global_ranking";
  points: { rank: number; elo: number }[];
  fetched_at: string;
}

/** Target OVR for a global rank (FIFA-like shape). Configurable hypothesis, see docs/game-balance.md. */
export const OVR_BY_GLOBAL_RANK: [number, number][] = [
  [1, 93], [10, 90], [50, 87.5], [100, 86], [300, 83.5], [1000, 80], [3000, 76], [7000, 72],
  [15000, 67], [30000, 61], [50000, 55], [80000, 48],
];

export interface RatingParams {
  version: string;
  reference: "global_anchors" | "sample_robust";
  elo_to_ovr: [number, number][]; // (elo, ovr) knots, ascending elo
  sample: { n: number; elo_median: number | null; elo_scale: number | null; ear_median: number | null; ear_scale: number | null };
  position_offsets: Record<PositionGroup, number>;
  value_model: { a: number; b: number; sd: number; n: number } | null;
  league_position_priors: Record<string, number>;
  weights: { form_k: number; form_cap: number; market_k: number; market_cap: number };
  warnings: string[];
}

export interface DerivedRating {
  initial_ovr: number;
  initial_potential: number;
  hidden_development_rate: number;
  base_value_eur: number;
  confidence: number;
  position_group: PositionGroup;
  profile: PlayerProfile;
  derivation: Record<string, unknown>;
  flags: string[];
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const robustScale = (xs: number[], med: number): number => {
  const mad = median(xs.map((x) => Math.abs(x - med)));
  return Math.max(1e-6, mad * 1.4826);
};

function interp(knots: [number, number][], x: number): number {
  if (knots.length === 1) return knots[0][1];
  if (x <= knots[0][0]) {
    const [[x0, y0], [x1, y1]] = knots;
    return y0 + ((y1 - y0) / (x1 - x0)) * (x - x0);
  }
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1];
    const [x1, y1] = knots[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  const [x0, y0] = knots[knots.length - 2];
  const [x1, y1] = knots[knots.length - 1];
  return y1 + ((y1 - y0) / (x1 - x0)) * (x - x1);
}

const ovrForRank = (rank: number): number => {
  const k = OVR_BY_GLOBAL_RANK.map(([r, o]) => [Math.log(r), o] as [number, number]);
  return interp(k, Math.log(Math.max(1, rank)));
};

function baseEloToOvr(elo: number, params: Pick<RatingParams, "reference" | "elo_to_ovr" | "sample">): number {
  if (params.reference === "global_anchors") return interp(params.elo_to_ovr, elo);
  const z = (elo - (params.sample.elo_median ?? elo)) / (params.sample.elo_scale ?? 1);
  return 40 + 55 * sigmoid(0.64 * z + 0.109);
}

/** Fit calibration parameters from the imported sample (+ optional global anchors). Deterministic. */
export function calibrate(players: RatingInputPlayer[], anchors?: EloAnchors | null): RatingParams {
  const warnings: string[] = [];
  const withElo = players.filter((p) => p.elo !== null && Number.isFinite(p.elo));
  const elos = withElo.map((p) => p.elo as number);
  const eloMedian = elos.length ? median(elos) : null;
  const eloScale = elos.length && eloMedian !== null ? robustScale(elos, eloMedian) : null;

  let reference: RatingParams["reference"] = "sample_robust";
  let knots: [number, number][] = [];
  const validAnchors = (anchors?.points ?? []).filter((a) => a.rank >= 1 && Number.isFinite(a.elo)).sort((a, b) => a.elo - b.elo);
  // anchors must be monotone (higher rank number => lower elo)
  const monotone = validAnchors.every((a, i) => i === 0 || (a.elo >= validAnchors[i - 1].elo && a.rank <= validAnchors[i - 1].rank));
  if (validAnchors.length >= 4 && monotone) {
    reference = "global_anchors";
    knots = validAnchors.map((a) => [a.elo, ovrForRank(a.rank)] as [number, number]);
    // dedupe equal elos
    knots = knots.filter((k, i) => i === 0 || k[0] > knots[i - 1][0]);
  } else {
    warnings.push(anchors ? "anchors_invalid_fallback_sample" : "no_global_anchors_sample_relative_scale");
    if (elos.length < 200) warnings.push("small_sample_scale_unstable");
  }

  const ears = players.map((p) => p.ear_180).filter((x): x is number => x !== null && Number.isFinite(x));
  const earMedian = ears.length >= 20 ? median(ears) : null;
  const earScale = earMedian !== null ? robustScale(ears, earMedian) : null;

  const partial = { reference, elo_to_ovr: knots, sample: { n: elos.length, elo_median: eloMedian, elo_scale: eloScale, ear_median: earMedian, ear_scale: earScale } };

  // position offsets: partial (50%) correction of systematic group differences, bounded ±3, only with enough data
  const base = (p: RatingInputPlayer) => baseEloToOvr(p.elo as number, partial);
  const overall = withElo.length ? median(withElo.map(base)) : 0;
  const position_offsets = { GK: 0, DEF: 0, MID: 0, ATT: 0 } as Record<PositionGroup, number>;
  for (const g of POSITION_GROUPS) {
    const grp = withElo.filter((p) => p.position_group === g);
    if (grp.length >= 30) position_offsets[g] = clamp(0.5 * (overall - median(grp.map(base))), -3, 3);
  }

  // value model: ln(value) ~ a + b * base_ovr (OLS)
  const vs = withElo.filter((p) => p.market_value_eur && p.market_value_eur > 0);
  let value_model: RatingParams["value_model"] = null;
  if (vs.length >= 30) {
    const xs = vs.map(base);
    const ys = vs.map((p) => Math.log(p.market_value_eur as number));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
    }
    const b = sxx > 0 ? sxy / sxx : 0;
    const a = my - b * mx;
    const resid = ys.map((y, i) => y - (a + b * xs[i]));
    const sd = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / Math.max(1, resid.length - 2)) || 1;
    value_model = { a, b, sd, n: vs.length };
  } else if (vs.length > 0) warnings.push("too_few_values_for_market_adjustment");

  // priors per league+position (median base ovr), used to regularise low-minute players
  const league_position_priors: Record<string, number> = {};
  const groups = new Map<string, number[]>();
  for (const p of withElo) {
    const k = `${p.league_key}|${p.position_group ?? "MID"}`;
    groups.set(k, [...(groups.get(k) ?? []), base(p) + position_offsets[p.position_group ?? "MID"]]);
  }
  for (const [k, v] of groups) if (v.length >= 8) league_position_priors[k] = median(v);

  return {
    version: INITIAL_RATING_VERSION,
    reference,
    elo_to_ovr: knots,
    sample: partial.sample,
    position_offsets,
    value_model,
    league_position_priors,
    weights: { form_k: 0.5, form_cap: 1.5, market_k: 0.6, market_cap: 1.5 },
    warnings,
  };
}

const POSITION_VALUE_FACTOR: Record<PositionGroup, number> = { GK: 0.6, DEF: 0.85, MID: 1.0, ATT: 1.15 };
export function ageValueFactor(age: number | null): number {
  if (age === null) return 1;
  if (age <= 21) return 1.4;
  if (age <= 24) return 1.25;
  if (age <= 27) return 1.0;
  if (age <= 29) return 0.8;
  if (age <= 31) return 0.55;
  return 0.35;
}
/** Game-economy value formula (EUR). Used when the provider has no value and for in-game revaluation. */
export function formulaValueEur(ovr: number, position: PositionGroup, age: number | null): number {
  const v = 10_000_000 * Math.exp(0.18 * (ovr - 75)) * POSITION_VALUE_FACTOR[position] * ageValueFactor(age);
  return Math.max(50_000, Math.round(v / 50_000) * 50_000);
}

export const DEFAULT_PROFILES: Record<PositionGroup, PlayerProfile> = {
  GK: { attack: 5, defense: 40, creation: 25, physical: 60, keeper: 100, set_pieces: 10, source: "position_default" },
  DEF: { attack: 30, defense: 85, creation: 40, physical: 70, keeper: 0, set_pieces: 35, source: "position_default" },
  MID: { attack: 55, defense: 55, creation: 80, physical: 60, keeper: 0, set_pieces: 55, source: "position_default" },
  ATT: { attack: 90, defense: 25, creation: 55, physical: 60, keeper: 0, set_pieces: 45, source: "position_default" },
};

const HEADROOM_BY_AGE: [number, number][] = [
  [17, 15], [18, 14], [19, 12], [20, 10], [21, 8], [22, 6], [23, 4.5], [24, 3], [25, 2], [26, 1.5], [27, 1], [28, 0.5], [29, 0],
];

export function derivePlayer(p: RatingInputPlayer, params: RatingParams, snapshotSeed: string): DerivedRating {
  const flags: string[] = [];
  const group: PositionGroup = p.position_group ?? "MID";
  if (!p.position_group) flags.push("position_missing_defaulted_mid");
  const u = (salt: string) => hashUnit(`${snapshotSeed}|${p.key}|${salt}`);

  // 1. base from Elo
  let base: number;
  if (p.elo === null || !Number.isFinite(p.elo)) {
    flags.push("elo_missing_prior_used");
    base = params.league_position_priors[`${p.league_key}|${group}`] ?? 60;
  } else base = baseEloToOvr(p.elo, params);
  const posOffset = params.position_offsets[group] ?? 0;

  // 2. confidence from minutes/games
  let confidence: number;
  if (p.total_minutes !== null) confidence = clamp(p.total_minutes / 2500, 0.15, 1);
  else if (p.games_played !== null) confidence = clamp(p.games_played / 30, 0.15, 1);
  else {
    confidence = 0.5;
    flags.push("sample_size_unknown");
  }

  // 3. form nudge (EAR180) — bounded, scaled by confidence
  let formAdj = 0;
  if (p.ear_180 !== null && params.sample.ear_median !== null && params.sample.ear_scale) {
    const z = (p.ear_180 - params.sample.ear_median) / params.sample.ear_scale;
    formAdj = clamp(params.weights.form_k * z, -params.weights.form_cap, params.weights.form_cap) * confidence;
  }

  // 4. market residual nudge — bounded (value reflects age/brand/expectation, not only current ability)
  let marketAdj = 0;
  let marketResidualZ: number | null = null;
  if (p.market_value_eur && p.market_value_eur > 0 && params.value_model) {
    const vm = params.value_model;
    marketResidualZ = (Math.log(p.market_value_eur) - (vm.a + vm.b * base)) / vm.sd;
    marketAdj = clamp(params.weights.market_k * marketResidualZ, -params.weights.market_cap, params.weights.market_cap);
  }

  const raw = base + posOffset + formAdj + marketAdj;
  // 5. regularise toward league/position prior for low-sample players
  const prior = params.league_position_priors[`${p.league_key}|${group}`] ?? raw;
  const shrink = 0.8 + 0.2 * confidence;
  const regularised = prior + (raw - prior) * shrink;
  const initial_ovr = Math.round(clamp(regularised, 40, 95));
  if (confidence < 0.4) flags.push("low_confidence");

  // 6. potential (hidden). Never presented as provider data.
  let potential: number;
  const quality = clamp((95 - initial_ovr) / 25, 0.2, 1);
  if (p.age !== null) {
    if (p.age >= 30) potential = initial_ovr;
    else {
      const ages = HEADROOM_BY_AGE.map(([a, h]) => [a, h] as [number, number]);
      let head = interp(ages, clamp(p.age, 17, 29)) * quality;
      if (marketResidualZ !== null && p.age <= 23) head += clamp(marketResidualZ * 1.5, 0, 3);
      head *= 0.6 + 0.8 * u("pot");
      potential = initial_ovr + Math.round(head);
    }
  } else {
    flags.push("age_unknown_progression_by_age_disabled");
    let head = (0.5 + 2.5 * u("pot")) * quality;
    if (marketResidualZ !== null) head += clamp(marketResidualZ, 0, 2);
    potential = initial_ovr + Math.round(head);
  }
  potential = clamp(potential, initial_ovr, 99);
  if (potential > 94) potential = Math.round(94 + (potential - 94) * 0.5); // soft cap
  potential = Math.max(potential, initial_ovr);

  // 7. development rate (narrow distribution)
  const n1 = u("dev1"), n2 = u("dev2");
  const gauss = Math.sqrt(-2 * Math.log(Math.max(n1, 1e-9))) * Math.cos(2 * Math.PI * n2);
  const dev = Math.round(clamp(1 + 0.1 * gauss, 0.75, 1.25) * 1000) / 1000;

  // 8. value
  const formulaValue = formulaValueEur(initial_ovr, group, p.age);
  const base_value_eur = p.market_value_eur && p.market_value_eur > 0 ? Math.round(p.market_value_eur) : formulaValue;
  if (!p.market_value_eur) flags.push("value_formula_estimate");

  const profile = { ...DEFAULT_PROFILES[group] };
  return {
    initial_ovr,
    initial_potential: potential,
    hidden_development_rate: dev,
    base_value_eur,
    confidence: Math.round(confidence * 1000) / 1000,
    position_group: group,
    profile,
    derivation: {
      version: INITIAL_RATING_VERSION,
      reference: params.reference,
      elo: p.elo,
      base: round2(base),
      position_offset: round2(posOffset),
      form_adj: round2(formAdj),
      market_adj: round2(marketAdj),
      market_residual_z: marketResidualZ === null ? null : round2(marketResidualZ),
      raw: round2(raw),
      prior: round2(prior),
      shrink: round2(shrink),
      confidence: round2(confidence),
      value_source: p.market_value_eur ? "provider_estimate" : "formula",
      value_anchor_ratio: round2(clamp(base_value_eur / formulaValue, 0.4, 2.5)),
      potential_is_inferred: true,
      flags,
    },
    flags,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
