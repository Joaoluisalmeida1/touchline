/** Data-quality report (no API calls):  npm run playerelo:audit -- --leagues 94,39 [--provider synthetic] */
import { auditLeagues } from "../../src/integrations/playerelo/importer";
import { arg, dbPool, list, printTable } from "../lib/cli";

async function main() {
  const pool = dbPool();
  try {
    const r = await auditLeagues(pool, arg("provider") ?? "playerelo", list("leagues"));
    printTable(r.leagues);
    console.log("Possible duplicates (same name + club):"); printTable(r.possible_duplicates);
    console.log("Clubs with fewer than 16 players (excluded from snapshots):"); printTable(r.small_squads);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
