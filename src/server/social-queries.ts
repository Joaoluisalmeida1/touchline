import "server-only";
import { withUser } from "./db";

export interface WallPost {
  id: string; kind: "post" | "transfer" | "achievement" | "headline" | "slots" | "duel" | "bet"; body: string | null; payload: Record<string, unknown>;
  created_at: string; author_user_id: string | null; author: string | null;
  reactions: { emoji: string; n: number; mine: boolean }[];
}

/** Balneário: latest posts with reaction counts (RLS: members only, deleted hidden). */
export async function getWall(userId: string, gameId: string, limit = 60) {
  return withUser(userId, async (c) => (await c.query<WallPost>(
    `select w.id, w.kind, w.body, w.payload, w.created_at, w.author_user_id, pr.display_name author,
            coalesce((select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'n', r.n, 'mine', r.mine) order by r.emoji)
                        from (select emoji, count(*)::int n, bool_or(user_id = $2) mine from wall_reactions where post_id = w.id and active group by emoji) r), '[]'::jsonb) reactions
       from wall_posts w left join profiles pr on pr.id = w.author_user_id
      where w.game_id = $1 order by w.created_at desc limit $3`, [gameId, userId, limit])).rows);
}

export interface ManagerCard {
  user_id: string; display_name: string; club_id: string; club: string; short_name: string; primary_color: string; secondary_color: string;
  played: number; w: number; d: number; l: number; gf: number; ga: number; titles: number; achievements: number;
  vs_me: { w: number; d: number; l: number } | null; recent: string[];
}

export async function getManagers(userId: string, gameId: string) {
  return withUser(userId, async (c) => {
    const me = (await c.query<{ id: string }>(`select id from game_clubs where game_id = $1 and manager_user_id = $2`, [gameId, userId])).rows[0]?.id ?? null;
    return (await c.query<ManagerCard>(
      `with h as (select gc.id club_id, gc.manager_user_id user_id, pr.display_name, gc.name_snapshot club, gc.short_name, gc.primary_color, gc.secondary_color
                    from game_clubs gc join profiles pr on pr.id = gc.manager_user_id where gc.game_id = $1),
            r as (select h.club_id,
                         case when f.home_club_id = h.club_id then f.result_home else f.result_away end gf,
                         case when f.home_club_id = h.club_id then f.result_away else f.result_home end ga,
                         case when f.home_club_id = h.club_id then f.away_club_id else f.home_club_id end opp
                    from h join fixtures f on f.game_id = $1 and f.status = 'completed' and h.club_id in (f.home_club_id, f.away_club_id))
       select h.*, count(r.*)::int played,
              count(*) filter (where r.gf > r.ga)::int w, count(*) filter (where r.gf = r.ga)::int d, count(*) filter (where r.gf < r.ga)::int l,
              coalesce(sum(r.gf), 0)::int gf, coalesce(sum(r.ga), 0)::int ga,
              (select count(*) from seasons s where s.game_id = $1 and s.summary_json->>'champion_club_id' = h.club_id::text)::int titles,
              (select count(*) from achievements a where a.game_id = $1 and a.user_id = h.user_id)::int achievements,
              coalesce((select array_agg(key order by unlocked_at desc) from (select key, unlocked_at from achievements a where a.game_id = $1 and a.user_id = h.user_id order by unlocked_at desc limit 5) x), '{}') recent,
              case when $2::uuid is null or h.club_id = $2::uuid then null else jsonb_build_object(
                'w', count(*) filter (where r.opp = $2::uuid and r.gf > r.ga), 'd', count(*) filter (where r.opp = $2::uuid and r.gf = r.ga),
                'l', count(*) filter (where r.opp = $2::uuid and r.gf < r.ga)) end vs_me
         from h left join r on r.club_id = h.club_id
        group by h.club_id, h.user_id, h.display_name, h.club, h.short_name, h.primary_color, h.secondary_color
        order by titles desc, (count(*) filter (where r.gf > r.ga)) desc, h.display_name`, [gameId, me])).rows;
  });
}

export async function getAchievementRows(userId: string, gameId: string) {
  return withUser(userId, async (c) => (await c.query<{ user_id: string; key: string; unlocked_at: string; display_name: string; season: number; round: number }>(
    `select a.user_id, a.key, a.unlocked_at, pr.display_name, a.season, a.round from achievements a join profiles pr on pr.id = a.user_id
      where a.game_id = $1 order by a.unlocked_at`, [gameId])).rows);
}
