/**
 * Discover leagues available to your PlayerElo key and store them in source_leagues.
 *   npm run playerelo:discover            # 1 request (+ free /v1/usage)
 *   npm run playerelo:discover -- --anchors   # + ~11 requests: global rank anchors for the OVR scale
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { discoverLeagues, fetchAnchors, getUsage } from "../../src/integrations/playerelo/importer";
import { dbPool, flag, playerEloClient, printTable } from "../lib/cli";

async function main() {
  const client = playerEloClient();
  const pool = dbPool();
  try {
    const usage = await getUsage(client);
    console.log("Usage before:", usage.raw);
    const d = await discoverLeagues(pool, client);
    console.log(`Response shape: ${d.shape}; leagues parsed: ${d.leagues.length}; invalid rows: ${d.invalid}`);
    console.log("Sample raw rows (verify field names!):", JSON.stringify(d.sample, null, 2).slice(0, 1500));
    printTable(d.leagues.map((l) => ({ id: l.external_id, name: l.name, country: l.country, strength: l.strength })));
    if (flag("anchors")) {
      const anchors = await fetchAnchors(client);
      mkdirSync("data", { recursive: true });
      writeFileSync("data/playerelo-anchors.json", JSON.stringify(anchors, null, 2));
      console.log("Saved data/playerelo-anchors.json", anchors.points);
    }
    console.log(`Billable requests this session: ${client.requestsUsed}`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
