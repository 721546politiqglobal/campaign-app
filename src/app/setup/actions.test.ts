import { describe, it, expect, vi, beforeEach } from 'vitest';
import en from '@/messages/en.json';
import { INITIAL_FORM_STATE } from '@/lib/form-state';

const session = { userId: 'u-1', name: 'Owner', role: 'owner', campaignId: 'c-1', locale: 'en', exp: 9_999_999_999 };
const requireSession = vi.fn(async () => session as any);
vi.mock('@/lib/session', () => ({ requireSession }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));

const getCandidateProfile = vi.fn(async (): Promise<unknown> => null);
const upsertCandidateProfile = vi.fn(async () => undefined);
vi.mock('@/lib/candidate', () => ({ getCandidateProfile, upsertCandidateProfile }));

function form(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const base: Record<string, string> = {
    full_name: 'Maria Rivera', preferred_name: 'Maria', office: 'State Assembly', district: 'District 12',
    party: 'Democratic', opponent_name: '', photo_url: '', bio: 'Advocate.', tagline: 'A voice',
    target_audience: 'Families', key_positions: 'Healthcare\n\n  Housing  \n', voice_tone: 'conversational',
  };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) fd.set(k, v);
  return fd;
}

async function run(fd = form()) {
  const { upsertProfileAction } = await import('./actions');
  return upsertProfileAction(INITIAL_FORM_STATE, fd);
}

const E = en.setup.errors;

describe('upsertProfileAction (useFormState)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSession.mockResolvedValue(session as any);
    getCandidateProfile.mockResolvedValue(null);
    upsertCandidateProfile.mockResolvedValue(undefined);
  });

  it('returns translated field errors and the typed values when required fields are missing', async () => {
    const result = await run(form({ full_name: '', district: '  ' }));
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toEqual({ full_name: E.required, district: E.required });
    expect(result.values).toMatchObject({ preferred_name: 'Maria', office: 'State Assembly', party: 'Democratic', voice_tone: 'conversational' });
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('rejects a party outside the list on the party field', async () => {
    const result = await run(form({ party: 'congress' }));
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toEqual({ party: E.party });
    expect(result.values?.party).toBe('congress');
  });

  it('reports a too-long bio with the real limit', async () => {
    const result = await run(form({ bio: 'x'.repeat(601) }));
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toEqual({ bio: E.tooLong.replace('{max}', '600') });
  });

  it('reports an invalid photo URL', async () => {
    const result = await run(form({ photo_url: 'not a url' }));
    expect(result.fieldErrors).toEqual({ photo_url: E.url });
  });

  it('saves the profile (trimmed positions, null optionals) and redirects to the dashboard', async () => {
    await expect(run()).rejects.toThrow(/REDIRECT:\/dashboard/);
    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', expect.objectContaining({
      fullName: 'Maria Rivera', party: 'Democratic', keyPositions: ['Healthcare', 'Housing'],
      voiceTone: 'conversational', photoUrl: null, opponentName: null,
    }));
  });

  it('refuses to overwrite an existing profile for a role without edit_settings', async () => {
    getCandidateProfile.mockResolvedValue({ id: 'p-1' });
    requireSession.mockResolvedValue({ ...session, role: 'staff' } as any);
    await expect(run()).rejects.toThrow(/REDIRECT:\/dashboard/);
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('returns a translated generic error (not the raw DB message) when saving fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    upsertCandidateProfile.mockRejectedValue(new Error('duplicate key value violates unique constraint'));
    const result = await run();
    expect(result).toMatchObject({ ok: false, error: E.generic });
    expect(result.error).not.toContain('duplicate key');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
