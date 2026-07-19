# Candidate findings — security — unverified

Auditor note: All DB access flows through the service-role client (`adminDb`);
no migration enables RLS, so the app layer is the *only* tenant boundary,
making the campaign-scoping gaps directly exploitable.

### SEC-1 — saveBodyAction lets any user overwrite any content item across campaigns
- **Severity:** P0
- **Dimension:** security
- **Location:** src/app/actions.ts:342
- **What's wrong:** `saveBodyAction` calls `requireSession()` but never verifies the target item belongs to `s.campaignId`, and applies no role check. Updates `content_items` by `id` alone.
- **How it fails:** Logged-in user in campaign A calls `saveBodyAction('<id-from-campaign-B>', 'malicious text')`; the update runs via the RLS-bypassing service client, silently rewriting another campaign's content body (can alter already-approved copy before publish).
- **Proposed fix:** Load the item, require `item.campaignId === s.campaignId`, gate on role/status before updating.
- **Effort:** S

### SEC-2 — Content lifecycle actions omit campaign-ownership checks (cross-tenant approve/schedule/publish)
- **Severity:** P0
- **Dimension:** security
- **Location:** src/app/actions.ts:191
- **What's wrong:** `submitAction` (191), `decideAction` (198), `attachDisclosureAction` (208), `scheduleAction` (223), `publishAction` (231), `approveTextAction` (351), `confirmVideoAction` (384), `confirmDisclosureAction` (474) all act on a content item by `id` without checking `item.campaignId === s.campaignId`. `scheduleWithTimeAction` (563) DOES perform this check, showing the omission is a bug.
- **How it fails:** A user with publish permission in their own campaign passes another campaign's content ID to `publishAction`/`approveTextAction`; the action approves, schedules, or pushes foreign content to social platforms, recording audit entries under the victim campaign.
- **Proposed fix:** In each action fetch the item and reject when `item.campaignId !== s.campaignId` (as `scheduleWithTimeAction` does), via a shared helper.
- **Effort:** M

### SEC-3 — Content detail page and audit log readable across campaigns
- **Severity:** P1
- **Dimension:** security
- **Location:** src/app/content/[id]/page.tsx:19
- **What's wrong:** `ContentDetail` fetches `getContentItem(params.id)` and `getAuditEntries(params.id)` with no campaign scoping; both query by id only.
- **How it fails:** Any authenticated user navigating to `/content/<any-id>` reads another campaign's content body, disclosures, and activity log. IDs are 8-char base36, weakly enumerable.
- **Proposed fix:** After loading, `notFound()` unless `item.campaignId === s.campaignId`.
- **Effort:** S

### SEC-4 — Cron routes publicly invokable when CRON_SECRET is unset ("Bearer undefined")
- **Severity:** P1
- **Dimension:** security
- **Location:** src/app/api/cron/publish/route.ts:9
- **What's wrong:** Both cron routes compare the header to `` `Bearer ${process.env.CRON_SECRET}` ``. If unset, expected value is the literal `"Bearer undefined"`. `CRON_SECRET` is not in `.env.example`.
- **How it fails:** Attacker sends `Authorization: Bearer undefined` and passes the check, triggering publish of all due items and Stripe meter-event syncs, with no session.
- **Proposed fix:** Fail closed when `CRON_SECRET` missing, constant-time compare, add to `.env.example`.
- **Effort:** S

### SEC-5 — Service-role key doubles as the ingest/campaigns API bearer token
- **Severity:** P2
- **Dimension:** security
- **Location:** src/app/api/monitoring/ingest/route.ts:8
- **What's wrong:** `monitoring/ingest` and `monitoring/campaigns` authenticate callers by comparing the bearer token to `SUPABASE_SERVICE_ROLE_KEY` — the DB master secret. Shared with external n8n and sent on every ingest call.
- **How it fails:** Crown-jewel DB credential copied into external automation and transmitted as an API token; any leak yields full DB read/write. Non-constant-time compare.
- **Proposed fix:** Dedicated `MONITORING_INGEST_SECRET` distinct from service-role key, timing-safe compare.
- **Effort:** S

### SEC-6 — generateFromMonitoringAction reads monitoring results cross-tenant
- **Severity:** P2
- **Dimension:** security
- **Location:** src/app/actions.ts:416
- **What's wrong:** Selects `monitoring_results` by `id` only (416-421) without checking `result.campaign_id === s.campaignId` before feeding source/excerpt/url into an LLM prompt. (`dismissMonitoringAction` at 499 correctly scopes.)
- **How it fails:** User supplies another campaign's monitoring-result ID; its content is read and fed into a draft generated/billed under the attacker's campaign.
- **Proposed fix:** Add `.eq('campaign_id', s.campaignId)`.
- **Effort:** S

### SEC-7 — No RLS on any table; app layer is the sole tenant boundary
- **Severity:** P2
- **Dimension:** security
- **Location:** supabase/migrations/003_auth.sql:1
- **What's wrong:** None of the 14 migrations enable RLS or define policies; every server path uses service-role `adminDb` which bypasses RLS. No defense-in-depth.
- **How it fails:** Any missed campaign-scoping check becomes a full cross-tenant breach.
- **Proposed fix:** Enable RLS with campaign-scoped policies as a backstop.
- **Effort:** L

### SEC-8 — getVideoStatusAction has no auth check
- **Severity:** P3
- **Dimension:** security
- **Location:** src/app/actions.ts:318
- **What's wrong:** Exported server action calls `videoProvider.getVideoStatus(videoId)` without `requireSession()` or ownership check.
- **How it fails:** Unauthenticated caller probes HeyGen video status/URLs with arbitrary videoId.
- **Proposed fix:** Add `requireSession()`.
- **Effort:** S

### SEC-9 — Seed accounts ship with a known password documented in-repo
- **Severity:** P2
- **Dimension:** security
- **Location:** supabase/migrations/003_auth.sql:37
- **What's wrong:** Migration 003 seeds `u-admin` (super_admin) and others with bcrypt hashes of `changeme123`, documented in a comment.
- **How it fails:** Anyone reading the repo logs in as `admin@commandcenter.local` / `changeme123` to the super-admin console unless manually changed.
- **Proposed fix:** No default creds in production migrations; explicit admin-bootstrap with generated password or forced reset.
- **Effort:** M

### SEC-10 — No rate limiting or lockout on login
- **Severity:** P2
- **Dimension:** security
- **Location:** src/app/actions.ts:29
- **What's wrong:** `loginAction` does an unthrottled bcrypt compare per request with no attempt counter/lockout/rate limit; no middleware.ts exists.
- **How it fails:** Attacker brute-forces passwords against known seed emails without throttling.
- **Proposed fix:** Per-IP/per-account rate limiting and temporary lockout.
- **Effort:** M

## CLEAN
- Session token integrity — HMAC-SHA256 signed cookie, timingSafeEqual, refuses fallback secret in prod, re-validates role/campaign against DB each getSession (session.ts:17-93)
- Session cookie flags — httpOnly, sameSite lax, secure in prod, 7-day maxAge (session.ts:58-66)
- Login timing-safe email enumeration defense (actions.ts:44-48)
- Stripe webhook signature verification + idempotency via billing_events, fail-on-write-error (webhooks/stripe/route.ts:16-88)
- Admin surface gated by AdminFrame/requireAdmin in layout + each admin action calls requireAdmin() (AdminFrame.tsx:5)
- No secret leakage to client — only NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SITE_URL exposed
- No SQL injection — parameterized supabase-js everywhere
- Password handling — bcryptjs cost 10, 8-char min, active-account claim guarded
- Role permissions — can() gates schedule/publish/approve/edit_settings/manage_avatars; upsertProfileAction blocks non-owner overwrite
