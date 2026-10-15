import { describe, expect, it } from "vitest";
import { createRng } from "../common/rng";
import { calibrate, derivePlayer, type EloAnchors, type RatingInputPlayer } from "./initial-rating";

// SYNTHETIC sample (fictional) — the real Elo scale must be re-checked against live API data.
function sample(n = 1500): RatingInputPlayer[] {
  const rng = createRng("rating-sample");
  const leagues = [{ k: "strong", mu: 1750 }, { k: "mid", mu: 1600 }, { k: "weak", mu: 1450 }];
  const groups = ["GK", "DEF", "MID", "ATT"] as const;
  return Array.from({ length: n }, (_, i) => {
    const lg = leagues[i % 3];
    const elo = rng.normal(lg.mu, 150);
    return {
      key: `p${i}`, position_group: groups[i % 4], elo, ear_180: rng.normal(0, 3), total_minutes: rng.int(200, 3200),
      games_played: null, age: null, league_key: lg.k,
      market_value_eur: Math.round(Math.exp(15 + (elo - 1600) / 120 + rng.normal(0, 0.5))),
    };
  });
}
// synthetic global ranking: rank r has elo decreasing log-linearly
const anchors: EloAnchors = {
  source: "playerelo_global_ranking",
  fetched_at: "2026-10-15T00:00:00Z",
  points: [1, 10, 100, 1000, 5000, 20000, 50000].map((rank) => ({ rank, elo: 2600 - 140 * Math.log(rank) })),
};

describe("initial-rating-v1", () => {
  const players = sample();
  const params = calibrate(players, anchors);
  const derive = (p: RatingInputPlayer) => derivePlayer(p, params, "snap-1");

  it("uses global anchors when available", () => {
    expect(params.reference).toBe("global_anchors");
  });

  it("is deterministic", () => {
    const a = players.slice(0, 50).map(derive);
    const b = players.slice(0, 50).map((p) => derivePlayer(p, calibrate(sample(), anchors), "snap-1"));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("keeps OVR in 40..95, elite above median, not everyone at 90", () => {
    const ovrs = players.map((p) => derive(p).initial_ovr).sort((x, y) => x - y);
    expect(ovrs[0]).toBeGreaterThanOrEqual(40);
    expect(ovrs[ovrs.length - 1]).toBeLessThanOrEqual(95);
    const med = ovrs[Math.floor(ovrs.length / 2)];
    const top = ovrs[Math.floor(ovrs.length * 0.99)];
    expect(top - med).toBeGreaterThan(6);
    expect(ovrs.filter((o) => o >= 90).length / ovrs.length).toBeLessThan(0.02);
  });

  it("a weak-league regular does not automatically beat an elite-league reserve with higher Elo", () => {
    const regular: RatingInputPlayer = { key: "reg", position_group: "MID", elo: 1650, ear_180: 5, total_minutes: 3000, games_played: null, age: null, league_key: "weak", market_value_eur: null };
    const reserve: RatingInputPlayer = { key: "res", position_group: "MID", elo: 1800, ear_180: -1, total_minutes: 400, games_played: null, age: null, league_key: "strong", market_value_eur: null };
    expect(derive(reserve).initial_ovr).toBeGreaterThan(derive(regular).initial_ovr);
  });

  it("market value 10m -> 100m at constant Elo moves OVR by at most ~1.5", () => {
    const base: RatingInputPlayer = { key: "mv", position_group: "ATT", elo: 1700, ear_180: 0, total_minutes: 2500, games_played: null, age: null, league_key: "mid", market_value_eur: 10_000_000 };
    const lo = derive(base);
    const hi = derive({ ...base, market_value_eur: 100_000_000 });
    expect(Math.abs(hi.initial_ovr - lo.initial_ovr)).toBeLessThanOrEqual(2);
    expect(hi.initial_ovr).toBeGreaterThanOrEqual(lo.initial_ovr);
  });

  it("handles nulls and flags them", () => {
    const d = derive({ key: "nul", position_group: null, elo: null, ear_180: null, total_minutes: null, games_played: null, age: null, league_key: "mid", market_value_eur: null });
    expect(d.initial_ovr).toBeGreaterThanOrEqual(40);
    expect(d.flags).toEqual(expect.arrayContaining(["position_missing_defaulted_mid", "elo_missing_prior_used", "sample_size_unknown", "age_unknown_progression_by_age_disabled", "value_formula_estimate"]));
    expect(d.initial_potential).toBeGreaterThanOrEqual(d.initial_ovr);
  });

  it("works with Elo + position only and without anchors (sample fallback flagged)", () => {
    const bare = players.map((p) => ({ ...p, ear_180: null, market_value_eur: null }));
    const pr = calibrate(bare, null);
    expect(pr.reference).toBe("sample_robust");
    expect(pr.warnings).toContain("no_global_anchors_sample_relative_scale");
    const d = derivePlayer(bare[0], pr, "s");
    expect(d.initial_ovr).toBeGreaterThan(39);
  });

  it("potential for young players with known age exceeds veterans", () => {
    const young = derive({ key: "y", position_group: "MID", elo: 1650, ear_180: 0, total_minutes: 1500, games_played: null, age: 19, league_key: "mid", market_value_eur: null });
    const vet = derive({ key: "v", position_group: "MID", elo: 1650, ear_180: 0, total_minutes: 1500, games_played: null, age: 33, league_key: "mid", market_value_eur: null });
    expect(young.initial_potential - young.initial_ovr).toBeGreaterThan(vet.initial_potential - vet.initial_ovr);
    expect(vet.initial_potential).toBe(vet.initial_ovr);
  });
});
