/**
 * Real club colours (Wikidata, CC0; Wikipedia infobox kit as fallback). Runs on your computer, never at request time:
 *   npm run wikidata:colours -- --leagues <league uuid|external id,…|all> [--apply] [--update-games]
 *                               [--league-qid <league>=Q…,…] [--club-qid <club uuid>=Q…,…] [--refresh] [--force]
 *
 * Per league: resolve the league item (country must match) → clubs with a "league" (P118) statement for it → match
 * dataset club names inside that list only → colours, in this order of trust:
 *   1. Wikidata "official color" (P6364) in item order (pure web colours mapped to kit shades),
 *   2. the home kit in the club's English Wikipedia infobox (body/shorts/socks),
 *   3. reserve/youth teams ("Benfica B") inherit their parent club's colours.
 * All HTTP goes through the official APIs, one request at a time ≥1.1 s apart with an identifying User-Agent, cached for
 * 7 days in data/wikidata-cache (gitignored). Roughly 4 requests per league + 1 per club that needs the fallback.
 *
 * Dry run by default. --apply writes source_clubs.metadata_json (primary_color, secondary_color, colors, colors_source)
 * in one transaction — new leagues use them. --update-games also recolours existing leagues (game_clubs). Colours with
 * colors_source.provider = "manual" are never overwritten unless --force. Unmatched clubs keep their current colours.
 */
import path from "node:path";
import { WikidataClient } from "../../src/integrations/wikidata/client";
import {
  clubKey, coloursFromKit, matchClubs, parentName, parseInfoboxKit, pickColours, toHex, type ClubMatch,
} from "../../src/integrations/wikidata/colours";
import { dbPool, flag, list, printTable } from "../lib/cli";

type Source = "wikidata" | "wikipedia_infobox" | "parent_club";
interface Result {
  clubId: string; league: string; name: string; meta: Record<string, unknown>; match: ClubMatch; wdLabel: string;
  colours: { primary: string; secondary: string; all: string[] } | null; source: Source | null; note: string;
}

const pairs = (name: string) => new Map(list(name).map((p) => p.split("=").map((s) => s.trim()) as [string, string]).filter(([k, v]) => k && /^Q\d+$/.test(v ?? "")));

async function main() {
  const apply = flag("apply"), updateGames = flag("update-games"), force = flag("force");
  if (updateGames && !apply) throw new Error("--update-games needs --apply");
  const leagueRefs = list("leagues");
  if (!leagueRefs.length) throw new Error("--leagues <uuid|external id,…|all> is required");
  const leagueQidOverride = pairs("league-qid"), clubQidOverride = pairs("club-qid");
  const wd = new WikidataClient(
    `TouchlineClubColours/1.0 (${process.env.WIKIDATA_CONTACT ?? "https://github.com/Joaoluisalmeida1/touchline"}; private football game)`,
    1100,
    { dir: path.resolve("data/wikidata-cache"), ttlMs: flag("refresh") ? 0 : 7 * 24 * 3600_000 },
  );
  const pool = dbPool();
  const fetchedAt = new Date().toISOString().slice(0, 10);
  const results: Result[] = [];
  const skippedLeagues: string[] = [];
  try {
    const all = leagueRefs[0] === "all";
    const leagues = (await pool.query<{ id: string; external_id: string; name: string; country: string | null }>(
      `select id, external_id, name, country from source_leagues
        where provider <> 'synthetic' and ($1 or id::text = any($2) or external_id = any($2)) order by name`, [all, leagueRefs])).rows;
    console.log(`${leagues.length} league(s)${apply ? "" : " — dry run, add --apply to write"}`);

    // ---- A. per league: match + Wikidata colours, Wikipedia kit as fallback ----
    for (const lg of leagues) {
      const override = leagueQidOverride.get(lg.id) ?? leagueQidOverride.get(lg.external_id);
      const found = override ? { qid: override, candidates: [] } : await wd.findLeague(lg.name, lg.country);
      if (!found.qid) {
        skippedLeagues.push(lg.name);
        console.log(`\n✗ ${lg.name} (${lg.country ?? "?"}): no unambiguous Wikidata league in that country — pass --league-qid ${lg.external_id}=Q…`);
        printTable(found.candidates.map((c) => ({ qid: c.qid, label: c.label, country: c.country })));
        continue;
      }
      const clubs = (await pool.query<{ id: string; name: string; meta: Record<string, unknown> }>(
        `select id, name, metadata_json meta from source_clubs where league_id = $1 order by name`, [lg.id])).rows;
      const candidates = await wd.leagueClubs(found.qid);
      const label = new Map(candidates.map((c) => [c.qid, c.label]));
      const matches = matchClubs(clubs, candidates).map((m): ClubMatch => {
        const q = clubQidOverride.get(m.id);
        return q ? { id: m.id, status: "matched", qid: q, by: "exact" } : m;
      });
      // clubs missing from the member list (no P118 for this league on Wikidata): name search within the league's country
      if (matches.some((m) => m.status === "no_match")) {
        const countries = await wd.countriesOf(found.qid);
        for (let i = 0; i < matches.length; i++) {
          if (matches[i].status !== "no_match") continue;
          const q = await wd.findClubInCountry(clubs[i].name, countries);
          if (q && !matches.some((m) => m.status === "matched" && m.qid === q)) matches[i] = { id: clubs[i].id, status: "matched", qid: q, by: "search" };
        }
      }
      const qids = matches.flatMap((m) => (m.status === "matched" ? [m.qid] : []));
      const { statements, hex, names, enwiki } = await wd.clubColours(qids);
      const hexes = new Map([...hex].flatMap(([q, h]) => { const x = toHex(h); return x ? [[q, x] as const] : []; }));
      console.log(`${lg.name} → ${found.qid}: ${candidates.length} clubs on Wikidata, ${qids.length}/${clubs.length} matched`);
      for (const club of clubs) {
        const match = matches.find((x) => x.id === club.id)!;
        const r: Result = { clubId: club.id, league: lg.name, name: club.name, meta: club.meta ?? {}, match, wdLabel: "", colours: null, source: null, note: "" };
        if (match.status === "matched") {
          r.wdLabel = label.get(match.qid) ?? "";
          r.colours = pickColours(statements.get(match.qid) ?? [], hexes);
          r.note = (statements.get(match.qid) ?? []).map((s) => names.get(s.qid) ?? s.qid).join(", ");
          if (r.colours) r.source = "wikidata";
          else if (enwiki.has(match.qid)) {
            const kit = parseInfoboxKit(await wd.wikipediaLead(enwiki.get(match.qid)!));
            r.colours = kit ? coloursFromKit(kit) : null;
            if (r.colours) { r.source = "wikipedia_infobox"; r.note = `kit ${[kit!.body, kit!.shorts, kit!.socks].filter(Boolean).join("/")}`; }
          }
        }
        results.push(r);
      }
    }

    // ---- B. reserve/youth teams inherit the parent club's colours (Wikidata rarely has them) ----
    const byKey = new Map(results.filter((r) => r.colours).map((r) => [clubKey(r.name), r]));
    for (const r of results) {
      const parent = !r.colours && parentName(r.name) ? byKey.get(clubKey(parentName(r.name)!)) : undefined;
      if (parent?.colours) { r.colours = parent.colours; r.source = "parent_club"; r.note = `from ${parent.name}`; }
    }

    // ---- C. report + write ----
    const plan = results.filter((r) => r.colours && (force || (r.meta.colors_source as { provider?: string } | undefined)?.provider !== "manual"));
    for (const lg of [...new Set(results.map((r) => r.league))]) {
      console.log(`\n${lg}`);
      printTable(results.filter((r) => r.league === lg).map((r) => ({
        club: r.name,
        match: r.match.status === "matched" ? `${r.match.qid} ${r.wdLabel}`.trim() : r.match.status === "ambiguous" ? `ambiguous: ${r.match.candidates.slice(0, 3).join(" ")}` : "no match",
        source: r.source ?? (r.match.status === "matched" ? "no colours" : "—"),
        primary: r.colours?.primary ?? "", secondary: r.colours?.secondary ?? "", detail: r.note,
      })));
    }
    const count = (s: Source) => plan.filter((r) => r.source === s).length;
    const totals = {
      clubs: results.length, matched: results.filter((r) => r.match.status === "matched").length, coloured: plan.length,
      wikidata: count("wikidata"), wikipedia_infobox: count("wikipedia_infobox"), parent_club: count("parent_club"),
      kept_manual: results.filter((r) => r.colours && !plan.includes(r)).length, written: 0, games_recoloured: 0,
    };
    if (apply && plan.length) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        for (const r of plan) {
          const meta = {
            primary_color: r.colours!.primary, secondary_color: r.colours!.secondary, colors: r.colours!.all,
            colors_source: { provider: r.source, qid: r.match.status === "matched" ? r.match.qid : null,
              licence: r.source === "wikidata" ? "CC0" : "facts from CC BY-SA article", fetched_at: fetchedAt },
          };
          const u = await c.query(
            `update public.source_clubs set metadata_json = metadata_json || $2::jsonb, updated_at = now()
              where id = $1 and ($3 or coalesce(metadata_json #>> '{colors_source,provider}', '') <> 'manual')`,
            [r.clubId, JSON.stringify(meta), force]);
          totals.written += u.rowCount ?? 0;
          if (updateGames && u.rowCount) {
            const g = await c.query(`update public.game_clubs set primary_color = $2, secondary_color = $3 where source_club_id = $1`,
              [r.clubId, r.colours!.primary, r.colours!.secondary]);
            totals.games_recoloured += g.rowCount ?? 0;
          }
        }
        await c.query("commit");
      } catch (e) {
        await c.query("rollback");
        throw e;
      } finally {
        c.release();
      }
    }
    console.log(`\n${JSON.stringify(totals)} · HTTP requests: ${wd.requests} (cache hits: ${wd.cacheHits})`);
    if (skippedLeagues.length) console.log(`Skipped leagues (pass --league-qid): ${skippedLeagues.join(", ")}`);
    if (!apply) console.log("Dry run: nothing written. Review the tables, fix with --league-qid / --club-qid if needed, then --apply.");
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
