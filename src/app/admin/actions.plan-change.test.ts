import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(() => ({ userId: 'u-admin', role: 'super_admin' })) }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(() => 'camp-x'), inviteCode: vi.fn() }));

const update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
const upsert = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update, upsert })) }, throwOnError: async (q: any) => (await q).data }));

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

  it('seeds usage_sync_cursor.last_synced_at at ~now when the subscription is created', async () => {
    const before = Date.now();
    const { assignPlanAction } = await import('./actions');
    await assignPlanAction(fd({ campaignId: 'c-1', planId: 'starter' }));
    const cursorCall = (upsert.mock.calls as unknown[][]).find(c => (c[0] as any)?.campaign_id === 'c-1' && 'last_synced_at' in (c[0] as any));
    expect(cursorCall).toBeTruthy();
    const seeded = new Date((cursorCall![0] as any).last_synced_at).getTime();
    expect(seeded).toBeGreaterThanOrEqual(before);
  });
});
