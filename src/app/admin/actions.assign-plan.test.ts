import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ userId: 'sa-1', role: 'super_admin', campaignId: null })) }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(() => 'camp-x'), inviteCode: vi.fn() }));

const customersCreate = vi.fn();
const subscriptionsCancel = vi.fn(() => Promise.resolve({}));
const subscriptionsCreate = vi.fn();
vi.mock('@/lib/stripe', () => ({
  stripe: { customers: { create: customersCreate }, subscriptions: { cancel: subscriptionsCancel, create: subscriptionsCreate } },
}));

const campaignsUpdateEq = vi.fn(() => Promise.resolve({ error: null }));
const campaignsUpdate = vi.fn(() => ({ eq: campaignsUpdateEq }));
const upsert = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ update: campaignsUpdate, upsert })) },
  throwOnError: async (q: any) => { const r = await q; if (r?.error) throw new Error(r.error.message); return r?.data; },
}));

const getCampaign = vi.fn();
const getBillingPlan = vi.fn();
vi.mock('@/lib/data', () => ({ getCampaign, getBillingPlan }));

const PLAN = {
  id: 'plan-starter', name: 'Starter', monthlyPriceCents: 9900, seatLimit: 5,
  includedUsageCents: 2500, overageMultiplier: 1, stripeProductId: 'prod_1',
  stripeFlatPriceId: 'price_flat', stripeMeteredPriceId: 'price_metered', isActive: true,
};

function fd(over: Record<string, string> = {}) {
  const f = new FormData();
  f.set('campaignId', 'c-1'); f.set('planId', 'plan-starter');
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  subscriptionsCreate.mockResolvedValue({ id: 'sub_new', status: 'incomplete', items: { data: [{ current_period_end: 1893456000 }] } });
  customersCreate.mockResolvedValue({ id: 'cus_new' });
  getBillingPlan.mockResolvedValue(PLAN);
});

describe('assignPlanAction', () => {
  it('creates a Stripe customer first when the campaign has none, then a two-item incomplete subscription', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: null, stripeSubscriptionId: null });
    const { assignPlanAction } = await import('./actions');
    const r = await assignPlanAction(fd());
    expect(r).toEqual({ ok: true });
    expect(customersCreate).toHaveBeenCalled();
    expect(subscriptionsCancel).not.toHaveBeenCalled();
    expect(subscriptionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus_new',
      items: [{ price: 'price_flat' }, { price: 'price_metered' }],
      payment_behavior: 'default_incomplete',
    }));
  });

  it('cancels the existing subscription with invoice_now+prorate BEFORE creating the replacement', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_old', stripeSubscriptionId: 'sub_old' });
    const order: string[] = [];
    subscriptionsCancel.mockImplementation(async () => { order.push('cancel'); return {}; });
    subscriptionsCreate.mockImplementation(async () => { order.push('create'); return { id: 'sub_new', status: 'incomplete', items: { data: [{ current_period_end: 1893456000 }] } }; });
    const { assignPlanAction } = await import('./actions');
    await assignPlanAction(fd());
    expect(subscriptionsCancel).toHaveBeenCalledWith('sub_old', { invoice_now: true, prorate: true });
    expect(order).toEqual(['cancel', 'create']);
    expect(customersCreate).not.toHaveBeenCalled();
  });

  it('persists the new subscription id, status, and resets the cap to the plan allowance', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_1', stripeSubscriptionId: null });
    const { assignPlanAction } = await import('./actions');
    await assignPlanAction(fd());
    expect(campaignsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      plan_id: 'plan-starter',
      stripe_subscription_id: 'sub_new',
      subscription_status: 'incomplete',
      monthly_cost_cap_cents: 2500,
      grace_period_ends_at: null,
    }));
    expect(campaignsUpdateEq).toHaveBeenCalledWith('id', 'c-1');
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
