/**
 * Offline multi-season simulation of a FICTIONAL league (balance testing of progression + economy).
 * Not used in production paths.
 */
import { createRng } from "../common/rng";
import { DEFAULT_TACTICS, type PositionGroup } from "../common/types";
import { initialCashCents, reputationFromStrength, weeklyWageCents, initialContractEnd } from "../economy/economy";
import { formulaValueEur } from "../rating/initial-rating";
import { emptySeasonStats } from "../progression/progression";
import { applyUpdate, processRound, seasonEnd, type LeagueClub, type LeaguePlayer, type StandingRow } from "./round";

/** Circle-method double round robin (TS twin of public._generate_fixtures, used for offline sims). */
export function roundRobin(clubIds: string[]): { round: number; home: string; away: string }[] {
  const arr: (string | null)[] = [...clubIds];
  if (arr.length % 2) arr.push(null);
  const n = arr.length;
  const rounds = n - 1;
  const out: { round: number; home: string; away: string }[] = [];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n / 2; i++) {
      let h = arr[i];
      let a = arr[n - 1 - i];
      if ((i === 0 && r % 2 === 1) || (i > 0 && i % 2 === 1)) [h, a] = [a, h];
      if (h && a) {
        out.push({ round: r + 1, home: h, away: a });
        out.push({ round: r + 1 + rounds, home: a, away: h });
      }
    }
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr.splice(0, n, fixed, ...rest);
  }
  return out;
}

export interface SimLeague {
  clubs: LeagueClub[];
  players: LeaguePlayer[];
  cash: Map<string, number>;
}

export function buildSyntheticLeague(seed: string, clubCount = 18, squadSize = 25): SimLeague {
  const rng = createRng(seed);
  const clubs: LeagueClub[] = [];
  const players: LeaguePlayer[] = [];
  const cash = new Map<string, number>();
  const groups: PositionGroup[] = ["GK", "GK", "GK", "DEF", "DEF", "DEF", "DEF", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "MID", "MID", "MID", "MID", "ATT", "ATT", "ATT", "ATT", "ATT", "ATT"];
  for (let c = 0; c < clubCount; c++) {
    const id = `club-${String(c).padStart(2, "0")}`;
    const level = 66 + (16 * (clubCount - 1 - c)) / (clubCount - 1);
    const rep = reputationFromStrength(level + 3);
    clubs.push({ id, name: `Fictional FC ${c}`, reputation: rep, tactics: { ...DEFAULT_TACTICS, formation: "4-3-3" }, saved_lineup: null });
    let squadValue = 0;
    for (let i = 0; i < squadSize; i++) {
      const group = groups[i % groups.length];
      const age = rng.int(18, 34);
      const ovr = Math.round(Math.min(92, Math.max(45, level + rng.normal(i < 14 ? 2 : -4, 3.5))));
      const head = age <= 23 ? rng.int(3, 12) : age <= 27 ? rng.int(0, 4) : 0;
      const value = formulaValueEur(ovr, group, age) * 100;
      squadValue += value;
      const pid = `${id}-p${String(i).padStart(2, "0")}`;
      players.push({
        id: pid, version: 1, club_id: id, name: `Player ${pid}`, position_group: group, position_detail: null, profile: {},
        age, current_ovr: ovr, potential_cap: Math.min(99, ovr + head), potential_band: "C", hidden_development_rate: 1 + rng.normal(0, 0.08),
        form: 0, morale: 60, fitness: 100, sharpness: 70, fatigue: 0, injured_matches: 0, injury_type: null, suspension_matches: 0,
        yellow_accumulation: 0, development_xp: 0, market_value_cents: value, wage_cents: weeklyWageCents(ovr, rep),
        contract_end_season: initialContractEnd(pid), season_stats: emptySeasonStats(), value_anchor_ratio: 1, physical: 60,
      });
    }
    cash.set(id, initialCashCents(squadValue, rep));
  }
  return { clubs, players, cash };
}

export interface SeasonReport {
  season: number;
  avgGoals: number;
  drawRate: number;
  avgOvr: number;
  avgValueCents: number;
  clubsInDebt: number;
  minCashCents: number;
  maxCashCents: number;
  ovrDeltas: { id: string; age: number | null; startOvr: number; endOvr: number; minutes: number }[];
}

export function simulateSeasons(seed: string, seasons: number): { reports: SeasonReport[]; league: SimLeague } {
  const league = buildSyntheticLeague(seed);
  const reports: SeasonReport[] = [];
  for (let s = 1; s <= seasons; s++) {
    const fixtures = roundRobin(league.clubs.map((c) => c.id));
    const rounds = Math.max(...fixtures.map((f) => f.round));
    const table = new Map<string, StandingRow>(league.clubs.map((c) => [c.id, { club_id: c.id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }]));
    const startOvr = new Map(league.players.map((p) => [p.id, p.current_ovr]));
    let goals = 0, draws = 0, matches = 0;
    for (let r = 1; r <= rounds; r++) {
      const rf = fixtures.filter((f) => f.round === r).map((f, i) => ({ id: `s${s}r${r}f${i}`, home_club_id: f.home, away_club_id: f.away }));
      const out = processRound({ gameId: seed, season: s, round: r, clubs: league.clubs, players: league.players, fixtures: rf });
      const byId = new Map(league.players.map((p) => [p.id, p]));
      for (const fo of out.fixtures) {
        for (const u of fo.player_updates) applyUpdate(byId.get(u.id)!, u);
        for (const l of fo.ledger) league.cash.set(l.club_id, league.cash.get(l.club_id)! + l.amount_cents);
        const f = rf.find((x) => x.id === fo.fixture_id)!;
        const h = table.get(f.home_club_id)!, a = table.get(f.away_club_id)!;
        const hg = fo.result.home_goals, ag = fo.result.away_goals;
        goals += hg + ag; matches++;
        if (hg === ag) draws++;
        for (const [row, gf, ga] of [[h, hg, ag], [a, ag, hg]] as const) {
          row.played++; row.gf += gf; row.ga += ga;
          if (gf > ga) { row.won++; row.points += 3; } else if (gf === ga) { row.drawn++; row.points += 1; } else row.lost++;
        }
      }
      for (const u of out.bye_player_updates) applyUpdate(byId.get(u.id)!, u);
      for (const l of out.round_ledger) league.cash.set(l.club_id, league.cash.get(l.club_id)! + l.amount_cents);
    }
    const end = seasonEnd({ gameId: seed, season: s, standings: [...table.values()], clubs: league.clubs, players: league.players });
    for (const l of end.ledger) league.cash.set(l.club_id, league.cash.get(l.club_id)! + l.amount_cents);
    const deltas = league.players.map((p) => ({ id: p.id, age: p.age, startOvr: startOvr.get(p.id)!, endOvr: p.current_ovr, minutes: p.season_stats?.minutes ?? 0 }));
    for (const u of end.player_updates) {
      const p = league.players.find((x) => x.id === u.id)!;
      Object.assign(p, { age: u.age, potential_cap: u.potential_cap, contract_end_season: u.contract_end_season, wage_cents: u.wage_cents,
        form: u.form, fitness: u.fitness, fatigue: u.fatigue, sharpness: u.sharpness, season_stats: u.season_stats });
    }
    const cashes = [...league.cash.values()];
    reports.push({
      season: s, avgGoals: goals / matches, drawRate: draws / matches,
      avgOvr: league.players.reduce((a, p) => a + p.current_ovr, 0) / league.players.length,
      avgValueCents: league.players.reduce((a, p) => a + p.market_value_cents, 0) / league.players.length,
      clubsInDebt: cashes.filter((c) => c < 0).length, minCashCents: Math.min(...cashes), maxCashCents: Math.max(...cashes),
      ovrDeltas: deltas,
    });
  }
  return { reports, league };
}
