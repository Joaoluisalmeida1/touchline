import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { Pool, type PoolClient } from "pg";
import { serverEnv } from "./env";
import { asService, asUser } from "./pg";
import { pgPoolConfig } from "./pg-config";

/**
 * Postgres access for the server. Two modes:
 *  - withUser(userId): runs inside a transaction as role `authenticated` with JWT claims set, exactly like
 *    PostgREST does — RLS policies and auth.uid() apply. Used for every user-scoped read and command.
 *  - withService(): owner connection (bypasses RLS). Used only by trusted server code (game creation payloads,
 *    matchday processing, cron) after the caller has been authenticated/authorised in TypeScript.
 */
const globalForPg = globalThis as unknown as { __touchlinePool?: Pool };

export function getPool(): Pool {
  if (!globalForPg.__touchlinePool) {
    const pool = new Pool(pgPoolConfig(serverEnv().SUPABASE_DB_URL, Number(process.env.PG_POOL_MAX ?? 5)));
    // Vercel Fluid compute: keep the instance alive until idle clients are closed, so suspended instances don't leave
    // connections open on the Supavisor pooler. No-op outside Vercel.
    attachDatabasePool(pool);
    if (process.env.VERCEL && !process.env.SUPABASE_DB_CA) {
      console.warn(JSON.stringify({ level: "warn", msg: "db.tls_unverified", hint: "set SUPABASE_DB_CA to verify the database certificate (docs/deployment.md)" }));
    }
    globalForPg.__touchlinePool = pool;
  }
  return globalForPg.__touchlinePool;
}

export const withUser = <T>(userId: string, fn: (c: PoolClient) => Promise<T>) => asUser(getPool(), userId, fn);
export const withService = <T>(fn: (c: PoolClient) => Promise<T>) => asService(getPool(), fn);
