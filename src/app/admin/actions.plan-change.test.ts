import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(() => ({ userId: 'u-admin', role: 'super_admin', locale: 'en' })) }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(() => 'camp-x'), inviteCode: vi.fn() }));

// update().eq('id').eq('stripe_subscription_id').select('id') → one matched row
const tail = { select: vi.fn(async () => ({ data: [{ id: 'c-1' }], error: null })) };
const update = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => tail), is: vi.fn(() => tail) })) }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update })) }, throwOnError: async (q: any) => (await q).data }));

const cancel = vi.fn(() => Promise.resolve({}));
const create = vi.fn(() => Promise.resolve({ id: 'sub_new', status: 'incomplete', items: { data: [{ current_period_end: 1_800_000_000 }] } }));
vi.mock('@/lib/stripe', () => ({
  stripe: { subscriptions: { cancel, create }, customers: { create: vi.fn(() => Promise.resolve({ id: 'cus_1' })) } },
}));
vi.mock('@/lib/data', () => ({
  getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', name: 'C', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_old' })),
  getBillingPlan: vi.fn(() => Promise.resolve({ id: 'starter', stripeFlatPriceId: 'price_flat' })),
}));

function fd(o: Record<string, string>) { const f = new FormData(); for (const k in o) f.set(k, o[k]); return f; }

describe('assignPlanAction preserves revenue on plan change', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cancels the old subscription with invoice_now + prorate', async () => {
    const { assignPlanAction } = await import('./actions');
    const r = await assignPlanAction(fd({ campaignId: 'c-1', planId: 'starter' }));
    expect(r).toEqual({ ok: true });
    expect(cancel).toHaveBeenCalledWith('sub_old', { invoice_now: true, prorate: true });
  });
});
