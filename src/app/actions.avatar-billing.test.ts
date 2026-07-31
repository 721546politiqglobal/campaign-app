import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuotaExceeded } from '@/domain/quota';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };
const campaign = {
  id: 'c-1', name: 'Test Campaign', jurisdictions: [], monthlyCostCapCents: 100_00,
  planId: null, stripeCustomerId: null, stripeSubscriptionId: null,
  subscriptionStatus: null, gracePeriodEndsAt: null, currentPeriodEnd: null,
};

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

vi.mock('@/lib/session', () => ({
  requireSession: vi.fn(() => session),
  signInAs: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
  getCampaign: vi.fn(() => Promise.resolve(campaign)),
}));

vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() })),
    storage: {
      from: vi.fn(() => ({
        createSignedUploadUrl: vi.fn((path: string) => Promise.resolve({ data: { path, token: `token-${path}` }, error: null })),
        download: vi.fn(() => Promise.resolve({
          data: { arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer), type: 'image/jpeg' },
          error: null,
        })),
        getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://media.test/${path}` } })),
      })),
    },
  },
}));

vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'avatar-1') }));

const insertAvatar = vi.fn(() => Promise.resolve());
const updateAvatarStatus = vi.fn(() => Promise.resolve());
const getAvatar = vi.fn();
vi.mock('@/lib/avatars', () => ({ insertAvatar, updateAvatarStatus, getAvatar }));

const getCandidateProfile = vi.fn<() => Promise<{ activeAvatarId: string } | null>>(() => Promise.resolve(null));
const upsertCandidateProfile = vi.fn(() => Promise.resolve());
vi.mock('@/lib/candidate', () => ({ getCandidateProfile, upsertCandidateProfile }));

const billingGate = { check: vi.fn(() => Promise.resolve()) };
const quotaGate = { checkAndIncrement: vi.fn(() => Promise.resolve()), checkAvatarCap: vi.fn(() => Promise.resolve()), release: vi.fn(() => Promise.resolve()) };
const photoAvatarProvider = {
  uploadAsset: vi.fn(),
  createAvatarLook: vi.fn(),
  createPromptLook: vi.fn(),
  getAvatarGroupStatus: vi.fn(),
};
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: {}, voiceProvider: {},
  billingGate, quotaGate, photoAvatarProvider,
}));

vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));

function photoMetas(count: number) {
  return Array.from({ length: count }, (_, i) => ({ name: `p${i}.jpg`, type: 'image/jpeg', size: 3 }));
}

// Mirrors what AvatarManager does: begin (validation + quota/billing +
// signed upload URLs) then finalize (download from storage + HeyGen calls).
async function createAvatar(count: number, name = 'Candidate') {
  const { beginAvatarUploadAction, finalizeAvatarAction } = await import('./actions');
  const begin = await beginAvatarUploadAction(true, photoMetas(count));
  if (!begin.ok) return begin;
  return finalizeAvatarAction(begin.avatarId!, name, begin.uploads!.map(u => u.path));
}

beforeEach(() => {
  vi.clearAllMocks();
  billingGate.check.mockResolvedValue(undefined);
  quotaGate.checkAndIncrement.mockResolvedValue(undefined);
  quotaGate.checkAvatarCap.mockResolvedValue(undefined);
});

describe('beginAvatarUploadAction billing', () => {
  it('checks the avatar cap before ever touching storage or HeyGen', async () => {
    quotaGate.checkAvatarCap.mockRejectedValue(new QuotaExceeded('avatar', 'Your plan includes up to 1 avatars. Delete one or upgrade your plan to create another.'));
    const { beginAvatarUploadAction } = await import('./actions');

    const result = await beginAvatarUploadAction(true, photoMetas(4));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/avatars/);
    expect(photoAvatarProvider.uploadAsset).not.toHaveBeenCalled();
    expect(photoAvatarProvider.createAvatarLook).not.toHaveBeenCalled();
  });

  it('checks the avatar cap with the plan limit', async () => {
    const { beginAvatarUploadAction } = await import('./actions');
    await beginAvatarUploadAction(true, photoMetas(4));
    expect(quotaGate.checkAvatarCap).toHaveBeenCalledWith('c-1', null);
  });
});

describe('finalizeAvatarAction billing', () => {
  it('processes all photos through HeyGen', async () => {
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.createAvatarLook.mockResolvedValue({ lookId: 'look-1', groupId: 'group-1' });

    await createAvatar(4);

    expect(photoAvatarProvider.createAvatarLook).toHaveBeenCalledTimes(4);
  });

  it('processes only the photos up to the failure point when training fails midway', async () => {
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.createAvatarLook
      .mockResolvedValueOnce({ lookId: 'look-1', groupId: 'group-1' })
      .mockResolvedValueOnce({ lookId: 'look-2', groupId: 'group-1' })
      .mockRejectedValueOnce(new Error('HeyGen training failed'));

    await createAvatar(4);

    expect(photoAvatarProvider.createAvatarLook).toHaveBeenCalledTimes(3);
    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'failed', expect.objectContaining({ errorMessage: 'HeyGen training failed' }));
  });

  it('returns ok:false when the HeyGen creation loop fails', async () => {
    photoAvatarProvider.uploadAsset.mockRejectedValue(new Error('HeyGen upload error: bad file'));
    const result = await createAvatar(4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/bad file|failed/i);
    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'failed', expect.objectContaining({ errorMessage: expect.any(String) }));
  });
});

describe('generatePromptLookAction billing', () => {
  const readyAvatar = {
    id: 'avatar-1', campaignId: 'c-1', name: 'Candidate', status: 'ready' as const,
    heygenGroupId: 'group-1', heygenLookId: 'look-1', sourcePhotoUrls: [],
    consentConfirmedBy: 'u-1', consentConfirmedAt: '2026-01-01T00:00:00Z', createdBy: 'u-1', createdAt: '2026-01-01T00:00:00Z',
  };

  it('checks the billing gate before calling HeyGen, and never calls HeyGen when billing is blocked', async () => {
    const { BillingBlocked } = await import('@/domain/billing');
    getAvatar.mockResolvedValue(readyAvatar);
    billingGate.check.mockRejectedValue(new BillingBlocked('This campaign\'s subscription is past due.'));
    const { generatePromptLookAction } = await import('./actions');

    const result = await generatePromptLookAction('avatar-1', 'Debate look', 'wearing a navy suit');

    expect(result.ok).toBe(false);
    expect(photoAvatarProvider.createPromptLook).not.toHaveBeenCalled();
  });

  it('does not consume avatar quota — regenerating a look is not creating a new avatar', async () => {
    getAvatar.mockResolvedValue(readyAvatar);
    photoAvatarProvider.createPromptLook.mockResolvedValue({ lookId: 'look-2', groupId: 'group-1' });
    const { generatePromptLookAction } = await import('./actions');

    const result = await generatePromptLookAction('avatar-1', 'Debate look', 'wearing a navy suit');

    expect(result.ok).toBe(true);
    expect(quotaGate.checkAvatarCap).not.toHaveBeenCalled();
  });

  it('persists the newly generated look id onto the avatar instead of discarding it', async () => {
    getAvatar.mockResolvedValue(readyAvatar);
    photoAvatarProvider.createPromptLook.mockResolvedValue({ lookId: 'look-2', groupId: 'group-1' });
    const { generatePromptLookAction } = await import('./actions');

    await generatePromptLookAction('avatar-1', 'Debate look', 'wearing a navy suit');

    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'ready', { heygenLookId: 'look-2' });
  });

  it('updates the candidate profile so video generation picks up the new look when this avatar is active', async () => {
    getAvatar.mockResolvedValue(readyAvatar);
    getCandidateProfile.mockResolvedValue({ activeAvatarId: 'avatar-1' });
    photoAvatarProvider.createPromptLook.mockResolvedValue({ lookId: 'look-2', groupId: 'group-1' });
    const { generatePromptLookAction } = await import('./actions');

    await generatePromptLookAction('avatar-1', 'Debate look', 'wearing a navy suit');

    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', { heygenAvatarId: 'look-2' });
  });

  it('does not touch the candidate profile when this avatar is not the active one', async () => {
    getAvatar.mockResolvedValue(readyAvatar);
    getCandidateProfile.mockResolvedValue({ activeAvatarId: 'some-other-avatar' });
    photoAvatarProvider.createPromptLook.mockResolvedValue({ lookId: 'look-2', groupId: 'group-1' });
    const { generatePromptLookAction } = await import('./actions');

    await generatePromptLookAction('avatar-1', 'Debate look', 'wearing a navy suit');

    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });
});
