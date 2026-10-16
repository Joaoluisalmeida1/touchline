/**
 * cup-v1 — "Taça da Liga dos Amigos": single-leg knockout for every club in the game, seeded by strength, top seeds
 * get byes when the number of clubs is not a power of two. Draws go straight to penalties (no extra time in v1).
 * Pure and deterministic (seed = game|season|cup|tie).
 */
import { createRng } from "../common/rng";
import { simulateMatch } from "../match/engine";
import type { MatchResult } from "../match/types";
import { buildMatchInput, type LeagueClub, type LeaguePlayer } from "../league/round";

export const CUP_VERSION = "cup-v1";

/** Standard bracket order of seeds for a draw of size P (1 meets P, 2 meets P−1, …, top seeds apart). */
export function seedOrder(P: number): number[] {
  let order = [1];
  while (order.length < P) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export interface CupSlotTie { slot: number; home: string | null; away: string | null }

/** Round-1 ties from clubs ordered by strength (best first). A null side is a bye. */
export function firstRound(clubsByStrength: string[]): { rounds: number; ties: CupSlotTie[] } {
  const n = clubsByStrength.length;
  const P = Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(2, n))));
  const order = seedOrder(P);
  const ties: CupSlotTie[] = [];
  for (let i = 0; i < P; i += 2) {
    const a = clubsByStrength[order[i] - 1] ?? null, b = clubsByStrength[order[i + 1] - 1] ?? null;
    // the better seed plays at home
    ties.push({ slot: i / 2 + 1, home: a ?? b, away: a ? b : null });
  }
  return { rounds: Math.log2(P), ties };
}

/** League round after which cup round k (1-based) is played, spread evenly through the season. */
export function cupSchedule(totalLeagueRounds: number, cupRounds: number): number[] {
  const out: number[] = [];
  for (let k = 1; k <= cupRounds; k++) {
    let r = Math.round((totalLeagueRounds * k) / (cupRounds + 1));
    r = Math.max(r, (out.at(-1) ?? 0) + 1);
    out.push(Math.min(r, totalLeagueRounds));
  }
  return out;
}

export function roundName(k: number, rounds: number): string {
  const left = rounds - k;
  return left === 0 ? "Final" : left === 1 ? "Meias-finais" : left === 2 ? "Quartos de final" : left === 3 ? "Oitavos de final" : `${k}.ª eliminatória`;
}

/** Prize money (cents) for winning a tie in round k; the final also pays the runner-up. */
export function cupPrizeCents(k: number, rounds: number, won: boolean): number {
  const left = rounds - k;
  if (left === 0) return won ? 400_000_000 : 200_000_000;
  return won ? [100_000_000, 60_000_000, 40_000_000][Math.min(left - 1, 2)] : 0;
}

export interface Kick { side: "home" | "away"; player: string; scored: boolean }

/** Best-of-5 then sudden death. Taker quality by OVR, keeper by OVR. */
export function penaltyShootout(seed: string, home: { name: string; ovr: number }[], away: { name: string; ovr: number }[], gk: { home: number; away: number }) {
  const rng = createRng(`${seed}|pens|${CUP_VERSION}`);
  const p = (taker: number, keeper: number) => Math.min(0.92, Math.max(0.55, 0.75 + (taker - 70) * 0.004 - (keeper - 70) * 0.003));
  const kicks: Kick[] = [];
  let h = 0, a = 0;
  const order = (xs: { name: string; ovr: number }[]) => [...xs].sort((x, y) => y.ovr - x.ovr);
  const H = order(home), A = order(away);
  let hTaken = 0, aTaken = 0;
  const decided = () => {
    if (hTaken <= 5 && aTaken <= 5) return h > a + (5 - aTaken) || a > h + (5 - hTaken);
    return hTaken === aTaken && h !== a;
  };
  for (let i = 0; i < 30; i++) {
    const th = H[i % H.length], ta = A[i % A.length];
    const sh = rng.chance(p(th.ovr, gk.away));
    kicks.push({ side: "home", player: th.name, scored: sh });
    hTaken++; if (sh) h++;
    if (decided()) break;
    const sa = rng.chance(p(ta.ovr, gk.home));
    kicks.push({ side: "away", player: ta.name, scored: sa });
    aTaken++; if (sa) a++;
    if (decided()) break;
  }
  return { home: h, away: a, kicks };
}

export interface CupTieOutcome {
  result: MatchResult;
  pens: { home: number; away: number; kicks: Kick[] } | null;
  winner: string;
  /** post-match fitness (minutes-based drain) and new injuries; no league stats, no suspensions in v1 */
  player_effects: { id: string; fitness: number; injury: { matches: number; type: string } | null }[];
}

export function playCupTie(args: { gameId: string; season: number; tieId: string; home: LeagueClub; away: LeagueClub; players: LeaguePlayer[] }): CupTieOutcome {
  const { home, away } = args;
  const squad = (id: string) => args.players.filter((p) => p.club_id === id).sort((a, b) => (a.id < b.id ? -1 : 1));
  const hs = squad(home.id), as = squad(away.id);
  const { input, byId } = buildMatchInput(args.tieId, home, away, hs, as);
  const seed = `${args.gameId}|s${args.season}|cup|${args.tieId}`;
  const result = simulateMatch(input, seed);
  let pens: CupTieOutcome["pens"] = null;
  let winner = result.home_goals > result.away_goals ? home.id : away.id;
  if (result.home_goals === result.away_goals) {
    const on = (side: "home" | "away") => result.player_stats.filter((s) => s.side === side && s.minutes > 0 && byId.get(s.player_id)?.position_group !== "GK")
      .map((s) => ({ name: byId.get(s.player_id)!.name, ovr: byId.get(s.player_id)!.current_ovr }));
    const keeper = (side: "home" | "away") => {
      const gk = result.player_stats.find((s) => s.side === side && s.minutes > 0 && byId.get(s.player_id)?.position_group === "GK");
      return gk ? byId.get(gk.player_id)!.current_ovr : 60;
    };
    const hk = on("home"), ak = on("away");
    pens = penaltyShootout(seed, hk.length ? hk : [{ name: "?", ovr: 60 }], ak.length ? ak : [{ name: "?", ovr: 60 }], { home: keeper("home"), away: keeper("away") });
    winner = pens.home > pens.away ? home.id : away.id;
  }
  const player_effects = result.player_stats.filter((s) => s.minutes > 0).map((s) => {
    const p = byId.get(s.player_id)!;
    return {
      id: p.id,
      fitness: Math.max(30, Math.round(p.fitness - (s.minutes / 90) * 12)),
      injury: s.injury && p.injured_matches === 0 ? { matches: s.injury.matches, type: s.injury.type } : null,
    };
  });
  return { result, pens, winner, player_effects };
}
