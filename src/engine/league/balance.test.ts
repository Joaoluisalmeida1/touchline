import { describe, expect, it } from "vitest";
import { roundRobin, simulateSeasons } from "./simulate";

describe("round robin", () => {
  it("every pair meets twice, once at home, nobody plays twice per round", () => {
    for (const n of [4, 5, 18, 20]) {
      const ids = Array.from({ length: n }, (_, i) => `c${i}`);
      const fx = roundRobin(ids);
      expect(fx.length).toBe(n * (n - 1));
      const pairs = new Set(fx.map((f) => `${f.home}>${f.away}`));
      expect(pairs.size).toBe(n * (n - 1));
      const rounds = new Map<number, string[]>();
      for (const f of fx) rounds.set(f.round, [...(rounds.get(f.round) ?? []), f.home, f.away]);
      for (const teams of rounds.values()) expect(new Set(teams).size).toBe(teams.length);
      // home/away balance: each club has n-1 home games
      for (const id of ids) expect(fx.filter((f) => f.home === id).length).toBe(n - 1);
    }
  });
});

describe("multi-season balance (fictional league)", () => {
  const { reports, league } = simulateSeasons("balance-test", 3);

  it("keeps OVR within 1..99 and very few players above 90", () => {
    for (const p of league.players) {
      expect(p.current_ovr).toBeGreaterThanOrEqual(1);
      expect(p.current_ovr).toBeLessThanOrEqual(99);
    }
    expect(league.players.filter((p) => p.current_ovr > 90).length / league.players.length).toBeLessThan(0.03);
  });

  it("established players move slowly; an 85 does not become 90 in one season", () => {
    for (const r of reports) {
      for (const d of r.ovrDeltas) {
        if (d.startOvr >= 85) expect(d.endOvr - d.startOvr).toBeLessThan(5);
        expect(Math.abs(d.endOvr - d.startOvr)).toBeLessThanOrEqual(9); // max one point per checkpoint
      }
      const est = r.ovrDeltas.filter((d) => d.age !== null && d.age >= 24 && d.age <= 29 && d.minutes >= 1500);
      const mean = est.reduce((s, d) => s + d.endOvr - d.startOvr, 0) / Math.max(1, est.length);
      expect(mean).toBeGreaterThan(-1.2);
      expect(mean).toBeLessThan(1.2);
    }
  });

  it("young regulars progress more than veterans", () => {
    const r = reports[0];
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const young = r.ovrDeltas.filter((d) => d.age !== null && d.age <= 21 && d.minutes >= 900).map((d) => d.endOvr - d.startOvr);
    const vets = r.ovrDeltas.filter((d) => d.age !== null && d.age >= 31).map((d) => d.endOvr - d.startOvr);
    expect(mean(young)).toBeGreaterThan(mean(vets));
    expect(mean(young)).toBeLessThan(4);
  });

  it("economy has no explosive inflation and does not bankrupt everyone", () => {
    const first = reports[0].avgValueCents;
    const last = reports[reports.length - 1].avgValueCents;
    expect(last / first).toBeLessThan(2);
    expect(last / first).toBeGreaterThan(0.5);
    for (const r of reports) expect(r.clubsInDebt).toBeLessThan(9);
  });

  it("league scoring stays in a plausible band", () => {
    for (const r of reports) {
      expect(r.avgGoals).toBeGreaterThan(2.2);
      expect(r.avgGoals).toBeLessThan(3.4);
      expect(r.drawRate).toBeGreaterThan(0.15);
      expect(r.drawRate).toBeLessThan(0.35);
    }
  });
});
