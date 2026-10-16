import { describe, expect, it } from "vitest";
import { buildEdition, HEADLINES, roundAwards } from "./newspaper";
import type { NGoal, NMatch, NPlayerLine, RoundFacts } from "./types";

const g = (minute: number, club: string, scorer: string, extra: Partial<NGoal> = {}): NGoal => ({
  minute, club_id: club, scorer_id: `p-${scorer}`, scorer, assist: null, xg: 0.3, own_goal: false, penalty: false, ...extra,
});
const match = (id: string, home: string, away: string, goals: NGoal[], extra: Partial<NMatch> = {}): NMatch => ({
  fixture_id: id, home_id: home, away_id: away, goals, reds: [], home_xg: 1.2, away_xg: 0.8,
  home_goals: goals.filter((x) => x.club_id === home).length, away_goals: goals.filter((x) => x.club_id === away).length, ...extra,
});
const pl = (id: string, club: string, group: NPlayerLine["group"], rating: number, goals = 0): NPlayerLine => ({
  id, name: `Jogador ${id}`, club_id: club, group, rating, goals, assists: 0, minutes: 90,
});

function facts(over: Partial<RoundFacts> = {}): RoundFacts {
  return {
    game_id: "g1", season: 1, round: 8, total_rounds: 14,
    clubs: [
      { id: "A", name: "Alto Vento", short: "AVA", strength: 74, manager: "Joao" },
      { id: "B", name: "Bela Vista", short: "BVA", strength: 70, manager: "Rui" },
      { id: "C", name: "Costa Brava", short: "CBR", strength: 80, manager: null },
      { id: "D", name: "Dunas FC", short: "DFC", strength: 66, manager: null },
    ],
    matches: [
      match("f1", "A", "B", [g(10, "B", "b9"), g(30, "A", "a9"), g(88, "A", "a10")]),
      match("f2", "C", "D", [g(5, "D", "d9"), g(50, "D", "d9"), g(70, "D", "d9")]),
    ],
    players: [
      pl("ga", "A", "GK", 7.1), pl("gb", "B", "GK", 6.4), pl("gc", "C", "GK", 5.9), pl("gd", "D", "GK", 7.6),
      ...["1", "2", "3", "4", "5"].map((n, i) => pl(`d${n}`, i % 2 ? "A" : "D", "DEF", 6 + i * 0.3)),
      ...["1", "2", "3", "4"].map((n, i) => pl(`m${n}`, i % 2 ? "B" : "C", "MID", 6.5 + i * 0.2)),
      pl("p-a9", "A", "ATT", 7.8, 1), pl("p-a10", "A", "ATT", 7.4, 1), pl("p-d9", "D", "ATT", 9.4, 3), pl("p-b9", "B", "ATT", 7.0, 1),
    ],
    table_before: [{ club_id: "C", points: 18 }, { club_id: "A", points: 16 }, { club_id: "B", points: 12 }, { club_id: "D", points: 4 }],
    table_after: [{ club_id: "A", points: 19 }, { club_id: "C", points: 18 }, { club_id: "B", points: 12 }, { club_id: "D", points: 7 }],
    head_to_head: [{ a: "A", b: "B", a_wins: 2, b_wins: 0, draws: 1 }],
    ...over,
  };
}

describe("O Apito newspaper", () => {
  it("is deterministic for the same facts", () => {
    expect(buildEdition(facts())).toEqual(buildEdition(facts()));
  });

  it("finds the angles: derby, comeback, late winner, upset + hat-trick, new leader, title race", () => {
    const ed = buildEdition(facts());
    const kinds = ed.stories.map((s) => s.kind);
    // one story per fixture: the derby (two humans) wins its fixture; the AI game's best angle is the upset/hat-trick
    expect(kinds).toContain("derby");
    expect(ed.stories.filter((s) => s.fixture_id === "f1")).toHaveLength(1);
    expect(ed.stories.filter((s) => s.fixture_id === "f2")).toHaveLength(1);
    expect(["upset", "hat_trick"]).toContain(ed.stories.find((s) => s.fixture_id === "f2")!.kind);
    expect(kinds).toContain("new_leader");
    expect(kinds).toContain("title_race");
    expect(ed.stories.map((s) => s.rank)).toEqual(ed.stories.map((_, i) => i + 1));
    expect(ed.stories[0].score).toBeGreaterThanOrEqual(ed.stories.at(-1)!.score);
    const factKinds = ed.facts.map((f) => f.kind);
    for (const k of ["match_result", "derby", "comeback", "late_winner", "upset", "hat_trick", "new_leader", "player_of_round", "team_of_round"]) {
      expect(factKinds).toContain(k);
    }
    // keys are unique per kind (idempotent inserts)
    const keys = ed.facts.map((f) => `${f.kind}|${f.key}`);
    expect(new Set(keys).size).toBe(keys.length);
    const derby = ed.stories.find((s) => s.kind === "derby")!;
    expect(derby.body).toContain("Alto Vento 2–1 Bela Vista");
    expect(derby.body).toMatch(/Melhor em campo/);
  });

  it("handles a drawn derby, thrashing, goal fest, red card and human result lines", () => {
    const ed = buildEdition(facts({
      round: 1, table_before: [],
      matches: [
        match("f1", "A", "B", [g(10, "A", "a9"), g(20, "B", "b9")]),
        match("f2", "C", "D", [g(1, "C", "c1"), g(2, "C", "c1"), g(3, "C", "c2"), g(4, "C", "c3"), g(5, "C", "d9", { own_goal: true })],
          { reds: [{ club_id: "D", player: "Zé", minute: 30 }] }),
      ],
    }));
    const derby = ed.stories.find((s) => s.kind === "derby")!;
    expect(derby.headline).toMatch(/Empate|não se vencem/);
    expect(ed.stories.some((s) => s.kind === "thrashing" && s.headline === s.headline.toLocaleUpperCase("pt-PT"))).toBe(true);
    expect(ed.facts.some((f) => f.kind === "red_card")).toBe(true);
    expect(ed.stories.some((s) => s.kind === "new_leader")).toBe(false);

    const fest = buildEdition(facts({ matches: [match("f9", "C", "D", [g(1, "C", "x"), g(2, "D", "y"), g(3, "C", "z"), g(4, "D", "w"), g(5, "C", "v"), g(6, "D", "u")])] }));
    expect(fest.stories.some((s) => s.kind === "goal_fest")).toBe(true);

    const humanOnly = buildEdition(facts({ matches: [match("f7", "A", "C", [])], table_after: [], table_before: [] }));
    expect(humanOnly.stories.map((s) => s.kind)).toEqual(["human_result"]);
    expect(humanOnly.stories[0].headline).toMatch(/Alto Vento|Joao/);
  });

  it("picks the team of the round in a 4-3-3 and the least likely goal", () => {
    const a = roundAwards(facts());
    expect(a.team.filter((p) => p.group === "GK")).toHaveLength(1);
    expect(a.team.filter((p) => p.group === "DEF")).toHaveLength(4);
    expect(a.team.filter((p) => p.group === "MID")).toHaveLength(3);
    expect(a.team.filter((p) => p.group === "ATT")).toHaveLength(3);
    expect(a.player?.id).toBe("p-d9");
    const low = roundAwards(facts({ matches: [match("f1", "A", "B", [g(10, "A", "a9", { xg: 0.04 }), g(20, "B", "b9", { xg: 0.5 })])] }));
    expect(low.goal).toMatchObject({ scorer: "a9", xg: 0.04 });
    expect(roundAwards(facts({ players: [], matches: [] }))).toEqual({ team: [], player: null, goal: null });
  });

  it("has headline templates for every story kind", () => {
    for (const list of Object.values(HEADLINES)) expect(list.length).toBeGreaterThan(0);
  });
});
