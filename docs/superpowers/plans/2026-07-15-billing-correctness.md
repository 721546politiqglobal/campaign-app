# Billing Correctness Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This plan is TDD: write the failing test, watch it fail, implement, watch it pass.

**Goal:** Close every remaining billing correctness finding from the 2026-07-15 audit — BILL-2, BILL-3, BILL-4, BILL-6, BILL-7, BILL-8, BILL-9, BILL-10, BILL-11, BILL-12, BILL-13 — so that metered usage is billed exactly once, over one consistent window, without lost revenue, double-billing, or dropped webhook transitions. BILL-11 additionally resolves the observed UX-1 (dashboard vs billing show contradictory spend limits) by giving both screens and the cap guard a single spend-window source of truth.

**Architecture:** The billing surface is: pure helpers (`src/lib/billing-webhook.ts`, `src/lib/billing-sync.ts`, `src/lib/billing-catalog.ts`), domain gates (`src/domain/billing.ts`, `src/domain/usage.ts`), two API routes (`src/app/api/webhooks/stripe/route.ts`, `src/app/api/cron/billing-sync/route.ts`), the admin plan/seat actions (`src/app/admin/actions.ts`), the metered server actions (`src/app/actions.ts`), the display layer (`src/app/billing/page.tsx`, `src/app/dashboard/page.tsx`, `src/lib/data.ts`), the repos (`src/lib/repos.ts`), and Postgres functions in `supabase/migrations/`. Most fixes are bounded edits to these files plus four new forward migrations (015–018). The two structural changes are: (a) a single-flight claim on the usage-sync cursor (migration 015), and (b) moving usage finalize into one atomic `finalize_usage` plpgsql function keyed on the reservation id (migration 017), which requires `reserve_usage` to return that id.

**Tech Stack:** Next.js 14 App Router, Supabase (`adminDb` service-role client — reports failures via `{ error }`, does not throw), Stripe Node SDK, Vitest. Server actions return `type Result = { ok: true } | { ok: false; error: string }`. Postgres functions are plpgsql invoked via `adminDb.rpc(...)`.

## Global Constraints

- **No autonomous git commits** — the user reviews and commits (per project memory). Do not run `git commit`/`git push`.
- **Money paths must be covered by tests.** Every task that changes what is billed, when, or how much lands with a failing-first regression test that pins the behavior. SQL-only changes ship with a pgTAP test where a local Postgres exists, and an integration-test note otherwise; the calling route/repo logic is always unit-tested against a mocked `adminDb`/`stripe`.
- **Stripe SDK is pinned at v22.3.0.** In v22, `current_period_end` lives on each `SubscriptionItem` (`sub.items.data[0].current_period_end`), **not** on the `Subscription` object — every code path here already follows that and must keep doing so. Cancel/prorate params (`invoice_now`, `prorate`) and `subscriptions.update` item edits are the v22 shapes; do not introduce APIs from other major versions.
- Idempotency identifiers sent to Stripe (`buildSyncKey`) must stay stable across retries of the same logical range — never recompute a differently-keyed range for usage that may already have landed.
- No path may write `subscription_status` from a stale (out-of-order) webhook, and no path may bill usage that predates the subscription.

## Phase mapping (audit "Phase 3 — money hygiene" + "Phase 4 — polish")

- **Plan lifecycle & revenue:** Task 1 (BILL-2), Task 2 (BILL-3), Task 8 (BILL-10).
- **Sync correctness / no double-bill:** Task 3 (BILL-4), Task 4 (BILL-8), Task 9 (BILL-13).
- **Webhook robustness:** Task 5 (BILL-6), Task 6 (BILL-7).
- **Reservation hygiene:** Task 7 (BILL-9).
- **One spend window + display (resolves UX-1):** Task 10 (BILL-11), Task 11 (BILL-12).

**Migration numbering (forward-only):** 015 = sync single-flight (Task 3), 016 = subscription event ordering column (Task 6), 017 = `reserve_usage` returns id + `finalize_usage` (Task 9), 018 = `reserve_usage` windowed on `current_period_end` (Task 10). **Ordering matters:** 018 does `create or replace function reserve_usage` and must preserve the return-the-reservation-id behavior introduced in 017.

---

### Task 1: Plan change must invoice + prorate, not silently drop usage (BILL-2)

**Files:**
- Modify: `src/app/admin/actions.ts:107-109` (the cancel inside `assignPlanAction`)
- Test: `src/app/admin/actions.plan-change.test.ts` (new)

**Interfaces:**
- Consumes: `stripe.subscriptions.cancel(id, params)` — in SDK v22.3.0 `SubscriptionCancelParams` accepts `{ invoice_now?: boolean; prorate?: boolean }`. Setting both finalizes an invoice for un-reported metered usage and issues a proration credit for the unused flat-fee time before the new subscription starts.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(() => ({ userId: 'u-admin', role: 'super_admin' })) }));

const update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
const upsert = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update, upsert })) } }));

const cancel = vi.fn(() => Promise.resolve({}));
const create = vi.fn(() => Promise.resolve({ id: 'sub_new', status: 'incomplete', items: { data: [{ current_period_end: 1_800_000_000 }] } }));
vi.mock('@/lib/stripe', () => ({
  stripe: { subscriptions: { cancel, create }, customers: { create: vi.fn(() => Promise.resolve({ id: 'cus_1' })) } },
}));
vi.mock('@/lib/data', () => ({
  getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', name: 'C', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_old' })),
  getBillingPlan: vi.fn(() => Promise.resolve({ id: 'starter', stripeFlatPriceId: 'price_flat', stripeMeteredPriceId: 'price_meter', includedUsageCents: 2500 })),
}));

function fd(o: Record<string, string>) { const f = new FormData(); for (const k in o) f.set(k, o[k]); return f; }

describe('assignPlanAction preserves revenue on plan change', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cancels the old subscription with invoice_now + prorate', async () => {
    const { assignPlanAction } = await import('./actions');
    await assignPlanAction(fd({ campaignId: 'c-1', planId: 'starter' }));
    expect(cancel).toHaveBeenCalledWith('sub_old', { invoice_now: true, prorate: true });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/admin/actions.plan-change.test.ts`
Expected: FAIL — `cancel` was called with a single positional arg `'sub_old'` and no params object.

- [ ] **Step 3: Implement** — replace `src/app/admin/actions.ts:107-109`:

```ts
  // Changing plans cancels the old subscription and starts a fresh one.
  // invoice_now finalizes an invoice for un-reported metered usage on the old
  // sub (otherwise that overage revenue is lost); prorate credits the unused
  // portion of the flat fee so the customer isn't charged twice for the period.
  if (campaign.stripeSubscriptionId) {
    await stripe.subscriptions.cancel(campaign.stripeSubscriptionId, { invoice_now: true, prorate: true });
  }
```

- [ ] **Step 4: Run the test and full suite**

Run: `npx vitest run src/app/admin/actions.plan-change.test.ts && npm test && npm run typecheck`
Expected: PASS.

- **Note:** The comment at `actions.ts:104-106` ("simpler than diffing subscription items") stays accurate — cancel-and-recreate with proration is the intended flow; the alternative (`stripe.subscriptions.update` swapping items with `proration_behavior: 'create_prorations'`) is only worth it if we later want to keep one sub id.

### Task 2: Seed the usage-sync cursor on plan assignment so first sync never bills pre-subscription usage (BILL-3)

**Files:**
- Modify: `src/app/admin/actions.ts` (`assignPlanAction`, after the `campaigns` update at line 126-134)
- Modify: `src/app/api/cron/billing-sync/route.ts:35` (harden the default so a missing cursor never means "1970")
- Test: extend `src/app/admin/actions.plan-change.test.ts` (Task 1)

**Interfaces:**
- Produces: an `usage_sync_cursor` row `{ campaign_id, last_synced_at: <now> }` written whenever a subscription is (re)created, so the first cron run's `since` is subscription start, not epoch.

- [ ] **Step 1: Write the failing test** (append to the Task 1 file)

```ts
it('seeds usage_sync_cursor.last_synced_at at ~now when the subscription is created', async () => {
  const before = Date.now();
  const { assignPlanAction } = await import('./actions');
  await assignPlanAction(fd({ campaignId: 'c-1', planId: 'starter' }));
  const cursorCall = upsert.mock.calls.find(c => c[0]?.campaign_id === 'c-1' && 'last_synced_at' in c[0]);
  expect(cursorCall).toBeTruthy();
  const seeded = new Date(cursorCall![0].last_synced_at).getTime();
  expect(seeded).toBeGreaterThanOrEqual(before);
});
```
(Note: the Task 1 `adminDb` mock already exposes `from(...).upsert`.)

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/admin/actions.plan-change.test.ts`
Expected: FAIL — `assignPlanAction` never upserts `usage_sync_cursor`.

- [ ] **Step 3: Implement** — after the `campaigns` update in `assignPlanAction` (i.e. after `src/app/admin/actions.ts:134`, before `revalidatePath`):

```ts
  // Seed the sync cursor to subscription start. Without this the first
  // billing-sync run defaults `since` to 1970 and reports ALL historical
  // usage_events (accrued before any plan existed) to Stripe, instantly
  // consuming the allowance and generating overage for pre-subscription usage.
  await adminDb.from('usage_sync_cursor').upsert({
    campaign_id: campaignId,
    last_synced_at: new Date().toISOString(),
    pending_key: null,
    pending_until: null,
  });
```

- [ ] **Step 4: Harden the cron default** — `src/app/api/cron/billing-sync/route.ts:35`. When a subscribed campaign somehow has no cursor row (created before this fix, or a race), fall back to "now" rather than epoch so we never retro-bill:

```ts
      const since = cursorRow?.last_synced_at ?? new Date().toISOString();
```

- [ ] **Step 5: Run the test and full suite**

Run: `npx vitest run src/app/admin/actions.plan-change.test.ts && npm test && npm run typecheck`
Expected: PASS.

- **Note:** Existing campaigns that predate this fix and have no cursor row also need a one-time backfill (`insert into usage_sync_cursor (campaign_id, last_synced_at) select id, now() from campaigns where stripe_subscription_id is not null on conflict do nothing;`). Record this as an operator step in the PR description — do not run it here.

### Task 3: Single-flight the usage-sync cron so concurrent runs can't double-bill (BILL-4)

**Files:**
- Create: `supabase/migrations/015_usage_sync_lock.sql`
- Modify: `src/app/api/cron/billing-sync/route.ts` (claim before reading the cursor at line 27-33; release in `finally`)
- Test: `src/app/api/cron/billing-sync/route.test.ts` (new), plus a pgTAP note

**Interfaces:**
- Produces: `claim_usage_sync(p_campaign_id text, p_ttl_seconds integer default 300) returns boolean` — atomically claims a per-campaign lease; returns `true` iff this caller now holds it. And `release_usage_sync(p_campaign_id text) returns void`.
- Why not a session/xact advisory lock: the Stripe `meterEvents.create` call happens in JS between DB round-trips, so a transaction-scoped lock can't span it, and Supabase's pooled connections make session-level `pg_advisory_lock` unreliable. A TTL claim column is pooler-safe and self-heals after a crashed run.

- [ ] **Step 1: Write the migration** (`supabase/migrations/015_usage_sync_lock.sql`)

```sql
-- Single-flight guard for the usage-sync cron (BILL-4). Two overlapping runs
-- previously read the same cursor, computed different `until` values, built
-- different idempotency keys (buildSyncKey includes `until`), and both reported
-- the overlapping usage to Stripe — whose identifier dedup can't collapse two
-- different identifiers. A short TTL lease makes only one run active per
-- campaign at a time; the TTL auto-releases a lease orphaned by a crash.
alter table usage_sync_cursor
  add column if not exists sync_lock_until timestamptz;

create or replace function claim_usage_sync(p_campaign_id text, p_ttl_seconds integer default 300)
returns boolean
language plpgsql
as $$
declare v_rows integer;
begin
  insert into usage_sync_cursor (campaign_id, last_synced_at, sync_lock_until)
  values (p_campaign_id, now(), now() + make_interval(secs => p_ttl_seconds))
  on conflict (campaign_id) do update
    set sync_lock_until = now() + make_interval(secs => p_ttl_seconds)
    where usage_sync_cursor.sync_lock_until is null
       or usage_sync_cursor.sync_lock_until < now();
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function release_usage_sync(p_campaign_id text)
returns void
language plpgsql
as $$
begin
  update usage_sync_cursor set sync_lock_until = null where campaign_id = p_campaign_id;
end;
$$;
```

(The `insert ... on conflict do update ... where` returns `row_count = 0` when the lease is still held — no error, no update — which is exactly the "another run owns it" signal. Note the seed insert here uses `now()` for a brand-new row, consistent with Task 2's no-retro-bill rule.)

- [ ] **Step 2: Write the failing route test** (`src/app/api/cron/billing-sync/route.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const meterCreate = vi.fn(() => Promise.resolve({}));

// Minimal chainable query-builder mock: every terminal returns { data, error }.
function makeFrom(fixtures: Record<string, any>) {
  return (table: string) => {
    const rows = fixtures[table];
    const chain: any = {
      select: () => chain, not: () => chain, in: () => chain,
      eq: () => chain, neq: () => chain, gt: () => chain, lte: () => chain,
      maybeSingle: () => Promise.resolve({ data: rows?.single ?? null, error: null }),
      upsert: () => Promise.resolve({ error: null }),
      then: (r: any) => Promise.resolve({ data: rows?.list ?? [], error: null }).then(r),
    };
    return chain;
  };
}

vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(), rpc } }));
vi.mock('@/lib/stripe', () => ({ stripe: { billing: { meterEvents: { create: meterCreate } } } }));

describe('billing-sync single-flight', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = 's'; });

  it('skips a campaign whose sync lease is already held', async () => {
    const supa = await import('@/lib/supabase');
    (supa.adminDb.from as any).mockImplementation(makeFrom({
      campaigns: { list: [{ id: 'c-1', stripe_customer_id: 'cus_1', subscription_status: 'active' }] },
      usage_sync_cursor: { single: { last_synced_at: '2026-07-01T00:00:00Z' } },
      usage_events: { list: [{ cost_cents: 500 }] },
    }));
    rpc.mockResolvedValue({ data: false, error: null }); // claim denied
    const { GET } = await import('./route');
    const res = await GET(new Request('http://x', { headers: { authorization: 'Bearer s' } }) as any);
    const body = await res.json();
    expect(rpc).toHaveBeenCalledWith('claim_usage_sync', expect.objectContaining({ p_campaign_id: 'c-1' }));
    expect(meterCreate).not.toHaveBeenCalled();
    expect(body.results[0]).toMatchObject({ campaignId: 'c-1', synced: false });
  });

  it('reports and releases the lease when it holds the claim', async () => {
    const supa = await import('@/lib/supabase');
    (supa.adminDb.from as any).mockImplementation(makeFrom({
      campaigns: { list: [{ id: 'c-1', stripe_customer_id: 'cus_1', subscription_status: 'active' }] },
      usage_sync_cursor: { single: { last_synced_at: '2026-07-01T00:00:00Z' } },
      usage_events: { list: [{ cost_cents: 500 }] },
    }));
    rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'claim_usage_sync', error: null }));
    const { GET } = await import('./route');
    await GET(new Request('http://x', { headers: { authorization: 'Bearer s' } }) as any);
    expect(meterCreate).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('release_usage_sync', { p_campaign_id: 'c-1' });
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/app/api/cron/billing-sync/route.test.ts`
Expected: FAIL — route never calls `claim_usage_sync`/`release_usage_sync`; `meterCreate` fires even when the lease is contended.

- [ ] **Step 4: Implement** — in `src/app/api/cron/billing-sync/route.ts`, wrap each campaign's body. Replace the `for` loop head (line 27-28) and add the claim/release:

```ts
  for (const campaign of campaigns ?? []) {
    const { data: claimed } = await adminDb.rpc('claim_usage_sync', {
      p_campaign_id: campaign.id,
      p_ttl_seconds: 300,
    });
    if (!claimed) {
      results.push({ campaignId: campaign.id, synced: false, error: 'sync already in progress' });
      continue;
    }
    try {
      // ... existing body (cursor read → compute range → sum → persist intent →
      //     stripe.billing.meterEvents.create → advance cursor) unchanged ...
    } catch (e) {
      results.push({ campaignId: campaign.id, synced: false, error: String(e) });
    } finally {
      await adminDb.rpc('release_usage_sync', { p_campaign_id: campaign.id });
    }
  }
```

(The existing inner `try/catch` at line 28/92 collapses into this outer `try/catch/finally`; keep a single `catch` that pushes the error result.)

- [ ] **Step 5: Run the test + suite**

Run: `npx vitest run src/app/api/cron/billing-sync/route.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: SQL-level verification** — add `supabase/tests/claim_usage_sync.test.sql` (pgTAP) asserting: first `claim_usage_sync('c-1')` → `true`; immediate second → `false`; after `release_usage_sync('c-1')` → `true`; after simulating an expired lease (`update ... set sync_lock_until = now() - interval '1 min'`) a fresh claim → `true`. **If no local Postgres is available**, note in the PR that pgTAP must run in CI/staging against the Supabase branch DB (`pg_prove`), and the JS route test above covers the calling contract in the meantime.

### Task 4: Add a safety lag to the sync window so boundary rows are never permanently skipped (BILL-8)

**Files:**
- Modify: `src/app/api/cron/billing-sync/route.ts:46` (the `until` computation)
- Test: extend `src/app/api/cron/billing-sync/route.test.ts`

**Interfaces:**
- The window is `(since, until]` filtered on `usage_events.created_at` (DB clock). `until` is currently the app wall clock (`new Date().toISOString()`). If the app clock runs ahead of the DB clock, rows whose DB `created_at` falls in `(dbNow, until]` don't exist yet when this run reads them, but the next run's `since = until` excludes them (`.gt(created_at, since)`) — a permanent skip. A safety lag keeps `until` comfortably behind the DB clock.

- [ ] **Step 1: Write the failing test** (append to `route.test.ts`)

```ts
it('reports usage with an `until` that trails wall-clock by the safety lag', async () => {
  const supa = await import('@/lib/supabase');
  const upserts: any[] = [];
  (supa.adminDb.from as any).mockImplementation((table: string) => {
    if (table === 'usage_sync_cursor') return {
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { last_synced_at: '2026-07-01T00:00:00Z' }, error: null }) }) }),
      upsert: (row: any) => { upserts.push(row); return Promise.resolve({ error: null }); },
    };
    const chain: any = { select: () => chain, not: () => chain, in: () => chain, eq: () => chain, neq: () => chain, gt: () => chain, lte: () => chain,
      then: (r: any) => Promise.resolve({ data: table === 'usage_events' ? [{ cost_cents: 500 }] : [{ id: 'c-1', stripe_customer_id: 'cus_1', subscription_status: 'active' }], error: null }).then(r) };
    return chain;
  });
  rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'claim_usage_sync', error: null }));
  const t0 = Date.now();
  const { GET } = await import('./route');
  await GET(new Request('http://x', { headers: { authorization: 'Bearer s' } }) as any);
  const pending = upserts.find(u => u.pending_until);
  expect(new Date(pending.pending_until).getTime()).toBeLessThanOrEqual(t0 - 30_000);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/api/cron/billing-sync/route.test.ts`
Expected: FAIL — `until` is `new Date()` (≈ now), not `now - lag`.

- [ ] **Step 3: Implement** — `src/app/api/cron/billing-sync/route.ts`. Add a constant near the top of the module and change the `else` branch that computes `until` (line 45-48):

```ts
// Keep `until` behind the wall clock so a usage_events row whose DB-side
// created_at lands just after this run reads can't fall into the gap between
// `until` and the next run's `since` (= this until) and be skipped forever.
const SYNC_SAFETY_LAG_MS = 60_000;
```

```ts
      } else {
        until = new Date(Date.now() - SYNC_SAFETY_LAG_MS).toISOString();
        key = buildSyncKey(campaign.id, since, until);
      }
```

- [ ] **Step 4: Run the test + suite**

Run: `npx vitest run src/app/api/cron/billing-sync/route.test.ts && npm test && npm run typecheck`
Expected: PASS.

- **Note:** The lag delays billing recency by ≤ 60s, which is immaterial for an hourly cron. The rigorous alternative — reading the DB clock via a `select now()` RPC and subtracting the lag — removes the app-vs-DB skew assumption entirely; record it as a follow-up if clock skew is ever observed. The pending-key retry path (line 39-44) intentionally reuses the persisted `until`, so a retried report keeps the same lagged boundary and identifier.

### Task 5: Webhook must not permanently drop events with no matching campaign (BILL-6)

**Files:**
- Modify: `src/app/api/webhooks/stripe/route.ts:70-90`
- Test: `src/app/api/webhooks/stripe/route.test.ts` (new)

**Interfaces:**
- Currently a `customer.subscription.*` event whose `sub.id` matches no campaign logs a warning, then falls through and **inserts a `billing_events` row + returns 200**. On Stripe's retry the idempotency check (`billing_events` select at line 22-32) finds that row and short-circuits — so a campaign row that appears slightly later (creation race) never receives its status transition. Fix: when a subscription event has no matching campaign, return non-2xx and skip the dedup insert, so Stripe redelivers.

- [ ] **Step 1: Write the failing test** (`src/app/api/webhooks/stripe/route.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const constructEvent = vi.fn();
vi.mock('@/lib/stripe', () => ({ stripe: { webhooks: { constructEvent } } }));

const insert = vi.fn(() => Promise.resolve({ error: null }));
const campaignSingle = vi.fn();
function fromImpl(table: string) {
  if (table === 'billing_events') return {
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    insert,
  };
  if (table === 'campaigns') return {
    select: () => ({ eq: () => ({ maybeSingle: campaignSingle }) }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  };
  throw new Error('unexpected table ' + table);
}
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(fromImpl) } }));

function req() {
  return { headers: { get: (h: string) => (h === 'stripe-signature' ? 'sig' : null) }, text: () => Promise.resolve('{}') } as any;
}

describe('stripe webhook — unmatched subscription event', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.STRIPE_WEBHOOK_SECRET = 'whsec'; });

  it('returns non-2xx and does NOT record a billing_events row when no campaign matches', async () => {
    constructEvent.mockReturnValue({ id: 'evt_1', type: 'customer.subscription.updated', created: 1000, data: { object: { id: 'sub_x', status: 'active', items: { data: [{ current_period_end: 1 }] } } } });
    campaignSingle.mockResolvedValue({ data: null, error: null }); // no campaign
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/api/webhooks/stripe/route.test.ts`
Expected: FAIL — currently returns 200 and inserts a `billing_events` row.

- [ ] **Step 3: Implement** — `src/app/api/webhooks/stripe/route.ts`. In the `else` branch at line 70-74 (no campaign found), return early instead of falling through:

```ts
    } else {
      console.error(
        `Stripe webhook: no campaign found for stripe_subscription_id ${sub.id} (event ${event.id}, type ${event.type})`
      );
      // Do NOT record this event as processed. Returning non-2xx makes Stripe
      // redeliver, so a campaign row created in a race still gets its
      // transition. Recording it here would permanently drop the transition.
      return NextResponse.json({ error: 'No matching campaign; will retry' }, { status: 409 });
    }
```

- [ ] **Step 4: Run the test + suite**

Run: `npx vitest run src/app/api/webhooks/stripe/route.test.ts && npm test && npm run typecheck`
Expected: PASS.

- **Note:** Non-subscription event types (e.g. `invoice.*`) still fall through to the `billing_events` insert + 200, which is correct — they legitimately have no campaign lookup here. Only the subscription branch's no-match case returns 409.

### Task 6: Reject out-of-order subscription webhooks so a stale event can't regress status or clear the grace period (BILL-7)

**Files:**
- Create: `supabase/migrations/016_subscription_event_ordering.sql`
- Modify: `src/lib/billing-webhook.ts` (add a pure ordering helper)
- Modify: `src/app/api/webhooks/stripe/route.ts` (guard the status write; persist `event.created`)
- Test: `src/lib/billing-webhook.test.ts` (extend), `src/app/api/webhooks/stripe/route.test.ts` (extend)

**Interfaces:**
- Produces: `isNewerEvent(eventCreatedSec: number, lastSeenSec: number | null): boolean` in `billing-webhook.ts` — `true` when there is no recorded prior event or the incoming event is strictly newer.
- Stripe delivers `customer.subscription.updated` events out of order under retries; a stale `active` arriving after a `past_due` must not overwrite `past_due` nor null out `grace_period_ends_at`. We compare `event.created` (unix seconds) against a persisted high-water mark per campaign.

- [ ] **Step 1: Write the failing unit test** (append to `src/lib/billing-webhook.test.ts`)

```ts
import { isNewerEvent } from './billing-webhook';

describe('isNewerEvent', () => {
  it('accepts any event when none seen yet', () => { expect(isNewerEvent(1000, null)).toBe(true); });
  it('accepts a strictly newer event', () => { expect(isNewerEvent(1001, 1000)).toBe(true); });
  it('rejects an equal-or-older (stale/replayed) event', () => {
    expect(isNewerEvent(1000, 1000)).toBe(false);
    expect(isNewerEvent(999, 1000)).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing route test** (append to `src/app/api/webhooks/stripe/route.test.ts`; extend the `campaigns` mock so `select` returns `subscription_event_created` and capture `update` args)

```ts
it('ignores a stale subscription event (does not regress status / clear grace)', async () => {
  const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
  const supa = await import('@/lib/supabase');
  (supa.adminDb.from as any).mockImplementation((table: string) => {
    if (table === 'billing_events') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }), insert };
    if (table === 'campaigns') return {
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'c-1', grace_period_ends_at: '2026-07-08T00:00:00Z', subscription_event_created: 2000 }, error: null }) }) }),
      update,
    };
  });
  constructEvent.mockReturnValue({ id: 'evt_old', type: 'customer.subscription.updated', created: 1000, data: { object: { id: 'sub_1', status: 'active', items: { data: [{ current_period_end: 1 }] } } } });
  const { POST } = await import('./route');
  const res = await POST(req());
  expect(update).not.toHaveBeenCalled();   // no status regression
  expect(res.status).toBe(200);            // still ack + dedup so it isn't retried forever
  expect(insert).toHaveBeenCalled();
});
```

- [ ] **Step 3: Run both and confirm they fail**

Run: `npx vitest run src/lib/billing-webhook.test.ts src/app/api/webhooks/stripe/route.test.ts`
Expected: FAIL — `isNewerEvent` does not exist; the route unconditionally writes status.

- [ ] **Step 4: Add the migration** (`supabase/migrations/016_subscription_event_ordering.sql`)

```sql
-- Out-of-order webhook protection (BILL-7). Stripe redelivers subscription
-- events without ordering guarantees; a stale `active` arriving after a
-- `past_due` must not overwrite the newer status or clear the grace period.
-- Track the unix-seconds `created` of the newest subscription event applied.
alter table campaigns
  add column if not exists subscription_event_created bigint;
```

- [ ] **Step 5: Add the pure helper** — append to `src/lib/billing-webhook.ts`:

```ts
export function isNewerEvent(eventCreatedSec: number, lastSeenSec: number | null): boolean {
  if (lastSeenSec == null) return true;
  return eventCreatedSec > lastSeenSec;
}
```

- [ ] **Step 6: Guard the route** — `src/app/api/webhooks/stripe/route.ts`. Import the helper (line 5), include `subscription_event_created` in the campaign select (line 40), and only apply the status write when the event is newer, persisting the new high-water mark:

```ts
import { computeSubscriptionUpdate, isNewerEvent, type StripeSubscriptionStatus } from '@/lib/billing-webhook';
```

```ts
    const { data: campaign } = await adminDb
      .from('campaigns')
      .select('id, grace_period_ends_at, subscription_event_created')
      .eq('stripe_subscription_id', sub.id)
      .maybeSingle();

    if (campaign) {
      campaignId = campaign.id;
      if (!isNewerEvent(event.created, campaign.subscription_event_created ?? null)) {
        // Stale/replayed event — record it for idempotency but do not touch status.
        console.warn(`Stripe webhook: ignoring stale event ${event.id} (created ${event.created}) for campaign ${campaign.id}`);
      } else {
        const status: StripeSubscriptionStatus =
          event.type === 'customer.subscription.deleted' ? 'canceled' : (sub.status as StripeSubscriptionStatus);
        const update = computeSubscriptionUpdate(status, new Date(), campaign.grace_period_ends_at);
        const currentPeriodEnd = sub.items.data[0]?.current_period_end;
        const { error: updateError } = await adminDb.from('campaigns').update({
          subscription_status: update.subscriptionStatus,
          grace_period_ends_at: update.gracePeriodEndsAt,
          subscription_event_created: event.created,
          current_period_end: event.type === 'customer.subscription.deleted'
            ? null
            : currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
        }).eq('id', campaign.id);
        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }
      }
    } else {
      // (BILL-6 branch from Task 5 — return 409, no dedup insert)
      ...
    }
```

- [ ] **Step 7: Run the tests + suite**

Run: `npx vitest run src/lib/billing-webhook.test.ts src/app/api/webhooks/stripe/route.test.ts && npm test && npm run typecheck`
Expected: PASS. The existing `computeSubscriptionUpdate` tests are unaffected (it stays pure).

- **Note:** A stale event is still recorded in `billing_events` and returns 200 (Task 5's 409 is only for the *no-campaign* case) — we've applied a definitive decision (ignore), so retrying it would be pointless.

### Task 7: Release the usage reservation when video / voice / prompt-look generation fails (BILL-9)

**Files:**
- Modify: `src/app/actions.ts` — `generateVideoAction` (295-315), `synthesizeVoiceAction` (328-337), `generatePromptLookAction` (757-781)
- Test: `src/app/actions.reservation-release.test.ts` (new)

**Interfaces:**
- Consumes: `usageMeter.guard(campaignId, cap, estimatedCents)` reserves; `usageMeter.record(campaignId, kind, quantity, costCents)` finalizes (releasing the reservation). Reference pattern: `generateDraftAction` (164-189) already reserves then `record(...)`s in a `finally`, recording the cost regardless of provider outcome. Video/voice/prompt-look instead `record()` only on the success path, so a provider throw leaves the `_reserved` row to linger (eating cap headroom until the 5-minute abandon window in `reserve_usage`). Wrap each in try/finally and, on failure, record cost **0** — releasing the reservation without billing for work that didn't produce a deliverable.

- [ ] **Step 1: Write the failing test** (`src/app/actions.reservation-release.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', role: 'owner', campaignId: 'c-1' };
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', monthlyCostCapCents: 100_000 })) }));
vi.mock('@/lib/candidate', () => ({ getCandidateProfile: vi.fn(() => Promise.resolve({ heygenAvatarId: 'hg-1' })) }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ insert: vi.fn(() => Promise.resolve({ error: null })) })) } }));

const guard = vi.fn(() => Promise.resolve());
const record = vi.fn(() => Promise.resolve());
const generateAvatarVideo = vi.fn();
const synthesize = vi.fn();
vi.mock('@/lib/services', () => ({
  usageMeter: { guard, record }, billingGate: { check: vi.fn(() => Promise.resolve()) },
  videoProvider: { generateAvatarVideo, getVideoStatus: vi.fn() }, voiceProvider: { synthesize },
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {}, photoAvatarProvider: {},
}));

describe('reservation is released on provider failure (BILL-9)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('generateVideoAction records cost 0 when the provider throws', async () => {
    generateAvatarVideo.mockRejectedValue(new Error('HeyGen 500'));
    const { generateVideoAction } = await import('./actions');
    await expect(generateVideoAction('content-1', 'script')).rejects.toThrow('HeyGen 500');
    expect(record).toHaveBeenCalledWith('c-1', 'video_generation', 1, 0);
  });

  it('synthesizeVoiceAction records cost 0 when the provider throws', async () => {
    synthesize.mockRejectedValue(new Error('ElevenLabs 429'));
    const { synthesizeVoiceAction } = await import('./actions');
    await expect(synthesizeVoiceAction('hello')).rejects.toThrow('ElevenLabs 429');
    expect(record).toHaveBeenCalledWith('c-1', 'voice_synthesis', 1, 0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/actions.reservation-release.test.ts`
Expected: FAIL — on a provider throw, `record` is never called (the reservation lingers).

- [ ] **Step 3: Implement `generateVideoAction`** — `src/app/actions.ts:295-315`. Track success and record in `finally`:

```ts
  const VIDEO_COST_CENTS = 50_00;
  try {
    await billingGate.check(s.campaignId);
    await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, VIDEO_COST_CENTS);
    let cost = 0;
    try {
      const { videoId } = await videoProvider.generateAvatarVideo({
        script,
        avatarId,
        voiceId: overrides?.voiceId ?? profile?.elevenLabsVoiceId ?? undefined,
        background: overrides?.background ?? profile?.videoBackground ?? 'plain',
        aspectRatio: overrides?.aspectRatio ?? profile?.videoAspectRatio ?? '16:9',
      });
      cost = VIDEO_COST_CENTS; // provider accepted the job — this is billable
      await adminDb.from('audit_entries').insert({
        campaign_id: s.campaignId, actor_user_id: s.userId,
        action: 'generate_video', entity_type: 'content_item', entity_id: contentId,
        details: { videoId },
      });
      return { ok: true, videoId };
    } finally {
      // Always release the reservation; bill only if the job was accepted.
      await usageMeter.record(s.campaignId, 'video_generation', 1, cost);
    }
  } catch (e) {
    if (e instanceof CapExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }
```

(Note: `guard` failures — `CapExceeded`/`BillingBlocked` — throw *before* the inner try, so no reservation exists to release; the outer catch maps them to a `Result`. Only a reservation that was actually taken is finalized.)

- [ ] **Step 4: Implement `synthesizeVoiceAction`** — `src/app/actions.ts:328-337`:

```ts
  try {
    await billingGate.check(s.campaignId);
    await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, 20_00);
    let cost = 0;
    try {
      const { audioUrl } = await voiceProvider.synthesize({ text });
      cost = 20_00;
      return { ok: true, audioUrl };
    } finally {
      await usageMeter.record(s.campaignId, 'voice_synthesis', 1, cost);
    }
  } catch (e) {
    if (e instanceof CapExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }
```

- [ ] **Step 5: Implement `generatePromptLookAction`** — `src/app/actions.ts:757-781`. Keep its existing broad catch (it returns a `Result` rather than rethrowing) but move the `record` into a `finally` so a `createPromptLook` throw still releases:

```ts
  try {
    await billingGate.check(s.campaignId);
    await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, AVATAR_PROMPT_LOOK_COST_CENTS);
    let cost = 0;
    try {
      const { lookId } = await photoAvatarProvider.createPromptLook({
        name: name.trim() || 'Styled look',
        prompt: prompt.trim(),
        avatarId: avatar.heygenLookId,
      });
      if (lookId) {
        cost = AVATAR_PROMPT_LOOK_COST_CENTS; // a look was actually produced
        await updateAvatarStatus(avatarId, avatar.status, { heygenLookId: lookId });
        const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');
        const profile = await getCandidateProfile(s.campaignId);
        if (profile?.activeAvatarId === avatarId) {
          await upsertCandidateProfile(s.campaignId, { heygenAvatarId: lookId });
        }
      }
    } finally {
      await usageMeter.record(s.campaignId, 'avatar_look_generation', 1, cost);
    }
  } catch (e) {
    if (e instanceof CapExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to generate look.' };
  }
  revalidatePath('/avatars');
  return { ok: true };
```

- [ ] **Step 6: Run the test + suite**

Run: `npx vitest run src/app/actions.reservation-release.test.ts && npm test && npm run typecheck`
Expected: PASS.

- **Note:** This mirrors `generateDraftAction`'s reserve-then-finally contract. Recording cost 0 both releases the `_reserved` row (via `finalize`) and avoids billing for a failed deliverable. After Task 9, `record` is keyed on the reservation id — this task's shape is unchanged, only the args to `record` gain the id (fold in during Task 9 if implemented after this one).

### Task 8: Enforce plan seat limits on add-user and invite (BILL-10)

**Files:**
- Modify: `src/lib/data.ts` (add `getCampaignSeatUsage`)
- Modify: `src/app/admin/actions.ts` — `addUserAction` (203-230), `generateInviteAction` (24-38)
- Test: `src/lib/data.seats.test.ts` (new), `src/app/admin/actions.seats.test.ts` (new)

**Interfaces:**
- Produces: `getCampaignSeatUsage(campaignId): Promise<{ used: number; limit: number | null }>` — `used` = non-`super_admin` users in the campaign; `limit` = the campaign's plan `seat_limit` (null = unlimited). Consumes `PLAN_DEFINITIONS`/`billing_plans` via the campaign's `plan_id`.
- `addUserAction`/`generateInviteAction` are bound directly as `<form action={...}>` (see `src/app/admin/campaigns/[id]/page.tsx:268,372`) and return `void`; the minimal correct fix is to **bail without inserting** when at capacity (matching the existing `if (error) return` style), not to change their signatures.

- [ ] **Step 1: Write the failing helper test** (`src/lib/data.seats.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('./supabase', () => ({ adminDb: { from } }));

describe('getCampaignSeatUsage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts non-super_admin users and returns the plan seat limit', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'campaigns') return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { plan_id: 'starter' }, error: null }) }) }) };
      if (table === 'billing_plans') return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { seat_limit: 3 }, error: null }) }) }) };
      if (table === 'users') return { select: () => ({ eq: () => ({ neq: () => Promise.resolve({ data: [{ id: 'u1' }, { id: 'u2' }], count: 2, error: null }) }) }) };
      throw new Error(table);
    });
    const { getCampaignSeatUsage } = await import('./data');
    expect(await getCampaignSeatUsage('c-1')).toEqual({ used: 2, limit: 3 });
  });

  it('returns limit null (unlimited) when the campaign has no plan', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'campaigns') return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { plan_id: null }, error: null }) }) }) };
      if (table === 'users') return { select: () => ({ eq: () => ({ neq: () => Promise.resolve({ data: [], count: 0, error: null }) }) }) };
      throw new Error(table);
    });
    const { getCampaignSeatUsage } = await import('./data');
    expect(await getCampaignSeatUsage('c-1')).toEqual({ used: 0, limit: null });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/data.seats.test.ts`
Expected: FAIL — `getCampaignSeatUsage` is not exported.

- [ ] **Step 3: Implement the helper** — append to `src/lib/data.ts`:

```ts
export async function getCampaignSeatUsage(campaignId: string): Promise<{ used: number; limit: number | null }> {
  const { data: camp } = await adminDb.from('campaigns').select('plan_id').eq('id', campaignId).single();
  let limit: number | null = null;
  if (camp?.plan_id) {
    const { data: plan } = await adminDb.from('billing_plans').select('seat_limit').eq('id', camp.plan_id).single();
    limit = (plan?.seat_limit as number | null) ?? null;
  }
  const { data: users } = await adminDb.from('users').select('id').eq('campaign_id', campaignId).neq('role', 'super_admin');
  return { used: users?.length ?? 0, limit };
}
```

- [ ] **Step 4: Write the failing action test** (`src/app/admin/actions.seats.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(() => ({ userId: 'u-admin' })) }));
vi.mock('@/lib/stripe', () => ({ stripe: null }));

const insert = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ insert })) } }));

const getCampaignSeatUsage = vi.fn();
vi.mock('@/lib/data', () => ({ getCampaignSeatUsage }));

function fd(o: Record<string, string>) { const f = new FormData(); for (const k in o) f.set(k, o[k]); return f; }

describe('addUserAction enforces seat limits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not insert a user when the campaign is at its seat limit', async () => {
    getCampaignSeatUsage.mockResolvedValue({ used: 3, limit: 3 });
    const { addUserAction } = await import('./actions');
    await addUserAction(fd({ campaignId: 'c-1', name: 'New', email: 'n@x.com', role: 'staff' }));
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts when under the seat limit', async () => {
    getCampaignSeatUsage.mockResolvedValue({ used: 1, limit: 3 });
    const { addUserAction } = await import('./actions');
    await addUserAction(fd({ campaignId: 'c-1', name: 'New', email: 'n@x.com', role: 'staff' }));
    expect(insert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `npx vitest run src/app/admin/actions.seats.test.ts`
Expected: FAIL — `addUserAction` inserts regardless of capacity.

- [ ] **Step 6: Implement** — `src/app/admin/actions.ts`. In `addUserAction`, after the field validation at line 209 (`if (!name || !email || !campaignId) return;`) add:

```ts
  const { getCampaignSeatUsage } = await import('@/lib/data');
  const seats = await getCampaignSeatUsage(campaignId);
  // seat_limit is per-plan (billing-catalog); null = unlimited (Enterprise).
  if (seats.limit !== null && seats.used >= seats.limit) return;
```

In `generateInviteAction`, after `if (!campaignId) return;` (line 28) add the same guard (an unused invite is a reserved seat):

```ts
  const { getCampaignSeatUsage } = await import('@/lib/data');
  const seats = await getCampaignSeatUsage(campaignId);
  if (seats.limit !== null && seats.used >= seats.limit) return;
```

- [ ] **Step 7: Run the tests + suite**

Run: `npx vitest run src/lib/data.seats.test.ts src/app/admin/actions.seats.test.ts && npm test && npm run typecheck`
Expected: PASS.

- **Note:** Bailing silently matches these actions' current failure style (`addUserAction` already `return`s on a duplicate-email error). For a visible "seat limit reached" message, migrate the two forms to `useActionState` and surface a `{ ok:false, error }` — record as a follow-up UX item; it is not required to close BILL-10 (the revenue/limit leak is the insert, now blocked).

### Task 9: Make usage finalize atomic and keyed on the reservation id (BILL-13)

**Files:**
- Create: `supabase/migrations/017_finalize_usage.sql`
- Modify: `src/domain/usage.ts` (`UsageRepo.reserve` returns the reservation id; `finalize` keyed on it; `UsageMeter.guard` returns the id; `record` takes it)
- Modify: `src/lib/repos.ts:135-160` (`reserve`/`finalize` call the new RPCs)
- Modify: `src/app/actions.ts` — every `guard`→`record` pair threads the reservation id (generateDraftAction 177/187, generateVideoAction, synthesizeVoiceAction, createAvatarAction 617/672, generatePromptLookAction 759/777)
- Test: `src/domain/usage.test.ts` (extend), `src/lib/repos.finalize.test.ts` (new), pgTAP note

**Interfaces:**
- Current `finalize` (`repos.ts:144-160`) does a **non-atomic delete-then-insert matching the `_reserved` row by `cost_cents`** — an equal-cost concurrent finalize can delete the wrong reservation, and a crash between delete and insert loses the spend. Fix: `reserve_usage` returns the inserted reservation id; `finalize_usage(p_reservation_id, p_kind, p_cost_cents)` deletes that exact row and inserts the real row in one plpgsql transaction.
- New domain shapes:
  - `reserve(campaignId, capCents, estimatedCents): Promise<string | null>` — reservation id, or `null` when the cap is exceeded.
  - `guard(campaignId, capCents, estimatedCents): Promise<string>` — the reservation id (throws `CapExceeded` when `null`).
  - `finalize(reservationId, kind, quantity, costCents): Promise<void>` / `record(reservationId, kind, quantity, costCents): Promise<void>`.
  - `reservedCents` param is **removed** — release is by id, so partial-batch (createAvatar) no longer needs to pass the original estimate.

- [ ] **Step 1: Write the migration** (`supabase/migrations/017_finalize_usage.sql`)

```sql
-- Atomic usage finalize keyed on the reservation id (BILL-13). Previously
-- UsageMeter.finalize() (repos.ts) matched the _reserved row by cost_cents and
-- did delete-then-insert as two separate statements: an equal-cost race could
-- release the wrong reservation, and a crash between the two lost the spend.
-- reserve_usage now returns the id of the row it inserts; finalize_usage
-- deletes exactly that row and records the real spend in one transaction.

create or replace function reserve_usage(
  p_campaign_id text,
  p_cap_cents integer,
  p_cost_cents integer
) returns text
language plpgsql
as $$
declare
  v_used integer;
  v_month_start timestamptz := date_trunc('month', now());
  v_id text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id, 0));

  select coalesce(sum(cost_cents), 0) into v_used
  from usage_events
  where campaign_id = p_campaign_id
    and created_at >= v_month_start
    and (kind <> '_reserved' or created_at >= now() - interval '5 minutes');

  if v_used + p_cost_cents > p_cap_cents then
    return null;
  end if;

  insert into usage_events (campaign_id, kind, cost_cents)
  values (p_campaign_id, '_reserved', p_cost_cents)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function finalize_usage(
  p_reservation_id text,
  p_kind text,
  p_cost_cents integer
) returns void
language plpgsql
as $$
declare v_campaign_id text;
begin
  -- Delete the exact reservation and capture its campaign in one shot; if it's
  -- already gone (double-finalize), do nothing — this is idempotent.
  delete from usage_events
   where id = p_reservation_id and kind = '_reserved'
   returning campaign_id into v_campaign_id;

  if v_campaign_id is not null and p_cost_cents > 0 then
    insert into usage_events (campaign_id, kind, cost_cents)
    values (v_campaign_id, p_kind, p_cost_cents);
  end if;
end;
$$;
```

(`reserve_usage` keeps its `date_trunc('month')` window here; Task 10/migration 018 re-defines it to window on `current_period_end`. `usage_events.id` has `default gen_random_uuid()::text` — migration 001 — so `returning id` is populated.)

- [ ] **Step 2: Write the failing domain test** (extend `src/domain/usage.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { UsageMeter, CapExceeded, type UsageRepo } from './usage';

describe('UsageMeter reservation id threading', () => {
  it('guard returns the reservation id from reserve', async () => {
    const repo: UsageRepo = { monthToDateCents: async () => 0, reserve: async () => 'res-1', finalize: async () => {} };
    const meter = new UsageMeter(repo);
    expect(await meter.guard('c-1', 100, 10)).toBe('res-1');
  });

  it('guard throws CapExceeded when reserve returns null', async () => {
    const repo: UsageRepo = { monthToDateCents: async () => 0, reserve: async () => null, finalize: async () => {} };
    const meter = new UsageMeter(repo);
    await expect(meter.guard('c-1', 100, 10)).rejects.toThrow(CapExceeded);
  });

  it('record forwards the reservation id to finalize', async () => {
    const finalize = vi.fn(async () => {});
    const repo: UsageRepo = { monthToDateCents: async () => 0, reserve: async () => 'res-1', finalize };
    const meter = new UsageMeter(repo);
    await meter.record('res-1', 'llm_tokens', 1, 500);
    expect(finalize).toHaveBeenCalledWith('res-1', 'llm_tokens', 1, 500);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/domain/usage.test.ts`
Expected: FAIL — `reserve` is typed `Promise<boolean>`, `guard` returns void, `record`/`finalize` take `(campaignId, kind, quantity, costCents, reservedCents)`.

- [ ] **Step 4: Rewrite `src/domain/usage.ts`**

```ts
export interface UsageRepo {
  monthToDateCents(campaignId: string): Promise<number>;
  // Atomically checks the running total against the cap and, if it fits,
  // reserves estimatedCents — returning the reservation id (null if it would
  // exceed the cap). Closes the check-then-act gap between guard() and record().
  reserve(campaignId: string, capCents: number, estimatedCents: number): Promise<string | null>;
  // Releases the reservation by id and records the real (kind, quantity,
  // costCents) outcome in one atomic step. Call exactly once per successful
  // reserve() — including with costCents 0 if the paid work never happened.
  finalize(reservationId: string, kind: string, quantity: number, costCents: number): Promise<void>;
}

export class CapExceeded extends Error {}

export class UsageMeter {
  constructor(private repo: UsageRepo) {}

  async guard(campaignId: string, capCents: number, estimatedCents: number): Promise<string> {
    const reservationId = await this.repo.reserve(campaignId, capCents, estimatedCents);
    if (!reservationId) {
      throw new CapExceeded('This campaign has reached its monthly spending cap. Raise the cap in Settings to continue.');
    }
    return reservationId;
  }

  async record(reservationId: string, kind: string, quantity: number, costCents: number): Promise<void> {
    await this.repo.finalize(reservationId, kind, quantity, costCents);
  }
}
```

- [ ] **Step 5: Rewrite `usageRepo.reserve`/`finalize`** in `src/lib/repos.ts:135-160`

```ts
  async reserve(campaignId, capCents, estimatedCents) {
    const { data, error } = await adminDb.rpc('reserve_usage', {
      p_campaign_id: campaignId,
      p_cap_cents: capCents,
      p_cost_cents: estimatedCents,
    });
    if (error) throw error;
    return (data as string | null) ?? null;
  },
  async finalize(reservationId, kind, _quantity, costCents) {
    const { error } = await adminDb.rpc('finalize_usage', {
      p_reservation_id: reservationId,
      p_kind: kind,
      p_cost_cents: costCents,
    });
    if (error) throw error;
  },
```

- [ ] **Step 6: Thread the id through call sites** in `src/app/actions.ts`. Each `guard` now returns the id; pass it to `record`. Examples:

```ts
// generateDraftAction (164-189)
  const reservationId = await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, cost);
  try {
    return await contentGenerator.draft({ instruction, type, candidateProfile: profile ?? undefined });
  } finally {
    await usageMeter.record(reservationId, 'llm_tokens', 1, cost);
  }
```

Apply the same `const reservationId = await usageMeter.guard(...)` → `usageMeter.record(reservationId, kind, qty, cost)` change to `generateVideoAction`, `synthesizeVoiceAction`, `generatePromptLookAction` (Task 7's `let cost` shape stays; only `record`'s first arg becomes `reservationId`), and `createAvatarAction` (617/672) — where the old `reservedCents` 5th arg is dropped and partial-batch simply records `processedCount * AVATAR_LOOK_COST_CENTS` against the single reservation id.

- [ ] **Step 7: Write a repos finalize test** (`src/lib/repos.finalize.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const rpc = vi.fn();
vi.mock('./supabase', () => ({ adminDb: { rpc, from: vi.fn() } }));

describe('usageRepo finalize/reserve use the atomic RPCs', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reserve returns the id string from reserve_usage', async () => {
    rpc.mockResolvedValue({ data: 'res-9', error: null });
    const { usageRepo } = await import('./repos');
    expect(await usageRepo.reserve('c-1', 100, 10)).toBe('res-9');
  });
  it('reserve returns null when the RPC returns null (cap exceeded)', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { usageRepo } = await import('./repos');
    expect(await usageRepo.reserve('c-1', 100, 10)).toBeNull();
  });
  it('finalize calls finalize_usage keyed on the reservation id', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { usageRepo } = await import('./repos');
    await usageRepo.finalize('res-9', 'llm_tokens', 1, 500);
    expect(rpc).toHaveBeenCalledWith('finalize_usage', { p_reservation_id: 'res-9', p_kind: 'llm_tokens', p_cost_cents: 500 });
  });
});
```

- [ ] **Step 8: Run everything**

Run: `npx vitest run src/domain/usage.test.ts src/lib/repos.finalize.test.ts && npm test && npm run typecheck`
Expected: PASS. **Watch for:** the existing usage-cap test (`src/domain/usage.test.ts` / any fake `reserve` returning a boolean — see audit TEST-7) must be updated to return a string id / null; update those fakes as part of this task.

- [ ] **Step 9: SQL verification** — add `supabase/tests/finalize_usage.test.sql` (pgTAP): `reserve_usage` returns a non-null id and inserts one `_reserved` row; `finalize_usage(id,'llm_tokens',500)` removes the reservation and inserts exactly one `llm_tokens` row of 500; a second `finalize_usage(id,...)` is a no-op (idempotent); `finalize_usage(id,'k',0)` removes the reservation and inserts nothing. **If no local Postgres:** note pgTAP runs in CI/staging; the domain + repos unit tests above pin the calling contract.

### Task 10: One spend window (`current_period_end`) for the cap guard and both displays — resolves UX-1 (BILL-11)

**Files:**
- Create: `supabase/migrations/018_billing_period_window.sql`
- Create: `src/lib/billing-period.ts` (shared window helper)
- Modify: `src/lib/data.ts` (`getMonthlySpend` 121-126; and the admin `start` windows at 186 & 191 stay calendar-month for the admin overview but `getMonthlySpend`/campaign spend use the billing period)
- Modify: `src/app/dashboard/page.tsx:31-32,126` and `src/app/billing/page.tsx:50-53`
- Test: `src/lib/billing-period.test.ts` (new), pgTAP note for `reserve_usage`

**Interfaces & single source of truth:** the spend window is the **current Stripe billing period**, anchored on `campaigns.current_period_end` (already persisted by `assignPlanAction` and the webhook, in UTC). For a monthly plan the period is `[current_period_end - 1 month, current_period_end)`. When a campaign has no subscription (`current_period_end` null), fall back to the **UTC** calendar month (`Date.UTC` first-of-month) so the guard and displays still agree.
- Produces: `billingPeriodStart(currentPeriodEnd: string | null, now?: Date): Date` in `src/lib/billing-period.ts`.
- The cap guard (`reserve_usage`) reads `campaigns.current_period_end` directly and windows on it, so DB and app compute the identical boundary. This makes the dashboard ("used / cap") and billing ("used of included") report spend over the same period — the three-window mismatch (calendar-month DB cap vs server-local display month vs Stripe anchor) that produced UX-1 collapses to one.

- [ ] **Step 1: Write the failing helper test** (`src/lib/billing-period.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { billingPeriodStart } from './billing-period';

describe('billingPeriodStart', () => {
  it('is one month before current_period_end when subscribed', () => {
    expect(billingPeriodStart('2026-07-20T00:00:00Z').toISOString()).toBe('2026-06-20T00:00:00.000Z');
  });
  it('falls back to the UTC first-of-month when there is no subscription', () => {
    const now = new Date('2026-07-15T18:30:00Z');
    expect(billingPeriodStart(null, now).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/billing-period.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper** (`src/lib/billing-period.ts`)

```ts
// Single source of truth for the "current spend period" used by the cap guard
// and every spend display. Anchored on the Stripe billing period end so the
// cap window, the dashboard, and the billing page all agree (resolves UX-1).
export function billingPeriodStart(currentPeriodEnd: string | null, now: Date = new Date()): Date {
  if (currentPeriodEnd) {
    const end = new Date(currentPeriodEnd);
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - 1);
    return start;
  }
  // No subscription yet: UTC calendar month, matching reserve_usage's fallback.
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
```

- [ ] **Step 4: Point `getMonthlySpend` at the billing period** — `src/lib/data.ts:121-126`:

```ts
export async function getMonthlySpend(campaignId: string): Promise<number> {
  const { billingPeriodStart } = await import('./billing-period');
  const { data: camp } = await adminDb.from('campaigns').select('current_period_end').eq('id', campaignId).single();
  const start = billingPeriodStart((camp?.current_period_end as string | null) ?? null);
  const { data } = await adminDb.from('usage_events').select('cost_cents')
    .eq('campaign_id', campaignId).neq('kind', '_reserved').gte('created_at', start.toISOString());
  return (data ?? []).reduce((n, r) => n + (r.cost_cents as number), 0);
}
```

- [ ] **Step 5: Window `reserve_usage` on `current_period_end`** (`supabase/migrations/018_billing_period_window.sql`) — note this re-defines the function from migration 017 and **must preserve the `returns text` / reservation-id behavior**:

```sql
-- Window the cap guard on the Stripe billing period instead of the calendar
-- month (BILL-11 / UX-1). Reads campaigns.current_period_end so the DB and the
-- app (src/lib/billing-period.ts) compute the identical window. Preserves the
-- reservation-id return introduced in 017_finalize_usage.sql.
create or replace function reserve_usage(
  p_campaign_id text,
  p_cap_cents integer,
  p_cost_cents integer
) returns text
language plpgsql
as $$
declare
  v_used integer;
  v_period_end timestamptz;
  v_window_start timestamptz;
  v_id text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id, 0));

  select current_period_end into v_period_end from campaigns where id = p_campaign_id;
  -- Billing period start, or UTC month start when there's no subscription.
  v_window_start := coalesce(v_period_end - interval '1 month', date_trunc('month', now() at time zone 'UTC'));

  select coalesce(sum(cost_cents), 0) into v_used
  from usage_events
  where campaign_id = p_campaign_id
    and created_at >= v_window_start
    and (kind <> '_reserved' or created_at >= now() - interval '5 minutes');

  if v_used + p_cost_cents > p_cap_cents then
    return null;
  end if;

  insert into usage_events (campaign_id, kind, cost_cents)
  values (p_campaign_id, '_reserved', p_cost_cents)
  returning id into v_id;

  return v_id;
end;
$$;
```

- [ ] **Step 6: Make both displays label the window consistently.** In `src/app/billing/page.tsx:50-53`, keep "used of included this period" but change "this month" → "this billing period". In `src/app/dashboard/page.tsx`, the spend card (118-139) currently divides spend by `campaign.monthlyCostCapCents` (the hard cap) — keep that (it is the hard spend cap, distinct from the plan's included allowance) but relabel and show both numbers so the two screens no longer contradict:

```tsx
// dashboard spend card copy
<div className="eyebrow" style={{ marginBottom: 2 }}>Spend this billing period</div>
...
<span className="muted"> / ${(cap / 100).toFixed(2)} cap</span>
```

Both screens now describe the same window ("this billing period") and each names what its denominator is — the dashboard shows the **hard spend cap** (`monthlyCostCapCents`), the billing page shows the **plan included allowance** (`plan.includedUsageCents`). Add a one-line note on the billing page distinguishing them:

```tsx
<p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
  Your hard spend cap is set separately in Settings; usage above the included allowance bills as overage.
</p>
```

- [ ] **Step 7: Run the tests + suite**

Run: `npx vitest run src/lib/billing-period.test.ts && npm test && npm run typecheck`
Expected: PASS.

- **Note:** `getAllCampaigns`/`getSystemStats` (admin overview, `data.ts:186,191,276`) intentionally stay on the UTC calendar month — they aggregate across campaigns with differing billing anchors, so a single calendar window is the sensible cross-tenant view; only the per-campaign spend (`getMonthlySpend`) and the cap guard are period-anchored. Verify the alignment live per the audit's UX-1 repro (dashboard vs billing for one campaign) after deploy.

### Task 11: Billing page must message every gate-blocking status; share `INACTIVE_STATUSES` (BILL-12)

**Files:**
- Modify: `src/domain/billing.ts:12` (export `INACTIVE_STATUSES`)
- Modify: `src/app/billing/page.tsx:37-44`
- Test: `src/app/billing/page.inactive.test.ts` (new) or extend `src/domain/billing.test.ts`

**Interfaces:**
- The gate (`BillingGate.check`, `domain/billing.ts:12`) blocks `canceled | unpaid | incomplete_expired | paused` via a private `INACTIVE_STATUSES` set, but the billing page banner (`page.tsx:37`) only covers `canceled | unpaid` — a `paused`/`incomplete_expired` campaign is fully blocked with no on-screen explanation. Export the one set and drive the banner from it.

- [ ] **Step 1: Write the failing test** (append to `src/domain/billing.test.ts`)

```ts
import { INACTIVE_STATUSES } from './billing';

describe('INACTIVE_STATUSES is the shared block set', () => {
  it('includes every status the gate blocks', () => {
    expect([...INACTIVE_STATUSES].sort()).toEqual(['canceled', 'incomplete_expired', 'paused', 'unpaid']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/domain/billing.test.ts`
Expected: FAIL — `INACTIVE_STATUSES` is not exported.

- [ ] **Step 3: Export the set** — `src/domain/billing.ts:12`:

```ts
export const INACTIVE_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired', 'paused']);
```

- [ ] **Step 4: Drive the banner from it** — `src/app/billing/page.tsx`. Import at top (`import { INACTIVE_STATUSES } from '@/domain/billing';`) and replace the `canceled || unpaid` condition at line 37:

```tsx
        {campaign?.subscriptionStatus && INACTIVE_STATUSES.has(campaign.subscriptionStatus) && (
          <div className="banner warn" style={{ margin: '12px 0' }}>
            <div>
              <div className="t">Billing inactive</div>
              <div className="b">AI drafting, video, and voice generation are blocked until this is resolved. Contact your platform admin.</div>
            </div>
          </div>
        )}
```

- [ ] **Step 5: Run the test + suite**

Run: `npx vitest run src/domain/billing.test.ts && npm test && npm run typecheck`
Expected: PASS. (`past_due` keeps its own dedicated grace-period banner above; it is not in `INACTIVE_STATUSES` and is allowed within grace.)

---

## Self-review checklist (run before handing off)

- [ ] **Every BILL finding maps to a task:** BILL-2→T1, BILL-3→T2, BILL-4→T3, BILL-8→T4, BILL-6→T5, BILL-7→T6, BILL-9→T7, BILL-10→T8, BILL-13→T9, BILL-11→T10 (resolves UX-1), BILL-12→T11.
- [ ] **No usage is billed once and only once:** reservation released on every path incl. failure (T7); finalize atomic + id-keyed, no cost-match race (T9); no double-bill from concurrent syncs (T3) or window skew (T4).
- [ ] **No revenue lost / no over-charge on plan change:** cancel uses `invoice_now + prorate` (T1); first sync never retro-bills pre-subscription usage (T2).
- [ ] **Webhooks are safe under Stripe at-least-once + out-of-order delivery:** unmatched-campaign events retry, not dropped (T5); stale events never regress status/grace (T6). `computeSubscriptionUpdate` remains pure and its existing tests still pass.
- [ ] **One spend window everywhere:** `reserve_usage`, `getMonthlySpend`, dashboard, and billing all anchor on `current_period_end` via `billingPeriodStart`/DB `current_period_end` (T10); billing page messages every `INACTIVE_STATUSES` value (T11).
- [ ] **Stripe SDK v22.3.0 conventions preserved:** `current_period_end` read from `sub.items.data[0]` in every touched path; cancel/prorate params valid for v22.
- [ ] **Migrations are forward-only and correctly ordered:** 015 (sync lock) → 016 (event ordering) → 017 (`reserve_usage` returns id + `finalize_usage`) → 018 (`reserve_usage` windowed on `current_period_end`, preserving the id return). Grep after edits: `grep -n "returns text" supabase/migrations/018*.sql` and `grep -n "current_period_end" supabase/migrations/018*.sql` both hit.
- [ ] **Money paths covered by tests:** each task added a failing-first regression test; SQL functions have a pgTAP file (or a documented CI/staging note where no local Postgres exists).
- [ ] **Operator follow-ups recorded in the PR (not executed):** backfill `usage_sync_cursor` for pre-existing subscribed campaigns (T2); run pgTAP in CI/staging (T3, T9).
- [ ] `npm test && npm run typecheck` green after every task.
- [ ] **No git commits made** (user reviews and commits).
