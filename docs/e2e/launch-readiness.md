# Launch-Readiness Report

**Generated:** 2026-10-11 · **Suite:** 426 tests across desktop + mobile. Latest fresh-reset full run (after fixing E2E-001 and E2E-007): 421 passed, 5 skipped (4 real-Stripe tests needing `STRIPE_TEST_SECRET_KEY` + 1 mobile-only test on desktop), 0 failed, 8.7 min. Unit tests: 748 passed. Known-bug tests (`test.fail`, counted as passing) cover every open finding that has a test.

## Verdict
**GO** — no blocker-severity findings (no data loss, security hole or broken core flow), and both majors are fixed (E2E-001, E2E-007 — see Fixed below). Open: Blockers: 0 · Major: 0 · Minor: 13. Before launch, run `npm run e2e:live` once and re-check X/Facebook/LinkedIn analytics against the first real post on each (E2E-007 fix follows Ayrshare's documented response shape).

## Blockers
None.

## Major
None open (both fixed — see "Fixed" at the end).

## Minor

### E2E-002 — `media` storage bucket is not created by any migration
**Severity:** minor
**Area:** Storage / environment setup
**Test:** `e2e/reset-db.ts` (creates the bucket itself)
**Repro:** 1. Build a fresh project from `supabase/migrations`. 2. Use any feature that uploads media (e.g. avatar photos / voice samples).
**Expected:** Migrations (or a documented setup step) create the public `media` bucket the app depends on. / **Actual:** No migration creates it; uploads fail with "bucket not found" on a fresh environment until someone creates it manually.
**Suspected cause:** `src/app/actions.ts:885` (`adminDb.storage.from('media')`) — bucket assumed to exist; add a migration inserting into `storage.buckets` (id `media`, public).

### E2E-003 — Two migrations share the `034_` prefix
**Severity:** minor
**Area:** Database migrations
**Test:** `e2e/reset-db.ts` (applies in lexical order: `034_analytics_metrics.sql`, then `034_billing_plan_interval.sql`)
**Repro:** `ls supabase/migrations | grep ^034_`
**Expected:** Unique, monotonic migration version prefixes. / **Actual:** `034_analytics_metrics.sql` and `034_billing_plan_interval.sql` share version `034`. Tools keyed on the numeric version (e.g. Supabase CLI's `schema_migrations`) may treat them as the same version and skip one or error. They happen to be independent and both apply cleanly in lexical order.
**Suspected cause:** `supabase/migrations/034_billing_plan_interval.sql` — renumber in a future cleanup (only once it is confirmed how prod recorded them).

### E2E-004 — Join accepts a malformed email address
**Severity:** minor
**Area:** Auth / invite join
**Test:** `e2e/specs/auth.spec.ts` › `join rejects a malformed email server-side` (marked `test.fail`)
**Repro:** 1. Open `/join?code=<valid invite>`. 2. Bypass browser validation (or POST directly) with email `not-an-email`, valid name and an 8+ char password. 3. Submit.
**Expected:** Field error on email, no account, invite not consumed. / **Actual:** The account is created, the invite is consumed and the user is logged in. Only the browser's `type=email` check guards it; the server checks presence only.
**Suspected cause:** `src/app/actions.ts:170-175` (`joinAction` validates required/password length only).

### E2E-005 — Login lockout keyed on IP lets one client lock out everyone behind it
**Severity:** minor
**Area:** Auth / login throttle
**Test:** `e2e/specs/auth.spec.ts` › `failed logins from a shared IP do not block another account with the right password` (marked `test.fail`)
**Repro:** From one IP (same `x-forwarded-for`), fail login 5 times (any emails). Then log in with a correct, different account.
**Expected:** After 5 failed logins from one IP (other/unknown emails), a different existing account with its correct password can still log in from that IP. / **Actual:** Refused with "Too many attempts" for 15 minutes. Campaign staff behind a shared NAT/office can be locked out by one person's typos or by an attacker; likewise anyone can lock a known email out of its own account with 5 bad attempts (inherent to per-email lockout). Hardening: e.g. count IP failures only per distinct (ip,email) or use a higher IP threshold; consider CAPTCHA/backoff instead of hard lockout.
**Suspected cause:** `src/app/actions.ts` (`loginAction`, `ipKey` check) and `src/lib/login-throttle.ts` (`MAX_ATTEMPTS = 5` for both buckets).

### E2E-006 — Login throttle trusts the client-supplied first `x-forwarded-for` entry
**Severity:** minor
**Area:** Auth / login throttle
**Test:** none beyond the throttle tests in `e2e/specs/auth.spec.ts` (they rely on this header to get a private IP bucket)
**Repro:** Send login POSTs with a different `x-forwarded-for` value each time (or a victim's IP).
**Expected:** The IP bucket keys on an address the platform vouches for. / **Actual:** The first header entry is used as-is. On Vercel the platform sets it; on any other host or behind an appending proxy it is client-controlled, so the IP bucket can be bypassed by rotating the header, or a victim's IP forged to lock them out. The per-email bucket still applies.
**Suspected cause:** `src/app/actions.ts:114-115` (`headers().get('x-forwarded-for')` first entry).

### E2E-008 — Scheduling writes two "Scheduled" activity entries
**Severity:** minor
**Area:** Content lifecycle / activity log
**Test:** `e2e/specs/content-lifecycle.spec.ts` › `happy path across roles › activity log shows the schedule step once` (marked `test.fail`)
**Repro:** Schedule an approved item from the publish step ("Schedule for later" → pick time → Schedule), then look at the item's Activity panel.
**Expected:** One "Scheduled" entry by the owner. / **Actual:** Two consecutive "Scheduled" entries (audit actions `schedule` and `schedule_with_time`).
**Suspected cause:** `src/domain/content-lifecycle.ts:60` (`schedule()` logs `schedule`) plus `src/app/actions.ts:801` (`scheduleWithTimeAction` appends `schedule_with_time` for the same step).

### E2E-009 — Content list has no search (missing feature)
**Severity:** minor (missing feature, not a regression)
**Area:** Content list (/content)
**Test:** `e2e/specs/content-lifecycle.spec.ts` › `content list: search narrows results` (marked `test.fail`)
**Repro:** Open /content with many items and try to find one by title.
**Expected:** A search box narrows the table. / **Actual:** Only status tabs exist; the page reads only `searchParams.status`.
**Suspected cause:** `src/app/content/page.tsx:27` (feature not built).

### E2E-010 — Content language is stored but never shown (list or review)
**Severity:** minor
**Area:** Content list and review / bilingual content
**Test:** `e2e/specs/content-lifecycle.spec.ts` › `content list: a Spanish-language item shows its language badge` and `e2e/specs/i18n.spec.ts` › `approver sees a locale badge on Spanish content` (both marked `test.fail`)
**Repro:** 1. Create a draft with Language = Español (stored `locale = 'es'`) and submit. 2. As the approver open `/content` (status=in_review) or `/content/<id>`.
**Expected:** A visible language indicator (e.g. "ES"). / **Actual:** List columns are Title, Type, Source, Updated, Status; the detail page has no badge. `content_items.locale` is saved and mapped (`src/lib/data.ts:489`) but no page renders it, so reviewers cannot tell Spanish content apart.
**Suspected cause:** `src/app/content/page.tsx:104-110`, `src/app/content/[id]/page.tsx`, `src/components/ContentWizard.tsx` — no locale cell/badge.

### E2E-011 — Billing/quota gate refusals are hard-coded English
**Severity:** minor
**Area:** Billing / i18n
**Test:** `e2e/specs/billing.spec.ts` › `canceled campaign, Spanish session: the billing-gate refusal is shown in Spanish` (marked `test.fail`)
**Repro:** Owner with locale `es`; cancel the subscription (signed `customer.subscription.deleted`); at /content/new fill the prompt and click "Generar con IA".
**Expected:** The refusal under the prompt box is in Spanish. / **Actual:** "This campaign's subscription is inactive. Contact your platform admin to restore access." (reproduced 2026-10-10). `QuotaExceeded` messages are English too.
**Suspected cause:** `src/domain/billing.ts:31-46` (English literals), returned verbatim as `e.message` by `src/app/actions.ts:29, :347, :555, :876, :1029, :1184, :1330, :1385`.

### E2E-012 — Public pages have no `<main>` landmark
**Severity:** minor
**Area:** Accessibility / landing, login, join
**Test:** `e2e/specs/page-sweep.spec.ts` › `logged out › /, /login, /join has a main landmark` (marked `test.fail`)
**Repro:** Open `/`, `/login`, `/join` logged out; no `<main>` / `role="main"` element.
**Expected:** One main landmark per page. / **Actual:** None.
**Suspected cause:** `src/app/LandingPageClient.tsx` (`div.lp`), `src/app/login/page.tsx`, `src/app/join/page.tsx` (`div.auth-wrap`).

### E2E-013 — /channels progress bar has no accessible name
**Severity:** minor
**Area:** Accessibility / channels
**Test:** `e2e/specs/page-sweep.spec.ts` › `/channels as <role>` (4 roles, desktop + mobile; marked `test.fail`)
**Repro:** Open `/channels`; axe (wcag2a/aa) reports `aria-progressbar-name` (serious).
**Expected:** `role="progressbar"` has `aria-label`/`aria-labelledby`. / **Actual:** Unnamed.
**Suspected cause:** `src/components/ChannelsManager.tsx:287`.

### E2E-014 — Landing page colour-contrast violations
**Severity:** minor
**Area:** Accessibility / landing page
**Test:** `e2e/specs/page-sweep.spec.ts` › `logged out › / renders` (desktop + mobile; marked `test.fail`)
**Repro:** Open `/` logged out; axe `color-contrast` (serious) reports 22 nodes (desktop) / 18 (mobile).
**Expected:** WCAG AA 4.5:1 text contrast. / **Actual:** Below threshold on several elements.
**Suspected cause:** `src/app/LandingPageClient.tsx` / landing CSS in `src/app/globals.css` (muted text colours).

### E2E-015 — Admin campaign detail: scrollable table not keyboard-focusable on mobile
**Severity:** minor
**Area:** Accessibility / admin
**Test:** `e2e/specs/page-sweep.spec.ts` › `/admin/campaigns/e2e-camp-a on mobile: scrollable region is keyboard-focusable` (mobile only; marked `test.fail`)
**Repro:** As super admin at phone width (Pixel 7), open `/admin/campaigns/<id>`; axe `scrollable-region-focusable` (serious) reports 1 node.
**Expected:** A horizontally scrolling region can be reached and scrolled with the keyboard (e.g. `tabIndex={0}` + accessible name on the scroll wrapper). / **Actual:** The overflow container is not focusable.
**Suspected cause:** table wrapper with `overflow-x: auto` in `src/app/admin/campaigns/[id]/` sections.

## Notes (intended behaviour, not bugs)
- The pre-auth language toggle (landing, login, join) stays visible to signed-in visitors and persists the choice to the account (`src/app/locale-actions.ts`, `LandingPageClient`). The brief assumed it is hidden when logged in; the test asserts the real behaviour. It is not shown inside the app shell (tested).
- `/pricing` requires a session (the post-signup plan step), so it is asserted as protected, not public.
- /pricing has no monthly/annual toggle; plans are monthly only (`billing_interval`), so only monthly prices are asserted.
- `customer.subscription.created` and invoice events are acked 200 and stored but not acted on by `src/app/api/webhooks/stripe/route.ts`; the initial plan comes from `checkout.session.completed`.
- Correction: an early suspicion that `/api/elevenlabs/voices` was unauthenticated was wrong. It has a session check, and a test covers it.
- `upsertProfileAction` (`src/app/setup/actions.ts:33`) has a conditional guard: anyone may create the first profile, afterwards a non-owner/manager is redirected to /dashboard instead of getting an error. Covered by a replay test.

## Questions for the owner
1. Monitoring dismiss / restore / manual-add have no role gate, so staff can dismiss monitored items. Intended?
2. GitHub secrets needed before the E2E job can run in CI: `E2E_SUPABASE_URL`, `E2E_SUPABASE_PUBLISHABLE_KEY`, `E2E_SUPABASE_SERVICE_ROLE_KEY`, `E2E_DATABASE_URL` (all for the dedicated E2E project only, never the production project), and optionally `STRIPE_TEST_SECRET_KEY` (enables the 4 real-Stripe tests; run them once locally first).

## What's covered
| Area | Spec file | Tests |
|---|---|---|
| Harness canary | `00-canary.spec.ts` | 2 |
| Ayrshare fake / publish now | `01-ayrshare-fake.spec.ts` | 6 |
| Auth, join, login throttle | `auth.spec.ts` | 15 |
| Permissions (server-action replays) | `permissions.spec.ts` | 11 |
| Monitoring UI / API | `monitoring.spec.ts`, `monitoring-api.spec.ts` | 8 / 11 |
| Content lifecycle | `content-lifecycle.spec.ts` | 19 |
| Channels | `channels.spec.ts` | 6 |
| Cron (publish, etc.) | `cron-api.spec.ts` | 11 |
| Analytics sync | `analytics.spec.ts` | 11 |
| Billing / Stripe webhooks | `billing.spec.ts` | 25 |
| Team & settings | `team-settings.spec.ts` | 10 |
| Admin console | `admin.spec.ts` | 6 |
| Setup & landing | `setup-landing.spec.ts` | 5 |
| Video / avatars | `video-avatars.spec.ts` | 10 |
| Voice | `voice.spec.ts` | 7 |
| i18n | `i18n.spec.ts` | 11 |
| Tenant isolation | `tenant-isolation.spec.ts` | 8 |
| Page sweep (a11y, all roles) | `page-sweep.spec.ts` | 8 |

(Counts are `test(` declarations; several run per role/viewport, so the executed total of 419 is higher.)

## Not covered (and why)
- Real vendor behaviour (HeyGen render, Ayrshare platform rules, rate limits, response variations) — live smoke only. Ayrshare is replaced by a local fake (`e2e/fake-ayrshare/server.ts`, via the `AYRSHARE_BASE_URL` seam in `src/integrations/ayrshare-base.ts`); it reproduces only the response shapes the adapters parse. The publish cron and analytics sync are covered against it.
- 4 real-Stripe key-gated tests (checkout redirect, billing portal redirect, admin plan assignment, `checkout.session.completed` real activation) have never been executed; they need `STRIPE_TEST_SECRET_KEY`. Run once locally before adding the CI secret. Without a key, the handled-error paths and every dummy-key-reachable webhook branch (ignored / 409 + claim released / stale / 500 + claim released) are covered; real activation is key-gated only.
- The live smoke checks Stripe with `prices.list`, not a real checkout session.
- Over-quota / plan-limit-after-downgrade blocked actions.
- Avatar consent pending/declined and status to `failed` (the mock resolves instantly).
- Voice limits.
- Demo mp4 playback: tests check each `<video>`/`<source>`/poster path, a 200 with the right content type and no autoplay, but Playwright's Chromium lacks H.264, so nothing is played.
- Under-30s video warning and the 500MB upload limit.
- Admin user role-change and deactivate: the admin console has neither (only "Sign in as" and "Remove", both covered, plus the last-owner refusal). Role change is covered from the tenant side in `team-settings.spec.ts`.
- Permission replays (`permissions.spec.ts`) cover 9 gated server actions end to end: `approveTextAction`, `decideAction` (reject), `scheduleWithTimeAction`, `unscheduleAction`, `publishAction`, `saveProfileAction`, `upsertProfileAction`, `deleteAvatarAction`, `changeTeammateRoleAction`. The other 22 gated actions were checked by code reading only. Each runs `if (!can(s.role, …)) return { ok: false, error: … }` straight after `requireSession()`/`getTranslations()` and before any data access:
  - `src/app/actions.ts`: `openMyBillingPortalAction` (edit_settings, :466), `confirmVideoAction` (approve, :642), `confirmDisclosureAction` (schedule, :667), `saveVideoSettingsAction` (edit_settings, :743; throws `GateError` caught by `guard`), `beginAvatarUploadAction` (:859), `finalizeAvatarAction` (:903), `beginVideoAvatarUploadAction` (:1014), `finalizeVideoAvatarAction` (:1052), `setActiveAvatarAction` (:1107), `beginVoiceCloneUploadAction` (:1172), `finalizeVoiceCloneAction` (:1203), `previewVoiceCloneAction` (:1320), `generatePromptLookAction` (:1351). All avatar/voice actions are manage_avatars.
  - `src/app/settings/actions.ts`: `saveDisclosureDefaultAction` (edit_settings, :135).
  - `src/app/settings/team-actions.ts`: `inviteTeammateAction` (:16), `removeTeammateAction` (:48), `revokeInviteAction` (:81). All manage_team.
  - `src/app/pricing/actions.ts`: `startCheckoutAction` (:21), `changePlanAction` (:66). Both edit_settings.
  - `src/app/channels/actions.ts`: `startChannelLinkAction` (:85), `disconnectChannelAction` (:132), `completeMockLinkAction` (:163). All edit_settings.

## Fixed

### ✅ E2E-001 — Schema cannot be rebuilt from migrations: 019 changes reserve_usage return type
**Severity:** major
**Area:** Database migrations / disaster recovery / new-environment setup
**Test:** `e2e/reset-db.ts` (`npm run e2e:db`) — replaying `supabase/migrations/*.sql` in order on a fresh Supabase project
**Repro:** 1. Fresh Supabase project. 2. Apply migrations 001–018 in filename order. 3. Apply `019_finalize_usage.sql`.
**Expected:** Every migration applies cleanly on an empty database. / **Actual:** `019_finalize_usage.sql` fails with `cannot change return type of existing function` — `013_atomic_usage_guard.sql` creates `reserve_usage(text, integer, integer) returns boolean`, and 019 uses `create or replace` to make it `returns text`, which Postgres rejects. Production must have had the function dropped by hand. Impact today is limited (030 drops `reserve_usage`/`finalize_usage` entirely), but a from-scratch rebuild (DR restore, new region, `supabase db reset`) stops at 019.
**Suspected cause:** `supabase/migrations/019_finalize_usage.sql:13` — missing `drop function if exists reserve_usage(text, integer, integer);` before the `create or replace`. Workaround applied in `e2e/reset-db.ts` (`PRE_MIGRATION_FIXES`), migration files untouched.

### ✅ E2E-007 — Analytics never populate for X, Facebook or LinkedIn posts
**Severity:** major
**Area:** Analytics sync (Ayrshare)
**Test:** `e2e/specs/analytics.spec.ts` › `with the bearer, an X post gets metrics` (marked `test.fail`; sync-analytics cron against the fake, which returns metrics for every platform)
**Repro:** Publish to X/Facebook/LinkedIn, run `GET /api/cron/sync-analytics`. `AyrshareAnalyticsProvider.getPostAnalytics` looks up `ANALYTICS_EXTRACTORS['twitter' | 'facebook' | 'linkedin']`, which is undefined, and `continue`s, so no `post_metrics` row is ever written for those posts.
**Expected:** Metrics for posts on every supported network (or the UI saying a network's analytics are unavailable). / **Actual:** Campaign analytics for X, Facebook and LinkedIn posts are always empty, silently; only Instagram/TikTok/YouTube have extractors.
**Suspected cause:** src/integrations/index.ts:576 (`ANALYTICS_EXTRACTORS` has no twitter/facebook/linkedin entry) and :631 (`if (!a || !extract) continue;`)

**E2E-001 fix (2026-10-11):** `supabase/migrations/019_finalize_usage.sql` now drops `reserve_usage(text, integer, integer)` before re-creating it; the reset-script workaround was removed, and the test DB rebuilds from the migrations alone. Already-applied production databases are unaffected (migrations are not re-run).

**E2E-007 fix (2026-10-11):** added `twitter`, `facebook` and `linkedin` extractors to `ANALYTICS_EXTRACTORS` (`src/integrations/index.ts`), mapped from Ayrshare's documented `/analytics/post` example responses, with 4 new unit tests; the E2E test (`analytics.spec.ts` › "with the bearer, an X post gets metrics") now passes without `test.fail`. Caveat: the owner's Ayrshare account had no successfully published X/Facebook/LinkedIn post to verify against live (all historical posts on those networks failed to publish, and only Instagram/TikTok/YouTube are currently linked) — re-check the numbers against the first real post on each network.

## Opposition-monitoring pipeline audit (2026-10-11)

Live n8n workflow ("My workflow", GFk7S3n3qL4aXFj9) + production data (25,424 rows) + the monitoring page reviewed against production.

| # | Problem | Fix | Where |
|---|---|---|---|
| M1 | Format steps used `$input.first()` → only the first campaign's results survived (4 of 5 campaigns got no YouTube/Instagram/Facebook; 40 of 50 articles dropped per run) | Each Format step now runs once per campaign, paired with that campaign's config. Verified on a live run: 10 items × 5 campaigns. Published. | n8n (backup: "BACKUP 2026-10-11 — My workflow (before monitoring fixes)", inactive) |
| M2 | Old "Command Center — Opposition Monitoring" workflow also active → duplicate NewsData calls, simultaneous GDELT calls | Deactivated (kept, reversible) | n8n |
| M3 | GDELT rate-limited ("one request every 5 seconds") → 0 items | Duplicate workflow off; GDELT batch interval 5.5s → 7s | n8n |
| M4 | X/Twitter API returns `402 credits depleted` → 0 items | **Owner action:** top up X API credits or remove the X branch | X developer account |
| M5 | Off-topic stories (no relevance filter: `relevance_terms` never sent) | Ingest derives relevance terms from the campaign's opponent/aliases/keywords; feed hides automated off-topic rows already stored (manual entries never hidden) | `src/app/api/monitoring/ingest/route.ts`, `src/lib/monitoring-normalize.ts` |
| M6 | CNN/Fox/Boston Globe/NY Post labelled "blog"; almost nothing "high" credibility | Unknown editorial sites → "news"; "blog" only for blog platforms or `/blog/` paths; ~35 major outlets rated high; subdomain-aware, lookalike-safe. Derived from the URL at read time, so all existing rows display correctly | `src/lib/credibility.ts` |
| M7 | 82% of items had no opponent | Server-side matching on full name, aliases and surname (whole words) at ingest and read time | `src/lib/monitoring-normalize.ts` |
| M8 | HTML entities (`&quot;`, `&#39;`) and raw source slugs (`wsws_org`) | Entities/tags decoded; outlet display names for known domains; slugs humanized | `src/lib/monitoring-normalize.ts` |
| M9 | Same wire story from several outlets | Ingest skips a story already captured in the last 3 days; feed collapses existing copies | ingest route + feed |
| M10 | Feed loaded every row (~5,000 per campaign); dashboard/analytics showed "1,000+" | Feed shows the 200 most recent relevant stories with a "N captured in total" note (EN/ES); tiles use an exact count | `src/lib/data.ts`, `MonitoringTable.tsx`, dashboard, analytics |
| M11 | Google Alerts not configured for any campaign; 2 campaigns have no aliases/keywords | **Owner action:** add Google Alerts RSS URLs, aliases and keywords in campaign settings | campaign settings |

**Deploy note:** the n8n fixes (M1–M3) are live now. The app fixes (M5–M10) take effect in production only after this branch is deployed; until then new items still arrive through the old ingest code (the feed-side cleanup also needs the deploy).

**Harness:** `e2e/fixtures.ts` now ignores Next's benign "Failed to fetch RSC payload … Falling back to browser navigation" message globally (aborted prefetch), which was causing intermittent failures.

### Follow-up (2026-10-12)
- **Verified after M1:** YouTube now reaches all 5 campaigns (44–88 items each in 24h, previously 1 campaign); Instagram returns 12 latest posts per campaign and the app accepts them (no new rows until the opponent posts — URL de-dupe working as intended).
- **M12 (fixed, n8n):** Facebook Reels have no caption → empty excerpt → every Facebook item rejected (400) since 2026-10-04; scraper error items were also forwarded as posts. Facebook Format now skips error items, describes caption-less posts ("… posted a video on Facebook · 387.8K views · 14.8K likes …") and attributes them to the opponent. Verified on a live run (6 valid posts), published.
- **GDELT removed (owner decision, 2026-10-12):** it stayed rate-limited even with the duplicate workflow off (GDELT throttles by source IP and n8n Cloud IPs are shared). NewsData covers the same news. Existing GDELT stories stay in the feeds; restore from n8n version history if needed.
- **Campaign settings (owner action):**
  - "Final Test" and "Ernesto Ackerman Last Review" have no X / Instagram / Facebook handles → no social monitoring.
  - "hamza" Facebook page is "Donald" (wrong page → "not available"); should be `DonaldTrump`.
  - Both "Ernesto for district 24" campaigns use aliases "president" / "white house" (and typo "Donal J. Trump") and keywords "democrats" / "whashington": generic terms make unrelated stories pass the relevance filter. Aliases should be names for the opponent ("Trump", "DJT"); keywords should be race-specific (district, city, local issues).
  - No campaign has a Google Alerts RSS URL; two campaigns share the name "Ernesto for district 24".

### Monitoring relevance & rebuttal upgrade (2026-10-12)
1. **AI triage** (`src/lib/monitoring-triage.ts`, migration `045_monitoring_triage.sql`): every new story is rated by Claude Haiku 5.5 — Attack on candidate / Opponent statement / Race-relevant / Low priority — with a one-line "why it matters". Feed shows the badge + reason, a "Priority only" filter, and hides low-priority stories behind a toggle. Already-captured URLs skip triage (no wasted calls). Failures save the story as Race-relevant; if migration 045 hasn't run, stories still save (without triage).
2. **YouTube** (n8n): relevance order, last 3 days, `relevanceLanguage=en`, `regionCode=US` (was newest-first, which surfaced spam Shorts).
3. **Duplicates**: bylines/datelines ("By …, CNN (CNN) —", "WASHINGTON (AP) —") stripped before comparing stories.
4. **Settings guardrail**: generic aliases/keywords ("president", "white house", "democrats", …) are rejected with an EN/ES explanation naming the terms.
5. **Rebuttals**: the AI now receives the full story (server-loaded by id, scoped to the campaign — cross-campaign ids are refused), link, source, date, opponent and triage reason, plus rebuttal rules (lead with the candidate's positions, don't repeat the attack, treat claims as unverified, never invent facts).
6. **Formats**: each story offers Draft rebuttal (reply post), Talking points and Press statement; the editor shows "Responding to {source}" with a link to the story.

Tests: 804 unit (new: triage, ingest triage/URL pre-check/migration fallback, bylines, generic-term validation, rebuttal prompt and draft action), E2E `e2e/specs/monitoring-triage.spec.ts`; full suite 421 passed / 5 skipped / 0 failed before the final small changes, monitoring + content specs 55/55 after.

**Deploy order:** migration 045 was applied to production on 2026-10-12 (via the Supabase SQL editor; verified through the API, existing rows untouched) — deploy the branch next. Production needs `LLM_API_KEY` (already used for drafting). Expected triage cost: well under $1/day at current volume.
