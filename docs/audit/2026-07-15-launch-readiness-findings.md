# Launch-Readiness Findings — 2026-07-15

Campaign Command Center — full audit across security/auth, data integrity,
billing, integration robustness, end-to-end flows, UX, and test/build health.

## Summary

**Recommendation: do not launch yet.** The product's visual design and core
UX are genuinely strong, and the domain logic (lifecycle gates, billing math,
webhook signature handling) is well-structured. But the audit found **7
launch-blocking (P0) defects** and ~20 must-fix (P1) issues that fall into three
themes:

1. **Multi-tenant isolation is not enforced.** There is no database RLS, so the
   application layer is the only tenant boundary — and several server actions
   act on records by id without checking campaign ownership. One authenticated
   user can read, overwrite, approve, schedule, and publish another campaign's
   content.
2. **The publishing and billing pipelines don't actually run as deployed.** The
   cron jobs are declared in `vercel.ts`, which Vercel never reads (there is no
   `vercel.json`), so scheduled posts never publish and metered usage is never
   reported to Stripe. When publishing does run, failures are swallowed and
   content is marked "published" even when nothing was posted.
3. **The approval hard gate — the compliance centerpiece — is bypassable.**
   `confirmDisclosureAction` moves content straight to `scheduled` without the
   approval or AI-disclosure checks, and `decideAction` lets any role approve.

None of these require a redesign; they're bounded fixes. Once the P0/P1 set is
closed and covered by tests, this is shippable.

**Counts:** P0 = 7 · P1 = 20 · P2 = 23 · P3 = 11 (61 total).

### Method note
Dimensions 1–4 and 7 were audited by parallel read-only code-review agents; every
P0/P1 finding was then re-checked by a second agent tasked to *refute* it — only
confirmed findings appear below. Dimensions 5–6 (flows, UX) were exercised in a
browser against the live dev server; to avoid real side effects, no content was
published, no Stripe charge was triggered, and nothing was left scheduled, so the
happy-path publish was validated from code rather than live (see FLOW-2).

---

## Findings table (ranked by severity)

| ID | Sev | Dim | Summary | Effort |
|---|---|---|---|---|
| SEC-1 | P0 | security | `saveBodyAction` overwrites any content item cross-tenant, even post-approval | S |
| SEC-2 | P0 | security | Lifecycle actions (submit/decide/schedule/publish/…) skip campaign-ownership checks | M |
| DATA-2 | P0 | data | `confirmDisclosureAction` jumps to `scheduled`, bypassing the approval hard gate | S |
| INT-1 | P0 | integrations | Cron in `vercel.ts` (no `vercel.json`) → publishing & billing-sync never run | S |
| INT-2 | P0 | integrations | Publish failures discarded; content marked "published" when nothing posted | M |
| SEC-4 | P0 | security | Cron auth is `Bearer undefined` when `CRON_SECRET` unset — public bypass | S |
| DATA-4 | P0 | data | Migrations seed a super-admin with password `changeme123` into any DB | M |
| SEC-11 | P1 | security | `decideAction` approves with no `can('approve')` check — any role can approve | S |
| SEC-3 | P1 | security | Content detail + audit log readable across campaigns by id | S |
| DATA-3 | P1 | data | `approveTextAction`/`confirmVideoAction` raw status writes, no transition/ownership check | M |
| INT-11 | P1 | integrations | Cron publish can double-post (no claim/lock, non-atomic) | M |
| INT-3 | P1 | integrations | Mock providers silently activate in prod when a key is missing | S |
| INT-4 | P1 | integrations | HeyGen status errors swallowed as "processing"; client polls forever | S |
| INT-5 | P1 | integrations | Video job id only in client state → $50 generation orphaned on refresh | M |
| INT-6 | P1 | integrations | Voice synth ignores campaign voice, uses stock/global voice | S |
| INT-7 | P1 | integrations | ElevenLabs voice id sent to HeyGen as `voice_id` (wrong namespace / global fallback) | M |
| INT-8 | P1 | integrations | ElevenLabs upload error ignored → dead audio URL, still charged $20 | S |
| DATA-7 | P1 | data | Supabase write errors ignored across repos/actions → silent state corruption | M |
| DATA-8 | P1 | data | Scheduled time parsed in server TZ; `timezone` column never applied (off by hours) | S |
| BILL-2 | P1 | billing | Plan change cancels sub without invoice/prorate → lost revenue + overcharge | S |
| BILL-3 | P1 | billing | First sync bills all pre-subscription usage (cursor defaults to 1970) | S |
| BILL-4 | P1 | billing | Concurrent billing-sync runs double-bill overlapping usage | M |
| UX-1 | P1 | ux | Dashboard vs Billing show contradictory spend limits/framing | M |
| TEST-1 | P1 | tests | Content lifecycle hard gate has zero tests | S |
| TEST-2 | P1 | tests | Disclosure engine jurisdiction rules untested | S |
| TEST-3 | P1 | tests | Stripe webhook idempotency/retry untested | M |
| TEST-5 | P1 | tests | Billing-sync double-billing protections untested | M |
| TEST-6 | P1 | tests | `assignPlanAction` (real Stripe subs) untested | M |
| SEC-5 | P2 | security | Service-role key doubles as monitoring ingest bearer token | S |
| SEC-6 | P2 | security | `generateFromMonitoringAction` reads monitoring results cross-tenant | S |
| SEC-7 | P2 | security | No RLS on any table — no defense-in-depth behind app checks | L |
| SEC-10 | P2 | security | No rate limiting/lockout on login | M |
| INT-10 | P2 | integrations | Unauth proxy endpoints + `getVideoStatusAction` expose provider data | S |
| INT-12 | P2 | integrations | n8n workflow reads only first campaign; hardcoded `localhost:3001` | M |
| INT-13 | P2 | integrations | Providers parse JSON before status check; accept empty IDs | M |
| INT-14 | P2 | integrations | Avatar status unvalidated; strands in "training"; creation failure returns ok | S |
| BILL-6 | P2 | billing | Webhook acks+dedupes events with no matching campaign (permanently drops) | S |
| BILL-7 | P2 | billing | No out-of-order webhook protection; stale event regresses status/clears grace | M |
| BILL-8 | P2 | billing | Usage events skipped at the sync window boundary | S |
| BILL-9 | P2 | billing | Video/voice/prompt-look don't release usage reservation on failure | S |
| BILL-10 | P2 | billing | Plan seat limits defined but never enforced | M |
| BILL-13 | P2 | billing | `finalize()` non-atomic, matches reservations by cost — race/crash loss | M |
| DATA-11 | P2 | data | Invite-code single-use is a check-then-act race | S |
| DATA-12 | P2 | data | User/avatar deletes silently no-op when FKs block them | M |
| DATA-13 | P2 | data | `blackout_days_before_election` stored/editable but never enforced | M |
| DATA-14 | P2 | data | `Math.random` PKs + unchecked inserts → collisions, guessable invites | S |
| UX-2 | P2 | ux | Avatars all "Default avatar", indistinguishable (no name/thumbnail) | M |
| UX-3 | P2 | ux | Settings profile form has no field validation | M |
| TEST-7 | P2 | tests | Usage-cap tests assert a fake, not the real `reserve_usage` RPC | L |
| TEST-8 | P2 | tests | Draft/video/voice metered billing untested | M |
| TEST-11 | P2 | tests | No CI runs the test suite | S |
| TEST-BUILD-1 | P2 | tests | Build depends on network access to Google Fonts | S |
| BILL-11 | P3 | billing | Cap window: calendar-month vs billing-period vs UTC mismatch (root of UX-1) | M |
| BILL-12 | P3 | billing | No billing-page messaging for paused/incomplete_expired | S |
| DATA-16 | P3 | data | `content_items.type` unconstrained; client-supplied string persisted | S |
| DATA-17 | P3 | data | Monitoring ingest dedupe race; no unique index | S |
| DATA-18 | P3 | data | Referential-integrity gaps (billing_events delete, author cols, null campaign_id) | M |
| TEST-9 | P3 | tests | `avatars`/`candidate` tests assert only `typeof fn` — false coverage | S |
| TEST-10 | P3 | tests | `super_admin` not pinned in permission-matrix tests | S |
| UX-4 | P3 | ux | Monitoring excerpts truncate mid-word, no ellipsis | S |
| UX-5 | P3 | ux | Monitoring feed surfaces off-topic items; flat credibility | M |
| FLOW-1 | P3 | flows | Non-admin `/admin` visit redirects to /login (looks like logout) | S |

---

## Findings detail

Every P0/P1 below carries a **Verdict: CONFIRMED** from the adversarial
verification pass. P2/P3 are confirmed by code review; those that additionally
went through adversarial verification are marked.

### P0 — Launch blockers

#### SEC-1 — `saveBodyAction` overwrites any content item cross-tenant, even post-approval
- **Location:** src/app/actions.ts:342 · **Verdict:** CONFIRMED
- Updates `content_items.body` by id with no `campaignId` match, no permission check, no status guard (`await requireSession()`'s result is even discarded). Contrast `scheduleWithTimeAction:563`, which does check ownership.
- **Fails:** A user in campaign A calls `saveBodyAction('<campaign-B-id>', '…')` and rewrites B's content; or edits their own already-approved/scheduled item so the cron publishes text no human approved.
- **Fix:** Load the item, require `item.campaignId === s.campaignId`, and only allow edits in draft/in_review/rejected (or reset to draft and void approvals on edit). **S**

#### SEC-2 — Lifecycle server actions omit campaign-ownership checks
- **Location:** src/app/actions.ts:191 (submitAction), 198 (decideAction), 208 (attachDisclosureAction), 223 (scheduleAction), 231 (publishAction), 351 (approveTextAction), 384 (confirmVideoAction), 474 (confirmDisclosureAction) · **Verdict:** CONFIRMED (all 8)
- None compare `item.campaignId` to `s.campaignId`; `lifecycle.*` only checks existence. `scheduleWithTimeAction:563` does check, proving the omission is a bug.
- **Fails:** A user passes another campaign's content id to `publishAction`/`approveTextAction` and approves, schedules, or publishes it, with audit entries recorded under the victim campaign.
- **Fix:** Fetch the item and reject on ownership mismatch in each action, via a shared helper. **M**

#### DATA-2 — `confirmDisclosureAction` jumps to `scheduled`, bypassing the approval hard gate
- **Location:** src/app/actions.ts:474 (sets status at 488-490) · **Verdict:** CONFIRMED
- Sets `status='scheduled'` with a raw DB update, never calling `lifecycle.schedule()` — so no `hasApproval` gate, no AI-disclosure gate, no transition validation, no `can(role,'schedule')`, no ownership check.
- **Fails:** Any authenticated user calls `confirmDisclosureAction(id)` on a draft (theirs or another campaign's) → it becomes `scheduled` with zero approvals → `publishAction`/cron pushes it live. The compliance centerpiece is fully bypassed.
- **Fix:** Route through `lifecycle.schedule()` after attaching disclosures; add ownership + `can(s.role,'schedule')`. **S**

#### INT-1 — Cron config in `vercel.ts`; Vercel never reads it → publishing & billing-sync never run
- **Location:** vercel.ts:1 (merges BILL-1) · **Verdict:** CONFIRMED (no `vercel.json` exists; `next.config.mjs` has no cron config)
- Vercel registers crons from `vercel.json`, which does not exist. `vercel.ts` declares only `/api/cron/publish`; `/api/cron/billing-sync` is scheduled nowhere.
- **Fails:** Users schedule posts that never publish; metered usage (video $50, voice $20, drafts) is never reported to Stripe, so only the flat fee is invoiced and all overage revenue is lost.
- **Fix:** Create a real `vercel.json` with both crons (`/api/cron/publish` and `/api/cron/billing-sync`); remove `vercel.ts`. **S**

#### INT-2 — Publish failures discarded; content marked "published" when nothing posted
- **Location:** src/app/actions.ts:237-244; src/app/api/cron/publish/route.ts:30-38 (merges DATA-6) · **Verdict:** CONFIRMED
- `AyrsharePublisher.publish` returns per-platform `{status:'failed'}` and never throws (src/integrations/index.ts:308-315); both callers ignore the return. `publishAction` calls `lifecycle.markPublished` *before* publishing.
- **Fails:** Ayrshare returns 400 for an unlinked account (routine) → status becomes `published`, an audit entry is written, and the wizard says "live on all platforms" while nothing was posted. Dropped forever, no retry.
- **Fix:** Inspect the results array; publish first, then mark published only on success; persist per-platform failures for retry/alerting. **M**

#### SEC-4 — Cron auth is `Bearer undefined` when `CRON_SECRET` unset
- **Location:** src/app/api/cron/publish/route.ts:9; src/app/api/cron/billing-sync/route.ts:8-11 (merges BILL-5, cron portion of INT-9) · **Verdict:** CONFIRMED
- Both compare the header to `` `Bearer ${process.env.CRON_SECRET}` ``; if unset, the expected value is literally `"Bearer undefined"`, which anyone can send. `CRON_SECRET` is not in `.env.example`.
- **Fails:** Deploy without `CRON_SECRET` → `curl -H 'Authorization: Bearer undefined' …/api/cron/publish` triggers publishing of all due items and Stripe meter syncs, unauthenticated; can also be spammed to trigger the BILL-4 double-billing race.
- **Fix:** Return 401 when `CRON_SECRET` is falsy before comparing; constant-time compare; add `CRON_SECRET` to `.env.example`. **S**
- *Note:* The monitoring routes (ingest/campaigns) use `SUPABASE_SERVICE_ROLE_KEY` as the bearer, which must be set for the app to function — so the "undefined" bypass is unreachable there. That's downgraded to SEC-5 (poor practice), not a P0.

#### DATA-4 — Migrations seed a super-admin with password `changeme123` into any DB
- **Location:** supabase/migrations/003_auth.sql:33-55 (merges SEC-9) · **Verdict:** CONFIRMED
- 001/002 seed demo campaigns/users/content/usage; 003 bcrypt-hashes `changeme123` onto `u-admin` (super_admin) + `u-alex`/`u-sarah`/`u-mike` with fixed emails. It's an ordinary numbered migration with no environment gate (only `WHERE password_hash IS NULL`).
- **Fails:** A production migration run creates a known-credential super-admin (`admin@commandcenter.local` / `changeme123`) controlling every campaign, plus fake usage rows that pollute stats. (Confirmed live: these accounts log in on the running app.)
- **Fix:** Move all seed/demo inserts and credential updates out of numbered migrations into a dev-only seed script; require a real bootstrap for the first super-admin. **M**

### P1 — Must fix before launch

#### SEC-11 — `decideAction` approves with no permission check
- **Location:** src/app/actions.ts:198-206 (from TEST-4) · **Verdict:** CONFIRMED (verifier flagged as borderline P0)
- Calls `lifecycle.approve()` with no `can(s.role,'approve')` gate, unlike scheduleAction/publishAction/approveTextAction; `lifecycle.approve` performs no role check either.
- **Fails:** A `staff` user calls `decideAction(id,'approve','')` → an approval record is written and the item moves to `approved`, satisfying the schedule gate and defeating the human-approval separation. This is the privilege-escalation root behind the gate bypasses.
- **Fix:** Add `can(s.role,'approve')` to `decideAction`. **S**

#### SEC-3 — Content detail + audit log readable across campaigns
- **Location:** src/app/content/[id]/page.tsx:19 · **Verdict:** CONFIRMED
- `getContentItem(params.id)`/`getAuditEntries(params.id)` query by id only; `s.campaignId` is used only for the profile, never to gate the item. IDs are 8-char base36 (weakly enumerable).
- **Fix:** `notFound()` unless `item.campaignId === s.campaignId`. **S**

#### DATA-3 — `approveTextAction`/`confirmVideoAction` raw status writes, no validation
- **Location:** src/app/actions.ts:351, 384 · **Verdict:** CONFIRMED
- Both write `status` with raw updates, never consulting `TRANSITIONS`, no ownership check. `approveTextAction` can move any status (incl. published/archived) → `scheduled`; `confirmVideoAction` moves non-AI content to `scheduled` with no approval record.
- **Fix:** Validate ownership and allowed source statuses (route through lifecycle); require/record an approval before `scheduled`. **M**

#### INT-11 — Cron publish can double-post
- **Location:** src/app/api/cron/publish/route.ts:14-45 (merges DATA-5) · **Verdict:** CONFIRMED
- No claim/lock; selects `status='scheduled'`, publishes, then updates (error unchecked). A crash between publish and update, or two overlapping 5-min runs, republishes.
- **Fix:** Atomically claim rows (`update … set status='publishing' where status='scheduled' … returning`), check the write error, then publish; cap batch size. **M**

#### INT-3 — Mock providers silently activate in production
- **Location:** src/lib/services.ts:24-46 · **Verdict:** CONFIRMED
- Each provider falls back to a mock on env-key absence with no prod guard/log/UI signal; `MockPublisher` returns `'scheduled'` for every platform.
- **Fails:** A forgotten `AYRSHARE_API_KEY` in prod → every publish "succeeds", content marked published, nothing posted, nobody told.
- **Fix:** In production, throw/return errors when a key is missing instead of instantiating mocks; surface "demo mode" if ever intentional. **S**

#### INT-4 — HeyGen status errors swallowed as "processing"; client polls forever
- **Location:** src/integrations/index.ts:153-162; src/components/ContentWizard.tsx:119-133 · **Verdict:** CONFIRMED
- `getVideoStatus` never checks `res.ok`; 401/404/429 → `status` undefined → returns `{status:'processing'}`. The client poll has no max-attempts/deadline.
- **Fix:** Check `res.ok` and throw/return `failed` on non-200/unknown; add a max poll duration with a "check later" state. **S**

#### INT-5 — Video job id only in client state → $50 generation orphaned
- **Location:** src/components/ContentWizard.tsx:87-88; src/app/actions.ts:298-311 · **Verdict:** CONFIRMED
- `generateVideoAction` charges $50 and records the videoId only in an audit blob; the wizard holds it in `useState`. A refresh loses it; the item resets and the button reappears → re-generation costs another $50.
- **Fix:** Persist the pending videoId + status on the content item; hydrate the wizard and resume polling on load. **M**

#### INT-6 — Voice synth ignores the campaign voice
- **Location:** src/app/actions.ts:331; src/integrations/index.ts:253 · **Verdict:** CONFIRMED
- `synthesizeVoiceAction` calls `synthesize({text})` without loading `profile.elevenLabsVoiceId`, so it falls back to the global env voice or hardcoded `'EXAVITQu4vr4xnSDxMaL'`. `.env.example` also ships concrete real IDs.
- **Fix:** Pass the campaign's `elevenLabsVoiceId`; hard-fail when none configured; blank the IDs in `.env.example`. **S**

#### INT-7 — ElevenLabs voice id sent to HeyGen as `voice_id`
- **Location:** src/app/actions.ts:301; src/integrations/index.ts:141 · **Verdict:** CONFIRMED
- Passes `profile?.elevenLabsVoiceId` as HeyGen's `voice.voice_id` — different provider namespaces; the profile has no HeyGen voice field. Unset → global `HEYGEN_VOICE_ID`.
- **Fails:** With an ElevenLabs voice set, HeyGen 400s ("voice not found") and video always fails; unset, every campaign is narrated by whoever `HEYGEN_VOICE_ID` points at.
- **Fix:** Add a per-campaign `heygenVoiceId` (or an explicit ElevenLabs→HeyGen mapping); refuse the global fallback. **M**

#### INT-8 — ElevenLabs upload error ignored → dead URL, still charged
- **Location:** src/integrations/index.ts:272-274 · **Verdict:** CONFIRMED
- `storage.upload` `{error}` is never checked; `getPublicUrl` fabricates a URL regardless. A failed upload still returns a dead `audioUrl` and the action records the $20 charge.
- **Fix:** Check the upload error and throw before charging. **S**

#### DATA-7 — Supabase write errors ignored across repos/actions
- **Location:** src/lib/repos.ts:46 (setStatus), 53-62 (approvalRepo.add), 73-82 (disclosureRepo.add), 99-110 (auditRepo.append); inserts in src/app/actions.ts · **Verdict:** CONFIRMED
- supabase-js reports failures via `{error}` without throwing; these paths never check it (only the Stripe webhook does). A failed write silently desyncs lifecycle/audit state while the action reports success.
- **Fix:** Add a helper that throws on `error`; wrap every mutation. **M**

#### DATA-8 — Scheduled time parsed in server TZ; `timezone` column never applied
- **Location:** src/app/actions.ts:571 · **Verdict:** CONFIRMED
- `new Date(scheduledAt).toISOString()` interprets a naive datetime in the server TZ (UTC on Vercel); the stored `timezone` (migration 005) is never used by the publish cron or `getScheduledToday`.
- **Fails:** A California user scheduling "10:00 AM PT" is stored as 10:00 UTC and published at 3:00 AM PT — 7 hours early.
- **Fix:** Convert the naive datetime to UTC using the submitted IANA timezone before storing. **S**

#### BILL-2 — Plan change cancels sub without invoice/prorate
- **Location:** src/app/admin/actions.ts:107-120 · **Verdict:** CONFIRMED
- `stripe.subscriptions.cancel(...)` with no `invoice_now`/`prorate`, then creates a fresh sub. Un-invoiced metered usage is dropped and the customer gets no proration credit while the new sub bills a full period.
- **Fix:** Cancel with `{invoice_now:true, prorate:true}`, or update the existing sub's items instead of cancel-and-recreate. **S**

#### BILL-3 — First sync bills all pre-subscription usage
- **Location:** src/app/api/cron/billing-sync/route.ts:35; src/domain/billing.ts:19 · **Verdict:** CONFIRMED
- With no cursor row, `since` falls back to `1970-01-01`; `BillingGate.check` returns early when status is null, so usage accrues with no plan; `assignPlanAction` never seeds the cursor.
- **Fails:** A campaign spends $80 before any plan → admin assigns Starter → first sync reports all historical usage, instantly consuming the allowance and generating overage for pre-subscription usage.
- **Fix:** Seed `usage_sync_cursor.last_synced_at = now()` when the subscription is created. **S**

#### BILL-4 — Concurrent billing-sync runs double-bill
- **Location:** src/app/api/cron/billing-sync/route.ts:29-90 · **Verdict:** CONFIRMED
- No lock/single-flight; two overlapping runs read the same cursor, compute different `until` → different idempotency keys (`buildSyncKey` includes `until`) → both send meter events over the overlapping range. Stripe's identifier dedup can't collapse different keys.
- **Fix:** Per-campaign advisory lock before reading the cursor; conditional cursor upsert so a concurrent run aborts. **M**

#### UX-1 — Dashboard vs Billing show contradictory spend limits
- **Location:** /dashboard ("$54.00 / $250.00 · 22%") vs /billing ("$54.00 used of $25.00 included") · **Verdict:** observed live
- The same spend reads as 22%-of-cap on the dashboard but over-the-$25-allowance on billing, with no explanation of the difference.
- **Fix:** Show "included allowance" (per billing period) and "hard spend cap" explicitly and consistently on both screens, over the same window. Root cause is BILL-11. **M**

#### TEST-1/2/3/5/6 — Untested critical paths
- **Verdict:** CONFIRMED (code review)
- TEST-1 (content-lifecycle.ts:50): the hard gate (approval + AI-disclosure before scheduling) has zero tests. **S**
- TEST-2 (disclosure.ts:33): jurisdiction rules + `combineDisclosureText` untested. **S**
- TEST-3 (webhooks/stripe/route.ts:22): webhook idempotency/retry/duplicate handling untested. **M**
- TEST-5 (cron/billing-sync/route.ts:39): pending-key retry + `_reserved` exclusion (double-billing protection) untested. **M**
- TEST-6 (admin/actions.ts:82): `assignPlanAction` (creates/cancels real Stripe subs) untested. **M**
- **Fix:** Add the targeted unit/route tests described per finding in `worksheets/07-coverage.md`; several of the P0/P1 code fixes above should land with their own regression tests.

### P2 — Should fix

- **SEC-5** (monitoring/ingest/route.ts:8): service-role DB key doubles as the ingest bearer token, shared with external n8n. Mint a dedicated `MONITORING_INGEST_SECRET`; timing-safe compare. **S**
- **SEC-6** (actions.ts:416): `generateFromMonitoringAction` reads `monitoring_results` by id without campaign scoping. Add `.eq('campaign_id', s.campaignId)`. **S** · CONFIRMED (verifier)
- **SEC-7** (migrations): no RLS anywhere; app layer is the only tenant boundary (amplifies SEC-1/2/3/6). Enable campaign-scoped RLS as a backstop. **L**
- **SEC-10** (actions.ts:29): no login rate limiting/lockout — brute-force against known seed emails. Add per-IP/account throttling. **M**
- **INT-10** (heygen/avatars, elevenlabs/voices, actions.ts:318; merges SEC-8): unauthenticated proxy endpoints + `getVideoStatusAction` expose provider data and burn rate limits. Add session checks + campaign scoping. **S**
- **INT-12** (n8n-opposition-monitoring.json:48,18): workflow reads only `$input.first()` and hardcodes `localhost:3001`; all nodes `continueOnFail` → silent failure. Iterate `$input.all()`; configurable base URL; error branch. **M**
- **INT-13** (index.ts:148-150 et al.): providers call `res.json()` before checking status and coerce missing IDs to `''`. Parse defensively; throw on missing required fields before recording usage. **M**
- **INT-14** (index.ts:240; actions.ts:666-676): avatar status is an unvalidated cast that strands avatars in "training"; failed creation still returns `ok:true`. Validate status; return `ok:false` on failure. **S**
- **BILL-6** (webhooks/stripe/route.ts:70-90): events with no matching campaign are acked and dedup-recorded, permanently dropping the transition on retry. Return non-2xx and skip the insert. **S** · CONFIRMED (verifier)
- **BILL-7** (webhooks/stripe/route.ts:36-69): no out-of-order protection; a stale `active` after `past_due` regresses status and clears the grace period. Compare `event.created` or re-fetch the subscription. **M** · CONFIRMED (verifier)
- **BILL-8** (cron/billing-sync/route.ts:46-59): app-clock `until` vs DB `created_at` can skip rows at the window boundary permanently. Use a safety lag from the DB clock. **S** · CONFIRMED (verifier)
- **BILL-9** (actions.ts:296-315/328-337/757-781): video/voice/prompt-look never release the usage reservation on provider failure (unlike `generateDraftAction`). Wrap in try/finally; record cost 0 on failure. **S** · CONFIRMED (verifier)
- **BILL-10** (admin/actions.ts:203; merges DATA-19): plan `seat_limit` never enforced on add-user/invite. Count seats and reject at capacity. **M**
- **BILL-13** (repos.ts:144-160; merges DATA-9): `finalize()` is a non-atomic delete+insert matching reservations by cost — a crash loses the spend; equal-cost races mismatch. Move into one plpgsql transaction keyed on the reservation id. **M** · CONFIRMED (verifier)
- **DATA-11** (actions.ts:82): invite-code single-use is check-then-act; concurrent redemptions both succeed. Claim atomically (`… where code=? and used_at is null`). **S** · CONFIRMED (verifier)
- **DATA-12** (admin/actions.ts:232; avatars.ts:75-77): user/avatar deletes silently no-op when FKs block them, reporting success while the row persists (a "removed" user still passes `getSession`). Check delete errors; set an ON DELETE policy. **M** · CONFIRMED (verifier)
- **DATA-13** (disclosure.ts:33): `blackout_days_before_election` is stored and admin-editable but never enforced — an advertised compliance gate that doesn't exist. Enforce it (needs a per-campaign election date) or remove it until real. **M**
- **DATA-14** (store.ts:4): `Math.random` 8-char PKs + unchecked inserts → collision risk and guessable invite codes. Use `crypto.randomUUID()`/`gen_random_uuid()` and check insert errors. **S**
- **UX-2** (/avatars): avatars are indistinguishable ("Default avatar", no name/thumbnail/date in list rows). Add names, thumbnails, dates. **M**
- **UX-3** (/settings): profile form accepts arbitrary free text (observed "party: congress") with no validation; garbage flows into AI prompts. Add inline validation/constraints. **M**
- **TEST-7** (usage.test.ts:8): cap-concurrency tests assert a hand-written fake, not the real `reserve_usage` RPC. Add a pgTAP/integration test against the real function. **L**
- **TEST-8** (actions.ts:184): draft/video/voice metered billing behavior untested. Extend the actions test file. **M**
- **TEST-11** (package.json:10): no CI runs the suite. Add a GitHub Actions workflow (`npm ci && typecheck && test`). **S**
- **TEST-BUILD-1** (src/app/layout.tsx): `next/font/google` fetches Manrope at build time; any environment without Google Fonts egress fails the build (observed here). Self-host the font via `next/font/local`. **S**

### P3 — Polish

- **BILL-11** (013_atomic_usage_guard.sql:27 vs data.ts:121; merges DATA-15): cap uses calendar month (DB UTC), spend display uses server-local month, Stripe allowance resets on the billing anchor — three windows. Root cause of UX-1. Window everything on `current_period_end`; align the TS helpers to UTC. **M**
- **BILL-12** (billing/page.tsx:37-44): the "Billing inactive" banner only covers `canceled`/`unpaid`, not `incomplete_expired`/`paused` which the gate also blocks. Share the `INACTIVE_STATUSES` set. **S**
- **DATA-16** (actions.ts:449): `content_items.type` unconstrained; `generateFromMonitoringAction` persists a client-supplied string. Validate against the `ContentType` union + CHECK constraint. **S**
- **DATA-17** (monitoring/ingest/route.ts:36): dedupe is check-then-insert with no unique index; concurrent ingests duplicate. Add a partial unique index + upsert. **S**
- **DATA-18** (010_billing.sql:37): `billing_events` blocks campaign deletes while others cascade; author columns are unconstrained text; `super_admin`'s null `campaign_id` contradicts the non-null `Session`/`User` types. Add ON DELETE policies/FKs; model `campaignId: string | null`. **M**
- **TEST-9** (avatars.test.ts:10, candidate.test.ts:10): tests assert only `typeof fn === 'function'` — false coverage. Replace with behavior tests or delete. **S**
- **TEST-10** (permissions.test.ts:4): `super_admin` isn't pinned (all-deny appears intentional via `requireAdminSession`). Add explicit assertions. **S**
- **UX-4** (/monitoring): excerpts truncate mid-word with no ellipsis. Use CSS line-clamp or a read-more toggle. **S**
- **UX-5** (/monitoring): feed surfaces off-topic items; credibility is a flat "Medium". Tighten the query to campaign entities/geo; make credibility vary. **M**
- **FLOW-1** (/admin): a logged-in non-admin hitting /admin is redirected to /login (session stays valid), reading as an unexpected logout. Redirect to /dashboard or show a 403. **S**

---

## Dimension coverage statement

- **Security & auth** — Examined session handling, permission gates on all server
  actions and API routes, RLS posture, invite/join, webhook signatures, secret
  handling. Found SEC-1…SEC-11. **Verified clean:** session token integrity
  (HMAC + timingSafeEqual, prod re-validation), cookie flags, login timing-safe
  enumeration defense, webhook signature verification, admin-surface gating
  (confirmed live), no client secret leakage, no SQL injection, bcrypt password
  handling.
- **Data integrity** — Examined all 14 migrations vs code, race conditions,
  lifecycle states, partial-failure handling, referential integrity. Found
  DATA-2…DATA-18. **Verified clean:** in-memory store fully retired; schema/code
  column mapping valid through migration 014; usage-sync cursor idempotency;
  webhook write ordering for at-least-once delivery.
- **Billing** — Examined webhook coverage, metering accuracy, spend caps, plan
  changes, sync cron. Found BILL-2…BILL-13. **Verified clean:** signature
  verification, the `reserve_usage` advisory-lock cap race (genuinely closed),
  webhook DB-write failure handling, `_reserved` exclusion from sync/displays,
  grace-period logic, Stripe SDK usage for the pinned v22.3.0.
- **Integration robustness** — Examined all providers' failure/timeout/shape
  handling, polling, mock seams, cron publish, n8n workflow. Found INT-1…INT-14.
  **Verified clean:** Claude generator refusal handling + usage-in-finally;
  pure helper modules; elevenlabs/voices non-200 degradation. **Note:**
  `NewsDataMonitoringSource` is dead code (monitoring runs only via n8n).
- **Core flows (browser)** — Walked login, dashboard, content list/detail,
  monitoring, avatars, billing, settings, admin (as non-admin), mobile 390px.
  All rendered without console errors. Found FLOW-1/FLOW-2. Happy-path publish
  intentionally not run live (side-effect constraint); covered by code findings.
- **UX heuristics (browser)** — Reviewed every screen at desktop + mobile for
  hierarchy, consistency, empty/loading/error states, copy, responsiveness.
  Found UX-1…UX-5. Strong overall visual system and mobile handling.
- **Test & build health** — typecheck PASS; 96/96 tests PASS; production build
  fails only on the Google Fonts network dependency (TEST-BUILD-1). Coverage
  gaps captured as TEST-1…TEST-11.

## Verification adjustments (nothing silently dropped)

- **SEC-4/INT-9 (monitoring portion):** DOWNGRADED from P2 to P3/SEC-5 — the
  "Bearer undefined" bypass is unreachable on the monitoring routes because their
  bearer (`SUPABASE_SERVICE_ROLE_KEY`) must be set for the app to run. The cron
  portion remains P0.
- **SEC-11 (decideAction):** verifier flagged it as borderline P0 (privilege-
  escalation root); kept at P1 but noted as the enabler for the gate bypasses.
- No candidate finding was rejected outright; all P0/P1 candidates were confirmed.

## Suggested fix phases

1. **Phase 1 — Tenant isolation & the gate (P0/P1 security+data):** SEC-1, SEC-2,
   SEC-3, SEC-11, DATA-2, DATA-3, DATA-7 + tests TEST-1, TEST-2. Add a shared
   ownership+permission helper and route all status changes through the lifecycle.
2. **Phase 2 — Make the pipelines real (P0/P1 integrations+billing):** INT-1,
   INT-2, INT-3, INT-11, SEC-4, BILL-2, BILL-3, BILL-4 + tests TEST-3, TEST-5,
   TEST-6. Then stand up staging so the publish path can be regression-tested
   (FLOW-2).
3. **Phase 3 — Provider robustness & money hygiene (P1/P2):** INT-4…INT-8,
   INT-10, INT-12…INT-14, BILL-6…BILL-13, DATA-8, DATA-11, DATA-12, DATA-14,
   SEC-5/6/7/10.
4. **Phase 4 — UX & polish (P1/P2/P3):** UX-1, UX-2, UX-3, UX-4, UX-5, FLOW-1,
   BILL-11/12, DATA-13/16/17/18, TEST-7/8/9/10/11, TEST-BUILD-1, and the
   `.env.example` real-ID cleanup.
