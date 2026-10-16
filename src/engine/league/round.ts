/**
 * Pure round orchestration shared by the server processor (DB-backed) and offline simulations.
 * Given an immutable snapshot of a league's state, computes everything a round produces:
 * match inputs/results, player updates, progression logs, ledger entries and used lineups.
 */
import { hashInput } from "../common/hash";
import type { Formation, LineupInstructions, PlayerProfile, PositionGroup, Slot, Tactics } from "../common/types";
import { addFamiliarity, inferPreferredSlot } from "../lineup/formations";
import { gateReceiptsCents, resultBonusCents, sponsorshipCents } from "../economy/economy";
import { resolveLineup, type LineupEntry, type ResolvedLineup, type SquadPlayer } from "../lineup/autopick";
import { ENGINE_VERSION } from "../match/config";
import { simulateMatch } from "../match/engine";
import type { MatchInput, MatchPlayerInput, MatchResult } from "../match/types";
import {
  endOfSeasonPlayer, progressPlayer, type MatchPerformance, type PlayerState, type PlayerUpdate, type ProgressionLog,
  type SeasonEndUpdate,
} from "../progression/progression";
import { prizeMoneyCents } from "../economy/economy";
import { applyTraining, planModifiers, type TrainingPlan } from "../training/training";
import type { MatchPlanRule } from "../match/types";
import { matchdayGate, staffAssistantXp, staffFitness, staffInjuryFactor, staffMedical, type Stadium, type StaffRole } from "../economy/business";

export interface LeaguePlayer extends PlayerState {
  name: string;
  position_detail: string | null;
  profile: Partial<PlayerProfile>;
  preferred_slot?: Slot | null;
  familiarity?: Partial<Record<Slot, number>> | null;
}

/** Positional learning carried alongside the progression update (applied by finalize_fixture). */
export type RoundPlayerUpdate = PlayerUpdate & {
  position_familiarity?: Partial<Record<Slot, number>>;
  preferred_slot?: Slot;
};

export interface LeagueClub {
  id: string;
  name: string;
  reputation: number;
  tactics: Tactics & { formation: Formation };
  saved_lineup: { formation: string; starters: LineupEntry[]; bench: string[]; instructions?: LineupInstructions } | null;
  /** weekly training plan (absent = no plan: nothing changes) */
  training?: TrainingPlan | null;
  /** match plan: man-marking targets (opponent player ids) and conditional second-half rules */
  marking?: string[];
  plans?: MatchPlanRule[];
  /** answered press conference for this round */
  press?: { own_control?: number; opp_control?: number; calm?: boolean } | null;
  /** phase 3 (business-v1): stadium, active sponsor deals and staff. Absent = economy-v1 behaviour. */
  stadium?: Stadium | null;
  sponsors?: { id: string; base_cents: number; win_bonus_cents: number }[] | null;
  staff?: Partial<Record<StaffRole, { level: number; wage_cents: number }>> | null;
}

/** Unit modifiers for `club` against `opp`: training focus + own press confidence + opponent's mind games (unless calm). */
export function clubModifiers(club: LeagueClub, opp: LeagueClub): { control?: number; attack?: number; defense?: number } | undefined {
  const m = { ...(planModifiers(club.training) ?? {}) };
  const add = (k: "control", v: number) => { if (v) m[k] = Math.round(((m[k] ?? 0) + v) * 100) / 100; };
  add("control", club.press?.own_control ?? 0);
  if (!club.press?.calm) add("control", opp.press?.opp_control ?? 0);
  return Object.keys(m).length ? m : undefined;
}

export interface RoundFixture {
  id: string;
  home_club_id: string;
  away_club_id: string;
}

export interface LedgerEntry {
  club_id: string;
  type: "gate_receipts" | "sponsorship" | "wages" | "result_bonus" | "prize_money" | "staff_wages";
  amount_cents: number;
  key: string;
  reference?: string;
}

export interface FixtureOutcome {
  fixture_id: string;
  seed: string;
  input: MatchInput;
  input_hash: string;
  result: MatchResult;
  lineups: { club_id: string; resolved: ResolvedLineup }[];
  player_updates: RoundPlayerUpdate[];
  progression_logs: ProgressionLog[];
  ledger: LedgerEntry[];
  /** home attendance (business-v1 only) */
  attendance?: number;
}

export interface RoundOutcome {
  fixtures: FixtureOutcome[];
  bye_player_updates: PlayerUpdate[];
  round_ledger: LedgerEntry[];
}

const toSquad = (p: LeaguePlayer): SquadPlayer => ({
  id: p.id, position_group: p.position_group, position_detail: p.position_detail, current_ovr: p.current_ovr,
  fitness: p.fitness, injured_matches: p.injured_matches, suspension_matches: p.suspension_matches,
  preferred_slot: p.preferred_slot ?? null, familiarity: p.familiarity ?? null,
});

const toMatchPlayer = (p: LeaguePlayer, slot?: LineupEntry["slot"], role?: string | null): MatchPlayerInput => ({
  id: p.id, name: p.name, position_group: p.position_group as PositionGroup, position_detail: p.position_detail,
  slot, role: slot ? role ?? null : undefined, ovr: p.current_ovr, profile: p.profile, fitness: p.fitness, form: p.form,
  morale: p.morale, sharpness: p.sharpness, preferred_slot: p.preferred_slot ?? null, familiarity: p.familiarity ?? null,
});

/** Keep only instructions that point at players in the matchday squad (captain must start). */
function sanitizeInstructions(ins: LineupInstructions | undefined, l: ResolvedLineup): LineupInstructions | undefined {
  if (!ins) return undefined;
  const xi = new Set(l.starters.map((s) => s.player_id));
  const squad = new Set([...xi, ...l.bench]);
  const out: LineupInstructions = {};
  if (ins.captain && xi.has(ins.captain)) out.captain = ins.captain;
  for (const k of ["penalty_taker", "freekick_taker", "corner_taker"] as const) if (ins[k] && squad.has(ins[k]!)) out[k] = ins[k];
  return Object.keys(out).length ? out : undefined;
}

export function fixtureSeed(gameId: string, season: number, round: number, fixtureId: string): string {
  return `${gameId}|s${season}|r${round}|${fixtureId}`;
}

export function processRound(args: {
  gameId: string;
  season: number;
  round: number;
  clubs: LeagueClub[];
  players: LeaguePlayer[];
  fixtures: RoundFixture[];
  /** clubs whose fixture this round was already completed (crash-resume): they get no bye updates */
  alreadyPlayedClubIds?: string[];
}): RoundOutcome {
  const { gameId, season, round, clubs, players, fixtures } = args;
  const clubById = new Map(clubs.map((c) => [c.id, c]));
  const squadOf = (clubId: string) => players.filter((p) => p.club_id === clubId).sort((a, b) => (a.id < b.id ? -1 : 1));
  const playing = new Set<string>(args.alreadyPlayedClubIds ?? []);
  const out: FixtureOutcome[] = [];

  for (const f of [...fixtures].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const home = clubById.get(f.home_club_id)!;
    const away = clubById.get(f.away_club_id)!;
    playing.add(home.id);
    playing.add(away.id);
    const hs = squadOf(home.id);
    const as = squadOf(away.id);
    const hl = resolveLineup(hs.map(toSquad), home.saved_lineup, home.tactics.formation);
    const al = resolveLineup(as.map(toSquad), away.saved_lineup, away.tactics.formation);
    const byId = new Map([...hs, ...as].map((p) => [p.id, p]));
    const team = (club: LeagueClub, l: ResolvedLineup, opp: LeagueClub, oppSquad: LeaguePlayer[]) => {
      const mods = clubModifiers(club, opp);
      const oppIds = new Set(oppSquad.map((p) => p.id));
      const marking = (club.marking ?? []).filter((id) => oppIds.has(id)).slice(0, 2);
      const own = new Set([...l.starters.map((s) => s.player_id), ...l.bench]);
      const plans: MatchPlanRule[] = [];
      for (const r of (club.plans ?? []).slice(0, 3)) {
        const sub = r.sub && own.has(r.sub.out) && own.has(r.sub.in) ? r.sub : undefined;
        if (!r.mentality && !sub) continue;
        plans.push({ minute: r.minute, when: r.when, ...(r.mentality ? { mentality: r.mentality } : {}), ...(sub ? { sub } : {}) });
      }
      return {
      club_id: club.id, name: club.name, formation: l.formation,
      ...(mods ? { modifiers: mods } : {}),
      ...(marking.length ? { marking } : {}),
      ...(plans.length ? { plans } : {}),
      ...(sanitizeInstructions(club.saved_lineup?.instructions, l) ? { instructions: sanitizeInstructions(club.saved_lineup?.instructions, l) } : {}),
      tactics: {
        mentality: club.tactics.mentality, tempo: club.tactics.tempo, pressing: club.tactics.pressing,
        defensive_line: club.tactics.defensive_line, width: club.tactics.width,
        passing_directness: club.tactics.passing_directness, transitions: club.tactics.transitions,
      },
      starters: l.starters.map((s) => toMatchPlayer(byId.get(s.player_id)!, s.slot, s.role)),
      bench: l.bench.map((id) => toMatchPlayer(byId.get(id)!)),
      };
    };
    const input: MatchInput = { fixture_id: f.id, home: team(home, hl, away, as), away: team(away, al, home, hs) };
    const seed = fixtureSeed(gameId, season, round, f.id);
    const input_hash = hashInput({ input, seed, engine: ENGINE_VERSION });
    const result = simulateMatch(input, seed);

    const avg = (l: ResolvedLineup) => l.starters.reduce((s, x) => s + byId.get(x.player_id)!.current_ovr, 0) / Math.max(1, l.starters.length);
    const strength = { [home.id]: avg(hl), [away.id]: avg(al) };
    const goals = { [home.id]: result.home_goals, [away.id]: result.away_goals };
    const statById = new Map(result.player_stats.map((s) => [s.player_id, s]));

    const updates: RoundPlayerUpdate[] = [];
    const logs: ProgressionLog[] = [];
    for (const p of [...hs, ...as]) {
      const st = statById.get(p.id);
      const own = p.club_id!;
      const opp = own === home.id ? away.id : home.id;
      const res: MatchPerformance["team_result"] = goals[own] > goals[opp] ? "W" : goals[own] === goals[opp] ? "D" : "L";
      const perf: MatchPerformance | null = st && st.minutes > 0 ? {
        minutes: st.minutes, started: st.started, rating: st.rating, goals: st.goals, assists: st.assists,
        cards_yellow: st.cards_yellow, cards_red: st.cards_red, clean_sheet: st.clean_sheet, stamina_end: st.stamina_end,
        injury: st.injury, team_result: res, own_strength: strength[own], opp_strength: strength[opp],
      } : null;
      const { update, log } = progressPlayer(p, perf, { season, round, clubPlayed: true, reputation: clubById.get(own)!.reputation });
      const ru: RoundPlayerUpdate = update;
      const ownClub = clubById.get(own)!;
      const plan = ownClub.training;
      if (plan) {
        const t = applyTraining(plan, p, update, `${gameId}|s${season}|r${round}|training|${own}`, ownClub.staff?.fitness ? staffInjuryFactor(ownClub.staff.fitness.level) : 1);
        ru.fitness = t.fitness;
        ru.development_xp = t.development_xp;
        if (t.injury) { ru.injured_matches = t.injury.matches; ru.injury_type = t.injury.type; }
      }
      if (ownClub.staff) applyStaff(ownClub.staff, p, ru, !!st?.injury);
      if (st && st.minutes > 0 && st.slot) {
        const fam = addFamiliarity(p.familiarity, st.slot, st.minutes);
        ru.position_familiarity = fam;
        if (!p.preferred_slot) {
          const inferred = inferPreferredSlot(p.position_group as PositionGroup, fam);
          if (inferred) ru.preferred_slot = inferred;
        }
      }
      updates.push(ru);
      if (log) logs.push(log);
    }

    const gate = home.stadium ? matchdayGate({ ...home.stadium, reputation: home.reputation }, away.reputation) : null;
    const ledger: LedgerEntry[] = [
      { club_id: home.id, type: "gate_receipts", amount_cents: gate ? gate.cents : gateReceiptsCents(home.reputation), key: `fixture:${f.id}:gate`, reference: f.id },
    ];
    for (const c of [home, away]) {
      const opp = c.id === home.id ? away.id : home.id;
      const bonus = resultBonusCents(goals[c.id], goals[opp]);
      if (bonus > 0) ledger.push({ club_id: c.id, type: "result_bonus", amount_cents: bonus, key: `fixture:${f.id}:bonus:${c.id}`, reference: f.id });
      const winBonus = goals[c.id] > goals[opp] ? (c.sponsors ?? []).reduce((s2, d) => s2 + d.win_bonus_cents, 0) : 0;
      if (winBonus > 0) ledger.push({ club_id: c.id, type: "sponsorship", amount_cents: winBonus, key: `fixture:${f.id}:sponsorwin:${c.id}`, reference: f.id });
    }

    out.push({
      fixture_id: f.id, seed, input, input_hash, result,
      lineups: [{ club_id: home.id, resolved: hl }, { club_id: away.id, resolved: al }],
      player_updates: updates, progression_logs: logs, ledger,
      ...(gate ? { attendance: gate.attendance } : {}),
    });
  }

  const bye: PlayerUpdate[] = [];
  for (const c of clubs) {
    if (playing.has(c.id)) continue;
    for (const p of squadOf(c.id)) {
      bye.push(progressPlayer(p, null, { season, round, clubPlayed: false, reputation: c.reputation }).update);
    }
  }

  const round_ledger: LedgerEntry[] = [];
  for (const c of clubs) {
    const wages = squadOf(c.id).reduce((s, p) => s + p.wage_cents, 0);
    round_ledger.push({ club_id: c.id, type: "wages", amount_cents: -wages, key: `round:${gameId}:${season}:${round}:wages:${c.id}` });
    const sponsor = c.sponsors ? c.sponsors.reduce((s2, d) => s2 + d.base_cents, 0) : sponsorshipCents(c.reputation);
    if (sponsor > 0) round_ledger.push({ club_id: c.id, type: "sponsorship", amount_cents: sponsor, key: `round:${gameId}:${season}:${round}:sponsor:${c.id}` });
    const staffWages = Object.values(c.staff ?? {}).reduce((s2, x) => s2 + (x?.wage_cents ?? 0), 0);
    if (staffWages > 0) round_ledger.push({ club_id: c.id, type: "staff_wages", amount_cents: -staffWages, key: `round:${gameId}:${season}:${round}:staff:${c.id}` });
  }
  return { fixtures: out, bye_player_updates: bye, round_ledger };
}

/** Staff effects on one player's post-round values: assistant (XP), fitness coach (recovery), medical (new injuries). */
function applyStaff(staff: NonNullable<LeagueClub["staff"]>, before: LeaguePlayer, u: RoundPlayerUpdate, newMatchInjury: boolean) {
  if (staff.assistant) {
    const gain = u.development_xp - before.development_xp;
    if (gain > 0) u.development_xp = Math.round((before.development_xp + gain * staffAssistantXp(staff.assistant.level)) * 1000) / 1000;
  }
  if (staff.fitness) u.fitness = Math.min(100, Math.round(u.fitness + staffFitness(staff.fitness.level)));
  if (staff.medical && newMatchInjury && u.injured_matches > 1) {
    u.injured_matches = Math.max(1, Math.round(u.injured_matches * staffMedical(staff.medical.level)));
  }
}

/** Apply a player update to an in-memory state (used by offline simulations and tests). */
export function applyUpdate(p: LeaguePlayer, u: RoundPlayerUpdate): void {
  if (u.position_familiarity) p.familiarity = u.position_familiarity;
  if (u.preferred_slot && !p.preferred_slot) p.preferred_slot = u.preferred_slot;
  Object.assign(p, {
    form: u.form, morale: u.morale, fitness: u.fitness, sharpness: u.sharpness, fatigue: u.fatigue,
    injured_matches: u.injured_matches, injury_type: u.injury_type, suspension_matches: u.suspension_matches,
    yellow_accumulation: u.yellow_accumulation, development_xp: u.development_xp, current_ovr: u.current_ovr,
    market_value_cents: u.market_value_cents, season_stats: u.season_stats, version: p.version + 1,
  });
}

export interface StandingRow {
  club_id: string; played: number; won: number; drawn: number; lost: number; gf: number; ga: number; points: number;
}

/** Ordering rule: points, goal difference, goals for, wins, then stable club id. (docs/decisions.md) */
export function sortStandings<T extends StandingRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || b.won - a.won || (a.club_id < b.club_id ? -1 : 1));
}

export function seasonEnd(args: {
  gameId: string; season: number; standings: StandingRow[]; clubs: LeagueClub[]; players: LeaguePlayer[];
}): { ledger: LedgerEntry[]; player_updates: SeasonEndUpdate[]; summary: Record<string, unknown> } {
  const order = sortStandings(args.standings);
  const repOf = new Map(args.clubs.map((c) => [c.id, c.reputation]));
  const ledger: LedgerEntry[] = order.map((row, i) => ({
    club_id: row.club_id, type: "prize_money", amount_cents: prizeMoneyCents(i + 1, order.length),
    key: `season:${args.gameId}:${args.season}:prize:${row.club_id}`,
  }));
  const updates = args.players.map((p) => endOfSeasonPlayer(p, { endingSeason: args.season, reputation: repOf.get(p.club_id ?? "") ?? 50 }));
  const top = [...args.players].filter((p) => p.season_stats).sort((a, b) => (b.season_stats?.goals ?? 0) - (a.season_stats?.goals ?? 0))[0];
  return {
    ledger,
    player_updates: updates,
    summary: {
      season: args.season,
      champion_club_id: order[0]?.club_id ?? null,
      table: order.map((r, i) => ({ position: i + 1, club_id: r.club_id, points: r.points })),
      top_scorer: top ? { player_id: top.id, name: top.name, goals: top.season_stats?.goals ?? 0 } : null,
    },
  };
}
