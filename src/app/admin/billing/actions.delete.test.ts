import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(async () => ({ userId: 'sa-1' })) }));

const pricesUpdate = vi.fn(async () => ({}));
const productsUpdate = vi.fn(async () => ({}));
vi.mock('@/lib/stripe', () => ({
  stripe: { prices: { update: pricesUpdate }, products: { update: productsUpdate } },
}));

const campaignsCountResult = vi.fn(async (): Promise<{ count: number | null; error: unknown }> => ({ count: 0, error: null }));
const campaignsSelect = vi.fn(() => ({ eq: vi.fn(() => campaignsCountResult()) }));

const planMaybeSingle = vi.fn(async (): Promise<{ data: Record<string, unknown> | null; error?: unknown }> => ({
  data: { id: 'plan-test', stripe_product_id: 'prod_test', stripe_flat_price_id: 'price_test' },
}));
const planSelectEq = vi.fn(() => ({ maybeSingle: planMaybeSingle }));
const planSelect = vi.fn(() => ({ eq: planSelectEq }));

const planDeleteEq = vi.fn(async () => ({ error: null }));
const planDelete = vi.fn(() => ({ eq: planDeleteEq }));

vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: vi.fn((table: string) => {
      if (table === 'campaigns') return { select: campaignsSelect };
      return { select: planSelect, delete: planDelete };
    }),
  },
  throwOnError: async (q: any) => { const r = await q; if (r?.error) throw new Error(r.error.message); return r?.data; },
}));

function fd(id: string) {
  const f = new FormData();
  f.set('id', id);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  campaignsCountResult.mockResolvedValue({ count: 0, error: null });
  planMaybeSingle.mockResolvedValue({ data: { id: 'plan-test', stripe_product_id: 'prod_test', stripe_flat_price_id: 'price_test' } });
  pricesUpdate.mockResolvedValue({});
  productsUpdate.mockResolvedValue({});
});

describe('deleteBillingPlanAction', () => {
  it('refuses to delete a core plan (starter/pro/enterprise)', async () => {
    const { deleteBillingPlanAction } = await import('./actions');
    const r = await deleteBillingPlanAction(fd('starter'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/core plan/i);
    expect(planDelete).not.toHaveBeenCalled();
  });

  it('refuses to delete a plan that campaigns are still on', async () => {
    campaignsCountResult.mockResolvedValue({ count: 2, error: null });
    const { deleteBillingPlanAction } = await import('./actions');
    const r = await deleteBillingPlanAction(fd('plan-test'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/2 campaign/);
    expect(planDelete).not.toHaveBeenCalled();
  });

  it('deletes a non-core, unused plan and archives its Stripe product and price', async () => {
    const { deleteBillingPlanAction } = await import('./actions');
    const r = await deleteBillingPlanAction(fd('plan-test'));
    expect(r).toEqual({ ok: true });
    expect(planDeleteEq).toHaveBeenCalledWith('id', 'plan-test');
    expect(pricesUpdate).toHaveBeenCalledWith('price_test', { active: false });
    expect(productsUpdate).toHaveBeenCalledWith('prod_test', { active: false });
  });

  it('returns an error when the plan does not exist', async () => {
    planMaybeSingle.mockResolvedValue({ data: null });
    const { deleteBillingPlanAction } = await import('./actions');
    const r = await deleteBillingPlanAction(fd('plan-missing'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/i);
    expect(planDelete).not.toHaveBeenCalled();
  });

  it('still succeeds even if archiving in Stripe fails (best-effort)', async () => {
    pricesUpdate.mockRejectedValueOnce(new Error('Stripe hiccup'));
    const { deleteBillingPlanAction } = await import('./actions');
    const r = await deleteBillingPlanAction(fd('plan-test'));
    expect(r).toEqual({ ok: true });
    expect(planDeleteEq).toHaveBeenCalledWith('id', 'plan-test');
  });
});
