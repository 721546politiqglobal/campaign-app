import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(async () => ({ userId: 'sa-1', locale: 'en' })) }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(() => 'plan-new') }));
vi.mock('@/lib/billing-catalog', () => ({
  PLAN_DEFINITIONS: [
    { id: 'starter', name: 'Starter', monthlyPriceCents: 4900, seatLimit: 3, avatarLimit: 1, contentLimitMonthly: 20, videoLimitDaily: 1 },
    { id: 'pro', name: 'Pro', monthlyPriceCents: 9900, seatLimit: 10, avatarLimit: 3, contentLimitMonthly: 100, videoLimitDaily: 5 },
  ],
}));

const productsCreate = vi.fn(async (p: { name: string }) => ({ id: `prod_${p.name}` }));
const productsSearch = vi.fn(async (): Promise<{ data: { id: string }[] }> => ({ data: [] }));
const pricesCreate = vi.fn(async () => ({ id: 'price_new' }));
vi.mock('@/lib/stripe', () => ({
  stripe: { products: { create: productsCreate, search: productsSearch }, prices: { create: pricesCreate } },
}));

const existing = vi.fn(async (): Promise<{ data: { id: string }[] | null; error: null | { message: string } }> => ({ data: [], error: null }));
const insert = vi.fn(async (_row: unknown): Promise<{ error: null | { message: string } }> => ({ error: null }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ select: () => existing(), insert })) },
  throwOnError: async (q: any) => { const r = await q; if (r?.error) throw new Error(r.error.message); return r?.data; },
}));

describe('syncBillingPlansAction (#19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    existing.mockResolvedValue({ data: [], error: null });
    productsSearch.mockResolvedValue({ data: [] });
    insert.mockResolvedValue({ error: null });
  });

  it('creates product + price with idempotency keys and plan metadata, then inserts the row', async () => {
    const { syncBillingPlansAction } = await import('./actions');
    const r = await syncBillingPlansAction();
    expect(r).toEqual({ ok: true });
    expect(productsCreate).toHaveBeenCalledWith(
      { name: 'Starter plan', metadata: { plan_id: 'starter' } },
      { idempotencyKey: 'billing-plan-product:starter' },
    );
    expect(pricesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ product: 'prod_Starter plan', unit_amount: 4900 }),
      { idempotencyKey: 'billing-plan-price:starter:4900:month' },
    );
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('skips plans that already exist in the catalog', async () => {
    existing.mockResolvedValue({ data: [{ id: 'starter' }], error: null });
    const { syncBillingPlansAction } = await import('./actions');
    await syncBillingPlansAction();
    expect(productsCreate).toHaveBeenCalledTimes(1);
    expect(productsCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Pro plan' }), expect.anything());
  });

  it('re-uses a Stripe product left behind by a previous failed run instead of minting a duplicate', async () => {
    productsSearch.mockResolvedValueOnce({ data: [{ id: 'prod_leftover' }] });
    const { syncBillingPlansAction } = await import('./actions');
    await syncBillingPlansAction();
    expect(productsCreate).toHaveBeenCalledTimes(1); // only for 'pro'
    expect(pricesCreate).toHaveBeenCalledWith(expect.objectContaining({ product: 'prod_leftover' }), expect.anything());
  });

  it('treats a failed catalog read as an error, not as "no plans yet"', async () => {
    existing.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
    const { syncBillingPlansAction } = await import('./actions');
    const r = await syncBillingPlansAction();
    expect(r.ok).toBe(false);
    expect(productsCreate).not.toHaveBeenCalled();
  });

  it('surfaces a translated error (never the raw DB text) when the insert fails', async () => {
    insert.mockResolvedValueOnce({ error: { message: 'duplicate key value' } });
    const { syncBillingPlansAction } = await import('./actions');
    const r = await syncBillingPlansAction();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).not.toMatch(/duplicate key/);
      expect(r.error).toMatch(/could not sync/i);
    }
  });
});
