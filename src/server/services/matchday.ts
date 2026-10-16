/**
 * Idempotent matchday processor. Safe to call repeatedly / concurrently:
 *  - begin_matchday acquires a lease (only one processor per game),
 *  - each fixture is finalized exactly once (fixture row lock + status check),
 *  - complete_matchday / end_season are guarded by round/season numbers and ledger idempotency keys.
 * A crash mid-round leaves completed fixtures intact; the next call resumes the same round.
 */
import type { Pool } from "pg";
import type { Formation, LineupInstructions, Tactics } from "../../engine/common/types";
import { ENGINE_VERSION } from "../../engine/match/config";
import { processRound, seasonEnd, type LeagueClub, type LeaguePlayer, type StandingRow } from "../../engine/league/round";
import type { LineupEntry } from "../../engine/lineup/autopick";
import type { MatchPlanRule } from "../../engine/match/types";
import type { TrainingPlan } from "../../engine/training/training";
import { asService } from "../pg";
import { publishRound } from "./newspaper";
import { flushPush } from "./push";
import { prepareWeek } from "./week";
import { afterRound, ensureBusiness, resolveSponsorDefaults, seasonClauses } from "./business";
import { afterRoundSocial } from "./social";
import { absRound, stadiumFrom, type StaffRole, type Upgrade } from "../../engine/economy/business";

export interface MatchdayResult {
  status: "processed" | "skipped";
  reason?: string;
  round?: number;
  season?: number;
  fixtures?: { fixture_id: string; home_goals: number; away_goals: number; status: string }[];
  season_completed?: boolean;
}

const log = (msg: string, ctx: Record<string, unknown>) => console.log(JSON.stringify({ level: "info", msg, ...ctx }));

/** `at` = the round about to be played: its answered press conferences feed the match (phase 2). */
export async function loadLeagueState(pool: Pool, gameId: string, at?: { season: number; round: number }) {
  return asService(pool, async (c) => {
    const clubs = await c.query(
      `select gc.id, gc.name_snapshot, gc.reputation, t.formation, t.mentality, t.tempo, t.pressing, t.defensive_line, t.width,
              t.passing_directness, t.transitions, l.formation as l_formation, l.starters_json, l.bench_json, l.instructions_json,
              tp.intensity as tr_intensity, tp.focus as tr_focus, mp.rules as mp_rules, mp.marking as mp_marking
         from public.game_clubs gc
         left join public.tactics t on t.club_id = gc.id
         left join public.lineups l on l.club_id = gc.id and l.fixture_id is null
         left join public.training_plans tp on tp.club_id = gc.id
         left join public.match_plans mp on mp.club_id = gc.id
        where gc.game_id = $1 order by gc.id`, [gameId]);
    const gs = (await c.query<{ current_season: number; current_matchday: number }>(`select current_season, current_matchday from public.games where id = $1`, [gameId])).rows[0];
    const season = at?.season ?? gs.current_season;
    const now = absRound(season, at?.round ?? gs.current_matchday);
    const biz = new Map((await c.query<{ club_id: string; fan_mood: number; ticket_price: "low" | "normal" | "high"; base_capacity: number; upgrades: Upgrade[] }>(
      `select club_id, fan_mood, ticket_price, base_capacity, upgrades from public.club_business where game_id = $1`, [gameId])).rows.map((r) => [r.club_id, r]));
    const deals = (await c.query<{ id: string; club_id: string; base_cents: string; win_bonus_cents: string }>(
      `select id, club_id, base_cents, win_bonus_cents from public.sponsor_deals where game_id = $1 and start_season <= $2 and end_season >= $2`, [gameId, season])).rows;
    const staff = (await c.query<{ club_id: string; role: StaffRole; level: number; wage_cents: string }>(
      `select club_id, role, level, wage_cents from public.club_staff where game_id = $1 and active`, [gameId])).rows;
    const press = new Map<string, { own_control?: number; opp_control?: number; calm?: boolean }>();
    if (at) {
      const pr = await c.query(
        `select club_id, effects from public.press_conferences
          where game_id = $1 and season = $2 and round = $3 and answered_at is not null`, [gameId, at.season, at.round]);
      for (const r of pr.rows) {
        const e = r.effects ?? {};
        press.set(r.club_id, { own_control: Number(e.own_control ?? 0), opp_control: Number(e.opp_control ?? 0), calm: !!e.calm });
      }
    }
    const players = await c.query(
      `select id, version, club_id, name_snapshot, position_group, position_detail, age, current_ovr, potential_cap, potential_band,
              hidden_development_rate, form, morale, fitness, sharpness, fatigue, injured_matches, injury_type, suspension_matches,
              yellow_accumulation, development_xp, market_value_cents, wage_cents, contract_end_season, season_stats_json, profile_json,
              preferred_slot, position_familiarity
         from public.game_players where game_id = $1 and club_id is not null order by id`, [gameId]);
    const leagueClubs: LeagueClub[] = clubs.rows.map((r) => ({
      id: r.id, name: r.name_snapshot, reputation: r.reputation,
      tactics: {
        formation: (r.formation ?? "4-3-3") as Formation, mentality: r.mentality ?? "balanced", tempo: r.tempo ?? "normal",
        pressing: r.pressing ?? "medium", defensive_line: r.defensive_line ?? "medium", width: r.width ?? "balanced",
        passing_directness: r.passing_directness ?? "mixed", transitions: r.transitions ?? "balanced",
      } as Tactics & { formation: Formation },
      saved_lineup: r.starters_json ? {
        formation: r.l_formation, starters: r.starters_json as LineupEntry[], bench: (r.bench_json ?? []) as string[],
        instructions: (r.instructions_json ?? {}) as LineupInstructions,
      } : null,
      ...(r.tr_intensity ? { training: { intensity: r.tr_intensity, focus: r.tr_focus } as TrainingPlan } : {}),
      ...(Array.isArray(r.mp_marking) && r.mp_marking.length ? { marking: r.mp_marking as string[] } : {}),
      ...(Array.isArray(r.mp_rules) && r.mp_rules.length ? { plans: r.mp_rules as MatchPlanRule[] } : {}),
      ...(press.has(r.id) ? { press: press.get(r.id)! } : {}),
      ...(biz.has(r.id) ? (() => {
        const b = biz.get(r.id)!;
        const st = stadiumFrom(b.base_capacity, b.upgrades ?? [], now);
        return {
          stadium: { capacity: st.capacity, vip_level: st.vip_level, fan_mood: b.fan_mood, ticket_price: b.ticket_price },
          sponsors: deals.filter((d) => d.club_id === r.id).sort((a, b2) => (a.id < b2.id ? -1 : 1))
            .map((d) => ({ id: d.id, base_cents: Number(d.base_cents), win_bonus_cents: Number(d.win_bonus_cents) })),
          staff: Object.fromEntries(staff.filter((x) => x.club_id === r.id).map((x) => [x.role, { level: x.level, wage_cents: Number(x.wage_cents) }])),
        };
      })() : {}),
    }));
    const leaguePlayers: LeaguePlayer[] = players.rows.map((r) => ({
      id: r.id, version: r.version, club_id: r.club_id, name: r.name_snapshot, position_group: r.position_group,
      position_detail: r.position_detail, profile: r.profile_json ?? {}, age: r.age, current_ovr: r.current_ovr,
      potential_cap: r.potential_cap, potential_band: r.potential_band, hidden_development_rate: Number(r.hidden_development_rate),
      form: Number(r.form), morale: r.morale, fitness: r.fitness, sharpness: r.sharpness, fatigue: r.fatigue,
      injured_matches: r.injured_matches, injury_type: r.injury_type, suspension_matches: r.suspension_matches,
      yellow_accumulation: r.yellow_accumulation, development_xp: Number(r.development_xp),
      market_value_cents: Number(r.market_value_cents), wage_cents: Number(r.wage_cents), contract_end_season: r.contract_end_season,
      season_stats: r.season_stats_json ?? null, value_anchor_ratio: Number(r.profile_json?.value_anchor_ratio ?? 1),
      physical: Number(r.profile_json?.physical ?? 60),
      preferred_slot: r.preferred_slot ?? null, familiarity: r.position_familiarity ?? {},
    }));
    return { clubs: leagueClubs, players: leaguePlayers };
  });
}

export async function processNextMatchday(pool: Pool, gameId: string, opts: { leaseSeconds?: number; requestId?: string } = {}): Promise<MatchdayResult> {
  const ctx = { game_id: gameId, request_id: opts.requestId ?? null, engine: ENGINE_VERSION };
  const begin = await asService(pool, async (c) =>
    (await c.query(`select public.begin_matchday($1, $2) as r`, [gameId, opts.leaseSeconds ?? 240])).rows[0].r);
  if (!begin.acquired) {
    if (begin.reason === "season_complete") {
      // last round done but season not rolled over (e.g. crash after complete_matchday)
      await endSeason(pool, gameId);
      return { status: "processed", reason: "season_rolled_over", season_completed: true };
    }
    return { status: "skipped", reason: begin.reason, round: begin.round };
  }
  const round: number = begin.round;
  const season: number = begin.season_number;
  log("matchday.begin", { ...ctx, round, season });
  try {
    const fixtures = await asService(pool, async (c) => (await c.query(
      `select id, home_club_id, away_club_id, status from public.fixtures where season_id = $1 and round_number = $2 order by id`,
      [begin.season_id, round])).rows);
    const pending = fixtures.filter((f) => f.status !== "completed");
    const done = fixtures.filter((f) => f.status === "completed");
    // Gabinete: events whose deadline is this round fall back to their default choice before the squads are read
    await asService(pool, (c) => c.query(`select public.resolve_due_events($1, $2)`, [gameId, round]));
    // club business: season setup (first time / new season) and default sponsor signings for this round
    await ensureBusiness(pool, gameId);
    await resolveSponsorDefaults(pool, gameId, season, round);
    const state = await loadLeagueState(pool, gameId, { season, round });
    const outcome = processRound({
      gameId, season, round, clubs: state.clubs, players: state.players, fixtures: pending,
      alreadyPlayedClubIds: done.flatMap((f) => [f.home_club_id, f.away_club_id]),
    });

    const results: NonNullable<MatchdayResult["fixtures"]> = done.map((f) => ({ fixture_id: f.id, home_goals: -1, away_goals: -1, status: "already_completed" }));
    for (const fo of outcome.fixtures) {
      const t0 = Date.now();
      const payload = {
        input_hash: fo.input_hash, seed: fo.seed, engine_version: fo.result.engine_version, input_snapshot: fo.input,
        result: {
          home_goals: fo.result.home_goals, away_goals: fo.result.away_goals, team_stats: fo.result.team_stats,
          momentum: fo.result.momentum, duration_seconds: Math.round(fo.result.duration_seconds),
          ...(fo.result.plans_fired ? { plans_fired: fo.result.plans_fired } : {}),
          ...(fo.attendance ? { attendance: fo.attendance } : {}),
        },
        events: fo.result.events.map((e) => ({
          sequence_number: e.sequence_number, minute: e.minute, second: e.second, club_id: e.club_id, player_id: e.player_id,
          related_player_id: e.related_player_id, event_type: e.event_type, payload: e.payload,
        })),
        player_stats: fo.result.player_stats.filter((s) => s.minutes > 0 || s.started).map((s) => ({
          player_id: s.player_id, club_id: s.club_id, started: s.started, minutes: s.minutes, rating: s.rating, goals: s.goals,
          assists: s.assists, shots: s.shots, shots_on_target: s.shots_on_target, xg: s.xg, passes_attempted: s.passes_attempted,
          passes_completed: s.passes_completed, tackles: s.tackles, interceptions: s.interceptions, saves: s.saves, fouls: s.fouls,
          cards_yellow: s.cards_yellow, cards_red: s.cards_red, clean_sheet: s.clean_sheet,
          metadata: { own_goals: s.own_goals, stamina_end: s.stamina_end, injury: s.injury },
        })),
        lineups: fo.lineups.map((l) => ({
          club_id: l.club_id, formation: l.resolved.formation, starters: l.resolved.starters, bench: l.resolved.bench,
          auto_generated: l.resolved.auto_generated, warnings: l.resolved.warnings,
        })),
        player_updates: fo.player_updates,
        progression_logs: fo.progression_logs,
        ledger: fo.ledger,
      };
      const r = await asService(pool, async (c) =>
        (await c.query(`select public.finalize_fixture($1, $2) as r`, [fo.fixture_id, JSON.stringify(payload)])).rows[0].r);
      results.push({ fixture_id: fo.fixture_id, home_goals: r.home_goals, away_goals: r.away_goals, status: r.status });
      log("fixture.finalized", { ...ctx, fixture_id: fo.fixture_id, status: r.status, ms: Date.now() - t0, simulation_version: fo.result.engine_version });
    }

    const complete = await asService(pool, async (c) => (await c.query(`select public.complete_matchday($1, $2, $3) as r`, [
      gameId, round, JSON.stringify({ player_updates: outcome.bye_player_updates, ledger: outcome.round_ledger }),
    ])).rows[0].r);
    log("matchday.complete", { ...ctx, round, season_complete: complete.season_complete });
    // after-match stages: newspaper + awards + event log, then push. Never fail a processed matchday because of them
    // (the newspaper page back-fills missing editions lazily).
    try {
      await publishRound(pool, gameId, season, round);
      log("newspaper.published", { ...ctx, round });
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "newspaper.failed", ...ctx, round, error: (e as Error).message }));
    }
    try {
      await afterRound(pool, gameId, season, round);
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "business.after_round_failed", ...ctx, round, error: (e as Error).message }));
    }
    try {
      await afterRoundSocial(pool, gameId, season, round);
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "social.after_round_failed", ...ctx, round, error: (e as Error).message }));
    }
    if (!complete.season_complete) {
      try {
        await prepareWeek(pool, gameId, season, round + 1);
        log("week.prepared", { ...ctx, next_round: round + 1 });
      } catch (e) {
        console.error(JSON.stringify({ level: "error", msg: "week.failed", ...ctx, round, error: (e as Error).message }));
      }
    }
    await flushPush(pool).catch((e) => console.error(JSON.stringify({ level: "error", msg: "push.failed", ...ctx, error: (e as Error).message })));
    let seasonCompleted = false;
    if (complete.season_complete) {
      await endSeason(pool, gameId);
      seasonCompleted = true;
    }
    return { status: "processed", round, season, fixtures: results, season_completed: seasonCompleted };
  } catch (e) {
    // release the lease so a retry can resume immediately; processing_round is kept for resume
    await asService(pool, (c) => c.query(`select public.release_matchday_lease($1)`, [gameId]));
    console.error(JSON.stringify({ level: "error", msg: "matchday.failed", ...ctx, round, error: (e as Error).message }));
    throw e;
  }
}

export async function endSeason(pool: Pool, gameId: string) {
  const { season, standings } = await asService(pool, async (c) => {
    const g = await c.query(`select current_season from public.games where id = $1`, [gameId]);
    const s = await c.query(
      `select st.club_id, st.played, st.won, st.drawn, st.lost, st.gf, st.ga, st.points
         from public.standings st join public.seasons se on se.id = st.season_id
        where se.game_id = $1 and se.number = $2`, [gameId, g.rows[0].current_season]);
    return { season: g.rows[0].current_season as number, standings: s.rows as StandingRow[] };
  });
  const state = await loadLeagueState(pool, gameId);
  const end = seasonEnd({ gameId, season, standings, clubs: state.clubs, players: state.players });
  const table = (end.summary.table as { club_id: string }[]) ?? [];
  const clauses = await seasonClauses(pool, gameId, season, table);
  const r = await asService(pool, async (c) => (await c.query(`select public.end_season($1, $2) as r`, [
    gameId, JSON.stringify({ season_number: season, ledger: [...end.ledger, ...clauses], player_updates: end.player_updates, summary: end.summary }),
  ])).rows[0].r);
  // new season: board, budgets, staff pool and sponsor offers
  await ensureBusiness(pool, gameId).catch((e) => console.error(JSON.stringify({ level: "error", msg: "business.season_setup_failed", game_id: gameId, error: (e as Error).message })));
  return r;
}

/** Cron entry: process games in daily mode whose deadline passed. Bounded batch per invocation. */
export async function processDueGames(pool: Pool, opts: { limit?: number; requestId?: string } = {}) {
  const due = await asService(pool, async (c) => (await c.query(
    `select id from public.games where status = 'active' and tick_mode = 'daily' and next_deadline_at <= now()
       and (processing_lease_until is null or processing_lease_until < now())
     order by next_deadline_at limit $1`, [opts.limit ?? 10])).rows as { id: string }[]);
  const out: { game_id: string; result?: MatchdayResult; error?: string }[] = [];
  for (const g of due) {
    try {
      out.push({ game_id: g.id, result: await processNextMatchday(pool, g.id, { requestId: opts.requestId }) });
    } catch (e) {
      out.push({ game_id: g.id, error: (e as Error).message });
    }
  }
  return out;
}
