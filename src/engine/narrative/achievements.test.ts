import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, earnedAchievements, type AchievementCtx } from "./achievements";

const base = (): AchievementCtx => ({
  results: [], position: null, round: 1, champion_seasons: 0, objectives_met: 0, facts: {}, buys: [], sale_multiples: [],
  swaps: 0, human_deals: 0, fan_mood: 50, confidence: 60, upgrades_done: 0, press_answered: 0, events_answered: 0,
  cash_cents: 100, initial_cash_cents: 100,
});
const r = (gf: number, ga: number, opp_human = false, round = 1) => ({ season: 1, round, gf, ga, opp_human });

describe("achievements-v1", () => {
  it("unique keys and nothing earned from an empty history", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.key)).size).toBe(ACHIEVEMENTS.length);
    expect(earnedAchievements(base())).toEqual([]);
  });
  it("streaks, goals and derbies", () => {
    const c = base();
    c.results = [r(1, 0), r(2, 0), r(3, 0, true), r(5, 1), r(0, 0)];
    const got = earnedAchievements(c);
    expect(got).toEqual(expect.arrayContaining(["first_win", "unbeaten_5", "wins_3", "clean_3", "thrashing", "goals_5", "derby_win"]));
    expect(got).not.toContain("unbeaten_10");
    expect(got).not.toContain("wins_5");
  });
  it("market, board and money", () => {
    const c = base();
    Object.assign(c, { buys: [25 * 100_000_000], sale_multiples: [2.4], swaps: 1, human_deals: 1, confidence: 90, fan_mood: 85, cash_cents: 250, position: 1, round: 4 });
    expect(earnedAchievements(c)).toEqual(expect.arrayContaining(["big_signing", "shrewd_seller", "swap", "friends_deal", "board_love", "ecstatic_fans", "rich", "leader"]));
  });
});
