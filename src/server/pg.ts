/** Transaction helpers usable from Next.js server code AND tests (no "server-only" import here). */
import type { Pool, PoolClient } from "pg";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guardrails for user-scoped transactions, so one slow query or a stuck transaction cannot hold a pooled connection.
 * Supabase gives the `authenticated` role an 8 s statement_timeout, but role settings only apply to roles that log in —
 * not to `set local role` impersonation — so they are set here, transaction-local. Matchday processing (asService) is
 * not affected.
 */
export const USER_STATEMENT_TIMEOUT = "8s";
export const USER_IDLE_IN_TX_TIMEOUT = "30s";

/** Runs fn as role `authenticated` with JWT claims (PostgREST-equivalent): RLS + auth.uid() apply. */
export async function asUser<T>(pool: Pool, userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new Error("asUser: userId must be a UUID");
  const c = await pool.connect();
  try {
    // One round trip instead of three: open the transaction, set the claims and switch role (set_config('role', …, true)
    // is SET LOCAL ROLE, as PostgREST does it). A multi-statement query cannot take $n parameters, so the values are
    // inlined — userId is a validated UUID and both literals are escaped anyway.
    const claims = c.escapeLiteral(JSON.stringify({ sub: userId, role: "authenticated" }));
    await c.query(`begin; select set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${c.escapeLiteral(userId)}, true), set_config('role', 'authenticated', true),
      set_config('statement_timeout', '${USER_STATEMENT_TIMEOUT}', true), set_config('idle_in_transaction_session_timeout', '${USER_IDLE_IN_TX_TIMEOUT}', true)`);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Owner connection (bypasses RLS) — only for trusted server code after explicit authorisation checks. */
export async function asService<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

export async function inTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Map a Postgres error raised by public._fail() into {code, message}. */
export function domainError(e: unknown): { code: string; message: string } | null {
  const err = e as { code?: string; detail?: string; message?: string };
  if (err?.code === "P0001" && err.detail) return { code: err.detail, message: err.message ?? "Erro" };
  return null;
}
