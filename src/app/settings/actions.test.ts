import { describe, it, expect, vi, beforeEach } from 'vitest';

const session: { userId: string; name: string; role: string; campaignId: string; locale: string; exp: number } = {
  userId: 'u-owner', name: 'Owner', role: 'owner', campaignId: 'c-1', locale: 'en', exp: 9_999_999_999,
};

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

vi.mock('@/lib/session', () => ({
  requireSession: vi.fn(() => Promise.resolve(session)),
}));

const upsertCandidateProfile = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock('@/lib/candidate', () => ({ upsertCandidateProfile: (...args: unknown[]) => upsertCandidateProfile(...args) }));

const updateEq = vi.fn((..._args: unknown[]) => Promise.resolve({ data: null, error: null as unknown }));
const updateCampaign = vi.fn((patch: unknown) => ({ eq: (...args: unknown[]) => updateEq(patch, ...args) }));
vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: vi.fn((table: string) => {
      if (table === 'campaigns') return { update: updateCampaign };
      throw new Error(`Unexpected table in test: ${table}`);
    }),
  },
  throwOnError: vi.fn(async (query: Promise<{ data: unknown; error: unknown }>) => {
    const { error } = await query;
    if (error) throw error;
  }),
}));

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID = {
  full_name: 'Jane Doe', preferred_name: 'Jane', office: 'Mayor', district: 'District 4', party: 'Democratic',
  bio: 'Bio', tagline: 'Forward', target_audience: 'Voters', voice_tone: 'conversational', content_locale: 'es',
  key_positions: 'Housing\n\n  Transit  ', opponent_name: 'Bob', opponent_aliases: 'Big Bob, Bobby',
  monitoring_keywords: 'zoning', opponent_twitter_handle: '@bigbob', opponent_instagram_handle: '',
  opponent_facebook_page: '', google_alerts_rss_url: 'https://www.google.com/alerts/feeds/1',
};

const INITIAL = { ok: false };

beforeEach(() => {
  vi.clearAllMocks();
  session.role = 'owner';
  session.locale = 'en';
  upsertCandidateProfile.mockResolvedValue(undefined);
  updateEq.mockResolvedValue({ data: null, error: null });
});

describe('saveProfileAction', () => {
  it('denies roles without edit_settings and echoes the submitted values back', async () => {
    session.role = 'staff';
    const { saveProfileAction } = await import('./actions');
    const result = await saveProfileAction(INITIAL, formData(VALID));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Only campaign owners and managers can change settings.');
    expect(result.values?.full_name).toBe('Jane Doe');
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('returns translated field errors and preserves input on validation failure', async () => {
    const { saveProfileAction } = await import('./actions');
    const result = await saveProfileAction(INITIAL, formData({
      ...VALID, full_name: '   ', party: 'Whig', google_alerts_rss_url: 'not a url', tagline: 'x'.repeat(161),
    }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Fix the highlighted fields and try again.');
    expect(result.fieldErrors).toEqual({
      full_name: 'This field is required.',
      party: 'Choose a party from the list.',
      google_alerts_rss_url: 'Enter a valid http(s) URL.',
      tagline: 'Keep this under 160 characters.',
    });
    // Input survives: the client re-renders exactly what was typed.
    expect(result.values?.party).toBe('Whig');
    expect(result.values?.full_name).toBe('   ');
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects generic monitoring aliases/keywords without saving, naming the offending terms', async () => {
    const { saveProfileAction } = await import('./actions');
    const result = await saveProfileAction(INITIAL, formData({
      ...VALID, opponent_aliases: 'Trump, president, white house', monitoring_keywords: 'Doral zoning, democrats',
    }));
    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.opponent_aliases).toContain('president, white house');
    expect(result.fieldErrors?.opponent_aliases).not.toContain('Trump');
    expect(result.fieldErrors?.monitoring_keywords).toContain('democrats');
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('translates validation messages into the session locale', async () => {
    session.locale = 'es';
    const { saveProfileAction } = await import('./actions');
    const result = await saveProfileAction(INITIAL, formData({ ...VALID, full_name: '' }));
    expect(result.fieldErrors?.full_name).toBe('Este campo es obligatorio.');
  });

  it('saves a valid profile: parses lists, strips the leading @, keeps photoUrl untouched', async () => {
    const { saveProfileAction } = await import('./actions');
    const result = await saveProfileAction(INITIAL, formData(VALID));
    expect(result.ok).toBe(true);
    expect(typeof result.savedAt).toBe('number');
    expect(upsertCandidateProfile).toHaveBeenCalledTimes(1);
    const [campaignId, data] = upsertCandidateProfile.mock.calls[0] as [string, Record<string, unknown>];
    expect(campaignId).toBe('c-1');
    expect(data).toMatchObject({
      fullName: 'Jane Doe', preferredName: 'Jane', party: 'Democratic', contentLocale: 'es',
      keyPositions: ['Housing', 'Transit'],
      opponentAliases: ['Big Bob', 'Bobby'],
      monitoringKeywords: ['zoning'],
      opponentTwitterHandle: 'bigbob',
      opponentInstagramHandle: null,
      googleAlertsRssUrl: 'https://www.google.com/alerts/feeds/1',
    });
    // The settings form has no photo field; a save must not wipe the setup value.
    expect(data).not.toHaveProperty('photoUrl');
    expect(revalidatePath).toHaveBeenCalledWith('/settings');
  });

  it('reports a failed write as a translated error instead of throwing', async () => {
    upsertCandidateProfile.mockRejectedValueOnce(new Error('db down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { saveProfileAction } = await import('./actions');
    const result = await saveProfileAction(INITIAL, formData(VALID));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Could not save your changes. Please try again.');
    expect(result.values?.full_name).toBe('Jane Doe');
    consoleError.mockRestore();
  });
});

describe('saveDisclosureDefaultAction', () => {
  it('denies roles without edit_settings', async () => {
    session.role = 'approver';
    const { saveDisclosureDefaultAction } = await import('./actions');
    const result = await saveDisclosureDefaultAction(INITIAL, formData({ default_disclosure_text: 'x' }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Only campaign owners and managers can change settings.');
    expect(updateCampaign).not.toHaveBeenCalled();
  });

  it("stores the trimmed text on the caller's own campaign", async () => {
    const { saveDisclosureDefaultAction } = await import('./actions');
    const result = await saveDisclosureDefaultAction(INITIAL, formData({ default_disclosure_text: '  Made with AI.  ' }));
    expect(result.ok).toBe(true);
    expect(updateEq).toHaveBeenCalledWith({ default_disclosure_text: 'Made with AI.' }, 'id', 'c-1');
    expect(revalidatePath).toHaveBeenCalledWith('/settings');
  });

  it('stores null when the text is blank (falls back to the generic default)', async () => {
    const { saveDisclosureDefaultAction } = await import('./actions');
    await saveDisclosureDefaultAction(INITIAL, formData({ default_disclosure_text: '   ' }));
    expect(updateEq).toHaveBeenCalledWith({ default_disclosure_text: null }, 'id', 'c-1');
  });

  it('returns a translated error when the write fails', async () => {
    updateEq.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { saveDisclosureDefaultAction } = await import('./actions');
    const result = await saveDisclosureDefaultAction(INITIAL, formData({ default_disclosure_text: 'x' }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Could not save your changes. Please try again.');
    expect(result.values?.default_disclosure_text).toBe('x');
    consoleError.mockRestore();
  });
});
