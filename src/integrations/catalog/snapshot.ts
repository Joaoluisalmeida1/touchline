/**
 * Build & freeze a dataset snapshot from catalog players using initial-rating-v1.
 * A snapshot is immutable once finalized; games reference it and evolve independently.
 */
import type { Pool } from "pg";
import { autoPickLineup } from "../../engine/lineup/autopick";
import { reputationFromStrength } from "../../engine/economy/economy";
import { calibrate, derivePlayer, INITIAL_RATING_VERSION, type EloAnchors, type RatingInputPlayer } from "../../engine/rating/initial-rating";
import type { PositionGroup } from "../../engine/common/types";

export interface BuildSnapshotOptions {
  provider: string;
  leagueExternalIds: string[];
  label: string;
  anchors?: EloAnchors | null;
  minSquad?: number;
  asOf?: Date; // for ages (only from verified birth dates)
}

function ageAt(birth: string | null, asOf: Date): number | null {
  if (!birth) return null;
  const b = new Date(birth + "T00:00:00Z");
  let age = asOf.getUTCFullYear() - b.getUTCFullYear();
  const m = asOf.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && asOf.getUTCDate() < b.getUTCDate())) age--;
  return age >= 14 && age <= 50 ? age : null;
}

export async function buildSnapshot(pool: Pool, opts: BuildSnapshotOptions) {
  const asOf = opts.asOf ?? new Date();
  const minSquad = opts.minSquad ?? 16;
  const leagues = await pool.query<{ id: string; external_id: string; name: string; is_synthetic: boolean }>(
    `select l.id, l.external_id, l.name, pr.is_synthetic from public.source_leagues l
       join public.source_providers pr on pr.id = l.provider
      where l.provider = $1 and l.external_id = any($2)`,
    [opts.provider, opts.leagueExternalIds],
  );
  if (leagues.rowCount !== opts.leagueExternalIds.length) {
    throw new Error(`Unknown league ids: found ${leagues.rowCount}/${opts.leagueExternalIds.length}`);
  }
  const leagueIds = leagues.rows.map((l) => l.id);
  const players = await pool.query<{
    id: string; display_name: string; position_group: PositionGroup | null; position_detail: string | null; birth_date: string | null;
    club_id: string | null; league_id: string; provider_elo: string | null; ear_180: string | null; market_value_eur: string | null;
    games_played: number | null; total_minutes: number | null; data_quality_flags: string[];
  }>(
    `select id, display_name, position_group, position_detail, to_char(birth_date, 'YYYY-MM-DD') as birth_date, club_id, league_id,
            provider_elo, ear_180, market_value_eur, games_played, total_minutes, data_quality_flags
       from public.source_players where league_id = any($1) order by id`,
    [leagueIds],
  );
  const clubs = await pool.query<{ id: string; name: string; short_name: string | null; league_id: string }>(
    `select id, name, short_name, league_id from public.source_clubs where league_id = any($1) order by id`, [leagueIds]);

  const inputs: (RatingInputPlayer & { row: (typeof players.rows)[number] })[] = players.rows.map((r) => ({
    key: r.id, position_group: r.position_group, elo: r.provider_elo === null ? null : Number(r.provider_elo),
    ear_180: r.ear_180 === null ? null : Number(r.ear_180), market_value_eur: r.market_value_eur === null ? null : Number(r.market_value_eur),
    total_minutes: r.total_minutes, games_played: r.games_played, age: ageAt(r.birth_date, asOf), league_key: r.league_id, row: r,
  }));
  const params = calibrate(inputs, opts.anchors ?? null);

  const db = await pool.connect();
  try {
    await db.query("begin");
    const snap = await db.query<{ id: string }>(
      `insert into public.dataset_snapshots (label, source, is_synthetic, scoring_version, league_ids, params_json)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [opts.label, opts.provider, leagues.rows.every((l) => l.is_synthetic), INITIAL_RATING_VERSION, leagueIds,
        JSON.stringify({ ...params, anchors: opts.anchors ?? null, as_of: asOf.toISOString() })],
    );
    const snapshotId = snap.rows[0].id;
    const derived = inputs.map((p) => ({ p, d: derivePlayer(p, params, snapshotId) }));

    const byClub = new Map<string, typeof derived>();
    for (const x of derived) if (x.p.row.club_id) byClub.set(x.p.row.club_id, [...(byClub.get(x.p.row.club_id) ?? []), x]);
    const excludedClubs: { club_id: string; name: string; players: number }[] = [];
    let playersIn = 0;
    for (const c of clubs.rows) {
      const squad = byClub.get(c.id) ?? [];
      if (squad.length < minSquad || !squad.some((x) => x.d.position_group === "GK")) {
        excludedClubs.push({ club_id: c.id, name: c.name, players: squad.length });
        continue;
      }
      const xi = autoPickLineup(squad.map((x) => ({ id: x.p.key, position_group: x.d.position_group, current_ovr: x.d.initial_ovr, fitness: 100, injured_matches: 0, suspension_matches: 0 })), "4-3-3");
      const ovrById = new Map(squad.map((x) => [x.p.key, x.d.initial_ovr]));
      const strength = xi.starters.reduce((s, e) => s + ovrById.get(e.player_id)!, 0) / Math.max(1, xi.starters.length);
      await db.query(
        `insert into public.dataset_snapshot_clubs (snapshot_id, source_club_id, league_id, name, short_name, strength, reputation)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [snapshotId, c.id, c.league_id, c.name, c.short_name ?? shortName(c.name), Math.round(strength * 100) / 100, reputationFromStrength(strength)],
      );
      for (const { p, d } of squad) {
        await db.query(
          `insert into public.dataset_snapshot_players (snapshot_id, source_player_id, source_club_id, display_name, position_group,
             position_detail, initial_ovr, initial_potential, hidden_development_rate, base_value_eur, age_at_import, birth_date,
             confidence, derived_profile_json, derivation_json)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [snapshotId, p.key, c.id, p.row.display_name, d.position_group, p.row.position_detail, d.initial_ovr, d.initial_potential,
            d.hidden_development_rate, d.base_value_eur, p.age, p.row.birth_date, d.confidence, JSON.stringify(d.profile), JSON.stringify(d.derivation)],
        );
        playersIn++;
      }
    }
    const ovrs = derived.map((x) => x.d.initial_ovr);
    const hist: Record<string, number> = {};
    for (const o of ovrs) {
      const b = `${Math.floor(o / 5) * 5}-${Math.floor(o / 5) * 5 + 4}`;
      hist[b] = (hist[b] ?? 0) + 1;
    }
    const flagCounts: Record<string, number> = {};
    for (const x of derived) for (const f of x.d.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
    const report = {
      players_considered: derived.length, players_in_snapshot: playersIn, clubs_in_snapshot: clubs.rows.length - excludedClubs.length,
      excluded_clubs: excludedClubs, players_without_club: derived.filter((x) => !x.p.row.club_id).length,
      ovr_histogram: hist, flag_counts: flagCounts, calibration_warnings: params.warnings, reference: params.reference,
    };
    await db.query(
      `update public.dataset_snapshots set status = 'finalized', finalized_at = now(), data_quality_report = $2 where id = $1`,
      [snapshotId, JSON.stringify(report)],
    );
    await db.query("commit");
    return { snapshotId, report };
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
  }
}

export function shortName(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter((w) => w.length > 2 && !/^(fc|cf|sc|cd|ac|club|de|da|do)$/i.test(w));
  const base = (words[0] ?? name).toUpperCase();
  return base.slice(0, 3);
}
