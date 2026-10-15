/**
 * Deterministic, seedable PRNG utilities. The engines MUST NOT use Math.random() or Date.now().
 * xmur3 string hash -> sfc32 generator (fast, good statistical quality, 128-bit state).
 */

export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export interface Rng {
  /** uniform [0,1) */
  next(): number;
  int(minInclusive: number, maxInclusive: number): number;
  chance(p: number): boolean;
  pickWeighted<T>(items: readonly T[], weight: (t: T) => number): T;
  normal(mean?: number, sd?: number): number;
}

export function createRng(seed: string): Rng {
  const seedFn = xmur3(seed);
  let a = seedFn(), b = seedFn(), c = seedFn(), d = seedFn();
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) next(); // warm-up
  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(p) {
      return next() < p;
    },
    pickWeighted(items, weight) {
      if (items.length === 0) throw new Error("pickWeighted on empty list");
      let total = 0;
      for (const it of items) total += Math.max(0, weight(it));
      if (total <= 0) return items[Math.floor(next() * items.length)];
      let r = next() * total;
      for (const it of items) {
        r -= Math.max(0, weight(it));
        if (r <= 0) return it;
      }
      return items[items.length - 1];
    },
    normal(mean = 0, sd = 1) {
      // Box–Muller
      const u = Math.max(next(), 1e-12);
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

/** Deterministic uniform [0,1) from a key (no state). */
export function hashUnit(key: string): number {
  return xmur3(key)() / 4294967296;
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
export const logit = (p: number): number => Math.log(p / (1 - p));
export const round1 = (x: number): number => Math.round(x * 10) / 10;
export const round3 = (x: number): number => Math.round(x * 1000) / 1000;
