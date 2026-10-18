<!-- Rules: CONTRIBUTING.md. Delete sections that don't apply; never leave placeholders. -->

## Summary

<!-- What does this PR change, and why? One or two sentences. Link the issue if there is one (e.g. "Closes #12"). -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behaviour change)
- [ ] Performance
- [ ] Game balance / engine change (match, rating, progression or economy)
- [ ] Database migration
- [ ] CI / infrastructure / tooling
- [ ] Docs only

## Risk

<!-- CONTRIBUTING.md §2. When in doubt, go one level up. High = any migration, RLS/grants, auth/middleware, money/matchday,
     engine version, env vars, deploy/CI config, major dependency upgrades, data rewrites. -->

- [ ] Low
- [ ] Medium
- [ ] High — blast radius: <!-- who/what breaks if this is wrong, and is it reversible? -->

## Changes

<!-- Bullet list of the main changes, grouped by area if useful. -->

-

## How to test

<!-- Exact steps a reviewer can follow to verify this. Include commands, URLs, test accounts (dev auth) and expected results. -->

1.
2.
3.

**Expected result:**

## Performance impact

<!-- Required for performance PRs (CONTRIBUTING.md §6), otherwise delete. Measured numbers and estimates kept apart. -->

| Metric | Before | After |
|---|---|---|
|  |  |  |

- **Method:** <!-- how it was measured, so it can be repeated (production build, same flow/data) -->
- **Expected production impact:** <!-- estimate + the assumptions behind it -->
- **How to verify after deploy:** <!-- Network tab, Vercel Observability, invocation counts… -->

## Screenshots / recordings

<!-- For UI changes: before / after, desktop and mobile. Delete this section if not applicable. -->

## Author checklist

### General
- [ ] I reviewed my own diff before requesting review
- [ ] I tested the change locally, following the steps in "How to test"
- [ ] `npm run verify` passes (lint, typecheck, unit + integration tests)
- [ ] I added or updated tests that cover this change
- [ ] I ran the E2E tests (`npm run test:e2e`) if routes, forms or server actions changed
- [ ] I updated the docs (`README.md`, `docs/`) if behaviour, setup or commands changed

### Database (skip if no migration)
- [ ] The migration is a new file in `supabase/migrations/`, numbered after the latest on `main` and in open PRs; existing migrations were not edited
- [ ] It is additive / backward compatible: the code currently in production keeps working against the new schema
- [ ] Every new table has `enable row level security` plus explicit grants (the invariant tests pass)
- [ ] New functions pin `search_path`, and `EXECUTE` is only granted where needed
- [ ] The migration is safe to run on existing data and was tested with `npm run db:local:reset`
- [ ] The **Rollback plan** below is filled in (CI checks this) and its SQL was tested locally

### Game engine (skip if no engine change)
- [ ] I bumped the relevant version (`ENGINE_VERSION`, `INITIAL_RATING_VERSION`, `PROGRESSION_VERSION`, `ECONOMY_VERSION`) if results change for the same seed and input, and recorded the new golden snapshot (`npx vitest run -u src/engine/golden.test.ts`)
- [ ] I ran `npm run sim:quick` / `sim:calibrate` and the key metrics stay within the bands in `docs/game-balance.md`

### Security
- [ ] No secrets, keys or real credentials in code, tests, fixtures or logs
- [ ] No server-only value uses the `NEXT_PUBLIC_` prefix
- [ ] User input is validated (zod) and mutations go through authenticated server actions or SQL commands

## Deployment plan

<!-- Ordered steps and who runs them. Write "Merge only" if nothing else is needed. -->

1. <!-- e.g. Backup: pg_dump (docs/operator-guide.md) -->
2. <!-- e.g. Apply migration 0018 in the Supabase SQL Editor -->
3. <!-- e.g. Merge → Vercel deploys -->

- **New / changed env vars:** <!-- set in Vercel before merging -->
- **Post-deploy verification:** <!-- /api/health, one real flow, logs (matchday.failed / action.failed / page.failed), next cron run -->

## Rollback plan

<!-- Required for any migration or High-risk PR (CONTRIBUTING.md §5). "Revert the PR" alone is not enough when the database changed. -->

- **Code:** <!-- Vercel → Deployments → Instant Rollback, or git revert -->
- **Database:** <!-- exact SQL that undoes the migration (tested locally), or "forward-fix only" + why -->
- **Data:** <!-- is anything written after deploy lost on rollback? how to restore? -->
- **Point of no return:** <!-- when rollback stops being safe, or "none" -->

## Reviewer notes

<!-- Optional: where to focus, known limitations, follow-ups left for later. -->
