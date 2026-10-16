import { describe, expect, it } from "vitest";
import { cupPrizeCents, cupSchedule, firstRound, penaltyShootout, roundName, seedOrder } from "./cup";

describe("cup-v1", () => {
  it("seeds a standard bracket", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it("gives byes to the top seeds when clubs are not a power of two", () => {
    const clubs = Array.from({ length: 18 }, (_, i) => `c${i + 1}`);
    const { rounds, ties } = firstRound(clubs);
    expect(rounds).toBe(5);
    expect(ties).toHaveLength(16);
    const byes = ties.filter((t) => t.away === null).map((t) => t.home);
    expect(byes).toHaveLength(14);
    expect(byes).toContain("c1");
    expect(new Set(ties.flatMap((t) => [t.home, t.away]).filter(Boolean)).size).toBe(18);
    expect(firstRound(["a", "b", "c", "d"]).ties).toEqual([{ slot: 1, home: "a", away: "d" }, { slot: 2, home: "b", away: "c" }]);
  });
  it("spreads cup rounds through the season and names them", () => {
    expect(cupSchedule(34, 5)).toEqual([6, 11, 17, 23, 28]);
    expect(cupSchedule(6, 2)).toEqual([2, 4]);
    expect(roundName(5, 5)).toBe("Final");
    expect(roundName(4, 5)).toBe("Meias-finais");
    expect(cupPrizeCents(5, 5, false)).toBeGreaterThan(0);
  });
  it("shootouts always produce a winner, deterministically", () => {
    const t = Array.from({ length: 11 }, (_, i) => ({ name: `p${i}`, ovr: 70 }));
    for (let i = 0; i < 50; i++) {
      const r = penaltyShootout(`s${i}`, t, t, { home: 70, away: 70 });
      expect(r.home).not.toBe(r.away);
      expect(penaltyShootout(`s${i}`, t, t, { home: 70, away: 70 })).toEqual(r);
      expect(r.kicks.filter((k) => k.side === "home").length - r.kicks.filter((k) => k.side === "away").length).toBeGreaterThanOrEqual(0);
    }
  });
});
