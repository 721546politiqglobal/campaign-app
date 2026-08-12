import { describe, it, expect, vi } from 'vitest';

const row: Record<string, unknown> = {
  id: 'plan-starter', name: 'Starter', monthly_price_cents: 4900, billing_interval: 'week',
  seat_limit: 3, avatar_limit: 2, content_limit_monthly: 15, video_limit_daily: 1,
  stripe_product_id: 'prod_1', stripe_flat_price_id: 'price_1',
  retired_stripe_price_ids: ['price_0'], is_active: true,
};
const single = vi.fn(async () => ({ data: row }));
const eq = vi.fn(() => ({ single }));
const select = vi.fn(() => ({ eq }));
vi.mock('./supabase', () => ({ adminDb: { from: vi.fn(() => ({ select })) } }));

describe('getBillingPlan', () => {
  it('maps billing_interval onto BillingPlan.billingInterval', async () => {
    const { getBillingPlan } = await import('./data');
    const plan = await getBillingPlan('plan-starter');
    expect(plan?.billingInterval).toBe('week');
  });

  it('maps retired_stripe_price_ids onto BillingPlan.retiredStripePriceIds', async () => {
    row.retired_stripe_price_ids = ['price_0', 'price_00'];
    const { getBillingPlan } = await import('./data');
    const plan = await getBillingPlan('plan-starter');
    expect(plan?.retiredStripePriceIds).toEqual(['price_0', 'price_00']);
  });

  // Rows written before the retired_stripe_price_ids migration (and any legacy select
  // that omits the column) must map to [] so planIdFromPriceId can call .includes on it.
  it('defaults retiredStripePriceIds to [] when the column is null or absent', async () => {
    row.retired_stripe_price_ids = null;
    const { getBillingPlan } = await import('./data');
    expect((await getBillingPlan('plan-starter'))?.retiredStripePriceIds).toEqual([]);
    delete row.retired_stripe_price_ids;
    expect((await getBillingPlan('plan-starter'))?.retiredStripePriceIds).toEqual([]);
  });
});
