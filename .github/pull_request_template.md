## Summary

<!-- What does this PR change, and why? One or two sentences. Link the issue if there is one (e.g. "Closes #12"). -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behaviour change)
- [ ] Game balance / engine change (match, rating, progression or economy)
- [ ] Database migration
- [ ] CI / infrastructure / tooling
- [ ] Docs only

## Changes

<!-- Bullet list of the main changes, grouped by area if useful. -->

-

## How to test

<!-- Exact steps a reviewer can follow to verify this. Include commands, URLs, test accounts (dev auth) and expected results. -->

1.
2.
3.

**Expected result:**

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
- [ ] The migration is a new file in `supabase/migrations/`; existing migrations were not edited
- [ ] Every new table has `enable row level security` plus explicit grants (the invariant tests pass)
- [ ] New functions pin `search_path`, and `EXECUTE` is only granted where needed
- [ ] The migration is safe to run on existing data and was tested with `npm run db:local:reset`

### Game engine (skip if no engine change)
- [ ] I bumped the relevant version (`ENGINE_VERSION`, `INITIAL_RATING_VERSION`, `PROGRESSION_VERSION`, `ECONOMY_VERSION`) if results change for the same seed and input, and recorded the new golden snapshot (`npx vitest run -u src/engine/golden.test.ts`)
- [ ] I ran `npm run sim:quick` / `sim:calibrate` and the key metrics stay within the bands in `docs/game-balance.md`

### Security
- [ ] No secrets, keys or real credentials in code, tests, fixtures or logs
- [ ] No server-only value uses the `NEXT_PUBLIC_` prefix
- [ ] User input is validated (zod) and mutations go through authenticated server actions or SQL commands

## Deployment notes

<!-- Anything needed to ship this: new env vars, migrations to apply, data backfills, ordering. Write "None" if nothing. -->

- **New / changed env vars:**
- **Migrations to apply:**
- **Rollback plan:**

## Reviewer notes

<!-- Optional: where to focus, known limitations, follow-ups left for later. -->
