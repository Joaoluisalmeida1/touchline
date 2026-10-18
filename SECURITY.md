# Security

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private reporting: **Security → Report a vulnerability** on this
repository. Include what you found, how to reproduce it and the impact. You'll get an answer within a few days.
Never test against other players' accounts or leagues.

## How the app is protected

| Area | Control | Where |
|---|---|---|
| Authorization | Row Level Security on every table; all writes through `SECURITY DEFINER` SQL commands; server-only commands not executable by users — enforced by integration tests | `supabase/migrations/0004…`, `tests/integration/sql-ts-parity.test.ts` |
| Game integrity | Matches, money and ratings decided only on the server; idempotent, lease-protected matchday processing | `docs/architecture.md` |
| Sessions | Supabase Auth; JWT verified with `getClaims()`; dev auth adapter refused on Vercel/production | `src/server/auth.ts`, `src/server/env.ts` |
| Abuse | Rate limits on sign-in (per IP and per email), sign-up (per IP) and joining leagues (per user), stored hashed | `src/server/rate-limit.ts`, migration `0018` |
| Browser | CSP (`frame-ancestors`, `form-action`, `base-uri`, `object-src`), `X-Frame-Options`, `nosniff`, strict referrer, `Permissions-Policy`; HSTS from Vercel | `next.config.ts` |
| Secrets | Server-only env vars, never `NEXT_PUBLIC_`; CI checks the client bundle for leaked values; constant-time cron secret check | `.github/workflows/ci.yml`, `src/app/api/cron/process/route.ts` |
| Database link | TLS to Supabase; certificate verification when `SUPABASE_DB_CA` is set | `src/server/pg-config.ts`, `docs/deployment.md` |
| Data at rest (backups) | Nightly backups encrypted with `age` before upload; private key kept offline | `.github/workflows/backup.yml` |
| Supply chain | Dependabot updates; CodeQL (`security-extended`); runtime `npm audit` gate (fails on critical) | `.github/` |
| Logs | Structured error logs without query strings (invite codes, tokens) | `src/instrumentation.ts` |

## Accepted risks (reviewed 2026-10-18)

| Risk | Why it is accepted | Plan |
|---|---|---|
| High advisory in the PostCSS copy bundled by Next 15 | Used at build time on our own CSS, not on user input; the only fix is Next 16 (major) | Next 16 upgrade PR |
| CSP has no `script-src` | A script policy in Next needs per-request nonces; a mistake breaks the whole app | Nonce-based CSP together with the Next 16 upgrade |
| DB certificate not verified until `SUPABASE_DB_CA` is set | Turning verification on must be tested on a Preview deployment first | Rollout steps in `docs/deployment.md` |
| League members can see rival clubs' cash and wage bill | Product decision pending (`game_clubs` is member-readable; the ledger is private) | Decide with the game owner |

## Settings that live outside the code

Check these once per environment; they can't be enforced from the repository.

**GitHub (Settings)**
- [ ] Branches → protect `main`: require a pull request, require status checks (*Lint + unit tests*, *All tests + coverage*, *Build + typecheck + E2E*, *Dependency audit*, *Migration PRs have a rollback plan*, *CodeQL*), block force pushes
- [ ] Code security → **Secret scanning** and **Push protection** on
- [ ] Code security → **Private vulnerability reporting** on (used by the section above)
- [ ] Code security → **Dependabot alerts** on

**Supabase (Dashboard)**
- [ ] Project Settings → JWT Keys → asymmetric signing keys
- [ ] Authentication → Providers → Email: **Confirm email** on; minimum password length ≥ 8; **Leaked password protection** on
- [ ] Authentication → URL Configuration: only the production and Preview URLs as redirect URLs
- [ ] Database → SSL Configuration: download the certificate for `SUPABASE_DB_CA`

**Vercel**
- [ ] Environment variables: no secret with the `NEXT_PUBLIC_` prefix; `AUTH_MODE` not set
- [ ] `SUPABASE_DB_CA` set (after the Preview check)
