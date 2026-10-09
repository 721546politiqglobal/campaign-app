import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ userId: 'sa-1', role: 'super_admin', campaignId: null, locale: 'en' })) }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(() => 'camp-x'), inviteCode: vi.fn() }));

const customersCreate = vi.fn();
const subscriptionsCancel = vi.fn(() => Promise.resolve({}));
const subscriptionsCreate = vi.fn();
vi.mock('@/lib/stripe', () => ({
  stripe: { customers: { create: customersCreate }, subscriptions: { cancel: subscriptionsCancel, create: subscriptionsCreate } },
}));

// campaigns.update(patch).eq('id', ..).eq('stripe_subscription_id', ..)|.is(..).select('id')
// — the conditional write. `updateResult` is what the final select resolves to.
const updateResult = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: [{ id: 'c-1' }], error: null }));
const updateIs = vi.fn();
const updateEq2 = vi.fn();
const updateEq1 = vi.fn();
const campaignsUpdate = vi.fn();
function resetUpdateChain() {
  const tail = { select: vi.fn(() => updateResult()) };
  // The unconditional recovery update (`.eq('id')` awaited directly) and the
  // conditional one (`.eq().eq()/.is().select()`) share the first `.eq`.
  const firstEq = Object.assign(Promise.resolve({ error: null }), {
    eq: updateEq2.mockReturnValue(tail),
    is: updateIs.mockReturnValue(tail),
    select: tail.select,
  });
  updateEq1.mockReturnValue(firstEq);
  campaignsUpdate.mockReturnValue({ eq: updateEq1 });
}
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ update: campaignsUpdate })) },
  throwOnError: async (q: any) => { const r = await q; if (r?.error) throw new Error(r.error.message); return r?.data; },
}));

const getCampaign = vi.fn();
const getBillingPlan = vi.fn();
vi.mock('@/lib/data', () => ({ getCampaign, getBillingPlan }));

const PLAN = {
  id: 'plan-starter', name: 'Starter', monthlyPriceCents: 9900, seatLimit: 5,
  stripeProductId: 'prod_1', stripeFlatPriceId: 'price_flat', isActive: true,
};

function fd(over: Record<string, string> = {}) {
  const f = new FormData();
  f.set('campaignId', 'c-1'); f.set('planId', 'plan-starter');
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

const NEW_SUB = { id: 'sub_new', status: 'incomplete', items: { data: [{ current_period_end: 1893456000 }] } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  resetUpdateChain();
  updateResult.mockResolvedValue({ data: [{ id: 'c-1' }], error: null });
  subscriptionsCreate.mockResolvedValue(NEW_SUB);
  subscriptionsCancel.mockResolvedValue({});
  customersCreate.mockResolvedValue({ id: 'cus_new' });
  getBillingPlan.mockResolvedValue(PLAN);
});

describe('assignPlanAction', () => {
  it('creates a Stripe customer first when the campaign has none, then a single-item incomplete subscription', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: null, stripeSubscriptionId: null });
    const { assignPlanAction } = await import('./actions');
    const r = await assignPlanAction(fd());
    expect(r).toEqual({ ok: true });
    expect(customersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Camp' }),
      { idempotencyKey: 'campaign-customer:c-1' },
    );
    expect(subscriptionsCancel).not.toHaveBeenCalled();
    expect(subscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_new',
        items: [{ price: 'price_flat' }],
        payment_behavior: 'default_incomplete',
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    // No previous subscription → the conditional write requires the column to still be null.
    expect(updateIs).toHaveBeenCalledWith('stripe_subscription_id', null);
  });

  it('uses a deterministic idempotency key per campaign + plan/price + replaced subscription (#13)', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_old', stripeSubscriptionId: 'sub_old' });
    const { assignPlanAction } = await import('./actions');
    await assignPlanAction(fd());
    await assignPlanAction(fd());
    const keys = subscriptionsCreate.mock.calls.map(c => (c as unknown[])[1] as { idempotencyKey: string });
    expect(keys[0].idempotencyKey).toBe('assign-plan:c-1:plan-starter:price_flat:sub_old');
    expect(keys[1].idempotencyKey).toBe(keys[0].idempotencyKey);
  });

  it('cancels the existing subscription with invoice_now+prorate BEFORE creating the replacement', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_old', stripeSubscriptionId: 'sub_old' });
    const order: string[] = [];
    subscriptionsCancel.mockImplementation(async () => { order.push('cancel'); return {}; });
    subscriptionsCreate.mockImplementation(async () => { order.push('create'); return NEW_SUB; });
    const { assignPlanAction } = await import('./actions');
    await assignPlanAction(fd());
    expect(subscriptionsCancel).toHaveBeenCalledWith('sub_old', { invoice_now: true, prorate: true });
    expect(order).toEqual(['cancel', 'create']);
    expect(customersCreate).not.toHaveBeenCalled();
  });

  it('persists the new subscription id, status, and grace period, conditionally on the old subscription id', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_old' });
    const { assignPlanAction } = await import('./actions');
    await assignPlanAction(fd());
    expect(campaignsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      plan_id: 'plan-starter',
      stripe_subscription_id: 'sub_new',
      subscription_status: 'incomplete',
      grace_period_ends_at: null,
    }));
    expect(updateEq1).toHaveBeenCalledWith('id', 'c-1');
    expect(updateEq2).toHaveBeenCalledWith('stripe_subscription_id', 'sub_old');
  });

  it('treats an already-canceled existing subscription as a no-op and still creates the replacement', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_old', stripeSubscriptionId: 'sub_old' });
    const alreadyCanceled = Object.assign(new Error("No such subscription: 'sub_old'"), { code: 'resource_missing' });
    subscriptionsCancel.mockRejectedValue(alreadyCanceled);
    const { assignPlanAction } = await import('./actions');
    const r = await assignPlanAction(fd());
    expect(r).toEqual({ ok: true });
    expect(subscriptionsCreate).toHaveBeenCalled();
  });

  it('records the cancellation and reports a translated error when create fails after the old sub was canceled', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_old', stripeSubscriptionId: 'sub_old' });
    subscriptionsCreate.mockRejectedValueOnce(new Error('card_declined: raw stripe text'));
    const { assignPlanAction } = await import('./actions');
    const r = await assignPlanAction(fd());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).not.toMatch(/raw stripe text/);
      expect(r.error).toMatch(/previous subscription was canceled/i);
    }
    // The row must not keep pointing at the canceled subscription as if active.
    expect(campaignsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      stripe_subscription_id: null, subscription_status: 'canceled', current_period_end: null,
    }));
    expect(updateEq1).toHaveBeenCalledWith('id', 'c-1');
  });

  it('does not touch the row when Stripe rejects the very first subscription (nothing was canceled)', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_1', stripeSubscriptionId: null });
    subscriptionsCreate.mockRejectedValueOnce(new Error('boom'));
    const { assignPlanAction } = await import('./actions');
    const r = await assignPlanAction(fd());
    expect(r.ok).toBe(false);
    expect(campaignsUpdate).not.toHaveBeenCalled();
  });

  it('cancels the orphaned subscription and asks for a retry when the row changed concurrently', async () => {
    getCampaign
      .mockResolvedValueOnce({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_old' })
      // Re-read after the zero-row update: someone else already pointed the row elsewhere.
      .mockResolvedValueOnce({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_other' });
    updateResult.mockResolvedValueOnce({ data: [], error: null });
    const { assignPlanAction } = await import('./actions');
    const r = await assignPlanAction(fd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/changed while you were saving/i);
    expect(subscriptionsCancel).toHaveBeenLastCalledWith('sub_new');
  });

  it('treats a zero-row update as success when the row already points at the idempotent subscription', async () => {
    getCampaign
      .mockResolvedValueOnce({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_old' })
      .mockResolvedValueOnce({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_new' });
    updateResult.mockResolvedValueOnce({ data: [], error: null });
    const { assignPlanAction } = await import('./actions');
    const r = await assignPlanAction(fd());
    expect(r).toEqual({ ok: true });
    expect(subscriptionsCancel).toHaveBeenCalledTimes(1); // only the old one
  });

  it('surfaces a translated error (not the raw DB message) when the conditional write fails', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_1', stripeSubscriptionId: null });
    updateResult.mockResolvedValueOnce({ data: null, error: { message: 'db exploded' } });
    const { assignPlanAction } = await import('./actions');
    const r = await assignPlanAction(fd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toMatch(/db exploded/);
  });

  it('returns a clear error and touches nothing when Stripe is not configured', async () => {
    vi.resetModules();
    vi.doMock('@/lib/stripe', () => ({ stripe: null }));
    const { assignPlanAction } = await import('./actions');
    const r = await assignPlanAction(fd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/STRIPE_SECRET_KEY/);
    vi.doUnmock('@/lib/stripe');
    vi.resetModules();
  });
});
