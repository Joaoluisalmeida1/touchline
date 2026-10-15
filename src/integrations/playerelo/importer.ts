/**
 * Selective, resumable PlayerElo import into the global catalog (source_* tables).
 * Runs from the CLI (scripts/playerelo/*) — long operations must not live in a single serverless invocation.
 */
import type { Pool, PoolClient } from "pg";
import { PlayerEloClient, PlayerEloError } from "./client";
import { nameKey, normalizeLeague, normalizePlayer, type NormalizedPlayer } from "./normalize";
import { LeagueRowSchema, parseRows, PlayerRowSchema, UsageSchema } from "./schemas";

export const PROVIDER = "playerelo";

export interface ImportOptions {
  leagueIds: string[]; // provider external ids
  pageSize?: number; // <= 100
  maxRequests?: number; // hard budget for this run
  retainRaw?: boolean; // only if the licence allows retention
  log?: (msg: string) => void;
}

export async function getUsage(client: PlayerEloClient): Promise<{ used: number | null; cap: number | null; remaining: number | null; raw: unknown }> {
  const res = await client.usage();
  const p = UsageSchema.safeParse(res.data);
  return p.success
    ? { used: p.data.used ?? null, cap: p.data.cap ?? null, remaining: p.data.remaining ?? null, raw: res.data }
    : { used: null, cap: null, remaining: null, raw: res.data };
}

export async function discoverLeagues(pool: Pool, client: PlayerEloClient) {
  const res = await client.leagues();
  const { rows, invalid, shape } = parseRows(res.data, LeagueRowSchema);
  const leagues = rows.map(normalizeLeague).filter((x): x is NonNullable<typeof x> => x !== null);
  for (const l of leagues) {
    await pool.query(
      `insert into public.source_leagues (provider, external_id, name, country, strength, metadata_json, updated_at)
       values ($1,$2,$3,$4,$5,$6, now())
       on conflict (provider, external_id) do update set name = excluded.name, country = excluded.country,
         strength = excluded.strength, metadata_json = excluded.metadata_json, updated_at = now()`,
      [PROVIDER, l.external_id, l.name, l.country, l.strength, JSON.stringify({ discovered_shape: shape })],
    );
  }
  return { leagues, invalid, shape, sample: Array.isArray(res.data) ? res.data.slice(0, 2) : res.data };
}

/** Global ranking anchors: elo of the player at rank r (list is ordered by Elo desc). One request per rank. */
export async function fetchAnchors(client: PlayerEloClient, ranks = [1, 10, 50, 100, 300, 1000, 3000, 7000, 15000, 30000, 50000]) {
  const points: { rank: number; elo: number }[] = [];
  for (const rank of ranks) {
    try {
      const res = await client.players({ limit: 1, offset: rank - 1 });
      const { rows } = parseRows(res.data, PlayerRowSchema);
      if (rows[0]?.elo != null) points.push({ rank, elo: rows[0].elo });
    } catch (e) {
      if (e instanceof PlayerEloError && e.status === 404) break;
      throw e;
    }
  }
  return { source: "playerelo_global_ranking" as const, points, fetched_at: new Date().toISOString() };
}

async function upsertBatch(db: PoolClient, leagueUuid: string, leagueExternal: string, players: NormalizedPlayer[]) {
  // clubs first
  const clubKeys = new Map<string, string>();
  for (const p of players) {
    const key = p.club_external_id ?? (p.club_name ? nameKey(leagueExternal, p.club_name) : null);
    if (!key) continue;
    if (!clubKeys.has(key)) clubKeys.set(key, p.club_name ?? key);
  }
  const clubUuid = new Map<string, string>();
  for (const [key, name] of clubKeys) {
    const r = await db.query<{ id: string }>(
      `insert into public.source_clubs (provider, external_id, league_id, name, metadata_json, updated_at)
       values ($1,$2,$3,$4,$5, now())
       on conflict (provider, external_id) do update set league_id = excluded.league_id,
         name = coalesce(nullif(excluded.name, excluded.external_id), source_clubs.name), updated_at = now()
       returning id`,
      [PROVIDER, key, leagueUuid, name, JSON.stringify({ id_is_synthetic_name_key: key.startsWith("name:") })],
    );
    clubUuid.set(key, r.rows[0].id);
  }
  for (const p of players) {
    const key = p.club_external_id ?? (p.club_name ? nameKey(leagueExternal, p.club_name) : null);
    await db.query(
      `insert into public.source_players (provider, external_id, display_name, position_group, position_detail, birth_date,
          nationality, club_id, league_id, provider_elo, ear_180, ear_12m, ear_career, market_value_eur, games_played,
          total_minutes, attributes_json, data_quality_flags, source_updated_at, imported_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now(), now())
       on conflict (provider, external_id) do update set
          display_name = excluded.display_name,
          position_group = coalesce(excluded.position_group, source_players.position_group),
          position_detail = coalesce(excluded.position_detail, source_players.position_detail),
          birth_date = coalesce(excluded.birth_date, source_players.birth_date),
          nationality = coalesce(excluded.nationality, source_players.nationality),
          club_id = coalesce(excluded.club_id, source_players.club_id),
          league_id = coalesce(excluded.league_id, source_players.league_id),
          provider_elo = coalesce(excluded.provider_elo, source_players.provider_elo),
          ear_180 = coalesce(excluded.ear_180, source_players.ear_180),
          ear_12m = coalesce(excluded.ear_12m, source_players.ear_12m),
          ear_career = coalesce(excluded.ear_career, source_players.ear_career),
          market_value_eur = coalesce(excluded.market_value_eur, source_players.market_value_eur),
          games_played = coalesce(excluded.games_played, source_players.games_played),
          total_minutes = coalesce(excluded.total_minutes, source_players.total_minutes),
          attributes_json = source_players.attributes_json || excluded.attributes_json,
          data_quality_flags = excluded.data_quality_flags,
          source_updated_at = now(), imported_at = now()`,
      [PROVIDER, p.external_id, p.display_name, p.position_group, p.position_detail, p.birth_date, p.nationality,
        key ? clubUuid.get(key) : null, leagueUuid, p.elo, p.ear_180, p.ear_12m, p.ear_career,
        p.market_value_eur === null ? null : Math.round(p.market_value_eur), p.games_played, p.total_minutes,
        JSON.stringify(p.attributes), p.flags],
    );
  }
}

/** Create (or resume) an import run. Checkpoints after every page; already-done pages are skipped. */
export async function runImport(pool: Pool, client: PlayerEloClient, opts: ImportOptions & { runId?: string }) {
  const log = opts.log ?? (() => {});
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 100));
  const budget = opts.maxRequests ?? 400;
  let runId = opts.runId;
  if (!runId) {
    const r = await pool.query<{ id: string }>(
      `insert into public.import_runs (provider, selected_league_ids, options_json) values ($1,$2,$3) returning id`,
      [PROVIDER, opts.leagueIds, JSON.stringify({ pageSize, maxRequests: budget, retainRaw: !!opts.retainRaw })],
    );
    runId = r.rows[0].id;
  } else {
    await pool.query(`update public.import_runs set status = 'running' where id = $1`, [runId]);
  }
  const startUsed = client.requestsUsed;
  const errors: unknown[] = [];
  let pagesDone = 0;
  try {
    for (const leagueExt of opts.leagueIds) {
      const lg = await pool.query<{ id: string }>(
        `insert into public.source_leagues (provider, external_id, name, enabled) values ($1,$2,$3,true)
         on conflict (provider, external_id) do update set enabled = true returning id`,
        [PROVIDER, leagueExt, `League ${leagueExt}`],
      );
      const leagueUuid = lg.rows[0].id;
      const resource = `league_players:${leagueExt}`;
      const done = await pool.query<{ page_key: string; status: string; response_hash: string | null }>(
        `select page_key, status, response_hash from public.import_checkpoints where run_id = $1 and resource = $2`, [runId, resource]);
      const doneKeys = new Map(done.rows.map((r) => [r.page_key, r]));
      const seenHashes = new Set(done.rows.map((r) => r.response_hash).filter(Boolean) as string[]);
      const seenIds = new Set<string>();

      for (let offset = 0; ; offset += pageSize) {
        const pageKey = `offset:${offset}`;
        const prev = doneKeys.get(pageKey);
        if (prev?.status === "empty") break; // league exhausted in a previous attempt
        if (prev?.status === "done") continue;
        if (client.requestsUsed - startUsed >= budget) {
          log(`budget of ${budget} requests reached — stop (resume later with the same run id)`);
          await pool.query(`update public.import_runs set status = 'paused' where id = $1`, [runId]);
          return { runId, status: "paused" as const, requests: client.requestsUsed - startUsed, pagesDone };
        }
        const res = await client.leaguePlayers(leagueExt, { limit: pageSize, offset });
        const { rows, invalid, shape } = parseRows(res.data, PlayerRowSchema);
        const players = rows.map((r) => normalizePlayer(r, { endpoint: `/v1/leagues/${leagueExt}/players`, leagueExternalId: leagueExt }))
          .filter((x): x is NormalizedPlayer => x !== null);
        // pagination defence: an endpoint that ignores offset returns the same page forever
        const repeated = seenHashes.has(res.hash) || (players.length > 0 && players.every((p) => seenIds.has(p.external_id)));
        if (shape === "unknown") errors.push({ resource, pageKey, error: "unknown_response_shape" });
        if (invalid) errors.push({ resource, pageKey, invalid_rows: invalid });

        const db = await pool.connect();
        try {
          await db.query("begin");
          if (!repeated && players.length) await upsertBatch(db, leagueUuid, leagueExt, players);
          const status = players.length === 0 || repeated ? "empty" : "done";
          await db.query(
            `insert into public.import_checkpoints (run_id, resource, page_key, status, response_hash, rows_count)
             values ($1,$2,$3,$4,$5,$6) on conflict (run_id, resource, page_key) do update
             set status = excluded.status, response_hash = excluded.response_hash, rows_count = excluded.rows_count, updated_at = now()`,
            [runId, resource, pageKey, status, res.hash, players.length],
          );
          await db.query(
            `insert into public.import_raw_records (run_id, resource, page_key, payload_hash, payload) values ($1,$2,$3,$4,$5)`,
            [runId, resource, pageKey, res.hash, opts.retainRaw ? JSON.stringify(res.data) : null],
          );
          await db.query(`update public.import_runs set pages_done = pages_done + 1, requests_used = requests_used + 1 where id = $1`, [runId]);
          await db.query("commit");
        } catch (e) {
          await db.query("rollback");
          throw e;
        } finally {
          db.release();
        }
        pagesDone++;
        seenHashes.add(res.hash);
        players.forEach((p) => seenIds.add(p.external_id));
        log(`${resource} ${pageKey}: ${players.length} players${repeated ? " (repeated page → stop)" : ""}`);
        if (repeated) {
          if (offset > 0) errors.push({ resource, warning: "pagination_offset_possibly_unsupported" });
          break;
        }
        if (players.length < pageSize) {
          // last page; record terminal checkpoint so a resume does not re-fetch
          await pool.query(
            `insert into public.import_checkpoints (run_id, resource, page_key, status, rows_count)
             values ($1,$2,$3,'empty',0) on conflict do nothing`, [runId, resource, `offset:${offset + pageSize}`]);
          break;
        }
      }
    }
    await pool.query(
      `update public.import_runs set status = 'completed', completed_at = now(), errors_json = errors_json || $2::jsonb where id = $1`,
      [runId, JSON.stringify(errors)],
    );
    return { runId, status: "completed" as const, requests: client.requestsUsed - startUsed, pagesDone, errors };
  } catch (e) {
    const err = e instanceof PlayerEloError ? { status: e.status, path: e.path, message: e.message } : { message: (e as Error).message };
    await pool.query(
      `update public.import_runs set status = 'failed', errors_json = errors_json || $2::jsonb where id = $1`,
      [runId, JSON.stringify([...errors, err])],
    );
    throw e;
  }
}

/** Data quality report for the given provider leagues (no API calls). */
export async function auditLeagues(pool: Pool, provider: string, leagueExternalIds: string[]) {
  const q = await pool.query(
    `with l as (select id, external_id, name from public.source_leagues where provider = $1 and external_id = any($2))
     select l.external_id, l.name,
       count(p.*)::int as players,
       count(*) filter (where p.club_id is null)::int as without_club,
       count(*) filter (where p.position_group is null)::int as without_position,
       count(*) filter (where p.provider_elo is null)::int as without_elo,
       count(*) filter (where p.birth_date is null)::int as without_birth_date,
       count(*) filter (where p.market_value_eur is null)::int as without_value,
       count(*) filter (where p.total_minutes is null)::int as without_minutes,
       count(distinct p.club_id)::int as clubs,
       min(p.provider_elo) as elo_min, max(p.provider_elo) as elo_max,
       percentile_cont(0.5) within group (order by p.provider_elo) as elo_median
     from l left join public.source_players p on p.league_id = l.id
     group by l.external_id, l.name order by l.name`,
    [provider, leagueExternalIds],
  );
  const dups = await pool.query(
    `select p.display_name, c.name as club, count(*)::int as n from public.source_players p
       join public.source_leagues l on l.id = p.league_id left join public.source_clubs c on c.id = p.club_id
      where l.provider = $1 and l.external_id = any($2)
      group by p.display_name, c.name having count(*) > 1 limit 50`,
    [provider, leagueExternalIds],
  );
  const smallSquads = await pool.query(
    `select c.name, count(p.*)::int as players from public.source_clubs c
       join public.source_leagues l on l.id = c.league_id left join public.source_players p on p.club_id = c.id
      where l.provider = $1 and l.external_id = any($2) group by c.name having count(p.*) < 16 order by 2`,
    [provider, leagueExternalIds],
  );
  return { leagues: q.rows, possible_duplicates: dups.rows, small_squads: smallSquads.rows };
}
