import { z } from "zod";
import { supabasePublicConfig } from "../lib/supabase/config";
import { resolveDbUrl } from "./pg-config";

/** Server-only environment. Secrets never use the NEXT_PUBLIC_ prefix. */
const ServerEnv = z.object({
  SUPABASE_DB_URL: z.string({ message: "SUPABASE_DB_URL (or POSTGRES_URL) is required" }).min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  CRON_SECRET: z.string().optional(),
  AUTH_MODE: z.enum(["supabase", "dev"]).default("supabase"),
  DEV_AUTH_SECRET: z.string().optional(),
});
export type ServerEnvT = z.infer<typeof ServerEnv>;

let cached: ServerEnvT | null = null;
export function serverEnv(): ServerEnvT {
  if (cached) return cached;
  const parsed = ServerEnv.parse({
    ...process.env,
    SUPABASE_DB_URL: resolveDbUrl(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabasePublicConfig().key || undefined,
    APP_BASE_URL: process.env.APP_BASE_URL
      ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined),
  });
  if (parsed.AUTH_MODE === "dev") {
    // The dev auth adapter is for local testing only and must never run in a deployed environment.
    if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === "production" && !process.env.ALLOW_DEV_AUTH_IN_LOCAL_PROD) {
      throw new Error("AUTH_MODE=dev is forbidden in deployed/production environments");
    }
    if (!parsed.DEV_AUTH_SECRET || parsed.DEV_AUTH_SECRET.length < 32) throw new Error("DEV_AUTH_SECRET (>=32 chars) required for AUTH_MODE=dev");
  } else if (!parsed.NEXT_PUBLIC_SUPABASE_URL || !parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required for AUTH_MODE=supabase");
  }
  cached = parsed;
  return parsed;
}
