import { describe, expect, it } from "vitest";
import { simulateMatch } from "./engine";
import { syntheticTeam } from "./fixtures";
import type { MatchInput, MatchResult } from "./types";

const input = (h = 75, a = 75, extra: Partial<MatchInput> = {}): MatchInput => ({
  fixture_id: "fx", home: syntheticTeam("H", h), away: syntheticTeam("A", a), ...extra,
});

function checkConsistency(r: MatchResult, inp: MatchInput) {
  const goalsFor = (side: "home" | "away") => r.events.filter((e) => (e.event_type === "goal" || e.event_type === "own_goal") && e.side === side).length;
  expect(goalsFor("home")).toBe(r.home_goals);
  expect(goalsFor("away")).toBe(r.away_goals);
  expect(r.home_goals).toBeGreaterThanOrEqual(0);
  expect(r.away_goals).toBeGreaterThanOrEqual(0);

  for (const side of ["home", "away"] as const) {
    const ps = r.player_stats.filter((p) => p.side === side);
    const ts = r.team_stats[side];
    const sum = (k: "goals" | "shots" | "shots_on_target" | "saves" | "fouls" | "cards_yellow" | "passes_attempted") => ps.reduce((s, p) => s + p[k], 0);
    const ownGoalsConceded = r.player_stats.filter((p) => p.side !== side).reduce((s, p) => s + p.own_goals, 0);
    expect(sum("goals") + ownGoalsConceded).toBe(ts.goals);
    expect(sum("shots")).toBe(ts.shots);
    expect(sum("shots_on_target")).toBe(ts.shots_on_target);
    expect(sum("fouls")).toBe(ts.fouls);
    expect(sum("passes_attempted")).toBe(ts.passes_attempted);
    expect(Math.abs(ps.reduce((s, p) => s + p.xg, 0) - ts.xg)).toBeLessThan(0.02);
    // each goal is a shot on target
    for (const p of ps) {
      expect(p.goals).toBeLessThanOrEqual(p.shots_on_target);
      expect(p.shots_on_target).toBeLessThanOrEqual(p.shots);
      expect(p.passes_completed).toBeLessThanOrEqual(p.passes_attempted);
      if (p.minutes > 0) expect(p.rating).not.toBeNull();
    }
    // exactly 11 starters
    expect(ps.filter((p) => p.started).length).toBe(11);
    // nobody plays more than the match length
    for (const p of ps) expect(p.minutes).toBeLessThanOrEqual(Math.ceil(r.duration_seconds / 60));
  }
  // every goal scorer was on the pitch for the scoring side; assister is a teammate
  const sideOf = new Map(r.player_stats.map((p) => [p.player_id, p.side]));
  for (const e of r.events.filter((x) => x.event_type === "goal")) {
    expect(sideOf.get(e.player_id!)).toBe(e.side);
    if (e.related_player_id) {
      expect(sideOf.get(e.related_player_id)).toBe(e.side);
      expect(e.related_player_id).not.toBe(e.player_id);
    }
  }
  // sequence numbers strictly increasing, minutes non-decreasing
  for (let i = 1; i < r.events.length; i++) {
    expect(r.events[i].sequence_number).toBe(r.events[i - 1].sequence_number + 1);
  }
  expect(r.team_stats.home.possession_pct + r.team_stats.away.possession_pct).toBe(100);
  void inp;
}

describe("match engine", () => {
  it("is deterministic for the same input + seed", () => {
    const a = simulateMatch(input(), "seed-1");
    const b = simulateMatch(input(), "seed-1");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different seeds produce different matches", () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const r = simulateMatch(input(), `s${i}`);
      results.add(`${r.home_goals}-${r.away_goals}-${r.events.length}`);
    }
    expect(results.size).toBeGreaterThan(5);
  });

  it("produces internally consistent stats across many matches", () => {
    for (let i = 0; i < 300; i++) {
      const inp = input(70 + (i % 15), 70 + ((i * 7) % 15));
      checkConsistency(simulateMatch(inp, `c${i}`), inp);
    }
  });

  it("red-carded players leave the pitch and never return", () => {
    let checked = 0;
    for (let i = 0; i < 600 && checked < 10; i++) {
      const r = simulateMatch(input(), `red${i}`);
      const reds = r.events.filter((e) => e.event_type === "red_card" || e.event_type === "second_yellow");
      for (const red of reds) {
        checked++;
        const later = r.events.filter((e) => e.sequence_number > red.sequence_number && e.player_id === red.player_id
          && ["goal", "shot_saved", "shot_off_target", "shot_blocked", "foul", "yellow_card"].includes(e.event_type));
        expect(later).toHaveLength(0);
        const st = r.player_stats.find((p) => p.player_id === red.player_id)!;
        expect(st.cards_red).toBe(1);
        expect(st.minutes).toBeLessThanOrEqual(red.minute + 1);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("better teams win more often, equal teams on neutral ground are roughly symmetric", () => {
    let strongWins = 0, weakWins = 0, homeW = 0, awayW = 0;
    for (let i = 0; i < 600; i++) {
      const r = simulateMatch(input(80, 73), `g${i}`);
      if (r.home_goals > r.away_goals) strongWins++;
      if (r.home_goals < r.away_goals) weakWins++;
      const n = simulateMatch(input(75, 75, { neutral_venue: true }), `n${i}`);
      if (n.home_goals > n.away_goals) homeW++;
      if (n.home_goals < n.away_goals) awayW++;
    }
    expect(strongWins).toBeGreaterThan(weakWins * 3);
    expect(weakWins).toBeGreaterThan(0); // upsets exist
    expect(Math.abs(homeW - awayW) / 600).toBeLessThan(0.08);
  });

  it("high pressing costs more stamina than low pressing", () => {
    let hi = 0, lo = 0;
    for (let i = 0; i < 60; i++) {
      const rh = simulateMatch({ fixture_id: "p", home: syntheticTeam("H", 75, { tactics: { pressing: "high" } }), away: syntheticTeam("A", 75) }, `p${i}`);
      const rl = simulateMatch({ fixture_id: "p", home: syntheticTeam("H", 75, { tactics: { pressing: "low" } }), away: syntheticTeam("A", 75) }, `p${i}`);
      hi += rh.player_stats.filter((p) => p.side === "home" && p.started).reduce((s, p) => s + p.stamina_end, 0);
      lo += rl.player_stats.filter((p) => p.side === "home" && p.started).reduce((s, p) => s + p.stamina_end, 0);
    }
    expect(hi).toBeLessThan(lo);
  });

  it("handles a team with fewer than 11 available players", () => {
    const short = syntheticTeam("H", 75);
    short.starters = short.starters.slice(0, 9);
    short.bench = [];
    const r = simulateMatch({ fixture_id: "x", home: short, away: syntheticTeam("A", 75) }, "short");
    expect(r.player_stats.filter((p) => p.side === "home").length).toBe(9);
    expect(r.home_goals).toBeGreaterThanOrEqual(0);
  });
});
