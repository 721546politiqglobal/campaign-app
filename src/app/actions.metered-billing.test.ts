import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuotaExceeded } from '@/domain/quota';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };
const campaign = {
  id: 'c-1', name: 'Test', jurisdictions: [], monthlyCostCapCents: 100_00,
  planId: null, stripeCustomerId: null, stripeSubscriptionId: null,
  subscriptionStatus: null, gracePeriodEndsAt: null, currentPeriodEnd: null,
};

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve(campaign)), getBillingPlan: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(() => Promise.resolve({ error: null })), update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })), delete: vi.fn() })) },
  throwOnError: async (q: any) => { const r = await q; if (r?.error) throw new Error(r.error.message); return r?.data; },
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'ci-1'), prefixedId: vi.fn(), inviteCode: vi.fn() }));

const getCandidateProfile = vi.fn(() => Promise.resolve(null as any));
vi.mock('@/lib/candidate', () => ({ getCandidateProfile, upsertCandidateProfile: vi.fn() }));

const billingGate = { check: vi.fn(() => Promise.resolve()) };
const quotaGate = { checkAndIncrement: vi.fn(() => Promise.resolve()), checkAvatarCap: vi.fn(() => Promise.resolve()) };
const contentGenerator = { draft: vi.fn() };
const videoProvider = { generateAvatarVideo: vi.fn(), getVideoStatus: vi.fn() };
const voiceProvider = { synthesize: vi.fn() };
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, publisher: {}, photoAvatarProvider: {},
  billingGate, quotaGate, contentGenerator, videoProvider, voiceProvider,
}));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  billingGate.check.mockResolvedValue(undefined);
  quotaGate.checkAndIncrement.mockResolvedValue(undefined);
  quotaGate.checkAvatarCap.mockResolvedValue(undefined);
  getCandidateProfile.mockResolvedValue(null);
});

describe('generateDraftAction billing', () => {
  it('propagates the generator error (quota was already checked/incremented before the call)', async () => {
    contentGenerator.draft.mockRejectedValue(new Error('model refused'));
    const { generateDraftAction } = await import('./actions');
    await expect(generateDraftAction('write a post', 'social_post')).rejects.toThrow('model refused');
    expect(quotaGate.checkAndIncrement).toHaveBeenCalledWith('c-1', 'content', expect.any(Date), null);
  });

  it('checks the content quota before generating', async () => {
    contentGenerator.draft.mockResolvedValue({ title: 'T', text: 'B' });
    const { generateDraftAction } = await import('./actions');
    await generateDraftAction('write a post', 'social_post');
    expect(quotaGate.checkAndIncrement).toHaveBeenCalledWith('c-1', 'content', expect.any(Date), null);
    expect(contentGenerator.draft).toHaveBeenCalled();
  });
});

describe('generateVideoAction billing', () => {
  it('refuses (and never checks quota or calls HeyGen) when no avatar is configured', async () => {
    getCandidateProfile.mockResolvedValue(null);
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('ci-1', 'script');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/avatar/i);
    expect(quotaGate.checkAndIncrement).not.toHaveBeenCalled();
    expect(videoProvider.generateAvatarVideo).not.toHaveBeenCalled();
  });

  it('checks the video quota before calling HeyGen', async () => {
    getCandidateProfile.mockResolvedValue({ heygenVoiceId: 'hv-1' });
    videoProvider.generateAvatarVideo.mockResolvedValue({ videoId: 'v-1' });
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('ci-1', 'script', { avatarId: 'look_1' });
    expect(r.ok).toBe(true);
    expect(quotaGate.checkAndIncrement).toHaveBeenCalledWith('c-1', 'video', expect.any(Date), null);
  });

  it('does not call HeyGen when the quota check rejects', async () => {
    getCandidateProfile.mockResolvedValue({ heygenVoiceId: 'hv-1' });
    quotaGate.checkAndIncrement.mockRejectedValue(new QuotaExceeded('video', "You've used all videos included in your plan for today. Upgrade your plan for more."));
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('ci-1', 'script', { avatarId: 'look_1' });
    expect(r.ok).toBe(false);
    expect(videoProvider.generateAvatarVideo).not.toHaveBeenCalled();
  });
});

describe('synthesizeVoiceAction billing', () => {
  it('checks the video quota before synthesizing', async () => {
    getCandidateProfile.mockResolvedValue({ elevenLabsVoiceId: 'ev-1' });
    voiceProvider.synthesize.mockResolvedValue({ audioUrl: 'https://media/x.mp3' });
    const { synthesizeVoiceAction } = await import('./actions');
    const r = await synthesizeVoiceAction('hello');
    expect(r.ok).toBe(true);
    expect(quotaGate.checkAndIncrement).toHaveBeenCalledWith('c-1', 'video', expect.any(Date), null);
  });
});
