import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPool } from "@/server/db";
import { serverEnv } from "@/server/env";
import { processDueGames } from "@/server/services/matchday";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 10;
/** Stop starting new batches after this long, leaving headroom under maxDuration for the games in flight. */
const BUDGET_MS = 240_000;

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Processes every daily-mode league whose deadline passed, one round per league per call. Triggered once a day by the
 * Vercel cron (vercel.json) — matchdays are deliberately daily. Each game is idempotent and lease-protected, so a manual
 * call or an overlap is safe. Responds 500 if any league failed, so the failure shows in the Vercel cron logs.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req.headers.get("authorization"), serverEnv().CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const requestId = randomUUID();
  const started = Date.now();
  const results: Awaited<ReturnType<typeof processDueGames>> = [];
  let budgetExhausted = false;
  for (;;) {
    const batch = await processDueGames(getPool(), { limit: BATCH, requestId, excludeIds: results.map((r) => r.game_id) });
    results.push(...batch);
    if (batch.length < BATCH) break;
    if (Date.now() - started >= BUDGET_MS) {
      budgetExhausted = true; // remaining due leagues are picked up by the next call
      break;
    }
  }
  const failed = results.filter((r) => r.error).length;
  const ms = Date.now() - started;
  console.log(JSON.stringify({ level: failed ? "error" : "info", msg: "cron.run", request_id: requestId, processed: results.length, failed, budget_exhausted: budgetExhausted, ms }));
  return NextResponse.json(
    { request_id: requestId, processed: results.length, failed, budget_exhausted: budgetExhausted, results },
    { status: failed ? 500 : 200 },
  );
}
