import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(async () => ({ userId: 'sa-1' })) }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(() => 'plan-new') }));

const productsCreate = vi.fn(async () => ({ id: 'prod_new' }));
const productsRetrieve = vi.fn(async () => ({ id: 'prod_existing' }));
const pricesCreate = vi.fn(async () => ({ id: 'price_new' }));
const pricesUpdate = vi.fn(async () => ({}));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    products: { create: productsCreate, retrieve: productsRetrieve },
    prices: { create: pricesCreate, update: pricesUpdate },
  },
}));

const maybeSingle = vi.fn(
  async (): Promise<{ data: Record<string, unknown> | null; error?: unknown }> => ({ data: null, error: null }),
);
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const upsert = vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ select, upsert })) },
  throwOnError: async (q: any) => { const r = await q; if (r?.error) throw new Error(r.error.message); return r?.data; },
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
    maybeSingle.mockResolvedValue({ data: null });
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

  it('editing an existing plan’s price (interval unchanged) archives the old Stripe price and creates a new one', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        // billing_interval matches the form's default ('week') so only price differs — isolates the
        // price-changed branch from the interval-changed branch of the `priceOrIntervalChanged` check.
        id: 'plan-starter', monthly_price_cents: 4900, billing_interval: 'week',
        stripe_product_id: 'prod_existing', stripe_flat_price_id: 'price_old',
      },
    });
    const { upsertBillingPlanAction } = await import('./actions');
    await upsertBillingPlanAction(fd({ id: 'plan-starter', priceDollars: '59' }));
    expect(productsCreate).not.toHaveBeenCalled();
    expect(pricesCreate).toHaveBeenCalledWith(expect.objectContaining({
      product: 'prod_existing', unit_amount: 5900, recurring: { interval: 'week' },
    }));
    expect(pricesUpdate).toHaveBeenCalledWith('price_old', { active: false });
  });

  it('editing only the billing interval (price unchanged) archives the old Stripe price and creates a new one', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        // monthly_price_cents matches the form's default (49 dollars -> 4900 cents) so only the
        // interval differs — isolates the interval-changed branch from the price-changed branch.
        id: 'plan-starter', monthly_price_cents: 4900, billing_interval: 'month',
        stripe_product_id: 'prod_existing', stripe_flat_price_id: 'price_old',
      },
    });
    const { upsertBillingPlanAction } = await import('./actions');
    await upsertBillingPlanAction(fd({ id: 'plan-starter' })); // fd() defaults to billingInterval 'week', priceDollars 49
    expect(productsCreate).not.toHaveBeenCalled();
    expect(pricesCreate).toHaveBeenCalledWith(expect.objectContaining({
      product: 'prod_existing', unit_amount: 4900, recurring: { interval: 'week' },
    }));
    expect(pricesUpdate).toHaveBeenCalledWith('price_old', { active: false });
  });

  it('editing only a limit field, with price and interval unchanged, never calls Stripe', async () => {
    maybeSingle.mockResolvedValue({
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

  it('rejects a blank price without touching Stripe or the database (Number(\'\') is 0, which must not slip through)', async () => {
    const { upsertBillingPlanAction } = await import('./actions');
    const r = await upsertBillingPlanAction(fd({ priceDollars: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non-negative number/);
    expect(productsCreate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  // A Checkout session opened before an edit completes against the OLD price id. The
  // webhook resolves it via retired_stripe_price_ids, so the rotated-out id must be
  // appended to that array rather than lost when stripe_flat_price_id is overwritten.
  it('appends the rotated-out price id to retired_stripe_price_ids, keeping earlier ones', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: 'plan-starter', monthly_price_cents: 4900, billing_interval: 'week',
        stripe_product_id: 'prod_existing', stripe_flat_price_id: 'price_v2',
        retired_stripe_price_ids: ['price_v1'],
      },
    });
    const { upsertBillingPlanAction } = await import('./actions');
    await upsertBillingPlanAction(fd({ id: 'plan-starter', priceDollars: '59' }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      stripe_flat_price_id: 'price_new',
      retired_stripe_price_ids: ['price_v1', 'price_v2'],
    }));
  });

  it('leaves retired_stripe_price_ids untouched when neither price nor interval changed', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: 'plan-starter', monthly_price_cents: 4900, billing_interval: 'week',
        stripe_product_id: 'prod_existing', stripe_flat_price_id: 'price_v2',
        retired_stripe_price_ids: ['price_v1'],
      },
    });
    const { upsertBillingPlanAction } = await import('./actions');
    await upsertBillingPlanAction(fd({ id: 'plan-starter', seatLimit: '7' }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ retired_stripe_price_ids: ['price_v1'] }));
  });

  // Ordering matters: archiving first and then failing the DB write would leave the row
  // pointing at an archived price, breaking checkout for that plan.
  it('archives the old Stripe price only after the DB upsert has succeeded', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: 'plan-starter', monthly_price_cents: 4900, billing_interval: 'week',
        stripe_product_id: 'prod_existing', stripe_flat_price_id: 'price_old',
      },
    });
    const { upsertBillingPlanAction } = await import('./actions');
    await upsertBillingPlanAction(fd({ id: 'plan-starter', priceDollars: '59' }));
    expect(pricesUpdate).toHaveBeenCalledWith('price_old', { active: false });
    expect(pricesUpdate.mock.invocationCallOrder[0]).toBeGreaterThan(upsert.mock.invocationCallOrder[0]);
  });

  it('does not archive the old Stripe price when the DB upsert fails, and reports the error', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: 'plan-starter', monthly_price_cents: 4900, billing_interval: 'week',
        stripe_product_id: 'prod_existing', stripe_flat_price_id: 'price_old',
      },
    });
    upsert.mockResolvedValueOnce({ error: { message: 'db unavailable' } });
    const { upsertBillingPlanAction } = await import('./actions');
    const r = await upsertBillingPlanAction(fd({ id: 'plan-starter', priceDollars: '59' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db unavailable/);
    expect(pricesUpdate).not.toHaveBeenCalled();
  });

  // Regression: the stored stripe_product_id can belong to a different Stripe
  // mode/account than the key currently active (e.g. synced once against a
  // test-mode key, now running with a live key). Blindly reusing it made
  // prices.create fail with "No such product" and left the plan permanently
  // unrepairable through this same action — verified live.
  it('mints a fresh product and price when the stored product id no longer exists under the active key', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: 'plan-starter', monthly_price_cents: 4900, billing_interval: 'week',
        stripe_product_id: 'prod_stale', stripe_flat_price_id: 'price_old',
      },
    });
    productsRetrieve.mockRejectedValueOnce(new Error("No such product: 'prod_stale'"));
    const { upsertBillingPlanAction } = await import('./actions');
    // Price/interval unchanged from the stored row — without the fix this
    // would skip price rotation entirely and never touch Stripe.
    const r = await upsertBillingPlanAction(fd({ id: 'plan-starter' }));
    expect(r).toEqual({ ok: true });
    expect(productsRetrieve).toHaveBeenCalledWith('prod_stale');
    expect(productsCreate).toHaveBeenCalledWith({ name: 'Weekly Starter plan' });
    expect(pricesCreate).toHaveBeenCalledWith(expect.objectContaining({ product: 'prod_new' }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      stripe_product_id: 'prod_new', stripe_flat_price_id: 'price_new',
    }));
  });

  it('reuses the stored product id when it still exists under the active key', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: 'plan-starter', monthly_price_cents: 4900, billing_interval: 'week',
        stripe_product_id: 'prod_existing', stripe_flat_price_id: 'price_old',
      },
    });
    const { upsertBillingPlanAction } = await import('./actions');
    await upsertBillingPlanAction(fd({ id: 'plan-starter', seatLimit: '99' }));
    expect(productsRetrieve).toHaveBeenCalledWith('prod_existing');
    expect(productsCreate).not.toHaveBeenCalled();
    expect(pricesCreate).not.toHaveBeenCalled();
  });

  it('returns { ok: false } instead of throwing when Stripe rejects the call', async () => {
    maybeSingle.mockResolvedValue({ data: null });
    pricesCreate.mockRejectedValueOnce(new Error('No such product'));
    const { upsertBillingPlanAction } = await import('./actions');
    const r = await upsertBillingPlanAction(fd());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No such product/);
    expect(upsert).not.toHaveBeenCalled();
  });

  // A transient lookup failure must not read as "brand-new plan" — that would mint a
  // duplicate Stripe product and leave the previous price un-archived.
  it('surfaces an existing-row lookup error instead of treating it as a new plan', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'lookup failed' } });
    const { upsertBillingPlanAction } = await import('./actions');
    const r = await upsertBillingPlanAction(fd({ id: 'plan-starter' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lookup failed/);
    expect(productsCreate).not.toHaveBeenCalled();
    expect(pricesCreate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('treats blank limit fields as unlimited (null)', async () => {
    maybeSingle.mockResolvedValue({ data: null });
    const { upsertBillingPlanAction } = await import('./actions');
    const r = await upsertBillingPlanAction(fd({ seatLimit: '', avatarLimit: '  ' }));
    expect(r).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ seat_limit: null, avatar_limit: null }));
  });

  // Silently coercing garbage to null would LIFT the quota ceiling instead of rejecting
  // the edit — the opposite of the safe default for a limit field.
  it.each([
    ['seatLimit', 'abc', /Seat limit/],
    ['seatLimit', '-1', /Seat limit/],
    ['avatarLimit', 'unlimited', /Avatar limit/],
    ['contentLimitMonthly', '10abc', /Content limit/],
    ['videoLimitDaily', '-5', /Daily video limit/],
  ])('rejects a non-blank but invalid %s (%s) instead of silently making it unlimited', async (field, value, matcher) => {
    maybeSingle.mockResolvedValue({ data: null });
    const { upsertBillingPlanAction } = await import('./actions');
    const r = await upsertBillingPlanAction(fd({ [field]: value }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(matcher);
    expect(r.error).toMatch(/blank \(unlimited\) or a non-negative number/);
    expect(productsCreate).not.toHaveBeenCalled();
    expect(pricesCreate).not.toHaveBeenCalled();
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
