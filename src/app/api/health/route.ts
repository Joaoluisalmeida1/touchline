import { NextResponse } from "next/server";
import { getPool } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const r = await getPool().query(`select count(*)::int as snapshots from public.dataset_snapshots where status = 'finalized'`);
    return NextResponse.json({ ok: true, db: "up", finalized_snapshots: r.rows[0].snapshots });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
