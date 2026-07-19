import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('./supabase', () => ({ adminDb: { from }, throwOnError: async (q: any) => (await q).data }));

const CAMPAIGNS = [
  {
    id: 'camp-a', name: 'Campaign A', jurisdictions: [], monthly_cost_cap_cents: 100000,
    created_at: '2026-01-01T00:00:00Z', plan_id: 'p1', stripe_customer_id: 'cus_a',
    stripe_subscription_id: 'sub_a', subscription_status: 'active', grace_period_ends_at: null,
    current_period_end: '2026-07-20T00:00:00Z', // billingPeriodStart -> 2026-06-20T00:00:00Z
  },
  {
    id: 'camp-b', name: 'Campaign B', jurisdictions: [], monthly_cost_cap_cents: 50000,
    created_at: '2026-01-02T00:00:00Z', plan_id: 'p1', stripe_customer_id: 'cus_b',
    stripe_subscription_id: 'sub_b', subscription_status: 'active', grace_period_ends_at: null,
    current_period_end: '2026-07-05T00:00:00Z', // billingPeriodStart -> 2026-06-05T00:00:00Z
  },
];

const USAGE_EVENTS = [
  { campaign_id: 'camp-a', cost_cents: 999, created_at: '2026-06-01T00:00:00Z' }, // before A's own window start -> excluded
  { campaign_id: 'camp-a', cost_cents: 500, created_at: '2026-06-25T00:00:00Z' }, // after A's own window start -> included
  { campaign_id: 'camp-b', cost_cents: 300, created_at: '2026-06-10T00:00:00Z' }, // after B's own window start -> included
];

describe('getAllCampaigns monthly spend', () => {
  beforeEach(() => vi.clearAllMocks());

  it("windows each campaign's spend on its own Stripe billing period, not a shared calendar month", async () => {
    from.mockImplementation((table: string) => {
      if (table === 'campaigns') return { select: () => ({ order: () => Promise.resolve({ data: CAMPAIGNS, error: null }) }) };
      if (table === 'users') return { select: () => Promise.resolve({ data: [], error: null }) };
      if (table === 'content_items') return { select: () => Promise.resolve({ data: [], error: null }) };
      if (table === 'usage_events') {
        return {
          select: () => ({
            neq: () => ({
              gte: (_col: string, iso: string) => Promise.resolve({
                data: USAGE_EVENTS.filter(e => e.created_at >= iso),
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(table);
    });

    const { getAllCampaigns } = await import('./data');
    const result = await getAllCampaigns();

    const a = result.find(c => c.id === 'camp-a')!;
    const b = result.find(c => c.id === 'camp-b')!;
    expect(a.monthlySpendCents).toBe(500);
    expect(b.monthlySpendCents).toBe(300);
  });
});
