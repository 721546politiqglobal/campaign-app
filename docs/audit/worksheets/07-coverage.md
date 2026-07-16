# Candidate findings — test coverage — unverified

### TEST-1 — Content lifecycle hard gate (approval + AI disclosure before scheduling) has zero tests
- **Severity:** P1 · **Location:** src/domain/content-lifecycle.ts:50
- schedule() is the "HARD GATE"; no test imports ContentLifecycle/GateError or exercises TRANSITIONS. Entire state machine + both gate checks untested.
- Fail: refactor inverting hasApproval, dropping isAiGenerated disclosure check, or adding draft→scheduled to TRANSITIONS passes full suite; unapproved/undisclosed AI content becomes schedulable.
- Fix: content-lifecycle.test.ts with in-memory repo fakes covering the gates and illegal transitions. Effort: S

### TEST-2 — DisclosureEngine jurisdiction rules and text combination untested
- **Severity:** P1 · **Location:** src/domain/disclosure.ts:33
- requiredFor() and combineDisclosureText() have no tests; feed attachDisclosureAction and published disclosure text.
- Fail: dropping `!rule.requiresAiLabel` continue or breaking DEFAULT_LABEL fallback ships silently; AI post publishes with wrong/empty legally-required disclosure.
- Fix: disclosure.test.ts with stub rules repo covering all branches. Effort: S

### TEST-3 — Stripe webhook idempotency and failure-retry semantics untested
- **Severity:** P1 · **Location:** src/app/api/webhooks/stripe/route.ts:22
- billing-webhook.test.ts covers only computeSubscriptionUpdate. Route's dedup lookup, 500-before-record-so-Stripe-retries, event insert last, and SELECT-error-continues-anyway edge all untested.
- Fail: reordering the billing_events insert or swallowing updateError passes suite; redelivered subscription.deleted double-processes or a lost update permanently skipped.
- Fix: route-level test mocking constructEvent + adminDb for duplicate/error/success/bad-sig. Effort: M

### TEST-4 — Action-level permission enforcement untested; decideAction in fact lacks the approve check
- **Severity:** P1 · **Location:** src/app/actions.ts:198
- permissions.test.ts tests only pure can(). decideAction (198-206) calls lifecycle.approve() with NO can(s.role,'approve') check, unlike scheduleAction/publishAction/approveTextAction.
- Fail: staff calls decideAction(id,'approve','') → approval row written, content→approved; manager then schedules it, defeating human-approval separation. **This is a real permission hole, not just a coverage gap.**
- Fix: add the missing can(s.role,'approve') check to decideAction, then action-level permission tests. Effort: S

### TEST-5 — Billing-sync cron double-billing protections untested
- **Severity:** P1 · **Location:** src/app/api/cron/billing-sync/route.ts:39
- pending_key/pending_until reuse on retry, _reserved exclusion, persist-intent-before-Stripe cursor all untested; billing-sync.test.ts only tests sumUsageCents/buildSyncKey.
- Fail: regenerating a fresh key on retry or dropping .neq('kind','_reserved') passes suite; after a crash the next sync bills the same usage twice.
- Fix: extract per-campaign sync into testable fn; assert key reuse, cursor advance, failure keeps pending, _reserved excluded, zero total → no meter event. Effort: M

### TEST-6 — assignPlanAction (creates/cancels real Stripe subscriptions, resets cap) untested
- **Severity:** P1 · **Location:** src/app/admin/actions.ts:82
- Creates customers, cancels prev subscription on plan change, creates new with two price items + default_incomplete, overwrites cap. Nothing tests admin/actions.ts.
- Fail: dropping subscriptions.cancel → double-billed campaigns; losing payment_behavior → every assignment throws for customers without payment method. Invisible to suite.
- Fix: tests mocking stripe + adminDb for cancel-before-create, correct price ids, campaign row update, no-stripe path. Effort: M

### TEST-7 — Usage-cap concurrency tests assert a hand-written fake, not the real reserve_usage RPC
- **Severity:** P2 · **Location:** src/domain/usage.test.ts:8
- Tests build fakeAtomicRepo that "mirrors" reserve_usage. Actual enforcement is the SQL RPC (013:18) via SupabaseUsageRepo (repos.ts:136), untested.
- Fail: if SQL cap comparison drifts from the fake, tests stay green while concurrent requests overshoot the cap in prod.
- Fix: integration/pgTAP test exercising reserve_usage directly. Effort: L

### TEST-8 — Draft/video/voice metered actions' billing behavior untested
- **Severity:** P2 · **Location:** src/app/actions.ts:184
- avatar-billing.test.ts covers avatar actions; generateDraftAction record-in-finally, generateVideoAction gate→guard→record + no-avatar refusal, synthesizeVoiceAction untested.
- Fail: moving usageMeter.record out of finally passes suite; failed drafts stop being metered, leaving $60 reserve open and blocking cap.
- Fix: extend actions test file. Effort: M

### TEST-9 — avatars.test.ts and candidate.test.ts assert only typeof fn === 'function' (false coverage)
- **Severity:** P3 · **Location:** src/lib/avatars.test.ts:10
- Both only check exports are functions against stubbed adminDb; no behavior asserted, yet modules appear tested.
- Fix: replace with behavior tests or delete. Effort: S

### TEST-10 — super_admin absent from permission-matrix tests; can('super_admin',*) is false for every action
- **Severity:** P3 · **Location:** src/lib/permissions.test.ts:4
- Role includes super_admin but no PERMISSIONS list contains it → can('super_admin',anything)=false. Not pinned by tests. (Appears deliberate: admin routes use requireAdminSession.)
- Fix: assert can('super_admin',action) false for all five, with comment pointing at requireAdminSession. Effort: S

### TEST-11 — No CI runs the test suite
- **Severity:** P2 · **Location:** package.json:10
- test script exists but no .github/workflows and no other CI config; nothing runs the suite on push/PR.
- Fail: a commit breaking BillingGate/cap tests merges and deploys; only caught if someone runs npm test locally.
- Fix: minimal GitHub Actions workflow running npm ci && typecheck && test. Effort: S

## CLEAN
- BillingGate status matrix (billing.test.ts:24-63); UsageMeter domain semantics (usage.test.ts, subject to TEST-7 caveat); computeSubscriptionUpdate (billing-webhook.test.ts); avatar billing actions (actions.avatar-billing.test.ts); integration providers HeyGen+Claude request shapes (index.test.ts); low-risk helpers prompt/credibility/formatDate/billing-catalog.
