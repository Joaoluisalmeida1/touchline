/**
 * PlayerElo HTTP client — server/CLI only (never import from client components: the API key is secret).
 * Global rate limiter, exponential backoff with jitter for 429/5xx, Retry-After support, timeouts,
 * request accounting (for quota tracking) and response hashing (for audit/idempotent checkpoints).
 */
import { createHash } from "node:crypto";

export const PLAYERELO_BASE_URL = "https://data-api.playerelo.football";

export interface PlayerEloClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** requests per minute (Free plan documented as 10/min => default 9 for headroom) */
  ratePerMinute?: number;
  maxRetries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onRequest?: (info: { path: string; status: number; attempt: number; ms: number }) => void;
}

export class PlayerEloError extends Error {
  constructor(message: string, public status: number, public path: string, public body?: string) {
    super(message);
  }
}

export interface ApiResponse {
  status: number;
  data: unknown;
  hash: string;
  path: string;
}

export class PlayerEloClient {
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private lastRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();
  /** counted billable requests (every HTTP attempt except /v1/usage, which docs say is free) */
  public requestsUsed = 0;

  constructor(private readonly opts: PlayerEloClientOptions) {
    if (!opts.apiKey) throw new Error("PLAYERELO_API_KEY is required");
    this.baseUrl = (opts.baseUrl ?? PLAYERELO_BASE_URL).replace(/\/$/, "");
    this.minIntervalMs = Math.ceil(60_000 / Math.max(1, opts.ratePerMinute ?? 9));
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  /** Serialise requests through a single global limiter. */
  private async throttle(): Promise<void> {
    const prev = this.queue;
    let release!: () => void;
    this.queue = new Promise((r) => (release = r));
    await prev;
    const wait = this.lastRequestAt + this.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.now();
    release();
  }

  async get(path: string, query: Record<string, string | number | undefined> = {}): Promise<ApiResponse> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    const maxRetries = this.opts.maxRetries ?? 5;
    const free = path === "/v1/usage";
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      const started = this.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 20_000);
      let status = 0;
      try {
        const res = await this.fetchImpl(url, {
          headers: { Authorization: `Bearer ${this.opts.apiKey}`, Accept: "application/json" },
          signal: controller.signal,
        });
        status = res.status;
        if (!free) this.requestsUsed++;
        const text = await res.text();
        this.opts.onRequest?.({ path: url.pathname + url.search, status, attempt, ms: this.now() - started });
        if (res.ok) {
          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            throw new PlayerEloError("Invalid JSON from PlayerElo", status, path, text.slice(0, 200));
          }
          return { status, data, hash: createHash("sha256").update(text).digest("hex"), path: url.pathname + url.search };
        }
        if (status === 401 || status === 403) throw new PlayerEloError("PlayerElo rejected the API key (401/403)", status, path);
        if (status === 404) throw new PlayerEloError("Not found", 404, path, text.slice(0, 200));
        if ((status === 429 || status >= 500) && attempt < maxRetries) {
          await this.sleep(this.backoffMs(attempt, res.headers.get("retry-after")));
          continue;
        }
        throw new PlayerEloError(`PlayerElo HTTP ${status}`, status, path, text.slice(0, 300));
      } catch (e) {
        if (e instanceof PlayerEloError) throw e;
        // network error / timeout
        if (attempt < maxRetries) {
          this.opts.onRequest?.({ path, status: 0, attempt, ms: this.now() - started });
          await this.sleep(this.backoffMs(attempt, null));
          continue;
        }
        throw new PlayerEloError(`Network error: ${(e as Error).message}`, status, path);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  backoffMs(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs)) return Math.min(300_000, secs * 1000);
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) return Math.max(0, Math.min(300_000, date - this.now()));
    }
    const base = Math.min(60_000, 1000 * 2 ** attempt);
    return base / 2 + Math.random() * (base / 2); // jitter (non-deterministic is fine here: I/O only)
  }

  usage() { return this.get("/v1/usage"); }
  leagues() { return this.get("/v1/leagues"); }
  league(id: string) { return this.get(`/v1/leagues/${encodeURIComponent(id)}`); }
  leaguePlayers(id: string, page: { limit: number; offset: number }) {
    return this.get(`/v1/leagues/${encodeURIComponent(id)}/players`, page);
  }
  clubs(page?: { limit?: number; offset?: number }) { return this.get("/v1/clubs", page ?? {}); }
  clubPlayers(id: string) { return this.get(`/v1/clubs/${encodeURIComponent(id)}/players`); }
  players(q: { limit?: number; offset?: number; search?: string }) { return this.get("/v1/players", q); }
  player(id: string) { return this.get(`/v1/players/${encodeURIComponent(id)}`); }
  playerValue(id: string) { return this.get(`/v1/players/${encodeURIComponent(id)}/value`); }
}
