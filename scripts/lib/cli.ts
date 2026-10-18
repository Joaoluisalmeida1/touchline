/** Shared CLI helpers: env loading, pg pool, PlayerElo client, arg parsing. Server-side only. */
import { config } from "dotenv";
import { Pool } from "pg";
import { PlayerEloClient } from "../../src/integrations/playerelo/client";
import { pgPoolConfig, resolveDbUrl } from "../../src/server/pg-config";

config({ path: ".env.local" });
config();

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}
export const flag = (name: string) => process.argv.includes(`--${name}`);
export const list = (name: string) => (arg(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function dbPool(): Pool {
  const url = resolveDbUrl();
  if (!url) throw new Error("SUPABASE_DB_URL (or POSTGRES_URL) is not set (see .env.example)");
  // CLIs spend minutes on HTTP between queries; the Supabase pooler may close idle connections meanwhile.
  // keepAlive makes that rarer, and the handler drops a dead idle client instead of crashing the process
  // (pg emits 'error' on the pool for idle clients; unhandled, Node exits). The next query opens a fresh connection.
  const pool = new Pool({ ...pgPoolConfig(url, 3), keepAlive: true });
  pool.on("error", (e) => console.error(`(db) idle connection dropped: ${e.message} — reconnecting on next query`));
  return pool;
}

export function playerEloClient(): PlayerEloClient {
  const apiKey = process.env.PLAYERELO_API_KEY;
  if (!apiKey) {
    console.error("PLAYERELO_API_KEY is not set. Real imports need a key: https://playerelo.football/api-access\n" +
      "For development without a key use: npm run seed:synthetic");
    process.exit(2);
  }
  return new PlayerEloClient({
    apiKey,
    baseUrl: process.env.PLAYERELO_BASE_URL,
    ratePerMinute: Number(process.env.PLAYERELO_RATE_PER_MINUTE ?? 9),
    onRequest: (i) => console.log(`  ↳ ${i.status || "ERR"} ${i.path} (${i.ms}ms${i.attempt ? `, retry ${i.attempt}` : ""})`),
  });
}

export function printTable(rows: Record<string, unknown>[]) {
  if (rows.length) console.table(rows);
  else console.log("(none)");
}
