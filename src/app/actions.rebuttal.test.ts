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
const getMonitoringItemForCampaign = vi.fn((..._a: unknown[]) => Promise.resolve(null as any));
vi.mock('@/lib/data', () => ({
  getCampaign: vi.fn(() => Promise.resolve(campaign)), getBillingPlan: vi.fn(() => Promise.resolve(null)),
  getMonitoringItemForCampaign: (...a: unknown[]) => getMonitoringItemForCampaign(...a),
}));

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

const story = {
  id: 'mr-9', campaignId: 'c-1', source: 'CNN', url: 'https://cnn.com/s', excerpt: 'Trump attacks our tax plan.',
  opponent: 'Donald J Trump', capturedAt: '2026-10-11T10:00:00Z', triageReason: 'Attacks our candidate.',
};

describe('generateDraftAction — responding to a monitored story', () => {
  it("loads the story from the caller's own campaign and passes it to the generator as rebuttal context", async () => {
    getMonitoringItemForCampaign.mockResolvedValue(story);
    contentGenerator.draft.mockResolvedValue({ title: 'T', text: 'B', locale: 'en' });
    const { generateDraftAction } = await import('./actions');
    const r = await generateDraftAction('Respond firmly', 'talking_points', 'en', 'mr-9');
    expect(r.ok).toBe(true);
    expect(getMonitoringItemForCampaign).toHaveBeenCalledWith('c-1', 'mr-9');
    expect(contentGenerator.draft).toHaveBeenCalledWith(expect.objectContaining({
      type: 'talking_points',
      rebuttal: expect.objectContaining({ source: 'CNN', url: 'https://cnn.com/s', excerpt: 'Trump attacks our tax plan.', opponent: 'Donald J Trump' }),
    }));
  });

  it("refuses (without spending quota) when the story isn't in the caller's campaign", async () => {
    getMonitoringItemForCampaign.mockResolvedValue(null);
    const { generateDraftAction } = await import('./actions');
    const r = await generateDraftAction('Respond', 'social_post', 'en', 'mr-other');
    expect(r.ok).toBe(false);
    expect(quotaGate.checkAndIncrement).not.toHaveBeenCalled();
    expect(contentGenerator.draft).not.toHaveBeenCalled();
  });

  it('drafts normally (no rebuttal context) without a story id', async () => {
    contentGenerator.draft.mockResolvedValue({ title: 'T', text: 'B', locale: 'en' });
    const { generateDraftAction } = await import('./actions');
    await generateDraftAction('write', 'social_post', 'en');
    expect(getMonitoringItemForCampaign).not.toHaveBeenCalled();
    expect((contentGenerator.draft.mock.calls[0] as any)[0].rebuttal).toBeUndefined();
  });
});
