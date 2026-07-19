import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', jurisdictions: [], monthlyCostCapCents: 100_00 })) }));
const getCandidateProfile = vi.fn();
vi.mock('@/lib/candidate', () => ({ getCandidateProfile, upsertCandidateProfile: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })), insert: vi.fn(() => Promise.resolve({ error: null })), select: vi.fn() })) },
  throwOnError: async (q: any) => (await q).data,
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn(), prefixedId: vi.fn(), inviteCode: vi.fn() }));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: {} }));
const generateAvatarVideo = vi.fn(() => Promise.resolve({ videoId: 'job-1' }));
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: { generateAvatarVideo, getVideoStatus: vi.fn() }, voiceProvider: {}, photoAvatarProvider: {},
  billingGate: { check: vi.fn() }, usageMeter: { guard: vi.fn(() => Promise.resolve('res-1')), record: vi.fn() },
}));

describe('generateVideoAction voice namespace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the HeyGen voice id (not the ElevenLabs id) to HeyGen', async () => {
    getCandidateProfile.mockResolvedValue({ heygenAvatarId: 'look-1', heygenVoiceId: 'heygen-v-1', elevenLabsVoiceId: 'eleven-x' });
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('c-1', 'script');
    expect(r.ok).toBe(true);
    expect(generateAvatarVideo).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'heygen-v-1' }));
  });

  it('refuses when no HeyGen voice id is configured (never falls back to a global)', async () => {
    getCandidateProfile.mockResolvedValue({ heygenAvatarId: 'look-1', heygenVoiceId: null, elevenLabsVoiceId: 'eleven-x' });
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('c-1', 'script');
    expect(r.ok).toBe(false);
    expect(generateAvatarVideo).not.toHaveBeenCalled();
  });
});
