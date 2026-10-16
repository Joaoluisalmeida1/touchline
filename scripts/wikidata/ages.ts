/**
 * Real birth dates from Wikidata (CC0) for players whose provider gave none.  Runs on your computer:
 *   npm run wikidata:ages -- --leagues <league uuid,…|all> [--apply] [--since 2023] [--limit-clubs 5]
 * Dry run by default (prints what would change). With --apply it fills, only where still null:
 *   source_players.birth_date → dataset_snapshot_players (birth_date, age_at_import) → game_players (birth_date, age, age_known).
 * Unmatched / ambiguous players keep an unknown age. Provenance goes into source_players.attributes_json.birth_date.
 */
import { WikidataClient } from "../../src/integrations/wikidata/client";
import { matchSquad } from "../../src/integrations/wikidata/match";
import { arg, dbPool, flag, list, printTable } from "../lib/cli";

const ageAt = (dob: string, at: Date) => {
  const b = new Date(`${dob}T00:00:00Z`);
  let a = at.getUTCFullYear() - b.getUTCFullYear();
  const m = at.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < b.getUTCDate())) a--;
  return a >= 14 && a <= 50 ? a : null;
};

async function main() {
  const pool = dbPool();
  const apply = flag("apply");
  const since = Number(arg("since") ?? new Date().getUTCFullYear() - 3);
  const leagues = list("leagues");
  const limit = Number(arg("limit-clubs") ?? 1e9);
  const wd = new WikidataClient();
  try {
    const clubs = (await pool.query<{ id: string; name: string; n: number }>(
      `select c.id, c.name, count(p.id)::int n from source_clubs c join source_players p on p.club_id = c.id and p.birth_date is null
        where c.provider <> 'synthetic' and ($1::uuid[] is null or c.league_id = any($1)) group by c.id, c.name order by c.name limit $2`,
      [leagues.length && leagues[0] !== "all" ? leagues : null, limit])).rows;
    console.log(`${clubs.length} clubs with players missing a birth date${apply ? "" : " (dry run — add --apply to write)"}`);
    const summary: Record<string, unknown>[] = [];
    let total = 0;
    for (const club of clubs) {
      const qid = await wd.findClub(club.name);
      if (!qid) { summary.push({ club: club.name, wikidata: "—", missing: club.n, matched: 0 }); continue; }
      const squad = await wd.squad(qid, since);
      const players = (await pool.query<{ id: string; name: string }>(
        `select id, display_name name from source_players where club_id = $1 and birth_date is null order by display_name`, [club.id])).rows;
      const res = matchSquad(players, squad, new Date());
      const hits = res.filter((r) => r.status === "matched");
      total += hits.length;
      summary.push({ club: club.name, wikidata: qid, squad: squad.length, missing: club.n, matched: hits.length,
        ambiguous: res.filter((r) => r.status === "ambiguous").length, bad_date: res.filter((r) => r.status === "bad_date").length });
      if (!apply || !hits.length) continue;
      const c = await pool.connect();
      try {
        await c.query("begin");
        for (const h of hits) {
          if (h.status !== "matched") continue;
          const prov = JSON.stringify({ source: "wikidata", qid: h.qid, matched_by: h.by, licence: "CC0", at: new Date().toISOString().slice(0, 10) });
          const u = await c.query(
            `update source_players set birth_date = $2, attributes_json = jsonb_set(attributes_json, '{birth_date}', $3::jsonb, true)
              where id = $1 and birth_date is null`, [h.id, h.birth_date, prov]);
          if (!u.rowCount) continue;
          await c.query(
            `update dataset_snapshot_players dsp set birth_date = $2,
                    age_at_import = coalesce(dsp.age_at_import, (select a from (select extract(year from age(ds.created_at::date, $2::date))::int a) x where a between 14 and 50))
               from dataset_snapshots ds where ds.id = dsp.snapshot_id and dsp.source_player_id = $1 and dsp.birth_date is null`, [h.id, h.birth_date]);
          const age = ageAt(h.birth_date, new Date());
          await c.query(
            `update game_players set birth_date = $2, age = $3, age_known = $3 is not null, version = version + 1, updated_at = now()
              where source_player_id = $1 and birth_date is null and age is null`, [h.id, h.birth_date, age]);
        }
        await c.query("commit");
      } catch (e) {
        await c.query("rollback");
        throw e;
      } finally {
        c.release();
      }
    }
    printTable(summary);
    console.log(`${total} birth dates ${apply ? "written" : "would be written"}. Unmatched players keep an unknown age.`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
