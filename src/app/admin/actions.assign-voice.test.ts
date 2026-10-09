import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ userId: 'sa-1', role: 'super_admin', campaignId: null, locale: 'en' })) }));

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
    const r = await assignVoiceAction(fd());
    expect(r).toEqual({ ok: true });
    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', { heygenVoiceId: 'voice-abc123' });
  });

  it('reports a missing campaignId', async () => {
    getCandidateProfile.mockResolvedValue({ campaignId: 'c-1' });
    const { assignVoiceAction } = await import('./actions');
    const r = await assignVoiceAction(fd({ campaignId: '' }));
    expect(r.ok).toBe(false);
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('reports a blank heygen_voice_id', async () => {
    getCandidateProfile.mockResolvedValue({ campaignId: 'c-1' });
    const { assignVoiceAction } = await import('./actions');
    const r = await assignVoiceAction(fd({ heygen_voice_id: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/voice ID/i);
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('refuses without consent', async () => {
    getCandidateProfile.mockResolvedValue({ campaignId: 'c-1' });
    const { assignVoiceAction } = await import('./actions');
    const r = await assignVoiceAction(fd({ consent: 'off' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/consent/i);
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('explains when no candidate profile exists yet instead of silently doing nothing', async () => {
    getCandidateProfile.mockResolvedValue(null);
    const { assignVoiceAction } = await import('./actions');
    const r = await assignVoiceAction(fd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/setup/i);
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });
});
