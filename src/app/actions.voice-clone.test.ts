import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuotaExceeded } from '@/domain/quota';
import { BillingBlocked } from '@/domain/billing';

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

vi.mock('@/lib/supabase', () => {
  // Memoized per-bucket, not recreated on every call, so a test can assert on
  // `adminDb.storage.from('media').someMethod` and see calls made from
  // anywhere inside the action under test (a fresh object per call would give
  // each call site its own disconnected set of mock fns).
  const buckets: Record<string, ReturnType<typeof makeBucket>> = {};
  function makeBucket() {
    return {
      createSignedUploadUrl: vi.fn((path: string) => Promise.resolve({ data: { path, token: `token-${path}` }, error: null })),
      download: vi.fn(() => Promise.resolve({
        data: { arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer), type: 'audio/mpeg' },
        error: null,
      })),
      getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://media.test/${path}` } })),
      remove: vi.fn(() => Promise.resolve({ data: null, error: null })),
    };
  }
  return {
    adminDb: {
      from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() })),
      storage: {
        from: vi.fn((bucket: string) => (buckets[bucket] ??= makeBucket())),
      },
    },
  };
});

vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'voice-attempt-1') }));

const getCandidateProfile = vi.fn();
const upsertCandidateProfile = vi.fn(() => Promise.resolve());
vi.mock('@/lib/candidate', () => ({ getCandidateProfile, upsertCandidateProfile }));

const billingGate = { check: vi.fn(() => Promise.resolve()) };
const photoAvatarProvider = {
  uploadAsset: vi.fn(),
  cloneVoice: vi.fn(),
  getVoiceCloneStatus: vi.fn(),
  deleteVoiceClone: vi.fn(),
  synthesizeSpeech: vi.fn(),
};
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: {}, voiceProvider: {},
  billingGate, quotaGate: { checkAndIncrement: vi.fn(), checkAvatarCap: vi.fn(), release: vi.fn() },
  photoAvatarProvider,
}));

vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));
vi.mock('@/lib/avatars', () => ({ insertAvatar: vi.fn(), updateAvatarStatus: vi.fn(), getAvatar: vi.fn() }));

function audioMeta(overrides: Partial<{ name: string; type: string; size: number }> = {}) {
  return { name: 'sample.mp3', type: 'audio/mpeg', size: 1024, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  billingGate.check.mockResolvedValue(undefined);
  getCandidateProfile.mockResolvedValue(null);
});

describe('beginVoiceCloneUploadAction', () => {
  it('denies a role without manage_avatars', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const { requireSession } = await import('@/lib/session');
    vi.mocked(requireSession).mockResolvedValueOnce({ ...session, role: 'staff' as const });

    const result = await beginVoiceCloneUploadAction(true, audioMeta());

    expect(result.ok).toBe(false);
  });

  it('requires the consent checkbox', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const result = await beginVoiceCloneUploadAction(false, audioMeta());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/consent/i);
  });

  it('rejects a non-audio file', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const result = await beginVoiceCloneUploadAction(true, audioMeta({ name: 'photo.jpg', type: 'image/jpeg' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/audio/i);
  });

  it('rejects a file over the size cap', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const result = await beginVoiceCloneUploadAction(true, audioMeta({ size: 51 * 1024 * 1024 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/50 ?MB/i);
  });

  it('checks billingGate before touching storage', async () => {
    billingGate.check.mockRejectedValue(new BillingBlocked('Billing is past due.'));
    const { beginVoiceCloneUploadAction } = await import('./actions');

    const result = await beginVoiceCloneUploadAction(true, audioMeta());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/billing/i);
  });

  it('on success, returns a signed upload path/token', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const result = await beginVoiceCloneUploadAction(true, audioMeta());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toMatch(/^voices\/c-1\/voice-attempt-1\/sample\.mp3$/);
      expect(result.token).toBeTruthy();
    }
  });

  it('accepts a browser-recorded webm file with a codec suffix', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const result = await beginVoiceCloneUploadAction(true, audioMeta({ name: 'recording.webm', type: 'audio/webm;codecs=opus' }));
    expect(result.ok).toBe(true);
  });

  it('accepts a Firefox-recorded ogg file with a codec suffix', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const result = await beginVoiceCloneUploadAction(true, audioMeta({ name: 'recording.ogg', type: 'audio/ogg;codecs=opus' }));
    expect(result.ok).toBe(true);
  });

  it('still rejects a non-audio type after the prefix-match change', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const result = await beginVoiceCloneUploadAction(true, audioMeta({ name: 'photo.jpg', type: 'image/jpeg' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/audio/i);
  });
});

describe('finalizeVoiceCloneAction', () => {
  it('on success with no prior clone, does not call deleteVoiceClone and persists status training', async () => {
    // First call is the pre-clone existingProfile check; second is the
    // post-write verification read that confirms the upsert actually stuck.
    getCandidateProfile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ selfVoiceCloneId: 'clone-1' });
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.cloneVoice.mockResolvedValue({ voiceCloneId: 'clone-1' });
    const { finalizeVoiceCloneAction } = await import('./actions');

    const result = await finalizeVoiceCloneAction('My voice', 'voices/c-1/voice-attempt-1/sample.mp3');

    expect(result.ok).toBe(true);
    expect(photoAvatarProvider.deleteVoiceClone).not.toHaveBeenCalled();
    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', expect.objectContaining({
      selfVoiceCloneId: 'clone-1', selfVoiceName: 'My voice', selfVoiceCloneStatus: 'training',
      selfVoiceConsentConfirmedBy: 'u-1',
    }));
  });

  it('deletes the previous self-clone before creating a new one', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneId: 'old-clone', selfVoiceCloneStatus: 'ready' });
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-2' });
    photoAvatarProvider.cloneVoice.mockResolvedValue({ voiceCloneId: 'new-clone' });
    const { finalizeVoiceCloneAction } = await import('./actions');

    await finalizeVoiceCloneAction('Replacement voice', 'voices/c-1/voice-attempt-1/sample.mp3');

    expect(photoAvatarProvider.deleteVoiceClone).toHaveBeenCalledWith('old-clone');
    expect(photoAvatarProvider.deleteVoiceClone.mock.invocationCallOrder[0])
      .toBeLessThan(photoAvatarProvider.cloneVoice.mock.invocationCallOrder[0]);
  });

  it('proceeds with the new clone even if deleting the old one fails', async () => {
    getCandidateProfile
      .mockResolvedValueOnce({ selfVoiceCloneId: 'old-clone', selfVoiceCloneStatus: 'ready' })
      .mockResolvedValueOnce({ selfVoiceCloneId: 'new-clone', selfVoiceCloneStatus: 'training' });
    photoAvatarProvider.deleteVoiceClone.mockRejectedValue(new Error('HeyGen delete voice error: 500'));
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-2' });
    photoAvatarProvider.cloneVoice.mockResolvedValue({ voiceCloneId: 'new-clone' });
    const { finalizeVoiceCloneAction } = await import('./actions');

    const result = await finalizeVoiceCloneAction('Replacement voice', 'voices/c-1/voice-attempt-1/sample.mp3');

    expect(result.ok).toBe(true);
    expect(photoAvatarProvider.cloneVoice).toHaveBeenCalled();
  });

  it('marks status failed (never silently dropped) when cloneVoice throws', async () => {
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.cloneVoice.mockRejectedValue(new Error('HeyGen clone voice error: clone limit reached'));
    const { finalizeVoiceCloneAction } = await import('./actions');

    const result = await finalizeVoiceCloneAction('My voice', 'voices/c-1/voice-attempt-1/sample.mp3');

    expect(result.ok).toBe(false);
    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', expect.objectContaining({
      selfVoiceCloneStatus: 'failed',
      selfVoiceCloneError: expect.stringMatching(/clone limit reached/),
    }));
  });

  it('surfaces a distinct capacity message when HeyGen reports the platform-wide clone limit', async () => {
    const { HeyGenVoiceCloneLimitError } = await import('@/integrations');
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.cloneVoice.mockRejectedValue(new HeyGenVoiceCloneLimitError('HeyGen clone voice error: voice clone limit reached'));
    const { finalizeVoiceCloneAction } = await import('./actions');

    const result = await finalizeVoiceCloneAction('My voice', 'voices/c-1/voice-attempt-1/sample.mp3');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Voice cloning is temporarily at capacity across the platform — contact support.');
    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', expect.objectContaining({
      selfVoiceCloneStatus: 'failed',
      selfVoiceCloneError: 'Voice cloning is temporarily at capacity across the platform — contact support.',
    }));
  });

  it('deletes the uploaded sample from storage after a successful clone', async () => {
    getCandidateProfile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ selfVoiceCloneId: 'clone-1' });
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.cloneVoice.mockResolvedValue({ voiceCloneId: 'clone-1' });
    const { finalizeVoiceCloneAction } = await import('./actions');
    const { adminDb } = await import('@/lib/supabase');

    const result = await finalizeVoiceCloneAction('My voice', 'voices/c-1/voice-attempt-1/sample.mp3');

    expect(result.ok).toBe(true);
    expect(adminDb.storage.from('media').remove).toHaveBeenCalledWith(['voices/c-1/voice-attempt-1/sample.mp3']);
  });

  it('returns ok:false when the profile write silently fails to persist the new clone id', async () => {
    // Simulates upsertCandidateProfile's known silent-failure mode (shared
    // helper used by many other flows, out of scope to change here): the
    // write call resolves without throwing, but a post-write read shows the
    // new clone id never actually landed.
    getCandidateProfile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ selfVoiceCloneId: null });
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.cloneVoice.mockResolvedValue({ voiceCloneId: 'clone-1' });
    const { finalizeVoiceCloneAction } = await import('./actions');

    const result = await finalizeVoiceCloneAction('My voice', 'voices/c-1/voice-attempt-1/sample.mp3');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/try again/i);
  });

  it('rejects a path outside this campaign/attempt prefix', async () => {
    const { finalizeVoiceCloneAction } = await import('./actions');
    const result = await finalizeVoiceCloneAction('My voice', 'voices/other-campaign/x/sample.mp3');
    expect(result.ok).toBe(false);
    expect(photoAvatarProvider.uploadAsset).not.toHaveBeenCalled();
  });
});

describe('checkVoiceCloneStatusAction', () => {
  it('no-ops when there is no clone in training', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'ready', selfVoiceCloneId: 'clone-1' });
    const { checkVoiceCloneStatusAction } = await import('./actions');

    const result = await checkVoiceCloneStatusAction();

    expect(result.ok).toBe(true);
    expect(photoAvatarProvider.getVoiceCloneStatus).not.toHaveBeenCalled();
  });

  it('updates status to ready when HeyGen reports ready', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'training', selfVoiceCloneId: 'clone-1' });
    photoAvatarProvider.getVoiceCloneStatus.mockResolvedValue({ status: 'ready' });
    const { checkVoiceCloneStatusAction } = await import('./actions');

    await checkVoiceCloneStatusAction();

    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', { selfVoiceCloneStatus: 'ready' });
  });

  it('updates status to failed when HeyGen reports failed', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'training', selfVoiceCloneId: 'clone-1' });
    photoAvatarProvider.getVoiceCloneStatus.mockResolvedValue({ status: 'failed' });
    const { checkVoiceCloneStatusAction } = await import('./actions');

    await checkVoiceCloneStatusAction();

    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', {
      selfVoiceCloneStatus: 'failed',
      selfVoiceCloneError: 'HeyGen reported the voice clone failed.',
    });
  });
});

describe('previewVoiceCloneAction', () => {
  it('denies a role without manage_avatars', async () => {
    const { requireSession } = await import('@/lib/session');
    vi.mocked(requireSession).mockResolvedValueOnce({ userId: 'u-1', name: 'Staff', role: 'staff' as const, campaignId: 'c-1', exp: 9_999_999_999 });
    const { previewVoiceCloneAction } = await import('./actions');

    const result = await previewVoiceCloneAction();

    expect(result.ok).toBe(false);
    expect(photoAvatarProvider.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it('rejects when there is no candidate profile at all', async () => {
    getCandidateProfile.mockResolvedValue(null);
    const { previewVoiceCloneAction } = await import('./actions');

    const result = await previewVoiceCloneAction();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no cloned voice/i);
  });

  it('never persists anything — the preview is stateless', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'ready', selfVoiceCloneId: 'clone-1' });
    photoAvatarProvider.synthesizeSpeech.mockResolvedValue({ audioUrl: 'https://heygen.test/preview.mp3' });
    const { previewVoiceCloneAction } = await import('./actions');

    await previewVoiceCloneAction();

    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('rejects when there is no ready self-clone', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'training', selfVoiceCloneId: 'clone-1' });
    const { previewVoiceCloneAction } = await import('./actions');

    const result = await previewVoiceCloneAction();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no cloned voice/i);
    expect(photoAvatarProvider.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it('checks billingGate before calling the provider', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'ready', selfVoiceCloneId: 'clone-1' });
    billingGate.check.mockRejectedValue(new BillingBlocked('Billing is past due.'));
    const { previewVoiceCloneAction } = await import('./actions');

    const result = await previewVoiceCloneAction();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/billing/i);
    expect(photoAvatarProvider.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it('on success, returns the audio URL using the fixed preview text and the self-clone voice id', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'ready', selfVoiceCloneId: 'clone-1' });
    photoAvatarProvider.synthesizeSpeech.mockResolvedValue({ audioUrl: 'https://heygen.test/preview.mp3' });
    const { previewVoiceCloneAction } = await import('./actions');

    const result = await previewVoiceCloneAction();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.audioUrl).toBe('https://heygen.test/preview.mp3');
    expect(photoAvatarProvider.synthesizeSpeech).toHaveBeenCalledWith({
      voiceId: 'clone-1',
      text: 'Hello, this is a preview of your cloned voice.',
    });
  });

  it('surfaces the provider error on failure', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'ready', selfVoiceCloneId: 'clone-1' });
    photoAvatarProvider.synthesizeSpeech.mockRejectedValue(new Error('HeyGen synthesize speech error: invalid voice_id'));
    const { previewVoiceCloneAction } = await import('./actions');

    const result = await previewVoiceCloneAction();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid voice_id/);
  });
});
