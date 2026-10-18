import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { withService } from "./db";

/**
 * Rate limits for abuse-prone actions, enforced in Postgres (public.rate_limit_hit) so they hold across serverless
 * instances. Why not rely on Supabase Auth's limits: sign-in/sign-up are called from our server, so Supabase sees
 * Vercel's IP for every player — its per-IP limits can't tell players apart.
 */
export const LIMITS = {
  loginPerIp: { limit: 20, windowSeconds: 600 },
  loginPerEmail: { limit: 10, windowSeconds: 600 },
  signupPerIp: { limit: 10, windowSeconds: 3600 },
  joinPerUser: { limit: 20, windowSeconds: 600 },
} as const;

export const RATE_LIMITED = "Demasiadas tentativas. Espera alguns minutos e tenta novamente.";

/** Client IP as seen by Vercel's edge (first x-forwarded-for hop). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** Keys are hashed before storage: no raw IPs or emails in the database. */
export const limitKey = (...parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex");

/**
 * Counts one hit against every rule; false if any is over its limit. Fails open (returns true and logs) if the
 * limiter itself errors, so a limiter problem never locks players out.
 */
export async function allow(rules: { key: string; limit: number; windowSeconds: number }[]): Promise<boolean> {
  try {
    return await withService(async (c) => {
      let ok = true;
      for (const r of rules) {
        const res = await c.query<{ ok: boolean }>(`select public.rate_limit_hit($1, $2, $3) ok`, [r.key, r.limit, r.windowSeconds]);
        ok = res.rows[0].ok && ok; // count every rule, even after one trips
      }
      return ok;
    });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "rate_limit.failed", error: (e as Error).message }));
    return true;
  }
}
