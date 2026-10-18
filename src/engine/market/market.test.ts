import { describe, expect, it } from "vitest";
import { aiBuyChance, aiPurchases, floorPrice, listBounds, listingAfter, newListingCount, pickNewListings, roundsOnList, startPrice } from "./market";
import { createRng } from "../common/rng";

const M = 100_000_000; // €1M in cents

describe("market-v2", () => {
  it("prices drop 8% per unsold round down to the floor, then the listing expires", () => {
    const start = 13 * M, floor = 7 * M;
    expect(listingAfter(start, floor, 0)).toEqual({ price: start, expired: false });
    expect(listingAfter(start, floor, 1).price).toBe(11_960_000_00);
    const prices = Array.from({ length: 12 }, (_, r) => listingAfter(start, floor, r).price);
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
    const n = roundsOnList(start, floor);
    expect(listingAfter(start, floor, n - 1).expired).toBe(false);
    expect(listingAfter(start, floor, n).expired).toBe(true);
    expect(listingAfter(start, floor, n - 1).price).toBe(floor);
  });

  it("start price is 1.15–1.35× value, floor 70%, manager bounds 50–150%", () => {
    const rng = createRng("t");
    for (let i = 0; i < 50; i++) {
      const p = startPrice(rng, 10 * M);
      expect(p).toBeGreaterThanOrEqual(11.5 * M);
      expect(p).toBeLessThanOrEqual(13.5 * M);
    }
    expect(floorPrice(10 * M)).toBe(7 * M);
    expect(listBounds(10 * M)).toEqual({ min: 5 * M, max: 15 * M });
  });

  it("AI buys cheap listings more often, early in the season and small players", () => {
    expect(aiBuyChance(5 * M, 10 * M, 0)).toBeGreaterThan(aiBuyChance(15 * M, 10 * M, 0));
    expect(aiBuyChance(10 * M, 10 * M, 0)).toBeGreaterThan(aiBuyChance(10 * M, 10 * M, 1));
    expect(aiBuyChance(10 * M, 10 * M, 0.5)).toBeGreaterThan(aiBuyChance(100 * M, 100 * M, 0.5));
    expect(aiBuyChance(150 * M, 100 * M, 1)).toBeGreaterThanOrEqual(0.02);
  });

  it("AI purchases are deterministic, one per club, and need cash and squad room", () => {
    const listings = [{ id: "a", priceCents: 1 * M, valueCents: 2 * M, group: "MID" as const }, { id: "b", priceCents: 1 * M, valueCents: 2 * M, group: "DEF" as const }];
    const clubs = [{ id: "x", cashCents: 50 * M, squad: 20, byGroup: { GK: 2, DEF: 6, MID: 6, ATT: 4 } }, { id: "poor", cashCents: 0, squad: 20, byGroup: { GK: 2, DEF: 6, MID: 6, ATT: 4 } }];
    const a = aiPurchases("s1", listings, clubs, 0, 32);
    expect(aiPurchases("s1", listings, clubs, 0, 32)).toEqual(a);
    expect(a.length).toBeLessThanOrEqual(1);
    expect(a.every((p) => p.buyerId === "x")).toBe(true);
    expect(aiPurchases("s1", listings, [{ ...clubs[0], squad: 31 }], 0, 32)).toEqual([]);
  });

  it("new listings: count by managers, doubled at season start, capped; expensive players are rarer", () => {
    expect(newListingCount(2, 0, false)).toBe(5);
    expect(newListingCount(2, 0, true)).toBe(10);
    expect(newListingCount(8, 20, false)).toBe(4);
    const cands = Array.from({ length: 200 }, (_, i) => ({ key: `p${i}`, valueCents: (i < 100 ? 1 : 40) * M, ovr: 60 }));
    let cheap = 0;
    for (let s = 0; s < 40; s++) cheap += pickNewListings(`s${s}`, cands, 5).filter((c) => c.valueCents === 1 * M).length;
    expect(cheap / 200).toBeGreaterThan(0.6);
    const picks = pickNewListings("x", cands, 5);
    expect(new Set(picks.map((p) => p.key)).size).toBe(5);
    expect(pickNewListings("x", cands, 5)).toEqual(picks);
  });
});
