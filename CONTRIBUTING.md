# Contributing to Touchline

How changes get into `main`. These are **project rules**, not suggestions: the PR template follows them and CI enforces
the ones it can. Applies to everyone, including AI-assisted sessions (see `docs/HANDOFF.md`).

Context that shapes the rules: merging to `main` **deploys to production** (Vercel), while **database migrations are
applied by hand** (Supabase SQL Editor / MCP). Friends are playing live leagues; a bad deploy breaks their matchday.

---

## 1. Every PR

- **One purpose per PR.** Don't mix a refactor, a feature and a migration. Small PRs are reviewed better and revert cleanly.
- **Title:** `type(scope): summary` — `feat`, `fix`, `perf`, `test`, `ci`, `docs`, `chore`, `refactor`.
- **Fill in the template** (`.github/pull_request_template.md`). Delete sections that don't apply; never leave placeholders.
- **CI must be green before merging. Never merge on red** — not even "it's unrelated". A red `main` hides the next real
  failure (an engine version bump on 2026-10-15 without its golden snapshot kept `main` red through five PR merges, #10–#14).
- **Self-review the diff** before asking for review, and say how you tested it with evidence (commands + results).

## 2. Risk level

Pick one in the PR. When in doubt, go one level up.

| Level | Examples in this project | What it requires |
|---|---|---|
| **Low** | Copy/UI tweaks, docs, tests only, isolated components | Template + green CI |
| **Medium** | New pages or server actions, query changes, new dependencies (minor), cron/job logic that doesn't touch money | + E2E run, reviewer looks at "How to test" |
| **High** | **Any migration**; RLS, grants or `SECURITY DEFINER` functions; auth, session or middleware; matchday processing, ledger/money, transfers; engine version bumps; env vars/secrets; `vercel.json`, CI, deploy config; major dependency upgrades; anything that deletes or rewrites data | Everything in [§3](#3-high-risk-prs) |

## 3. High-risk PRs

All of these, in the PR description:

1. **Blast radius** — who/what breaks if this is wrong (all leagues? one page? money?), and whether it is reversible.
2. **Rollback plan** — mandatory, see [§5](#5-rollback-plan). For migrations CI fails without it.
3. **Deployment plan** — ordered steps (e.g. *backup → apply migration → merge → verify*), who runs each, and timing.
4. **Post-deploy verification** — what you check and for how long: `/api/health`, one real flow (open a league,
   save a lineup, process a matchday if relevant), logs for `matchday.failed`, `action.failed`, `page.failed`, and the next cron run.
5. **Evidence of testing** — full suite (`npm run test:coverage`), E2E on a production build (`npm run build` + `npm run test:e2e`),
   and for SQL changes a run of `npm run db:local:reset` from scratch.
6. **A reviewer other than the author** approves before merge.

Prefer shipping risky behaviour behind a setting or flag (`games.settings_json`, an env var) so it can be switched off
without a deploy. **Don't deploy high-risk changes** right before the daily cron (`0 19 * * *` UTC), while a matchday is
processing, or when you can't watch the deploy for ~30 minutes.

## 4. Database migrations

- **New file only.** Never edit a migration that is on `main`; write a new one.
- **Number it after the latest migration on `main` *and* in open PRs** (`supabase/migrations/YYYYMMDDNNNNNN_name.sql`),
  so two branches never collide.
- **Additive and backward compatible (expand → migrate → contract).** The code currently in production must keep working
  against the new schema, because the migration is applied before the code deploys:
  - add columns/tables/functions; keep old function signatures working (new name or new overload instead of changing one);
  - destructive steps (`drop`, rename, type change, `not null` on existing data) go in a **later** PR, after nothing uses the old shape.
- **Order of operations:** backup → apply migration to production → verify → merge the code → verify again.
- **Backup first.** The Supabase Free plan has no automatic backups: take one before applying
  (`pg_dump "$SUPABASE_DB_URL" -Fc -f backup-$(date +%F).dump`, see `docs/operator-guide.md`). Say in the PR that you did.
- **Security invariants:** new tables get `enable row level security` + explicit grants, new functions pin `search_path`
  and only grant `EXECUTE` where needed. The integration tests check this — they must pass.
- **Locks:** keep statements short. On tables that grow every matchday (`match_events`, `match_player_stats`,
  `club_ledger`, …) avoid rewriting the table; once they are large, create indexes `concurrently` in their own migration.

## 5. Rollback plan

Required for **every PR with a migration** (CI check *Migration PRs have a rollback plan*) and every high-risk PR.
"Revert the PR" is not enough when the database changed. Cover:

| Part | What to write |
|---|---|
| **Code** | How to get the previous app back: Vercel → Deployments → previous deployment → *Instant Rollback* (fastest), or `git revert` the merge commit. |
| **Database** | The exact SQL that undoes the migration (tested locally), **or** "forward-fix only" and why it is safe to leave in place. |
| **Data** | Whether rollback loses data written after the deploy, and how to restore it (backup taken in §4). |
| **Point of no return** | When rollback stops being safe (e.g. "after players save lineups in the new format"). |

Example (index-only migration):

```markdown
## Rollback plan
- **Code:** Vercel Instant Rollback to the previous deployment; app code does not depend on the indexes.
- **Database:** not required (indexes only, no behaviour change). If needed:
  `drop index if exists public.mps_club_idx, public.lineups_fixture_idx, …;`
- **Data:** no data changes.
- **Point of no return:** none.
```

## 6. Performance changes

A PR that claims to make something faster must show it:

- **Baseline and after**, measured the same way (same flow, same data, production build — not `next dev`).
- **Method** — how you measured (script, tool, what was counted) so someone else can repeat it.
- **Expected production impact**, with the assumptions written down (e.g. latency per DB round trip in `cdg1` → `eu-west-3`).
  Keep it separate from what you measured.
- **How to verify after deploy** — e.g. browser Network tab, Vercel Observability / Speed Insights, function invocation counts.

## 7. Other areas

- **Game engine:** results-changing edits bump the version constant, record the golden snapshot
  (`npx vitest run -u src/engine/golden.test.ts`) and check calibration (`docs/game-balance.md`). Never update a snapshot under an unchanged version.
- **Env vars / secrets:** never in code or PRs. New variables go in `.env.example` and `docs/deployment.md`, and are set in
  Vercel **before** merging code that needs them.
- **Dependencies:** one major upgrade per PR, with the breaking changes from its changelog listed in the description.
  Keep `next` and `eslint-config-next` on the same version.
