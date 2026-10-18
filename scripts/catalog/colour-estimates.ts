/**
 * Apply hand-estimated club colours (scripts/catalog/colour-estimates.json) to clubs that have no sourced colours:
 *   npx tsx scripts/catalog/colour-estimates.ts [--apply] [--update-games]
 * Dry run by default. Never overwrites colours from Wikidata/Wikipedia/parent club or "manual" ones; an existing
 * estimate is refreshed. Writes source_clubs.metadata_json (colors_source.provider = "estimate") in one transaction;
 * --update-games also recolours the clubs in existing leagues. Run the Wikidata tool first: it upgrades estimates.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PROTECTED_PROVIDERS, validateEstimates } from "../../src/integrations/catalog/colour-estimates";
import { dbPool, flag, printTable } from "../lib/cli";

async function main() {
  const apply = flag("apply"), updateGames = flag("update-games");
  if (updateGames && !apply) throw new Error("--update-games needs --apply");
  const estimates = validateEstimates(JSON.parse(readFileSync(path.resolve("scripts/catalog/colour-estimates.json"), "utf8")));
  const pool = dbPool();
  const today = new Date().toISOString().slice(0, 10);
  const rows: Record<string, unknown>[] = [];
  const plan: { id: string; primary: string; secondary: string; meta: object }[] = [];
  try {
    for (const e of estimates) {
      const found = (await pool.query<{ id: string; provider: string | null }>(
        `select c.id, c.metadata_json #>> '{colors_source,provider}' provider
           from source_clubs c join source_leagues l on l.id = c.league_id
          where l.provider <> 'synthetic' and l.external_id = $1 and c.name = $2`, [e.league, e.club])).rows;
      const status = found.length === 0 ? "club not found" : found.length > 1 ? "ambiguous name"
        : PROTECTED_PROVIDERS.has(found[0].provider ?? "") ? `kept (${found[0].provider})` : "set";
      rows.push({ league: e.league, club: e.club, primary: e.primary, secondary: e.secondary, confidence: e.confidence, status });
      if (status === "set") {
        plan.push({ id: found[0].id, primary: e.primary, secondary: e.secondary, meta: {
          primary_color: e.primary, secondary_color: e.secondary, colors: [e.primary, e.secondary],
          colors_source: { provider: "estimate", confidence: e.confidence, note: "no usable Wikidata/Wikipedia data; estimated", set_at: today },
        } });
      }
    }
    printTable(rows);
    let written = 0, games = 0;
    if (apply && plan.length) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        for (const p of plan) {
          // re-check under the transaction: never replace sourced or manual colours that appeared meanwhile
          const u = await c.query(
            `update public.source_clubs set metadata_json = metadata_json || $2::jsonb, updated_at = now()
              where id = $1 and coalesce(metadata_json #>> '{colors_source,provider}', '') not in ('wikidata','wikipedia_infobox','parent_club','manual')`,
            [p.id, JSON.stringify(p.meta)]);
          written += u.rowCount ?? 0;
          if (updateGames && u.rowCount) {
            games += (await c.query(`update public.game_clubs set primary_color = $2, secondary_color = $3 where source_club_id = $1`, [p.id, p.primary, p.secondary])).rowCount ?? 0;
          }
        }
        await c.query("commit");
      } catch (err) {
        await c.query("rollback");
        throw err;
      } finally {
        c.release();
      }
    }
    console.log(JSON.stringify({ estimates: estimates.length, to_set: plan.length, written, games_recoloured: games }));
    if (!apply) console.log("Dry run: nothing written. Add --apply (and --update-games for existing leagues).");
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
