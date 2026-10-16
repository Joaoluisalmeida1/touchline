import { describe, expect, it } from "vitest";
import { gateReceiptsCents, sponsorshipCents } from "./economy";
import {
  baseCapacity, boardObjective, effectiveBudgets, expectedPoints, matchdayGate, nextConfidence, nextFanMood, safeOffer,
  sponsorOffers, staffPool, stadiumFrom, startingStaff,
} from "./business";

describe("business-v1", () => {
  it("gate is calibrated to economy-v1 at rep 60 / mood 50 / normal price, and price trades crowd for revenue", () => {
    const st = { capacity: baseCapacity(60), vip_level: 0, fan_mood: 50, ticket_price: "normal" as const, reputation: 60 };
    const g = matchdayGate(st, 60);
    expect(Math.abs(g.cents - gateReceiptsCents(60)) / gateReceiptsCents(60)).toBeLessThan(0.1);
    const low = matchdayGate({ ...st, ticket_price: "low" }, 60), high = matchdayGate({ ...st, ticket_price: "high" }, 60);
    expect(low.attendance).toBeGreaterThan(g.attendance);
    expect(high.attendance).toBeLessThan(g.attendance);
    expect(matchdayGate({ ...st, fan_mood: 90 }, 60).attendance).toBeGreaterThan(g.attendance);
  });
  it("fan mood follows results and price, bounded", () => {
    expect(nextFanMood(50, "W", "normal")).toBe(53);
    expect(nextFanMood(50, "L", "high")).toBe(46);
    expect(nextFanMood(100, "W", "low")).toBe(100);
    expect(nextFanMood(0, "L", "high")).toBeGreaterThanOrEqual(0);
  });
  it("upgrades only count once built", () => {
    const s = stadiumFrom(20000, [{ kind: "capacity", ready_at: 105 }, { kind: "vip", ready_at: 112 }], 106);
    expect(s).toMatchObject({ capacity: 22000, vip_level: 0 });
    expect(s.building).toHaveLength(1);
  });
  it("sponsor offers: 3 kinds per slot, deterministic, sum ≈ economy-v1 sponsorship for the safe set", () => {
    const args = { gameId: "g", season: 1, clubId: "c", reputation: 60, target: 4, slots: ["main", "stadium", "sleeve", "kit"] as const };
    const a = sponsorOffers({ ...args, slots: [...args.slots] });
    expect(sponsorOffers({ ...args, slots: [...args.slots] })).toEqual(a);
    expect(a).toHaveLength(12);
    const safe = (["main", "stadium", "sleeve", "kit"] as const).map((s) => safeOffer(a, s)!.base_cents).reduce((x, y) => x + y, 0);
    expect(Math.abs(safe - sponsorshipCents(60)) / sponsorshipCents(60)).toBeLessThan(0.1);
    expect(a.filter((o) => o.kind === "performance").every((o) => o.clause?.top === 4)).toBe(true);
    expect(new Set(a.map((o) => o.brand)).size).toBe(12);
  });
  it("staff: pool of 3 per role, levels 1–5, starting staff by reputation", () => {
    const p = staffPool({ gameId: "g", season: 1, clubId: "c", reputation: 70 });
    expect(p).toHaveLength(15);
    expect(new Set(p.map((x) => x.name)).size).toBe(15);
    expect(p.every((x) => x.level >= 1 && x.level <= 5 && x.wage_cents > 0)).toBe(true);
    expect(startingStaff({ gameId: "g", clubId: "c", reputation: 90 }).every((x) => x.level === 4)).toBe(true);
    expect(startingStaff({ gameId: "g", clubId: "c", reputation: 20 }).every((x) => x.level === 1)).toBe(true);
  });
  it("board: objectives by strength rank, confidence moves with results and books", () => {
    expect(boardObjective(1, 18).label).toBe("Ser campeão");
    expect(boardObjective(3, 18)).toMatchObject({ kind: "top", target: 4 });
    expect(boardObjective(17, 18)).toMatchObject({ kind: "avoid", target: 15 });
    expect(expectedPoints(5, true)).toBeGreaterThan(expectedPoints(-5, false));
    const base = { confidence: 60, cash_cents: 1, wages_cents: 100, wage_budget_cents: 100, transfer_spent_cents: 0, transfer_budget_cents: 10 };
    expect(nextConfidence({ ...base, points: 3, expected: 1 }).confidence).toBeGreaterThan(60);
    const bad = nextConfidence({ ...base, points: 0, expected: 2, cash_cents: -1, wages_cents: 200, transfer_spent_cents: 20 });
    expect(bad.confidence).toBeLessThan(52);
    expect(bad.reasons.map((r) => r.reason)).toContain("Saldo negativo");
  });
  it("budget shift moves money between transfers and wages", () => {
    expect(effectiveBudgets({ transfer: 1_000_000, wage: 50_000 }, 20, 10)).toEqual({ transfer: 1_200_000, wage: 30_000 });
    expect(effectiveBudgets({ transfer: 1_000_000, wage: 50_000 }, -50, 10)).toEqual({ transfer: 800_000, wage: 70_000 });
  });
});
