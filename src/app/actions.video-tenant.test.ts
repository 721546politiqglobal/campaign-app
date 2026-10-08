import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tenant boundary for the HeyGen video actions (NEW-2 / INT-10): a user must
// not be able to attach a video job to another campaign's content item, nor
// read another campaign's HeyGen job status by guessing its id.

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', jurisdictions: [] })), getBillingPlan: vi.fn() }));
vi.mock('@/lib/candidate', () => ({
  getCandidateProfile: vi.fn(() => Promise.resolve({ heygenAvatarId: 'look-1', heygenVoiceId: 'v-1' })),
  upsertCandidateProfile: vi.fn(),
}));

// The job-ownership lookup: select('id').eq('video_job_id').eq('campaign_id').maybeSingle()
const ownedJob = vi.fn();
const update = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })) }));
vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: vi.fn(() => ({
      update,
      insert: vi.fn(() => Promise.resolve({ error: null })),
      select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: ownedJob })) })) })),
    })),
  },
  throwOnError: async (q: any) => (await q).data,
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn(), prefixedId: vi.fn(), inviteCode: vi.fn() }));
const get = vi.fn();
vi.mock('@/lib/repos', () => ({ contentRepo: { get }, approvalRepo: {}, disclosureRepo: {}, auditRepo: {} }));
const generateAvatarVideo = vi.fn(() => Promise.resolve({ videoId: 'job-1' }));
const getVideoStatus = vi.fn();
const checkAndIncrement = vi.fn(() => Promise.resolve());
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: { generateAvatarVideo, getVideoStatus }, voiceProvider: {}, photoAvatarProvider: {},
  billingGate: { check: vi.fn() }, quotaGate: { checkAndIncrement, checkAvatarCap: vi.fn(), release: vi.fn() },
}));

describe('generateVideoAction tenant boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a content item owned by another campaign, before spending quota or calling HeyGen', async () => {
    get.mockResolvedValue({ id: 'other-item', campaignId: 'c-2' });
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('other-item', 'script');
    expect(r.ok).toBe(false);
    expect(checkAndIncrement).not.toHaveBeenCalled();
    expect(generateAvatarVideo).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('generates for an item the caller owns', async () => {
    get.mockResolvedValue({ id: 'mine', campaignId: 'c-1' });
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('mine', 'script');
    expect(r.ok).toBe(true);
    expect(generateAvatarVideo).toHaveBeenCalled();
  });
});

describe('getVideoStatusAction tenant boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('never queries HeyGen for a job id that is not on one of the caller’s content items', async () => {
    ownedJob.mockResolvedValue({ data: null, error: null });
    const { getVideoStatusAction } = await import('./actions');
    const r = await getVideoStatusAction('someone-elses-job');
    expect(r).toEqual({ status: 'failed' });
    expect(getVideoStatus).not.toHaveBeenCalled();
  });

  it('returns the provider status for the caller’s own job', async () => {
    ownedJob.mockResolvedValue({ data: { id: 'mine' }, error: null });
    getVideoStatus.mockResolvedValue({ status: 'processing' });
    const { getVideoStatusAction } = await import('./actions');
    const r = await getVideoStatusAction('job-1');
    expect(r).toEqual({ status: 'processing' });
  });
});
