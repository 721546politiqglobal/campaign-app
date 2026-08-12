# Editable Billing Plan Catalog & Weekly Billing Interval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super_admin create and edit billing plans (name, price, seat/avatar/content/video limits, and billing interval — week or month) through a UI, instead of only running a one-time sync from the hardcoded `PLAN_DEFINITIONS` array.

**Architecture:** Add a `billing_interval` column to `billing_plans`. Add one new server action, `upsertBillingPlanAction`, that creates-or-updates a plan row and its Stripe product/price (Stripe prices are immutable, so changing price or interval creates a new Stripe Price and archives the old one — existing subscribers keep billing on the old price until a super_admin explicitly reassigns them). Extend `/admin/billing` with an edit form per plan plus a "create new plan" form. `billing-catalog.ts` and `syncBillingPlansAction` are untouched — they remain the one-time bootstrap for the three starter plans; the new action is how plans get edited or added afterward.

**Tech Stack:** TypeScript, Supabase (Postgres), Stripe SDK, Vitest.

## Global Constraints
- Stripe Prices are immutable once created: never call `stripe.prices.update` to change `unit_amount` or `recurring.interval` — always create a new Price and set the old one `active: false`.
- Editing a plan must never change what an already-subscribed campaign is billed — only `assignPlanAction` (existing, unchanged) moves a campaign onto a different price.
- `billing_interval` is only `'week'` or `'month'` — enforce with a DB check constraint and validate in the action.

---

## Background (read before starting)

- `billing_plans` schema today (after migrations 010 and 028): `id, name, monthly_price_cents, seat_limit, avatar_limit, content_limit_monthly, video_limit_daily, stripe_product_id, stripe_flat_price_id, is_active`. There is **no** `stripe_metered_price_id` anymore (dropped in `030_drop_usage_cap_infra.sql` — an earlier scan of this codebase assumed it still existed; it doesn't).
- `syncBillingPlansAction` (`src/app/admin/billing/actions.ts:9-44`) reads `PLAN_DEFINITIONS` from `src/lib/billing-catalog.ts`, and for any `def.id` not already in `billing_plans`, creates a Stripe product + price (hardcoded `recurring: { interval: 'month' }`) and inserts the row. It's a bootstrap-only, idempotent operation — leave it as-is.
- `assignPlanAction` (`src/app/admin/actions.ts:93-159`) and `startCheckoutAction`/`changePlanAction` (`src/app/pricing/actions.ts`) all just reference `plan.stripeFlatPriceId` when creating/updating a Stripe subscription — they never touch `interval` directly. Stripe bills at whatever interval is baked into that Price. **No changes needed in those three files** — once a plan has a weekly-interval Price, assigning/subscribing to it "just works."
- Display-only spots hardcode "/mo": `src/app/pricing/page.tsx:77`, `src/app/billing/page.tsx:94`, `src/app/admin/billing/page.tsx:62`. These need to read the new `billingInterval` field instead.
- `BillingPlan` type + `toBillingPlan` mapper live in `src/lib/data.ts:179-208`.

---

### Task 1: Add `billing_interval` to `billing_plans`

**Files:**
- Create: `supabase/migrations/034_billing_plan_interval.sql`

**Interfaces:**
- Produces: column `billing_plans.billing_interval text not null default 'month' check (billing_interval in ('week','month'))`, consumed by Task 2's action and Task 3's data-layer changes.

- [ ] **Step 1: Write the migration**

Before naming the file, run `ls supabase/migrations/ | sort | tail -3` to confirm `034` is still the next free number — another migration may have landed since this plan was written. Renumber if not.

```sql
-- supabase/migrations/034_billing_plan_interval.sql
-- Lets a plan bill weekly instead of only monthly (campaigns run shorter
-- cycles than a typical SaaS subscription) — see
-- docs/superpowers/specs/2026-08-11-disclosures-billing-campaigns-design.md.
alter table billing_plans
  add column if not exists billing_interval text not null default 'month'
    check (billing_interval in ('week', 'month'));
```

- [ ] **Step 2: Apply it**

Run this in the Supabase SQL editor (or via whatever mechanism the project uses to apply migrations locally — check `supabase/migrations/README.md` if one exists; otherwise paste directly into the SQL editor as the existing migrations' headers instruct).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/034_billing_plan_interval.sql
git commit -m "feat(billing): add billing_interval column to billing_plans"
```

---

### Task 2: `upsertBillingPlanAction` — create or edit a plan

**Files:**
- Modify: `src/app/admin/billing/actions.ts`
- Test: `src/app/admin/billing/actions.upsert.test.ts` (new)

**Interfaces:**
- Consumes: `stripe` from `@/lib/stripe` (nullable `Stripe` client), `adminDb` from `@/lib/supabase`, `prefixedId` from `@/lib/store`.
- Produces: `upsertBillingPlanAction(formData: FormData): Promise<{ ok: boolean; error?: string }>`, exported alongside the existing `syncBillingPlansAction`. Form fields read: `id` (empty string for a new plan), `name`, `priceDollars`, `billingInterval` (`'week' | 'month'`), `seatLimit`, `avatarLimit`, `contentLimitMonthly`, `videoLimitDaily` (the four limit fields are empty string for "unlimited").

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/admin/billing/actions.upsert.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(async () => ({ userId: 'sa-1' })) }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(() => 'plan-new') }));

const productsCreate = vi.fn(async () => ({ id: 'prod_new' }));
const pricesCreate = vi.fn(async () => ({ id: 'price_new' }));
const pricesUpdate = vi.fn(async () => ({}));
vi.mock('@/lib/stripe', () => ({
  stripe: { products: { create: productsCreate }, prices: { create: pricesCreate, update: pricesUpdate } },
}));

const single = vi.fn(async () => ({ data: null }));
const eq = vi.fn(() => ({ single }));
const select = vi.fn(() => ({ eq }));
const upsert = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ select, upsert })) },
}));

function fd(over: Record<string, string> = {}) {
  const f = new FormData();
  f.set('id', ''); f.set('name', 'Weekly Starter'); f.set('priceDollars', '49');
  f.set('billingInterval', 'week');
  f.set('seatLimit', '3'); f.set('avatarLimit', '2'); f.set('contentLimitMonthly', '15'); f.set('videoLimitDaily', '1');
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe('upsertBillingPlanAction', () => {
  it('creates a new plan: Stripe product + price with the chosen interval, then upserts the row', async () => {
    single.mockResolvedValue({ data: null });
    const { upsertBillingPlanAction } = await import('./actions');
    const r = await upsertBillingPlanAction(fd());
    expect(r).toEqual({ ok: true });
    expect(productsCreate).toHaveBeenCalledWith({ name: 'Weekly Starter plan' });
    expect(pricesCreate).toHaveBeenCalledWith(expect.objectContaining({
      product: 'prod_new', unit_amount: 4900, recurring: { interval: 'week' },
    }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'plan-new', name: 'Weekly Starter', monthly_price_cents: 4900, billing_interval: 'week',
      seat_limit: 3, avatar_limit: 2, content_limit_monthly: 15, video_limit_daily: 1,
      stripe_product_id: 'prod_new', stripe_flat_price_id: 'price_new',
    }));
    expect(pricesUpdate).not.toHaveBeenCalled();
  });

  it('editing an existing plan’s price archives the old Stripe price and creates a new one', async () => {
    single.mockResolvedValue({
      data: {
        id: 'plan-starter', monthly_price_cents: 4900, billing_interval: 'month',
        stripe_product_id: 'prod_existing', stripe_flat_price_id: 'price_old',
      },
    });
    const { upsertBillingPlanAction } = await import('./actions');
    await upsertBillingPlanAction(fd({ id: 'plan-starter', priceDollars: '59' }));
    expect(productsCreate).not.toHaveBeenCalled();
    expect(pricesCreate).toHaveBeenCalledWith(expect.objectContaining({ product: 'prod_existing', unit_amount: 5900 }));
    expect(pricesUpdate).toHaveBeenCalledWith('price_old', { active: false });
  });

  it('editing only a limit field, with price and interval unchanged, never calls Stripe', async () => {
    single.mockResolvedValue({
      data: {
        id: 'plan-starter', monthly_price_cents: 4900, billing_interval: 'week',
        stripe_product_id: 'prod_existing', stripe_flat_price_id: 'price_old',
      },
    });
    const { upsertBillingPlanAction } = await import('./actions');
    await upsertBillingPlanAction(fd({ id: 'plan-starter', seatLimit: '99' }));
    expect(productsCreate).not.toHaveBeenCalled();
    expect(pricesCreate).not.toHaveBeenCalled();
    expect(pricesUpdate).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ seat_limit: 99, stripe_flat_price_id: 'price_old' }));
  });

  it('rejects a blank name without touching Stripe or the database', async () => {
    const { upsertBillingPlanAction } = await import('./actions');
    const r = await upsertBillingPlanAction(fd({ name: '' }));
    expect(r.ok).toBe(false);
    expect(productsCreate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns a clear error when Stripe is not configured', async () => {
    vi.resetModules();
    vi.doMock('@/lib/stripe', () => ({ stripe: null }));
    const { upsertBillingPlanAction } = await import('./actions');
    const r = await upsertBillingPlanAction(fd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/STRIPE_SECRET_KEY/);
    vi.doUnmock('@/lib/stripe');
    vi.resetModules();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/admin/billing/actions.upsert.test.ts`
Expected: FAIL — `upsertBillingPlanAction` is not exported yet.

- [ ] **Step 3: Implement `upsertBillingPlanAction`**

Add to `src/app/admin/billing/actions.ts` (after the existing `syncBillingPlansAction`):

```typescript
function parseLimit(value: FormDataEntryValue | null): number | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export async function upsertBillingPlanAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (!stripe) return { ok: false, error: 'STRIPE_SECRET_KEY is not configured on this server.' };

  const existingId = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const priceCents = Math.round(Number(formData.get('priceDollars') ?? NaN) * 100);
  const billingInterval = String(formData.get('billingInterval') ?? 'month');

  if (!name) return { ok: false, error: 'Plan name is required.' };
  if (!Number.isFinite(priceCents) || priceCents < 0) return { ok: false, error: 'Price must be a non-negative number.' };
  if (billingInterval !== 'week' && billingInterval !== 'month') {
    return { ok: false, error: 'Billing interval must be week or month.' };
  }

  const { prefixedId } = await import('@/lib/store');
  const id = existingId || prefixedId('plan-');
  const { data: existing } = await adminDb.from('billing_plans').select('*').eq('id', id).single();

  let stripeProductId = existing?.stripe_product_id as string | undefined;
  let stripeFlatPriceId = existing?.stripe_flat_price_id as string | undefined;
  const priceOrIntervalChanged =
    !existing || existing.monthly_price_cents !== priceCents || existing.billing_interval !== billingInterval;

  if (!stripeProductId) {
    const product = await stripe.products.create({ name: `${name} plan` });
    stripeProductId = product.id;
  }

  if (priceOrIntervalChanged) {
    const newPrice = await stripe.prices.create({
      product: stripeProductId,
      currency: 'usd',
      unit_amount: priceCents,
      recurring: { interval: billingInterval as 'week' | 'month' },
    });
    // Stripe prices are immutable — archive the old one rather than editing it.
    // Campaigns already on it keep billing there until reassigned via assignPlanAction.
    if (stripeFlatPriceId) {
      await stripe.prices.update(stripeFlatPriceId, { active: false });
    }
    stripeFlatPriceId = newPrice.id;
  }

  await adminDb.from('billing_plans').upsert({
    id,
    name,
    monthly_price_cents: priceCents,
    billing_interval: billingInterval,
    seat_limit: parseLimit(formData.get('seatLimit')),
    avatar_limit: parseLimit(formData.get('avatarLimit')),
    content_limit_monthly: parseLimit(formData.get('contentLimitMonthly')),
    video_limit_daily: parseLimit(formData.get('videoLimitDaily')),
    stripe_product_id: stripeProductId,
    stripe_flat_price_id: stripeFlatPriceId,
    is_active: true,
  });

  revalidatePath('/admin/billing');
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/admin/billing/actions.upsert.test.ts`
Expected: PASS, all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/billing/actions.ts src/app/admin/billing/actions.upsert.test.ts
git commit -m "feat(billing): add upsertBillingPlanAction to create/edit plans with a chosen billing interval"
```

---

### Task 3: Surface `billingInterval` through the data layer

**Files:**
- Modify: `src/lib/data.ts:179-208`

**Interfaces:**
- Produces: `BillingPlan.billingInterval: 'week' | 'month'`, read by Task 4's UI.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/billing-catalog.test.ts`'s neighbor — actually this is a data-mapper change, so add a focused test in a new file:

```typescript
// src/lib/data.billing-plan.test.ts
import { describe, it, expect, vi } from 'vitest';

const single = vi.fn(async () => ({
  data: {
    id: 'plan-starter', name: 'Starter', monthly_price_cents: 4900, billing_interval: 'week',
    seat_limit: 3, avatar_limit: 2, content_limit_monthly: 15, video_limit_daily: 1,
    stripe_product_id: 'prod_1', stripe_flat_price_id: 'price_1', is_active: true,
  },
}));
const eq = vi.fn(() => ({ single }));
const select = vi.fn(() => ({ eq }));
vi.mock('./supabase', () => ({ adminDb: { from: vi.fn(() => ({ select })) } }));

describe('getBillingPlan', () => {
  it('maps billing_interval onto BillingPlan.billingInterval', async () => {
    const { getBillingPlan } = await import('./data');
    const plan = await getBillingPlan('plan-starter');
    expect(plan?.billingInterval).toBe('week');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/data.billing-plan.test.ts`
Expected: FAIL — `plan.billingInterval` is `undefined` (property doesn't exist yet).

- [ ] **Step 3: Add the field**

In `src/lib/data.ts`, update the `BillingPlan` interface (line 179):

```typescript
export interface BillingPlan {
  id: string; name: string; monthlyPriceCents: number; billingInterval: 'week' | 'month'; seatLimit: number | null;
  avatarLimit: number | null; contentLimitMonthly: number | null; videoLimitDaily: number | null;
  stripeProductId: string; stripeFlatPriceId: string;
  isActive: boolean;
}
```

And `toBillingPlan` (line 186):

```typescript
function toBillingPlan(r: Record<string, unknown>): BillingPlan {
  return {
    id: r.id as string, name: r.name as string,
    monthlyPriceCents: r.monthly_price_cents as number,
    billingInterval: (r.billing_interval as 'week' | 'month') ?? 'month',
    seatLimit: (r.seat_limit as number | null) ?? null,
    avatarLimit: (r.avatar_limit as number | null) ?? null,
    contentLimitMonthly: (r.content_limit_monthly as number | null) ?? null,
    videoLimitDaily: (r.video_limit_daily as number | null) ?? null,
    stripeProductId: r.stripe_product_id as string,
    stripeFlatPriceId: r.stripe_flat_price_id as string,
    isActive: r.is_active as boolean,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/data.billing-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite for regressions**

Run: `npx vitest run`
Expected: PASS — `src/app/admin/actions.assign-plan.test.ts`'s `PLAN` fixture doesn't include `billingInterval`, but nothing reads that field in the assign-plan path, so it stays green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/data.ts src/lib/data.billing-plan.test.ts
git commit -m "feat(billing): map billing_interval onto BillingPlan"
```

---

### Task 4: Admin UI — edit/create plans on `/admin/billing`

**Files:**
- Modify: `src/app/admin/billing/page.tsx`

**Interfaces:**
- Consumes: `getBillingPlans()` (`@/lib/data`, now returns `billingInterval`), `upsertBillingPlanAction` (Task 2).

- [ ] **Step 1: Replace the read-only table with editable plan cards + a create form**

Replace the whole file:

```tsx
import { redirect } from 'next/navigation';
import { getBillingPlans } from '@/lib/data';
import { syncBillingPlansAction, upsertBillingPlanAction } from './actions';
import type { BillingPlan } from '@/lib/data';

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function intervalLabel(interval: 'week' | 'month') {
  return interval === 'week' ? '/wk' : '/mo';
}

function PlanForm({ plan }: { plan?: BillingPlan }) {
  async function save(formData: FormData) {
    'use server';
    const result = await upsertBillingPlanAction(formData);
    if (!result.ok) {
      redirect('/admin/billing?error=' + encodeURIComponent(result.error ?? 'Save failed.'));
    }
  }

  return (
    <form action={save} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input type="hidden" name="id" value={plan?.id ?? ''} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <div>
          <label className="field-label">Plan name</label>
          <input name="name" className="input" defaultValue={plan?.name ?? ''} required />
        </div>
        <div>
          <label className="field-label">Price (USD)</label>
          <input name="priceDollars" type="number" step="0.01" min="0" className="input"
            defaultValue={plan ? (plan.monthlyPriceCents / 100).toFixed(2) : ''} required />
        </div>
        <div>
          <label className="field-label">Billing interval</label>
          <select name="billingInterval" className="input" defaultValue={plan?.billingInterval ?? 'month'}>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label className="field-label">Seat limit</label>
          <input name="seatLimit" type="number" min="0" className="input" defaultValue={plan?.seatLimit ?? ''} placeholder="Unlimited" />
        </div>
        <div>
          <label className="field-label">Avatar limit</label>
          <input name="avatarLimit" type="number" min="0" className="input" defaultValue={plan?.avatarLimit ?? ''} placeholder="Unlimited" />
        </div>
        <div>
          <label className="field-label">Content/period</label>
          <input name="contentLimitMonthly" type="number" min="0" className="input" defaultValue={plan?.contentLimitMonthly ?? ''} placeholder="Unlimited" />
        </div>
        <div>
          <label className="field-label">Videos/day</label>
          <input name="videoLimitDaily" type="number" min="0" className="input" defaultValue={plan?.videoLimitDaily ?? ''} placeholder="Unlimited" />
        </div>
      </div>
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} type="submit">
        {plan ? 'Save changes' : 'Create plan'}
      </button>
    </form>
  );
}

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const plans = await getBillingPlans();

  async function sync() {
    'use server';
    const result = await syncBillingPlansAction();
    if (!result.ok) {
      redirect('/admin/billing?error=' + encodeURIComponent(result.error ?? 'Sync failed.'));
    }
  }

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">System</span>
          <h1>Billing plans</h1>
        </div>
      </div>

      {searchParams.error && (
        <div className="banner warn" style={{ marginBottom: 20 }}>
          <div>
            <div className="t">Action failed</div>
            <div className="b">{searchParams.error}</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
          Bootstraps the three starter plans from <code>src/lib/billing-catalog.ts</code> into Stripe.
          Safe to run more than once — plans that already exist locally are skipped. Use the forms below
          to edit prices, limits, or billing interval afterward.
        </p>
        <form action={sync}>
          <button className="btn" type="submit">Sync starter plans to Stripe</button>
        </form>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
        {plans.map(p => (
          <div key={p.id}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              {p.name} · {fmt(p.monthlyPriceCents)}{intervalLabel(p.billingInterval)}
            </div>
            <PlanForm plan={p} />
          </div>
        ))}
        {plans.length === 0 && (
          <div className="card"><p className="muted">No plans yet — sync the starter plans above, or create one below.</p></div>
        )}
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>New plan</div>
        <PlanForm />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manually verify**

Run the dev server (`npm run dev`), sign in as super_admin, visit `/admin/billing`:
1. Confirm each existing plan renders as an editable form pre-filled with its current values.
2. Change a plan's price and save — confirm no error banner, and the price shown updates.
3. Fill out the "New plan" form with `billingInterval: week` and save — confirm a new plan card appears showing `/wk`.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/billing/page.tsx
git commit -m "feat(billing): editable plan forms on /admin/billing"
```

---

### Task 5: Show the plan's actual billing interval instead of hardcoded "/mo"

**Files:**
- Modify: `src/app/pricing/page.tsx:74-78`
- Modify: `src/app/billing/page.tsx:93-95`

**Interfaces:**
- Consumes: `plan.billingInterval` (Task 3).

- [ ] **Step 1: Update `/pricing`**

In `src/app/pricing/page.tsx`, replace lines 76-78:

```tsx
                  <div className="data" style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>
                    {fmt(plan.monthlyPriceCents)}
                    <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>/{plan.billingInterval === 'week' ? 'wk' : 'mo'}</span>
                  </div>
```

- [ ] **Step 2: Update `/billing`**

In `src/app/billing/page.tsx`, replace line 94:

```tsx
              {plan ? <>Campaign subscription · <span className="data" style={{ color: 'var(--text)' }}>{usd(plan.monthlyPriceCents)}</span>/{plan.billingInterval === 'week' ? 'wk' : 'mo'}</> : 'No plan assigned yet.'}
```

- [ ] **Step 3: Manually verify**

With a weekly-interval plan assigned to a test campaign, visit `/pricing` and `/billing` as that campaign's owner and confirm both show "/wk" instead of "/mo".

- [ ] **Step 4: Commit**

```bash
git add src/app/pricing/page.tsx src/app/billing/page.tsx
git commit -m "feat(billing): display each plan's actual billing interval instead of hardcoded /mo"
```
