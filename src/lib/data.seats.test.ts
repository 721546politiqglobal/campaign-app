import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('./supabase', () => ({ adminDb: { from }, throwOnError: async (q: any) => (await q).data }));

describe('getCampaignSeatUsage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts non-super_admin users and returns the plan seat limit', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'campaigns') return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { plan_id: 'starter' }, error: null }) }) }) };
      if (table === 'billing_plans') return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { seat_limit: 3 }, error: null }) }) }) };
      if (table === 'users') return { select: () => ({ eq: () => ({ neq: () => Promise.resolve({ data: [{ id: 'u1' }, { id: 'u2' }], error: null }) }) }) };
      throw new Error(table);
    });
    const { getCampaignSeatUsage } = await import('./data');
    expect(await getCampaignSeatUsage('c-1')).toEqual({ used: 2, limit: 3 });
  });

  it('returns limit null (unlimited) when the campaign has no plan', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'campaigns') return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { plan_id: null }, error: null }) }) }) };
      if (table === 'users') return { select: () => ({ eq: () => ({ neq: () => Promise.resolve({ data: [], error: null }) }) }) };
      throw new Error(table);
    });
    const { getCampaignSeatUsage } = await import('./data');
    expect(await getCampaignSeatUsage('c-1')).toEqual({ used: 0, limit: null });
  });
});
