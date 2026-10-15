/** Resume a paused/failed import run without duplicating pages:  npm run playerelo:resume -- --run <uuid> */
import { runImport } from "../../src/integrations/playerelo/importer";
import { arg, dbPool, playerEloClient } from "../lib/cli";

async function main() {
  const runId = arg("run");
  if (!runId) throw new Error("--run <import_run id> is required");
  const pool = dbPool();
  try {
    const r = await pool.query(`select selected_league_ids, options_json, status from public.import_runs where id = $1`, [runId]);
    if (!r.rowCount) throw new Error("run not found");
    if (r.rows[0].status === "completed") return console.log("Run already completed.");
    const o = r.rows[0].options_json;
    const res = await runImport(pool, playerEloClient(), {
      runId, leagueIds: r.rows[0].selected_league_ids, pageSize: o.pageSize, maxRequests: Number(arg("max-requests") ?? o.maxRequests), retainRaw: o.retainRaw, log: console.log,
    });
    console.log(res);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
