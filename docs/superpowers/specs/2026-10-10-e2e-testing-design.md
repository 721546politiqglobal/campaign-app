# End-to-End Test Suite & Launch-Readiness Audit — Design

**Date:** 2026-10-10
**Branch:** feat/ui-ux-revamp
**Status:** Approved in chat; awaiting written-spec review

## Goal

Before production launch, give the owner confidence that every user-facing
feature works, for every role, in both languages — and keep that confidence on
every change. Two outputs:

1. **A permanent Playwright E2E suite** that runs locally (`npm run e2e`) and
   as a required CI check on every PR.
2. **A one-time launch-readiness audit** — every bug, gap, and blocker found
   while writing the suite, logged with severity in
   `docs/e2e/launch-readiness.md`.

### Decisions made (by the owner)

| Question | Decision |
|---|---|
| Test database | Dedicated cloud Supabase project `pckrdspetqcdbmcrqapx` (no Docker), wiped and rebuilt every run by `e2e/reset-db.ts`. Never production. |
| Third-party vendors | All mocked via `ALLOW_MOCK_PROVIDERS=true`; Stripe exercised in test mode with signed fake webhooks; an optional manual `e2e:live` smoke suite |
| Bugs found | Report first (test marked `test.fail()` + logged), then fix together in a separate TDD pass |
| Commits | Owner reviews and commits everything; no autonomous commits |

### Non-goals

- Proving zero bugs (impossible); the target is that every user-facing flow is
  exercised and regressions become visible.
- Real vendor behaviour (HeyGen render quality, Ayrshare per-platform rules) —
  only covered by the manual live smoke.
- Load / performance testing.
- Replacing the existing 723 Vitest unit tests; they stay as-is.

## Architecture

```
e2e/reset-db.ts (pg over E2E_DATABASE_URL) ──► drop+recreate public schema,
                                                 apply 44 migrations + e2e/seed.e2e.sql
                                       │
next build && next start  ◄────────────┘  env: .env.e2e (local Supabase URL/keys,
   (port 3100, NODE_ENV=production,         ALLOW_MOCK_PROVIDERS=true, test secrets,
    ALLOW_MOCK_PROVIDERS=true)              Stripe test keys if present)
                                       │
Playwright (Chromium desktop + Pixel 7 mobile project)
   ├─ global-setup.ts: safety check, db reset, log in each role → e2e/.auth/<role>.json
   ├─ fixtures.ts: per-role pages, console/network-error guard, axe helper, db helper
   └─ specs/*.spec.ts (one file per area)
```

**Why a production build:** `src/lib/services.ts` switches behaviour on
`NODE_ENV`; dev mode would hide production-only bugs.

### Files

| Path | Purpose |
|---|---|
| `e2e/reset-db.ts` | Docker-free reset: connects with `pg`, refuses to run unless the project ref is in the `E2E_ALLOWED_REFS` allow-list (hard-coded `pckrdspetqcdbmcrqapx`), drops & recreates `public`, applies `supabase/migrations/*.sql` in order, then `e2e/seed.e2e.sql`, then `NOTIFY pgrst, 'reload schema'` |
| `e2e/seed.e2e.sql` | Deterministic E2E fixtures (see Seed data) |
| `e2e/.env.e2e.example` | Template env for E2E runs (committed); `.env.e2e` gitignored |
| `playwright.config.ts` | Projects, webServer, retries (0 local / 1 CI), trace-on-failure |
| `e2e/global-setup.ts` | DB reset + seed, per-role `storageState` |
| `e2e/fixtures.ts` | Extended `test` with role pages, error guard, `db` (service-role client), `axe` |
| `e2e/helpers/*.ts` | Small focused helpers: `stripe-webhook.ts` (signed events), `cron.ts`, `content.ts` (create-content-to-state shortcuts via UI) |
| `e2e/specs/*.spec.ts` | Specs per area (Coverage map) |
| `e2e/live/*.spec.ts` | Manual live-vendor smoke, excluded from default run |
| `docs/e2e/launch-readiness.md` | Audit findings |
| `.github/workflows/ci.yml` | New `e2e` job |
| `package.json` | `e2e`, `e2e:ui`, `e2e:live`, `e2e:db` scripts; `@playwright/test`, `@axe-core/playwright` devDeps |

### Seed data (`e2e/seed.e2e.sql`)

Fixed IDs, all passwords `e2e-pass-123`:

- **Campaign A** (`e2e-camp-a`, jurisdictions US-FEDERAL + US-CA, active paid
  plan): `owner-a`, `manager-a`, `approver-a`, `staff-a`, plus seeded content in
  each lifecycle state, monitoring items, analytics metrics, a social profile.
- **Campaign B** (`e2e-camp-b`, US-TX, free/no plan): `owner-b`, one content
  item — used only for tenant-isolation tests.
- **Super admin** `admin-e2e` (no campaign).
- Invite codes: one valid, one used, one expired.
- A locale=`es` user (`staff-es-a`) for Spanish flows.

Exact column sets are taken from the migrations at implementation time; the
seed is applied after migrations by `e2e/reset-db.ts`.

### Test isolation

- DB reset once per full run (global setup), not per test — too slow.
- Because the DB is shared cloud state, two runs must not overlap: CI uses a
  `concurrency: e2e-db` group so only one E2E job runs at a time.
- Files run in parallel; tests inside a file run serially when they share state.
- Every test that mutates creates its own records with a unique suffix
  (`e2e-${testInfo.testId}`) or uses records reserved for that spec file in the
  seed. No spec mutates another spec's records.
- Login-flow tests use dedicated users so throttle lockouts can't break other
  specs.

### Cross-cutting guards (automatic in every test)

- **Console/network guard:** the fixture fails the test on any `console.error`,
  uncaught page error, or same-origin response ≥ 500. Known-benign messages are
  allow-listed explicitly with a comment.
- **Missing-translation guard:** fails if page text contains raw next-intl keys
  (e.g. `namespace.key` patterns / next-intl's missing-message output).
- **Accessibility:** `axe` scan on every page in the page-sweep spec; serious/
  critical violations fail; lower severities logged to the report.

## Coverage map

One spec file per area. "Both layers" means the forbidden action is checked in
the UI (control absent/disabled) **and** by invoking it anyway (direct URL,
form post, or API call) to prove the server rejects it.

| Spec | Covers |
|---|---|
| `auth.spec.ts` | Login success per role; wrong password; unknown email; throttle lockout after N failures; logout clears session; tampered session cookie rejected; every protected page redirects to login when logged out; `/join` with valid / used / expired / garbage invite code |
| `permissions.spec.ts` | Data-driven matrix built from `src/lib/permissions.ts`: every role × every page and every gated action, both layers |
| `tenant-isolation.spec.ts` | Campaign A users cannot read/modify Campaign B content, avatars, monitoring, analytics, team, billing via URL IDs, server actions, or `/api/*` |
| `content-lifecycle.spec.ts` | Create manually; AI draft (mock); save; submit; approver approves / rejects with reason; staff cannot approve; disclosure attach (from jurisdictions); schedule with timezone; publish now; each gate blocks when out of order and the gate strip explains why; edit after approval resets approval; activity log records every step; content list filters/search |
| `video-avatars.spec.ts` | Photo avatar create, video avatar create, digital twin, consent pending/approved/declined display, status polling to completed/failed, delete, plan feature limits block creation, generate avatar video on content, video status display |
| `voice.spec.ts` | Voice clone via file upload; live recording (Chromium fake media device); preview playback; HeyGen voice assignment; limits |
| `channels.spec.ts` | Connect / disconnect social accounts per campaign (mock Ayrshare), publishing only offers connected platforms |
| `monitoring.spec.ts` | `/api/monitoring/ingest` rejects missing/bad secret, accepts valid payload, dedupes repeats; credibility shown; opponent config edit; dashboard highlights; `/api/monitoring/campaigns` auth |
| `analytics.spec.ts` | Seeded metrics render; empty state for Campaign B; `/api/cron/sync-analytics` requires `CRON_SECRET` and updates metrics |
| `billing.spec.ts` | Pricing page; checkout creates a Stripe test session and redirects to `checkout.stripe.com` (skipped with a clear message if no test key); signed webhooks: subscribe, upgrade, cancel, out-of-order events, bad signature rejected; plan limits enforced after downgrade; billing portal redirect; metered/feature usage counters |
| `team-settings.spec.ts` | Invite member, change role, remove member, last-owner protection; profile edit + validation; locale switch persists; theme switch persists; candidate profile |
| `admin.spec.ts` | Admin dashboard, users, campaigns list + filters + tags, campaign detail, content, billing, audit log; every admin page blocked for non-super_admin |
| `cron-api.spec.ts` | `/api/cron/publish`: due items publish, future items don't, failed publish surfaces status, secret required; `/api/heygen/avatars`, `/api/elevenlabs/voices` auth + shape |
| `i18n.spec.ts` | Core flows (login, create → approve → schedule) in Spanish; pre-auth language toggle on landing/login/join; every page in `es` has no missing keys |
| `page-sweep.spec.ts` | Visits every page as each permitted role, desktop + mobile: renders, no errors, no horizontal overflow on mobile, axe scan |
| `setup-landing.spec.ts` | Landing page, `/setup` onboarding flow, demo video modal |

The coverage map is a floor, not a ceiling: while implementing each spec, the
implementer reads the page/action code and adds tests for every branch a user
can reach (validation messages, empty states, error states).

## Audit & report

`docs/e2e/launch-readiness.md` — one entry per finding:

```
### E2E-012 — <title>                           Severity: blocker | major | minor
Area: content-lifecycle   Test: e2e/specs/content-lifecycle.spec.ts › "…"
Repro: 1… 2… 3…
Expected / Actual
Suspected cause: src/app/actions.ts:123 (…)
```

- Test-exposed bugs: the test is written for **correct** behaviour and wrapped
  `test.fail(true, 'E2E-012')` so the suite stays green while the bug is known;
  when fixed, Playwright flags the now-passing test and the marker is removed.
- Non-test findings (config/migration issues, e.g. two migrations numbered
  `034`, missing env validation, security concerns) are logged too.
- Report ends with a go/no-go summary: count by severity and the blocker list.

Fixes happen in a separate pass after the owner reviews the report.

## CI

New `e2e` job in `.github/workflows/ci.yml` (parallel to `test`):

1. `actions/checkout`, Node 22, `npm ci`
2. Write `.env.e2e` from repo secrets (`E2E_SUPABASE_URL`,
   `E2E_SUPABASE_PUBLISHABLE_KEY`, `E2E_SUPABASE_SERVICE_ROLE_KEY`,
   `E2E_DATABASE_URL`; optional `STRIPE_TEST_SECRET_KEY` /
   `STRIPE_TEST_WEBHOOK_SECRET` — checkout tests skip without them)
3. Job runs under `concurrency: { group: e2e-db, cancel-in-progress: false }`
4. `npx playwright install --with-deps chromium`
5. `npm run e2e`
6. On failure: upload `playwright-report/` and `test-results/` (traces, videos,
   screenshots)

Owner marks the job as a required check in GitHub branch protection.

## Live smoke (manual)

`npm run e2e:live` — `e2e/live/` only, uses real keys from `.env`, never in CI:
AI draft returns text, ElevenLabs voices list, HeyGen avatars list, Ayrshare
profile fetch, Stripe test checkout session. Read-only / cheap calls only — no
video renders, no real posts.

## Prerequisites for the owner

- Provide the test project's service-role key and DB connection string in
  `.env.e2e` (gitignored) and as GitHub secrets for CI.
- Optionally add Stripe test-mode keys to `.env.e2e` and GitHub secrets.

## Risks

| Risk | Mitigation |
|---|---|
| Flaky tests erode trust | No fixed sleeps; web-first assertions; retries=1 in CI only; any flaky test is fixed, not retried away |
| Suite gets slow | Storage-state login, parallel files, single DB reset; target < 10 min in CI |
| Mocks drift from real vendors | Live smoke before launch; existing adapter unit tests |
| Seed drifts from migrations | Reset in every run fails loudly if seed breaks |
| Reset script pointed at prod by mistake | Project-ref allow-list in `reset-db.ts`; refuses any other ref |
| Migrations assume Supabase-managed objects (auth, storage, roles) | Reset only drops `public` (and app-owned storage buckets); Supabase schemas left intact |
