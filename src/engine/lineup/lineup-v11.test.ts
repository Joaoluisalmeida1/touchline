import { describe, expect, it } from "vitest";
import { FORMATIONS } from "../common/types";
import { simulateMatch, previewTeamStrength } from "../match/engine";
import { syntheticTeam } from "../match/fixtures";
import { autoPickLineup, resolveLineup, type SquadPlayer } from "./autopick";
import {
  FORMATION_LAYOUTS, FORMATION_SLOTS, GENERALIST_FIT, addFamiliarity, inferPreferredSlot, slotFit,
} from "./formations";
import { DEFAULT_ROLE, ROLES, resolveRole, rolesForSlot } from "./roles";

describe("formations v1.1", () => {
  it("every formation has 11 slots, exactly one GK and on-pitch coordinates", () => {
    expect(FORMATIONS.length).toBe(17);
    for (const f of FORMATIONS) {
      const l = FORMATION_LAYOUTS[f];
      expect(l).toHaveLength(11);
      expect(l.filter(([s]) => s === "GK")).toHaveLength(1);
      for (const [, x, y] of l) {
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(100);
      }
      const keys = new Set(l.map(([, x, y]) => `${x},${y}`));
      expect(keys.size).toBe(11);
    }
  });
  it("every slot has a neutral default role and the defaults carry no modifiers", () => {
    for (const f of FORMATIONS) for (const s of FORMATION_SLOTS[f]) {
      const d = resolveRole(s, null);
      expect(d.id).toBe(DEFAULT_ROLE[s]);
      expect(d.mods).toEqual({});
      expect(rolesForSlot(s).length).toBeGreaterThanOrEqual(s === "GK" ? 2 : 3);
    }
    expect(resolveRole("CB", "st_false9").id).toBe("cb"); // invalid role for slot → default
    expect(new Set(ROLES.map((r) => r.id)).size).toBe(ROLES.length);
  });
});

describe("positional fit", () => {
  it("generalists play 0.97 in-group; specialists 1.0 at their slot and less elsewhere", () => {
    expect(slotFit({ position_group: "DEF" }, "LB")).toBe(GENERALIST_FIT);
    expect(slotFit({ position_group: "DEF", preferred_slot: "LB" }, "LB")).toBe(1);
    expect(slotFit({ position_group: "DEF", preferred_slot: "LB" }, "RB")).toBe(0.94);
    expect(slotFit({ position_group: "DEF", preferred_slot: "CB" }, "LB")).toBe(0.9);
    expect(slotFit({ position_group: "MID", preferred_slot: "LM" }, "LW")).toBe(0.93); // cross-group related
    expect(slotFit({ position_group: "MID" }, "ST")).toBe(0.88);
    expect(slotFit({ position_group: "GK" }, "GK")).toBe(1);
    expect(slotFit({ position_group: "DEF" }, "GK")).toBe(0.35);
  });
  it("familiarity closes the gap gradually and auto-specialises", () => {
    let fam = {};
    for (let i = 0; i < 6; i++) fam = addFamiliarity(fam, "RB", 90);
    expect(fam).toEqual({ RB: 27 });
    const f = slotFit({ position_group: "DEF", familiarity: fam }, "RB");
    expect(f).toBeGreaterThan(GENERALIST_FIT);
    expect(f).toBeLessThan(1);
    expect(inferPreferredSlot("DEF", fam)).toBe("RB");
    expect(inferPreferredSlot("DEF", { RB: 10 })).toBeNull();
    for (let i = 0; i < 40; i++) fam = addFamiliarity(fam, "RB", 90);
    expect((fam as { RB: number }).RB).toBe(100);
  });
});

function squad(): SquadPlayer[] {
  const groups = ["GK", "GK", "DEF", "DEF", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "MID", "MID", "ATT", "ATT", "ATT", "ATT"] as const;
  return groups.map((g, i) => ({
    id: `p${String(i).padStart(2, "0")}`, position_group: g, current_ovr: 70 + (i % 5), fitness: i % 4 === 0 ? 55 : 100,
    injured_matches: 0, suspension_matches: 0, apps: i % 3 === 0 ? 20 : 2,
  }));
}

describe("auto-pick modes and roles in saved lineups", () => {
  it("rest mode avoids tired players more than best mode", () => {
    const sq = squad();
    const tired = new Set(sq.filter((p) => p.fitness < 60).map((p) => p.id));
    const count = (m: "best" | "rest") => autoPickLineup(sq, "4-3-3", m).starters.filter((s) => tired.has(s.player_id)).length;
    expect(count("rest")).toBeLessThanOrEqual(count("best"));
  });
  it("keeps valid roles from the saved lineup and resets invalid ones", () => {
    const sq = squad();
    const auto = autoPickLineup(sq, "4-4-2");
    const saved = {
      formation: "4-4-2",
      starters: auto.starters.map((s) => ({ ...s, role: s.slot === "ST" ? "st_target" : s.slot === "CB" ? "w_inside" : s.role })),
      bench: auto.bench,
    };
    const r = resolveLineup(sq, saved);
    expect(r.starters.filter((s) => s.slot === "ST").every((s) => s.role === "st_target")).toBe(true);
    expect(r.starters.filter((s) => s.slot === "CB").every((s) => s.role === "cb")).toBe(true);
  });
  it("every formation produces a full XI", () => {
    for (const f of FORMATIONS) expect(autoPickLineup(squad(), f).starters).toHaveLength(11);
  });
});

describe("engine v1.1 features", () => {
  it("designated penalty taker takes the penalties while on the pitch", () => {
    let pens = 0, byTaker = 0;
    for (let i = 0; i < 400 && pens < 25; i++) {
      const home = syntheticTeam("H", 72);
      home.instructions = { penalty_taker: "H-s9" };
      const r = simulateMatch({ fixture_id: `p${i}`, home, away: syntheticTeam("A", 72) }, `pen-${i}`);
      for (let k = 0; k < r.events.length; k++) {
        const e = r.events[k];
        if (e.event_type !== "penalty_awarded" || e.side !== "home") continue;
        const next = r.events.slice(k + 1).find((x) => x.side === "home" && (x.event_type === "goal" || x.event_type === "penalty_missed"));
        if (!next) continue;
        pens++;
        const subbedOff = r.events.some((x) => x.event_type === "substitution" && x.related_player_id === "H-s9" && x.sequence_number < e.sequence_number);
        if (next.player_id === "H-s9" || subbedOff) byTaker++;
      }
    }
    expect(pens).toBeGreaterThan(5);
    expect(byTaker).toBe(pens);
  });
  it("strength preview reflects formation structure and captaincy", () => {
    const base = previewTeamStrength(syntheticTeam("T", 72, { formation: "4-3-3" }));
    const att = previewTeamStrength(syntheticTeam("T", 72, { formation: "4-2-4" }));
    expect(att.attack).toBeGreaterThan(base.attack);
    expect(att.control).toBeLessThan(base.control);
    const capped = syntheticTeam("T", 72, { formation: "4-3-3" });
    capped.instructions = { captain: capped.starters[3].id };
    const c = previewTeamStrength(capped);
    expect(c.attack).toBeGreaterThan(base.attack);
  });
  it("is still deterministic with roles and instructions", () => {
    const mk = () => {
      const h = syntheticTeam("H", 74, { formation: "3-4-2-1" });
      h.starters = h.starters.map((p) => (p.slot === "AM" ? { ...p, role: "am_shadow" } : p));
      h.instructions = { captain: h.starters[1].id, corner_taker: h.starters[6].id };
      return { fixture_id: "det", home: h, away: syntheticTeam("A", 71, { formation: "5-4-1" }) };
    };
    expect(simulateMatch(mk(), "seed-x")).toEqual(simulateMatch(mk(), "seed-x"));
  });
});
