# Stripe Billing (Subscriptions + Metered Usage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the platform a real, working billing system — each campaign subscribes to a flat-rate Stripe plan with an included usage allowance, and AI/video/voice usage beyond that allowance bills automatically as Stripe metered overage.

**Architecture:** Stripe is the source of truth for money (subscriptions, invoices, payment methods); this app stays the source of truth for usage (`usage_events`, unchanged) and periodically reports usage totals to Stripe as meter events via a cron job. A webhook keeps each campaign's cached subscription status in sync so the app can gate paid actions without calling Stripe on every request.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres) via `adminDb`, Stripe Node SDK, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-03-stripe-billing-design.md` — every requirement below traces back to this file.
- Plan tiers (exact values, from spec): Starter $49/mo, 3 seats, $25 included usage, 1.3x overage. Pro $149/mo, 10 seats, $100 included usage, 1.3x overage. Enterprise $499/mo, unlimited seats, $400 included usage, 1.2x overage.
- `seat_limit` is informational only in v1 — never enforce it against invite-code issuance.
- No self-serve plan switching by campaign owners — plan assignment is admin-only (`requireAdmin()`).
- All new Stripe SDK calls must null-check the shared `stripe` client (it is `null` when `STRIPE_SECRET_KEY` is unset) and fail gracefully, matching the existing "activates automatically when its env key is present" convention in `src/lib/services.ts`.
- Follow existing code conventions exactly: `'use server'` action files return `{ ok: boolean; error?: string }` (see `src/app/actions.ts`), domain logic is a plain class with an injected repo interface (see `src/domain/usage.ts`), and DB-row → domain mapping happens in `src/lib/data.ts` / `src/lib/repos.ts`.
- Do not commit any changes — the user reviews and commits everything themselves.

---

### Task 1: Stripe SDK dependency and shared client

**Files:**
- Modify: `package.json`
- Create: `src/lib/stripe.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `export const stripe: Stripe | null` from `src/lib/stripe.ts` — `null` whenever `STRIPE_SECRET_KEY` is unset. Every later task that touches Stripe imports this and must null-check it.

- [ ] **Step 1: Add the `stripe` dependency**

Run:
```bash
npm install stripe
```

Expected: `package.json` `dependencies` gains a `"stripe"` entry and `package-lock.json` updates.

- [ ] **Step 2: Create the shared client**

Create `src/lib/stripe.ts`:
```ts
import Stripe from 'stripe';

// Activates automatically when STRIPE_SECRET_KEY is present, matching the
// pattern in src/lib/services.ts for the other external integrations.
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
```

- [ ] **Step 3: Add billing env vars to `.env.example`**

Append to `.env.example`:
```
# ── Billing — activates Stripe subscriptions + metered usage ────────────────
# Get from: https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
# Get from: https://dashboard.stripe.com/test/webhooks after creating the
# endpoint pointing at /api/webhooks/stripe
STRIPE_WEBHOOK_SECRET=
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/stripe.ts .env.example
git commit -m "feat(billing): add Stripe SDK and shared client"
```

---

### Task 2: Billing tables migration

**Files:**
- Create: `supabase/migrations/010_billing.sql`

**Interfaces:**
- Produces: tables `billing_plans`, `billing_events`, `usage_sync_cursor`; new columns on `campaigns`: `plan_id`, `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `grace_period_ends_at`, `current_period_end`. All later tasks read/write these exact names.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/010_billing.sql`:
```sql
-- Stripe billing: subscriptions + metered usage overage.
-- Run in the Supabase SQL editor after 009_avatars.sql.

create table if not exists billing_plans (
  id                      text primary key,
  name                    text not null,
  monthly_price_cents     integer not null,
  seat_limit              integer,
  included_usage_cents    integer not null,
  overage_multiplier      numeric not null,
  stripe_product_id       text not null,
  stripe_flat_price_id    text not null,
  stripe_metered_price_id text not null,
  is_active               boolean not null default true
);

alter table campaigns
  add column if not exists plan_id text references billing_plans(id),
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists grace_period_ends_at timestamptz,
  add column if not exists current_period_end timestamptz;

create unique index if not exists idx_campaigns_stripe_customer
  on campaigns(stripe_customer_id) where stripe_customer_id is not null;

create unique index if not exists idx_campaigns_stripe_subscription
  on campaigns(stripe_subscription_id) where stripe_subscription_id is not null;

-- Append-only log of processed Stripe webhook events — mirrors audit_entries
-- and doubles as idempotency protection against Stripe's at-least-once delivery.
create table if not exists billing_events (
  id           text primary key,
  type         text not null,
  campaign_id  text references campaigns(id),
  payload      jsonb not null,
  processed_at timestamptz not null default now()
);

-- Tracks how far the usage-sync cron has gotten reporting usage_events to Stripe.
create table if not exists usage_sync_cursor (
  campaign_id    text primary key references campaigns(id) on delete cascade,
  last_synced_at timestamptz not null default '1970-01-01',
  last_synced_id text
);
```

- [ ] **Step 2: Apply the migration**

Run the contents of `supabase/migrations/010_billing.sql` in the Supabase SQL editor for your project (same process used for `009_avatars.sql`).

- [ ] **Step 3: Verify**

In the Supabase SQL editor, run:
```sql
select column_name from information_schema.columns where table_name = 'campaigns' and (column_name like '%stripe%' or column_name like '%plan%' or column_name like '%grace%' or column_name like '%period%');
select * from billing_plans;
select * from billing_events;
select * from usage_sync_cursor;
```
Expected: the new `campaigns` columns are listed, and the three new tables exist and are empty.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/010_billing.sql
git commit -m "feat(billing): add billing tables and campaign subscription columns"
```

---

### Task 3: Billing access gate (domain logic)

**Files:**
- Create: `src/domain/billing.ts`
- Test: `src/domain/billing.test.ts`

**Interfaces:**
- Consumes: nothing (pure domain module, no dependency on other new files).
- Produces: `export class BillingBlocked extends Error {}`, `export interface BillingRepo { getBillingInfo(campaignId: string): Promise<CampaignBillingInfo | null> }`, `export interface CampaignBillingInfo { subscriptionStatus: string | null; gracePeriodEndsAt: string | null }`, `export class BillingGate { constructor(repo: BillingRepo); check(campaignId: string, now?: Date): Promise<void> }`. Task 4 implements `BillingRepo` against Supabase; Task 11 calls `billingGate.check(...)`.

- [ ] **Step 1: Write the failing tests**

Create `src/domain/billing.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { BillingGate, BillingBlocked, type BillingRepo, type CampaignBillingInfo } from './billing';

function fakeRepo(info: CampaignBillingInfo | null): BillingRepo {
  return { async getBillingInfo() { return info; } };
}

describe('BillingGate.check', () => {
  it('allows a campaign with no plan assigned yet', async () => {
    const gate = new BillingGate(fakeRepo(null));
    await expect(gate.check('camp-1')).resolves.toBeUndefined();
  });

  it('allows an active subscription', async () => {
    const gate = new BillingGate(fakeRepo({ subscriptionStatus: 'active', gracePeriodEndsAt: null }));
    await expect(gate.check('camp-1')).resolves.toBeUndefined();
  });

  it('allows trialing subscriptions', async () => {
    const gate = new BillingGate(fakeRepo({ subscriptionStatus: 'trialing', gracePeriodEndsAt: null }));
    await expect(gate.check('camp-1')).resolves.toBeUndefined();
  });

  it('allows past_due within the grace period', async () => {
    const gate = new BillingGate(fakeRepo({
      subscriptionStatus: 'past_due',
      gracePeriodEndsAt: new Date('2026-07-10T00:00:00Z').toISOString(),
    }));
    await expect(gate.check('camp-1', new Date('2026-07-05T00:00:00Z'))).resolves.toBeUndefined();
  });

  it('blocks past_due once the grace period has ended', async () => {
    const gate = new BillingGate(fakeRepo({
      subscriptionStatus: 'past_due',
      gracePeriodEndsAt: new Date('2026-07-01T00:00:00Z').toISOString(),
    }));
    await expect(gate.check('camp-1', new Date('2026-07-05T00:00:00Z'))).rejects.toThrow(BillingBlocked);
  });

  it('blocks a canceled subscription immediately, regardless of grace period', async () => {
    const gate = new BillingGate(fakeRepo({ subscriptionStatus: 'canceled', gracePeriodEndsAt: null }));
    await expect(gate.check('camp-1')).rejects.toThrow(BillingBlocked);
  });

  it('blocks an unpaid subscription immediately', async () => {
    const gate = new BillingGate(fakeRepo({ subscriptionStatus: 'unpaid', gracePeriodEndsAt: null }));
    await expect(gate.check('camp-1')).rejects.toThrow(BillingBlocked);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/billing.test.ts`
Expected: FAIL with "Cannot find module './billing'".

- [ ] **Step 3: Implement**

Create `src/domain/billing.ts`:
```ts
export interface CampaignBillingInfo {
  subscriptionStatus: string | null;
  gracePeriodEndsAt: string | null;
}

export interface BillingRepo {
  getBillingInfo(campaignId: string): Promise<CampaignBillingInfo | null>;
}

export class BillingBlocked extends Error {}

const INACTIVE_STATUSES = new Set(['canceled', 'unpaid']);

export class BillingGate {
  constructor(private repo: BillingRepo) {}

  async check(campaignId: string, now: Date = new Date()): Promise<void> {
    const info = await this.repo.getBillingInfo(campaignId);
    if (!info || !info.subscriptionStatus) return;

    if (INACTIVE_STATUSES.has(info.subscriptionStatus)) {
      throw new BillingBlocked(
        'This campaign\'s subscription is inactive. Contact your platform admin to restore access.',
      );
    }

    if (info.subscriptionStatus === 'past_due' && info.gracePeriodEndsAt) {
      if (now > new Date(info.gracePeriodEndsAt)) {
        throw new BillingBlocked(
          'This campaign\'s payment is past due and the grace period has ended. Contact your platform admin to restore access.',
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/domain/billing.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/billing.ts src/domain/billing.test.ts
git commit -m "feat(billing): add BillingGate domain logic with grace-period handling"
```

---

### Task 4: Billing repo and service wiring

**Files:**
- Modify: `src/lib/repos.ts`
- Modify: `src/lib/services.ts`

**Interfaces:**
- Consumes: `BillingRepo`, `CampaignBillingInfo` from `src/domain/billing.ts` (Task 3).
- Produces: `export const billingRepo: BillingRepo` from `src/lib/repos.ts`; `export const billingGate: BillingGate` from `src/lib/services.ts`. Task 11 imports `billingGate` from `@/lib/services`.

- [ ] **Step 1: Add the repo implementation**

In `src/lib/repos.ts`, add the import and export (place near the existing `usageRepo` at the end of the file):
```ts
import { BillingRepo, CampaignBillingInfo } from '@/domain/billing';
```
```ts
export const billingRepo: BillingRepo = {
  async getBillingInfo(campaignId): Promise<CampaignBillingInfo | null> {
    const { data } = await adminDb
      .from('campaigns')
      .select('subscription_status, grace_period_ends_at')
      .eq('id', campaignId)
      .single();
    if (!data) return null;
    return {
      subscriptionStatus: (data.subscription_status as string | null) ?? null,
      gracePeriodEndsAt: (data.grace_period_ends_at as string | null) ?? null,
    };
  },
};
```

- [ ] **Step 2: Wire it into services.ts**

In `src/lib/services.ts`, update the imports and add the export:
```ts
import { BillingGate } from '@/domain/billing';
```
Change the repos import line to include `billingRepo`:
```ts
import { contentRepo, approvalRepo, disclosureRepo, auditRepo, rulesRepo, usageRepo, billingRepo } from './repos';
```
Add after `export const usageMeter = new UsageMeter(usageRepo);`:
```ts
export const billingGate = new BillingGate(billingRepo);
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: no type errors; all existing tests still pass (this task adds no new tests — it's thin wiring around already-tested domain logic, consistent with how `usageRepo` in `src/lib/repos.ts` has no dedicated test file).

- [ ] **Step 4: Commit**

```bash
git add src/lib/repos.ts src/lib/services.ts
git commit -m "feat(billing): wire BillingGate into services via a Supabase-backed repo"
```

---

### Task 5: Extend campaign data layer with billing fields

**Files:**
- Modify: `src/lib/data.ts`

**Interfaces:**
- Produces: `Campaign` interface gains `planId`, `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionStatus`, `gracePeriodEndsAt`, `currentPeriodEnd` (all `string | null`); new `export interface BillingPlan { id, name, monthlyPriceCents, seatLimit, includedUsageCents, overageMultiplier, stripeProductId, stripeFlatPriceId, stripeMeteredPriceId, isActive }`; new `export async function getBillingPlans(): Promise<BillingPlan[]>` and `export async function getBillingPlan(id: string): Promise<BillingPlan | null>`. Tasks 7, 8, 11, 12 consume these.

- [ ] **Step 1: Extend the `Campaign` interface and `getCampaign`**

In `src/lib/data.ts`, replace the `Campaign` interface and `getCampaign` function:
```ts
export interface Campaign {
  id: string; name: string; jurisdictions: string[]; monthlyCostCapCents: number;
  planId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  gracePeriodEndsAt: string | null;
  currentPeriodEnd: string | null;
}
```
```ts
export async function getCampaign(campaignId: string): Promise<Campaign | null> {
  const { data } = await adminDb.from('campaigns').select('*').eq('id', campaignId).single();
  if (!data) return null;
  return {
    id: data.id, name: data.name, jurisdictions: data.jurisdictions, monthlyCostCapCents: data.monthly_cost_cap_cents,
    planId: data.plan_id ?? null,
    stripeCustomerId: data.stripe_customer_id ?? null,
    stripeSubscriptionId: data.stripe_subscription_id ?? null,
    subscriptionStatus: data.subscription_status ?? null,
    gracePeriodEndsAt: data.grace_period_ends_at ?? null,
    currentPeriodEnd: data.current_period_end ?? null,
  };
}
```

- [ ] **Step 1b: Fix `getAllCampaigns` for the now-required `Campaign` fields**

`CampaignWithStats extends Campaign` (defined further down in `src/lib/data.ts`), and `getAllCampaigns` builds its return objects by hand rather than calling `getCampaign`. Since Step 1 added required fields to `Campaign`, `getAllCampaigns`'s object literal will now fail to typecheck unless it also sets them. Update it:
```ts
  return campaigns.map(camp => ({
    id: camp.id, name: camp.name, jurisdictions: camp.jurisdictions,
    monthlyCostCapCents: camp.monthly_cost_cap_cents, createdAt: camp.created_at,
    planId: camp.plan_id ?? null,
    stripeCustomerId: camp.stripe_customer_id ?? null,
    stripeSubscriptionId: camp.stripe_subscription_id ?? null,
    subscriptionStatus: camp.subscription_status ?? null,
    gracePeriodEndsAt: camp.grace_period_ends_at ?? null,
    currentPeriodEnd: camp.current_period_end ?? null,
    userCount: users.filter(u => u.campaign_id === camp.id).length,
    contentCount: items.filter(i => i.campaign_id === camp.id).length,
    inReviewCount: items.filter(i => i.campaign_id === camp.id && i.status === 'in_review').length,
    monthlySpendCents: spend.filter(e => e.campaign_id === camp.id).reduce((n, e) => n + e.cost_cents, 0),
  }));
```
This is the exact `campaigns.map(...)` return statement inside `getAllCampaigns` in `src/lib/data.ts` — replace it in place, keeping the rest of the function (the `Promise.all` fetch above it) unchanged.

- [ ] **Step 2: Add `BillingPlan` type and lookups**

Add near the other admin-facing interfaces in `src/lib/data.ts`:
```ts
export interface BillingPlan {
  id: string; name: string; monthlyPriceCents: number; seatLimit: number | null;
  includedUsageCents: number; overageMultiplier: number;
  stripeProductId: string; stripeFlatPriceId: string; stripeMeteredPriceId: string;
  isActive: boolean;
}

function toBillingPlan(r: Record<string, unknown>): BillingPlan {
  return {
    id: r.id as string, name: r.name as string,
    monthlyPriceCents: r.monthly_price_cents as number,
    seatLimit: (r.seat_limit as number | null) ?? null,
    includedUsageCents: r.included_usage_cents as number,
    overageMultiplier: r.overage_multiplier as number,
    stripeProductId: r.stripe_product_id as string,
    stripeFlatPriceId: r.stripe_flat_price_id as string,
    stripeMeteredPriceId: r.stripe_metered_price_id as string,
    isActive: r.is_active as boolean,
  };
}

export async function getBillingPlans(): Promise<BillingPlan[]> {
  const { data } = await adminDb.from('billing_plans').select('*').order('monthly_price_cents');
  return (data ?? []).map(toBillingPlan);
}

export async function getBillingPlan(id: string): Promise<BillingPlan | null> {
  const { data } = await adminDb.from('billing_plans').select('*').eq('id', id).single();
  return data ? toBillingPlan(data) : null;
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: no errors. (No new tests — `src/lib/data.ts` has no existing test file; it's a thin Supabase-row-to-object mapper, consistent with the rest of the file.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/data.ts
git commit -m "feat(billing): add billing fields to Campaign and BillingPlan data access"
```

---

### Task 6: Plan catalog constants

**Files:**
- Create: `src/lib/billing-catalog.ts`
- Test: `src/lib/billing-catalog.test.ts`

**Interfaces:**
- Produces: `export interface PlanDefinition { id, name, monthlyPriceCents, seatLimit, includedUsageCents, overageMultiplier }`, `export const PLAN_DEFINITIONS: PlanDefinition[]`, `export const METER_EVENT_NAME: string`. Tasks 7 and 10 consume these.

- [ ] **Step 1: Write the failing test**

Create `src/lib/billing-catalog.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PLAN_DEFINITIONS, METER_EVENT_NAME } from './billing-catalog';

describe('PLAN_DEFINITIONS', () => {
  it('defines exactly starter, pro, and enterprise in ascending price order', () => {
    expect(PLAN_DEFINITIONS.map(p => p.id)).toEqual(['starter', 'pro', 'enterprise']);
    const prices = PLAN_DEFINITIONS.map(p => p.monthlyPriceCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('gives every plan a positive included usage allowance and an overage multiplier above 1', () => {
    for (const plan of PLAN_DEFINITIONS) {
      expect(plan.includedUsageCents).toBeGreaterThan(0);
      expect(plan.overageMultiplier).toBeGreaterThan(1);
    }
  });
});

describe('METER_EVENT_NAME', () => {
  it('is a non-empty string', () => {
    expect(METER_EVENT_NAME.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/billing-catalog.test.ts`
Expected: FAIL with "Cannot find module './billing-catalog'".

- [ ] **Step 3: Implement**

Create `src/lib/billing-catalog.ts`:
```ts
export interface PlanDefinition {
  id: string;
  name: string;
  monthlyPriceCents: number;
  seatLimit: number | null;
  includedUsageCents: number;
  overageMultiplier: number;
}

// Exact values from docs/superpowers/specs/2026-07-03-stripe-billing-design.md
export const PLAN_DEFINITIONS: PlanDefinition[] = [
  { id: 'starter',    name: 'Starter',    monthlyPriceCents: 4_900,  seatLimit: 3,    includedUsageCents: 2_500,  overageMultiplier: 1.3 },
  { id: 'pro',        name: 'Pro',        monthlyPriceCents: 14_900, seatLimit: 10,   includedUsageCents: 10_000, overageMultiplier: 1.3 },
  { id: 'enterprise', name: 'Enterprise', monthlyPriceCents: 49_900, seatLimit: null, includedUsageCents: 40_000, overageMultiplier: 1.2 },
];

// Every campaign's blended AI/video/voice usage reports to this one Stripe
// Billing Meter, in cents. Each plan's metered price applies its own
// included-allowance/overage tiers on top of the same underlying meter.
export const METER_EVENT_NAME = 'platform_usage_cents';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/billing-catalog.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/billing-catalog.ts src/lib/billing-catalog.test.ts
git commit -m "feat(billing): add plan tier catalog constants"
```

---

### Task 7: Sync plan catalog to Stripe (admin action + page)

**Files:**
- Create: `src/app/admin/billing/actions.ts`
- Create: `src/app/admin/billing/page.tsx`
- Modify: `src/components/AdminSidebar.tsx`

**Interfaces:**
- Consumes: `stripe` (Task 1), `PLAN_DEFINITIONS`, `METER_EVENT_NAME` (Task 6), `getBillingPlans` (Task 5).
- Produces: `export async function syncBillingPlansAction(): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Write the sync action**

Create `src/app/admin/billing/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/session';
import { adminDb } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { PLAN_DEFINITIONS, METER_EVENT_NAME } from '@/lib/billing-catalog';

export async function syncBillingPlansAction(): Promise<{ ok: boolean; error?: string }> {
  requireAdmin();
  if (!stripe) return { ok: false, error: 'STRIPE_SECRET_KEY is not configured on this server.' };

  const meters = await stripe.billing.meters.list({ limit: 100 });
  let meter = meters.data.find(m => m.event_name === METER_EVENT_NAME);
  if (!meter) {
    meter = await stripe.billing.meters.create({
      display_name: 'Platform usage (cents)',
      event_name: METER_EVENT_NAME,
      default_aggregation: { formula: 'sum' },
      customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
      value_settings: { event_payload_key: 'value' },
    });
  }

  const { data: existingPlans } = await adminDb.from('billing_plans').select('id');
  const existingIds = new Set((existingPlans ?? []).map(p => p.id));

  for (const def of PLAN_DEFINITIONS) {
    if (existingIds.has(def.id)) continue;

    const product = await stripe.products.create({ name: `${def.name} plan` });

    const flatPrice = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: def.monthlyPriceCents,
      recurring: { interval: 'month' },
    });

    // Meter reports usage in cents. Tier 1 is free up to the plan's included
    // allowance (also in cents); tier 2 charges overageMultiplier cents per
    // 1 cent of underlying vendor cost beyond that.
    const meteredPrice = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      recurring: { interval: 'month', meter: meter.id, usage_type: 'metered' },
      billing_scheme: 'tiered',
      tiers_mode: 'graduated',
      tiers: [
        { up_to: def.includedUsageCents, unit_amount: 0 },
        { up_to: 'inf', unit_amount_decimal: def.overageMultiplier.toFixed(4) },
      ],
    });

    await adminDb.from('billing_plans').insert({
      id: def.id,
      name: def.name,
      monthly_price_cents: def.monthlyPriceCents,
      seat_limit: def.seatLimit,
      included_usage_cents: def.includedUsageCents,
      overage_multiplier: def.overageMultiplier,
      stripe_product_id: product.id,
      stripe_flat_price_id: flatPrice.id,
      stripe_metered_price_id: meteredPrice.id,
      is_active: true,
    });
  }

  revalidatePath('/admin/billing');
  return { ok: true };
}
```

- [ ] **Step 2: Write the admin billing page**

Create `src/app/admin/billing/page.tsx`:
```tsx
import { getBillingPlans } from '@/lib/data';
import { syncBillingPlansAction } from './actions';

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function AdminBillingPage() {
  const plans = await getBillingPlans();

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">System</span>
          <h1>Billing plans</h1>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
          Creates the Stripe products, prices, and usage meter for each plan tier defined in{' '}
          <code>src/lib/billing-catalog.ts</code>. Safe to run more than once — plans that already
          exist locally are skipped.
        </p>
        <form action={syncBillingPlansAction}>
          <button className="btn primary" type="submit">Sync plans to Stripe</button>
        </form>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>Plan</th><th>Price</th><th>Seats</th><th>Included usage</th><th>Overage</th></tr>
          </thead>
          <tbody>
            {plans.map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</td>
                <td>{fmt(p.monthlyPriceCents)}/mo</td>
                <td className="muted">{p.seatLimit ?? 'Unlimited'}</td>
                <td className="muted">{fmt(p.includedUsageCents)}</td>
                <td className="muted">{p.overageMultiplier}x</td>
              </tr>
            ))}
            {plans.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ padding: 20 }}>No plans yet — click "Sync plans to Stripe" above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the sidebar nav link**

In `src/components/AdminSidebar.tsx`, add a new entry to the `NAV` array, after the `/admin/disclosure-rules` entry:
```ts
  {
    href: '/admin/billing',
    label: 'Billing',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: no errors. (No automated test here — this action makes live Stripe API calls, consistent with other admin actions like `assignAvatarAction` in `src/app/admin/actions.ts` that also have no test file.) Manually verify once `STRIPE_SECRET_KEY` (test mode) is set: run the dev server, sign in as `super_admin`, visit `/admin/billing`, click "Sync plans to Stripe", and confirm three rows appear in the table and three products with two prices each appear in the Stripe Dashboard (test mode).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/billing/actions.ts src/app/admin/billing/page.tsx src/components/AdminSidebar.tsx
git commit -m "feat(billing): add admin action and page to sync plan catalog to Stripe"
```

---

### Task 8: Assign plan to campaign + admin billing portal link

**Files:**
- Modify: `src/app/admin/actions.ts`
- Modify: `src/app/admin/campaigns/[id]/page.tsx`

**Interfaces:**
- Consumes: `stripe` (Task 1), `getCampaign`, `getBillingPlan`, `getBillingPlans` (Task 5).
- Produces: `export async function assignPlanAction(formData: FormData): Promise<{ ok: boolean; error?: string }>`, `export async function openBillingPortalForCampaignAction(formData: FormData): Promise<void>` in `src/app/admin/actions.ts`.

- [ ] **Step 1: Add the actions**

In `src/app/admin/actions.ts`, add the import:
```ts
import { stripe } from '@/lib/stripe';
```
Add these two functions (after `createCampaignAction`):
```ts
export async function assignPlanAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  requireAdmin();
  if (!stripe) return { ok: false, error: 'STRIPE_SECRET_KEY is not configured on this server.' };

  const campaignId = String(formData.get('campaignId') ?? '');
  const planId = String(formData.get('planId') ?? '');
  if (!campaignId || !planId) return { ok: false, error: 'Campaign and plan are required.' };

  const { getCampaign, getBillingPlan } = await import('@/lib/data');
  const [campaign, plan] = await Promise.all([getCampaign(campaignId), getBillingPlan(planId)]);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };
  if (!plan) return { ok: false, error: 'Plan not found.' };

  let customerId = campaign.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: campaign.name,
      metadata: { campaign_id: campaignId },
    });
    customerId = customer.id;
  }

  // Changing plans cancels the old subscription and starts a fresh one —
  // simpler than diffing subscription items, and plan changes are an
  // infrequent admin action, not a self-serve upgrade flow.
  if (campaign.stripeSubscriptionId) {
    await stripe.subscriptions.cancel(campaign.stripeSubscriptionId);
  }

  // With no payment method on the customer yet, Stripe creates this in
  // 'incomplete' status; it becomes 'active' once the campaign pays via the
  // billing portal, and the webhook (Task 9) syncs that status here.
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: plan.stripeFlatPriceId }, { price: plan.stripeMeteredPriceId }],
  });

  await adminDb.from('campaigns').update({
    plan_id: plan.id,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    monthly_cost_cap_cents: plan.includedUsageCents,
    grace_period_ends_at: null,
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
  }).eq('id', campaignId);

  revalidatePath(`/admin/campaigns/${campaignId}`);
  return { ok: true };
}

export async function openBillingPortalForCampaignAction(formData: FormData): Promise<void> {
  requireAdmin();
  const campaignId = String(formData.get('campaignId') ?? '');
  if (!stripe || !campaignId) return;

  const { getCampaign } = await import('@/lib/data');
  const campaign = await getCampaign(campaignId);
  if (!campaign?.stripeCustomerId) return;

  const session = await stripe.billingPortal.sessions.create({
    customer: campaign.stripeCustomerId,
    return_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/admin/campaigns/${campaignId}`,
  });
  redirect(session.url);
}
```

- [ ] **Step 2: Add the Billing panel to the campaign detail page**

In `src/app/admin/campaigns/[id]/page.tsx`, update the imports:
```tsx
import { getCampaignWithStats, getUsers, getContentItems, getAuditEntries, getInviteCodes, getBillingPlans } from '@/lib/data';
import {
  updateCampaignAction, addUserAction, removeUserAction, impersonateAction,
  generateInviteAction, assignAvatarAction, assignPlanAction, openBillingPortalForCampaignAction,
} from '../../actions';
```
Update the `Promise.all` to also fetch plans:
```tsx
  const [campaign, users, content, audit, invites, profile, plans] = await Promise.all([
    getCampaignWithStats(params.id),
    getUsers(params.id),
    getContentItems(params.id),
    getAuditEntries(params.id),
    getInviteCodes(params.id),
    getCandidateProfile(params.id),
    getBillingPlans(),
  ]);
```
Add a new "Billing" card, right after the closing `</div>` of the "Edit campaign / Spend summary" grid (`</div>` that closes the `gridTemplateColumns: '1fr 1fr'` block) and before the "Avatar assignment" card:
```tsx
      {/* Billing */}
      <div className="card" style={{ marginBottom: 24 }}>
        <span className="eyebrow">Billing</span>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 16px' }}>Subscription</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: campaign.subscriptionStatus === 'active' ? 'var(--ok)' : campaign.subscriptionStatus ? 'var(--warn)' : 'var(--text-3)', display: 'inline-block' }} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {campaign.planId
              ? `${plans.find(p => p.id === campaign.planId)?.name ?? campaign.planId} — ${campaign.subscriptionStatus ?? 'unknown'}`
              : 'No plan assigned'}
          </span>
        </div>
        {campaign.currentPeriodEnd && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
            Current period ends {new Date(campaign.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        )}
        <form action={assignPlanAction} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: campaign.stripeCustomerId ? 12 : 0 }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div style={{ minWidth: 200 }}>
            <label className="field-label">Plan</label>
            <select name="planId" className="input" defaultValue={campaign.planId ?? ''} required>
              <option value="" disabled>Select a plan</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <button className="btn primary" type="submit" style={{ fontSize: 13, marginBottom: 1 }}>
            {campaign.planId ? 'Change plan' : 'Assign plan'}
          </button>
        </form>
        {campaign.stripeCustomerId && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <form action={openBillingPortalForCampaignAction}>
              <input type="hidden" name="campaignId" value={campaign.id} />
              <button className="btn" type="submit" style={{ fontSize: 12 }}>Open billing portal for this customer →</button>
            </form>
            <a
              href={`https://dashboard.stripe.com/customers/${campaign.stripeCustomerId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: 'var(--text-3)' }}
            >
              View in Stripe Dashboard →
            </a>
          </div>
        )}
      </div>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: no errors. Manually verify with a test-mode `STRIPE_SECRET_KEY` and at least one synced plan (Task 7): assign a plan to a campaign from `/admin/campaigns/[id]`, confirm the status badge shows the plan name and an `incomplete` or `active` status, and confirm a Customer + Subscription appear in the Stripe Dashboard test mode.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/actions.ts src/app/admin/campaigns/[id]/page.tsx
git commit -m "feat(billing): let admins assign plans to campaigns and open the billing portal"
```

---

### Task 9: Stripe webhook handler

**Files:**
- Create: `src/lib/billing-webhook.ts`
- Test: `src/lib/billing-webhook.test.ts`
- Create: `src/app/api/webhooks/stripe/route.ts`

**Interfaces:**
- Consumes: `stripe` (Task 1).
- Produces: `export type StripeSubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused'`, `export interface BillingUpdate { subscriptionStatus: string; gracePeriodEndsAt: string | null }`, `export function computeSubscriptionUpdate(status: StripeSubscriptionStatus, now?: Date): BillingUpdate`. The route handler is glue code around this pure function.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/billing-webhook.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeSubscriptionUpdate } from './billing-webhook';

describe('computeSubscriptionUpdate', () => {
  it('sets a 7-day grace period when a subscription goes past_due', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const result = computeSubscriptionUpdate('past_due', now);
    expect(result).toEqual({
      subscriptionStatus: 'past_due',
      gracePeriodEndsAt: new Date('2026-07-08T00:00:00Z').toISOString(),
    });
  });

  it('clears the grace period when a subscription becomes active', () => {
    expect(computeSubscriptionUpdate('active')).toEqual({ subscriptionStatus: 'active', gracePeriodEndsAt: null });
  });

  it('clears the grace period immediately on cancellation — no grace period on outright cancellation', () => {
    expect(computeSubscriptionUpdate('canceled')).toEqual({ subscriptionStatus: 'canceled', gracePeriodEndsAt: null });
  });

  it('clears the grace period immediately when unpaid', () => {
    expect(computeSubscriptionUpdate('unpaid')).toEqual({ subscriptionStatus: 'unpaid', gracePeriodEndsAt: null });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/billing-webhook.test.ts`
Expected: FAIL with "Cannot find module './billing-webhook'".

- [ ] **Step 3: Implement the pure mapping function**

Create `src/lib/billing-webhook.ts`:
```ts
export type StripeSubscriptionStatus =
  | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'
  | 'incomplete' | 'incomplete_expired' | 'paused';

export interface BillingUpdate {
  subscriptionStatus: string;
  gracePeriodEndsAt: string | null;
}

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export function computeSubscriptionUpdate(
  status: StripeSubscriptionStatus,
  now: Date = new Date(),
): BillingUpdate {
  if (status === 'past_due') {
    return {
      subscriptionStatus: 'past_due',
      gracePeriodEndsAt: new Date(now.getTime() + GRACE_PERIOD_MS).toISOString(),
    };
  }
  return { subscriptionStatus: status, gracePeriodEndsAt: null };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/billing-webhook.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the webhook route**

Create `src/app/api/webhooks/stripe/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { adminDb } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { computeSubscriptionUpdate, type StripeSubscriptionStatus } from '@/lib/billing-webhook';

export async function POST(req: NextRequest) {
  if (!stripe) return NextResponse.json({ error: 'Billing not configured' }, { status: 503 });

  const signature = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    return NextResponse.json({ error: `Invalid signature: ${e}` }, { status: 400 });
  }

  const { data: alreadyProcessed } = await adminDb
    .from('billing_events')
    .select('id')
    .eq('id', event.id)
    .maybeSingle();
  if (alreadyProcessed) return NextResponse.json({ received: true, duplicate: true });

  let campaignId: string | null = null;

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const { data: campaign } = await adminDb
      .from('campaigns')
      .select('id')
      .eq('stripe_subscription_id', sub.id)
      .maybeSingle();

    if (campaign) {
      campaignId = campaign.id;
      const status: StripeSubscriptionStatus =
        event.type === 'customer.subscription.deleted' ? 'canceled' : (sub.status as StripeSubscriptionStatus);
      const update = computeSubscriptionUpdate(status);
      const { error: updateError } = await adminDb.from('campaigns').update({
        subscription_status: update.subscriptionStatus,
        grace_period_ends_at: update.gracePeriodEndsAt,
        current_period_end: event.type === 'customer.subscription.deleted'
          ? null
          : new Date(sub.current_period_end * 1000).toISOString(),
      }).eq('id', campaign.id);

      // Supabase-js reports failures via `error`, not by throwing. Bail out
      // before marking the event processed so Stripe retries delivery —
      // otherwise a failed write here would be silently lost forever, since
      // the billing_events dedup check would skip it on redelivery.
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }
  }

  await adminDb.from('billing_events').insert({
    id: event.id,
    type: event.type,
    campaign_id: campaignId,
    payload: event as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: no errors. Manually verify with the Stripe CLI once test-mode keys are configured:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger customer.subscription.updated
```
Expected: the CLI shows a `200` response, and a new row appears in `billing_events`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/billing-webhook.ts src/lib/billing-webhook.test.ts src/app/api/webhooks/stripe/route.ts
git commit -m "feat(billing): add Stripe webhook handler for subscription status sync"
```

---

### Task 10: Usage-to-Stripe sync cron

**Files:**
- Create: `src/lib/billing-sync.ts`
- Test: `src/lib/billing-sync.test.ts`
- Create: `src/app/api/cron/billing-sync/route.ts`

**Interfaces:**
- Consumes: `stripe` (Task 1), `METER_EVENT_NAME` (Task 6).
- Produces: `export interface UsageEventRow { id: string; costCents: number; createdAt: string }`, `export interface SyncCursor { lastSyncedId: string; lastSyncedAt: string }`, `export function summarizeUsageEvents(events: UsageEventRow[]): { totalCents: number; cursor: SyncCursor } | null`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/billing-sync.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { summarizeUsageEvents } from './billing-sync';

describe('summarizeUsageEvents', () => {
  it('returns null when there are no new events', () => {
    expect(summarizeUsageEvents([])).toBeNull();
  });

  it('sums cost across events and advances the cursor to the last event', () => {
    const events = [
      { id: 'ue-1', costCents: 500, createdAt: '2026-07-01T00:00:00Z' },
      { id: 'ue-2', costCents: 300, createdAt: '2026-07-01T00:05:00Z' },
    ];
    expect(summarizeUsageEvents(events)).toEqual({
      totalCents: 800,
      cursor: { lastSyncedId: 'ue-2', lastSyncedAt: '2026-07-01T00:05:00Z' },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/billing-sync.test.ts`
Expected: FAIL with "Cannot find module './billing-sync'".

- [ ] **Step 3: Implement the pure function**

Create `src/lib/billing-sync.ts`:
```ts
export interface UsageEventRow {
  id: string;
  costCents: number;
  createdAt: string;
}

export interface SyncCursor {
  lastSyncedId: string;
  lastSyncedAt: string;
}

// events must be sorted ascending by createdAt.
export function summarizeUsageEvents(events: UsageEventRow[]): { totalCents: number; cursor: SyncCursor } | null {
  if (events.length === 0) return null;
  const totalCents = events.reduce((sum, e) => sum + e.costCents, 0);
  const last = events[events.length - 1];
  return { totalCents, cursor: { lastSyncedId: last.id, lastSyncedAt: last.createdAt } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/billing-sync.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the cron route**

Create `src/app/api/cron/billing-sync/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { summarizeUsageEvents } from '@/lib/billing-sync';
import { METER_EVENT_NAME } from '@/lib/billing-catalog';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!stripe) return NextResponse.json({ error: 'Billing not configured' }, { status: 503 });

  const { data: campaigns } = await adminDb
    .from('campaigns')
    .select('id, stripe_customer_id, subscription_status')
    .not('stripe_customer_id', 'is', null)
    .in('subscription_status', ['trialing', 'active', 'past_due']);

  const results: { campaignId: string; synced: boolean; error?: string }[] = [];

  for (const campaign of campaigns ?? []) {
    try {
      const { data: cursorRow } = await adminDb
        .from('usage_sync_cursor')
        .select('last_synced_at')
        .eq('campaign_id', campaign.id)
        .maybeSingle();
      const since = cursorRow?.last_synced_at ?? '1970-01-01T00:00:00Z';

      const { data: events } = await adminDb
        .from('usage_events')
        .select('id, cost_cents, created_at')
        .eq('campaign_id', campaign.id)
        .gt('created_at', since)
        .order('created_at', { ascending: true });

      const summary = summarizeUsageEvents(
        (events ?? []).map(e => ({ id: e.id, costCents: e.cost_cents, createdAt: e.created_at })),
      );
      if (!summary) {
        results.push({ campaignId: campaign.id, synced: false });
        continue;
      }

      await stripe.billing.meterEvents.create({
        event_name: METER_EVENT_NAME,
        payload: { stripe_customer_id: campaign.stripe_customer_id!, value: String(summary.totalCents) },
        identifier: `${campaign.id}:${summary.cursor.lastSyncedId}`,
      });

      await adminDb.from('usage_sync_cursor').upsert({
        campaign_id: campaign.id,
        last_synced_id: summary.cursor.lastSyncedId,
        last_synced_at: summary.cursor.lastSyncedAt,
      });

      results.push({ campaignId: campaign.id, synced: true });
    } catch (e) {
      results.push({ campaignId: campaign.id, synced: false, error: String(e) });
    }
  }

  return NextResponse.json({
    synced: results.filter(r => r.synced).length,
    failed: results.filter(r => r.error).length,
    results,
  });
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: no errors. Manually verify locally:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/billing-sync
```
Expected: JSON response with `synced`/`failed` counts; for a campaign with recent `usage_events` and an active test-mode subscription, confirm a corresponding meter event appears under that customer in the Stripe Dashboard (test mode → Billing → Meters).

- [ ] **Step 7: Commit**

```bash
git add src/lib/billing-sync.ts src/lib/billing-sync.test.ts src/app/api/cron/billing-sync/route.ts
git commit -m "feat(billing): add cron job to sync usage_events to Stripe as meter events"
```

---

### Task 11: Gate paid actions on billing status

**Files:**
- Modify: `src/app/actions.ts`

**Interfaces:**
- Consumes: `billingGate` from `@/lib/services` (Task 4), `BillingBlocked` from `@/domain/billing` (Task 3), `stripe` (Task 1).
- Produces: `export async function openMyBillingPortalAction(): Promise<void>`.

- [ ] **Step 1: Add imports**

In `src/app/actions.ts`, update the services import to include `billingGate`:
```ts
import { lifecycle, disclosureEngine, usageMeter, billingGate, contentGenerator, publisher, videoProvider, voiceProvider, photoAvatarProvider } from '@/lib/services';
```
Add the `BillingBlocked` import next to the existing `CapExceeded` import:
```ts
import { BillingBlocked } from '@/domain/billing';
```

- [ ] **Step 2: Update the shared `guard()` helper**

Replace the `guard()` function so it also catches `BillingBlocked`:
```ts
function guard<T>(fn: () => Promise<T>): Promise<Result> {
  return fn().then(() => ({ ok: true as const })).catch((e: unknown) => {
    if (e instanceof GateError || e instanceof CapExceeded || e instanceof BillingBlocked) return { ok: false as const, error: e.message };
    throw e;
  });
}
```

- [ ] **Step 3: Add the billing check before each usage guard**

In `generateDraftAction`, immediately before `await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, cost);` (currently line 162), add:
```ts
  await billingGate.check(s.campaignId);
```

In `generateVideoAction`, immediately before `await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, VIDEO_COST_CENTS);` (currently line 258), add the same line, and update that function's `catch` block (currently line 274):
```ts
  } catch (e) {
    if (e instanceof CapExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }
```

In `synthesizeVoiceAction`, immediately before `await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, 20_00);` (currently line 290), add the same line, and update that function's `catch` block (currently line 295) the same way as above.

In `generateFromMonitoringAction`, immediately before `await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, cost);` (currently line 385), add the same line, and update that function's `catch` block (currently line 422) the same way as above.

- [ ] **Step 4: Add the campaign-side billing portal action**

Add this function near `setCapAction`:
```ts
export async function openMyBillingPortalAction(): Promise<void> {
  const s = requireSession();
  if (!can(s.role, 'edit_settings')) return;
  const { stripe } = await import('@/lib/stripe');
  if (!stripe) return;
  const campaign = await getCampaign(s.campaignId);
  if (!campaign?.stripeCustomerId) return;
  const session = await stripe.billingPortal.sessions.create({
    customer: campaign.stripeCustomerId,
    return_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/settings`,
  });
  redirect(session.url);
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: no type errors; all tests pass (this task adds no new tests of its own — the branching logic it wires in is already covered by `src/domain/billing.test.ts`; these call sites are thin glue identical in shape to the existing `CapExceeded` wiring, which also has no direct test in `actions.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/app/actions.ts
git commit -m "feat(billing): block paid actions when a campaign's billing is inactive"
```

---

### Task 12: Settings page billing card

**Files:**
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `getBillingPlan` (Task 5), `getMonthlySpend` (existing, `src/lib/data.ts`), `openMyBillingPortalAction` (Task 11), `formatDate` (existing, `src/lib/formatDate.ts`).

- [ ] **Step 1: Fetch billing data**

In `src/app/settings/page.tsx`, update imports:
```tsx
import { getCampaign, getDisclosureRules, getUsers, getBillingPlan, getMonthlySpend } from '@/lib/data';
import { setCapAction, openMyBillingPortalAction } from '@/app/actions';
import { formatDate } from '@/lib/formatDate';
```
Update the data-fetching block:
```tsx
export default async function Settings() {
  const s = requireSession();
  const [campaign, rules, users, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getDisclosureRules(),
    getUsers(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  const [plan, monthlySpendCents] = await Promise.all([
    campaign?.planId ? getBillingPlan(campaign.planId) : Promise.resolve(null),
    getMonthlySpend(s.campaignId),
  ]);
  const cap = ((campaign?.monthlyCostCapCents ?? 0) / 100).toFixed(0);
  const canEdit = can(s.role, 'edit_settings');
```

- [ ] **Step 2: Add the Billing card**

Insert this card right after the "Monthly spend cap" card's closing `</div>` (still inside the `<div className="grid cols-2">` block, so it becomes a third card — change that wrapper's class from `cols-2` to a plain `<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>` if `cols-2` is a fixed 2-column CSS class; otherwise add the card directly after that grid's closing `</div>`):
```tsx
      <div className="spacer-y" />
      <div className="card">
        <h2>Billing</h2>
        {campaign?.subscriptionStatus === 'past_due' && (
          <div className="banner warn" style={{ margin: '12px 0' }}>
            <div>
              <div className="t">Payment past due</div>
              <div className="b">
                {campaign.gracePeriodEndsAt
                  ? `Update your payment method by ${formatDate(campaign.gracePeriodEndsAt, 'date')} to avoid losing access to AI drafting, video, and voice generation.`
                  : 'Update your payment method to avoid losing access.'}
              </div>
            </div>
          </div>
        )}
        {(campaign?.subscriptionStatus === 'canceled' || campaign?.subscriptionStatus === 'unpaid') && (
          <div className="banner warn" style={{ margin: '12px 0' }}>
            <div>
              <div className="t">Billing inactive</div>
              <div className="b">AI drafting, video, and voice generation are blocked until this is resolved. Contact your platform admin.</div>
            </div>
          </div>
        )}
        {plan ? (
          <>
            <p style={{ fontSize: 14, marginTop: 8 }}>
              <strong>{plan.name}</strong> — {(plan.monthlyPriceCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}/mo
            </p>
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {(monthlySpendCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} used of{' '}
              {(plan.includedUsageCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} included this month
            </p>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>No plan assigned yet — contact your platform admin.</p>
        )}
        {canEdit && campaign?.stripeCustomerId && (
          <form action={openMyBillingPortalAction} style={{ marginTop: 12 }}>
            <button className="btn primary" type="submit">Manage billing</button>
          </form>
        )}
      </div>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: no errors. Start the dev server (`npm run dev`), sign in as a campaign `owner`, and visit `/settings`. Expected: the Billing card renders; with no plan assigned it shows "No plan assigned yet"; after Task 8's admin flow assigns a plan, it shows the plan name/price/usage and a "Manage billing" button that redirects to a live Stripe test-mode portal session.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat(billing): show plan, usage, and billing status on the Settings page"
```

---

### Task 13: Final integration pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: all tests pass, including the new `src/domain/billing.test.ts`, `src/lib/billing-catalog.test.ts`, `src/lib/billing-webhook.test.ts`, and `src/lib/billing-sync.test.ts`.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors across the whole project.

- [ ] **Step 3: Manual end-to-end walkthrough (test mode)**

With `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` set to Stripe test-mode values, and `stripe listen --forward-to localhost:3000/api/webhooks/stripe` running:

1. Visit `/admin/billing` as `super_admin`, click "Sync plans to Stripe" — confirm 3 rows appear.
2. Visit `/admin/campaigns/[id]`, assign the "Starter" plan to a campaign — confirm the status badge appears and a Customer + Subscription show up in the Stripe Dashboard test mode.
3. In the Stripe Dashboard (test mode), add a test payment method to that customer and pay the open invoice — confirm the webhook fires, `billing_events` gets a new row, and the campaign's `subscription_status` becomes `active`.
4. As that campaign's owner, generate an AI draft — confirm it succeeds and a corresponding `usage_events` row is created.
5. Run `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/billing-sync` — confirm a meter event appears for that customer in Stripe (Billing → Meters).
6. In the Stripe Dashboard, cancel that customer's subscription — confirm the webhook sets `subscription_status` to `canceled`, and confirm the next AI-draft/video/voice attempt for that campaign is now blocked with the `BillingBlocked` message.

- [ ] **Step 4: Commit**

No code changes in this task — nothing to commit. If any issues were found and fixed during the walkthrough, commit those fixes with a message describing what was wrong.
