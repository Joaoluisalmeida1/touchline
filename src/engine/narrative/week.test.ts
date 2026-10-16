import { describe, expect, it } from "vitest";
import { EVENTS, rollEvents, type EvPlayer } from "./events";
import { buildEdition } from "./newspaper";
import { pressQuestions } from "./press";
import { TRAIT_INFO, traitOf } from "./traits";
import type { RoundFacts } from "./types";

const squad: EvPlayer[] = Array.from({ length: 24 }, (_, i) => ({
  id: `p${i.toString().padStart(2, "0")}`, name: `Jogador ${i}`, ovr: 80 - i, morale: 60, form: i < 3 ? 1 : 0, fitness: 90,
  unavailable: false, apps: 12, minutes: i > 20 ? 50 : 900,
}));
const club = (last: ("W" | "D" | "L")[] = []) => ({ id: "c1", name: "Clube", reputation: 60, last_results: last, position: 3, clubs: 18 });

describe("traits-v1", () => {
  it("is stable per id and roughly follows the weights", () => {
    expect(traitOf("abc")).toBe(traitOf("abc"));
    const n: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) n[traitOf(`id-${i}`)] = (n[traitOf(`id-${i}`)] ?? 0) + 1;
    for (const t of Object.keys(TRAIT_INFO)) expect(n[t]).toBeGreaterThan(200);
  });
});

describe("events-v1", () => {
  it("is deterministic, 0–2 events, valid choices and bounded effects", () => {
    let total = 0;
    for (let r = 1; r <= 60; r++) {
      const a = rollEvents({ gameId: "g", season: 1, round: r, club: club(r % 3 ? ["L", "L"] : ["W", "W", "W"]), players: squad });
      expect(rollEvents({ gameId: "g", season: 1, round: r, club: club(r % 3 ? ["L", "L"] : ["W", "W", "W"]), players: squad })).toEqual(a);
      expect(a.length).toBeLessThanOrEqual(2);
      total += a.length;
      for (const e of a) {
        expect(e.choices.length).toBeGreaterThanOrEqual(2);
        expect(e.default_choice).toBeLessThan(e.choices.length);
        for (const c of e.choices) for (const f of c.effects) {
          if (f.type === "cash") expect(Math.abs(f.delta_cents)).toBeLessThan(100_000_000);
          if (f.type === "morale") expect(Math.abs(f.delta)).toBeLessThanOrEqual(10);
          if ("player_id" in f) expect(squad.some((p) => p.id === f.player_id)).toBe(true);
        }
      }
    }
    expect(total).toBeGreaterThan(20);
    expect(total).toBeLessThan(90);
  });
  it("respects triggers (fan protest only after defeats)", () => {
    const fan = EVENTS.find((e) => e.key === "fan_protest")!;
    const ctx = (last: ("W" | "D" | "L")[]) => ({ club: club(last), players: [], round: 5, unit: 1_000_000, rng: { next: () => 0.5 } }) as never;
    expect(fan.build(ctx(["W", "W"]))).toBeNull();
    expect(fan.build(ctx(["L", "L"]))).not.toBeNull();
  });
});

describe("press-v1", () => {
  it("asks 3 contextual questions, rival question vs a human", () => {
    const q = pressQuestions({ gameId: "g", season: 1, round: 4, total_rounds: 34,
      club: { id: "c1", name: "A", position: 1, last_results: ["W", "W"] }, opponent: { id: "c2", name: "B", position: 2, manager: "Bruno", home: true } });
    expect(q).toHaveLength(3);
    expect(q[0].key).toBe("rival");
    expect(q[0].text).toContain("Bruno");
    expect(new Set(q.map((x) => x.key)).size).toBe(3);
  });
});

describe("press stories in O Apito", () => {
  const facts = (press?: RoundFacts["press"]): RoundFacts => ({
    game_id: "g", season: 1, round: 2, total_rounds: 6,
    clubs: [{ id: "a", name: "Alfa", short: "ALF", strength: 70, manager: "Ana" }, { id: "b", name: "Beta", short: "BET", strength: 70, manager: null }],
    matches: [{ fixture_id: "f", home_id: "a", away_id: "b", home_goals: 0, away_goals: 2, home_xg: 0.5, away_xg: 1.4, goals: [], reds: [] }],
    players: [], table_before: [], table_after: [{ club_id: "b", points: 3 }, { club_id: "a", points: 0 }], head_to_head: [], ...(press ? { press } : {}),
  });
  it("no press → no press stories and identical edition", () => {
    expect(buildEdition(facts()).stories.some((s) => s.kind === "press")).toBe(false);
    expect(buildEdition(facts([]))).toEqual(buildEdition(facts()));
  });
  it("quotes the manager and judges provocations by the result", () => {
    const ed = buildEdition(facts([{ club_id: "a", opponent_id: "b", answers: [{ question: "q", tone: "provocative", text: "Vamos dar-lhes uma lição." }] }]));
    const s = ed.stories.find((x) => x.kind === "press")!;
    expect(s.body).toContain("«Vamos dar-lhes uma lição.»");
    expect(s.headline).toMatch(/Ana/);
  });
});
