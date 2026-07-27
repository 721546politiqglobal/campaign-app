import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };
const requireSession = vi.fn(() => Promise.resolve(session as any));
vi.mock('@/lib/session', () => ({ requireSession }));

// redirect() throws in Next.js so control never returns to the caller.
class RedirectError extends Error { constructor(public to: string) { super(`REDIRECT:${to}`); } }
const redirect = vi.fn((to: string) => { throw new RedirectError(to); });
vi.mock('next/navigation', () => ({ redirect }));

const checkoutCreate = vi.fn(() => Promise.resolve({ url: 'https://checkout.stripe.test/s/1' } as any));
const subscriptionsRetrieve = vi.fn();
const subscriptionsUpdate = vi.fn();
vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: checkoutCreate } },
    subscriptions: { retrieve: subscriptionsRetrieve, update: subscriptionsUpdate },
  },
}));

const campaign = {
  id: 'c-1', name: 'C', planId: null,
  stripeCustomerId: null as string | null,
  stripeSubscriptionId: null as string | null,
};
const getCampaign = vi.fn(() => Promise.resolve({ ...campaign } as any));
const getBillingPlan = vi.fn(() => Promise.resolve({ id: 'pro', stripeFlatPriceId: 'price_pro' } as any));
vi.mock('@/lib/data', () => ({ getCampaign, getBillingPlan }));

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(session as any);
  checkoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/s/1' } as any);
  getCampaign.mockResolvedValue({ ...campaign } as any);
  getBillingPlan.mockResolvedValue({ id: 'pro', stripeFlatPriceId: 'price_pro' } as any);
  process.env.NEXT_PUBLIC_SITE_URL = 'https://app.test';
});

async function run(planId = 'pro') {
  const { startCheckoutAction } = await import('./actions');
  try {
    await startCheckoutAction(planId);
    return null;
  } catch (e) {
    if (e instanceof RedirectError) return e.to;
    throw e;
  }
}

describe('startCheckoutAction permissions (C2)', () => {
  it('refuses a role without edit_settings and never touches Stripe', async () => {
    requireSession.mockResolvedValue({ ...session, role: 'staff' } as any);
    expect(await run()).toBeNull();
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

  it('does nothing when the campaign cannot be loaded', async () => {
    getCampaign.mockResolvedValue(null as any);
    expect(await run()).toBeNull();
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('does nothing when the plan cannot be loaded', async () => {
    getBillingPlan.mockResolvedValue(null as any);
    expect(await run()).toBeNull();
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
