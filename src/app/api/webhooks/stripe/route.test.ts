import { describe, it, expect, vi, beforeEach } from 'vitest';

const constructEvent = vi.fn();
vi.mock('@/lib/stripe', () => ({ stripe: { webhooks: { constructEvent } } }));

const insert = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
const campaignSingle = vi.fn();
function fromImpl(table: string) {
  if (table === 'billing_events') return {
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    insert,
  };
  if (table === 'campaigns') return {
    select: () => ({ eq: () => ({ maybeSingle: campaignSingle }) }),
    update,
  };
  throw new Error('unexpected table ' + table);
}
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(fromImpl) } }));

function req() {
  return { headers: { get: (h: string) => (h === 'stripe-signature' ? 'sig' : null) }, text: () => Promise.resolve('{}') } as any;
}

describe('stripe webhook robustness', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.STRIPE_WEBHOOK_SECRET = 'whsec'; });

  it('returns 409 and does NOT record a billing_events row when no campaign matches (BILL-6)', async () => {
    constructEvent.mockReturnValue({ id: 'evt_1', type: 'customer.subscription.updated', created: 1000, data: { object: { id: 'sub_x', status: 'active', items: { data: [{ current_period_end: 1 }] } } } });
    campaignSingle.mockResolvedValue({ data: null, error: null });
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(insert).not.toHaveBeenCalled();
  });

  it('ignores a stale subscription event: no status write, still acks + dedups (BILL-7)', async () => {
    campaignSingle.mockResolvedValue({ data: { id: 'c-1', grace_period_ends_at: '2026-07-08T00:00:00Z', subscription_event_created: 2000 }, error: null });
    constructEvent.mockReturnValue({ id: 'evt_old', type: 'customer.subscription.updated', created: 1000, data: { object: { id: 'sub_1', status: 'active', items: { data: [{ current_period_end: 1 }] } } } });
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(update).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalled();
  });

  it('applies a newer subscription event and records the high-water mark', async () => {
    campaignSingle.mockResolvedValue({ data: { id: 'c-1', grace_period_ends_at: null, subscription_event_created: 1000 }, error: null });
    constructEvent.mockReturnValue({ id: 'evt_new', type: 'customer.subscription.updated', created: 3000, data: { object: { id: 'sub_1', status: 'active', items: { data: [{ current_period_end: 1_800_000_000 }] } } } });
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(update).toHaveBeenCalled();
    const payload = (update.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.subscription_event_created).toBe(3000);
    expect(res.status).toBe(200);
  });

  it('rejects a bad signature with 400 (TEST-3)', async () => {
    constructEvent.mockImplementation(() => { throw new Error('bad sig'); });
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(400);
  });

  it('returns 500 and does NOT record the event when the campaign update fails, so Stripe retries (TEST-3)', async () => {
    campaignSingle.mockResolvedValue({ data: { id: 'c-1', grace_period_ends_at: null, subscription_event_created: 1000 }, error: null });
    constructEvent.mockReturnValue({ id: 'evt_5', type: 'customer.subscription.updated', created: 3000, data: { object: { id: 'sub_1', status: 'past_due', items: { data: [{ current_period_end: 1 }] } } } });
    update.mockReturnValueOnce({ eq: () => Promise.resolve({ error: { message: 'db down' } }) } as any);
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(insert).not.toHaveBeenCalled();
  });
});
