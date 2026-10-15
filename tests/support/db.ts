/** Integration-test DB helpers: fresh local Postgres DB with the Supabase shim + migrations. */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { asUser as asUserProd } from "../../src/server/pg";

export const LOCAL_PG = process.env.LOCAL_PG_URL ?? "postgres://postgres@localhost:54322";

export function freshDb(name: string): Pool {
  execFileSync(path.resolve("scripts/db/local-reset.sh"), [name], { env: { ...process.env, LOCAL_PG_URL: LOCAL_PG }, stdio: "pipe" });
  return new Pool({ connectionString: `${LOCAL_PG}/${name}`, max: 8 });
}

/**
 * Run fn as a signed-in user through the PRODUCTION helper (src/server/pg.ts), so integration tests exercise the exact
 * claims + role switch the app uses. `null` runs as `anon`, which the app never does (only tests probe it).
 */
export async function asUser<T>(pool: Pool, userId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  if (userId) return asUserProd(pool, userId, fn);
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: "anon" })]);
    await c.query("set local role anon");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

export async function createUser(pool: Pool, email: string, name: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, JSON.stringify({ display_name: name })]);
  return r.rows[0].id;
}

export async function expectPgError(p: Promise<unknown>, code: string | RegExp) {
  try {
    await p;
  } catch (e) {
    const err = e as { detail?: string; message: string; code?: string };
    const hay = `${err.detail ?? ""} ${err.code ?? ""} ${err.message}`;
    if (typeof code === "string" ? hay.includes(code) : code.test(hay)) return err;
    throw new Error(`Expected error ${code} but got: ${hay}`);
  }
  throw new Error(`Expected error ${code} but call succeeded`);
}
