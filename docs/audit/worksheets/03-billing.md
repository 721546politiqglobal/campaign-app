# Candidate findings — billing — unverified

### BILL-1 — Billing-sync cron never scheduled → metered usage never reported to Stripe
- **Severity:** P0 · **Location:** vercel.ts:1-3
- Only cron config is vercel.ts (registers just /api/cron/publish); no schedule for billing-sync, AND Vercel reads vercel.json not vercel.ts so neither is registered.
- Fail: campaigns rack up usage ($50 video, $20 voice, LLM), meterEvents.create never fires, Stripe invoices only flat fee — all overage revenue silently lost.
- Fix: vercel.json with both crons incl `{path:'/api/cron/billing-sync', schedule:'0 * * * *'}`. Effort: S
- (Same root cause as INT-1 — merge.)

### BILL-2 — Plan change cancels old subscription without invoicing accrued usage or prorating
- **Severity:** P1 · **Location:** src/app/admin/actions.ts:107-120
- assignPlanAction cancels old sub with no invoice_now/prorate, then creates fresh. Stripe discards uninvoiced metered usage; no proration credit; new sub bills full period.
- Fail: Pro campaign 20 days in with $60 synced usage → Enterprise → pending usage never invoiced (revenue lost) + full new flat fee on top of overlapping days (customer overcharged).
- Fix: cancel with {invoice_now:true, prorate:true}, or update existing sub items instead of cancel-and-recreate. Effort: S

### BILL-3 — First sync after plan assignment bills all pre-subscription usage (cursor defaults to 1970)
- **Severity:** P1 · **Location:** cron/billing-sync/route.ts:35 + src/domain/billing.ts:19
- No cursor row → since falls back to '1970-01-01'. BillingGate.check returns early when status null, so campaigns accrue usage with no plan (default cap $1000). assignPlanAction never seeds cursor.
- Fail: campaign spends $80 before any plan → admin assigns Starter → first cron sums everything since 1970, instantly consuming allowance + overage for pre-subscription usage. Seed rows (001:153-157) billed same way.
- Fix: assignPlanAction upserts usage_sync_cursor.last_synced_at=now() at subscription time. Effort: S

### BILL-4 — Concurrent billing-sync runs double-bill overlapping usage ranges
- **Severity:** P1 · **Location:** cron/billing-sync/route.ts:29-90
- No lock/single-flight. Two overlapping runs read same cursor, compute different until → different idempotency keys (buildSyncKey includes until) → both send meter events over overlapping range. Stripe dedup can't help (keys differ).
- Fail: slow run overlaps next tick → both report same $40 with distinct identifiers → billed $80. Also pending_key retry firing days later (past Stripe's ~24h dedup window) double-bills.
- Fix: per-campaign advisory lock before reading cursor; conditional cursor upsert so concurrent run aborts. Effort: M

### BILL-5 — Missing CRON_SECRET turns billing-sync auth into constant-string bypass
- **Severity:** P1 · **Location:** cron/billing-sync/route.ts:8-11
- Unset CRON_SECRET → expected 'Bearer undefined', any caller can send.
- Fail: attacker sends Bearer undefined concurrently → exposes campaign IDs/sync results + deliberately triggers BILL-4 race to inflate bills.
- Fix: return 401 when CRON_SECRET falsy before comparing. Effort: S
- (Same root cause as SEC-4/INT-9 — merge.)

### BILL-6 — Webhook acks and permanently dedupes events whose campaign lookup fails
- **Severity:** P2 · **Location:** webhooks/stripe/route.ts:70-90
- When no campaign matches stripe_subscription_id, handler logs, still inserts event into billing_events, returns 200. Dedup (22-32) then skips Stripe retries forever.
- Fail: subscription.updated races ahead of assignPlanAction's DB write → status transition dropped permanently; campaign stuck incomplete/past_due in app despite active in Stripe.
- Fix: return non-2xx (and skip billing_events insert) for subscription events with no matching campaign. Effort: S

### BILL-7 — No out-of-order protection: stale subscription.updated can regress status and clear grace period
- **Severity:** P2 · **Location:** webhooks/stripe/route.ts:36-69, 22-32
- Stripe doesn't guarantee order; handler applies last-arriving event without comparing event.created. computeSubscriptionUpdate sets gracePeriodEndsAt=null for any non-past_due. Idempotency guard is check-then-insert with errors logged → concurrent duplicates both process.
- Fail: A(active,10:00) and B(past_due,10:01) delivered B-then-A → campaign written back to active, grace cleared, un-blocking delinquent account; grace clock later restarts from scratch.
- Fix: persist applied event.created per campaign, ignore older; or re-fetch subscription from Stripe. Effort: M

### BILL-8 — Usage events can be permanently skipped at the sync window boundary
- **Severity:** P2 · **Location:** cron/billing-sync/route.ts:46-59, 84-89
- until from app clock (new Date()), created_at from Postgres clock. Row with created_at<=until committing after the SELECT (clock skew/in-flight insert) is missed, and cursor advances to until, so gt('created_at',since) excludes it forever.
- Fail: DB clock 2s behind → $50 video row finalized in window → never summed → never billed.
- Fix: compute until with safety lag (now()-1min, ideally DB clock). Effort: S

### BILL-9 — Video/voice/prompt-look actions never release usage reservation on provider failure
- **Severity:** P2 · **Location:** src/app/actions.ts:296-315 (video), 328-337 (voice), 757-781 (prompt look)
- These guard() (insert _reserved via reserve_usage) and only record() after provider success. If provider throws, finalize never called — violates usage.ts:9-11 contract. generateDraftAction does it right with finally.
- Fail: HeyGen errors → $50 _reserved blocks cap headroom 5 min; near cap legit requests get CapExceeded; orphaned _reserved row never deleted, accumulates forever.
- Fix: try/finally, record costCents 0 on failure; cleanup expired _reserved rows. Effort: S

### BILL-10 — Plan seat limits defined but never enforced
- **Severity:** P2 · **Location:** src/app/admin/actions.ts:203-230 (addUserAction), 24-38 (generateInviteAction)
- billing_plans.seat_limit + PLAN_DEFINITIONS.seatLimit (Starter=3, Pro=10) exist but no path checks them.
- Fail: Starter (3 seats) adds 25 users via invites → Pro/Enterprise seating for free.
- Fix: count current users against plan seat_limit in addUserAction + invite creation/redemption. Effort: M

### BILL-11 — Internal cap uses calendar month; Stripe allowance resets per billing period
- **Severity:** P3 · **Location:** 013_atomic_usage_guard.sql:27 vs src/app/admin/billing/actions.ts:49-52; display billing/page.tsx:50-53
- reserve_usage caps per date_trunc('month',now()) UTC; getMonthlySpend uses app local-time month; Stripe free tier resets on billing anchor. Three windows.
- Fail: sub anchored on 20th → usage 1st-19th counts against fresh internal cap but tails previous Stripe period → "used of included" shows headroom while Stripe charges overage.
- Fix: window cap + display on campaigns.current_period_end; at minimum align getMonthlySpend to UTC. Effort: M

### BILL-12 — No billing-page messaging for paused/incomplete_expired campaigns the gate blocks
- **Severity:** P3 · **Location:** billing/page.tsx:37-44 vs src/domain/billing.ts:12
- Gate blocks canceled/unpaid/incomplete_expired/paused; page only shows "Billing inactive" for canceled/unpaid.
- Fail: incomplete_expired (auto after ~23h on default_incomplete subs) blocks all actions with generic errors while billing page looks fine.
- Fix: extend banner to full INACTIVE_STATUSES set (share constant). Effort: S

### BILL-13 — finalize() is non-atomic and matches reservations heuristically by cost
- **Severity:** P3 · **Location:** src/lib/repos.ts:144-160
- finalize deletes oldest _reserved matching (campaign, cost=reservedCents) then inserts real row as two statements. Can delete another request's equal-cost reservation; crash between delete and insert loses the spend.
- Fail: crash between delete (155) and insert (158) after $50 video → reservation gone, no usage row → free usage, never capped or synced.
- Fix: single plpgsql fn (delete+insert one transaction), key on reservation row id. Effort: M

## CLEAN
- Webhook signature verification (route.ts:8-20); cap enforcement race genuinely closed by reserve_usage advisory lock + all 5 metered actions gate before spending; webhook DB-write failure returns 500 before recording so Stripe retries (67-69); _reserved rows excluded from sync + displays; grace-period logic (billing-webhook.ts) with tests; Stripe SDK usage valid for pinned v22.3.0, meter/tiered-price setup semantically correct.
