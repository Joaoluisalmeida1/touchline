import "server-only";
import { Pool, type PoolClient } from "pg";
import { serverEnv } from "./env";
import { asService, asUser } from "./pg";

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
    const url = serverEnv().SUPABASE_DB_URL;
    globalForPg.__touchlinePool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
    });
  }
  return globalForPg.__touchlinePool;
}

export const withUser = <T>(userId: string, fn: (c: PoolClient) => Promise<T>) => asUser(getPool(), userId, fn);
export const withService = <T>(fn: (c: PoolClient) => Promise<T>) => asService(getPool(), fn);
