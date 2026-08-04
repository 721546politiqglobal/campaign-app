import { describe, it, expect, vi, beforeEach } from 'vitest';

const single = vi.fn();
const insert = vi.fn(() => Promise.resolve({ error: null }));
const updateEq = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq: updateEq }));
const from = vi.fn(() => ({
  select: () => ({ eq: () => ({ single }) }),
  insert, update,
}));
vi.mock('./supabase', () => ({ adminDb: { from } }));
vi.mock('./store', () => ({ uid: vi.fn(() => 'cp-1') }));

beforeEach(() => vi.clearAllMocks());

describe('upsertCandidateProfile', () => {
  it('inserts a new snake_cased row (with a generated id) when none exists', async () => {
    single.mockResolvedValue({ data: null });
    const { upsertCandidateProfile } = await import('./candidate');
    await upsertCandidateProfile('c-1', { fullName: 'Jane Doe', elevenLabsVoiceId: 'voice_1' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'cp-1', campaign_id: 'c-1', full_name: 'Jane Doe', elevenlabs_voice_id: 'voice_1',
    }));
    expect(update).not.toHaveBeenCalled();
  });

  it('updates the existing row (no id, no insert) when a profile already exists', async () => {
    single.mockResolvedValue({ data: { id: 'cp-existing', campaign_id: 'c-1', full_name: 'X', preferred_name: 'X', office: 'o', district: 'd' } });
    const { upsertCandidateProfile } = await import('./candidate');
    await upsertCandidateProfile('c-1', { activeAvatarId: 'av-9' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ active_avatar_id: 'av-9' }));
    expect(updateEq).toHaveBeenCalledWith('campaign_id', 'c-1');
    expect(insert).not.toHaveBeenCalled();
  });

  it('getCandidateProfile maps a row back to a camelCase profile with defaults', async () => {
    single.mockResolvedValue({ data: { id: 'cp-1', campaign_id: 'c-1', full_name: 'Jane', preferred_name: 'J', office: 'Senate', district: 'CA', created_at: 't', updated_at: 't' } });
    const { getCandidateProfile } = await import('./candidate');
    const p = await getCandidateProfile('c-1');
    expect(p).toMatchObject({ campaignId: 'c-1', fullName: 'Jane', voiceTone: 'conversational', videoAspectRatio: '16:9' });
  });
});

describe('getCandidateProfile - self-voice-clone mapping', () => {
  it('maps self-voice-clone columns onto the domain type', async () => {
    single.mockResolvedValue({
      data: {
        id: 'profile-1', campaign_id: 'c-1', full_name: 'Alex', preferred_name: 'Alex',
        office: 'Mayor', district: 'D1', party: '', bio: '', key_positions: [],
        voice_tone: 'conversational', target_audience: '', tagline: '',
        opponent_aliases: [], monitoring_keywords: [],
        video_aspect_ratio: '16:9', video_background: 'plain',
        created_at: '2026-01-01', updated_at: '2026-01-01',
        self_voice_clone_id: 'voice-clone-1',
        self_voice_name: 'My voice',
        self_voice_clone_status: 'ready',
        self_voice_clone_error: null,
        self_voice_consent_confirmed_by: 'u-1',
        self_voice_consent_confirmed_at: '2026-08-02T00:00:00.000Z',
      },
    });
    const { getCandidateProfile } = await import('./candidate');

    const profile = await getCandidateProfile('c-1');

    expect(profile).toMatchObject({
      selfVoiceCloneId: 'voice-clone-1',
      selfVoiceName: 'My voice',
      selfVoiceCloneStatus: 'ready',
      selfVoiceCloneError: null,
      selfVoiceConsentConfirmedBy: 'u-1',
      selfVoiceConsentConfirmedAt: '2026-08-02T00:00:00.000Z',
    });
  });
});

describe('upsertCandidateProfile - self-voice-clone mapping', () => {
  it('writes self-voice-clone fields to their snake_case columns on update', async () => {
    single.mockResolvedValue({ data: { id: 'profile-1', campaign_id: 'c-1' } });
    const { upsertCandidateProfile } = await import('./candidate');

    await upsertCandidateProfile('c-1', {
      selfVoiceCloneId: 'voice-clone-2',
      selfVoiceName: 'New voice',
      selfVoiceCloneStatus: 'training',
      selfVoiceCloneError: null,
      selfVoiceConsentConfirmedBy: 'u-2',
      selfVoiceConsentConfirmedAt: '2026-08-02T01:00:00.000Z',
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      self_voice_clone_id: 'voice-clone-2',
      self_voice_name: 'New voice',
      self_voice_clone_status: 'training',
      self_voice_clone_error: null,
      self_voice_consent_confirmed_by: 'u-2',
      self_voice_consent_confirmed_at: '2026-08-02T01:00:00.000Z',
    }));
  });
});
