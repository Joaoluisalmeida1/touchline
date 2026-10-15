/**
 * Freeze a dataset snapshot (initial-rating-v1) from imported leagues.
 *   npm run playerelo:finalize -- --leagues 94,39 --label "Época 26/27 — PT+EN" [--anchors data/playerelo-anchors.json]
 */
import { existsSync, readFileSync } from "node:fs";
import { buildSnapshot } from "../../src/integrations/catalog/snapshot";
import { arg, dbPool, list } from "../lib/cli";

async function main() {
  const leagues = list("leagues");
  const label = arg("label");
  if (!leagues.length || !label) throw new Error("--leagues and --label are required");
  const anchorsPath = arg("anchors") ?? "data/playerelo-anchors.json";
  const anchors = existsSync(anchorsPath) ? JSON.parse(readFileSync(anchorsPath, "utf8")) : null;
  if (!anchors) console.warn("No anchors file — OVR scale will be relative to the imported sample (flagged in the report).");
  const pool = dbPool();
  try {
    const r = await buildSnapshot(pool, { provider: arg("provider") ?? "playerelo", leagueExternalIds: leagues, label, anchors });
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
