import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let session = { userId: 'u-1', name: 'Owner', role: 'owner' as string, campaignId: 'c-1', locale: 'en', exp: 9_999_999_999 };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session) }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', name: 'Rivera for Senate' })) }));
const auditInsert = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: () => ({ insert: auditInsert }) } }));

const profile = { profileKey: null as string | null, accounts: [] as any[], syncedAt: null };
const getCampaignSocialProfile = vi.fn(async () => ({ ...profile }));
const saveProfileKeyIfAbsent = vi.fn(async () => true);
const saveSocialAccounts = vi.fn(async (_c: string, _a: any[]) => {});
const replaceMockProfileKey = vi.fn(async () => true);
vi.mock('@/lib/channels', () => ({ getCampaignSocialProfile, saveProfileKeyIfAbsent, saveSocialAccounts, replaceMockProfileKey }));

const provider = {
  createProfile: vi.fn(async () => ({ profileKey: 'pk-new', refId: 'ref' })),
  createLinkUrl: vi.fn(async () => ({ url: 'https://profile.ayrshare.com/link' })),
  getConnectedAccounts: vi.fn(async () => [{ platform: 'instagram', name: 'A', handle: '@a', profileUrl: null, avatarUrl: null, refreshRequired: false }]),
  disconnect: vi.fn(async () => {}),
};
// Mutable so one test can swap in a real MockSocialAccountsProvider instance.
let current: any = provider;
class FakeMissingKey extends Error {}
vi.mock('@/lib/services', () => ({ get socialAccounts() { return current; }, MissingProviderKeyError: FakeMissingKey }));

beforeEach(() => {
  vi.clearAllMocks();
  session = { ...session, role: 'owner' };
  profile.profileKey = null;
  profile.accounts = [];
  current = provider;
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('startChannelLinkAction', () => {
  it('refuses staff and approvers', async () => {
    session.role = 'staff';
    const { startChannelLinkAction } = await import('./actions');
    const r = await startChannelLinkAction();
    expect(r.ok).toBe(false);
    expect(provider.createProfile).not.toHaveBeenCalled();
  });

  it('creates the campaign profile on first connect, stores it, and returns a link back to /channels', async () => {
    const { startChannelLinkAction } = await import('./actions');
    const r = await startChannelLinkAction();
    expect(r).toEqual({ ok: true, url: 'https://profile.ayrshare.com/link' });
    expect(provider.createProfile).toHaveBeenCalledWith({ title: 'Rivera for Senate · c-1', displayName: 'Rivera for Senate' });
    expect(saveProfileKeyIfAbsent).toHaveBeenCalledWith('c-1', { profileKey: 'pk-new', refId: 'ref' });
    expect(provider.createLinkUrl).toHaveBeenCalledWith({
      profileKey: 'pk-new', redirect: 'http://localhost:3000/channels?linked=1',
      platforms: ['instagram', 'facebook', 'x', 'linkedin', 'tiktok', 'youtube'],
    });
  });

  it('lets a manager start linking', async () => {
    session.role = 'manager';
    const { startChannelLinkAction } = await import('./actions');
    const r = await startChannelLinkAction();
    expect(r.ok).toBe(true);
  });

  it('refuses with notConfigured when NEXT_PUBLIC_SITE_URL is unset, before creating anything', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const { startChannelLinkAction } = await import('./actions');
    const r = await startChannelLinkAction();
    expect(r).toEqual({ ok: false, error: "Social connections aren't configured yet." });
    expect(provider.createProfile).not.toHaveBeenCalled();
  });

  it('maps a MissingProviderKeyError to the notConfigured message', async () => {
    provider.createProfile.mockRejectedValueOnce(new FakeMissingKey('no key'));
    const { startChannelLinkAction } = await import('./actions');
    const r = await startChannelLinkAction();
    expect(r).toEqual({ ok: false, error: "Social connections aren't configured yet." });
  });

  it('on a duplicate-title refusal (146) uses the key a concurrent click stored, no setup-failed audit', async () => {
    const { SocialAccountsError } = await import('@/integrations/social-accounts');
    provider.createProfile.mockRejectedValueOnce(new SocialAccountsError('dup', 400, 146));
    getCampaignSocialProfile
      .mockResolvedValueOnce({ profileKey: null, accounts: [], syncedAt: null })
      .mockResolvedValueOnce({ profileKey: 'pk-winner', accounts: [], syncedAt: null });
    const { startChannelLinkAction } = await import('./actions');
    const r = await startChannelLinkAction();
    expect(r.ok).toBe(true);
    expect(provider.createLinkUrl).toHaveBeenCalledWith(expect.objectContaining({ profileKey: 'pk-winner' }));
    expect(auditInsert).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'channels_setup_failed' }));
  });

  it('on 146 with no stored key yet, asks the user to retry without a setup-failed audit', async () => {
    const { SocialAccountsError } = await import('@/integrations/social-accounts');
    provider.createProfile.mockRejectedValueOnce(new SocialAccountsError('dup', 400, 146));
    const { startChannelLinkAction } = await import('./actions');
    const r = await startChannelLinkAction();
    expect(r).toEqual({ ok: false, error: "Couldn't reach the social connection service. Please try again." });
    expect(auditInsert).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'channels_setup_failed' }));
  });

  it('audits an orphaned profile and never uses our own key after losing the race', async () => {
    saveProfileKeyIfAbsent.mockResolvedValueOnce(false);
    getCampaignSocialProfile
      .mockResolvedValueOnce({ profileKey: null, accounts: [], syncedAt: null })
      .mockResolvedValueOnce({ profileKey: 'pk-winner', accounts: [], syncedAt: null });
    const { startChannelLinkAction } = await import('./actions');
    await startChannelLinkAction();
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ action: 'channels_profile_orphaned' }));
    expect(provider.createLinkUrl).not.toHaveBeenCalledWith(expect.objectContaining({ profileKey: 'pk-new' }));
  });

  it('reuses an existing profile instead of creating another', async () => {
    profile.profileKey = 'pk-existing';
    const { startChannelLinkAction } = await import('./actions');
    await startChannelLinkAction();
    expect(provider.createProfile).not.toHaveBeenCalled();
    expect(provider.createLinkUrl).toHaveBeenCalledWith(expect.objectContaining({ profileKey: 'pk-existing' }));
  });

  it('when a concurrent click stored a key first, uses the stored key (Review Focus #1)', async () => {
    saveProfileKeyIfAbsent.mockResolvedValueOnce(false);
    getCampaignSocialProfile
      .mockResolvedValueOnce({ profileKey: null, accounts: [], syncedAt: null })
      .mockResolvedValueOnce({ profileKey: 'pk-winner', accounts: [], syncedAt: null });
    const { startChannelLinkAction } = await import('./actions');
    await startChannelLinkAction();
    expect(provider.createLinkUrl).toHaveBeenCalledWith(expect.objectContaining({ profileKey: 'pk-winner' }));
  });

  it('maps a profile-creation refusal to the contact-support message and audits the Ayrshare code', async () => {
    const { SocialAccountsError } = await import('@/integrations/social-accounts');
    provider.createProfile.mockRejectedValueOnce(new SocialAccountsError('Profile limit reached', 403, 999));
    const { startChannelLinkAction } = await import('./actions');
    const r = await startChannelLinkAction();
    expect(r).toEqual({ ok: false, error: "We couldn't set up social connections for this campaign. Please contact support." });
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ action: 'channels_setup_failed' }));
  });
});

describe('startChannelLinkAction with a leftover mock profile key', () => {
  // A dev/mock key in a DB later served by the real provider must never be sent
  // to Ayrshare: replace it with a real profile and drop the fake snapshot.
  it('creates a real profile, conditionally replaces the mock key and clears the snapshot', async () => {
    profile.profileKey = 'mock-profile-1-123';
    profile.accounts = [{ platform: 'instagram', name: 'Demo', handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false }];
    const { startChannelLinkAction } = await import('./actions');
    const r = await startChannelLinkAction();
    expect(r.ok).toBe(true);
    expect(provider.createProfile).toHaveBeenCalled();
    expect(replaceMockProfileKey).toHaveBeenCalledWith('c-1', { profileKey: 'pk-new', refId: 'ref' });
    expect(saveProfileKeyIfAbsent).not.toHaveBeenCalled();
    expect(saveSocialAccounts).toHaveBeenCalledWith('c-1', []);
    expect(provider.createLinkUrl).toHaveBeenCalledWith(expect.objectContaining({ profileKey: 'pk-new' }));
  });

  it('when a concurrent click already replaced the mock key, uses the stored real key', async () => {
    replaceMockProfileKey.mockResolvedValueOnce(false);
    getCampaignSocialProfile
      .mockResolvedValueOnce({ profileKey: 'mock-profile-1-123', accounts: [], syncedAt: null })
      .mockResolvedValueOnce({ profileKey: 'pk-winner', accounts: [], syncedAt: null });
    const { startChannelLinkAction } = await import('./actions');
    await startChannelLinkAction();
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ action: 'channels_profile_orphaned' }));
    expect(provider.createLinkUrl).toHaveBeenCalledWith(expect.objectContaining({ profileKey: 'pk-winner' }));
  });

  it('keeps using a mock key with the mock provider', async () => {
    const { MockSocialAccountsProvider } = await import('@/integrations/social-accounts');
    const mock = new MockSocialAccountsProvider();
    current = mock;
    profile.profileKey = (await mock.createProfile({ title: 't', displayName: 'd' })).profileKey;
    const { startChannelLinkAction } = await import('./actions');
    const r = await startChannelLinkAction();
    expect(r.ok).toBe(true);
    expect(replaceMockProfileKey).not.toHaveBeenCalled();
  });
});

describe('refreshChannelsAction', () => {
  it('with a leftover mock key under the real provider, returns [] without calling Ayrshare', async () => {
    profile.profileKey = 'mock-profile-1-123';
    profile.accounts = [{ platform: 'instagram', name: 'Demo', handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false }];
    const { refreshChannelsAction } = await import('./actions');
    const r = await refreshChannelsAction();
    expect(r).toEqual({ ok: true, accounts: [] });
    expect(provider.getConnectedAccounts).not.toHaveBeenCalled();
  });

  it('returns the stored snapshot without calling Ayrshare when no profile exists yet', async () => {
    const { refreshChannelsAction } = await import('./actions');
    const r = await refreshChannelsAction();
    expect(r).toEqual({ ok: true, accounts: [] });
    expect(provider.getConnectedAccounts).not.toHaveBeenCalled();
  });

  it('reads accounts and persists the snapshot (any role may refresh)', async () => {
    session.role = 'staff';
    profile.profileKey = 'pk';
    const { refreshChannelsAction } = await import('./actions');
    const r = await refreshChannelsAction();
    expect(r.ok && r.accounts.map(a => a.platform)).toEqual(['instagram']);
    expect(saveSocialAccounts).toHaveBeenCalledWith('c-1', expect.any(Array));
  });
});

describe('disconnectChannelAction', () => {
  it('rejects an unsupported platform before calling Ayrshare (Review Focus #4)', async () => {
    profile.profileKey = 'pk';
    const { disconnectChannelAction } = await import('./actions');
    const r = await disconnectChannelAction('pinterest' as any);
    expect(r.ok).toBe(false);
    expect(provider.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects with the campaign key, re-reads, persists, audits', async () => {
    profile.profileKey = 'pk';
    provider.getConnectedAccounts.mockResolvedValueOnce([]);
    const { disconnectChannelAction } = await import('./actions');
    const r = await disconnectChannelAction('instagram');
    expect(provider.disconnect).toHaveBeenCalledWith('pk', 'instagram');
    expect(r).toEqual({ ok: true, accounts: [] });
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ action: 'channels_disconnected' }));
  });

  // Ayrshare caches GET /user for up to 60s, so the re-read can still list the
  // account we just removed — the DELETE succeeded, so trust it.
  it('drops the disconnected platform from a stale (cached) re-read', async () => {
    profile.profileKey = 'pk';
    const { disconnectChannelAction } = await import('./actions');
    const r = await disconnectChannelAction('instagram');
    expect(r).toEqual({ ok: true, accounts: [] });
    expect(saveSocialAccounts).toHaveBeenCalledWith('c-1', []);
  });

  it('when the re-read fails after a successful disconnect, saves the old snapshot minus that platform and succeeds', async () => {
    const { SocialAccountsError } = await import('@/integrations/social-accounts');
    profile.profileKey = 'pk';
    const ig = { platform: 'instagram', name: 'A', handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false };
    const fb = { platform: 'facebook', name: 'B', handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false };
    profile.accounts = [ig, fb];
    provider.getConnectedAccounts.mockRejectedValueOnce(new SocialAccountsError('down', 0));
    const { disconnectChannelAction } = await import('./actions');
    const r = await disconnectChannelAction('instagram');
    expect(r).toEqual({ ok: true, accounts: [fb] });
    expect(saveSocialAccounts).toHaveBeenCalledWith('c-1', [fb]);
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ action: 'channels_disconnected' }));
  });

  it('still fails when the disconnect itself fails', async () => {
    const { SocialAccountsError } = await import('@/integrations/social-accounts');
    profile.profileKey = 'pk';
    provider.disconnect.mockRejectedValueOnce(new SocialAccountsError('down', 0));
    const { disconnectChannelAction } = await import('./actions');
    const r = await disconnectChannelAction('instagram');
    expect(r.ok).toBe(false);
    expect(saveSocialAccounts).not.toHaveBeenCalled();
  });
});

describe('completeMockLinkAction', () => {
  it('refuses staff', async () => {
    session.role = 'staff';
    const { completeMockLinkAction } = await import('./actions');
    const r = await completeMockLinkAction();
    expect(r).toEqual({ ok: false, error: 'Only owners and managers can change social connections.' });
  });

  it('is notConfigured when the provider is not the mock', async () => {
    const { completeMockLinkAction } = await import('./actions');
    const r = await completeMockLinkAction();
    expect(r).toEqual({ ok: false, error: "Social connections aren't configured yet." });
  });

  it('with the real mock provider, completes the link and returns accounts', async () => {
    const { MockSocialAccountsProvider } = await import('@/integrations/social-accounts');
    const mock = new MockSocialAccountsProvider();
    current = mock;
    profile.profileKey = (await mock.createProfile({ title: 't', displayName: 'd' })).profileKey;
    const { completeMockLinkAction } = await import('./actions');
    const r = await completeMockLinkAction();
    expect(r.ok && r.accounts.map(a => a.platform)).toEqual(['instagram', 'facebook']);
  });
});
