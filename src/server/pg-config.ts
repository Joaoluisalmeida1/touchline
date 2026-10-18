import type { PoolConfig } from "pg";

/** PEM from an env var; accepts real newlines or literal "\n" (how multi-line values often get pasted). */
export function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, "\n").trim() + "\n";
}

/**
 * Build a pg PoolConfig from a Postgres URL. Supabase pooler URLs often carry `sslmode=require`, which recent
 * `pg` versions interpret as full certificate verification; we strip it and decide TLS here:
 *  - localhost: no TLS;
 *  - `ca` given (SUPABASE_DB_CA = Supabase's root certificate, Dashboard → Database → SSL): TLS with certificate and
 *    hostname verification — protects against a man-in-the-middle between Vercel and the pooler;
 *  - otherwise: TLS without verification (encrypted, as libpq `require`). Kept as the default so enabling
 *    verification is an explicit, testable rollout step (docs/deployment.md).
 */
export function pgPoolConfig(rawUrl: string, max = 5, ca: string | undefined = process.env.SUPABASE_DB_CA || undefined): PoolConfig {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(rawUrl) || /^postgres(ql)?:\/\/[^@]*$/.test(rawUrl);
  let url = rawUrl;
  try {
    const u = new URL(rawUrl);
    for (const k of ["sslmode", "sslrootcert", "supa", "pgbouncer"]) u.searchParams.delete(k);
    url = u.toString();
  } catch {
    /* keep raw */
  }
  const ssl = local ? undefined : ca ? { ca: normalizePem(ca), rejectUnauthorized: true } : { rejectUnauthorized: false };
  return { connectionString: url, max, idleTimeoutMillis: 10_000, ssl };
}

/** DB URL from our variable or the Supabase ↔ Vercel integration (POSTGRES_URL = transaction pooler). */
export function resolveDbUrl(): string | undefined {
  return process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || undefined;
}
