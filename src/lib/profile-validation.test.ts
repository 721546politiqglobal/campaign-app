import { describe, it, expect } from 'vitest';
import { validateCandidateProfile, PARTIES } from './profile-validation';

const base = {
  fullName: 'Alex Rivera', preferredName: 'Alex', office: 'State Assembly',
  district: 'District 12', party: 'Democratic', bio: 'Runs for office.',
  tagline: 'For our future', targetAudience: 'Voters', voiceTone: 'conversational',
  googleAlertsRssUrl: '', photoUrl: '',
};

describe('validateCandidateProfile', () => {
  it('accepts a well-formed profile', () => {
    expect(validateCandidateProfile(base)).toEqual({ ok: true });
  });

  it('requires the four core fields', () => {
    const r = validateCandidateProfile({ ...base, fullName: '', office: '  ' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.errors.fullName).toBeTruthy(); expect(r.errors.office).toBeTruthy(); }
  });

  it('rejects a party value outside the allowed set (e.g. "congress")', () => {
    const r = validateCandidateProfile({ ...base, party: 'congress' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.party).toBeTruthy();
  });

  it('allows an empty party', () => {
    expect(validateCandidateProfile({ ...base, party: '' })).toEqual({ ok: true });
  });

  it('rejects a non-http google alerts url', () => {
    const r = validateCandidateProfile({ ...base, googleAlertsRssUrl: 'not a url' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.googleAlertsRssUrl).toBeTruthy();
  });

  it('rejects an invalid voice tone', () => {
    const r = validateCandidateProfile({ ...base, voiceTone: 'sarcastic' });
    expect(r.ok).toBe(false);
  });

  it('rejects a content_locale value outside the supported set', () => {
    const r = validateCandidateProfile({ ...base, contentLocale: 'fr' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.contentLocale).toBeTruthy();
  });

  it('allows an empty/absent content_locale (defaults are handled by the caller)', () => {
    expect(validateCandidateProfile({ ...base, contentLocale: '' })).toEqual({ ok: true });
    expect(validateCandidateProfile(base)).toEqual({ ok: true });
  });

  it('accepts a supported content_locale', () => {
    expect(validateCandidateProfile({ ...base, contentLocale: 'es' })).toEqual({ ok: true });
  });

  it('exposes the allowed party list for the UI', () => {
    expect(PARTIES).toContain('Democratic');
  });
});
