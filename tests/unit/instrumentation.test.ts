import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctx = { routerKind: "App Router", routePath: "/g/[gameId]", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined, renderType: "dynamic" } as const;
const req = { path: "/g/123?invite=SECRETCODE", method: "GET", headers: {} };

async function load() {
  vi.resetModules();
  return (await import("../../src/instrumentation")).onRequestError;
}

describe("onRequestError", () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "error").mockImplementation((s: string) => { logs.push(s); });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("logs one structured line without the query string", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await (await load())(Object.assign(new Error("boom"), { digest: "123" }), req, ctx);
    const entry = JSON.parse(logs[0]);
    expect(entry).toMatchObject({ msg: "request.failed", path: "/g/123", route: "/g/[gameId]", digest: "123", error: "boom" });
    expect(logs[0]).not.toContain("SECRETCODE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("alerts the webhook once per error and route within the window", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example/abc");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const onRequestError = await load();
    await onRequestError(new Error("db down"), req, ctx);
    await onRequestError(new Error("db down"), req, ctx);
    await onRequestError(new Error("other"), req, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.content).toContain("db down");
    expect(body.text).toBe(body.content);
  });

  it("never throws when the webhook fails", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example/abc");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect((await load())(new Error("x"), req, ctx)).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("alert.failed"))).toBe(true);
  });
});
