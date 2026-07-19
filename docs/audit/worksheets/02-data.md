# Candidate findings — data integrity — unverified

### DATA-1 — saveBodyAction lets any authenticated user rewrite any content item's body in any status
- **Severity:** P0 · **Location:** src/app/actions.ts:342
- Updates body by id, no campaign check, no permission check, no status guard. hasApproval counts any historical approve, so approved/scheduled text can be replaced after sign-off.
- Fail: staff gets item approved → saveBodyAction(id,newBody) while approved/scheduled → cron posts unapproved text. Also cross-tenant.
- Fix: fetch item, require ownership, only allow edits in draft/in_review/rejected (or reset to draft + void approvals). Effort: S
- (Same root cause as SEC-1 — merge, but note the status/approval-void angle.)

### DATA-2 — confirmDisclosureAction jumps any item straight to 'scheduled', bypassing approval gate, state machine, ownership, permissions
- **Severity:** P0 · **Location:** src/app/actions.ts:474
- Sets status='scheduled' via direct DB update (488-490), no lifecycle.schedule() → no hasApproval, no transition validation, no can(role,'schedule'), no ownership. Non-AI → requiredFor returns [], disclosure side is no-op.
- Fail: any user calls confirmDisclosureAction(id) on a draft (own or other campaign's) → scheduled with zero approvals → publishAction/cron pushes it live. Hard gate fully bypassed.
- Fix: route through lifecycle.schedule() after attaching disclosures; add ownership + can(s.role,'schedule'). Effort: S

### DATA-3 — approveTextAction / confirmVideoAction set status directly with no current-status or ownership validation
- **Severity:** P1 · **Location:** src/app/actions.ts:351
- Both wizard actions write status with raw update, TRANSITIONS never consulted, no ownership check. approveTextAction moves non-AI from ANY status (incl published/archived) to scheduled; confirmVideoAction moves non-AI to scheduled without approval record.
- Fail: approver calls approveTextAction on published item → flips to scheduled, republished; or confirmVideoAction produces scheduled→published item with empty approval_records.
- Fix: validate ownership, assert allowed source statuses (route through lifecycle), require/record approval before scheduled. Effort: M

### DATA-4 — Migrations seed demo campaigns + super-admin with hard-coded password into whatever DB they run against
- **Severity:** P0 · **Location:** supabase/migrations/003_auth.sql:33
- 001/002 seed demo campaigns/users/content/usage; 003 assigns changeme123 to u-admin (super_admin) + others with fixed emails. Prod migration → known-credential super-admin + fake usage rows polluting stats.
- Fail: deploy runs migrations on prod → anyone from repo logs in as admin@commandcenter.local/changeme123, controls every campaign; seeded usage_events inflate spend.
- Fix: move seed/demo inserts + credential updates out of numbered migrations into dev-only seed script; real bootstrap for first super admin. Effort: M
- (Overlaps SEC-9 — merge, but note the demo data pollution angle too.)

### DATA-5 — Publish cron posts before marking published, no claim step → retries/overlaps double-publish
- **Severity:** P1 · **Location:** src/app/api/cron/publish/route.ts:30
- publisher.publish first, then status update (36-38) with error never checked. No claim transition, so item stays scheduled if crash/failed-update/overlap.
- Fail: run A publishes, update fails (or run B concurrent read same scheduled rows) → next run re-publishes → post twice+.
- Fix: atomically claim (update set status='publishing' where status='scheduled' returning), check error, then publish; failure status on errors. Effort: M
- (Same root cause as INT-11 — merge.)

### DATA-6 — publishAction marks 'published' before external publish; publisher failure strands content in terminal state
- **Severity:** P1 · **Location:** src/app/actions.ts:237
- markPublished runs before publisher.publish. If publisher throws, DB says published, state machine only allows published→archived, no retry path.
- Fail: Ayrshare 500 → guard rethrows but status already published; item shows live, never posted, cannot re-schedule/re-publish.
- Fix: publish first, mark published only on success (with claim pattern); or compensating rollback on throw. Effort: S
- (Same root cause as INT-2 — merge.)

### DATA-7 — Nearly all Supabase writes ignore returned error → failed writes silently corrupt lifecycle/audit state
- **Severity:** P1 · **Location:** src/lib/repos.ts:46
- supabase-js reports failures via {error} without throwing; setStatus (46-50), approvalRepo.add (53-62), disclosureRepo.add (73-82), auditRepo.append (99-110), avatar writes (avatars.ts:48-77), most inserts in actions.ts (150, 116) never check. Only Stripe webhook does it right.
- Fail: approve() inserts approval, then setStatus fails silently → audit says "approve" but item still in_review; or audit append fails → append-only compliance trail has gaps while action reports success.
- Fix: helper that throws on error, wrap every mutation. Effort: M

### DATA-8 — Scheduled publish time parsed in server timezone; stored timezone column never applied
- **Severity:** P1 · **Location:** src/app/actions.ts:571
- Wizard sends naive datetime-local + tz name; server does new Date(scheduledAt).toISOString() interpreting wall-clock in server TZ (UTC on Vercel); timezone column (005) stored but never used by cron (route.ts:19) or getScheduledToday (data.ts:322-336, server-local midnight).
- Fail: CA user schedules "10:00 AM" America/Los_Angeles → stored 10:00 UTC → cron publishes 3:00 AM Pacific, 7h early.
- Fix: convert naive datetime to UTC using submitted IANA tz on server (Intl/date-fns-tz) before storing. Effort: S

### DATA-9 — UsageRepo.finalize undermines atomic cap guard: unlocked delete-then-insert, crash-loss, cost-only matching
- **Severity:** P2 · **Location:** src/lib/repos.ts:144
- reserve_usage serializes under advisory lock but finalize runs outside it as two statements: delete _reserved (155), insert real cost (158). Between them total understated; crash loses spend; matches by (campaign,kind,cost) with no recency filter.
- Fail: video A finalizes ($50 reservation deleted, insert uncommitted) while B calls reserve_usage → B's SUM misses both → B passes cap → spend exceeds cap by $50; or crash mid-finalize → $50 never billed.
- Fix: finalize_usage SQL fn taking same advisory lock, delete+insert one transaction, match by reservation id. Effort: M
- (Same root cause as BILL-13 — merge.)

### DATA-10 — assignPlanAction no partial-failure handling; webhook permanently consumes events for not-yet-saved subscription
- **Severity:** P2 · **Location:** src/app/admin/actions.ts:107
- Cancels old sub (108), creates new (116), updates campaign row (126) with no DB error check. Create-fails-after-cancel → campaign points at canceled sub; DB-write-fails-after-create → orphaned live sub billing with no record. Webhook for new sub arriving before 126 commits finds no campaign yet is inserted into billing_events → idempotency discards forever.
- Fail: subscriptions.create fires subscription.updated immediately; webhook races admin action, matches no campaign, logs processed → status stays incomplete until later event, activation lost.
- Fix: check DB write error and compensate (cancel just-created sub on failure); skip billing_events insert when no campaign matched. Effort: M
- (Overlaps BILL-6/BILL-2 — merge related.)

### DATA-11 — Invite codes single-use only by convention: check-then-act race lets one code create multiple accounts
- **Severity:** P2 · **Location:** src/app/actions.ts:82
- joinAction reads invite, checks used_at, creates user, then stamps used_by/used_at (116-118) — no conditional update, no transaction, update error ignored. Two concurrent submissions both pass.
- Fail: leaked code redeemed simultaneously by two → both user rows created and signed in; used_by records last writer only.
- Fix: claim atomically first (update ... where code=? and used_at is null), abort unless one row updated; create user after claim. Effort: S

### DATA-12 — User/avatar deletions silently no-op when FKs block them, leaving "deleted" rows live
- **Severity:** P2 · **Location:** src/app/admin/actions.ts:232
- avatars.consent_confirmed_by/created_by reference users(id) with no ON DELETE (009:16-18), so removeUserAction's delete fails for any avatar creator — error discarded, UI reports success. Same for deleteAvatarRow (avatars.ts:75-77): FK guard from candidate_profiles.active_avatar_id fails delete, action still returns ok:true.
- Fail: admin removes user who trained avatar → Postgres rejects → user still exists, passes getSession DB re-check, retains full access while admin believes gone.
- Fix: check delete errors and surface; policy for avatar authorship on user removal (on delete set null / reassign). Effort: M

### DATA-13 — blackout_days_before_election stored + admin-editable but never enforced
- **Severity:** P2 · **Location:** src/domain/disclosure.ts:33
- disclosure_rules.blackout_days_before_election (seeded 60 for US-CA) mapped in 3 places + editable in admin UI, but no schedule/publish path reads it.
- Fail: admin sets 60-day blackout expecting scheduling blocked in window; content schedules/publishes right through — schema advertises a compliance gate that doesn't exist.
- Fix: enforce in lifecycle.schedule/scheduleWithTimeAction (needs per-campaign election date) or remove column+field until real. Effort: M

### DATA-14 — Primary keys generated with Math.random, inserts unchecked: collisions and forged-looking IDs
- **Severity:** P2 · **Location:** src/lib/store.ts:4
- uid() returns 8 base36 chars from Math.random() (~41 bits), used for content_items/avatars/candidate_profiles/monitoring_results PKs; user ids + invite codes same. Insert errors unchecked (DATA-7) so PK collision fails silently.
- Fail: createContentAction hits existing id → insert rejected, error ignored, user redirected to /content/<id> showing someone else's item. Predictable Math.random makes invite codes guessable.
- Fix: crypto.randomUUID() (or gen_random_uuid() defaults) and check insert errors. Effort: S

### DATA-15 — Month window disagrees: SQL cap guard (DB UTC) vs app spend queries (server-local)
- **Severity:** P3 · **Location:** src/lib/repos.ts:126
- monthToDateCents + getMonthlySpend (data.ts:122) use local new Date();setDate(1);setHours(0,0,0,0); reserve_usage uses date_trunc('month',now()) DB TZ. Non-UTC server → windows differ by hours at month boundary.
- Fail: midnight on 1st → settings shows spend reset to $0 while guard still counts last month (or vice versa) → requests rejected against a cap UI says isn't reached.
- Fix: compute month start in UTC (Date.UTC(y,m,1)) to match date_trunc; or single SQL fn. Effort: S
- (Overlaps BILL-11 — merge; BILL-11 adds the Stripe-billing-anchor third window.)

### DATA-16 — content_items.type unconstrained; generateFromMonitoringAction persists client-supplied string
- **Severity:** P3 · **Location:** src/app/actions.ts:449
- No CHECK on content_items.type (001:24); generateFromMonitoringAction inserts contentType straight from client (also cost lookup with ?? 5_00 at 424) → arbitrary strings become type.
- Fail: tampered contentType:"zzz" → row persists invalid type; VIDEO_CONTENT_TYPES.includes treats as non-video, UI labels break.
- Fix: validate contentType against ContentType union server-side + CHECK constraint. Effort: S

### DATA-17 — Monitoring ingest dedupe is check-then-insert with no unique index
- **Severity:** P3 · **Location:** src/app/api/monitoring/ingest/route.ts:36
- Duplicate protection is SELECT (campaign_id,url) then INSERT; no unique index on that pair. Concurrent ingest (n8n fan-out) both pass.
- Fail: two workers deliver same article → both SELECTs empty → two monitoring_results for same URL.
- Fix: partial unique index on (campaign_id,url) + upsert/on conflict do nothing. Effort: S

### DATA-18 — Referential-integrity gaps: billing_events blocks campaign delete; author cols unconstrained; super_admin null campaign_id contradicts types
- **Severity:** P3 · **Location:** supabase/migrations/010_billing.sql:37
- (a) billing_events.campaign_id no ON DELETE while others cascade → campaign with webhook history undeletable, or SQL delete destroys unsynced usage. (b) created_by/approver_user_id/invite created_by/used_by plain text no FK → dangling author ids. (c) users.campaign_id nullable (super_admin) but Session.campaignId/User.campaignId typed non-null string → admin sessions carry null into .eq queries and NOT NULL inserts that fail silently.
- Fix: billing_events.campaign_id on delete set null; add FKs/document soft refs; model campaignId:string|null in Session/User and guard campaign-scoped pages. Effort: M

### DATA-19 — billing_plans.seat_limit never enforced when users added
- **Severity:** P3 · **Location:** src/app/admin/actions.ts:203
- Plans define seat_limit (010:7, catalog 12-14), admin UI displays it, but neither addUserAction nor joinAction counts existing users against limit.
- Fail: Starter (3-seat) owner invites 10 → all join; paid seat count meaningless.
- Fix: on invite creation + redemption count campaign users vs plan seat_limit, reject when full. Effort: S
- (Same as BILL-10 — merge.)

## CLEAN
- store.ts in-memory store fully retired (only uid() remains, see DATA-14); schema/code column mapping all valid through migrations 001-014 (incl 009 drop + 012 re-add), enum literals match CHECK constraints; usage-sync cron idempotency (pending_key/pending_until from 011) correctly consumed; Stripe webhook write ordering correct for at-least-once (unmatched-subscription edge under DATA-10).
