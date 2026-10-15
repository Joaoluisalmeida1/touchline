import type { PoolConfig } from "pg";

/**
 * Build a pg PoolConfig from a Postgres URL. Supabase pooler URLs often carry `sslmode=require`, which recent
 * `pg` versions interpret as full certificate verification; we strip it and use TLS without CA pinning
 * (encrypted, as libpq `require` does). Localhost connections run without TLS.
 */
export function pgPoolConfig(rawUrl: string, max = 5): PoolConfig {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(rawUrl) || /^postgres(ql)?:\/\/[^@]*$/.test(rawUrl);
  let url = rawUrl;
  try {
    const u = new URL(rawUrl);
    for (const k of ["sslmode", "sslrootcert", "supa", "pgbouncer"]) u.searchParams.delete(k);
    url = u.toString();
  } catch {
    /* keep raw */
  }
  return { connectionString: url, max, idleTimeoutMillis: 10_000, ssl: local ? undefined : { rejectUnauthorized: false } };
}

/** DB URL from our variable or the Supabase ↔ Vercel integration (POSTGRES_URL = transaction pooler). */
export function resolveDbUrl(): string | undefined {
  return process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || undefined;
}
