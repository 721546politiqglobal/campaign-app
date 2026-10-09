import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as string, campaignId: 'c-1', locale: 'en', exp: 9_999_999_999 };
const requireSession = vi.fn(() => Promise.resolve(session as any));
vi.mock('@/lib/session', () => ({ requireSession, signInAs: vi.fn(), signOut: vi.fn() }));

// redirect() throws in Next.js so control never returns to the caller.
class RedirectError extends Error { constructor(public to: string) { super(`REDIRECT:${to}`); } }
const redirect = vi.fn((to: string) => { throw new RedirectError(to); });
vi.mock('next/navigation', () => ({ redirect, notFound: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const portalCreate = vi.fn((_args: unknown) => Promise.resolve({ url: 'https://billing.stripe.test/p/1' } as any));
let stripeMock: { billingPortal: { sessions: { create: typeof portalCreate } } } | null = null;
vi.mock('@/lib/stripe', () => ({ get stripe() { return stripeMock; } }));

const getCampaign = vi.fn((_id: string) => Promise.resolve({ id: 'c-1', stripeCustomerId: 'cus_1' } as any));
vi.mock('@/lib/data', () => ({ getCampaign, getBillingPlan: vi.fn() }));

// actions.ts pulls in the whole service graph at import time; none of it is
// exercised by the billing portal action.
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn() }, throwOnError: vi.fn() }));
vi.mock('@/lib/store', () => ({ uid: vi.fn(), prefixedId: vi.fn() }));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: {} }));
vi.mock('@/lib/channels', () => ({ getCampaignSocialProfile: vi.fn() }));
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, quotaGate: {}, billingGate: {},
  contentGenerator: {}, publisher: {}, videoProvider: {}, voiceProvider: {}, photoAvatarProvider: {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  session.role = 'owner';
  stripeMock = { billingPortal: { sessions: { create: portalCreate } } };
  portalCreate.mockResolvedValue({ url: 'https://billing.stripe.test/p/1' } as any);
  getCampaign.mockResolvedValue({ id: 'c-1', stripeCustomerId: 'cus_1' } as any);
  process.env.NEXT_PUBLIC_SITE_URL = 'https://app.test';
});

async function run() {
  const { openMyBillingPortalAction } = await import('./actions');
  try {
    return { result: await openMyBillingPortalAction(null, new FormData()), redirectedTo: null as string | null };
  } catch (e) {
    if (e instanceof RedirectError) return { result: null, redirectedTo: e.to };
    throw e;
  }
}

describe('openMyBillingPortalAction', () => {
  it('refuses a role without edit_settings with a translated message', async () => {
    session.role = 'staff';
    const { result } = await run();
    expect(result).toEqual({ ok: false, error: 'Only campaign owners and managers can manage billing.' });
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it('explains when Stripe is not configured instead of silently returning', async () => {
    stripeMock = null;
    const { result } = await run();
    expect(result).toEqual({ ok: false, error: "Billing isn't configured on this server yet. Contact your platform admin." });
  });

  it('explains when the campaign has no Stripe customer yet', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', stripeCustomerId: null } as any);
    const { result } = await run();
    expect(result).toEqual({ ok: false, error: "This campaign doesn't have a billing account yet. Subscribe to a plan first." });
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it('opens the portal for the campaign customer and returns to /billing', async () => {
    const { redirectedTo } = await run();
    expect(redirectedTo).toBe('https://billing.stripe.test/p/1');
    expect(portalCreate).toHaveBeenCalledWith({ customer: 'cus_1', return_url: 'https://app.test/billing' });
  });

  it('returns a translated error (never the Stripe message) when the portal call fails', async () => {
    portalCreate.mockRejectedValueOnce(new Error('No such customer: cus_1'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await run();
    expect(result).toEqual({ ok: false, error: "Couldn't open the billing portal. Please try again." });
    expect(redirect).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
