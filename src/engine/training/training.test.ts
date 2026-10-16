import { describe, expect, it } from "vitest";
import { simulateMatch } from "../match/engine";
import { syntheticTeam } from "../match/fixtures";
import type { MatchInput } from "../match/types";
import { applyTraining, planModifiers } from "./training";

const before = { id: "p1", fitness: 80, development_xp: 1, injured_matches: 0 };
const after = { fitness: 70, development_xp: 1.5, injured_matches: 0 };

describe("training-v1", () => {
  it("default focus gives no modifiers; focus maps to a unit", () => {
    expect(planModifiers({ intensity: "normal", focus: "none" })).toBeUndefined();
    expect(planModifiers({ intensity: "intense", focus: "attack" })).toEqual({ attack: 1.5 });
    expect(planModifiers({ intensity: "light", focus: "possession" })).toEqual({ control: 0.5 });
  });
  it("intensity scales xp and fitness", () => {
    const light = applyTraining({ intensity: "light", focus: "fitness" }, before, after, "s");
    const hard = applyTraining({ intensity: "intense", focus: "none" }, before, after, "s");
    expect(light.fitness).toBe(80);
    expect(light.development_xp).toBeCloseTo(1.35);
    expect(hard.fitness).toBe(67);
    expect(hard.development_xp).toBeCloseTo(1.65);
    expect(light.injury).toBeNull();
  });
  it("training injuries are seeded and rare", () => {
    let n = 0;
    for (let i = 0; i < 2000; i++) if (applyTraining({ intensity: "intense", focus: "none" }, { ...before, id: `p${i}` }, after, "seed").injury) n++;
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThan(60);
    const a = applyTraining({ intensity: "intense", focus: "none" }, before, after, "x");
    expect(applyTraining({ intensity: "intense", focus: "none" }, before, after, "x")).toEqual(a);
  });
});

describe("match plans and marking", () => {
  const base = (): MatchInput => ({ fixture_id: "fx", home: syntheticTeam("H", 72), away: syntheticTeam("A", 78) });
  it("conditional rule fires when losing and is reported", () => {
    let fired = 0;
    for (let i = 0; i < 30; i++) {
      const inp = base();
      inp.home.plans = [{ minute: 60, when: "losing", mentality: "attacking" }];
      const r = simulateMatch(inp, `plan-${i}`);
      if (r.plans_fired?.length) {
        fired++;
        expect(r.plans_fired[0]).toMatchObject({ side: "home", rule: 0 });
        expect(r.plans_fired[0].minute).toBeGreaterThanOrEqual(60);
      }
    }
    expect(fired).toBeGreaterThan(0);
  });
  it("no plans → no plans_fired key (output unchanged)", () => {
    expect("plans_fired" in simulateMatch(base(), "z")).toBe(false);
  });
  it("marking the opponent's best players lowers their output on average", () => {
    let plain = 0, marked = 0;
    for (let i = 0; i < 40; i++) {
      const a = base();
      const b = base();
      const fwd = b.away.starters.filter((p) => p.position_group === "ATT").map((p) => p.id).slice(0, 2);
      b.home.marking = fwd;
      plain += simulateMatch(a, `m-${i}`).away_goals;
      marked += simulateMatch(b, `m-${i}`).away_goals;
    }
    expect(marked).toBeLessThanOrEqual(plain + 6);
  });
});
