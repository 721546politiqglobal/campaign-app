import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', monthlyCostCapCents: 100_000 })) }));
vi.mock('@/lib/candidate', () => ({ getCandidateProfile: vi.fn(() => Promise.resolve({ heygenAvatarId: 'hg-1', heygenVoiceId: 'hv-1', elevenLabsVoiceId: 'ev-1' })) }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ insert: vi.fn(() => Promise.resolve({ error: null })) })) }, throwOnError: async (q: any) => (await q).data }));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'x'), prefixedId: vi.fn(), inviteCode: vi.fn() }));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));

const guard = vi.fn(() => Promise.resolve('res-1'));
const record = vi.fn(() => Promise.resolve());
const generateAvatarVideo = vi.fn();
const synthesize = vi.fn();
vi.mock('@/lib/services', () => ({
  usageMeter: { guard, record }, billingGate: { check: vi.fn(() => Promise.resolve()) },
  videoProvider: { generateAvatarVideo, getVideoStatus: vi.fn() }, voiceProvider: { synthesize },
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {}, photoAvatarProvider: {},
}));

describe('reservation is released on provider failure (BILL-9)', () => {
  beforeEach(() => { vi.clearAllMocks(); guard.mockResolvedValue('res-1'); });

  it('generateVideoAction records cost 0 (releasing the reservation) when the provider throws', async () => {
    generateAvatarVideo.mockRejectedValue(new Error('HeyGen 500'));
    const { generateVideoAction } = await import('./actions');
    await expect(generateVideoAction('content-1', 'script')).rejects.toThrow('HeyGen 500');
    expect(record).toHaveBeenCalledWith('res-1', 'video_generation', 1, 0);
  });

  it('synthesizeVoiceAction records cost 0 when the provider throws', async () => {
    synthesize.mockRejectedValue(new Error('ElevenLabs 429'));
    const { synthesizeVoiceAction } = await import('./actions');
    await expect(synthesizeVoiceAction('hello')).rejects.toThrow('ElevenLabs 429');
    expect(record).toHaveBeenCalledWith('res-1', 'voice_synthesis', 1, 0);
  });
});
