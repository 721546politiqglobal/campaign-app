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
          data: { arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer), type: 'video/mp4' },
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

const billingGate = { check: vi.fn(() => Promise.resolve()) };
const quotaGate = { checkAndIncrement: vi.fn(() => Promise.resolve()), checkAvatarCap: vi.fn(() => Promise.resolve()), release: vi.fn(() => Promise.resolve()) };
const photoAvatarProvider = {
  uploadAsset: vi.fn(),
  createAvatarLook: vi.fn(),
  createPromptLook: vi.fn(),
  createVideoAvatar: vi.fn(),
  requestConsent: vi.fn(),
  getAvatarGroupStatus: vi.fn(),
};
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: {}, voiceProvider: {},
  billingGate, quotaGate, photoAvatarProvider,
}));

vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));

function videoMeta(overrides: Partial<{ name: string; type: string; size: number }> = {}) {
  return { name: 'training.mp4', type: 'video/mp4', size: 3, ...overrides };
}

// Mirrors what AvatarManager does: begin (validation + quota/billing +
// signed upload URL) then finalize (download from storage + HeyGen calls).
async function createVideoAvatar(overrides: {
  consent?: boolean;
  name?: string;
  video?: { name: string; type: string; size: number };
} = {}) {
  const { beginVideoAvatarUploadAction, finalizeVideoAvatarAction } = await import('./actions');
  const begin = await beginVideoAvatarUploadAction(overrides.consent ?? true, overrides.video ?? videoMeta());
  if (!begin.ok) return begin;
  return finalizeVideoAvatarAction(begin.avatarId!, overrides.name ?? 'Candidate twin', begin.path!);
}

beforeEach(() => {
  vi.clearAllMocks();
  billingGate.check.mockResolvedValue(undefined);
  quotaGate.checkAndIncrement.mockResolvedValue(undefined);
  quotaGate.checkAvatarCap.mockResolvedValue(undefined);
});

describe('beginVideoAvatarUploadAction', () => {
  it('requires the consent checkbox', async () => {
    const { beginVideoAvatarUploadAction } = await import('./actions');
    const result = await beginVideoAvatarUploadAction(false, videoMeta());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/consent/i);
    expect(photoAvatarProvider.uploadAsset).not.toHaveBeenCalled();
  });

  it('rejects a non-video file', async () => {
    const { beginVideoAvatarUploadAction } = await import('./actions');
    const result = await beginVideoAvatarUploadAction(true, videoMeta({ name: 'photo.jpg', type: 'image/jpeg' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/video/i);
  });

  it('rejects a video file with an unsupported container (e.g. webm)', async () => {
    const { beginVideoAvatarUploadAction } = await import('./actions');
    const result = await beginVideoAvatarUploadAction(true, videoMeta({ name: 'clip.webm', type: 'video/webm' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/mp4|quicktime/i);
  });

  it('checks the avatar cap before ever touching storage or HeyGen', async () => {
    quotaGate.checkAvatarCap.mockRejectedValue(new QuotaExceeded('avatar', 'Your plan includes up to 1 avatars. Delete one or upgrade your plan to create another.'));
    const { beginVideoAvatarUploadAction } = await import('./actions');

    const result = await beginVideoAvatarUploadAction(true, videoMeta());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/avatars/);
    expect(photoAvatarProvider.uploadAsset).not.toHaveBeenCalled();
  });

  it('checks the avatar cap with the plan limit', async () => {
    const { beginVideoAvatarUploadAction } = await import('./actions');
    await beginVideoAvatarUploadAction(true, videoMeta());
    expect(quotaGate.checkAvatarCap).toHaveBeenCalledWith('c-1', null);
  });
});

describe('finalizeVideoAvatarAction', () => {
  it('on success, persists the row as pending_consent with the consent url/status', async () => {
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.createVideoAvatar.mockResolvedValue({ lookId: 'look-1', groupId: 'group-1' });
    photoAvatarProvider.requestConsent.mockResolvedValue({ consentUrl: 'https://app.heygen.com/consent/abc', consentStatus: 'pending' });

    const result = await createVideoAvatar();

    expect(result.ok).toBe(true);
    expect(insertAvatar).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'digital_twin', status: 'training' }));
    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'pending_consent', {
      heygenGroupId: 'group-1', heygenLookId: 'look-1', consentUrl: 'https://app.heygen.com/consent/abc', consentStatus: 'pending',
    });
  });

  it('marks the row failed (never silently dropped) when consent request fails after avatar creation', async () => {
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.createVideoAvatar.mockResolvedValue({ lookId: 'look-1', groupId: 'group-1' });
    photoAvatarProvider.requestConsent.mockRejectedValue(new Error('HeyGen consent request error: 500'));

    const result = await createVideoAvatar();

    expect(result.ok).toBe(false);
    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'failed', expect.objectContaining({ errorMessage: expect.stringMatching(/consent/i) }));
  });

  it('shows a clear access-denied message (not a generic one) when this HeyGen account lacks Digital Twin access', async () => {
    const { HeyGenAccessDeniedError } = await import('@/integrations');
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.createVideoAvatar.mockRejectedValue(new HeyGenAccessDeniedError('digital twin not enabled for this account'));

    const result = await createVideoAvatar();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/aren't enabled.*Digital Twin/i);
    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'failed', expect.objectContaining({ errorMessage: expect.stringMatching(/aren't enabled.*Digital Twin/i) }));
  });
});
