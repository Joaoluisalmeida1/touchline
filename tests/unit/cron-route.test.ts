import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ processDueGames: vi.fn(), now: { value: 0 } }));
vi.mock("@/server/db", () => ({ getPool: () => ({}) }));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ CRON_SECRET: "s3cret-s3cret-s3cret" }) }));
vi.mock("@/server/services/matchday", () => ({ processDueGames: m.processDueGames }));

const { GET } = await import("../../src/app/api/cron/process/route");
const req = (auth?: string) => new NextRequest("http://localhost/api/cron/process", { headers: auth ? { authorization: auth } : {} });
const ok = (id: string) => ({ game_id: id, result: { status: "processed", round: 1 } });
const AUTH = "Bearer s3cret-s3cret-s3cret";

describe("/api/cron/process", () => {
  beforeEach(() => {
    m.processDueGames.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("rejects missing, wrong and non-Bearer secrets without touching the database", async () => {
    for (const auth of [undefined, "Bearer nope", "s3cret-s3cret-s3cret", "Bearer s3cret-s3cret-s3cret-and-more"]) {
      expect((await GET(req(auth))).status).toBe(401);
    }
    expect(m.processDueGames).not.toHaveBeenCalled();
  });

  it("keeps taking batches while they are full, excluding leagues already handled in this call", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ok(`g${i}`));
    m.processDueGames.mockResolvedValueOnce(ten).mockResolvedValueOnce([ok("g10"), ok("g11")]);
    const res = await GET(req(AUTH));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 12, failed: 0, budget_exhausted: false });
    expect(m.processDueGames).toHaveBeenCalledTimes(2);
    expect(m.processDueGames.mock.calls[1][1].excludeIds).toEqual(ten.map((r) => r.game_id));
  });

  it("returns 500 when any league failed, with the rest still processed", async () => {
    m.processDueGames.mockResolvedValueOnce([ok("a"), { game_id: "b", error: "boom" }]);
    const res = await GET(req(AUTH));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ processed: 2, failed: 1 });
  });

  it("stops starting batches once the time budget is used", async () => {
    let t = 0;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    const full = () => Array.from({ length: 10 }, (_, i) => ok(`x${t}-${i}`));
    m.processDueGames.mockImplementation(async () => { t += 100_000; return full(); });
    const body = await (await GET(req(AUTH))).json();
    expect(body.budget_exhausted).toBe(true);
    expect(m.processDueGames).toHaveBeenCalledTimes(3); // 100 s, 200 s, 300 s ≥ 240 s budget → stop
    vi.mocked(Date.now).mockRestore();
  });
});
