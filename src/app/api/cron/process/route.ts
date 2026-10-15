import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPool } from "@/server/db";
import { serverEnv } from "@/server/env";
import { processDueGames } from "@/server/services/matchday";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily Vercel cron (Hobby: max 1x/day, ±59 min). Vercel sends `Authorization: Bearer $CRON_SECRET`.
 * Processes at most N due games per call; each is idempotent and lease-protected.
 */
export async function GET(req: NextRequest) {
  const secret = serverEnv().CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const requestId = randomUUID();
  const results = await processDueGames(getPool(), { limit: 10, requestId });
  return NextResponse.json({ request_id: requestId, processed: results.length, results });
}
