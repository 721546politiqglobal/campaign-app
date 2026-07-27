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

const billingGate = { check: vi.fn(() => Promise.resolve()) };
const quotaGate = { checkAndIncrement: vi.fn(() => Promise.resolve()), checkAvatarCap: vi.fn(() => Promise.resolve()) };
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

function makeVideoForm(overrides: Partial<{ consent: string; name: string; video: File }> = {}): FormData {
  const fd = new FormData();
  fd.set('consent', overrides.consent ?? 'on');
  fd.set('name', overrides.name ?? 'Candidate twin');
  fd.set('video', overrides.video ?? new File([new Uint8Array([1, 2, 3])], 'training.mp4', { type: 'video/mp4' }));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  billingGate.check.mockResolvedValue(undefined);
  quotaGate.checkAndIncrement.mockResolvedValue(undefined);
  quotaGate.checkAvatarCap.mockResolvedValue(undefined);
});

describe('createVideoAvatarAction', () => {
  it('requires the consent checkbox', async () => {
    const { createVideoAvatarAction } = await import('./actions');
    const result = await createVideoAvatarAction(makeVideoForm({ consent: 'off' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/consent/i);
    expect(photoAvatarProvider.uploadAsset).not.toHaveBeenCalled();
  });

  it('rejects a non-video file', async () => {
    const { createVideoAvatarAction } = await import('./actions');
    const badFile = new File([new Uint8Array([1])], 'photo.jpg', { type: 'image/jpeg' });
    const result = await createVideoAvatarAction(makeVideoForm({ video: badFile }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/video/i);
  });

  it('rejects a video file with an unsupported container (e.g. webm)', async () => {
    const { createVideoAvatarAction } = await import('./actions');
    const webmFile = new File([new Uint8Array([1])], 'clip.webm', { type: 'video/webm' });
    const result = await createVideoAvatarAction(makeVideoForm({ video: webmFile }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/mp4|quicktime/i);
  });

  it('checks the avatar cap before calling HeyGen, and never calls HeyGen if the cap is exceeded', async () => {
    quotaGate.checkAvatarCap.mockRejectedValue(new QuotaExceeded('avatar', 'Your plan includes up to 1 avatars. Delete one or upgrade your plan to create another.'));
    const { createVideoAvatarAction } = await import('./actions');

    const result = await createVideoAvatarAction(makeVideoForm());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/avatars/);
    expect(photoAvatarProvider.uploadAsset).not.toHaveBeenCalled();
  });

  it('on success, persists the row as pending_consent with the consent url/status', async () => {
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.createVideoAvatar.mockResolvedValue({ lookId: 'look-1', groupId: 'group-1' });
    photoAvatarProvider.requestConsent.mockResolvedValue({ consentUrl: 'https://app.heygen.com/consent/abc', consentStatus: 'pending' });
    const { createVideoAvatarAction } = await import('./actions');

    const result = await createVideoAvatarAction(makeVideoForm());

    expect(result.ok).toBe(true);
    expect(insertAvatar).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'digital_twin', status: 'training' }));
    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'pending_consent', {
      heygenGroupId: 'group-1', heygenLookId: 'look-1', consentUrl: 'https://app.heygen.com/consent/abc', consentStatus: 'pending',
    });
    expect(quotaGate.checkAvatarCap).toHaveBeenCalledWith('c-1', null);
  });

  it('marks the row failed (never silently dropped) when consent request fails after avatar creation', async () => {
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.createVideoAvatar.mockResolvedValue({ lookId: 'look-1', groupId: 'group-1' });
    photoAvatarProvider.requestConsent.mockRejectedValue(new Error('HeyGen consent request error: 500'));
    const { createVideoAvatarAction } = await import('./actions');

    const result = await createVideoAvatarAction(makeVideoForm());

    expect(result.ok).toBe(false);
    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'failed', expect.objectContaining({ errorMessage: expect.stringMatching(/consent/i) }));
  });

  it('shows a clear access-denied message (not a generic one) when this HeyGen account lacks Digital Twin access', async () => {
    const { HeyGenAccessDeniedError } = await import('@/integrations');
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.createVideoAvatar.mockRejectedValue(new HeyGenAccessDeniedError('digital twin not enabled for this account'));
    const { createVideoAvatarAction } = await import('./actions');

    const result = await createVideoAvatarAction(makeVideoForm());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/aren't enabled.*Digital Twin/i);
    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'failed', expect.objectContaining({ errorMessage: expect.stringMatching(/aren't enabled.*Digital Twin/i) }));
  });
});
