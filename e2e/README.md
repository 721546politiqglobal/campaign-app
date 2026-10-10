# E2E suite (Playwright)

Browser tests run against a **production build** of the app (`next build && next start -p 3100`, build dir `.next-e2e` via `NEXT_DIST_DIR`, so your `next dev` in `.next` is untouched) talking to a **dedicated Supabase test project**. All vendors (HeyGen, ElevenLabs, LLM, News) are mocked; Ayrshare is served by a local fake. Playwright starts both servers itself.

## Running

| Command | What it does |
| --- | --- |
| `npm run e2e` | Resets the test DB, builds, starts servers, runs everything (desktop + mobile page sweep). |
| `E2E_SKIP_RESET=1 npm run e2e -- e2e/specs/foo.spec.ts` | Skips the DB reset (and browser re-login if the saved logins in `e2e/.auth` are < 6h old). For iterating on one spec. |
| `npm run e2e:ui` | Playwright UI mode. |
| `npm run e2e:db` | Resets/seeds the test DB only (`e2e/reset-db.ts`, `e2e/seed.e2e.sql`). |
| `npm run e2e:live` | Live vendor smoke (see below). Not part of CI. |

Locally an already-running server on `:3100` / `:3199` is reused; in CI (`CI=true`) fresh ones are always started.

## Configuration: `.env.e2e`

Copy `e2e/.env.e2e.example` to `.env.e2e` (git-ignored) at the repo root and fill in the test project's Supabase URL, publishable key, service-role key, and the session-pooler `E2E_DATABASE_URL`. `STRIPE_TEST_SECRET_KEY` is optional; Stripe checkout tests skip without a real `sk_test_` key. Real process env (CI secrets) overrides `.env.e2e`.

`e2e/env.ts` builds the server environment explicitly and blanks every key found in `.env*` files, so nothing from your real `.env` can leak into the E2E server.

## Production-safety guard

The DB is **wiped on every run**. `e2e/reset-db.ts` refuses to run unless the database URL and `NEXT_PUBLIC_SUPABASE_URL` both point at project ref `pckrdspetqcdbmcrqapx` (covered by `e2e/reset-db.guard.test.ts`). `e2e/env.ts` additionally asserts the server URL host. **Never point `.env.e2e` at the project in `.env` (real users).**

## Fake Ayrshare and `AYRSHARE_BASE_URL`

`e2e/fake-ayrshare/server.ts` (127.0.0.1:3199) imitates the Ayrshare endpoints the app uses; the real adapters run unchanged. The seam is `AYRSHARE_BASE_URL` (`src/integrations/ayrshare-base.ts`): unset means the real `https://{app,api}.ayrshare.com/api`; set, calls go to `<base>/{app,api}/api/...`. In production (`NODE_ENV=production`, which the E2E server uses) only loopback URLs are accepted, so a misconfigured env can never send a real key to a foreign host. The E2E env pairs the fake key `e2e-fake-ayrshare-key` with the fake only. Helpers: `e2e/helpers/ayrshare.ts` (inspect requests, set failure modes; always scope with `match` and clear in `finally`).

## Adding a spec

1. Create `e2e/specs/<name>.spec.ts`, importing `test`/`expect` from `../fixtures` (`asRole('owner' | …)` gives a logged-in page from saved storage state).
2. Prefer `getByRole`/`getByLabel` with English labels; web-first assertions only, no fixed sleeps.
3. Do not mutate seeded records. Create throwaway data with a per-test unique key (`test.info().testId.split('-').pop()`), clean up in `finally`, and never assert global counts, so the spec passes when re-run without a reset.
4. Run just your spec with `E2E_SKIP_RESET=1`, then once without it.

## Known bugs: `test.fail` and the report

When a test correctly encodes expected behaviour that the app currently violates, mark it `test.fail(true, 'E2E-NNN: short title')` (Playwright then expects it to fail and flags it if it unexpectedly passes). Every such test, and every `test.skip` reason, needs an entry in `docs/e2e/launch-readiness.md` under Blockers / Major / Minor / Not covered, with severity, area, test, repro, expected/actual, and suspected cause. Remove the `test.fail` once the bug is fixed.

## Live smoke (`npm run e2e:live`)

`e2e/live/smoke.spec.ts` (config `playwright.live.config.ts`; no server, no DB) calls real vendors with the keys in `.env`: Claude (`max_tokens: 50`), ElevenLabs `GET /v1/voices`, HeyGen `GET /v2/avatars`, Ayrshare `GET /api/user`, and Stripe `prices.list` only when the key starts with `sk_test_`. Each test skips when its key is absent. It never renders videos, posts, or charges. Keys are never printed.

## CI

`.github/workflows/ci.yml` job `e2e` (needs `test`, serialized on the `e2e-db` concurrency group since runs share one DB) installs Chromium and runs `npm run e2e` on Node 22; on failure it uploads `playwright-report` and `test-results`. Required GitHub secrets:

- `E2E_SUPABASE_URL`
- `E2E_SUPABASE_PUBLISHABLE_KEY`
- `E2E_SUPABASE_SERVICE_ROLE_KEY`
- `E2E_DATABASE_URL` (session pooler URI)
- `STRIPE_TEST_SECRET_KEY` (optional; `sk_test_` only)
