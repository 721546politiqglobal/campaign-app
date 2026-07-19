import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ userId: 'sa-1', role: 'super_admin', campaignId: null })) }));

const getCandidateProfile = vi.fn();
const upsertCandidateProfile = vi.fn(() => Promise.resolve());
vi.mock('@/lib/candidate', () => ({ getCandidateProfile, upsertCandidateProfile }));

function fd(over: Record<string, string> = {}) {
  const f = new FormData();
  f.set('campaignId', 'c-1');
  f.set('heygen_voice_id', 'voice-abc123');
  f.set('consent', 'on');
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

describe('assignVoiceAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('assigns the voice when a candidate profile already exists and consent is given', async () => {
    getCandidateProfile.mockResolvedValue({ campaignId: 'c-1', fullName: 'Cand' });
    const { assignVoiceAction } = await import('./actions');
    await assignVoiceAction(fd());
    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', { heygenVoiceId: 'voice-abc123' });
  });

  it('does nothing when campaignId is blank', async () => {
    getCandidateProfile.mockResolvedValue({ campaignId: 'c-1' });
    const { assignVoiceAction } = await import('./actions');
    await assignVoiceAction(fd({ campaignId: '' }));
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('does nothing when heygen_voice_id is blank', async () => {
    getCandidateProfile.mockResolvedValue({ campaignId: 'c-1' });
    const { assignVoiceAction } = await import('./actions');
    await assignVoiceAction(fd({ heygen_voice_id: '' }));
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('does nothing when consent is not given', async () => {
    getCandidateProfile.mockResolvedValue({ campaignId: 'c-1' });
    const { assignVoiceAction } = await import('./actions');
    await assignVoiceAction(fd({ consent: 'off' }));
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('does nothing when no candidate profile exists yet for the campaign', async () => {
    getCandidateProfile.mockResolvedValue(null);
    const { assignVoiceAction } = await import('./actions');
    await assignVoiceAction(fd());
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });
});
