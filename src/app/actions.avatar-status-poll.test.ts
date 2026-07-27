import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() })), storage: { from: vi.fn() } },
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn() }));

const getAvatar = vi.fn();
const updateAvatarStatus = vi.fn(() => Promise.resolve());
const insertAvatar = vi.fn();
vi.mock('@/lib/avatars', () => ({ getAvatar, updateAvatarStatus, insertAvatar }));

const photoAvatarProvider = {
  uploadAsset: vi.fn(), createAvatarLook: vi.fn(), createPromptLook: vi.fn(),
  createVideoAvatar: vi.fn(), requestConsent: vi.fn(), getAvatarGroupStatus: vi.fn(),
};
const billingGate = { check: vi.fn() };
const quotaGate = { checkAndIncrement: vi.fn(), checkAvatarCap: vi.fn(), release: vi.fn() };
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: {}, voiceProvider: {}, billingGate, quotaGate, photoAvatarProvider,
}));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));

const baseAvatar = {
  id: 'avatar-1', campaignId: 'c-1', name: 'Candidate twin', sourceType: 'digital_twin' as const,
  heygenGroupId: 'group-1', heygenLookId: 'look-1', sourcePhotoUrls: [],
  consentConfirmedBy: 'u-1', consentConfirmedAt: '2026-01-01T00:00:00Z', createdBy: 'u-1', createdAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('checkAvatarStatusAction — pending_consent handling', () => {
  it('polls a pending_consent row (not just training ones)', async () => {
    getAvatar.mockResolvedValue({ ...baseAvatar, status: 'pending_consent', consentStatus: 'pending' });
    photoAvatarProvider.getAvatarGroupStatus.mockResolvedValue({ status: 'pending_consent', consentStatus: 'pending' });
    const { checkAvatarStatusAction } = await import('./actions');

    await checkAvatarStatusAction('avatar-1');

    expect(photoAvatarProvider.getAvatarGroupStatus).toHaveBeenCalledWith('group-1');
  });

  it('refreshes consentStatus while still pending_consent, without changing local status', async () => {
    getAvatar.mockResolvedValue({ ...baseAvatar, status: 'pending_consent', consentStatus: 'pending' });
    photoAvatarProvider.getAvatarGroupStatus.mockResolvedValue({ status: 'pending_consent', consentStatus: 'pending' });
    const { checkAvatarStatusAction } = await import('./actions');

    await checkAvatarStatusAction('avatar-1');

    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'pending_consent', { consentStatus: 'pending' });
  });

  it('transitions pending_consent to training once HeyGen reports processing', async () => {
    getAvatar.mockResolvedValue({ ...baseAvatar, status: 'pending_consent', consentStatus: 'pending' });
    photoAvatarProvider.getAvatarGroupStatus.mockResolvedValue({ status: 'processing', consentStatus: 'approved' });
    const { checkAvatarStatusAction } = await import('./actions');

    await checkAvatarStatusAction('avatar-1');

    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'training', { consentStatus: 'approved' });
  });

  it('still transitions training rows straight to ready, unchanged from before', async () => {
    getAvatar.mockResolvedValue({ ...baseAvatar, status: 'training' });
    photoAvatarProvider.getAvatarGroupStatus.mockResolvedValue({ status: 'completed', consentStatus: 'approved' });
    const { checkAvatarStatusAction } = await import('./actions');

    await checkAvatarStatusAction('avatar-1');

    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'ready');
  });

  it('does nothing for a ready avatar', async () => {
    getAvatar.mockResolvedValue({ ...baseAvatar, status: 'ready' });
    const { checkAvatarStatusAction } = await import('./actions');

    await checkAvatarStatusAction('avatar-1');

    expect(photoAvatarProvider.getAvatarGroupStatus).not.toHaveBeenCalled();
  });

  it('marks a pending_consent row failed when HeyGen reports failed', async () => {
    getAvatar.mockResolvedValue({ ...baseAvatar, status: 'pending_consent', consentStatus: 'pending' });
    photoAvatarProvider.getAvatarGroupStatus.mockResolvedValue({ status: 'failed', error: { code: 'x', message: 'bad footage' } });
    const { checkAvatarStatusAction } = await import('./actions');

    await checkAvatarStatusAction('avatar-1');

    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'failed', { errorMessage: 'bad footage' });
  });

  it('does nothing for a training row with no heygenGroupId yet', async () => {
    getAvatar.mockResolvedValue({ ...baseAvatar, status: 'training', heygenGroupId: null });
    const { checkAvatarStatusAction } = await import('./actions');

    await checkAvatarStatusAction('avatar-1');

    expect(photoAvatarProvider.getAvatarGroupStatus).not.toHaveBeenCalled();
  });
});
