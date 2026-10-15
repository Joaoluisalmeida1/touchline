/**
 * Selective import. Checkpoints every page; safe to re-run (upserts by provider + external_id).
 *   npm run playerelo:import -- --leagues 94,39 [--max-requests 200] [--page-size 100] [--retain-raw] [--dry-run]
 */
import { getUsage, runImport } from "../../src/integrations/playerelo/importer";
import { arg, dbPool, flag, list, playerEloClient } from "../lib/cli";

async function main() {
  const leagueIds = list("leagues");
  if (!leagueIds.length) throw new Error("--leagues id1,id2 is required");
  if (flag("dry-run")) {
    console.log("Dry run — use `npm run playerelo:preview -- --leagues ...` for estimates. Nothing written.");
    return;
  }
  const retainRaw = flag("retain-raw");
  if (retainRaw && process.env.PLAYERELO_RETAIN_RAW !== "true") {
    throw new Error("--retain-raw requires PLAYERELO_RETAIN_RAW=true after confirming the licence allows retention (docs/data-licensing.md)");
  }
  const client = playerEloClient();
  const pool = dbPool();
  try {
    console.log("Usage before:", (await getUsage(client)).raw);
    const res = await runImport(pool, client, {
      leagueIds, retainRaw, pageSize: Number(arg("page-size") ?? 100), maxRequests: Number(arg("max-requests") ?? 400), log: console.log,
    });
    console.log("Result:", res);
    console.log("Usage after:", (await getUsage(client)).raw);
    console.log(`Next: npm run playerelo:audit -- --leagues ${leagueIds.join(",")}`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
