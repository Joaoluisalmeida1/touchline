/**
 * Phase 4a social layer, run after each processed round (once per round: marker `social_round`):
 *  - the round's lead headline is posted on the league wall;
 *  - achievements are evaluated for every human manager; new ones are notified and announced on the wall.
 * `evaluateAchievements` is also safe to call lazily (unique per game/user/key).
 */
import type { Pool, PoolClient } from "pg";
import { ACHIEVEMENT_BY_KEY, earnedAchievements, type AchievementCtx, type AResult } from "../../engine/narrative/achievements";
import { asService } from "../pg";

export async function afterRoundSocial(pool: Pool, gameId: string, season: number, round: number): Promise<void> {
  const first = await asService(pool, async (c) => !!(await c.query(
    `insert into public.game_events (game_id, season, round, kind, key, payload) values ($1,$2,$3,'social_round','round','{}'::jsonb)
     on conflict (game_id, season, round, kind, key) do nothing returning id`, [gameId, season, round])).rowCount);
  if (!first) return;
  await asService(pool, async (c) => {
    const lead = (await c.query<{ headline: string; kind: string; fixture_id: string | null }>(
      `select headline, kind, fixture_id from public.news_items where game_id = $1 and season = $2 and round = $3 order by rank limit 1`,
      [gameId, season, round])).rows[0];
    if (lead) {
      await c.query(
        `insert into public.wall_posts (game_id, kind, payload, dedupe_key) values ($1, 'headline', $2, $3) on conflict (game_id, dedupe_key) do nothing`,
        [gameId, JSON.stringify({ headline: lead.headline, round, season, fixture_id: lead.fixture_id }), `headline:${season}:${round}`]);
    }
  });
  await evaluateAchievements(pool, gameId, { season, round });
}

async function ctxFor(c: PoolClient, gameId: string, clubId: string, userId: string, at: { season: number; round: number }): Promise<AchievementCtx> {
  const fx = (await c.query<{ season: number; round: number; home: boolean; gf: number; ga: number; opp_human: boolean }>(
    `select s.number season, f.round_number round, f.home_club_id = $2 home,
            case when f.home_club_id = $2 then f.result_home else f.result_away end gf,
            case when f.home_club_id = $2 then f.result_away else f.result_home end ga,
            (select manager_user_id is not null from public.game_clubs where id = case when f.home_club_id = $2 then f.away_club_id else f.home_club_id end) opp_human
       from public.fixtures f join public.seasons s on s.id = f.season_id
      where f.game_id = $1 and f.status = 'completed' and $2 in (f.home_club_id, f.away_club_id)
      order by s.number, f.round_number`, [gameId, clubId])).rows;
  const results: AResult[] = fx.map((r) => ({ season: r.season, round: r.round, gf: r.gf, ga: r.ga, opp_human: !!r.opp_human }));
  const pos = (await c.query<{ position: number }>(
    `select position from (select st.club_id, row_number() over (order by st.points desc, st.gd desc, st.gf desc, st.won desc, st.club_id) position
       from public.standings st join public.seasons s on s.id = st.season_id where s.game_id = $1 and s.number = $2) t where club_id = $3`,
    [gameId, at.season, clubId])).rows[0]?.position ?? null;
  const champions = Number((await c.query(
    `select count(*) n from public.seasons where game_id = $1 and summary_json->>'champion_club_id' = $2`, [gameId, clubId])).rows[0].n);
  const objectives = Number((await c.query(
    `select count(*) n from public.board_state where club_id = $1 and final_position is not null and final_position <= (objective->>'target')::int`, [clubId])).rows[0].n);
  const facts = Object.fromEntries((await c.query<{ kind: string; n: string }>(
    `select kind, count(*) n from public.game_events where game_id = $1 and club_id = $2
      and kind in ('comeback','late_winner','hat_trick','player_of_round','team_of_round') group by kind`, [gameId, clubId])).rows.map((r) => [r.kind, Number(r.n)]));
  const tx = (await c.query<{ player_id: string; from_club_id: string | null; to_club_id: string | null; price_cents: string; completed_at: string; other_human: boolean; offer_id: string | null; swap: boolean }>(
    `select t.player_id, t.from_club_id, t.to_club_id, t.price_cents, t.completed_at, t.offer_id,
            exists (select 1 from public.transfer_offers o where o.id = t.offer_id and o.swap_player_id is not null) swap,
            (select manager_user_id is not null from public.game_clubs where id = case when t.to_club_id = $2 then t.from_club_id else t.to_club_id end) other_human
       from public.transfer_transactions t where t.game_id = $1 and $2 in (t.from_club_id, t.to_club_id) order by t.completed_at`, [gameId, clubId])).rows;
  const paid = new Map<string, number>();
  const buys: number[] = [], multiples: number[] = [];
  for (const t of tx) {
    const price = Number(t.price_cents);
    if (t.to_club_id === clubId) { if (price > 0) { buys.push(price); paid.set(t.player_id, price); } }
    else if (t.from_club_id === clubId && paid.get(t.player_id)) multiples.push(price / paid.get(t.player_id)!);
  }
  const biz = (await c.query<{ fan_mood: number; upgrades: { ready_at: number }[] }>(`select fan_mood, upgrades from public.club_business where club_id = $1`, [clubId])).rows[0];
  const conf = (await c.query<{ confidence: number }>(`select confidence from public.board_state where club_id = $1 and season = $2`, [clubId, at.season])).rows[0];
  const now = at.season * 100 + at.round;
  const press = Number((await c.query(`select count(*) n from public.press_conferences where club_id = $1 and answered_at is not null`, [clubId])).rows[0].n);
  const office = Number((await c.query(`select count(*) n from public.inbox_events where club_id = $1 and resolution = 'answered'`, [clubId])).rows[0].n);
  const cash = (await c.query<{ cash_cents: string; initial: string | null }>(
    `select cash_cents, (select amount_cents from public.club_ledger where club_id = $1 and event_type = 'initial_balance' limit 1) initial
       from public.game_clubs where id = $1`, [clubId])).rows[0];
  void userId;
  return {
    results, position: pos, round: at.round, champion_seasons: champions, objectives_met: objectives,
    facts, buys, sale_multiples: multiples,
    swaps: tx.filter((t) => t.swap).length, human_deals: tx.filter((t) => t.other_human && t.offer_id).length,
    fan_mood: biz?.fan_mood ?? null, confidence: conf?.confidence ?? null,
    upgrades_done: (biz?.upgrades ?? []).filter((u) => u.ready_at <= now).length,
    press_answered: press, events_answered: office,
    cash_cents: Number(cash?.cash_cents ?? 0), initial_cash_cents: Number(cash?.initial ?? 0),
  };
}

/** Evaluates every human manager of the game; returns the newly unlocked (user, key) pairs. */
export async function evaluateAchievements(pool: Pool, gameId: string, at?: { season: number; round: number }) {
  return asService(pool, async (c) => {
    const g = (await c.query<{ current_season: number; current_matchday: number }>(`select current_season, current_matchday from public.games where id = $1`, [gameId])).rows[0];
    if (!g) return [];
    const when = at ?? { season: g.current_season, round: g.current_matchday };
    const humans = (await c.query<{ id: string; manager_user_id: string; name_snapshot: string; display_name: string }>(
      `select gc.id, gc.manager_user_id, gc.name_snapshot, pr.display_name from public.game_clubs gc join public.profiles pr on pr.id = gc.manager_user_id
        where gc.game_id = $1 order by gc.id`, [gameId])).rows;
    const unlocked: { user_id: string; key: string }[] = [];
    for (const h of humans) {
      const keys = earnedAchievements(await ctxFor(c, gameId, h.id, h.manager_user_id, when));
      for (const key of keys) {
        const ins = await c.query(
          `insert into public.achievements (game_id, user_id, club_id, key, season, round) values ($1,$2,$3,$4,$5,$6)
           on conflict (game_id, user_id, key) do nothing returning id`, [gameId, h.manager_user_id, h.id, key, when.season, when.round]);
        if (!ins.rowCount) continue;
        unlocked.push({ user_id: h.manager_user_id, key });
        const def = ACHIEVEMENT_BY_KEY.get(key)!;
        await c.query(`select public._notify($1, $2, 'achievement', $3)`, [h.manager_user_id, gameId, JSON.stringify({ key, title: def.title })]);
        await c.query(
          `insert into public.wall_posts (game_id, kind, payload, dedupe_key) values ($1, 'achievement', $2, $3) on conflict (game_id, dedupe_key) do nothing`,
          [gameId, JSON.stringify({ key, title: def.title, tier: def.tier, manager: h.display_name, club: h.name_snapshot, user_id: h.manager_user_id }), `achievement:${h.manager_user_id}:${key}`]);
      }
    }
    return unlocked;
  });
}
