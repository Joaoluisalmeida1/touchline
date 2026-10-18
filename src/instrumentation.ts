/**
 * Next.js instrumentation: every uncaught server error (pages, layouts, route handlers, server actions, middleware)
 * becomes one structured log line, and — if ALERT_WEBHOOK_URL is set (Discord or Slack incoming webhook) — an alert.
 * Alerts are deduplicated per instance (same error at the same route at most once per 10 min) so a crash loop doesn't
 * flood the channel. No third-party SDK; works in the Node and Edge runtimes.
 */
import type { Instrumentation } from "next";

const ALERT_WINDOW_MS = 10 * 60_000;
const lastAlert = new Map<string, number>();

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  const path = request.path.split("?")[0]; // never log query strings (invite codes, tokens)
  const entry = {
    level: "error", msg: "request.failed", method: request.method, path, route: context.routePath, route_type: context.routeType,
    router: context.routerKind, digest: e.digest ?? null, error: String(e.message ?? err).slice(0, 500),
  };
  console.error(JSON.stringify(entry));

  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (!webhook) return;
  const key = `${entry.route}|${entry.error}`;
  const now = Date.now();
  if ((lastAlert.get(key) ?? 0) > now - ALERT_WINDOW_MS) return;
  lastAlert.set(key, now);
  const text = `🔴 Touchline ${process.env.VERCEL_ENV ?? "local"}: ${entry.route_type} error at ${entry.route}\n${entry.error}${entry.digest ? `\ndigest ${entry.digest}` : ""}`;
  try {
    // Discord reads `content`, Slack reads `text`
    await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text, text }), signal: AbortSignal.timeout(3000) });
  } catch {
    console.error(JSON.stringify({ level: "error", msg: "alert.failed", route: entry.route }));
  }
};
