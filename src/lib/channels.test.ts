import { describe, it, expect, vi, beforeEach } from 'vitest';

const single = vi.fn();
const updateSelect = vi.fn();
const calls: { payload?: unknown; filters: unknown[][] }[] = [];

vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: () => ({
      select: () => ({ eq: () => ({ single }) }),
      update: (payload: unknown) => {
        const call = { payload, filters: [] as unknown[][] };
        calls.push(call);
        const chain: any = {
          eq: (...a: unknown[]) => { call.filters.push(['eq', ...a]); return chain; },
          is: (...a: unknown[]) => { call.filters.push(['is', ...a]); return chain; },
          like: (...a: unknown[]) => { call.filters.push(['like', ...a]); return chain; },
          select: () => updateSelect(),
          then: (r: (v: unknown) => void) => r({ error: null }),
        };
        return chain;
      },
    }),
  },
  throwOnError: async (q: any) => { const { data, error } = await q; if (error) throw new Error(error.message); return data; },
}));

beforeEach(() => { vi.clearAllMocks(); calls.length = 0; });

describe('getCampaignSocialProfile', () => {
  it('maps the row and drops malformed snapshot entries', async () => {
    single.mockResolvedValue({ data: {
      ayrshare_profile_key: 'pk', social_synced_at: '2026-10-08T00:00:00Z',
      social_accounts: [{ platform: 'instagram', name: 'A', handle: '@a', profileUrl: null, avatarUrl: null, refreshRequired: false }, { platform: 'pinterest' }, null],
    }, error: null });
    const { getCampaignSocialProfile } = await import('./channels');
    const p = await getCampaignSocialProfile('c-1');
    expect(p.profileKey).toBe('pk');
    expect(p.accounts.map(a => a.platform)).toEqual(['instagram']);
  });

  it('returns an empty profile when the campaign row is missing', async () => {
    single.mockResolvedValue({ data: null, error: null });
    const { getCampaignSocialProfile } = await import('./channels');
    expect(await getCampaignSocialProfile('nope')).toEqual({ profileKey: null, accounts: [], syncedAt: null });
  });
});

describe('getCampaignSocialProfile errors', () => {
  it('rejects on a real DB error instead of reading it as no profile key', async () => {
    single.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } });
    const { getCampaignSocialProfile } = await import('./channels');
    await expect(getCampaignSocialProfile('c-1')).rejects.toThrow(/boom/);
  });
});

describe('saveProfileKeyIfAbsent', () => {
  // Two simultaneous Connect clicks must not both store a key — the loser
  // learns it lost and re-reads the winner's (Review Focus #1).
  it('only writes when no key is stored yet, and reports whether it won', async () => {
    updateSelect.mockResolvedValueOnce({ data: [{ id: 'c-1' }], error: null });
    const { saveProfileKeyIfAbsent } = await import('./channels');
    expect(await saveProfileKeyIfAbsent('c-1', { profileKey: 'pk', refId: 'r' })).toBe(true);
    expect(calls[0].filters).toContainEqual(['is', 'ayrshare_profile_key', null]);

    updateSelect.mockResolvedValueOnce({ data: [], error: null });
    expect(await saveProfileKeyIfAbsent('c-1', { profileKey: 'pk2', refId: 'r2' })).toBe(false);
  });
});

describe('replaceMockProfileKey', () => {
  // Only a still-mock key may be overwritten; a real key stored by a concurrent
  // click must survive.
  it('updates only rows whose key is still a mock key, and reports whether it did', async () => {
    updateSelect.mockResolvedValueOnce({ data: [{ id: 'c-1' }], error: null });
    const { replaceMockProfileKey } = await import('./channels');
    expect(await replaceMockProfileKey('c-1', { profileKey: 'pk-real', refId: 'r' })).toBe(true);
    expect(calls[0].payload).toEqual({ ayrshare_profile_key: 'pk-real', ayrshare_ref_id: 'r' });
    expect(calls[0].filters).toContainEqual(['eq', 'id', 'c-1']);
    expect(calls[0].filters).toContainEqual(['like', 'ayrshare_profile_key', 'mock-%']);

    updateSelect.mockResolvedValueOnce({ data: [], error: null });
    expect(await replaceMockProfileKey('c-1', { profileKey: 'pk-real2', refId: 'r2' })).toBe(false);
  });
});

