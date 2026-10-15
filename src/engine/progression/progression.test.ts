import { describe, expect, it } from "vitest";
import { emptySeasonStats, progressPlayer, type MatchPerformance, type PlayerState } from "./progression";

const base = (o: Partial<PlayerState> = {}): PlayerState => ({
  id: "p1", version: 3, club_id: "c1", position_group: "MID", age: null, current_ovr: 75, potential_cap: 80, potential_band: "C",
  hidden_development_rate: 1, form: 0, morale: 60, fitness: 100, sharpness: 70, fatigue: 0, injured_matches: 0, injury_type: null,
  suspension_matches: 0, yellow_accumulation: 0, development_xp: 0, market_value_cents: 1_000_000_000, wage_cents: 1_000_000,
  contract_end_season: 3, season_stats: emptySeasonStats(), value_anchor_ratio: 1, physical: 60, ...o,
});
const perf = (o: Partial<MatchPerformance> = {}): MatchPerformance => ({
  minutes: 90, started: true, rating: 7, goals: 0, assists: 0, cards_yellow: 0, cards_red: 0, clean_sheet: false, stamina_end: 60,
  injury: null, team_result: "W", own_strength: 75, opp_strength: 75, ...o,
});
const ctx = (round: number) => ({ season: 1, round, clubPlayed: true, reputation: 60 });

describe("progression-v1", () => {
  it("does not change OVR outside checkpoints, even after a great game", () => {
    const { update } = progressPlayer(base(), perf({ rating: 10, goals: 3 }), ctx(1));
    expect(update.current_ovr).toBe(75);
    expect(update.development_xp).toBeGreaterThan(0);
    expect(update.expected_version).toBe(3);
  });

  it("changes OVR by at most one point at a checkpoint and logs the reason", () => {
    const { update, log } = progressPlayer(base({ development_xp: 10 }), perf(), ctx(4));
    expect(update.current_ovr).toBe(76);
    expect(log?.reason.text).toMatch(/^\+1 OVR/);
    expect(update.development_xp).toBeLessThanOrEqual(4.5);
  });

  it("form is separate from OVR and regresses when not playing", () => {
    const { update } = progressPlayer(base({ form: 2 }), null, ctx(2));
    expect(update.form).toBeLessThan(2);
    expect(update.current_ovr).toBe(75);
  });

  it("red card suspends, yellow accumulation bans at 5", () => {
    expect(progressPlayer(base(), perf({ cards_red: 1 }), ctx(1)).update.suspension_matches).toBe(2);
    expect(progressPlayer(base(), perf({ cards_red: 1, cards_yellow: 1 }), ctx(1)).update.suspension_matches).toBe(1);
    const y = progressPlayer(base({ yellow_accumulation: 4 }), perf({ cards_yellow: 1 }), ctx(1)).update;
    expect(y.suspension_matches).toBe(1);
    expect(y.yellow_accumulation).toBe(0);
  });

  it("serves suspensions only when the club plays; injuries heal per round", () => {
    expect(progressPlayer(base({ suspension_matches: 1 }), null, ctx(1)).update.suspension_matches).toBe(0);
    expect(progressPlayer(base({ suspension_matches: 1 }), null, { ...ctx(1), clubPlayed: false }).update.suspension_matches).toBe(1);
    expect(progressPlayer(base({ injured_matches: 2, injury_type: "minor" }), null, ctx(1)).update.injured_matches).toBe(1);
  });

  it("a player at his potential does not keep climbing by just playing", () => {
    let s = base({ current_ovr: 85, potential_cap: 85 });
    for (let r = 1; r <= 34; r++) {
      const { update } = progressPlayer(s, perf({ rating: 7.2 }), ctx(r));
      s = { ...s, ...update, version: s.version + 1 };
    }
    expect(s.current_ovr).toBeLessThanOrEqual(87);
  });

  it("does not inflate market value abruptly", () => {
    const { update } = progressPlayer(base({ market_value_cents: 100_000_000 }), perf(), ctx(4));
    expect(update.market_value_cents).toBeLessThan(100_000_000 * 3);
  });
});
