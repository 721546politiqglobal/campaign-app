import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import en from '@/messages/en.json';
import { INITIAL_FORM_STATE } from '@/lib/form-state';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', locale: 'en', exp: 9_999_999_999 };
const requireSession = vi.fn(() => Promise.resolve(session as any));
vi.mock('@/lib/session', () => ({ requireSession }));

// redirect() throws in Next.js so control never returns to the caller.
class RedirectError extends Error { constructor(public to: string) { super(`REDIRECT:${to}`); } }
const redirect = vi.fn((to: string) => { throw new RedirectError(to); });
vi.mock('next/navigation', () => ({ redirect }));

const checkoutCreate = vi.fn(() => Promise.resolve({ url: 'https://checkout.stripe.test/s/1' } as any));
const subscriptionsRetrieve = vi.fn(() => Promise.resolve({ items: { data: [{ id: 'si_1' }] } } as any));
const subscriptionsUpdate = vi.fn(() => Promise.resolve({} as any));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: checkoutCreate } },
    subscriptions: { retrieve: subscriptionsRetrieve, update: subscriptionsUpdate },
  },
}));

const dbEq = vi.fn(() => Promise.resolve({ error: null }));
const dbUpdate = vi.fn(() => ({ eq: dbEq }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update: dbUpdate })) } }));

const campaign = {
  id: 'c-1', name: 'C', planId: null,
  stripeCustomerId: null as string | null,
  stripeSubscriptionId: null as string | null,
};
const getCampaign = vi.fn(() => Promise.resolve({ ...campaign } as any));
const getBillingPlan = vi.fn(() => Promise.resolve({ id: 'pro', stripeFlatPriceId: 'price_pro' } as any));
vi.mock('@/lib/data', () => ({ getCampaign, getBillingPlan }));

const E = en.errors.pricing;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  requireSession.mockResolvedValue(session as any);
  checkoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/s/1' } as any);
  getCampaign.mockResolvedValue({ ...campaign } as any);
  getBillingPlan.mockResolvedValue({ id: 'pro', stripeFlatPriceId: 'price_pro' } as any);
  subscriptionsRetrieve.mockResolvedValue({ items: { data: [{ id: 'si_1' }] } } as any);
  subscriptionsUpdate.mockResolvedValue({} as any);
  dbEq.mockResolvedValue({ error: null });
  process.env.NEXT_PUBLIC_SITE_URL = 'https://app.test';
});
afterEach(() => { consoleError.mockRestore(); });

// Returns the redirect target on success, or the form state the action
// returned (the shape /pricing renders inline).
async function run(planId = 'pro') {
  const { startCheckoutAction } = await import('./actions');
  try {
    return await startCheckoutAction(planId, INITIAL_FORM_STATE, new FormData());
  } catch (e) {
    if (e instanceof RedirectError) return e.to;
    throw e;
  }
}

describe('startCheckoutAction permissions (C2)', () => {
  it('refuses a role without edit_settings with a translated message and never touches Stripe', async () => {
    requireSession.mockResolvedValue({ ...session, role: 'staff' } as any);
    expect(await run()).toEqual({ ok: false, error: E.permissionDenied });
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('allows an owner through to Checkout', async () => {
    expect(await run()).toBe('https://checkout.stripe.test/s/1');
    expect(checkoutCreate).toHaveBeenCalled();
  });
});

describe('startCheckoutAction duplicate-subscription guard (C2)', () => {
  it('redirects to /billing instead of creating a second subscription', async () => {
    getCampaign.mockResolvedValue({ ...campaign, stripeSubscriptionId: 'sub_live' } as any);
    expect(await run()).toBe('/billing');
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('explains when the campaign cannot be loaded', async () => {
    getCampaign.mockResolvedValue(null as any);
    expect(await run()).toEqual({ ok: false, error: E.campaignNotFound });
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('explains when the plan cannot be loaded', async () => {
    getBillingPlan.mockResolvedValue(null as any);
    expect(await run()).toEqual({ ok: false, error: E.planNotFound });
    expect(checkoutCreate).not.toHaveBeenCalled();
  });
});

describe('startCheckoutAction Stripe Customer reuse (C2)', () => {
  it('passes the existing customer id so Checkout does not mint a duplicate', async () => {
    getCampaign.mockResolvedValue({ ...campaign, stripeCustomerId: 'cus_existing' } as any);
    await run();
    expect(checkoutCreate).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_existing' }));
  });

  it('omits `customer` entirely when the campaign has none (Stripe creates one)', async () => {
    await run();
    const args = (checkoutCreate.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect('customer' in args).toBe(false);
    expect(args.client_reference_id).toBe('c-1');
  });
});

describe('startCheckoutAction post-payment redirect (I3)', () => {
  it('sends the payer back to /pricing?checkout=success, not /dashboard', async () => {
    await run();
    const args = (checkoutCreate.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(args.success_url).toBe('https://app.test/pricing?checkout=success');
    expect(args.cancel_url).toBe('https://app.test/pricing?checkout=canceled');
  });
});

describe('startCheckoutAction Stripe API failure', () => {
  it('returns a translated message (never the raw Stripe error) and logs the real reason', async () => {
    checkoutCreate.mockRejectedValue(new Error("No such price: 'price_bad'"));
    const result = await run();
    expect(result).toEqual({ ok: false, error: E.couldNotStartCheckout });
    expect(JSON.stringify(result)).not.toContain('price_bad');
    expect(consoleError).toHaveBeenCalled();
  });

  it('fails gracefully when Stripe returns a session without a url', async () => {
    checkoutCreate.mockResolvedValue({ id: 'cs_1', url: null } as any);
    expect(await run()).toEqual({ ok: false, error: E.couldNotStartCheckout });
  });
});

describe('changePlanAction Stripe API failure', () => {
  it('returns ok:false with a translated message (not e.message) when Stripe rejects the retrieve/update call', async () => {
    const { changePlanAction } = await import('./actions');
    getCampaign.mockResolvedValue({ ...campaign, stripeSubscriptionId: 'sub_live' } as any);
    subscriptionsRetrieve.mockRejectedValue(new Error("No such subscription: 'sub_live'"));
    const result = await changePlanAction('pro');
    expect(result).toEqual({ ok: false, error: E.couldNotChangePlan });
    expect(consoleError).toHaveBeenCalled();
  });

  it('refuses a role without edit_settings', async () => {
    const { changePlanAction } = await import('./actions');
    requireSession.mockResolvedValue({ ...session, role: 'approver' } as any);
    expect(await changePlanAction('pro')).toEqual({ ok: false, error: E.permissionDenied });
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('explains when there is no subscription to change', async () => {
    const { changePlanAction } = await import('./actions');
    expect(await changePlanAction('pro')).toEqual({ ok: false, error: E.noActiveSubscription });
  });
});

// Regression: the Stripe subscription's price updated successfully, but
// campaigns.plan_id was never written back to the database — the "Switch to
// this plan" flow (pricing/page.tsx) sends the user to /billing on ok:true
// regardless, so the page kept showing the OLD plan forever even though
// Stripe had genuinely switched. Verified live.
describe('changePlanAction persists the new plan_id after a successful Stripe update', () => {
  it('updates campaigns.plan_id to the new plan on success, invoicing the proration immediately', async () => {
    const { changePlanAction } = await import('./actions');
    getCampaign.mockResolvedValue({ ...campaign, stripeSubscriptionId: 'sub_live' } as any);
    const result = await changePlanAction('pro');
    expect(result).toEqual({ ok: true });
    expect(subscriptionsUpdate).toHaveBeenCalledWith('sub_live', expect.objectContaining({ proration_behavior: 'always_invoice' }));
    expect(dbUpdate).toHaveBeenCalledWith(expect.objectContaining({ plan_id: 'pro' }));
    expect(dbEq).toHaveBeenCalledWith('id', 'c-1');
  });

  it('does not touch the database when the Stripe update fails', async () => {
    const { changePlanAction } = await import('./actions');
    getCampaign.mockResolvedValue({ ...campaign, stripeSubscriptionId: 'sub_live' } as any);
    subscriptionsUpdate.mockRejectedValue(new Error('Stripe down'));
    const result = await changePlanAction('pro');
    expect(result.ok).toBe(false);
    expect(dbUpdate).not.toHaveBeenCalled();
  });
});
