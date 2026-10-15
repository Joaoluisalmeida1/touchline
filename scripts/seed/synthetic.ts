/**
 * Seed FICTIONAL development data (no API key needed) and freeze a synthetic snapshot.
 *   npm run seed:synthetic
 */
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { seedSyntheticLeague, SYNTHETIC_ANCHORS } from "../../src/integrations/catalog/synthetic";
import { dbPool } from "../lib/cli";

async function main() {
  const pool = dbPool();
  try {
    await seedSyntheticLeague(pool, { externalId: "liga-atlantica", name: "Liga Atlântica (fictícia)", clubs: 18 });
    await seedSyntheticLeague(pool, { externalId: "taca-norte", name: "Divisão Norte (fictícia)", clubs: 8, strength: [1250, 1450] });
    const r = await buildSnapshot(pool, {
      provider: "synthetic", leagueExternalIds: ["liga-atlantica", "taca-norte"],
      label: "DEV — Dados fictícios", anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01T00:00:00Z"),
    });
    console.log(`Synthetic snapshot ${r.snapshotId}`, r.report.clubs_in_snapshot, "clubs,", r.report.players_in_snapshot, "players");
    console.log("OVR histogram:", r.report.ovr_histogram);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
