/**
 * Local mock of the PlayerElo API for tests. Data is FICTIONAL. Response shapes follow the documented
 * /v1/players fields; undocumented endpoints (leagues, league players, usage) use an ASSUMED shape and the
 * importer is tested to tolerate both bare and wrapped arrays.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface MockOptions {
  apiKey: string;
  leagues: Record<string, { name: string; players: number }>;
  wrapLists?: boolean;
  fail429Times?: number;
  ignoreOffset?: boolean;
}

export async function startMockPlayerElo(opts: MockOptions) {
  let calls = 0;
  let remaining429 = opts.fail429Times ?? 0;
  const log: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    log.push(url.pathname + url.search);
    if (req.headers.authorization !== `Bearer ${opts.apiKey}`) {
      res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (url.pathname !== "/v1/usage") calls++;
    if (remaining429 > 0 && url.pathname !== "/v1/usage") {
      remaining429--;
      res.writeHead(429, { "retry-after": "0" }).end("{}");
      return;
    }
    const send = (body: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    const list = (rows: unknown[]) => send(opts.wrapLists ? { data: rows } : rows);
    if (url.pathname === "/v1/usage") return send({ used: calls, cap: 500, remaining: 500 - calls });
    if (url.pathname === "/v1/leagues") return list(Object.entries(opts.leagues).map(([id, l]) => ({ league_id: id, name: l.name, country: "Ficção" })));
    const m = url.pathname.match(/^\/v1\/leagues\/([^/]+)\/players$/);
    if (m) {
      const lg = opts.leagues[m[1]];
      if (!lg) return res.writeHead(404).end("{}");
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const offset = opts.ignoreOffset ? 0 : Number(url.searchParams.get("offset") ?? 0);
      const rows = [];
      for (let i = offset; i < Math.min(lg.players, offset + limit); i++) {
        const club = i % 18;
        rows.push({
          player_id: `${m[1]}-${i}`, player_name: `Fictício ${m[1]} ${i}`, elo: 1300 + ((i * 37) % 500),
          position: ["Goalkeeper", "Defender", "Defender", "Midfielder", "Midfielder", "Attacker"][i % 6],
          current_team: `Clube Fictício ${m[1]}-${club}`, current_team_id: 1000 + club + Number(m[1]) * 100,
          current_league: lg.name, current_league_id: Number(m[1]), games_played: 20 + (i % 15), total_minutes: 600 + (i * 53) % 2600,
          ear_180: ((i % 11) - 5) / 2, ear_label: "Fictional",
        });
      }
      return list(rows);
    }
    if (url.pathname === "/v1/players") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return send([{ player_id: `g${offset}`, player_name: `Global ${offset}`, elo: Math.round(2600 - 140 * Math.log(offset + 1)), position: "Midfielder", current_team: "X", current_league: "Y", ear_label: "Z" }]);
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, log, calls: () => calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}
