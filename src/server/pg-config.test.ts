import { afterEach, describe, expect, it, vi } from "vitest";
import { pgPoolConfig, resolveDbUrl } from "./pg-config";

describe("pgPoolConfig", () => {
  it("connects to localhost without TLS", () => {
    for (const url of ["postgres://postgres@localhost:5432/db", "postgresql://u:p@127.0.0.1/db", "postgres:///db"]) {
      expect(pgPoolConfig(url).ssl).toBeUndefined();
    }
  });

  it("uses TLS for remote hosts and strips libpq-only params that pg would misread", () => {
    const cfg = pgPoolConfig("postgresql://postgres.ref:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&supa=x&application_name=touchline");
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false });
    const url = new URL(cfg.connectionString!);
    expect([...url.searchParams.keys()]).toEqual(["application_name"]);
    expect(url.port).toBe("6543");
  });

  it("passes the pool size and an idle timeout", () => {
    expect(pgPoolConfig("postgres://localhost/db", 9)).toMatchObject({ max: 9, idleTimeoutMillis: 10_000 });
    expect(pgPoolConfig("postgres://localhost/db").max).toBe(5);
  });
});

describe("resolveDbUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers SUPABASE_DB_URL, falls back to POSTGRES_URL (Vercel integration), else undefined", () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://a");
    vi.stubEnv("POSTGRES_URL", "postgres://b");
    expect(resolveDbUrl()).toBe("postgres://a");
    vi.stubEnv("SUPABASE_DB_URL", "");
    expect(resolveDbUrl()).toBe("postgres://b");
    vi.stubEnv("POSTGRES_URL", "");
    expect(resolveDbUrl()).toBeUndefined();
  });
});
