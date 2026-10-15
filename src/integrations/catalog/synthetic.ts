/**
 * SYNTHETIC (FICTIONAL) development dataset. Every name is generated from syllables; no real person,
 * club or league is represented. Rows are stored under provider 'synthetic' and snapshots are flagged
 * is_synthetic = true so the UI shows a "DADOS FICTÍCIOS" badge.
 */
import type { Pool } from "pg";
import { createRng } from "../../engine/common/rng";
import type { PositionGroup } from "../../engine/common/types";
import type { EloAnchors } from "../../engine/rating/initial-rating";

const SYL_A = ["Ba", "Cor", "Du", "Fa", "Gal", "Ira", "Jo", "Ka", "Lu", "Ma", "No", "Pe", "Ri", "Sa", "Ta", "Vi", "Ze", "Al", "Bre", "Ca"];
const SYL_B = ["ran", "vel", "mos", "tin", "ques", "lho", "dor", "res", "nes", "ral", "teo", "vio", "zar", "lim", "rio"];
const FIRST = ["Ari", "Beto", "Caio", "Davi", "Edu", "Fabi", "Gil", "Hugo", "Ivo", "Jair", "Kiko", "Leo", "Miro", "Nuno", "Otto", "Paulo", "Rui", "Saulo", "Tito", "Vasco", "Wil", "Xico", "Yuri", "Zeca"];
const TOWNS = ["Vale Azul", "Porto Sereno", "Monte Claro", "Ribeira Alta", "Campo Verde", "Serra Fria", "Lagoa Nova", "Pedra Branca",
  "Vila Dourada", "Foz Antiga", "Rio Manso", "Alto Vento", "Praia Funda", "Quinta Real", "Torre Velha", "Bela Vista", "Ponte Seca", "Mar Largo",
  "Cova Larga", "Santa Brisa"];
const SUFFIX = ["FC", "Atlético", "Sporting", "United", "Desportivo", "Académico"];
const COLORS = ["#1d4ed8", "#b91c1c", "#047857", "#7c3aed", "#c2410c", "#0f766e", "#be185d", "#4d7c0f", "#1e3a8a", "#a16207"];

export const SYNTHETIC_ANCHORS: EloAnchors = {
  source: "playerelo_global_ranking", // same shape; values are FICTIONAL
  fetched_at: "2026-01-01T00:00:00Z",
  points: [1, 10, 100, 1000, 5000, 20000, 50000].map((rank) => ({ rank, elo: Math.round(2600 - 140 * Math.log(rank)) })),
};

export async function seedSyntheticLeague(pool: Pool, opts: { externalId: string; name: string; clubs: number; seed?: string; strength?: [number, number] }) {
  const rng = createRng(opts.seed ?? opts.externalId);
  const [lo, hi] = opts.strength ?? [1350, 1700];
  const db = await pool.connect();
  try {
    await db.query("begin");
    const lg = await db.query<{ id: string }>(
      `insert into public.source_leagues (provider, external_id, name, country, enabled, metadata_json)
       values ('synthetic', $1, $2, 'Ficção', true, '{"fictional": true}')
       on conflict (provider, external_id) do update set name = excluded.name returning id`,
      [opts.externalId, opts.name],
    );
    const leagueId = lg.rows[0].id;
    const groups: PositionGroup[] = ["GK", "GK", "GK", "DEF", "DEF", "DEF", "DEF", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "MID", "MID", "MID", "MID", "ATT", "ATT", "ATT", "ATT", "ATT"];
    for (let c = 0; c < opts.clubs; c++) {
      const town = TOWNS[(c + opts.externalId.length) % TOWNS.length];
      const name = `${town} ${SUFFIX[c % SUFFIX.length]}`;
      const clubExt = `${opts.externalId}-c${c}`;
      const cl = await db.query<{ id: string }>(
        `insert into public.source_clubs (provider, external_id, league_id, name, short_name, metadata_json)
         values ('synthetic', $1, $2, $3, $4, $5)
         on conflict (provider, external_id) do update set name = excluded.name returning id`,
        [clubExt, leagueId, name, town.split(" ").map((w) => w[0]).join("").padEnd(3, town[1].toUpperCase()).slice(0, 3).toUpperCase(),
          JSON.stringify({ fictional: true, primary_color: COLORS[c % COLORS.length] })],
      );
      const mean = hi - ((hi - lo) * c) / Math.max(1, opts.clubs - 1);
      for (let i = 0; i < groups.length; i++) {
        const age = rng.int(17, 35);
        const year = 2026 - age;
        const birth = `${year}-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`;
        const starter = i % 8 !== 0 && i < 18;
        const elo = Math.round(rng.normal(mean + (starter ? 40 : -60) - Math.max(0, age - 30) * 10 - Math.max(0, 21 - age) * 25, 70));
        const minutes = starter ? rng.int(1200, 3200) : rng.int(0, 1200);
        const pname = `${FIRST[rng.int(0, FIRST.length - 1)]} ${SYL_A[rng.int(0, SYL_A.length - 1)]}${SYL_B[rng.int(0, SYL_B.length - 1)]}`;
        await db.query(
          `insert into public.source_players (provider, external_id, display_name, position_group, position_detail, birth_date, nationality,
              club_id, league_id, provider_elo, ear_180, games_played, total_minutes, market_value_eur, attributes_json, data_quality_flags)
           values ('synthetic', $1, $2, $3, null, $4, 'Ficção', $5, $6, $7, $8, $9, $10, null, '{"fictional": true}', '{synthetic}')
           on conflict (provider, external_id) do update set provider_elo = excluded.provider_elo, club_id = excluded.club_id`,
          [`${clubExt}-p${i}`, pname, groups[i], birth, cl.rows[0].id, leagueId, elo, Math.round(rng.normal(0, 3) * 10) / 10,
            Math.round(minutes / 80), minutes],
        );
      }
    }
    await db.query("commit");
    return leagueId;
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
  }
}
