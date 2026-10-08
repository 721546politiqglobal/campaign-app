# Social Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each campaign connects its own social accounts from a new `/channels` page (Ayrshare User Profiles + hosted linking popup), and every publish/analytics call is scoped to that campaign's profile.

**Architecture:** A new `SocialAccountsProvider` seam (Ayrshare + Mock) in `src/integrations/social-accounts.ts`; per-campaign profile key + account snapshot on `campaigns` (migration 044) behind `src/lib/channels.ts`; server actions in `src/app/channels/actions.ts`; a pure domain helper gates publishing; a client `ChannelsManager` renders the page.

**Tech Stack:** Next.js 14 App Router (server actions), Supabase (service-role `adminDb`), next-intl, Vitest (node env — no DOM tests; UI verified by typecheck/build + manual run).

**Spec:** `docs/superpowers/specs/2026-10-08-social-channels-design.md`

## Global Constraints

- **Never commit.** The user reviews and commits everything themselves. Skip every "commit" step.
- Ayrshare base URL `https://api.ayrshare.com/api`; auth header `Authorization: Bearer <AYRSHARE_API_KEY>`; per-profile header `Profile-Key: <key>`.
- Our `x` ↔ Ayrshare `twitter`; other five platform strings identical (`instagram`, `facebook`, `linkedin`, `tiktok`, `youtube`).
- The profile key is a credential: never returned to the client, never added to `getCampaign()`.
- Mutating channel actions require `can(role, 'edit_settings')` (owner/manager).
- Block, don't fall back: no publish ever goes out without a campaign `Profile-Key`.
- Every new user-facing string goes in BOTH `src/messages/en.json` and `es.json`.
- Match surrounding style: 2-space indent, single quotes, comments explain *why*.

## Review Focus

1. **Two Connect clicks at once** (double-click / two managers) → must not create two Ayrshare profiles for one campaign (burns the 10-profile allowance). Pinned in Task 4 (`saveProfileKeyIfAbsent` conditional update) and Task 6 (loser re-reads the winner's key).
2. **Ayrshare omits `activeSocialAccounts` / returns `displayNames` with missing fields** → page must show "not connected", never crash. Pinned in Task 2.
3. **Disconnect without `Profile-Key`** would unlink the Primary Profile's account → provider must always send it. Pinned in Task 2.
4. **Platform string from the client** (`disconnectChannelAction('pinterest' as any)`) → rejected before any API call. Pinned in Task 6.
5. **Scheduled item whose campaign disconnected the network after scheduling** → cron must not post and must return it to `approved`. Pinned in Task 8.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/channels.ts` (new) | `SocialAccount` type, `SOCIAL_PLATFORMS`, `unconnectedPlatforms`, `newlyConnected` — pure |
| `src/integrations/social-accounts.ts` (new) | `SocialAccountsProvider` interface, Ayrshare + Mock implementations, `SocialAccountsError`, Ayrshare→`SocialAccount` mapping |
| `src/lib/services.ts` (modify) | export `socialAccounts` |
| `supabase/migrations/044_campaign_social_profiles.sql` (new) | columns on `campaigns` |
| `src/lib/channels.ts` (new) | read/write a campaign's social profile + snapshot (server-only) |
| `src/integrations/index.ts` (modify) | `Publisher`/`AnalyticsProvider` take a `profileKey` and send `Profile-Key` |
| `src/app/actions.ts` (modify) | publish/schedule gate on connected channels |
| `src/app/api/cron/publish/route.ts`, `sync-analytics/route.ts` (modify) | per-campaign profile key + not-connected handling |
| `src/app/channels/actions.ts` (new) | start-link / refresh / disconnect server actions |
| `src/messages/en.json`, `es.json` (modify) | `channels` namespace, nav key, new error strings |
| `src/components/Sidebar.tsx` (modify) | nav item |
| `src/components/ChannelIcons.tsx` (new) | brand marks per network |
| `src/components/ChannelsManager.tsx` (new) | client page UI + popup flow |
| `src/app/channels/page.tsx` (new) | server page |
| `src/app/globals.css` (modify) | `.channels-*` styles |
| `src/components/ContentWizard.tsx`, `src/app/content/[id]/page.tsx` (modify) | connected-only platform chips |

---

### Task 1: Domain helpers

**Files:**
- Create: `src/domain/channels.ts`
- Test: `src/domain/channels.test.ts`

**Interfaces:**
- Produces: `type SocialAccount = { platform: Platform; name: string; handle: string | null; profileUrl: string | null; avatarUrl: string | null; refreshRequired: boolean }`; `SOCIAL_PLATFORMS: readonly Platform[]`; `isSocialPlatform(v: unknown): v is Platform`; `unconnectedPlatforms(requested: Platform[], connected: SocialAccount[]): Platform[]`; `newlyConnected(before: SocialAccount[], after: SocialAccount[]): Platform[]`

- [ ] **Step 1: Write the failing test** — `src/domain/channels.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { unconnectedPlatforms, newlyConnected, isSocialPlatform, type SocialAccount } from './channels';

const acct = (platform: SocialAccount['platform'], over: Partial<SocialAccount> = {}): SocialAccount => ({
  platform, name: platform, handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false, ...over,
});

describe('unconnectedPlatforms', () => {
  it('returns requested platforms the campaign has not connected, in request order', () => {
    expect(unconnectedPlatforms(['tiktok', 'instagram', 'x'], [acct('instagram')])).toEqual(['tiktok', 'x']);
  });
  it('treats an account that needs reconnecting as not connected', () => {
    expect(unconnectedPlatforms(['linkedin'], [acct('linkedin', { refreshRequired: true })])).toEqual(['linkedin']);
  });
  it('returns [] when everything requested is connected', () => {
    expect(unconnectedPlatforms(['x'], [acct('x')])).toEqual([]);
  });
});

describe('newlyConnected', () => {
  it('lists platforms present after but not before', () => {
    expect(newlyConnected([acct('x')], [acct('x'), acct('youtube')])).toEqual(['youtube']);
  });
});

describe('isSocialPlatform', () => {
  it('accepts the six supported platforms and rejects anything else', () => {
    expect(isSocialPlatform('instagram')).toBe(true);
    expect(isSocialPlatform('twitter')).toBe(false);
    expect(isSocialPlatform('pinterest')).toBe(false);
    expect(isSocialPlatform(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/domain/channels.test.ts` → FAIL (cannot resolve `./channels`).

- [ ] **Step 3: Implement** — `src/domain/channels.ts`

```ts
import type { Platform } from './types';

// One connected social account, as shown on /channels and used to gate
// publishing. Snapshot of Ayrshare's GET /user `displayNames[]`.
export type SocialAccount = {
  platform: Platform;
  name: string;
  handle: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
  // LinkedIn/TikTok tokens expire; Ayrshare flags them before they do.
  refreshRequired: boolean;
};

export const SOCIAL_PLATFORMS: readonly Platform[] =
  ['instagram', 'facebook', 'x', 'linkedin', 'tiktok', 'youtube'] as const;

export function isSocialPlatform(v: unknown): v is Platform {
  return typeof v === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(v);
}

// An account that needs reconnecting can't post, so it counts as unconnected.
export function unconnectedPlatforms(requested: Platform[], connected: SocialAccount[]): Platform[] {
  const usable = new Set(connected.filter(a => !a.refreshRequired).map(a => a.platform));
  return requested.filter(p => !usable.has(p));
}

export function newlyConnected(before: SocialAccount[], after: SocialAccount[]): Platform[] {
  const had = new Set(before.map(a => a.platform));
  return after.map(a => a.platform).filter(p => !had.has(p));
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/domain/channels.test.ts` → PASS (5 tests).

---

### Task 2: `SocialAccountsProvider` (Ayrshare + Mock)

**Files:**
- Create: `src/integrations/social-accounts.ts`
- Test: `src/integrations/social-accounts.test.ts`

**Interfaces:**
- Consumes: `SocialAccount`, `SOCIAL_PLATFORMS` (Task 1)
- Produces:
  ```ts
  interface SocialAccountsProvider {
    createProfile(input: { title: string; displayName: string }): Promise<{ profileKey: string; refId: string }>;
    createLinkUrl(input: { profileKey: string; redirect: string; platforms: Platform[] }): Promise<{ url: string }>;
    getConnectedAccounts(profileKey: string): Promise<SocialAccount[]>;
    disconnect(profileKey: string, platform: Platform): Promise<void>;
  }
  class SocialAccountsError extends Error { code: number | null; status: number }
  class AyrshareSocialAccountsProvider implements SocialAccountsProvider { constructor(apiKey: string) }
  class MockSocialAccountsProvider implements SocialAccountsProvider
  const AYRSHARE_PLATFORM: Record<Platform, string>
  ```

- [ ] **Step 1: Write the failing test** — `src/integrations/social-accounts.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/integrations/social-accounts.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/integrations/social-accounts.ts`

```ts
// Per-campaign social account connections via Ayrshare User Profiles.
// Each campaign gets its own profile (and Profile-Key); its clients link their
// own networks through Ayrshare's hosted linking page, never Ayrshare itself.
import type { Platform } from '@/domain/types';
import { SOCIAL_PLATFORMS, type SocialAccount } from '@/domain/channels';

const BASE = 'https://api.ayrshare.com/api';

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
    const res = await fetch(`${BASE}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
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
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/integrations/social-accounts.test.ts` → PASS (10 tests).

---

### Task 3: Wire the provider into services

**Files:**
- Modify: `src/lib/services.ts`
- Test: `src/lib/services.test.ts`

**Interfaces:**
- Consumes: `AyrshareSocialAccountsProvider`, `MockSocialAccountsProvider`, `SocialAccountsProvider` (Task 2)
- Produces: `export const socialAccounts: SocialAccountsProvider` from `@/lib/services`

- [ ] **Step 1: Failing test** — add this new test inside the existing `describe` in `src/lib/services.test.ts`:

```ts
  it('socialAccounts fails loudly in production without AYRSHARE_API_KEY and is real with it', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AYRSHARE_API_KEY', '');
    let mod = await import('./services');
    await expect(mod.socialAccounts.getConnectedAccounts('pk')).rejects.toThrow(/AYRSHARE_API_KEY/);
    vi.resetModules();
    vi.stubEnv('AYRSHARE_API_KEY', 'k');
    mod = await import('./services');
    const { AyrshareSocialAccountsProvider } = await import('@/integrations/social-accounts');
    expect(mod.socialAccounts).toBeInstanceOf(AyrshareSocialAccountsProvider);
  });
```

- [ ] **Step 2: Run** — `npx vitest run src/lib/services.test.ts` → FAIL (`socialAccounts` undefined).

- [ ] **Step 3: Implement** — in `src/lib/services.ts` add the import and export (after `monitoringSource`):

```ts
import {
  AyrshareSocialAccountsProvider, MockSocialAccountsProvider,
  type SocialAccountsProvider,
} from '@/integrations/social-accounts';
```

```ts
// Per-campaign social connections (Ayrshare User Profiles). Same fail-loud
// rule as the other providers: a production build without the key errors on
// use instead of pretending accounts are linked.
export const socialAccounts: SocialAccountsProvider = realOrMock(
  'AYRSHARE_API_KEY',
  () => new AyrshareSocialAccountsProvider(process.env.AYRSHARE_API_KEY!),
  () => new MockSocialAccountsProvider());
```

- [ ] **Step 4: Run** — `npx vitest run src/lib/services.test.ts` → PASS.

---

### Task 4: Migration + `src/lib/channels.ts` data access

**Files:**
- Create: `supabase/migrations/044_campaign_social_profiles.sql`
- Create: `src/lib/channels.ts`
- Test: `src/lib/channels.test.ts`

**Interfaces:**
- Consumes: `SocialAccount`, `isSocialPlatform` (Task 1)
- Produces:
  ```ts
  type CampaignSocialProfile = { profileKey: string | null; accounts: SocialAccount[]; syncedAt: string | null }
  getCampaignSocialProfile(campaignId: string): Promise<CampaignSocialProfile>
  saveProfileKeyIfAbsent(campaignId: string, p: { profileKey: string; refId: string }): Promise<boolean>  // true = we won
  saveSocialAccounts(campaignId: string, accounts: SocialAccount[]): Promise<void>
  ```

- [ ] **Step 1: Migration** — `supabase/migrations/044_campaign_social_profiles.sql`

```sql
-- supabase/migrations/044_campaign_social_profiles.sql
-- Per-campaign Ayrshare User Profile (spec: 2026-10-08-social-channels-design).
-- Before this, every campaign published through the single Ayrshare Primary
-- Profile — i.e. to the same social accounts.
--
-- ayrshare_profile_key is a credential (Ayrshare returns it only once, at
-- profile creation). The app reads it server-side only; campaigns already has
-- RLS (026_rls.sql), so it isn't reachable through PostgREST.
alter table campaigns
  add column if not exists ayrshare_profile_key text,
  add column if not exists ayrshare_ref_id      text,
  -- Snapshot of the linked accounts (domain SocialAccount[]), refreshed from
  -- Ayrshare on /channels load and after linking; read by publish gating.
  add column if not exists social_accounts      jsonb not null default '[]'::jsonb,
  add column if not exists social_synced_at     timestamptz;
```

- [ ] **Step 2: Failing test** — `src/lib/channels.test.ts`

```ts
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
```

- [ ] **Step 3: Run** — `npx vitest run src/lib/channels.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement** — `src/lib/channels.ts`

```ts
// Server-only access to a campaign's Ayrshare profile and connected-account
// snapshot. The profile key is a credential: nothing here is ever passed to a
// client component — callers pass `accounts` only.
import { adminDb, throwOnError } from './supabase';
import { isSocialPlatform, type SocialAccount } from '@/domain/channels';

export type CampaignSocialProfile = {
  profileKey: string | null;
  accounts: SocialAccount[];
  syncedAt: string | null;
};

function parseAccounts(raw: unknown): SocialAccount[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is SocialAccount =>
    !!a && typeof a === 'object' && isSocialPlatform((a as SocialAccount).platform)
    && typeof (a as SocialAccount).name === 'string');
}

export async function getCampaignSocialProfile(campaignId: string): Promise<CampaignSocialProfile> {
  const { data } = await adminDb.from('campaigns')
    .select('ayrshare_profile_key, social_accounts, social_synced_at')
    .eq('id', campaignId).single();
  if (!data) return { profileKey: null, accounts: [], syncedAt: null };
  return {
    profileKey: (data.ayrshare_profile_key as string | null) ?? null,
    accounts: parseAccounts(data.social_accounts),
    syncedAt: (data.social_synced_at as string | null) ?? null,
  };
}

// Conditional on no key being stored yet, so two concurrent first-Connect
// clicks can't both persist a profile; returns false for the loser.
export async function saveProfileKeyIfAbsent(
  campaignId: string,
  p: { profileKey: string; refId: string },
): Promise<boolean> {
  const rows = await throwOnError(
    adminDb.from('campaigns')
      .update({ ayrshare_profile_key: p.profileKey, ayrshare_ref_id: p.refId })
      .eq('id', campaignId)
      .is('ayrshare_profile_key', null)
      .select('id'),
    'campaigns.ayrshare_profile',
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function saveSocialAccounts(campaignId: string, accounts: SocialAccount[]): Promise<void> {
  await throwOnError(
    adminDb.from('campaigns')
      .update({ social_accounts: accounts, social_synced_at: new Date().toISOString() })
      .eq('id', campaignId),
    'campaigns.social_accounts',
  );
}
```

- [ ] **Step 5: Run** — `npx vitest run src/lib/channels.test.ts` → PASS.

---

### Task 5: Publisher + analytics send `Profile-Key`

**Files:**
- Modify: `src/integrations/index.ts` (`Publisher`, `AyrsharePublisher`, `MockPublisher`, `MissingKeyPublisher`, `AnalyticsProvider`, `AyrshareAnalyticsProvider`, `MockAnalyticsProvider`)
- Test: `src/integrations/index.publisher-profile.test.ts` (new)

**Interfaces:**
- Produces: `Publisher.publish(input: { platforms; title; text; disclosureText; mediaUrl?; profileKey: string })`; `AnalyticsProvider.getPostAnalytics(posts, profileKey: string)`

- [ ] **Step 1: Failing test** — `src/integrations/index.publisher-profile.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AyrsharePublisher, AyrshareAnalyticsProvider } from './index';

afterEach(() => vi.unstubAllGlobals());

describe('Ayrshare calls are scoped to the campaign profile', () => {
  it('publish sends the campaign Profile-Key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'post-1' }) });
    vi.stubGlobal('fetch', fetchMock);
    await new AyrsharePublisher('k').publish({ platforms: ['x'], title: 't', text: 'b', disclosureText: '', profileKey: 'pk-7' });
    expect(fetchMock.mock.calls[0][1].headers['Profile-Key']).toBe('pk-7');
  });

  it('publish refuses (all failed, no API call) without a profile key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await new AyrsharePublisher('k').publish({ platforms: ['x'], title: 't', text: 'b', disclosureText: '', profileKey: '' });
    expect(r).toEqual([{ platform: 'x', status: 'failed', error: expect.any(String) }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('analytics sends the campaign Profile-Key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await new AyrshareAnalyticsProvider('k').getPostAnalytics([{ platform: 'x', postId: 'p' }], 'pk-7');
    expect(fetchMock.mock.calls[0][1].headers['Profile-Key']).toBe('pk-7');
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/integrations/index.publisher-profile.test.ts` → FAIL (header undefined / typecheck of `profileKey`).

- [ ] **Step 3: Implement** in `src/integrations/index.ts`:

Interface:

```ts
export interface Publisher {
  // profileKey: the campaign's Ayrshare User Profile — without it Ayrshare
  // posts to the Primary Profile, i.e. some other tenant's accounts.
  publish(input: { platforms: Platform[]; title: string; text: string; disclosureText: string; mediaUrl?: string; profileKey: string }):
    Promise<{ platform: Platform; status: 'scheduled' | 'failed'; error?: string; postId?: string }[]>;
}
```

`AyrsharePublisher.publish` — destructure `profileKey`, refuse when empty, add header:

```ts
  async publish({ platforms, title, text, disclosureText, mediaUrl, profileKey }: {
    platforms: Platform[]; title: string; text: string; disclosureText: string; mediaUrl?: string; profileKey: string;
  }) {
    if (!profileKey) {
      return platforms.map(p => ({ platform: p, status: 'failed' as const, error: 'No connected social profile for this campaign.' }));
    }
```

and in the fetch headers: `headers: { 'Authorization': \`Bearer ${this.apiKey}\`, 'Content-Type': 'application/json', 'Profile-Key': profileKey },`

`MockPublisher.publish` / `MissingKeyPublisher.publish`: add `profileKey?: string` to the destructured param type (unused).

Analytics:

```ts
export interface AnalyticsProvider {
  getPostAnalytics(posts: { platform: Platform; postId: string }[], profileKey: string): Promise<{ ... unchanged ... }[]>;
}
```

`AyrshareAnalyticsProvider.getPostAnalytics(posts, profileKey: string)` — add `'Profile-Key': profileKey` to headers. `MockAnalyticsProvider.getPostAnalytics(_posts, _profileKey?: string)`.

- [ ] **Step 4: Run** — `npx vitest run src/integrations/` → PASS. Then `npm run typecheck` → expect errors ONLY at the call sites fixed in Tasks 7–8 (`src/app/actions.ts` publishAction, `src/app/api/cron/publish/route.ts`, `src/app/api/cron/sync-analytics/route.ts`). Leave them for those tasks.

---

### Task 6: Channel server actions

**Files:**
- Create: `src/app/channels/actions.ts`
- Test: `src/app/channels/actions.test.ts`
- Modify: `src/messages/en.json`, `src/messages/es.json` (`errors.channels` block — strings needed by the actions' tests)

**Interfaces:**
- Consumes: `socialAccounts` (Task 3); `getCampaignSocialProfile`, `saveProfileKeyIfAbsent`, `saveSocialAccounts` (Task 4); `isSocialPlatform`, `SOCIAL_PLATFORMS`, `SocialAccount` (Task 1); `SocialAccountsError` (Task 2)
- Produces:
  ```ts
  type ChannelsResult = { ok: true; accounts: SocialAccount[] } | { ok: false; error: string };
  startChannelLinkAction(): Promise<{ ok: true; url: string } | { ok: false; error: string }>
  refreshChannelsAction(): Promise<ChannelsResult>
  disconnectChannelAction(platform: Platform): Promise<ChannelsResult>
  completeMockLinkAction(): Promise<ChannelsResult>   // dev-only; no-op error in prod
  ```

- [ ] **Step 1: Messages** — add under `errors` in `en.json`:

```json
"channels": {
  "permissionDenied": "Only owners and managers can change social connections.",
  "setupFailed": "We couldn't set up social connections for this campaign. Please contact support.",
  "serviceUnavailable": "Couldn't reach the social connection service. Please try again.",
  "notConfigured": "Social connections aren't configured yet.",
  "unknownNetwork": "That network isn't supported."
}
```

`es.json`:

```json
"channels": {
  "permissionDenied": "Solo los propietarios y gerentes pueden cambiar las conexiones sociales.",
  "setupFailed": "No pudimos configurar las conexiones sociales de esta campaña. Contacta con soporte.",
  "serviceUnavailable": "No se pudo conectar con el servicio de conexiones sociales. Inténtalo de nuevo.",
  "notConfigured": "Las conexiones sociales aún no están configuradas.",
  "unknownNetwork": "Esa red no es compatible."
}
```

- [ ] **Step 2: Failing test** — `src/app/channels/actions.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session = { userId: 'u-1', name: 'Owner', role: 'owner' as string, campaignId: 'c-1', locale: 'en', exp: 9_999_999_999 };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session) }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', name: 'Rivera for Senate' })) }));
const auditInsert = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: () => ({ insert: auditInsert }) } }));

const profile = { profileKey: null as string | null, accounts: [] as any[], syncedAt: null };
const getCampaignSocialProfile = vi.fn(async () => ({ ...profile }));
const saveProfileKeyIfAbsent = vi.fn(async () => true);
const saveSocialAccounts = vi.fn(async () => {});
vi.mock('@/lib/channels', () => ({ getCampaignSocialProfile, saveProfileKeyIfAbsent, saveSocialAccounts }));

const provider = {
  createProfile: vi.fn(async () => ({ profileKey: 'pk-new', refId: 'ref' })),
  createLinkUrl: vi.fn(async () => ({ url: 'https://profile.ayrshare.com/link' })),
  getConnectedAccounts: vi.fn(async () => [{ platform: 'instagram', name: 'A', handle: '@a', profileUrl: null, avatarUrl: null, refreshRequired: false }]),
  disconnect: vi.fn(async () => {}),
};
vi.mock('@/lib/services', () => ({ socialAccounts: provider }));

beforeEach(() => {
  vi.clearAllMocks();
  session = { ...session, role: 'owner' };
  profile.profileKey = null;
});

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

describe('refreshChannelsAction', () => {
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
});
```

- [ ] **Step 3: Run** — `npx vitest run src/app/channels/actions.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement** — `src/app/channels/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getCampaign } from '@/lib/data';
import { adminDb } from '@/lib/supabase';
import { socialAccounts } from '@/lib/services';
import { getCampaignSocialProfile, saveProfileKeyIfAbsent, saveSocialAccounts } from '@/lib/channels';
import { SOCIAL_PLATFORMS, isSocialPlatform, type SocialAccount } from '@/domain/channels';
import { SocialAccountsError, MockSocialAccountsProvider } from '@/integrations/social-accounts';
import { MissingProviderKeyError } from '@/lib/services';
import type { Platform } from '@/domain/types';

type Fail = { ok: false; error: string };
export type ChannelsResult = { ok: true; accounts: SocialAccount[] } | Fail;

async function audit(campaignId: string, userId: string, action: string, details: Record<string, unknown> = {}) {
  // Audit is best-effort here: never fail a user action because the log write did.
  await adminDb.from('audit_entries').insert({
    campaign_id: campaignId, actor_user_id: userId, action,
    entity_type: 'campaign', entity_id: campaignId, details,
  });
}

function toFail(e: unknown, t: (k: string) => string): Fail {
  if (e instanceof MissingProviderKeyError) return { ok: false, error: t('notConfigured') };
  if (e instanceof SocialAccountsError) return { ok: false, error: t('serviceUnavailable') };
  throw e;
}

// Lazily create the campaign's Ayrshare profile on its first Connect, so the
// plan's 10 profiles go only to campaigns that actually connect.
async function ensureProfileKey(campaignId: string, userId: string): Promise<string> {
  const existing = await getCampaignSocialProfile(campaignId);
  if (existing.profileKey) return existing.profileKey;
  const campaign = await getCampaign(campaignId);
  const name = campaign?.name ?? 'Campaign';
  const created = await socialAccounts.createProfile({ title: `${name} · ${campaignId}`, displayName: name });
  const won = await saveProfileKeyIfAbsent(campaignId, created);
  if (won) {
    await audit(campaignId, userId, 'channels_profile_created', { refId: created.refId });
    return created.profileKey;
  }
  // A concurrent click stored its key first — use that one.
  const winner = await getCampaignSocialProfile(campaignId);
  return winner.profileKey ?? created.profileKey;
}

export async function startChannelLinkAction(): Promise<{ ok: true; url: string } | Fail> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.channels' });
  if (!can(s.role, 'edit_settings')) return { ok: false, error: t('permissionDenied') };
  let profileKey: string;
  try {
    profileKey = await ensureProfileKey(s.campaignId, s.userId);
  } catch (e) {
    if (e instanceof SocialAccountsError) {
      await audit(s.campaignId, s.userId, 'channels_setup_failed', { status: e.status, code: e.code, message: e.message });
      return { ok: false, error: t('setupFailed') };
    }
    return toFail(e, t);
  }
  try {
    const { url } = await socialAccounts.createLinkUrl({
      profileKey,
      redirect: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/channels?linked=1`,
      platforms: [...SOCIAL_PLATFORMS],
    });
    await audit(s.campaignId, s.userId, 'channels_link_started');
    return { ok: true, url };
  } catch (e) {
    return toFail(e, t);
  }
}

export async function refreshChannelsAction(): Promise<ChannelsResult> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.channels' });
  const { profileKey, accounts } = await getCampaignSocialProfile(s.campaignId);
  if (!profileKey) return { ok: true, accounts };
  try {
    const fresh = await socialAccounts.getConnectedAccounts(profileKey);
    await saveSocialAccounts(s.campaignId, fresh);
    return { ok: true, accounts: fresh };
  } catch (e) {
    return toFail(e, t);
  }
}

export async function disconnectChannelAction(platform: Platform): Promise<ChannelsResult> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.channels' });
  if (!can(s.role, 'edit_settings')) return { ok: false, error: t('permissionDenied') };
  // Client-supplied: validate before it reaches Ayrshare.
  if (!isSocialPlatform(platform)) return { ok: false, error: t('unknownNetwork') };
  const { profileKey } = await getCampaignSocialProfile(s.campaignId);
  if (!profileKey) return { ok: true, accounts: [] };
  try {
    await socialAccounts.disconnect(profileKey, platform);
    // Ayrshare returns 200 even when nothing was linked — re-read for truth.
    const fresh = await socialAccounts.getConnectedAccounts(profileKey);
    await saveSocialAccounts(s.campaignId, fresh);
    await audit(s.campaignId, s.userId, 'channels_disconnected', { platform });
    revalidatePath('/channels');
    return { ok: true, accounts: fresh };
  } catch (e) {
    return toFail(e, t);
  }
}

// Dev-only: finishes the Mock provider's pretend linking page.
export async function completeMockLinkAction(): Promise<ChannelsResult> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.channels' });
  if (!(socialAccounts instanceof MockSocialAccountsProvider)) return { ok: false, error: t('notConfigured') };
  const { profileKey } = await getCampaignSocialProfile(s.campaignId);
  if (!profileKey) return { ok: true, accounts: [] };
  await socialAccounts.completeMockLink(profileKey);
  return refreshChannelsAction();
}
```

Also export `MissingProviderKeyError` already exists in `src/lib/services.ts` (Step 1 of Step-1 hardening) — confirm with `grep -n "export class MissingProviderKeyError" src/lib/services.ts`.

Note: the test's `@/lib/services` mock exports only `socialAccounts`; add `MissingProviderKeyError: class extends Error {}` to that mock object so the import resolves.

- [ ] **Step 5: Run** — `npx vitest run src/app/channels/actions.test.ts` → PASS (9 tests).

---

### Task 7: Publish/schedule gate in `src/app/actions.ts`

**Files:**
- Modify: `src/app/actions.ts` (`publishAction`, `scheduleWithTimeAction`)
- Modify: `src/messages/en.json`, `es.json` (`errors.actions.channelsNotConnected`)
- Test: `src/app/actions.publish.test.ts`, `src/app/actions.scheduleWithTime.test.ts`

**Interfaces:**
- Consumes: `getCampaignSocialProfile` (Task 4), `unconnectedPlatforms` (Task 1), `Publisher.publish({... profileKey})` (Task 5)

- [ ] **Step 1: Messages** — `errors.actions.channelsNotConnected`:
  - en: `"Connect {platforms} on the Channels page first."`
  - es: `"Conecta {platforms} en la página Canales primero."`

- [ ] **Step 2: Failing tests.** In both test files add the channels mock near the other `vi.mock` calls:

```ts
const getCampaignSocialProfile = vi.fn(async () => ({
  profileKey: 'pk-1', syncedAt: null,
  accounts: ['x', 'instagram', 'tiktok', 'facebook'].map(platform => ({ platform, name: platform, handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false })),
}));
vi.mock('@/lib/channels', () => ({ getCampaignSocialProfile }));
```

Add to `actions.publish.test.ts`:

```ts
  it('refuses networks the campaign has not connected, before calling the publisher', async () => {
    get.mockResolvedValue(ITEM);
    getCampaignSocialProfile.mockResolvedValueOnce({ profileKey: 'pk-1', syncedAt: null, accounts: [] });
    const { publishAction } = await import('./actions');
    const r = await publishAction('x', ['x'] as any);
    expect(r).toEqual({ ok: false, error: 'Connect x on the Channels page first.' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('refuses everything when the campaign has no Ayrshare profile yet', async () => {
    get.mockResolvedValue(ITEM);
    getCampaignSocialProfile.mockResolvedValueOnce({ profileKey: null, syncedAt: null, accounts: [] });
    const { publishAction } = await import('./actions');
    const r = await publishAction('x', ['x'] as any);
    expect(r.ok).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it('passes the campaign profile key to the publisher', async () => {
    get.mockResolvedValue(ITEM);
    publish.mockResolvedValue([{ platform: 'x', status: 'scheduled' }]);
    const { publishAction } = await import('./actions');
    await publishAction('x', ['x'] as any);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ profileKey: 'pk-1' }));
  });
```

Add to `actions.scheduleWithTime.test.ts` (inside its describe):

```ts
  it('refuses to schedule to a network the campaign has not connected', async () => {
    get.mockResolvedValue({ ...ITEM, mediaUrl: 'https://media.test/v.mp4' });
    getCampaignSocialProfile.mockResolvedValueOnce({ profileKey: 'pk-1', syncedAt: null, accounts: [] });
    const { scheduleWithTimeAction } = await import('./actions');
    const r = await scheduleWithTimeAction('x', ['instagram'] as any, SCHEDULED_AT, 'America/New_York');
    expect(r).toEqual({ ok: false, error: 'Connect instagram on the Channels page first.' });
    expect(schedule).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run** — `npx vitest run src/app/actions.publish.test.ts src/app/actions.scheduleWithTime.test.ts` → the new tests FAIL.

- [ ] **Step 4: Implement** in `src/app/actions.ts`:

Imports:

```ts
import { getCampaignSocialProfile } from '@/lib/channels';
import { unconnectedPlatforms } from '@/domain/channels';
```

Helper (next to `requireOwnedItem`):

```ts
// Publishing only ever goes through the campaign's own Ayrshare profile — no
// fallback to the Primary Profile (that's other tenants' accounts). Returns
// the profile key, or the platforms the campaign still has to connect.
async function requireConnectedChannels(
  campaignId: string,
  platforms: Platform[],
): Promise<{ profileKey: string } | { missing: Platform[] }> {
  const { profileKey, accounts } = await getCampaignSocialProfile(campaignId);
  const missing = profileKey ? unconnectedPlatforms(platforms, accounts) : platforms;
  return missing.length > 0 || !profileKey ? { missing } : { profileKey };
}
```

In `publishAction`, after the media-required check and before the lifecycle gate:

```ts
  const channels = await requireConnectedChannels(s.campaignId, platforms);
  if ('missing' in channels) {
    return { ok: false, error: t('channelsNotConnected', { platforms: channels.missing.join(', ') }) };
  }
```

and add `profileKey: channels.profileKey,` to the `publisher.publish({...})` input.

In `scheduleWithTimeAction`, after the media-required check (before `lifecycle.schedule`):

```ts
    const channels = await requireConnectedChannels(s.campaignId, platforms);
    if ('missing' in channels) {
      throw new GateError(t('channelsNotConnected', { platforms: channels.missing.join(', ') }));
    }
```

- [ ] **Step 5: Run** — `npx vitest run src/app/` → PASS. Other `src/app/actions.*.test.ts` files that import `./actions` but don't exercise publish/schedule don't need the mock (the import of `@/lib/channels` → `@/lib/supabase` is already mocked or harmless in those files); if any now fails on `@/lib/channels`, add `vi.mock('@/lib/channels', () => ({ getCampaignSocialProfile: vi.fn() }))` to it.

---

### Task 8: Crons use the campaign profile

**Files:**
- Modify: `src/app/api/cron/publish/route.ts`, `src/app/api/cron/sync-analytics/route.ts`
- Test: `src/app/api/cron/publish/channels.test.ts` (new); update mocks in `claim.test.ts`, `postid.test.ts`, `recovery.test.ts`, `sync-analytics/route.test.ts`

**Interfaces:**
- Consumes: `getCampaignSocialProfile` (Task 4), `unconnectedPlatforms` (Task 1)

- [ ] **Step 1: Failing test** — `src/app/api/cron/publish/channels.test.ts` (reuses the recording fake from `recovery.test.ts`; copy its `fakeDb`/`dueItem` verbatim at the top of the file), then:

```ts
// Review Focus #5: a network disconnected after scheduling must not post.
describe('cron publish requires the campaign channel to be connected', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); process.env.CRON_SECRET = 'secret'; });

  async function run(profile: { profileKey: string | null; accounts: any[] }) {
    const db = fakeDb();
    const publish = vi.fn(async () => [{ platform: 'x', status: 'scheduled' }]);
    vi.doMock('@/lib/supabase', () => ({ adminDb: db.adminDb }));
    vi.doMock('@/lib/services', () => ({ publisher: { publish } }));
    vi.doMock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));
    vi.doMock('@/lib/channels', () => ({ getCampaignSocialProfile: vi.fn(async () => ({ ...profile, syncedAt: null })) }));
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    await GET(new NextRequest('http://x', { headers: { authorization: 'Bearer secret' } }));
    return { calls: db.calls, publish };
  }

  it('returns the item to approved and audits, without posting, when the network is not connected', async () => {
    const { calls, publish } = await run({ profileKey: 'pk', accounts: [] });
    expect(publish).not.toHaveBeenCalled();
    expect(calls.some(c => c.op === 'update' && c.payload?.status === 'approved'
      && c.filters.some(f => f[0] === 'eq' && f[1] === 'id' && f[2] === 'ci-1'))).toBe(true);
    expect(calls.some(c => c.op === 'insert' && c.payload?.action === 'cron_publish_not_connected')).toBe(true);
  });

  it('publishes with the campaign profile key when connected', async () => {
    const { publish } = await run({ profileKey: 'pk', accounts: [{ platform: 'x', name: 'x', handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false }] });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ profileKey: 'pk' }));
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/app/api/cron/publish/channels.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `src/app/api/cron/publish/route.ts`:

```ts
import { getCampaignSocialProfile, type CampaignSocialProfile } from '@/lib/channels';
import { unconnectedPlatforms } from '@/domain/channels';
```

Before the `for` loop: `const profiles = new Map<string, CampaignSocialProfile>();`

Inside the `try`, before `disclosureRepo.listFor`:

```ts
      let profile = profiles.get(item.campaign_id);
      if (!profile) {
        profile = await getCampaignSocialProfile(item.campaign_id);
        profiles.set(item.campaign_id, profile);
      }
      const platforms = (item.platforms ?? []) as Platform[];
      const missing = profile.profileKey ? unconnectedPlatforms(platforms, profile.accounts) : platforms;
      if (!profile.profileKey || missing.length > 0) {
        // Never fall back to the Primary Profile (other tenants' accounts).
        await adminDb.from('content_items')
          .update({ status: 'approved', updated_at: new Date().toISOString() })
          .eq('id', item.id);
        await adminDb.from('audit_entries').insert({
          campaign_id: item.campaign_id,
          action: 'cron_publish_not_connected',
          entity_type: 'content_item',
          entity_id: item.id,
          details: { missing },
        });
        results_out.push({ id: item.id, ok: false, error: 'channels not connected' });
        continue;
      }
```

and pass `platforms` and `profileKey: profile.profileKey` into `publisher.publish(...)`.

In `src/app/api/cron/sync-analytics/route.ts`: import `getCampaignSocialProfile`; keep a `Map<string, string | null>` of campaign → profile key; skip items whose campaign has no key (`continue`); call `analyticsProvider.getPostAnalytics(posts, profileKey)`.

- [ ] **Step 4: Update existing cron test mocks** — add to `claim.test.ts`, `postid.test.ts`, `recovery.test.ts` inside each `vi.doMock` group:

```ts
vi.doMock('@/lib/channels', () => ({ getCampaignSocialProfile: vi.fn(async () => ({
  profileKey: 'pk', syncedAt: null,
  accounts: [{ platform: 'x', name: 'x', handle: null, profileUrl: null, avatarUrl: null, refreshRequired: false }],
})) }));
```

(`recovery.test.ts`'s `runCron` helper: add it there once.) In `sync-analytics/route.test.ts` add `vi.mock('@/lib/channels', () => ({ getCampaignSocialProfile: vi.fn(async () => ({ profileKey: 'pk', accounts: [], syncedAt: null })) }))` and update any `getPostAnalytics` call assertion to expect `(posts, 'pk')`.

- [ ] **Step 5: Run** — `npx vitest run src/app/api/cron` → PASS; `npm run typecheck` → clean.

---

### Task 9: i18n strings, nav item, brand icons, styles

**Files:**
- Modify: `src/messages/en.json`, `src/messages/es.json` (`common.nav.channels`, `channels` namespace)
- Modify: `src/components/Sidebar.tsx`
- Create: `src/components/ChannelIcons.tsx`
- Modify: `src/app/globals.css`
- Test: `src/messages/parity.test.ts` (new)

- [ ] **Step 1: Failing test** — `src/messages/parity.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import en from './en.json';
import es from './es.json';

function keys(o: unknown, prefix = ''): string[] {
  if (!o || typeof o !== 'object') return [prefix];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('message catalogs', () => {
  it('en and es have exactly the same keys', () => {
    expect(keys(es).sort()).toEqual(keys(en).sort());
  });
  it('define the channels namespace and nav label', () => {
    expect(keys(en)).toContain('common.nav.channels');
    expect(keys(en)).toContain('channels.title');
  });
});
```

If `tsconfig.json` lacks `"resolveJsonModule": true`, read the files with `JSON.parse(readFileSync(...))` instead of importing.

- [ ] **Step 2: Run** — `npx vitest run src/messages/parity.test.ts` → FAIL (`channels.title` missing).

- [ ] **Step 3: Add strings.** `common.nav.channels`: en `"Channels"`, es `"Canales"`. New top-level `channels` namespace:

en:

```json
"channels": {
  "eyebrow": "Publishing",
  "title": "Channels",
  "subtitle": "Connect the social accounts this campaign publishes to.",
  "progress": "{connected} of {total} connected",
  "connectAccounts": "Connect accounts",
  "connect": "Connect",
  "connectNetwork": "Connect {network}",
  "connecting": "Connecting…",
  "reconnect": "Reconnect",
  "reconnectNetwork": "Reconnect {network}",
  "disconnect": "Disconnect",
  "disconnectNetwork": "Disconnect {network}",
  "disconnectConfirm": "Disconnect {network}? Posts scheduled to it won't go out until you reconnect.",
  "cancel": "Cancel",
  "viewProfile": "View profile",
  "statusConnected": "Connected",
  "statusNotConnected": "Not connected",
  "statusReconnect": "Reconnect needed",
  "waiting": "Finish connecting in the window that opened. This page will update automatically.",
  "waitingCancel": "I closed it",
  "connectedToast": "{network} connected",
  "disconnectedToast": "{network} disconnected",
  "refreshFailed": "Couldn't refresh connections. Showing the last known status.",
  "readOnly": "Only owners and managers can change connections.",
  "trust": "Accounts connect directly through each network's official login. PolitIQ never sees your passwords, and you can disconnect anytime.",
  "stepsTitle": "Get set up in a minute",
  "step1Title": "Connect",
  "step1Body": "Choose the networks this campaign posts to.",
  "step2Title": "Approve access",
  "step2Body": "Sign in to each network and allow publishing.",
  "step3Title": "Publish",
  "step3Body": "Approved content goes out to your accounts.",
  "networks": {
    "instagram": { "name": "Instagram", "description": "Posts, Reels and Stories" },
    "facebook": { "name": "Facebook", "description": "Page posts and videos" },
    "x": { "name": "X", "description": "Posts and threads" },
    "linkedin": { "name": "LinkedIn", "description": "Profile and page updates" },
    "tiktok": { "name": "TikTok", "description": "Short-form video" },
    "youtube": { "name": "YouTube", "description": "Videos and Shorts" }
  }
}
```

es:

```json
"channels": {
  "eyebrow": "Publicación",
  "title": "Canales",
  "subtitle": "Conecta las cuentas sociales en las que publica esta campaña.",
  "progress": "{connected} de {total} conectadas",
  "connectAccounts": "Conectar cuentas",
  "connect": "Conectar",
  "connectNetwork": "Conectar {network}",
  "connecting": "Conectando…",
  "reconnect": "Reconectar",
  "reconnectNetwork": "Reconectar {network}",
  "disconnect": "Desconectar",
  "disconnectNetwork": "Desconectar {network}",
  "disconnectConfirm": "¿Desconectar {network}? Las publicaciones programadas no saldrán hasta que vuelvas a conectar.",
  "cancel": "Cancelar",
  "viewProfile": "Ver perfil",
  "statusConnected": "Conectada",
  "statusNotConnected": "No conectada",
  "statusReconnect": "Requiere reconexión",
  "waiting": "Termina la conexión en la ventana que se abrió. Esta página se actualizará automáticamente.",
  "waitingCancel": "Ya la cerré",
  "connectedToast": "{network} conectada",
  "disconnectedToast": "{network} desconectada",
  "refreshFailed": "No se pudieron actualizar las conexiones. Se muestra el último estado conocido.",
  "readOnly": "Solo los propietarios y gerentes pueden cambiar las conexiones.",
  "trust": "Las cuentas se conectan directamente con el inicio de sesión oficial de cada red. PolitIQ nunca ve tus contraseñas y puedes desconectarlas cuando quieras.",
  "stepsTitle": "Configúralo en un minuto",
  "step1Title": "Conecta",
  "step1Body": "Elige las redes en las que publica esta campaña.",
  "step2Title": "Autoriza el acceso",
  "step2Body": "Inicia sesión en cada red y permite publicar.",
  "step3Title": "Publica",
  "step3Body": "El contenido aprobado se publica en tus cuentas.",
  "networks": {
    "instagram": { "name": "Instagram", "description": "Publicaciones, Reels e Historias" },
    "facebook": { "name": "Facebook", "description": "Publicaciones y videos de página" },
    "x": { "name": "X", "description": "Publicaciones e hilos" },
    "linkedin": { "name": "LinkedIn", "description": "Actualizaciones de perfil y página" },
    "tiktok": { "name": "TikTok", "description": "Video corto" },
    "youtube": { "name": "YouTube", "description": "Videos y Shorts" }
  }
}
```

Also add to `contentWizard.publish` (used in Task 10):
- `notConnectedNote` en `"Only connected channels can be selected."` / es `"Solo se pueden seleccionar canales conectados."`
- `manageChannels` en `"Manage channels"` / es `"Gestionar canales"`
- `noChannelsTitle` en `"No channels connected yet"` / es `"Aún no hay canales conectados"`
- `noChannelsBody` en `"Connect this campaign's social accounts to publish."` / es `"Conecta las cuentas sociales de esta campaña para publicar."`

- [ ] **Step 4: Nav item** — in `src/components/Sidebar.tsx` `NAV`, insert between the `/analytics` and `/avatars` entries:

```tsx
  {
    href: '/channels',
    key: 'channels',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M6.5 9.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <path d="M7.2 4.6l1.1-1.1a2.6 2.6 0 0 1 3.7 3.7l-1.1 1.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <path d="M8.8 11.4l-1.1 1.1a2.6 2.6 0 0 1-3.7-3.7l1.1-1.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
```

- [ ] **Step 5: Brand icons** — `src/components/ChannelIcons.tsx` (simplified single-color marks, `currentColor`, colored by the tile CSS):

```tsx
import type { Platform } from '@/domain/types';

// Simplified brand marks. Rendered in currentColor; the tile sets the brand color.
const PATHS: Record<Platform, JSX.Element> = {
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="2" fill="none"/>
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="2" fill="none"/>
      <circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/>
    </>
  ),
  facebook: <path fill="currentColor" d="M13.5 21v-7.4h2.5l.4-2.9h-2.9V8.9c0-.8.2-1.4 1.4-1.4h1.6V4.9c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.1H8.1v2.9h2.5V21h2.9z"/>,
  x: <path fill="currentColor" d="M17.8 3h3l-6.6 7.6L22 21h-6.1l-4.8-6.2L5.6 21h-3l7.1-8.1L2.3 3h6.2l4.3 5.7L17.8 3zm-1 16.2h1.7L7.4 4.7H5.6l11.2 14.5z"/>,
  linkedin: <path fill="currentColor" d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4V21H3V9.75zm6.5 0h3.8v1.6h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-4.9c0-1.17-.02-2.68-1.63-2.68-1.64 0-1.89 1.28-1.89 2.6V21h-4V9.75z"/>,
  tiktok: <path fill="currentColor" d="M16.6 3c.3 2.2 1.6 3.7 3.9 3.9v3c-1.4.1-2.7-.3-3.9-1.1v5.9c0 3.6-2.9 6.3-6.4 6.3S4 18.3 4 14.8c0-3.8 3.4-6.7 7.3-6.2v3.1c-1.8-.4-3.6.9-3.6 2.9 0 1.6 1.2 2.9 2.8 2.9 1.7 0 2.9-1.2 2.9-3.3V3h3.2z"/>,
  youtube: <path fill="currentColor" d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2 27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z"/>,
};

export function ChannelIcon({ platform, size = 22 }: { platform: Platform; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden focusable="false">
      {PATHS[platform]}
    </svg>
  );
}
```

- [ ] **Step 6: Styles** — append to `src/app/globals.css` (dark theme tokens already defined on `:root`):

```css
/* ── Channels (/channels) ───────────────────────────────────────────────── */
.channels-head-meta { display: flex; align-items: center; gap: 16px; }
.channels-progress { display: flex; flex-direction: column; gap: 6px; min-width: 150px; font-size: 12px; color: var(--text-2); }
.channels-progress-bar { height: 4px; border-radius: 999px; background: var(--line); overflow: hidden; }
.channels-progress-bar > span { display: block; height: 100%; background: var(--ok); border-radius: inherit; transition: width .4s ease; }

.channels-banner { display: flex; align-items: center; gap: 12px; padding: 12px 16px; margin-bottom: 18px;
  border: 1px solid var(--info-border); background: var(--info-dim); color: var(--text); border-radius: var(--r-lg); font-size: 13px; }
.channels-banner .spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--info-border); border-top-color: var(--info); animation: channels-spin .8s linear infinite; }
.channels-banner button { margin-left: auto; }
@keyframes channels-spin { to { transform: rotate(360deg); } }

.channels-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; }
.channels-step { display: flex; gap: 12px; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--bg-surface); }
.channels-step-num { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center;
  font-size: 12px; font-weight: 700; background: var(--accent-dim); color: var(--text); }
.channels-step strong { display: block; font-size: 13px; margin-bottom: 2px; }
.channels-step p { margin: 0; font-size: 12px; color: var(--text-2); }

.channels-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.channel-card { display: flex; flex-direction: column; gap: 14px; padding: 18px; min-height: 196px;
  border: 1px solid var(--border); border-radius: var(--r-xl); background: var(--bg-surface); background-image: var(--surface-grad);
  box-shadow: var(--hairline); transition: border-color .15s ease, transform .15s ease; }
.channel-card:hover { border-color: var(--border-strong); }
.channel-card.is-connected { border-color: var(--ok-border); }
.channel-card-top { display: flex; align-items: flex-start; gap: 12px; }
.channel-tile { flex: none; width: 42px; height: 42px; border-radius: 11px; display: grid; place-items: center; color: #fff; }
.channel-tile.instagram { background: linear-gradient(45deg, #F58529, #DD2A7B 50%, #8134AF); }
.channel-tile.facebook  { background: #1877F2; }
.channel-tile.x         { background: #000; box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }
.channel-tile.linkedin  { background: #0A66C2; }
.channel-tile.tiktok    { background: #010101; box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }
.channel-tile.youtube   { background: #FF0000; }
.channel-title { flex: 1; min-width: 0; }
.channel-title h3 { margin: 0; font-size: 15px; }
.channel-title p { margin: 2px 0 0; font-size: 12px; color: var(--text-2); }
.channel-status { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 600; border: 1px solid var(--border); color: var(--text-3); }
.channel-status::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.channel-status.ok   { color: var(--ok);   background: var(--ok-dim);   border-color: var(--ok-border); }
.channel-status.warn { color: var(--warn); background: var(--warn-dim); border-color: var(--warn-border); }

.channel-account { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: var(--r-lg); background: var(--bg-elevated); }
.channel-avatar { flex: none; width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: var(--bg-hover);
  display: grid; place-items: center; font-size: 13px; font-weight: 700; color: var(--text-2); }
.channel-account-text { min-width: 0; flex: 1; }
.channel-account-text strong { display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.channel-account-text span { display: block; font-size: 12px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.channel-account a { font-size: 12px; color: var(--text-2); text-decoration: none; white-space: nowrap; }
.channel-account a:hover { color: var(--text); }

.channel-actions { margin-top: auto; display: flex; gap: 8px; }
.channel-actions .btn { flex: 1; justify-content: center; }
.channel-confirm { margin-top: auto; padding: 10px; border-radius: var(--r-lg); border: 1px solid var(--bad-border); background: var(--bad-dim); font-size: 12px; }
.channel-confirm p { margin: 0 0 8px; }
.channel-confirm div { display: flex; gap: 8px; justify-content: flex-end; }

.channel-card.is-loading .channel-account,
.channel-card.is-loading .channel-actions { opacity: .45; }

.channels-trust { display: flex; gap: 10px; align-items: flex-start; margin-top: 20px; padding: 14px 16px;
  font-size: 12px; color: var(--text-2); border-top: 1px solid var(--line); }
.channels-trust svg { flex: none; margin-top: 1px; }
.channels-readonly { font-size: 12px; color: var(--text-3); }

@media (max-width: 1100px) { .channels-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) {
  .channels-grid, .channels-steps { grid-template-columns: 1fr; }
  .channels-head-meta { flex-direction: column; align-items: stretch; }
}
@media (prefers-reduced-motion: reduce) {
  .channels-banner .spinner { animation: none; }
  .channels-progress-bar > span, .channel-card { transition: none; }
}
```

- [ ] **Step 7: Run** — `npx vitest run src/messages/parity.test.ts` → PASS; `npm run typecheck` → clean.

---

### Task 10: `/channels` page, `ChannelsManager`, ContentWizard chips

**Files:**
- Create: `src/app/channels/page.tsx`
- Create: `src/components/ChannelsManager.tsx`
- Modify: `src/app/content/[id]/page.tsx`, `src/components/ContentWizard.tsx`

**Interfaces:**
- Consumes: Tasks 1, 4, 6, 9.

- [ ] **Step 1: Server page** — `src/app/channels/page.tsx`

```tsx
import { getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { ChannelsManager } from '@/components/ChannelsManager';
import { requireSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getCampaignSocialProfile } from '@/lib/channels';

export default async function ChannelsPage({ searchParams }: { searchParams: { linked?: string; mock_link?: string } }) {
  const t = await getTranslations('channels');
  const s = await requireSession();
  // The profile key stays on the server — only the account snapshot crosses.
  const { accounts } = await getCampaignSocialProfile(s.campaignId);

  return (
    <AppFrame>
      <ChannelsManager
        initialAccounts={accounts}
        canManage={can(s.role, 'edit_settings')}
        returnedFromLink={searchParams.linked === '1'}
        mockLink={!!searchParams.mock_link}
        eyebrow={t('eyebrow')}
      />
    </AppFrame>
  );
}
```

- [ ] **Step 2: Client component** — `src/components/ChannelsManager.tsx`

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/Toast';
import { ChannelIcon } from '@/components/ChannelIcons';
import {
  startChannelLinkAction, refreshChannelsAction, disconnectChannelAction, completeMockLinkAction,
} from '@/app/channels/actions';
import { SOCIAL_PLATFORMS, newlyConnected, type SocialAccount } from '@/domain/channels';
import type { Platform } from '@/domain/types';

type Busy = { kind: 'linking' } | { kind: 'refreshing' } | { kind: 'disconnecting'; platform: Platform } | null;

function openCentered(url: string): Window | null {
  const w = 600, h = 720;
  const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
  return window.open(url, 'politiq-connect', `width=${w},height=${h},left=${left},top=${top}`);
}

export function ChannelsManager({
  initialAccounts, canManage, returnedFromLink, mockLink, eyebrow,
}: {
  initialAccounts: SocialAccount[];
  canManage: boolean;
  returnedFromLink: boolean;
  mockLink: boolean;
  eyebrow: string;
}) {
  const t = useTranslations('channels');
  const { toast } = useToast();
  const router = useRouter();
  const [accounts, setAccounts] = useState<SocialAccount[]>(initialAccounts);
  const [busy, setBusy] = useState<Busy>(null);
  const [waiting, setWaiting] = useState(false);
  const [confirming, setConfirming] = useState<Platform | null>(null);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const networkName = (p: Platform) => t(`networks.${p}.name`);

  // Re-read from Ayrshare; toast each newly linked network. Ayrshare caches
  // /user for 60s, so when expecting a change and seeing none, retry once.
  const refresh = useCallback(async (expectChange: boolean) => {
    setBusy({ kind: 'refreshing' });
    const before = accountsRef.current;
    let r = await refreshChannelsAction();
    if (expectChange && r.ok && newlyConnected(before, r.accounts).length === 0) {
      await new Promise(res => setTimeout(res, 3000));
      r = await refreshChannelsAction();
    }
    setBusy(null);
    if (!r.ok) { toast(t('refreshFailed'), 'error'); return; }
    for (const p of newlyConnected(before, r.accounts)) toast(t('connectedToast', { network: networkName(p) }));
    setAccounts(r.accounts);
  }, [t, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fresh data on mount; after a same-tab return or the dev mock, expect a change.
  useEffect(() => {
    (async () => {
      if (mockLink) {
        const r = await completeMockLinkAction();
        if (r.ok) {
          for (const p of newlyConnected(accountsRef.current, r.accounts)) toast(t('connectedToast', { network: networkName(p) }));
          setAccounts(r.accounts);
        }
      } else {
        await refresh(returnedFromLink);
      }
      if (returnedFromLink || mockLink) router.replace('/channels');
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function connect(trigger: HTMLButtonElement) {
    lastTrigger.current = trigger;
    setBusy({ kind: 'linking' });
    const r = await startChannelLinkAction();
    if (!r.ok) { setBusy(null); toast(r.error, 'error'); return; }
    const popup = openCentered(r.url);
    if (!popup) { window.location.assign(r.url); return; } // blocked → same tab; Ayrshare redirects back
    setBusy(null);
    setWaiting(true);
    const timer = window.setInterval(async () => {
      if (!popup.closed) return;
      window.clearInterval(timer);
      setWaiting(false);
      await refresh(true);
      lastTrigger.current?.focus();
    }, 500);
  }

  async function disconnect(platform: Platform) {
    setConfirming(null);
    setBusy({ kind: 'disconnecting', platform });
    const r = await disconnectChannelAction(platform);
    setBusy(null);
    if (!r.ok) { toast(r.error, 'error'); return; }
    setAccounts(r.accounts);
    toast(t('disconnectedToast', { network: networkName(platform) }));
  }

  const byPlatform = new Map(accounts.map(a => [a.platform, a]));
  const connectedCount = accounts.filter(a => !a.refreshRequired).length;
  const total = SOCIAL_PLATFORMS.length;
  const linking = busy?.kind === 'linking';

  return (
    <>
      <div className="pagehead">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{t('title')}</h1>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>{t('subtitle')}</p>
        </div>
        <div className="actions channels-head-meta">
          <div className="channels-progress" aria-live="polite">
            <span>{t('progress', { connected: connectedCount, total })}</span>
            <div className="channels-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={connectedCount}>
              <span style={{ width: `${(connectedCount / total) * 100}%` }} />
            </div>
          </div>
          {canManage && (
            <button type="button" className="btn primary" disabled={linking || waiting}
              onClick={e => connect(e.currentTarget)}>
              {linking ? t('connecting') : t('connectAccounts')}
            </button>
          )}
        </div>
      </div>

      {waiting && (
        <div className="channels-banner" role="status">
          <span className="spinner" aria-hidden />
          <span>{t('waiting')}</span>
          <button type="button" className="btn" onClick={() => { setWaiting(false); refresh(true); }}>{t('waitingCancel')}</button>
        </div>
      )}

      {accounts.length === 0 && (
        <section className="channels-steps" aria-label={t('stepsTitle')}>
          {[1, 2, 3].map(n => (
            <div key={n} className="channels-step">
              <span className="channels-step-num">{n}</span>
              <div><strong>{t(`step${n}Title`)}</strong><p>{t(`step${n}Body`)}</p></div>
            </div>
          ))}
        </section>
      )}

      <div className="channels-grid">
        {SOCIAL_PLATFORMS.map(p => {
          const a = byPlatform.get(p);
          const needsReconnect = !!a?.refreshRequired;
          const connected = !!a && !needsReconnect;
          const name = networkName(p);
          const cardBusy = busy?.kind === 'refreshing' || (busy?.kind === 'disconnecting' && busy.platform === p);
          return (
            <section key={p} aria-labelledby={`ch-${p}`} aria-busy={cardBusy}
              className={`channel-card${connected ? ' is-connected' : ''}${cardBusy ? ' is-loading' : ''}`}>
              <div className="channel-card-top">
                <div className={`channel-tile ${p}`}><ChannelIcon platform={p} /></div>
                <div className="channel-title">
                  <h3 id={`ch-${p}`}>{name}</h3>
                  <p>{t(`networks.${p}.description`)}</p>
                </div>
                <span className={`channel-status${connected ? ' ok' : needsReconnect ? ' warn' : ''}`}>
                  {connected ? t('statusConnected') : needsReconnect ? t('statusReconnect') : t('statusNotConnected')}
                </span>
              </div>

              {a && (
                <div className="channel-account">
                  {a.avatarUrl
                    ? <img className="channel-avatar" src={a.avatarUrl} alt="" />
                    : <span className="channel-avatar" aria-hidden>{a.name.charAt(0).toUpperCase()}</span>}
                  <div className="channel-account-text">
                    <strong>{a.name}</strong>
                    {a.handle && <span>{a.handle}</span>}
                  </div>
                  {a.profileUrl && (
                    <a href={a.profileUrl} target="_blank" rel="noopener noreferrer">{t('viewProfile')} ↗</a>
                  )}
                </div>
              )}

              {canManage && confirming === p ? (
                <div className="channel-confirm" role="alertdialog" aria-label={t('disconnectNetwork', { network: name })}>
                  <p>{t('disconnectConfirm', { network: name })}</p>
                  <div>
                    <button type="button" className="btn" onClick={() => setConfirming(null)}>{t('cancel')}</button>
                    <button type="button" className="btn danger" onClick={() => disconnect(p)}>{t('disconnect')}</button>
                  </div>
                </div>
              ) : canManage ? (
                <div className="channel-actions">
                  {connected && (
                    <button type="button" className="btn" disabled={!!busy}
                      aria-label={t('disconnectNetwork', { network: name })} onClick={() => setConfirming(p)}>
                      {t('disconnect')}
                    </button>
                  )}
                  {needsReconnect && (
                    <button type="button" className="btn primary" disabled={!!busy || waiting}
                      aria-label={t('reconnectNetwork', { network: name })} onClick={e => connect(e.currentTarget)}>
                      {t('reconnect')}
                    </button>
                  )}
                  {!a && (
                    <button type="button" className="btn" disabled={!!busy || waiting}
                      aria-label={t('connectNetwork', { network: name })} onClick={e => connect(e.currentTarget)}>
                      {t('connect')}
                    </button>
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="channels-trust">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.4"/>
        </svg>
        <span>{t('trust')}{!canManage && <> <span className="channels-readonly">{t('readOnly')}</span></>}</span>
      </div>
    </>
  );
}
```

- [ ] **Step 3: ContentWizard chips** — in `src/app/content/[id]/page.tsx` load `getCampaignSocialProfile(s.campaignId)` in the existing `Promise.all` and pass `connectedPlatforms={social.accounts.filter(a => !a.refreshRequired).map(a => a.platform)}` to `<ContentWizard>`.

In `src/components/ContentWizard.tsx`: add prop `connectedPlatforms: Platform[]`; initial selection becomes `availablePlatforms.filter(p => connectedPlatforms.includes(p))`; in the chip map render unconnected chips disabled:

```tsx
              {availablePlatforms.map(p => {
                const connected = connectedPlatforms.includes(p);
                const selected = connected && platforms.includes(p);
                return (
                  <label key={p} className={`chip${selected ? ' on' : ''}`}
                    style={connected ? undefined : { opacity: 0.4, cursor: 'not-allowed' }}
                    title={connected ? undefined : t('publish.notConnectedNote')}>
                    <input type="checkbox" checked={selected} disabled={!connected}
                      onChange={() => togglePlatform(p)} style={{ display: 'none' }} />
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </label>
                );
              })}
```

Below the chips (before the existing `mediaRequiredNote` block):

```tsx
            {connectedPlatforms.length === 0 ? (
              <div className="card" style={{ marginTop: -12, marginBottom: 24, padding: 14 }}>
                <strong style={{ fontSize: 13 }}>{t('publish.noChannelsTitle')}</strong>
                <p className="muted" style={{ margin: '4px 0 10px', fontSize: 12 }}>{t('publish.noChannelsBody')}</p>
                <Link href="/channels" className="btn primary">{t('publish.manageChannels')}</Link>
              </div>
            ) : availablePlatforms.some(p => !connectedPlatforms.includes(p)) && (
              <p className="muted" style={{ fontSize: 12, marginTop: -16, marginBottom: 24 }}>
                {t('publish.notConnectedNote')} <Link href="/channels">{t('publish.manageChannels')}</Link>
              </p>
            )}
```

(Add `import Link from 'next/link';` if not present.)

- [ ] **Step 4: Verify** — `npm run typecheck` → clean; `npm test` → all pass; `npm run build` → succeeds and lists `ƒ /channels`.

- [ ] **Step 5: Manual verification (mock provider, no Ayrshare key locally)** — `npm run dev`; log in as an owner; open `/channels`: empty state + 6 cards; click **Connect accounts** → popup opens `/channels?…mock_link=…` → close it → (in the popup itself the page completes the mock link) Instagram + Facebook show Connected with toasts; Disconnect Instagram → inline confirm → toast, card returns to Not connected; log in as staff → read-only note, no buttons; open a content item at the Publish step → only Facebook chip enabled, "Manage channels" link present. Take screenshots of `/channels` empty, connected, and confirm states for the user.

---

## Execution notes

- Ayrshare live test (after deploy to a preview with the real key): connect one network end-to-end; confirm the linking page shows the campaign name; publish a test post and confirm it lands on that account only.
- Ops for the user (from the spec): apply migration 044; brand the Ayrshare linking page; add X developer keys + Ayrshare callback URLs for X.
