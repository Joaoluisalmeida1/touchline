import { describe, expect, it } from "vitest";
import { createRng } from "../common/rng";
import { PRIZES, SPIN_COST_CENTS, cashAmount, drawPrize, duelReels, pickPrizePlayer, reelsFor } from "./slots";
import { odds, outcome, payout, probabilities } from "../betting/odds";

describe("slots-v1", () => {
  it("every prize is reachable and the table respects the toggles", () => {
    const seen = new Set<string>();
    const rng = createRng("slots");
    for (let i = 0; i < 40_000; i++) seen.add(drawPrize(rng.next(), { negatives: true, pointPenalty: true }).kind);
    expect(seen.size).toBe(PRIZES.length);
    for (let i = 0; i < 5_000; i++) {
      const p = drawPrize(rng.next(), { negatives: false, pointPenalty: false });
      expect(p.negative).toBeFalsy();
      expect(drawPrize(rng.next(), { negatives: true, pointPenalty: false }).kind).not.toBe("point");
    }
  });

  it("is a money sink: expected cash back is well below the €500k cost", () => {
    const total = PRIZES.reduce((s, p) => s + p.weight, 0);
    const avg = (k: Parameters<typeof cashAmount>[0]) => (cashAmount(k, 0) + cashAmount(k, 1)) / 2;
    const ev = PRIZES.reduce((s, p) => s + (p.weight / total) * (["cash_small", "cash_mid", "cash_big"].includes(p.kind) ? avg(p.kind) : p.kind === "fine" ? -avg("fine") : 0), 0);
    expect(ev).toBeLessThan(SPIN_COST_CENTS * 0.7);
    expect(ev).toBeGreaterThan(0);
  });

  it("reels: three of a kind for epic+, a pair for rare, never a triple for common", () => {
    const rng = createRng("reels");
    const r = () => rng.next();
    for (const p of PRIZES) {
      const reels = reelsFor(p, r);
      const triple = reels[0] === reels[1] && reels[1] === reels[2];
      if (["epic", "legendary", "disaster"].includes(p.rarity)) expect(triple).toBe(true);
      else expect(triple).toBe(false);
      expect(reels).toContain(p.symbol);
    }
  });

  it("player prize: cheaper players come out more, but any can", () => {
    const pool = [{ id: "cheap", valueCents: 100_000_000 }, { id: "star", valueCents: 10_000_000_000 }];
    const rng = createRng("pp");
    let star = 0;
    for (let i = 0; i < 4000; i++) if (pickPrizePlayer(pool, rng.next())!.id === "star") star++;
    expect(star).toBeGreaterThan(0);
    expect(star).toBeLessThan(400);
    expect(pickPrizePlayer([], 0.5)).toBeNull();
  });

  it("duel scores are deterministic for a given random source", () => {
    const a = duelReels(((r) => () => r.next())(createRng("d")));
    const b = duelReels(((r) => () => r.next())(createRng("d")));
    expect(a).toEqual(b);
    expect(a.reels).toHaveLength(3);
  });
});

describe("betting-v1", () => {
  it("probabilities sum to 1, home advantage and strength move them, odds carry the margin", () => {
    const p = probabilities(70, 70);
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 6);
    expect(p.home).toBeGreaterThan(p.away);
    expect(probabilities(80, 65).home).toBeGreaterThan(probabilities(70, 70).home);
    const o = odds(70, 70);
    expect(1 / o["1"] + 1 / o.X + 1 / o["2"]).toBeGreaterThan(1.03);
    expect(outcome(2, 1)).toBe("1");
    expect(outcome(1, 1)).toBe("X");
    expect(outcome(0, 3)).toBe("2");
    expect(payout(1_000_000, 2.35)).toBe(2_350_000);
  });
});
