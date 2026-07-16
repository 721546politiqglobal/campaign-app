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
