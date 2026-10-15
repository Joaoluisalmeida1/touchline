/** Transaction helpers usable from Next.js server code AND tests (no "server-only" import here). */
import type { Pool, PoolClient } from "pg";

/** Runs fn as role `authenticated` with JWT claims (PostgREST-equivalent): RLS + auth.uid() apply. */
export async function asUser<T>(pool: Pool, userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }), userId,
    ]);
    await c.query("set local role authenticated");
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
