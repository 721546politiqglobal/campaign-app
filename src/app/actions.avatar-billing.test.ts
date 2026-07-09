import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapExceeded } from '@/domain/usage';

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
        upload: vi.fn(() => Promise.resolve({ error: null })),
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
const usageMeter = { guard: vi.fn(() => Promise.resolve()), record: vi.fn(() => Promise.resolve()) };
const photoAvatarProvider = {
  uploadAsset: vi.fn(),
  createAvatarLook: vi.fn(),
  createPromptLook: vi.fn(),
  getAvatarGroupStatus: vi.fn(),
};
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: {}, voiceProvider: {},
  billingGate, usageMeter, photoAvatarProvider,
}));

vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));

function makePhotos(count: number): FormData {
  const fd = new FormData();
  fd.set('consent', 'on');
  fd.set('name', 'Candidate');
  for (let i = 0; i < count; i++) {
    fd.append('photos', new File([new Uint8Array([1, 2, 3])], `p${i}.jpg`, { type: 'image/jpeg' }));
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  billingGate.check.mockResolvedValue(undefined);
  usageMeter.guard.mockResolvedValue(undefined);
  usageMeter.record.mockResolvedValue(undefined);
});

describe('createAvatarAction billing', () => {
  it('checks the spend cap before calling HeyGen, and never calls HeyGen if the cap is exceeded', async () => {
    usageMeter.guard.mockRejectedValue(new CapExceeded('This campaign has reached its monthly spending cap. Raise the cap in Settings to continue.'));
    const { createAvatarAction } = await import('./actions');

    const result = await createAvatarAction(makePhotos(4));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/spending cap/);
    expect(photoAvatarProvider.uploadAsset).not.toHaveBeenCalled();
    expect(photoAvatarProvider.createAvatarLook).not.toHaveBeenCalled();
  });

  it('records the full training cost (photos × per-look cost) after all photos succeed', async () => {
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.createAvatarLook.mockResolvedValue({ lookId: 'look-1', groupId: 'group-1' });
    const { createAvatarAction } = await import('./actions');

    await createAvatarAction(makePhotos(4));

    expect(usageMeter.guard).toHaveBeenCalledWith('c-1', 100_00, 4 * 1_00);
    expect(usageMeter.record).toHaveBeenCalledWith('c-1', 'avatar_training', 4, 4 * 1_00, 4 * 1_00);
  });

  it('records only the cost for photos actually processed when training fails midway', async () => {
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.createAvatarLook
      .mockResolvedValueOnce({ lookId: 'look-1', groupId: 'group-1' })
      .mockResolvedValueOnce({ lookId: 'look-2', groupId: 'group-1' })
      .mockRejectedValueOnce(new Error('HeyGen training failed'));
    const { createAvatarAction } = await import('./actions');

    await createAvatarAction(makePhotos(4));

    expect(usageMeter.record).toHaveBeenCalledWith('c-1', 'avatar_training', 2, 2 * 1_00, 4 * 1_00);
    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'failed', expect.objectContaining({ errorMessage: 'HeyGen training failed' }));
  });
});

describe('generatePromptLookAction billing', () => {
  const readyAvatar = {
    id: 'avatar-1', campaignId: 'c-1', name: 'Candidate', status: 'ready' as const,
    heygenGroupId: 'group-1', heygenLookId: 'look-1', sourcePhotoUrls: [],
    consentConfirmedBy: 'u-1', consentConfirmedAt: '2026-01-01T00:00:00Z', createdBy: 'u-1', createdAt: '2026-01-01T00:00:00Z',
  };

  it('checks the spend cap before calling HeyGen, and never calls HeyGen if the cap is exceeded', async () => {
    getAvatar.mockResolvedValue(readyAvatar);
    usageMeter.guard.mockRejectedValue(new CapExceeded('This campaign has reached its monthly spending cap. Raise the cap in Settings to continue.'));
    const { generatePromptLookAction } = await import('./actions');

    const result = await generatePromptLookAction('avatar-1', 'Debate look', 'wearing a navy suit');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/spending cap/);
    expect(photoAvatarProvider.createPromptLook).not.toHaveBeenCalled();
  });

  it('records the look-generation cost after a successful call', async () => {
    getAvatar.mockResolvedValue(readyAvatar);
    photoAvatarProvider.createPromptLook.mockResolvedValue({ lookId: 'look-2', groupId: 'group-1' });
    const { generatePromptLookAction } = await import('./actions');

    const result = await generatePromptLookAction('avatar-1', 'Debate look', 'wearing a navy suit');

    expect(result.ok).toBe(true);
    expect(usageMeter.guard).toHaveBeenCalledWith('c-1', 100_00, 1_00);
    expect(usageMeter.record).toHaveBeenCalledWith('c-1', 'avatar_look_generation', 1, 1_00);
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
