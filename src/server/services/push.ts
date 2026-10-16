/**
 * Web push for notifications (results, offers, transfers). Optional: without VAPID keys in the environment every
 * function is a no-op, so local dev and tests need nothing. Keys: `npx web-push generate-vapid-keys`.
 */
import type { Pool } from "pg";
import webpush from "web-push";
import { notificationText } from "../../lib/notifications";
import { asService } from "../pg";

export function pushConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.VAPID_SUBJECT ?? "mailto:touchline@example.com";
  return publicKey && privateKey ? { publicKey, privateKey, subject } : null;
}

const TITLE: Record<string, string> = {
  matchday_completed: "Jornada concluída", offer_received: "Nova proposta", offer_rejected: "Proposta recusada",
  transfer_completed: "Transferência", member_joined: "Novo treinador", game_started: "A liga começou", season_completed: "Fim de época",
  week_ready: "Semana de jornada",
  board_warning: "Direção", offer_countered: "Contraproposta", achievement: "Conquista", board_ultimatum: "Direção", board_praise: "Direção",
};

/** Sends every not-yet-pushed notification of the last day to its user's devices, then marks it pushed. */
export async function flushPush(pool: Pool, limit = 300): Promise<{ sent: number; failed: number }> {
  const cfg = pushConfig();
  return asService(pool, async (c) => {
    const rows = (await c.query<{ id: string; user_id: string; game_id: string | null; type: string; payload_json: Record<string, unknown> }>(
      `select id, user_id, game_id, type, payload_json from public.notifications
        where pushed_at is null and created_at > now() - interval '1 day' order by created_at limit $1`, [limit])).rows;
    if (!rows.length) return { sent: 0, failed: 0 };
    let sent = 0, failed = 0;
    if (cfg) {
      webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
      const subs = (await c.query<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }>(
        `select id, user_id, endpoint, p256dh, auth from public.push_subscriptions where user_id = any($1)`, [[...new Set(rows.map((r) => r.user_id))]])).rows;
      for (const n of rows) {
        const body = JSON.stringify({
          title: TITLE[n.type] ?? "Touchline", body: notificationText(n.type, n.payload_json),
          url: n.game_id ? `/g/${n.game_id}` : "/dashboard", tag: n.type,
        });
        for (const s of subs.filter((x) => x.user_id === n.user_id)) {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 86400 });
            sent++;
            await c.query(`update public.push_subscriptions set last_ok_at = now() where id = $1`, [s.id]);
          } catch (e) {
            failed++;
            const code = (e as { statusCode?: number }).statusCode;
            // the browser dropped the subscription
            if (code === 404 || code === 410) await c.query(`delete from public.push_subscriptions where id = $1`, [s.id]);
          }
        }
      }
    }
    await c.query(`update public.notifications set pushed_at = now() where id = any($1)`, [rows.map((r) => r.id)]);
    return { sent, failed };
  });
}

export async function savePushSubscription(pool: Pool, userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  return asService(pool, (c) => c.query(
    `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)
     on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]));
}

export async function deletePushSubscription(pool: Pool, userId: string, endpoint: string) {
  return asService(pool, (c) => c.query(`delete from public.push_subscriptions where user_id = $1 and endpoint = $2`, [userId, endpoint]));
}
