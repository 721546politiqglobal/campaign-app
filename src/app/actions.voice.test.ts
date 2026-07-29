import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', jurisdictions: [], monthlyCostCapCents: 100_00 })) }));
const getCandidateProfile = vi.fn();
vi.mock('@/lib/candidate', () => ({ getCandidateProfile }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update: vi.fn(), insert: vi.fn(), select: vi.fn() })) }, throwOnError: async (q: any) => (await q).data }));
vi.mock('@/lib/store', () => ({ uid: vi.fn(), prefixedId: vi.fn(), inviteCode: vi.fn() }));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: {} }));
const synthesize = vi.fn(() => Promise.resolve({ audioUrl: 'http://a/1.mp3' }));
const checkAndIncrement = vi.fn(() => Promise.resolve());
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: {}, voiceProvider: { synthesize }, photoAvatarProvider: {},
  billingGate: { check: vi.fn() }, quotaGate: { checkAndIncrement, checkAvatarCap: vi.fn(), release: vi.fn(() => Promise.resolve()) },
}));

describe('synthesizeVoiceAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the campaign voice id to the provider', async () => {
    getCandidateProfile.mockResolvedValue({ elevenLabsVoiceId: 'campaign-voice-1' });
    const { synthesizeVoiceAction } = await import('./actions');
    const r = await synthesizeVoiceAction('hello');
    expect(r.ok).toBe(true);
    expect(synthesize).toHaveBeenCalledWith({ text: 'hello', voiceId: 'campaign-voice-1' });
  });

  it('refuses (and never bills) when no campaign voice is configured', async () => {
    getCandidateProfile.mockResolvedValue({ elevenLabsVoiceId: null });
    const { synthesizeVoiceAction } = await import('./actions');
    const r = await synthesizeVoiceAction('hello');
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/voice/i) });
    expect(synthesize).not.toHaveBeenCalled();
    expect(checkAndIncrement).not.toHaveBeenCalled();
  });
});
