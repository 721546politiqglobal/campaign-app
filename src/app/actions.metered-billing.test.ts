import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapExceeded } from '@/domain/usage';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };
const campaign = {
  id: 'c-1', name: 'Test', jurisdictions: [], monthlyCostCapCents: 100_00,
  planId: null, stripeCustomerId: null, stripeSubscriptionId: null,
  subscriptionStatus: null, gracePeriodEndsAt: null, currentPeriodEnd: null,
};

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve(campaign)) }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(() => Promise.resolve({ error: null })), update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })), delete: vi.fn() })) },
  throwOnError: async (q: any) => { const r = await q; if (r?.error) throw new Error(r.error.message); return r?.data; },
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'ci-1'), prefixedId: vi.fn(), inviteCode: vi.fn() }));
vi.mock('@/lib/prompt', () => ({ CONTENT_COST_CENTS: { social_post: 5_00 } }));

const getCandidateProfile = vi.fn(() => Promise.resolve(null as any));
vi.mock('@/lib/candidate', () => ({ getCandidateProfile, upsertCandidateProfile: vi.fn() }));

const billingGate = { check: vi.fn(() => Promise.resolve()) };
const usageMeter = { guard: vi.fn(() => Promise.resolve('res-1')), record: vi.fn(() => Promise.resolve()) };
const contentGenerator = { draft: vi.fn() };
const videoProvider = { generateAvatarVideo: vi.fn(), getVideoStatus: vi.fn() };
const voiceProvider = { synthesize: vi.fn() };
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, publisher: {}, photoAvatarProvider: {},
  billingGate, usageMeter, contentGenerator, videoProvider, voiceProvider,
}));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  billingGate.check.mockResolvedValue(undefined);
  usageMeter.guard.mockResolvedValue('res-1');
  usageMeter.record.mockResolvedValue(undefined);
  getCandidateProfile.mockResolvedValue(null);
});

describe('generateDraftAction billing', () => {
  it('records llm_tokens usage even when the generator throws (the Anthropic call already billed)', async () => {
    contentGenerator.draft.mockRejectedValue(new Error('model refused'));
    const { generateDraftAction } = await import('./actions');
    await expect(generateDraftAction('write a post', 'social_post')).rejects.toThrow('model refused');
    expect(usageMeter.record).toHaveBeenCalledWith('res-1', 'llm_tokens', 1, 5_00);
  });

  it('guards the cap before generating and records after success', async () => {
    contentGenerator.draft.mockResolvedValue({ title: 'T', text: 'B' });
    const { generateDraftAction } = await import('./actions');
    await generateDraftAction('write a post', 'social_post');
    expect(usageMeter.guard).toHaveBeenCalledWith('c-1', 100_00, 5_00);
    expect(usageMeter.record).toHaveBeenCalledWith('res-1', 'llm_tokens', 1, 5_00);
  });
});

describe('generateVideoAction billing', () => {
  it('refuses (and never guards spend or calls HeyGen) when no avatar is configured', async () => {
    getCandidateProfile.mockResolvedValue(null);
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('ci-1', 'script');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/avatar/i);
    expect(usageMeter.guard).not.toHaveBeenCalled();
    expect(videoProvider.generateAvatarVideo).not.toHaveBeenCalled();
  });

  it('guards $50 before calling HeyGen and records $50 after success', async () => {
    getCandidateProfile.mockResolvedValue({ heygenVoiceId: 'hv-1' });
    videoProvider.generateAvatarVideo.mockResolvedValue({ videoId: 'v-1' });
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('ci-1', 'script', { avatarId: 'look_1' });
    expect(r.ok).toBe(true);
    expect(usageMeter.guard).toHaveBeenCalledWith('c-1', 100_00, 50_00);
    expect(usageMeter.record).toHaveBeenCalledWith('res-1', 'video_generation', 1, 50_00);
  });

  it('does not call HeyGen or record when the cap guard rejects', async () => {
    getCandidateProfile.mockResolvedValue({ heygenVoiceId: 'hv-1' });
    usageMeter.guard.mockRejectedValue(new CapExceeded('This campaign has reached its monthly spending cap. Raise the cap in Settings to continue.'));
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('ci-1', 'script', { avatarId: 'look_1' });
    expect(r.ok).toBe(false);
    expect(videoProvider.generateAvatarVideo).not.toHaveBeenCalled();
    expect(usageMeter.record).not.toHaveBeenCalled();
  });
});

describe('synthesizeVoiceAction billing', () => {
  it('guards $20 before synth and records $20 after success', async () => {
    getCandidateProfile.mockResolvedValue({ elevenLabsVoiceId: 'ev-1' });
    voiceProvider.synthesize.mockResolvedValue({ audioUrl: 'https://media/x.mp3' });
    const { synthesizeVoiceAction } = await import('./actions');
    const r = await synthesizeVoiceAction('hello');
    expect(r.ok).toBe(true);
    expect(usageMeter.guard).toHaveBeenCalledWith('c-1', 100_00, 20_00);
    expect(usageMeter.record).toHaveBeenCalledWith('res-1', 'voice_synthesis', 1, 20_00);
  });
});
