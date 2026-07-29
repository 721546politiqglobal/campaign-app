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
const quotaGate = { checkAndIncrement: vi.fn(() => Promise.resolve()), checkAvatarCap: vi.fn(() => Promise.resolve()), release: vi.fn(() => Promise.resolve()) };
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
  quotaGate.release.mockResolvedValue(undefined);
  getCandidateProfile.mockResolvedValue(null);
});

describe('generateDraftAction billing', () => {
  it('propagates the generator error (quota was already checked/incremented before the call)', async () => {
    contentGenerator.draft.mockRejectedValue(new Error('model refused'));
    const { generateDraftAction } = await import('./actions');
    await expect(generateDraftAction('write a post', 'social_post')).rejects.toThrow('model refused');
    expect(quotaGate.checkAndIncrement).toHaveBeenCalledWith('c-1', 'content', expect.any(Date), null);
  });

  it('releases the content slot when the generator fails, using the increment period', async () => {
    contentGenerator.draft.mockRejectedValue(new Error('model refused'));
    const { generateDraftAction } = await import('./actions');
    await expect(generateDraftAction('write a post', 'social_post')).rejects.toThrow('model refused');
    const incrementPeriod = (quotaGate.checkAndIncrement.mock.calls[0] as unknown[])[2];
    expect(quotaGate.release).toHaveBeenCalledWith('c-1', 'content', incrementPeriod);
  });

  it('checks the content quota before generating', async () => {
    contentGenerator.draft.mockResolvedValue({ title: 'T', text: 'B' });
    const { generateDraftAction } = await import('./actions');
    const r = await generateDraftAction('write a post', 'social_post');
    expect(r).toEqual({ ok: true, title: 'T', text: 'B' });
    expect(quotaGate.checkAndIncrement).toHaveBeenCalledWith('c-1', 'content', expect.any(Date), null);
    expect(contentGenerator.draft).toHaveBeenCalled();
    expect(quotaGate.release).not.toHaveBeenCalled();
  });

  it('returns the quota-exceeded message so the UI can show it verbatim (I6)', async () => {
    const message = "You've used all content pieces included in your plan for this month. Upgrade your plan for more.";
    quotaGate.checkAndIncrement.mockRejectedValue(new QuotaExceeded('content', message));
    const { generateDraftAction } = await import('./actions');
    const r = await generateDraftAction('write a post', 'social_post');
    expect(r).toEqual({ ok: false, error: message });
    expect(contentGenerator.draft).not.toHaveBeenCalled();
  });

  it('returns the billing-blocked message rather than throwing', async () => {
    const { BillingBlocked } = await import('@/domain/billing');
    billingGate.check.mockRejectedValue(new BillingBlocked('This campaign must subscribe to a plan before using this feature. Visit /pricing to subscribe.'));
    const { generateDraftAction } = await import('./actions');
    const r = await generateDraftAction('write a post', 'social_post');
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/must subscribe to a plan/) });
    expect(quotaGate.checkAndIncrement).not.toHaveBeenCalled();
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
    expect(quotaGate.release).not.toHaveBeenCalled();
  });

  it('releases the video slot when HeyGen fails, so a provider error does not cost the day (I7/BILL-9)', async () => {
    getCandidateProfile.mockResolvedValue({ heygenVoiceId: 'hv-1' });
    videoProvider.generateAvatarVideo.mockRejectedValue(new Error('HeyGen 500'));
    const { generateVideoAction } = await import('./actions');
    await expect(generateVideoAction('ci-1', 'script', { avatarId: 'look_1' })).rejects.toThrow('HeyGen 500');
    const incrementPeriod = (quotaGate.checkAndIncrement.mock.calls[0] as unknown[])[2];
    expect(quotaGate.release).toHaveBeenCalledWith('c-1', 'video', incrementPeriod);
  });

  it('does NOT release the video slot when HeyGen accepted the job', async () => {
    getCandidateProfile.mockResolvedValue({ heygenVoiceId: 'hv-1' });
    videoProvider.generateAvatarVideo.mockResolvedValue({ videoId: 'v-1' });
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('ci-1', 'script', { avatarId: 'look_1' });
    expect(r.ok).toBe(true);
    expect(quotaGate.release).not.toHaveBeenCalled();
  });

  it('still surfaces the provider error when the release itself fails', async () => {
    getCandidateProfile.mockResolvedValue({ heygenVoiceId: 'hv-1' });
    videoProvider.generateAvatarVideo.mockRejectedValue(new Error('HeyGen 500'));
    quotaGate.release.mockRejectedValue(new Error('rpc down'));
    const { generateVideoAction } = await import('./actions');
    await expect(generateVideoAction('ci-1', 'script', { avatarId: 'look_1' })).rejects.toThrow('HeyGen 500');
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
    expect(quotaGate.release).not.toHaveBeenCalled();
  });

  it('releases the video slot when ElevenLabs fails (I7/BILL-9)', async () => {
    getCandidateProfile.mockResolvedValue({ elevenLabsVoiceId: 'ev-1' });
    voiceProvider.synthesize.mockRejectedValue(new Error('ElevenLabs 503'));
    const { synthesizeVoiceAction } = await import('./actions');
    await expect(synthesizeVoiceAction('hello')).rejects.toThrow('ElevenLabs 503');
    const incrementPeriod = (quotaGate.checkAndIncrement.mock.calls[0] as unknown[])[2];
    expect(quotaGate.release).toHaveBeenCalledWith('c-1', 'video', incrementPeriod);
  });
});
