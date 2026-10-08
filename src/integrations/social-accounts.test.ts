import { describe, it, expect, vi, afterEach } from 'vitest';
import { AyrshareSocialAccountsProvider, MockSocialAccountsProvider, SocialAccountsError } from './social-accounts';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });

afterEach(() => vi.unstubAllGlobals());

describe('AyrshareSocialAccountsProvider', () => {
  it('createProfile posts title + topHeader with the primary API key and returns the key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ status: 'success', profileKey: 'pk-1', refId: 'ref-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await new AyrshareSocialAccountsProvider('api-key').createProfile({ title: 'Rivera · c-1', displayName: 'Rivera' });
    expect(r).toEqual({ profileKey: 'pk-1', refId: 'ref-1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.ayrshare.com/api/profiles');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer api-key');
    expect(JSON.parse(init.body)).toEqual({ title: 'Rivera · c-1', topHeader: 'Rivera' });
  });

  it('createProfile surfaces Ayrshare errors as SocialAccountsError with the code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail(400, { status: 'error', code: 146, message: 'Profile title already exists.' })));
    const p = new AyrshareSocialAccountsProvider('k').createProfile({ title: 't', displayName: 'd' });
    await expect(p).rejects.toBeInstanceOf(SocialAccountsError);
    await expect(p).rejects.toMatchObject({ code: 146, status: 400 });
  });

  it('a non-JSON error body still becomes a SocialAccountsError, not a parse crash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad'); } }));
    await expect(new AyrshareSocialAccountsProvider('k').getConnectedAccounts('pk')).rejects.toMatchObject({ status: 502 });
  });

  it('createLinkUrl maps x→twitter in allowedSocial and passes the redirect', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ status: 'success', url: 'https://profile.ayrshare.com/?t=1' }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await new AyrshareSocialAccountsProvider('k').createLinkUrl({
      profileKey: 'pk-1', redirect: 'https://app.test/channels?linked=1', platforms: ['instagram', 'x'],
    });
    expect(r.url).toBe('https://profile.ayrshare.com/?t=1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.ayrshare.com/api/profiles/generateJWT');
    expect(JSON.parse(init.body)).toEqual({
      profileKey: 'pk-1', redirect: 'https://app.test/channels?linked=1', allowedSocial: ['instagram', 'twitter'],
    });
  });

  it('getConnectedAccounts sends Profile-Key and maps displayNames', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({
      activeSocialAccounts: ['instagram', 'twitter', 'youtube', 'linkedin'],
      displayNames: [
        { platform: 'instagram', displayName: 'Ana Rivera', username: 'anarivera', profileUrl: 'https://instagram.com/anarivera', userImage: 'https://img/ig.jpg' },
        { platform: 'twitter', displayName: 'Ana', username: 'ana_x', profileUrl: 'https://x.com/ana_x' },
        { platform: 'youtube', displayName: 'Google Holder', username: 'Google Holder', channelTitle: 'Rivera for Senate', profileUrl: 'https://youtube.com/c/r' },
        { platform: 'linkedin', displayName: 'Ana R', refreshRequired: true },
        { platform: 'pinterest', username: 'ignored' },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const accounts = await new AyrshareSocialAccountsProvider('k').getConnectedAccounts('pk-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.ayrshare.com/api/user');
    expect(init.headers['Profile-Key']).toBe('pk-1');
    expect(accounts).toEqual([
      { platform: 'instagram', name: 'Ana Rivera', handle: '@anarivera', profileUrl: 'https://instagram.com/anarivera', avatarUrl: 'https://img/ig.jpg', refreshRequired: false },
      { platform: 'x', name: 'Ana', handle: '@ana_x', profileUrl: 'https://x.com/ana_x', avatarUrl: null, refreshRequired: false },
      { platform: 'youtube', name: 'Rivera for Senate', handle: null, profileUrl: 'https://youtube.com/c/r', avatarUrl: null, refreshRequired: false },
      { platform: 'linkedin', name: 'Ana R', handle: null, profileUrl: null, avatarUrl: null, refreshRequired: true },
    ]);
  });

  it('getConnectedAccounts returns [] when Ayrshare omits activeSocialAccounts / displayNames', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ title: 'Rivera' })));
    expect(await new AyrshareSocialAccountsProvider('k').getConnectedAccounts('pk')).toEqual([]);
  });

  it('getConnectedAccounts ignores displayNames entries for platforms not in activeSocialAccounts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({
      activeSocialAccounts: ['facebook'],
      displayNames: [{ platform: 'facebook', pageName: 'Rivera Page' }, { platform: 'tiktok', username: '@stale' }],
    })));
    const accounts = await new AyrshareSocialAccountsProvider('k').getConnectedAccounts('pk');
    expect(accounts.map(a => a.platform)).toEqual(['facebook']);
    expect(accounts[0].name).toBe('Rivera Page');
  });

  it('disconnect ALWAYS sends Profile-Key (without it Ayrshare unlinks the primary account) and maps x→twitter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ status: 'success' }));
    vi.stubGlobal('fetch', fetchMock);
    await new AyrshareSocialAccountsProvider('k').disconnect('pk-9', 'x');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.ayrshare.com/api/profiles/social');
    expect(init.method).toBe('DELETE');
    expect(init.headers['Profile-Key']).toBe('pk-9');
    expect(JSON.parse(init.body)).toEqual({ platform: 'twitter' });
  });

  // A network failure or a hung Ayrshare must surface as the typed error the
  // actions map to a friendly message — never an unhandled TypeError/AbortError.
  it('a rejected fetch (network error / timeout) becomes SocialAccountsError with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const err = await new AyrshareSocialAccountsProvider('k').getConnectedAccounts('pk').catch(e => e);
    expect(err).toBeInstanceOf(SocialAccountsError);
    expect(err.status).toBe(0);
  });

  it('passes a timeout signal to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({}));
    vi.stubGlobal('fetch', fetchMock);
    await new AyrshareSocialAccountsProvider('k').getConnectedAccounts('pk');
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('disconnect refuses an empty profile key without calling Ayrshare', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new AyrshareSocialAccountsProvider('k').disconnect('', 'x')).rejects.toBeInstanceOf(SocialAccountsError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('MockSocialAccountsProvider', () => {
  it('supports the full create → link → read → disconnect cycle in memory', async () => {
    const m = new MockSocialAccountsProvider();
    const { profileKey } = await m.createProfile({ title: 't', displayName: 'Rivera' });
    const { url } = await m.createLinkUrl({ profileKey, redirect: 'http://localhost:3000/channels?linked=1', platforms: ['instagram'] });
    expect(url).toContain('/channels?linked=1');
    expect(url).toContain('mock_link=');
    await m.completeMockLink(profileKey);
    expect((await m.getConnectedAccounts(profileKey)).map(a => a.platform)).toEqual(['instagram', 'facebook']);
    await m.disconnect(profileKey, 'instagram');
    expect((await m.getConnectedAccounts(profileKey)).map(a => a.platform)).toEqual(['facebook']);
  });
});
