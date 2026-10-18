/**
 * career-v1 — youth academy intake and contract demands. Pure and seeded.
 * Academy youngsters are fictional (generated names, game-made ages); real players never get invented ages.
 */
import { clamp, createRng } from "../common/rng";
import type { PositionGroup } from "../common/types";
import { euroToCents, weeklyWageCents } from "../economy/economy";
import { formulaValueEur } from "../rating/initial-rating";
import type { Trait } from "../narrative/traits";

export const CAREER_VERSION = "career-v1";

/* ------------------------------------------------------------------ academy */

/** Intake happens after this league round (about two thirds into the season). */
export const academyIntakeRound = (totalRounds: number) => Math.max(1, Math.round((totalRounds * 2) / 3));

const FIRST = ["Tomás", "Rodrigo", "Martim", "Duarte", "Gonçalo", "Afonso", "Lourenço", "Dinis", "Salvador", "Vicente", "Gustavo", "Simão",
  "Kauã", "Enzo", "Davi", "Thiago", "Iker", "Unai", "Álvaro", "Hugo", "Mathis", "Noé", "Yanis", "Ilan", "Bernardo", "Leandro"];
const LAST = ["Arruda", "Bastos", "Caldeira", "Damasceno", "Esteves", "Falcão", "Garcês", "Honorato", "Infante", "Junqueira", "Lameiras",
  "Mourato", "Noronha", "Orvalho", "Pimentel", "Quintela", "Rebelo", "Salgueiro", "Tavares", "Urgal", "Varela", "Ximenes", "Zarco", "Bettencourt"];

export interface Prospect {
  name: string; position_group: PositionGroup; age: number; ovr: number; potential_cap: number; potential_band: string;
  dev_rate: number; wage_cents: number; value_cents: number;
}

export function bandOf(potential: number): string {
  // same thresholds as the set_potential_band() trigger
  return potential >= 88 ? "A" : potential >= 82 ? "B" : potential >= 75 ? "C" : potential >= 68 ? "D" : "E";
}

/** 3–6 prospects; the youth coordinator's level (1–5) and the club's reputation drive count and quality. */
export function academyIntake(args: { gameId: string; season: number; clubId: string; reputation: number; youthLevel: number }): Prospect[] {
  const rng = createRng(`${args.gameId}|s${args.season}|academy|${args.clubId}|${CAREER_VERSION}`);
  const lvl = clamp(Math.round(args.youthLevel), 1, 5);
  const n = clamp(2 + Math.ceil(lvl * 0.8), 3, 6);
  const groups: PositionGroup[] = ["GK", "DEF", "DEF", "MID", "MID", "ATT", "ATT", "DEF", "MID"];
  const used = new Set<string>();
  const out: Prospect[] = [];
  for (let i = 0; i < n; i++) {
    let name = "";
    do name = `${FIRST[Math.floor(rng.next() * FIRST.length)]} ${LAST[Math.floor(rng.next() * LAST.length)]}`; while (used.has(name));
    used.add(name);
    const group = i === 0 && rng.chance(0.35) ? "GK" : groups[1 + Math.floor(rng.next() * (groups.length - 1))];
    const age = rng.int(16, 18);
    const ovr = Math.round(clamp(44 + rng.int(0, 10) + lvl * 1.5 + args.reputation / 25, 40, 66));
    const head = 8 + rng.next() * (6 + lvl * 3) + args.reputation / 20;
    const potential = Math.round(clamp(ovr + head, ovr, 92));
    out.push({
      name, position_group: group, age, ovr, potential_cap: potential, potential_band: bandOf(potential),
      dev_rate: Math.round(clamp(1.0 + (rng.next() - 0.4) * 0.2, 0.85, 1.25) * 1000) / 1000,
      wage_cents: Math.round(weeklyWageCents(ovr, args.reputation) * 0.6 / 10_000) * 10_000,
      value_cents: euroToCents(formulaValueEur(ovr, group, age)),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ contracts */

export interface DemandInput { ovr: number; morale: number; age: number | null; trait: Trait; reputation: number }
export interface Demand { refuses: boolean; reason: string | null; options: { seasons: number; wage_cents: number }[] }

/** What a player in his final contract year asks to stay (wage per round, 1–3 seasons). */
export function renewalDemand(d: DemandInput): Demand {
  const base = weeklyWageCents(d.ovr, d.reputation);
  let f = 1.1;
  if (d.morale < 40) f += 0.2;
  if (d.trait === "ambitious") f += 0.15;
  if (d.trait === "loyal") f -= 0.1;
  if (d.trait === "temperamental" && d.morale < 50) f += 0.1;
  const refuses = d.morale < 25 || (d.trait === "ambitious" && d.morale < 35);
  const maxSeasons = d.age !== null && d.age >= 33 ? 1 : 3;
  const options = [1, 2, 3].filter((s) => s <= maxSeasons).map((s) => ({
    seasons: s, wage_cents: Math.round((base * f * (1 + 0.05 * (s - 1))) / 10_000) * 10_000,
  }));
  return { refuses, reason: refuses ? (d.trait === "ambitious" ? "Quer dar o salto para outro clube." : "Está descontente e não quer ficar.") : null, options };
}

/** Wage a free agent asks from any club. */
export const freeAgentWage = (ovr: number) => Math.round((weeklyWageCents(ovr, 50) * 1.1) / 10_000) * 10_000;

/**
 * AI clubs pick the free agents nobody signed: best players first, each to the AI club that gains most
 * (weakest at that position group), respecting the squad limit. Deterministic.
 */
export function aiFreeAgentPicks(
  agents: { id: string; ovr: number; group: PositionGroup }[],
  clubs: { id: string; size: number; groupAvg: Partial<Record<PositionGroup, number>> }[],
  maxSquad: number,
): { player_id: string; club_id: string }[] {
  const size = new Map(clubs.map((c) => [c.id, c.size]));
  const out: { player_id: string; club_id: string }[] = [];
  for (const a of [...agents].sort((x, y) => y.ovr - x.ovr || (x.id < y.id ? -1 : 1))) {
    const cand = clubs.filter((c) => (size.get(c.id) ?? 99) < maxSquad)
      .map((c) => ({ c, gain: a.ovr - (c.groupAvg[a.group] ?? 60) }))
      .filter((x) => x.gain > -3)
      .sort((x, y) => y.gain - x.gain || (x.c.id < y.c.id ? -1 : 1))[0];
    if (!cand) continue;
    out.push({ player_id: a.id, club_id: cand.c.id });
    size.set(cand.c.id, (size.get(cand.c.id) ?? 0) + 1);
  }
  return out;
}
