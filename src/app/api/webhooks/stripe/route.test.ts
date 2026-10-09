import { describe, it, expect, vi, beforeEach } from 'vitest';

const constructEvent = vi.fn();
const subscriptionsRetrieve = vi.fn();
vi.mock('@/lib/stripe', () => ({ stripe: { webhooks: { constructEvent }, subscriptions: { retrieve: subscriptionsRetrieve } } }));

// billing_events: claim (insert), release (delete), link (update).
const claimInsert = vi.fn(async (_row: unknown) => ({ error: null as null | { code?: string; message: string } }));
const claimDeleteEq = vi.fn(async (..._args: unknown[]) => ({ error: null }));
const claimUpdateEq = vi.fn(async (..._args: unknown[]) => ({ error: null }));
const claimUpdate = vi.fn((_patch: unknown) => ({ eq: claimUpdateEq }));

// `update().eq()` is awaited directly by the subscription branch, and further
// chained with `.select('id')` by the checkout branch (to detect an update that
// matched zero rows). One thenable serves both.
function eqResult(res: { data?: unknown; error: unknown }) {
  return Object.assign(Promise.resolve(res), { select: () => Promise.resolve(res) });
}
const updateOk = { data: [{ id: 'c-1' }], error: null };
const update = vi.fn(() => ({ eq: () => eqResult(updateOk) }));
// campaigns.select(...).eq(col, val).maybeSingle() — one mock serves both the
// stripe_subscription_id lookup and the id lookup; tests set the result.
const campaignSingle = vi.fn();
const campaignSelectEq = vi.fn((_col: string, _val: unknown) => ({ maybeSingle: campaignSingle }));
const billingPlansRows = [
  { id: 'pro', name: 'Pro', monthly_price_cents: 9900, seat_limit: 5, avatar_limit: 5, content_limit_monthly: 100, video_limit_daily: 10, stripe_product_id: 'prod_pro', stripe_flat_price_id: 'price_pro', is_active: true },
];
function fromImpl(table: string) {
  if (table === 'billing_events') return {
    insert: claimInsert,
    delete: () => ({ eq: claimDeleteEq }),
    update: claimUpdate,
  };
  if (table === 'campaigns') return {
    select: () => ({ eq: campaignSelectEq }),
    update,
  };
  if (table === 'billing_plans') return {
    select: () => ({ order: () => Promise.resolve({ data: billingPlansRows, error: null }) }),
  };
  throw new Error('unexpected table ' + table);
}
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(fromImpl) } }));

function req() {
  return { headers: { get: (h: string) => (h === 'stripe-signature' ? 'sig' : null) }, text: () => Promise.resolve('{}') } as any;
}

function subEvent(over: Partial<{ id: string; created: number; status: string; priceId: string; type: string }> = {}) {
  return {
    id: over.id ?? 'evt_sub', type: over.type ?? 'customer.subscription.updated', created: over.created ?? 3000,
    data: { object: { id: 'sub_1', status: over.status ?? 'active', items: { data: [{ current_period_end: 1_800_000_000, price: over.priceId ? { id: over.priceId } : undefined }] } } },
  };
}

function checkoutEvent(over: Partial<{ id: string; created: number; ref: string | null }> = {}) {
  return {
    id: over.id ?? 'evt_checkout', type: 'checkout.session.completed', created: over.created ?? 3000,
    data: { object: { client_reference_id: over.ref === undefined ? 'campaign-42' : over.ref, subscription: over.ref === null ? null : 'sub_new', customer: over.ref === null ? null : 'cus_1' } },
  };
}

describe('stripe webhook robustness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec';
    claimInsert.mockResolvedValue({ error: null });
    claimDeleteEq.mockResolvedValue({ error: null });
    claimUpdateEq.mockResolvedValue({ error: null });
    update.mockImplementation(() => ({ eq: () => eqResult(updateOk) }));
    campaignSingle.mockResolvedValue({ data: { id: 'c-1', grace_period_ends_at: null, subscription_event_created: 1000 }, error: null });
    subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_new', status: 'active',
      items: { data: [{ current_period_end: 1_800_000_000, price: { id: 'price_pro' } }] },
    });
  });

  it('claims the event row BEFORE processing (idempotency, #21)', async () => {
    constructEvent.mockReturnValue(subEvent());
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(claimInsert).toHaveBeenCalledTimes(1);
    expect((claimInsert.mock.calls[0] as unknown[])[0]).toMatchObject({ id: 'evt_sub', type: 'customer.subscription.updated' });
    expect(claimInsert.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
    // The claim is linked to the campaign once processing succeeds.
    expect(claimUpdate).toHaveBeenCalledWith({ campaign_id: 'c-1' });
    expect(claimDeleteEq).not.toHaveBeenCalled();
  });

  it('treats a unique violation on the claim as already processed: 200, nothing touched', async () => {
    constructEvent.mockReturnValue(subEvent({ id: 'evt_dup' }));
    claimInsert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(update).not.toHaveBeenCalled();
    expect(claimDeleteEq).not.toHaveBeenCalled();
  });

  it('returns 500 (so Stripe retries) when the claim itself cannot be written', async () => {
    constructEvent.mockReturnValue(subEvent());
    claimInsert.mockResolvedValueOnce({ error: { code: '08006', message: 'db down' } });
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 409 and releases the claim when no campaign matches (BILL-6)', async () => {
    constructEvent.mockReturnValue(subEvent({ id: 'evt_1' }));
    campaignSingle.mockResolvedValue({ data: null, error: null });
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(claimDeleteEq).toHaveBeenCalledWith('id', 'evt_1');
  });

  it('ignores a stale subscription event: no status write, still acks + keeps the claim (BILL-7)', async () => {
    campaignSingle.mockResolvedValue({ data: { id: 'c-1', grace_period_ends_at: '2026-07-08T00:00:00Z', subscription_event_created: 2000 }, error: null });
    constructEvent.mockReturnValue(subEvent({ id: 'evt_old', created: 1000 }));
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(update).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(claimInsert).toHaveBeenCalled();
    expect(claimDeleteEq).not.toHaveBeenCalled();
  });

  it('applies a newer subscription event and records the high-water mark', async () => {
    constructEvent.mockReturnValue(subEvent({ id: 'evt_new', created: 3000 }));
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(update).toHaveBeenCalled();
    const payload = (update.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.subscription_event_created).toBe(3000);
    expect(res.status).toBe(200);
  });

  it('rejects a bad signature with 400 before touching the database (TEST-3)', async () => {
    constructEvent.mockImplementation(() => { throw new Error('bad sig'); });
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(claimInsert).not.toHaveBeenCalled();
  });

  it('returns 500 and releases the claim when the campaign update fails, so Stripe retries (TEST-3)', async () => {
    constructEvent.mockReturnValue(subEvent({ id: 'evt_5', status: 'past_due' }));
    update.mockReturnValueOnce({ eq: () => eqResult({ data: null, error: { message: 'db down' } }) } as any);
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(claimDeleteEq).toHaveBeenCalledWith('id', 'evt_5');
  });

  it('releases the claim when processing throws unexpectedly', async () => {
    constructEvent.mockReturnValue(checkoutEvent({ id: 'evt_throw' }));
    subscriptionsRetrieve.mockRejectedValueOnce(new Error('stripe down'));
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(claimDeleteEq).toHaveBeenCalledWith('id', 'evt_throw');
  });

  it('resolves plan_id from the subscription price on customer.subscription.updated', async () => {
    constructEvent.mockReturnValue(subEvent({ id: 'evt_plan', priceId: 'price_pro' }));
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(200);
    const payload = (update.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.plan_id).toBe('pro');
  });

  it('provisions a new campaign from checkout.session.completed and links the claim', async () => {
    campaignSingle.mockResolvedValue({ data: { id: 'campaign-42', subscription_event_created: null }, error: null });
    constructEvent.mockReturnValue(checkoutEvent());
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(subscriptionsRetrieve).toHaveBeenCalledWith('sub_new');
    const payload = (update.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      plan_id: 'pro',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_new',
      subscription_status: 'active',
      subscription_event_created: 3000,
    });
    expect(claimUpdate).toHaveBeenCalledWith({ campaign_id: 'campaign-42' });
  });

  it('ignores a stale checkout.session.completed (older than the last applied subscription event)', async () => {
    campaignSingle.mockResolvedValue({ data: { id: 'campaign-42', subscription_event_created: 5000 }, error: null });
    constructEvent.mockReturnValue(checkoutEvent({ id: 'evt_checkout_old', created: 4000 }));
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(claimDeleteEq).not.toHaveBeenCalled();
  });

  it('returns 500 and releases the claim when the checkout price maps to no billing plan (I4)', async () => {
    campaignSingle.mockResolvedValue({ data: { id: 'campaign-42', subscription_event_created: null }, error: null });
    subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_new', status: 'active',
      items: { data: [{ current_period_end: 1_800_000_000, price: { id: 'price_unknown' } }] },
    });
    constructEvent.mockReturnValue(checkoutEvent({ id: 'evt_checkout_noplan' }));
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(500);
    // Never write plan_id: null for a customer who just paid, and never keep the
    // event claimed — Stripe must retry once billing_plans is in sync.
    expect(update).not.toHaveBeenCalled();
    expect(claimDeleteEq).toHaveBeenCalledWith('id', 'evt_checkout_noplan');
  });

  it('returns 409 and releases the claim when the checkout campaign does not exist (I4)', async () => {
    campaignSingle.mockResolvedValue({ data: null, error: null });
    constructEvent.mockReturnValue(checkoutEvent({ id: 'evt_checkout_nomatch', ref: 'campaign-gone' }));
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(claimDeleteEq).toHaveBeenCalledWith('id', 'evt_checkout_nomatch');
  });

  it('returns 409 and releases the claim when the checkout update matches no campaign row', async () => {
    campaignSingle.mockResolvedValue({ data: { id: 'campaign-42', subscription_event_created: null }, error: null });
    constructEvent.mockReturnValue(checkoutEvent({ id: 'evt_checkout_zero' }));
    update.mockReturnValueOnce({ eq: () => eqResult({ data: [], error: null }) } as any);
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(claimDeleteEq).toHaveBeenCalledWith('id', 'evt_checkout_zero');
  });

  it('logs and acks checkout.session.completed events missing required fields', async () => {
    constructEvent.mockReturnValue(checkoutEvent({ id: 'evt_checkout_bad', ref: null }));
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
    expect(subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(claimDeleteEq).not.toHaveBeenCalled();
  });
});
