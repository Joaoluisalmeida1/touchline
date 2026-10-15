import { describe, expect, it } from "vitest";
import { DEFAULT_TACTICS, type Slot } from "@/engine/common/types";
import { FORMATION_SLOTS } from "@/engine/lineup/formations";
import { MAX_BENCH, autoPick, changeFormation, fromLineup, fromPreset, lineupWarnings, movePlayer, strength, toPreset, toSavePayload } from "./editor";
import type { EditorState, SquadP } from "./types";

const groups = ["GK", "GK", "DEF", "DEF", "DEF", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "MID", "MID", "ATT", "ATT", "ATT", "ATT", "ATT", "DEF", "MID"] as const;
const squad: SquadP[] = groups.map((g, i) => ({
  id: `p${String(i).padStart(2, "0")}`, name: `Jogador ${i}`, group: g, preferred_slot: null, preferred_slot_season: null, familiarity: {},
  shirt: null, ovr: 65 + (i % 9), ovr_delta: 0, potential_band: "C", age: null, form: 0, fitness: i === 5 ? 60 : 100, morale: 60, sharpness: 70,
  injured: i === 21 ? 2 : 0, injury_type: null, suspended: 0, listed: false, value_cents: 1e8, wage_cents: 1e6, contract_end: 3,
  stats: { apps: 0, starts: 0, goals: 0, assists: 0, minutes: 0, avg: null, yellow: 0, red: 0, clean_sheets: 0 }, recent: [],
  profile: { attack: 50, defense: 50, creation: 50, physical: 60, set_pieces: 40, keeper: 0, individual: false },
}));
const base = (): EditorState => autoPick(squad, fromLineup(squad, null, DEFAULT_TACTICS, {}), "best");
const ids = (st: EditorState) => [...st.xi.filter(Boolean), ...st.bench] as string[];

describe("lineup editor", () => {
  it("auto-pick fills 11 + bench without duplicates or unavailable starters", () => {
    const st = base();
    expect(st.xi.every(Boolean)).toBe(true);
    expect(new Set(ids(st)).size).toBe(ids(st).length);
    expect(st.xi).not.toContain("p21");
    expect(st.bench.length).toBeLessThanOrEqual(MAX_BENCH);
  });
  it("swaps two starters, bench↔starter, and reserve→slot without duplicating anyone", () => {
    let st = base();
    const [a, b] = [st.xi[1]!, st.xi[5]!];
    st = movePlayer(squad, st, a, { kind: "slot", index: 5 }).state;
    expect(st.xi[5]).toBe(a); expect(st.xi[1]).toBe(b);
    const sub = st.bench[0];
    const starter = st.xi[3]!;
    st = movePlayer(squad, st, sub, { kind: "slot", index: 3 }).state;
    expect(st.xi[3]).toBe(sub); expect(st.bench[0]).toBe(starter);
    const reserve = squad.find((p) => !ids(st).includes(p.id) && p.injured === 0)!;
    st = movePlayer(squad, st, reserve.id, { kind: "slot", index: 8 }).state;
    expect(st.xi[8]).toBe(reserve.id);
    expect(new Set(ids(st)).size).toBe(ids(st).length);
  });
  it("rejects unavailable players and full benches with a message", () => {
    const st = base();
    expect(movePlayer(squad, st, "p21", { kind: "slot", index: 2 }).error).toMatch(/lesionado/);
    const full = { ...st, bench: squad.filter((p) => !st.xi.includes(p.id)).slice(0, MAX_BENCH).map((p) => p.id) };
    const outsider = squad.find((p) => !full.xi.includes(p.id) && !full.bench.includes(p.id))!;
    expect(movePlayer(squad, full, outsider.id, { kind: "bench" }).error).toMatch(/banco/);
    // dropping onto a specific substitute replaces him
    const r = movePlayer(squad, full, outsider.id, { kind: "bench", index: 0 });
    expect(r.error).toBeUndefined();
    expect(r.state.bench[0]).toBe(outsider.id);
  });
  it("keeps instructions consistent (captain must start)", () => {
    let st = base();
    const cap = st.xi[4]!;
    st = { ...st, bench: st.bench.slice(0, 5), ins: { captain: cap, penalty_taker: cap } };
    st = movePlayer(squad, st, cap, { kind: "bench" }).state;
    expect(st.ins.captain).toBeNull();
    expect(st.ins.penalty_taker).toBe(cap); // still in the matchday squad
    st = movePlayer(squad, st, cap, { kind: "reserves" }).state;
    expect(st.ins.penalty_taker).toBeNull();
  });
  it("formation changes keep the XI and reset roles only where the slot changed", () => {
    let st = base();
    st = { ...st, roles: st.roles.map((r, i) => (FORMATION_SLOTS[st.formation][i] === "ST" ? "st_target" : r)) };
    const before = new Set(st.xi);
    const next = changeFormation(squad, st, "4-2-4");
    expect(new Set(next.xi)).toEqual(before);
    const slots = FORMATION_SLOTS["4-2-4"];
    const stIdx = slots.indexOf("ST");
    expect(next.roles[stIdx]).toBe(FORMATION_SLOTS[st.formation][stIdx] === "ST" ? "st_target" : "st");
    expect(next.roles).toHaveLength(11);
  });
  it("round-trips through the save payload and presets", () => {
    const st = base();
    const save = toSavePayload(st);
    expect(save.starters).toHaveLength(11);
    expect(save.starters.map((s) => s.slot).sort()).toEqual([...FORMATION_SLOTS[st.formation]].sort() as Slot[]);
    const again = fromPreset(squad, toPreset(st));
    expect(again.xi).toEqual(st.xi);
    expect(again.bench).toEqual(st.bench);
  });
  it("strength preview and warnings react to the lineup", () => {
    const st = base();
    expect(strength(squad, st)!.overall).toBeGreaterThan(40);
    const tired = { ...st, xi: st.xi.map((x, i) => (i === 2 ? "p05" : x === "p05" ? st.xi[2] : x)) };
    expect(lineupWarnings(squad, tired).some((w) => /cansado/.test(w.text))).toBe(true);
    const gkOut = { ...st, xi: st.xi.map((x, i) => (i === 0 ? "p02" : x === "p02" ? st.xi[0] : x)) };
    expect(lineupWarnings(squad, gkOut).some((w) => w.level === "error")).toBe(true);
  });
});
