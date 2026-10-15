import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { PlayerEloClient, PlayerEloError } from "../../src/integrations/playerelo/client";
import { auditLeagues, discoverLeagues, fetchAnchors, runImport } from "../../src/integrations/playerelo/importer";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { freshDb } from "../support/db";
import { startMockPlayerElo } from "../support/mock-playerelo";

const fastClient = (url: string, key = "test-key") =>
  new PlayerEloClient({ apiKey: key, baseUrl: url, ratePerMinute: 60000, sleep: async () => {}, maxRetries: 3 });

describe("PlayerElo import pipeline (mock API, FICTIONAL data)", () => {
  let pool: Pool;
  let mock: Awaited<ReturnType<typeof startMockPlayerElo>>;
  beforeAll(async () => {
    pool = freshDb("touchline_it_import");
    mock = await startMockPlayerElo({ apiKey: "test-key", leagues: { "7": { name: "Liga Sete", players: 430 }, "9": { name: "Liga Nove", players: 410 } }, fail429Times: 2 });
  });
  afterAll(async () => {
    await mock.close();
    await pool.end();
  });

  it("rejects bad keys without retrying", async () => {
    await expect(fastClient(mock.url, "wrong").leagues()).rejects.toBeInstanceOf(PlayerEloError);
  });

  it("discovers leagues (retrying through 429s)", async () => {
    const d = await discoverLeagues(pool, fastClient(mock.url));
    expect(d.leagues.map((l) => l.external_id).sort()).toEqual(["7", "9"]);
  });

  it("imports selected leagues with pagination, idempotently", async () => {
    const client = fastClient(mock.url);
    const r1 = await runImport(pool, client, { leagueIds: ["7"], pageSize: 100 });
    expect(r1.status).toBe("completed");
    const count1 = (await pool.query(`select count(*)::int n from source_players`)).rows[0].n;
    expect(count1).toBe(430);
    // re-run: no duplicates
    await runImport(pool, fastClient(mock.url), { leagueIds: ["7"], pageSize: 100 });
    expect((await pool.query(`select count(*)::int n from source_players`)).rows[0].n).toBe(430);
    expect((await pool.query(`select count(*)::int n from source_clubs`)).rows[0].n).toBe(18);
    const raw = await pool.query(`select count(*)::int n, count(payload)::int kept from import_raw_records`);
    expect(raw.rows[0].kept).toBe(0); // raw payload not retained by default
  });

  it("pauses on budget and resumes without re-fetching done pages", async () => {
    const client = fastClient(mock.url);
    const r = await runImport(pool, client, { leagueIds: ["9"], pageSize: 100, maxRequests: 2 });
    expect(r.status).toBe("paused");
    const before = mock.calls();
    const resumed = await runImport(pool, fastClient(mock.url), { runId: r.runId, leagueIds: ["9"], pageSize: 100 });
    expect(resumed.status).toBe("completed");
    expect(mock.calls() - before).toBe(3); // offsets 200, 300, 400 only
    const n = (await pool.query(`select count(*)::int n from source_players p join source_leagues l on l.id = p.league_id where l.external_id = '9'`)).rows[0].n;
    expect(n).toBe(410);
  });

  it("stops safely when the API ignores offset", async () => {
    const bad = await startMockPlayerElo({ apiKey: "k", leagues: { "5": { name: "Liga Cinco", players: 300 } }, ignoreOffset: true, wrapLists: true });
    try {
      const r = await runImport(pool, fastClient(bad.url, "k"), { leagueIds: ["5"], pageSize: 100 });
      expect(r.status).toBe("completed");
      expect(r.errors).toEqual(expect.arrayContaining([expect.objectContaining({ warning: "pagination_offset_possibly_unsupported" })]));
      expect(bad.calls()).toBe(2);
    } finally {
      await bad.close();
    }
  });

  it("audits and freezes a reproducible snapshot", async () => {
    const audit = await auditLeagues(pool, "playerelo", ["7", "9"]);
    expect(audit.leagues).toHaveLength(2);
    expect(audit.leagues[0].without_birth_date).toBeGreaterThan(0); // documented API exposes no DOB
    const anchors = await fetchAnchors(fastClient(mock.url), [1, 10, 100, 1000, 10000]);
    const s1 = await buildSnapshot(pool, { provider: "playerelo", leagueExternalIds: ["7", "9"], label: "t1", anchors, minSquad: 16 });
    const s2 = await buildSnapshot(pool, { provider: "playerelo", leagueExternalIds: ["7", "9"], label: "t2", anchors, minSquad: 16 });
    expect(s1.report.reference).toBe("global_anchors");
    const q = `select sp.source_player_id, initial_ovr from dataset_snapshot_players sp where snapshot_id = $1 order by 1`;
    const a = (await pool.query(q, [s1.snapshotId])).rows.map((r) => r.initial_ovr);
    const b = (await pool.query(q, [s2.snapshotId])).rows.map((r) => r.initial_ovr);
    expect(a).toEqual(b); // same data + version => same OVRs (potential may differ only by snapshot-seeded noise)
    const ages = await pool.query(`select count(*)::int n from dataset_snapshot_players where snapshot_id = $1 and age_at_import is not null`, [s1.snapshotId]);
    expect(ages.rows[0].n).toBe(0); // never invents ages for real players
  });
});
