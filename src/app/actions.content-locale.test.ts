import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', locale: 'en', exp: 9_999_999_999 };
const campaign = {
  id: 'c-1', name: 'Test', jurisdictions: ['US-FEDERAL'], monthlyCostCapCents: 100_00,
  planId: null, stripeCustomerId: null, stripeSubscriptionId: null,
  subscriptionStatus: null, gracePeriodEndsAt: null, currentPeriodEnd: null,
};

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve(campaign)), getBillingPlan: vi.fn(() => Promise.resolve(null)) }));

const insert = vi.fn(() => Promise.resolve({ error: null }));
const from = vi.fn(() => ({ insert }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from },
  throwOnError: async (q: any) => { const r = await q; if (r?.error) throw new Error(r.error.message); return r?.data; },
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'ci-1'), prefixedId: vi.fn(), inviteCode: vi.fn() }));

const getCandidateProfile = vi.fn(() => Promise.resolve(null as any));
vi.mock('@/lib/candidate', () => ({ getCandidateProfile, upsertCandidateProfile: vi.fn() }));

const billingGate = { check: vi.fn(() => Promise.resolve()) };
const quotaGate = { checkAndIncrement: vi.fn(() => Promise.resolve()), checkAvatarCap: vi.fn(() => Promise.resolve()), release: vi.fn(() => Promise.resolve()) };
const contentGenerator = { draft: vi.fn() };
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, publisher: {}, photoAvatarProvider: {},
  billingGate, quotaGate, contentGenerator, videoProvider: {}, voiceProvider: {},
}));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  billingGate.check.mockResolvedValue(undefined);
  quotaGate.checkAndIncrement.mockResolvedValue(undefined);
  quotaGate.release.mockResolvedValue(undefined);
  getCandidateProfile.mockResolvedValue(null);
  insert.mockResolvedValue({ error: null });
});

describe('generateDraftAction — locale', () => {
  it('passes the explicitly selected locale through to the content generator', async () => {
    contentGenerator.draft.mockResolvedValue({ title: 'T', text: 'B', locale: 'es' });
    const { generateDraftAction } = await import('./actions');
    await generateDraftAction('escribe algo', 'social_post', 'es');
    expect(contentGenerator.draft).toHaveBeenCalledWith(expect.objectContaining({ locale: 'es' }));
  });

  it("falls back to the campaign profile's content_locale when no locale is passed", async () => {
    getCandidateProfile.mockResolvedValue({ contentLocale: 'es' });
    contentGenerator.draft.mockResolvedValue({ title: 'T', text: 'B', locale: 'es' });
    const { generateDraftAction } = await import('./actions');
    await generateDraftAction('write a post', 'social_post');
    expect(contentGenerator.draft).toHaveBeenCalledWith(expect.objectContaining({ locale: 'es' }));
  });

  it('falls back to English when the passed locale is invalid and there is no profile default', async () => {
    contentGenerator.draft.mockResolvedValue({ title: 'T', text: 'B', locale: 'en' });
    const { generateDraftAction } = await import('./actions');
    await generateDraftAction('write a post', 'social_post', 'klingon');
    expect(contentGenerator.draft).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }));
  });
});

describe('createContentAction — locale', () => {
  function formData(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it('persists the submitted locale on the new content item', async () => {
    const { createContentAction } = await import('./actions');
    await createContentAction(undefined, formData({ type: 'social_post', title: 'T', body: 'B', locale: 'es' }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ locale: 'es' }));
  });

  it('falls back to English when the submitted locale is missing or invalid', async () => {
    const { createContentAction } = await import('./actions');
    await createContentAction(undefined, formData({ type: 'social_post', title: 'T', body: 'B', locale: 'not-a-locale' }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }));
  });

  it("falls back to the campaign profile's content_locale when the submitted locale is missing or invalid", async () => {
    getCandidateProfile.mockResolvedValue({ contentLocale: 'es' });
    const { createContentAction } = await import('./actions');
    await createContentAction(undefined, formData({ type: 'social_post', title: 'T', body: 'B', locale: 'not-a-locale' }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ locale: 'es' }));
  });
});
