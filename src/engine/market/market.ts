/**
 * market-v2 — OSM-style Transfer List. Pure and deterministic (seeded): the server feeds it the current listings and
 * candidate players, and applies what it returns.
 *
 *  - The list fills up gradually: every round a handful of players from AI clubs (this league and other leagues of
 *    the dataset) appear. Expensive players are rarer.
 *  - AI/foreign listings start at 1.15–1.35× value and drop 8% per round unsold, down to 70% of value; after a round at
 *    the floor they leave the list.
 *  - Managers list their own players at a fixed price between 50% and 150% of value (4 slots). AI clubs buy them at
 *    the round, more likely the cheaper they are, early in the season and for cheaper players.
 */
import { clamp, createRng, type Rng } from "../common/rng";
import type { PositionGroup } from "../common/types";

export const MARKET_VERSION = "market-v2";

export const MARKET = {
  decayPerRound: 0.08,
  startMin: 1.15,
  startSpread: 0.2,
  floorRatio: 0.7,
  minListRatio: 0.5,
  maxListRatio: 1.5,
  managerSlots: 4,
  maxOpenAiListings: 24,
  minPriceCents: 10_000_000, // €100k
} as const;

/** Round to €10k (cents). */
export const roundPrice = (cents: number) => Math.max(MARKET.minPriceCents, Math.round(cents / 1_000_000) * 1_000_000);

export function listBounds(valueCents: number): { min: number; max: number } {
  return { min: roundPrice(valueCents * MARKET.minListRatio), max: roundPrice(valueCents * MARKET.maxListRatio) };
}

export function startPrice(rng: Rng, valueCents: number): number {
  return roundPrice(valueCents * (MARKET.startMin + rng.next() * MARKET.startSpread));
}

export function floorPrice(valueCents: number): number {
  return roundPrice(valueCents * MARKET.floorRatio);
}

/**
 * Price after `roundsUnsold` rounds on the list. `expired` once the player has already spent a full round at the
 * floor price without a buyer.
 */
export function listingAfter(startCents: number, floorCents: number, roundsUnsold: number): { price: number; expired: boolean } {
  const raw = startCents * (1 - MARKET.decayPerRound) ** roundsUnsold;
  const price = Math.max(floorCents, roundPrice(raw));
  const prev = roundsUnsold > 0 ? Math.max(floorCents, roundPrice(startCents * (1 - MARKET.decayPerRound) ** (roundsUnsold - 1))) : Infinity;
  return { price, expired: price <= floorCents && prev <= floorCents };
}

/** Rounds a listing stays before it leaves the list (for the UI's "última jornada"). */
export function roundsOnList(startCents: number, floorCents: number): number {
  for (let r = 0; r < 60; r++) if (listingAfter(startCents, floorCents, r + 1).expired) return r + 1;
  return 60;
}

/** Chance that an AI club buys a manager's listed player this round. */
export function aiBuyChance(priceCents: number, valueCents: number, roundFrac: number): number {
  const ratio = priceCents / Math.max(1, valueCents);
  const base = clamp(1.6 - ratio, 0.03, 0.95);
  const phase = 1.3 - 0.6 * clamp(roundFrac, 0, 1);
  const size = valueCents > 5_000_000_000 ? 0.4 : valueCents > 2_000_000_000 ? 0.6 : valueCents > 800_000_000 ? 0.8 : 1;
  return clamp(base * phase * size, 0.02, 0.95);
}

export interface ManagerListing { id: string; priceCents: number; valueCents: number; group: PositionGroup }
export interface AiClub { id: string; cashCents: number; squad: number; byGroup: Record<PositionGroup, number> }

/** AI purchases of managers' listings this round: at most one buy per AI club per round. */
export function aiPurchases(seed: string, listings: ManagerListing[], clubs: AiClub[], roundFrac: number, maxSquad: number): { listingId: string; buyerId: string }[] {
  const rng = createRng(`${MARKET_VERSION}:buy:${seed}`);
  const used = new Set<string>();
  const out: { listingId: string; buyerId: string }[] = [];
  for (const l of [...listings].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!rng.chance(aiBuyChance(l.priceCents, l.valueCents, roundFrac))) continue;
    const able = clubs.filter((c) => !used.has(c.id) && c.cashCents >= l.priceCents * 1.1 && c.squad < maxSquad - 1);
    if (!able.length) continue;
    const buyer = rng.pickWeighted(able, (c) => 1 / (1 + (c.byGroup[l.group] ?? 0)));
    used.add(buyer.id);
    out.push({ listingId: l.id, buyerId: buyer.id });
  }
  return out;
}

export interface Candidate { key: string; valueCents: number; ovr: number }

/** How many new players enter the list this round. */
export function newListingCount(humans: number, openListings: number, seasonStart: boolean): number {
  const n = clamp(3 + humans, 4, 8) * (seasonStart ? 2 : 1);
  return Math.max(0, Math.min(n, MARKET.maxOpenAiListings - openListings));
}

/**
 * Pick new listings: weight falls with value (expensive = rare), and ~12% of the time a "gem" is drawn from the most
 * valuable third instead. Returns the candidates with their start/floor prices.
 */
export function pickNewListings(seed: string, candidates: Candidate[], n: number): (Candidate & { startCents: number; floorCents: number })[] {
  const rng = createRng(`${MARKET_VERSION}:new:${seed}`);
  const pool = [...candidates].sort((a, b) => a.key.localeCompare(b.key));
  const out: (Candidate & { startCents: number; floorCents: number })[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    let pick: Candidate;
    if (rng.chance(0.12)) {
      const top = [...pool].sort((a, b) => b.valueCents - a.valueCents).slice(0, Math.max(1, Math.ceil(pool.length / 3)));
      pick = top[rng.int(0, top.length - 1)];
    } else {
      pick = rng.pickWeighted(pool, (c) => (1_000_000_000 / Math.max(10_000_000, c.valueCents)) ** 0.6);
    }
    pool.splice(pool.indexOf(pick), 1);
    out.push({ ...pick, startCents: startPrice(rng, pick.valueCents), floorCents: floorPrice(pick.valueCents) });
  }
  return out;
}
