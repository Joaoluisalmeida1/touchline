# Touchline — Project Handoff (as of 2026-10-15, ~22:00 Lisbon)

> Paste/attach this file at the start of a new chat. It summarises everything needed to continue: what the project is,
> where everything lives, current state, how to work with the user's setup, known gotchas, and the backlog.
> **No secrets are in this file** (DB password, PlayerElo key, CRON secret, service keys are NOT included — never ask the user to paste them; they live in Vercel/Supabase/`.env.local`).

---

## 1. What this is

**Touchline** (provisional name "Touchline / Clubhouse Manager") — an **asynchronous multiplayer football-management browser game** for Joao and friends. Private leagues, invite links, each manager picks a real club (data from PlayerElo), sets XI/tactics, matchdays are simulated server-side by a deterministic engine, then results/table/transfers/finances.

- **Owner/user:** Joao Luis (Porto, Portugal). Writes to Claude in English (sometimes PT). **Game UI is pt-PT**, timezone **Europe/Lisbon**, money in **integer cents** (EUR).
- The user is not a full-time dev: give **exact copy-paste commands** (Windows PowerShell), one step at a time, and explain briefly.

### Original spec constraints (still apply)
- Don't claim real-player imports or deploys without seeing real responses / a validated URL.
- Never commit credentials; **service-role key never in the frontend**; never print/request secrets.
- Don't invent birth dates for real people. Store raw provider payloads only if licence allows (`PLAYERELO_RETAIN_RAW=false`).
- Don't copy OSM/FM/EA FC UI, branding or assets. No real player photos/crests (copyright) → we use **generated avatars & badges**.
- No scraping fallback. Avoid non-blocking product questions (make sensible defaults, state them).
- Server is authoritative over results, money and ratings.

---

## 2. Where everything lives

| Thing | Location / ID |
|---|---|
| **Live site** | https://touchline-garagemonline.vercel.app (also `touchline-sigma-seven.vercel.app`) |
| **GitHub repo** | `github.com/Joaoluisalmeida1/touchline` (branch `main`) |
| **User's local repo** (Windows PC `joaopc`, user `joao_`) | `C:\Users\joao_\repo\touchline\touchline` ← note the **nested** folder |
| **Supabase project** | name `touchline`, ref/id **`ufzzjjgtxwoyvtnusbse`**, region eu-west-3 (Paris), URL `https://ufzzjjgtxwoyvtnusbse.supabase.co` |
| Supabase publishable key (public, safe) | `sb_publishable_CWvu4QejS-5GhbmKzFaMeg_ioXsuVB1` |
| Supabase pooler host (for CLI) | `aws-1-eu-west-3.pooler.supabase.com` (**aws-1**, not aws-0), session port 5432 / transaction 6543, user `postgres.ufzzjjgtxwoyvtnusbse` |
| **Vercel project** | `touchline`, id **`prj_m5LYwiComTQzrYcYuyom1LjgPpxF`**, team `team_RDG20J7GGmkXF35HA67QglmK` (slug "garagemonline", Hobby). Function region **cdg1**. Vercel user `rkLTNpqmBiadMntl5jmXcqmI` |
| Claude sandbox copy of repo | `/home/claude/touchline` (may not exist in a new session — the user's repo / GitHub is the source of truth) |

### Vercel env vars (names only)
Supabase integration (production): `POSTGRES_URL` (app reads this), `POSTGRES_*`, `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
Manual: `NEXT_PUBLIC_APP_NAME=Touchline`, `CRON_SECRET` (sensitive), plus two renamed leftovers `UNUSED_MANUAL_SUPABASE_URL` / `UNUSED_MANUAL_SUPABASE_PUBLISHABLE_KEY` (safe to delete).
**If the DB password is ever reset:** Supabase → Integrations → Vercel → *Resync environment variables*, then **Redeploy** (the running build keeps the old password otherwise — this already bit us once).

### User's `.env.local` (on his PC, for CLI imports only; not committed)
Has `PLAYERELO_API_KEY` and `SUPABASE_DB_URL=postgresql://postgres.ufzzjjgtxwoyvtnusbse:<password>@aws-1-eu-west-3.pooler.supabase.com:5432/postgres`. Password must be letters/digits only (no URL-encoding issues).

---

## 3. Tooling / MCP notes (important for the next Claude)

- **Supabase MCP** works (execute_sql, apply_migration, logs, advisors). ⚠️ `apply_migration` with **destructive statements** (`drop …`, `delete`, sometimes `drop … if exists`) needs a user confirmation prompt that has **timed out (180 s) repeatedly**. Workarounds: write drop-free migrations (new function names instead of `drop function`, no `drop … if exists` for things that don't exist), or give the user the SQL to run in **Supabase → SQL Editor**.
- **Vercel MCP**: works for this project when called with `projectId` (list_deployments, filter_project_envs, create_project_env, edit_project_env, update_project, create_deployment for redeploys). ❌ `list_projects` with the team id, runtime logs and `web_fetch_vercel_url` return **403** (scope "garagemonline" not authorized for logs). Ask the user for error messages/digests when the site errors. No delete-env tool (rename instead).
- **GitHub**: Claude can't push from the sandbox (session not bound to the repo). Delivery pattern used so far: copy changed files into the user's folder via the **remote-devices bridge** (`device_commit_files`, folder `C:\Users\joao_\repo` was granted), then the user runs `git add -A; git commit; git push` → Vercel auto-deploys. There is **no `device_bash`** on his machine (can't run commands there; can't delete files → overwrite with a stub and tell him to `git rm`).
- Sandbox egress blocks `data-api.playerelo.football` and `*.vercel.app` → PlayerElo imports must run on **his PC**; Claude can't fetch the live site.
- **PowerShell gotcha:** `npm run script -- --flag` loses the `--`, and `94,95` becomes an array. Use **`npx tsx scripts/… --flag "a,b,c"`** directly with quoted lists.

---

## 4. Tech stack & architecture

- **Next.js 15 (App Router) + TypeScript + Tailwind v4**, React 19, on **Vercel** (Hobby: cron 1×/day, 300 s functions).
- **Supabase**: Postgres + Auth (+ RLS). App DB access via **`pg`** with per-request role impersonation (`set local role authenticated` + `request.jwt.claims`) so **RLS and `auth.uid()` apply** (`src/server/pg.ts`, `db.ts`: `withUser`, `withService`). Pool config strips `sslmode/supa/pgbouncer` params and uses TLS without CA pinning (`src/server/pg-config.ts`; `resolveDbUrl()` = `SUPABASE_DB_URL || POSTGRES_URL`).
- **All writes go through SECURITY DEFINER SQL functions** (user commands check `auth.uid()`/membership); clients have **no table write grants**; `anon` executes nothing; allow-list grants to `authenticated`. Column grants hide `potential_cap` & `hidden_development_rate` (only `potential_band` A–E visible). Invite codes 16 chars, stored as sha256.
- Auth: Supabase (`@supabase/ssr`), plus a **dev auth adapter** (`AUTH_MODE=dev`, refused on Vercel/production unless `ALLOW_DEV_AUTH_IN_LOCAL_PROD=1` locally) used for local E2E.
- **Matchday integrity:** lease (`processing_lease_until`, `processing_round`), fixture row lock + status check (exactly-once), idempotent ledger (`idempotency_key`), version-checked player updates, lock order player→offer→clubs, offer reservations (`reserved_cents`).
- **Determinism:** RNG xmur3+sfc32, seed `gameId|s{season}|r{round}|{fixtureId}`, canonical JSON + sha256 `input_hash`, stored in `match_runs` (`simulation_version`, `input_snapshot`).
- Cron: `vercel.json` → `/api/cron/process` daily `0 19 * * *` (Bearer `CRON_SECRET`). Manual "Jogar jornada" button for the owner. `/api/health` reports DB status.

### Key folders
```
supabase/migrations/      0001 catalog … 0009 pin_search_path, 0010 squad_revamp
supabase/local/00_supabase_shim.sql   (test-only auth schema/roles)
supabase/seed.sql         fictional catalog + snapshot
scripts/db/local-reset.sh, scripts/db/gen-lineup-sql.ts (generates SQL lookup fns from TS)
scripts/playerelo/{discover,preview,import,resume,audit,finalize}.ts
scripts/sim-calibration/{quick,calibrate,seasons,formations}.ts
src/engine/  common/(rng,hash,types) lineup/(formations,roles,autopick) match/(engine,config,types,fixtures)
             rating/initial-rating.ts  progression/  economy/  league/(round,simulate)
src/integrations/ playerelo/(client 9 req/min, schemas, normalize, importer)  catalog/(snapshot, synthetic)
src/server/  env, db, pg, pg-config, auth, queries, squad-view, actions/index.ts, services/(create-game, matchday)
src/components/ ui, squad/(hub, pitch, editor, player-panel, list-view, depth, instructions, formation-picker, avatar, types), …
src/app/     /, /auth, /dashboard, /games/new, /join/[code], /g/[gameId]/(overview, squad, tactics, fixtures, table,
             market, finances, settings, matches/[fixtureId], players/[playerId]), /admin/import, /api/cron/process, /api/health
tests/       unit (src/**/*.test.ts), integration (real Postgres: game-flow, playerelo-import, sql-ts-parity, squad-v11), e2e (Playwright)
docs/        architecture, data-contract, data-licensing, game-balance, deployment, costs, decisions, operator-guide
```

### Engine summary
- **Ratings (initial-rating-v1):** PlayerElo Elo → OVR via **global-rank anchors** (`data/playerelo-anchors.json`, from `discover --anchors`), fallback robust logistic; EAR/market adjustments capped ±1.5; potential bands; position-default profiles.
- **Match engine `match-v1.1.0`** (`ENGINE_VERSION`): possession-based; units control/attack/defense/keeper from weighted effective ratings; tactics (mentality, tempo, pressing, line, width, passing, transitions) with trade-offs; consistent stats/events/xG/ratings. Calibrated: ~2.8 goals for equal teams, ~28% draws, xG calibrated.
- **v1.1 additions:** 17 formations with explicit layouts + **formation shape effects** (line weights def×1.4 / mid×1.15 / att×1.55 vs 4-3-3; width affects headers) — round robin PPG 1.32–1.39 (balanced). **~30 roles** (`roles.ts`, neutral defaults, small trade-offs, |ΔPPG| ≤ 0.04). **Captain** (+0.25..0.5 pts while on pitch). **Penalty/free-kick/corner takers**. **Positional fit** `slotFit`: generalist 0.97 in group, specialist (preferred slot) 1.0 + RELATED table, familiarity (+4.5/90 min, closes 80% of gap), auto-specialisation at familiarity 25 (never overrides manager choice; manager can set preferred slot once/season).
- **Progression-v1:** EWMA form, fitness/morale/sharpness, XP → OVR only at checkpoints every 4 rounds (±1), age-based development disabled when age unknown (PlayerElo gives no ages).
- **Economy-v1:** wages, gate, sponsorship, result bonuses, prize money, smoothed revaluation.

---

## 5. Current state (verified)

### Supabase (remote)
Applied migrations: catalog, game_core, market_economy_audit, rls, internal_helpers, user_commands a/b/c, server_commands a/b, function_privileges, pin_search_path, **squad_revamp_a** (formation_slots ×17, slot_roles, preferrable_slots, new player columns `preferred_slot`, `preferred_slot_season`, `position_familiarity`, `shirt_number`, shirt-reset trigger, `tactic_presets` + RLS, `_apply_player_updates` v1.1, **`save_lineup_v2`** (5 args incl. instructions), `set_preferred_slot`, `set_shirt_number`, `auto_number_squad`, `save_tactic_preset`, `archive_tactic_preset`). The **tactics formation check constraint was updated** (now `formation_slots(formation) is not null`) — user ran it.
- ❗ **`leave_game(uuid)` is still NOT in the remote DB** (has a `delete` → confirmation timeout). The repo migration 0010 contains it. Next time: give the user the SQL from `supabase/migrations/20261015000010_squad_revamp.sql` (leave_game section + `grant execute … to authenticated`) to paste in the SQL Editor.
- Note: the repo's 0010 file is the canonical version (uses `save_lineup_v2`, keeps the old 4-arg `save_lineup`). Remote applied it in pieces; schema is equivalent except leave_game.

### Data
- Real dataset finalized: **snapshot `b42ced22-0944-4ef3-8968-5a80c971e289` "Época 26/27"**, 7 550 players, 246 clubs, 12 leagues: 94 Primeira Liga, 95 Segunda Liga, 39 Premier League, 40 Championship, 140 La Liga, 135 Serie A, 78 Bundesliga, 61 Ligue 1, 144 Belgium Pro League, 71 Brazil Série A, 103 Eliteserien, 128 Argentina Liga Profesional. Reference: global anchors. Top: Lamine Yamal 92, Haaland 91, Pedri 91. League medians: PL 81 … Segunda Liga 60 (PlayerElo is team-result driven → dominant clubs inflated; accepted).
- PlayerElo free tier: **500 requests/month** (resets 1st of month), 10/min, **max 75 players per page** (import with `--page-size 75`). ~150 used in October. Listing gives only name, coarse position (GK/DEF/MID/ATT), Elo, EAR label, club, league — **no photos, ages, nationality, values, detailed positions**.
- Games: **"Liga de Teste Joao"** (Primeira Liga, active, matchday 1 played, 2 members). 2 auth users. Joao's profile `a8ace7fa-e138-493e-9882-b0c9f5616f8b` is **admin**.

### Code
- Latest work (squad hub revamp + engine v1.1) was **copied into the user's repo folder**; he was told to run:
  ```powershell
  cd C:\Users\joao_\repo\touchline\touchline
  git rm -q src/components/tactics-board.tsx
  npm install
  git add -A
  git commit -m "feat: new Plantel - drag and drop, 17 formations, roles, captain, presets"
  git push
  ```
  **Verify** with Vercel `list_deployments` (projectId above) that a deployment newer than commit `5e62f2b` is READY, and ask him whether /squad works. New dep: `@dnd-kit/core@6.3.1`.
- Tests at hand-off: unit 45 ✓, integration 33 ✓, E2E (desktop happy path with drag & drop + mobile tap-to-place) ✓, typecheck/lint ✓, `next build` ✓.

### New Plantel / Tática UI (`src/components/squad/*`)
Tabs **Equipa / Instruções / Lista / Profundidade** (both `/squad` and `/tactics` render the hub; `?tab=`).
Pitch with dnd-kit (Mouse+Touch+Keyboard sensors, `pointerWithin`, reduced autoscroll) + tap-to-place; fit rings (green ≥97%, amber ≥90%, red); effective rating per slot; strength bars (same code path as engine via `previewTeamStrength`) with delta vs saved; warnings; auto-pick modes (best/rest/rotate); undo/redo (Ctrl+Z); unsaved-changes guard; sticky save bar ("Guardar escalação"); bench ≤9 + "Não convocados"; player panel (role picker per slot, captain/takers toggles, preferred position once/season, familiarity bars, shirt number, last-5 ratings sparkline, stats, value/wage/contract); formation picker with thumbnails; presets (max 8, archive instead of delete); sortable list with column chooser + compare 2 players; depth chart; deterministic SVG avatars, generated club badges, shirts in club colours.

---

### UI v2 (branch `feat/ui-1-foundation`, 2026-10-17)

- Direction approved by Joao: **"Matchday editorial"** (not neon), one fixed brand colour (Touchline blue `#3a5bf0`), **Archivo** only, **dark theme default** + light theme. Plan doc "Touchline — UI Revamp Plan" and clickable mock "Touchline — Hoje & Match Centre mock" (Claude artifacts).
- Foundation done: theme tokens, game shell (rail, context bar, five-hub dock, "Por decidir" drawer, ⌘K palette), flat OVR tiers. Next branches: `feat/ui-2-daily` (Hoje hero + inline decisions, Equipa), `feat/ui-3-matchday` (match centre replay, Liga), `feat/ui-4-club-social`.
- See `docs/design-system.md`; `tests/e2e/screens.spec.ts` screenshots every route in both themes at 360/1440.

## 6. How to run things

**Local (on user's PC, for CLI only):**
```powershell
cd C:\Users\joao_\repo\touchline\touchline
npm install
# DB connectivity test (doesn't spend PlayerElo quota):
node -e "require('dotenv').config({path:'.env.local',quiet:true});const{Client}=require('pg');const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query('select 1')).then(()=>{console.log('DB OK');c.end()}).catch(e=>{console.log('FAIL',e.message);c.end()})"
npx tsx scripts/playerelo/discover.ts --anchors
npx tsx scripts/playerelo/import.ts --leagues "94,39" --page-size 75 --max-requests 200
npx tsx scripts/playerelo/audit.ts --leagues "94,39"
npx tsx scripts/playerelo/finalize.ts --leagues "94,39" --label "Nome"
```
Finalize inserts row-by-row (~3–6 min for 7.8k players; silent until done).

**Sandbox (Claude):** local Postgres 16 on port 54322 (`su claude -c "/usr/lib/postgresql/16/bin/pg_ctl -D /home/claude/pgdata/data -o '-p 54322 -k /tmp' -l /home/claude/pgdata/log start"`), `scripts/db/local-reset.sh touchline_test|touchline_dev`, `npm run seed:synthetic`, `npx vitest run src tests/unit`, `npx vitest run tests/integration`, build + `ALLOW_DEV_AUTH_IN_LOCAL_PROD=1 npx next start -p 3100`, E2E: `E2E_BASE_URL=http://localhost:3100 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test`. Kill stale servers by PID (`ps aux | grep next-server`), never `pkill -f "next start"`. Calibration: `npm run sim:quick`, `npx tsx scripts/sim-calibration/formations.ts 150 2000`.
If the sandbox is fresh, clone isn't possible (no repo binding) — stage files from the user's folder via the device bridge, or rebuild from GitHub if he makes it accessible.

**Deploy flow:** apply DB migration first (remote, drop-free or via SQL Editor) → copy files to user's folder → user commits & pushes → Vercel builds → check deployments → ask user to test. Keep old SQL signatures working during rollout (old code may run against new DB).

**PR rules (mandatory — `CONTRIBUTING.md`):** every PR declares a risk level; any PR with a migration (or High risk) must have a filled **Rollback plan** (code + database SQL or "forward-fix only" + why + data + point of no return) — the CI check *Migration PRs have a rollback plan* fails otherwise. Migrations are additive/backward compatible, numbered after the latest on `main` and open PRs, and applied after a backup. Performance PRs show before/after metrics, method and expected production impact. Never merge on red CI.

---

## 7. Supabase Auth settings (user did / should check)
- URL Configuration: Site URL = `https://touchline-garagemonline.vercel.app`; Redirect URLs include `https://touchline-garagemonline.vercel.app/auth/callback` (and the sigma-seven alias if used).
- Recommended for friends: **Confirm email OFF** (built-in mailer is rate-limited/spammy). A friend couldn't sign up earlier (only 1 account existed then; now 2 users).
- Joining a league needs **no approval** — invite link → sign up/in → "Aceitar convite" → pick club. Owner starts the league in Definições; unpicked clubs are AI.

---

## 8. Backlog / ideas (not done yet)
1. **Apply `leave_game`** to remote (SQL Editor).
2. Verify the squad-hub deploy on the live site; collect user feedback; possibly polish mobile toolbar layout.
3. Matchday experience: pre-match checklist + deadline countdown; rotation hints; post-match ratings in the hub.
4. Match view: richer replay/commentary using roles/captain/takers events.
5. Transfer market UX (search/filter across leagues, shortlist, scouting), contract renewals, youth/regens (ages unknown from PlayerElo — design needed).
6. Season flow: end-of-season awards, promotion/relegation between leagues in the snapshot (currently one league per game).
7. Notifications (email/push) for deadlines and results; cron is daily only on Hobby.
8. Admin: data refresh (re-import monthly within 500-request quota), delete unused Vercel env leftovers.
9. Rename/brand (name still provisional), landing page polish.
10. Consider per-player profiles beyond position defaults (PlayerElo per-player endpoint costs 1 request/player — too expensive on free tier).

---

## 9. Lessons / gotchas log
- First deploy failed because Vercel built an older commit (missing POSTGRES_URL fallback) → always check the deployed commit SHA.
- DB password confusion: `aws-1` host; reset password → must resync Vercel integration + redeploy.
- Vercel resync failed because manually created `NEXT_PUBLIC_SUPABASE_*` vars collided with integration vars → renamed manual ones to `UNUSED_MANUAL_*`.
- PlayerElo pagination cap 75 → importer treats a short page as the end; always pass `--page-size 75`.
- PowerShell eats `--` in `npm run` → call `npx tsx` directly with quoted comma lists.
- dnd-kit autoscroll near viewport edges made drags flaky → reduced threshold; right column is sticky + internally scrollable on desktop.
- MCP `apply_migration` confirmation timeouts for destructive SQL → prefer additive changes.
