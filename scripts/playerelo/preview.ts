/**
 * Dry run: estimate requests and quota for importing the selected leagues. No catalog writes.
 *   npm run playerelo:preview -- --leagues 94,39 [--probe]
 * --probe fetches the first page of each league (1 request each) to learn the real page size/shape.
 */
import { getUsage } from "../../src/integrations/playerelo/importer";
import { parseRows, PlayerRowSchema } from "../../src/integrations/playerelo/schemas";
import { flag, list, playerEloClient } from "../lib/cli";

async function main() {
  const leagues = list("leagues");
  if (!leagues.length) throw new Error("--leagues id1,id2 is required (ids from playerelo:discover)");
  const client = playerEloClient();
  const usage = await getUsage(client);
  let estimate = 0;
  for (const id of leagues) {
    if (flag("probe")) {
      const res = await client.leaguePlayers(id, { limit: 100, offset: 0 });
      const { rows, shape } = parseRows(res.data, PlayerRowSchema);
      const keys = rows[0] ? Object.keys(rows[0]) : [];
      console.log(`league ${id}: first page ${rows.length} rows (shape ${shape}); fields: ${keys.join(", ")}`);
      estimate += rows.length < 100 ? 0 : 7; // first page already spent
    } else estimate += 8; // ~700 players / 100 per page + terminal page
  }
  console.log({
    leagues,
    estimated_requests: estimate,
    usage_remaining: usage.remaining,
    note: "Estimate assumes ≤700 players per league; per-player enrichment (value/style) is NOT included and would cost 1 request per player.",
    fits_quota: usage.remaining === null ? "unknown (usage shape not recognised)" : usage.remaining >= estimate,
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
