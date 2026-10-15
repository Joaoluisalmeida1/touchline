/**
 * Pure round orchestration shared by the server processor (DB-backed) and offline simulations.
 * Given an immutable snapshot of a league's state, computes everything a round produces:
 * match inputs/results, player updates, progression logs, ledger entries and used lineups.
 */
import { hashInput } from "../common/hash";
import type { Formation, PlayerProfile, PositionGroup, Tactics } from "../common/types";
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

export interface LeaguePlayer extends PlayerState {
  name: string;
  position_detail: string | null;
  profile: Partial<PlayerProfile>;
}

export interface LeagueClub {
  id: string;
  name: string;
  reputation: number;
  tactics: Tactics & { formation: Formation };
  saved_lineup: { formation: string; starters: LineupEntry[]; bench: string[] } | null;
}

export interface RoundFixture {
  id: string;
  home_club_id: string;
  away_club_id: string;
}

export interface LedgerEntry {
  club_id: string;
  type: "gate_receipts" | "sponsorship" | "wages" | "result_bonus" | "prize_money";
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
  player_updates: PlayerUpdate[];
  progression_logs: ProgressionLog[];
  ledger: LedgerEntry[];
}

export interface RoundOutcome {
  fixtures: FixtureOutcome[];
  bye_player_updates: PlayerUpdate[];
  round_ledger: LedgerEntry[];
}

const toSquad = (p: LeaguePlayer): SquadPlayer => ({
  id: p.id, position_group: p.position_group, position_detail: p.position_detail, current_ovr: p.current_ovr,
  fitness: p.fitness, injured_matches: p.injured_matches, suspension_matches: p.suspension_matches,
});

const toMatchPlayer = (p: LeaguePlayer, slot?: LineupEntry["slot"]): MatchPlayerInput => ({
  id: p.id, name: p.name, position_group: p.position_group as PositionGroup, position_detail: p.position_detail,
  slot, ovr: p.current_ovr, profile: p.profile, fitness: p.fitness, form: p.form, morale: p.morale, sharpness: p.sharpness,
});

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
    const team = (club: LeagueClub, l: ResolvedLineup) => ({
      club_id: club.id, name: club.name, formation: l.formation,
      tactics: {
        mentality: club.tactics.mentality, tempo: club.tactics.tempo, pressing: club.tactics.pressing,
        defensive_line: club.tactics.defensive_line, width: club.tactics.width,
        passing_directness: club.tactics.passing_directness, transitions: club.tactics.transitions,
      },
      starters: l.starters.map((s) => toMatchPlayer(byId.get(s.player_id)!, s.slot)),
      bench: l.bench.map((id) => toMatchPlayer(byId.get(id)!)),
    });
    const input: MatchInput = { fixture_id: f.id, home: team(home, hl), away: team(away, al) };
    const seed = fixtureSeed(gameId, season, round, f.id);
    const input_hash = hashInput({ input, seed, engine: ENGINE_VERSION });
    const result = simulateMatch(input, seed);

    const avg = (l: ResolvedLineup) => l.starters.reduce((s, x) => s + byId.get(x.player_id)!.current_ovr, 0) / Math.max(1, l.starters.length);
    const strength = { [home.id]: avg(hl), [away.id]: avg(al) };
    const goals = { [home.id]: result.home_goals, [away.id]: result.away_goals };
    const statById = new Map(result.player_stats.map((s) => [s.player_id, s]));

    const updates: PlayerUpdate[] = [];
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
      updates.push(update);
      if (log) logs.push(log);
    }

    const ledger: LedgerEntry[] = [
      { club_id: home.id, type: "gate_receipts", amount_cents: gateReceiptsCents(home.reputation), key: `fixture:${f.id}:gate`, reference: f.id },
    ];
    for (const c of [home, away]) {
      const opp = c.id === home.id ? away.id : home.id;
      const bonus = resultBonusCents(goals[c.id], goals[opp]);
      if (bonus > 0) ledger.push({ club_id: c.id, type: "result_bonus", amount_cents: bonus, key: `fixture:${f.id}:bonus:${c.id}`, reference: f.id });
    }

    out.push({
      fixture_id: f.id, seed, input, input_hash, result,
      lineups: [{ club_id: home.id, resolved: hl }, { club_id: away.id, resolved: al }],
      player_updates: updates, progression_logs: logs, ledger,
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
    round_ledger.push({ club_id: c.id, type: "sponsorship", amount_cents: sponsorshipCents(c.reputation), key: `round:${gameId}:${season}:${round}:sponsor:${c.id}` });
  }
  return { fixtures: out, bye_player_updates: bye, round_ledger };
}

/** Apply a player update to an in-memory state (used by offline simulations and tests). */
export function applyUpdate(p: LeaguePlayer, u: PlayerUpdate): void {
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
