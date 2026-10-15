import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VARS = [
  "SUPABASE_DB_URL", "POSTGRES_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "APP_BASE_URL", "VERCEL", "VERCEL_ENV", "VERCEL_PROJECT_PRODUCTION_URL", "AUTH_MODE", "DEV_AUTH_SECRET", "ALLOW_DEV_AUTH_IN_LOCAL_PROD",
];
const SECRET = "x".repeat(32);

function clearEnv() {
  for (const k of VARS) vi.stubEnv(k, undefined);
  vi.stubEnv("NODE_ENV", "test");
}

/** serverEnv() caches its result, so each case starts from a clean env and loads a fresh module. */
async function load(env: Record<string, string>) {
  clearEnv();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  return (await import("./env")).serverEnv;
}

describe("serverEnv", () => {
  beforeEach(clearEnv);
  afterEach(() => vi.unstubAllEnvs());

  const supabase = { SUPABASE_DB_URL: "postgres://db", NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" };

  it("requires a database URL", async () => {
    expect(await load({})).toThrow(/SUPABASE_DB_URL/);
  });

  it("accepts the Supabase <-> Vercel integration variable names", async () => {
    const env = (await load({ POSTGRES_URL: "postgres://from-integration", NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }))();
    expect(env.SUPABASE_DB_URL).toBe("postgres://from-integration");
    expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe("anon");
  });

  it("supabase mode requires the public URL and key", async () => {
    expect(await load({ SUPABASE_DB_URL: "postgres://db" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("derives APP_BASE_URL from the Vercel production URL when unset", async () => {
    expect((await load({ ...supabase, VERCEL_PROJECT_PRODUCTION_URL: "touchline.example" }))().APP_BASE_URL).toBe("https://touchline.example");
    expect((await load(supabase))().APP_BASE_URL).toBe("http://localhost:3000");
  });

  it("dev auth works locally with a long enough secret", async () => {
    expect((await load({ SUPABASE_DB_URL: "postgres://db", AUTH_MODE: "dev", DEV_AUTH_SECRET: SECRET }))().AUTH_MODE).toBe("dev");
    expect(await load({ SUPABASE_DB_URL: "postgres://db", AUTH_MODE: "dev", DEV_AUTH_SECRET: "short" })).toThrow(/DEV_AUTH_SECRET/);
  });

  it("dev auth is refused on Vercel and in production", async () => {
    const dev = { SUPABASE_DB_URL: "postgres://db", AUTH_MODE: "dev", DEV_AUTH_SECRET: SECRET };
    expect(await load({ ...dev, VERCEL: "1" })).toThrow(/forbidden/);
    expect(await load({ ...dev, VERCEL_ENV: "preview" })).toThrow(/forbidden/);
    expect(await load({ ...dev, NODE_ENV: "production" })).toThrow(/forbidden/);
    // explicit opt-in for `next start` on a local machine / CI
    expect((await load({ ...dev, NODE_ENV: "production", ALLOW_DEV_AUTH_IN_LOCAL_PROD: "1" }))().AUTH_MODE).toBe("dev");
    // ...but never on Vercel, even with the opt-in
    expect(await load({ ...dev, VERCEL: "1", ALLOW_DEV_AUTH_IN_LOCAL_PROD: "1" })).toThrow(/forbidden/);
  });
});
