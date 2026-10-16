/**
 * Careers (career-v1): contract talks for players in their final year, the academy intake two thirds into the season,
 * releases at season end (Bosman → free agents) and the AI picking up unsigned free agents after round 3.
 * All service-side, idempotent (markers in game_events / unique keys).
 */
import type { Pool, PoolClient } from "pg";
import { academyIntake, academyIntakeRound, aiFreeAgentPicks, freeAgentWage, renewalDemand } from "../../engine/career/career";
import type { PositionGroup } from "../../engine/common/types";
import { traitOf } from "../../engine/narrative/traits";
import { asService } from "../pg";

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return asService(pool, async (c) => {
    await c.query("begin");
    try {
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  });
}
const marker = async (c: PoolClient, gameId: string, season: number, round: number, kind: string) => !!(await c.query(
  `insert into public.game_events (game_id, season, round, kind, key, payload) values ($1,$2,$3,$4,'x','{}'::jsonb)
   on conflict (game_id, season, round, kind, key) do nothing returning id`, [gameId, season, round, kind])).rowCount;

/** Contract talks for every player of a human club whose contract ends this season (idempotent). */
export async function ensureContractTalks(pool: Pool, gameId: string): Promise<void> {
  await asService(pool, async (c) => {
    const g = (await c.query<{ status: string; current_season: number }>(`select status, current_season from public.games where id = $1`, [gameId])).rows[0];
    if (!g || g.status !== "active") return;
    const rows = (await c.query<{ id: string; club_id: string; current_ovr: number; morale: number; age: number | null; reputation: number }>(
      `select p.id, p.club_id, p.current_ovr, p.morale, p.age, gc.reputation from public.game_players p join public.game_clubs gc on gc.id = p.club_id
        where p.game_id = $1 and gc.manager_user_id is not null and p.contract_end_season <= $2
          and not exists (select 1 from public.contract_talks t where t.player_id = p.id and t.season = $2)`, [gameId, g.current_season])).rows;
    for (const p of rows) {
      const d = renewalDemand({ ovr: p.current_ovr, morale: p.morale, age: p.age, trait: traitOf(p.id), reputation: p.reputation });
      await c.query(
        `insert into public.contract_talks (game_id, club_id, player_id, season, refuses, options) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
        [gameId, p.club_id, p.id, g.current_season, d.refuses, JSON.stringify(d.options)]);
    }
  });
}

/** After the intake round: 3–6 prospects per club; AI clubs promote their best one if the squad has room. */
export async function academyAfterRound(pool: Pool, gameId: string, season: number, round: number): Promise<boolean> {
  return tx(pool, async (c) => {
    const total = (await c.query<{ total_rounds: number }>(`select total_rounds from public.seasons where game_id = $1 and number = $2`, [gameId, season])).rows[0]?.total_rounds;
    if (!total || round !== academyIntakeRound(total)) return false;
    if (!(await marker(c, gameId, season, round, "academy_intake"))) return false;
    const maxSquad = Number((await c.query(`select coalesce((settings_json->>'max_squad')::int, 32) m from public.games where id = $1`, [gameId])).rows[0].m);
    const clubs = (await c.query<{ id: string; reputation: number; manager_user_id: string | null; size: number; youth: number | null }>(
      `select gc.id, gc.reputation, gc.manager_user_id, (select count(*)::int from public.game_players p where p.club_id = gc.id) size,
              (select level from public.club_staff s where s.club_id = gc.id and s.role = 'youth' and s.active) youth
         from public.game_clubs gc where gc.game_id = $1 order by gc.id`, [gameId])).rows;
    for (const club of clubs) {
      const prospects = academyIntake({ gameId, season, clubId: club.id, reputation: club.reputation, youthLevel: club.youth ?? 1 });
      const ids: string[] = [];
      for (const x of prospects) {
        const r = await c.query<{ id: string }>(
          `insert into public.academy_prospects (game_id, club_id, season, name, position_group, age, ovr, potential_cap, potential_band, dev_rate, wage_cents, value_cents)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict do nothing returning id`,
          [gameId, club.id, season, x.name, x.position_group, x.age, x.ovr, x.potential_cap, x.potential_band, x.dev_rate, x.wage_cents, x.value_cents]);
        if (r.rows[0]) ids.push(r.rows[0].id);
      }
      if (club.manager_user_id) {
        await c.query(`select public._notify($1, $2, 'academy_intake', $3)`, [club.manager_user_id, gameId, JSON.stringify({ count: ids.length })]);
      } else if (club.size + 1 <= maxSquad - 1) {
        const best = (await c.query<{ id: string }>(
          `select id from public.academy_prospects where club_id = $1 and season = $2 and status = 'academy' order by potential_cap desc, ovr desc, id limit 1`, [club.id, season])).rows[0];
        if (best) await promote(c, best.id, season);
      }
    }
    return true;
  });
}

async function promote(c: PoolClient, prospectId: string, season: number) {
  const r = await c.query<{ id: string }>(
    `insert into public.game_players (game_id, source_player_id, club_id, name_snapshot, position_group, position_detail,
       birth_date, age_known, age, initial_ovr, season_start_ovr, current_ovr, potential_cap, hidden_development_rate,
       profile_json, morale, fitness, sharpness, market_value_cents, wage_cents, contract_end_season)
     select x.game_id, null, x.club_id, x.name, x.position_group, null, null, true, x.age, x.ovr, x.ovr, x.ovr, x.potential_cap, x.dev_rate,
            jsonb_build_object('academy', true), 70, 100, 50, x.value_cents, x.wage_cents, $2::int + 3
       from public.academy_prospects x where x.id = $1 and x.status = 'academy' returning id`, [prospectId, season]);
  if (r.rows[0]) await c.query(`update public.academy_prospects set status = 'promoted', player_id = $2, decided_at = now() where id = $1`, [prospectId, r.rows[0].id]);
}

/**
 * Before end_season: human clubs lose players whose contract ends now and were not renewed (they become free agents
 * for the next season), never going below the minimum squad; AI academies release unpromoted prospects.
 */
export async function seasonEndCareer(pool: Pool, gameId: string, season: number): Promise<{ released: number }> {
  return tx(pool, async (c) => {
    if (!(await marker(c, gameId, season, 999, "career_season_end"))) return { released: 0 };
    const minSquad = Number((await c.query(`select coalesce((settings_json->>'min_squad')::int, 16) m from public.games where id = $1`, [gameId])).rows[0].m);
    const humans = (await c.query<{ id: string; manager_user_id: string; size: number }>(
      `select gc.id, gc.manager_user_id, (select count(*)::int from public.game_players p where p.club_id = gc.id) size
         from public.game_clubs gc where gc.game_id = $1 and gc.manager_user_id is not null`, [gameId])).rows;
    let released = 0;
    for (const club of humans) {
      const leaving = (await c.query<{ id: string; name_snapshot: string; current_ovr: number; wage_cents: string }>(
        `select p.id, p.name_snapshot, p.current_ovr, p.wage_cents from public.game_players p
          where p.club_id = $1 and p.contract_end_season <= $2
            and not exists (select 1 from public.contract_talks t where t.player_id = p.id and t.season = $2 and t.status = 'renewed')
          order by p.current_ovr desc, p.id`, [club.id, season])).rows;
      const allowed = Math.max(0, club.size - minSquad);
      const go = leaving.slice(0, allowed);
      for (const p of go) {
        await c.query(
          `update public.game_players set club_id = null, free_agent_since = $2, free_agent_wage_cents = $3,
                  age = case when age is not null then age + 1 else null end, form = 0, fitness = 100, season_stats_json = '{}'::jsonb,
                  version = version + 1, updated_at = now()
            where id = $1`, [p.id, season + 1, freeAgentWage(p.current_ovr)]);
        await c.query(`update public.contract_talks set status = 'left', decided_at = now() where player_id = $1 and season = $2`, [p.id, season]);
        await c.query(`update public.transfer_listings set status = 'withdrawn' where player_id = $1 and status = 'active'`, [p.id]);
        await c.query(`update public.lineups l set
            starters_json = coalesce((select jsonb_agg(e) from jsonb_array_elements(l.starters_json) e where (e->>'player_id')::uuid <> $1), '[]'::jsonb),
            bench_json = coalesce((select jsonb_agg(e) from jsonb_array_elements(l.bench_json) e where (e#>>'{}')::uuid <> $1), '[]'::jsonb)
          where l.club_id = $2 and l.fixture_id is null`, [p.id, club.id]);
        released++;
      }
      if (go.length) {
        await c.query(`select public._notify($1, $2, 'contracts_expired', $3)`,
          [club.manager_user_id, gameId, JSON.stringify({ count: go.length, players: go.map((p) => p.name_snapshot).slice(0, 5) })]);
      }
    }
    await c.query(`update public.academy_prospects x set status = 'released', decided_at = now()
                    from public.game_clubs gc where gc.id = x.club_id and gc.manager_user_id is null and x.game_id = $1 and x.status = 'academy'`, [gameId]);
    await c.query(`update public.academy_prospects set age = least(21, age + 1) where game_id = $1 and status = 'academy'`, [gameId]);
    return { released };
  });
}

/** After round 3 of a season: AI clubs sign the free agents nobody took (best first, where they help most). */
export async function aiSignFreeAgents(pool: Pool, gameId: string, season: number, round: number): Promise<number> {
  if (round !== 3) return 0;
  return tx(pool, async (c) => {
    if (!(await marker(c, gameId, season, round, "free_agents_ai"))) return 0;
    const maxSquad = Number((await c.query(`select coalesce((settings_json->>'max_squad')::int, 32) m from public.games where id = $1`, [gameId])).rows[0].m);
    const agents = (await c.query<{ id: string; current_ovr: number; position_group: PositionGroup }>(
      `select id, current_ovr, position_group from public.game_players where game_id = $1 and club_id is null and free_agent_since = $2`, [gameId, season])).rows;
    if (!agents.length) return 0;
    const clubs = (await c.query<{ id: string; size: number; g: Record<string, number> }>(
      `select gc.id, (select count(*)::int from public.game_players p where p.club_id = gc.id) size,
              coalesce((select jsonb_object_agg(position_group, a) from (select position_group, avg(current_ovr)::float a from public.game_players p where p.club_id = gc.id group by 1) x), '{}') g
         from public.game_clubs gc where gc.game_id = $1 and gc.manager_user_id is null order by gc.id`, [gameId])).rows;
    const picks = aiFreeAgentPicks(agents.map((a) => ({ id: a.id, ovr: a.current_ovr, group: a.position_group })),
      clubs.map((x) => ({ id: x.id, size: x.size, groupAvg: x.g })), maxSquad);
    for (const p of picks) {
      await c.query(`update public.game_players set club_id = $2, wage_cents = coalesce(free_agent_wage_cents, wage_cents), contract_end_season = $3,
                            free_agent_since = null, free_agent_wage_cents = null, version = version + 1, updated_at = now()
                      where id = $1 and club_id is null`, [p.player_id, p.club_id, season + 1]);
      await c.query(`insert into public.transfer_transactions (game_id, player_id, from_club_id, to_club_id, price_cents, offer_id, season_number)
                     values ($1, $2, null, $3, 0, null, $4)`, [gameId, p.player_id, p.club_id, season]);
    }
    return picks.length;
  });
}
