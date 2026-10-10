// Per-campaign social account connections via Ayrshare User Profiles.
// Each campaign gets its own profile (and Profile-Key); its clients link their
// own networks through Ayrshare's hosted linking page, never Ayrshare itself.
import type { Platform } from '@/domain/types';
import { SOCIAL_PLATFORMS, type SocialAccount } from '@/domain/channels';
import { ayrshareUrl } from './ayrshare-base';

export const AYRSHARE_PLATFORM: Record<Platform, string> = {
  instagram: 'instagram', facebook: 'facebook', x: 'twitter',
  linkedin: 'linkedin', tiktok: 'tiktok', youtube: 'youtube',
};
const FROM_AYRSHARE: Record<string, Platform> = Object.fromEntries(
  SOCIAL_PLATFORMS.map(p => [AYRSHARE_PLATFORM[p], p]),
);

export interface SocialAccountsProvider {
  createProfile(input: { title: string; displayName: string }): Promise<{ profileKey: string; refId: string }>;
  createLinkUrl(input: { profileKey: string; redirect: string; platforms: Platform[] }): Promise<{ url: string }>;
  getConnectedAccounts(profileKey: string): Promise<SocialAccount[]>;
  disconnect(profileKey: string, platform: Platform): Promise<void>;
}

export class SocialAccountsError extends Error {
  constructor(message: string, readonly status: number, readonly code: number | null = null) {
    super(message);
  }
}

type DisplayName = Record<string, unknown> & { platform?: string };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const withAt = (h: string | null): string | null => (h ? (h.startsWith('@') ? h : `@${h}`) : null);

// Ayrshare's per-network field names differ (verified against its docs):
// YouTube's displayName/username are the Google account holder, not the
// channel, so the channel title wins there; Facebook exposes pageName.
function toSocialAccount(d: DisplayName, platform: Platform): SocialAccount {
  const name = platform === 'youtube'
    ? str(d.channelTitle) ?? str(d.displayName)
    : str(d.displayName) ?? str(d.pageName) ?? str(d.username);
  const handle = platform === 'youtube' ? withAt(str(d.handle))
    : platform === 'facebook' ? null
    : withAt(str(d.username));
  return {
    platform,
    name: name ?? platform,
    handle,
    profileUrl: str(d.profileUrl),
    avatarUrl: str(d.userImage),
    refreshRequired: d.refreshRequired === true,
  };
}

export class AyrshareSocialAccountsProvider implements SocialAccountsProvider {
  constructor(private apiKey: string) {}

  private async call<T>(path: string, init: { method: string; body?: unknown; profileKey?: string }): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (init.profileKey) headers['Profile-Key'] = init.profileKey;
    // A network failure or a hung Ayrshare must reach callers as the typed
    // error they map to "try again" — otherwise the UI waits forever on it.
    let res: Response;
    try {
      res = await fetch(ayrshareUrl('api', path), {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new SocialAccountsError(`Ayrshare request failed: ${e instanceof Error ? e.message : String(e)}`, 0);
    }
    // Check status before trusting the body: error pages aren't always JSON.
    let json: Record<string, unknown> = {};
    try { json = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok || json.status === 'error') {
      const code = typeof json.code === 'number' ? json.code : null;
      throw new SocialAccountsError(str(json.message) ?? `Ayrshare HTTP ${res.status}`, res.status, code);
    }
    return json as T;
  }

  async createProfile({ title, displayName }: { title: string; displayName: string }) {
    const r = await this.call<{ profileKey?: string; refId?: string }>('/profiles', {
      method: 'POST', body: { title, topHeader: displayName },
    });
    if (!r.profileKey) throw new SocialAccountsError('Ayrshare returned no profile key', 502);
    return { profileKey: r.profileKey, refId: r.refId ?? '' };
  }

  async createLinkUrl({ profileKey, redirect, platforms }: { profileKey: string; redirect: string; platforms: Platform[] }) {
    const r = await this.call<{ url?: string }>('/profiles/generateJWT', {
      method: 'POST',
      body: { profileKey, redirect, allowedSocial: platforms.map(p => AYRSHARE_PLATFORM[p]) },
    });
    if (!r.url) throw new SocialAccountsError('Ayrshare returned no linking URL', 502);
    return { url: r.url };
  }

  async getConnectedAccounts(profileKey: string) {
    const r = await this.call<{ activeSocialAccounts?: string[]; displayNames?: DisplayName[] }>('/user', {
      method: 'GET', profileKey,
    });
    // activeSocialAccounts is omitted entirely when nothing is linked.
    const active = new Set(r.activeSocialAccounts ?? []);
    const out: SocialAccount[] = [];
    for (const d of r.displayNames ?? []) {
      const platform = d.platform ? FROM_AYRSHARE[d.platform] : undefined;
      if (!platform || !active.has(d.platform!)) continue;
      out.push(toSocialAccount(d, platform));
    }
    return out;
  }

  async disconnect(profileKey: string, platform: Platform) {
    // Without a Profile-Key Ayrshare unlinks the PRIMARY profile's account —
    // never let an empty key through.
    if (!profileKey) throw new SocialAccountsError('Missing profile key', 400);
    await this.call('/profiles/social', {
      method: 'DELETE', profileKey, body: { platform: AYRSHARE_PLATFORM[platform] },
    });
  }
}

// Local/dev stand-in: the whole Channels flow is clickable without spending a
// real Ayrshare profile. The "linking page" is just /channels with a marker
// the page turns into completeMockLink().
export class MockSocialAccountsProvider implements SocialAccountsProvider {
  private profiles = new Map<string, SocialAccount[]>();

  async createProfile(_input: { title: string; displayName: string }) {
    const profileKey = `mock-profile-${this.profiles.size + 1}-${Date.now()}`;
    this.profiles.set(profileKey, []);
    return { profileKey, refId: `mock-ref-${this.profiles.size}` };
  }

  async createLinkUrl({ profileKey, redirect }: { profileKey: string; redirect: string; platforms: Platform[] }) {
    const sep = redirect.includes('?') ? '&' : '?';
    return { url: `${redirect}${sep}mock_link=${encodeURIComponent(profileKey)}` };
  }

  async completeMockLink(profileKey: string) {
    this.profiles.set(profileKey, [
      { platform: 'instagram', name: 'Demo Campaign', handle: '@demo.campaign', profileUrl: 'https://instagram.com', avatarUrl: null, refreshRequired: false },
      { platform: 'facebook', name: 'Demo Campaign Page', handle: null, profileUrl: 'https://facebook.com', avatarUrl: null, refreshRequired: false },
    ]);
  }

  async getConnectedAccounts(profileKey: string) {
    return [...(this.profiles.get(profileKey) ?? [])];
  }

  async disconnect(profileKey: string, platform: Platform) {
    this.profiles.set(profileKey, (this.profiles.get(profileKey) ?? []).filter(a => a.platform !== platform));
  }
}
