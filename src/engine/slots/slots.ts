/**
 * slots-v1 — "Roleta". Pure: the server passes a uniform random source (crypto) and applies the returned outcome.
 * Each spin costs €500k (in-game money). Expected value is below the cost (it's a money sink with fun on top); 20% of
 * every paid spin and every fine feeds the league jackpot.
 */
import type { PositionGroup } from "../common/types";

export const SLOTS_VERSION = "slots-v1";
export const SPIN_COST_CENTS = 50_000_000; // €500k
export const JACKPOT_SHARE = 0.2;
export const JACKPOT_BASE_CENTS = 200_000_000; // €2M
export const DUEL_STAKE_CENTS = 50_000_000;

export type Rarity = "common" | "rare" | "epic" | "legendary" | "bad" | "disaster";
export type Symbol = "ball" | "boot" | "glove" | "coin" | "bag" | "star" | "trophy" | "cross" | "redcard" | "whistle";
export const SYMBOLS: Symbol[] = ["ball", "boot", "glove", "coin", "bag", "star", "trophy", "cross", "redcard", "whistle"];

export type PrizeKind =
  | "cash_small" | "cash_mid" | "cash_big" | "morale" | "fitness" | "skin" | "skin_epic" | "skin_legendary" | "player"
  | "card_shield" | "card_immunity" | "card_gate" | "free_spin" | "jackpot"
  | "injury" | "fine" | "sulk" | "point";

export interface PrizeDef { kind: PrizeKind; rarity: Rarity; weight: number; symbol: Symbol; negative?: boolean }

/** Relative weights (sum 935): ~64% good, ~22% bad, 0.5% disaster. */
export const PRIZES: PrizeDef[] = [
  { kind: "cash_small", rarity: "common", weight: 250, symbol: "coin" },
  { kind: "morale", rarity: "common", weight: 80, symbol: "ball" },
  { kind: "fitness", rarity: "common", weight: 70, symbol: "boot" },
  { kind: "cash_mid", rarity: "rare", weight: 85, symbol: "bag" },
  { kind: "free_spin", rarity: "rare", weight: 45, symbol: "whistle" },
  { kind: "card_shield", rarity: "rare", weight: 35, symbol: "glove" },
  { kind: "skin", rarity: "rare", weight: 45, symbol: "star" },
  { kind: "card_immunity", rarity: "epic", weight: 22, symbol: "glove" },
  { kind: "card_gate", rarity: "epic", weight: 22, symbol: "bag" },
  { kind: "skin_epic", rarity: "epic", weight: 18, symbol: "star" },
  { kind: "player", rarity: "epic", weight: 40, symbol: "trophy" },
  { kind: "cash_big", rarity: "legendary", weight: 8, symbol: "trophy" },
  { kind: "skin_legendary", rarity: "legendary", weight: 4, symbol: "star" },
  { kind: "jackpot", rarity: "legendary", weight: 3, symbol: "trophy" },
  { kind: "injury", rarity: "bad", weight: 75, symbol: "cross", negative: true },
  { kind: "fine", rarity: "bad", weight: 70, symbol: "redcard", negative: true },
  { kind: "sulk", rarity: "bad", weight: 58, symbol: "redcard", negative: true },
  { kind: "point", rarity: "disaster", weight: 5, symbol: "redcard", negative: true },
];

export const SKINS: Record<"rare" | "epic" | "legendary", string[]> = {
  rare: ["riscas", "aros", "estrela", "faixa", "xadrez"],
  epic: ["ouro", "carbono", "vitral"],
  legendary: ["chama", "relampago"],
};
export const SKIN_LABEL: Record<string, string> = {
  riscas: "Riscas", aros: "Aros", estrela: "Estrela", faixa: "Faixa", xadrez: "Xadrez",
  ouro: "Ouro", carbono: "Carbono", vitral: "Vitral", chama: "Chama (animado)", relampago: "Relâmpago (animado)",
};

export interface SpinOptions { negatives: boolean; pointPenalty: boolean; shield: boolean }

/** Pick a prize from a uniform number u ∈ [0,1). Disabled negatives are re-rolled as small cash; the −1 point becomes a fine. */
export function drawPrize(u: number, o: Pick<SpinOptions, "negatives" | "pointPenalty">): PrizeDef {
  const total = PRIZES.reduce((s, p) => s + p.weight, 0);
  let x = u * total;
  let pick = PRIZES[PRIZES.length - 1];
  for (const p of PRIZES) {
    if (x < p.weight) { pick = p; break; }
    x -= p.weight;
  }
  if (pick.negative && !o.negatives) return PRIZES[0];
  if (pick.kind === "point" && !o.pointPenalty) return PRIZES.find((p) => p.kind === "fine")!;
  return pick;
}

/**
 * Reel symbols shown for an outcome: three of a kind for epic and better, a pair for rare, a broken line for common,
 * and the "bad" symbol for punishments.
 */
export function reelsFor(prize: PrizeDef, r: () => number): Symbol[] {
  const other = (not: Symbol[]) => { const pool = SYMBOLS.filter((s) => !not.includes(s)); return pool[Math.floor(r() * pool.length)]; };
  const s = prize.symbol;
  if (prize.rarity === "epic" || prize.rarity === "legendary" || prize.rarity === "disaster") return [s, s, s];
  if (prize.rarity === "rare") { const pos = Math.floor(r() * 3); const out: Symbol[] = [s, s, s]; out[pos] = other([s]); return out; }
  if (prize.rarity === "bad") return [s, other([s]), s];
  const a = other([]), b = other([a]);
  return [s, a, b];
}

/** Amounts are uniform in a band, rounded to €10k. */
export function cashAmount(kind: PrizeKind, u: number): number {
  const band: Partial<Record<PrizeKind, [number, number]>> = {
    cash_small: [10_000_000, 40_000_000], cash_mid: [100_000_000, 250_000_000], cash_big: [500_000_000, 1_000_000_000], fine: [30_000_000, 100_000_000],
  };
  const [lo, hi] = band[kind] ?? [0, 0];
  return Math.round((lo + u * (hi - lo)) / 1_000_000) * 1_000_000;
}

export function skinFor(prize: PrizeKind, u: number): string {
  const pool = prize === "skin_legendary" ? SKINS.legendary : prize === "skin_epic" ? SKINS.epic : SKINS.rare;
  return pool[Math.floor(u * pool.length)];
}

/** Player prize: the more expensive, the rarer (weight ∝ value^−0.8), but any player of the pool can come out. */
export function pickPrizePlayer<T extends { valueCents: number }>(pool: T[], u: number): T | null {
  if (!pool.length) return null;
  const w = pool.map((p) => (1_000_000_000 / Math.max(10_000_000, p.valueCents)) ** 0.8);
  const total = w.reduce((s, x) => s + x, 0);
  let x = u * total;
  for (let i = 0; i < pool.length; i++) { if (x < w[i]) return pool[i]; x -= w[i]; }
  return pool[pool.length - 1];
}

/** Duel score of three reels: trophies and stars are worth most, a triple doubles the sum. */
const VALUE: Record<Symbol, number> = { trophy: 10, star: 8, bag: 6, coin: 5, ball: 4, boot: 3, glove: 3, whistle: 2, cross: 1, redcard: 0 };
export function duelReels(r: () => number): { reels: Symbol[]; score: number } {
  const reels = [0, 1, 2].map(() => SYMBOLS[Math.floor(r() * SYMBOLS.length)]);
  const sum = reels.reduce((s, x) => s + VALUE[x], 0);
  const triple = reels[0] === reels[1] && reels[1] === reels[2];
  const pair = !triple && (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]);
  return { reels, score: triple ? sum * 2 : pair ? sum + 5 : sum };
}

export const PRIZE_LABEL: Record<PrizeKind, string> = {
  cash_small: "Trocos no balneário", cash_mid: "Mala de dinheiro", cash_big: "Investidor misterioso", morale: "Balneário em festa",
  fitness: "Sessão de recuperação", skin: "Novo emblema", skin_epic: "Emblema épico", skin_legendary: "Emblema lendário",
  player: "Reforço de bandeja", card_shield: "Carta: Escudo", card_immunity: "Carta: Imunidade a lesões", card_gate: "Carta: Bilheteira ×2",
  free_spin: "Giro grátis", jackpot: "JACKPOT", injury: "Lesão no treino", fine: "Multa da Liga", sulk: "Jogador amuado", point: "Castigo: −1 ponto",
};

export type { PositionGroup };
