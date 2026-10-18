/** New leagues take club colours from the catalog (scripts/wikidata/colours.ts) and never trust malformed values. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { seedSyntheticLeague, SYNTHETIC_ANCHORS } from "../../src/integrations/catalog/synthetic";
import { createGame } from "../../src/server/services/create-game";
import { createUser, freshDb } from "../support/db";

let pool: Pool;
let leagueId: string, snapshotId: string, owner: string;
let clubs: { id: string; name: string }[];

beforeAll(async () => {
  pool = freshDb("touchline_it_colours");
  leagueId = await seedSyntheticLeague(pool, { externalId: "it-colours", name: "Liga Cores (fictícia)", clubs: 4 });
  clubs = (await pool.query(`select id, name from source_clubs where league_id = $1 order by name`, [leagueId])).rows;
  const set = (id: string, meta: object) => pool.query(`update source_clubs set metadata_json = metadata_json || $2::jsonb where id = $1`, [id, JSON.stringify(meta)]);
  await set(clubs[0].id, { primary_color: "#c8102e", secondary_color: "#ffffff", colors_source: { provider: "wikidata", qid: "Q1" } });
  await set(clubs[1].id, { primary_color: "url(javascript:alert(1))", secondary_color: "red" });
  snapshotId = (await buildSnapshot(pool, { provider: "synthetic", leagueExternalIds: ["it-colours"], label: "IT colours", anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01") })).snapshotId;
  owner = await createUser(pool, "colours@test.dev", "Cor");
});
afterAll(async () => pool.end());

describe("club colours in new leagues", () => {
  it("copies catalog colours into the league and falls back safely on malformed ones", async () => {
    const { gameId } = await createGame(pool, owner, { name: "Liga das Cores", snapshotId, leagueId, maxManagers: 4, tickMode: "manual", timezone: "Europe/Lisbon", deadlineHour: 20, roundIntervalHours: 24 });
    const colours = new Map((await pool.query<{ source_club_id: string; primary_color: string; secondary_color: string }>(
      `select source_club_id, primary_color, secondary_color from game_clubs where game_id = $1`, [gameId])).rows.map((r) => [r.source_club_id, r]));
    expect(colours.get(clubs[0].id)).toMatchObject({ primary_color: "#c8102e", secondary_color: "#ffffff" });
    const bad = colours.get(clubs[1].id)!;
    expect(bad.primary_color).toMatch(/^#[0-9a-f]{6}$/); // palette fallback, never the injected value
    expect(bad.secondary_color).toBe("#f8fafc");
  });
});
