# Self-Service Voice Cloning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a campaign owner/manager clone their own voice from an uploaded audio sample and have it become their campaign's active video voice automatically, without any admin involvement.

**Architecture:** Extend `candidate_profiles` with self-clone tracking columns (no new table — only one clone is ever live per campaign). Add three HeyGen voice-cloning methods to the existing `PhotoAvatarProvider` interface/`HeyGenPhotoAvatarProvider` class. Add three server actions mirroring the existing `beginVideoAvatarUploadAction`/`finalizeVideoAvatarAction`/`checkAvatarStatusAction` pattern. Add a new `VoiceCloneManager` client component, rendered as a new card on `/avatars`. `generateVideoAction`'s voice resolution gains one extra precedence step; the admin-assigned `heygen_voice_id` column is never read or written by this feature.

**Tech Stack:** Next.js Server Actions, Supabase (Postgres + Storage), HeyGen v3 API (`POST/GET/DELETE /v3/voices*`), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-02-self-service-voice-cloning-design.md`

## Global Constraints

- Voice clone limit: HeyGen caps clones at 10 per HeyGen account, shared across the entire platform (one `HEYGEN_API_KEY`) — enforced by always deleting the previous self-clone before creating a new one (max 1 live self-clone per campaign).
- Permission: reuses `manage_avatars` (`owner`/`manager` roles) — no new permission.
- `heygen_voice_id` (admin-assigned column) must never be **written or deleted** by any code this plan adds — it may only be *read* as the fallback value in `generateVideoAction`'s resolution chain (Task 6).
- No per-item billing cost constant or `quotaGate` call for voice cloning — only `billingGate.check(campaignId)` (the general spend-cap gate). Voice has no accumulating count to cap since replace-on-reclone keeps it at exactly 0 or 1 per campaign by construction.
- A HeyGen `404 voice_not_found` response from `DELETE /v3/voices/{id}` must be treated as success, not an error (HeyGen's documented behavior for an already-deleted voice).

---

### Task 1: Migration — add self-voice-clone columns to `candidate_profiles`

**Files:**
- Create: `supabase/migrations/033_candidate_profile_self_voice_clone.sql`

**Interfaces:**
- Produces: five new nullable columns on `candidate_profiles`, consumed by Task 2 (`src/lib/candidate.ts`) and Task 4 (server actions).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/033_candidate_profile_self_voice_clone.sql
alter table candidate_profiles
  add column if not exists self_voice_clone_id text,
  add column if not exists self_voice_name text,
  add column if not exists self_voice_clone_status text check (self_voice_clone_status in ('training', 'ready', 'failed')),
  add column if not exists self_voice_clone_error text,
  add column if not exists self_voice_consent_confirmed_by text references users(id),
  add column if not exists self_voice_consent_confirmed_at timestamptz;
```

- [ ] **Step 2: Apply the migration locally and verify the columns exist**

Run: `supabase db push` (or the project's existing migration-apply command — check `package.json` scripts for `db:migrate`/`supabase:push` and use whichever this repo already uses).
Then verify: `supabase db diff` (or equivalent) shows no pending changes, confirming the migration applied cleanly.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/033_candidate_profile_self_voice_clone.sql
git commit -m "feat(db): add self-voice-clone tracking columns to candidate_profiles"
```

---

### Task 2: Extend `CandidateProfile` type and `src/lib/candidate.ts` mapping

**Files:**
- Modify: `src/domain/types.ts:111-141` (`CandidateProfile` interface)
- Modify: `src/lib/candidate.ts` (`toProfile`, `upsertCandidateProfile`)
- Test: `src/lib/candidate.test.ts` (create if it doesn't already exist — check first with `ls src/lib/candidate.test.ts`)

**Interfaces:**
- Consumes: the five columns from Task 1.
- Produces: `CandidateProfile.selfVoiceCloneId?: string | null`, `.selfVoiceName?: string | null`, `.selfVoiceCloneStatus?: 'training' | 'ready' | 'failed' | null`, `.selfVoiceCloneError?: string | null`, `.selfVoiceConsentConfirmedBy?: string | null`, `.selfVoiceConsentConfirmedAt?: string | null`. `getCandidateProfile(campaignId)` and `upsertCandidateProfile(campaignId, data)` both read/write these. Consumed by Task 4 (actions) and Task 6 (`generateVideoAction`).

- [ ] **Step 1: Write the failing test**

Check first whether `src/lib/candidate.test.ts` exists:

Run: `ls src/lib/candidate.test.ts`

If it does not exist, create it with this content (mocking `adminDb` the same way `src/app/actions.avatar-digital-twin.test.ts` mocks `@/lib/supabase`):

```typescript
// src/lib/candidate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const selectSingle = vi.fn();
const update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
const insert = vi.fn(() => Promise.resolve({ error: null }));

vi.mock('./supabase', () => ({
  adminDb: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: selectSingle })) })),
      update,
      insert,
    })),
  },
}));

vi.mock('./store', () => ({ uid: vi.fn(() => 'profile-1') }));

beforeEach(() => { vi.clearAllMocks(); });

describe('getCandidateProfile', () => {
  it('maps self-voice-clone columns onto the domain type', async () => {
    selectSingle.mockResolvedValue({
      data: {
        id: 'profile-1', campaign_id: 'c-1', full_name: 'Alex', preferred_name: 'Alex',
        office: 'Mayor', district: 'D1', party: '', bio: '', key_positions: [],
        voice_tone: 'conversational', target_audience: '', tagline: '',
        opponent_aliases: [], monitoring_keywords: [],
        video_aspect_ratio: '16:9', video_background: 'plain',
        created_at: '2026-01-01', updated_at: '2026-01-01',
        self_voice_clone_id: 'voice-clone-1',
        self_voice_name: 'My voice',
        self_voice_clone_status: 'ready',
        self_voice_clone_error: null,
        self_voice_consent_confirmed_by: 'u-1',
        self_voice_consent_confirmed_at: '2026-08-02T00:00:00.000Z',
      },
    });
    const { getCandidateProfile } = await import('./candidate');

    const profile = await getCandidateProfile('c-1');

    expect(profile).toMatchObject({
      selfVoiceCloneId: 'voice-clone-1',
      selfVoiceName: 'My voice',
      selfVoiceCloneStatus: 'ready',
      selfVoiceCloneError: null,
      selfVoiceConsentConfirmedBy: 'u-1',
      selfVoiceConsentConfirmedAt: '2026-08-02T00:00:00.000Z',
    });
  });
});

describe('upsertCandidateProfile', () => {
  it('writes self-voice-clone fields to their snake_case columns on update', async () => {
    selectSingle.mockResolvedValue({ data: { id: 'profile-1', campaign_id: 'c-1' } });
    const { upsertCandidateProfile } = await import('./candidate');

    await upsertCandidateProfile('c-1', {
      selfVoiceCloneId: 'voice-clone-2',
      selfVoiceName: 'New voice',
      selfVoiceCloneStatus: 'training',
      selfVoiceCloneError: null,
      selfVoiceConsentConfirmedBy: 'u-2',
      selfVoiceConsentConfirmedAt: '2026-08-02T01:00:00.000Z',
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      self_voice_clone_id: 'voice-clone-2',
      self_voice_name: 'New voice',
      self_voice_clone_status: 'training',
      self_voice_clone_error: null,
      self_voice_consent_confirmed_by: 'u-2',
      self_voice_consent_confirmed_at: '2026-08-02T01:00:00.000Z',
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/candidate.test.ts`
Expected: FAIL — `selfVoiceCloneId` etc. are `undefined` on the returned profile, and `update` is not called with the new snake_case keys, because `CandidateProfile` and `toProfile`/`upsertCandidateProfile` don't know about them yet.

- [ ] **Step 3: Extend `CandidateProfile` in `src/domain/types.ts`**

Add after line 136 (`heygenVoiceId?: string | null;`):

```typescript
  selfVoiceCloneId?: string | null;
  selfVoiceName?: string | null;
  selfVoiceCloneStatus?: 'training' | 'ready' | 'failed' | null;
  selfVoiceCloneError?: string | null;
  selfVoiceConsentConfirmedBy?: string | null;
  selfVoiceConsentConfirmedAt?: string | null;
```

- [ ] **Step 4: Extend `toProfile` in `src/lib/candidate.ts`**

Add after line 32 (`heygenVoiceId: (r.heygen_voice_id as string | null) ?? null,`):

```typescript
    selfVoiceCloneId: (r.self_voice_clone_id as string | null) ?? null,
    selfVoiceName: (r.self_voice_name as string | null) ?? null,
    selfVoiceCloneStatus: (r.self_voice_clone_status as 'training' | 'ready' | 'failed' | null) ?? null,
    selfVoiceCloneError: (r.self_voice_clone_error as string | null) ?? null,
    selfVoiceConsentConfirmedBy: (r.self_voice_consent_confirmed_by as string | null) ?? null,
    selfVoiceConsentConfirmedAt: (r.self_voice_consent_confirmed_at as string | null) ?? null,
```

- [ ] **Step 5: Extend `upsertCandidateProfile`'s payload builder in `src/lib/candidate.ts`**

Add after line 77 (`...(data.heygenVoiceId ... }),`):

```typescript
    ...(data.selfVoiceCloneId    !== undefined && { self_voice_clone_id:    data.selfVoiceCloneId ?? null }),
    ...(data.selfVoiceName       !== undefined && { self_voice_name:        data.selfVoiceName ?? null }),
    ...(data.selfVoiceCloneStatus !== undefined && { self_voice_clone_status: data.selfVoiceCloneStatus ?? null }),
    ...(data.selfVoiceCloneError !== undefined && { self_voice_clone_error: data.selfVoiceCloneError ?? null }),
    ...(data.selfVoiceConsentConfirmedBy !== undefined && { self_voice_consent_confirmed_by: data.selfVoiceConsentConfirmedBy ?? null }),
    ...(data.selfVoiceConsentConfirmedAt !== undefined && { self_voice_consent_confirmed_at: data.selfVoiceConsentConfirmedAt ?? null }),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/candidate.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/domain/types.ts src/lib/candidate.ts src/lib/candidate.test.ts
git commit -m "feat(candidate): add self-voice-clone fields to CandidateProfile"
```

---

### Task 3: HeyGen voice-clone methods on `PhotoAvatarProvider`

**Files:**
- Modify: `src/integrations/index.ts` (`PhotoAvatarProvider` interface at line 46, `HeyGenPhotoAvatarProvider` class at line 207, `MockPhotoAvatarProvider` class at line 458)
- Test: `src/integrations/index.test.ts`

**Interfaces:**
- Consumes: `HeyGenPhotoAvatarProvider.uploadAsset` (existing, line 210) to turn an audio buffer into an `asset_id`.
- Produces: `PhotoAvatarProvider.cloneVoice(input: { name: string; assetId: string; language?: string }): Promise<{ voiceCloneId: string }>`, `.getVoiceCloneStatus(voiceCloneId: string): Promise<{ status: 'training' | 'ready' | 'failed' }>`, `.deleteVoiceClone(voiceCloneId: string): Promise<void>`. Consumed by Task 4 (server actions).

- [ ] **Step 1: Write the failing tests**

Check the existing style in `src/integrations/index.test.ts` first (open it and find how `createVideoAvatar`/`requestConsent` are tested — same `vi.stubGlobal('fetch', ...)` pattern), then add:

```typescript
// Add to src/integrations/index.test.ts
describe('HeyGenPhotoAvatarProvider.cloneVoice', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts to /v3/voices/clone and returns the voice_clone_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { voice_clone_id: 'clone-123' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    const result = await provider.cloneVoice({ name: 'My voice', assetId: 'asset-1' });

    expect(result).toEqual({ voiceCloneId: 'clone-123' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.heygen.com/v3/voices/clone', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Api-Key': 'test-key' }),
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ voice_name: 'My voice', audio: { type: 'asset_id', asset_id: 'asset-1' }, remove_background_noise: true });
  });

  it('throws with the HeyGen error message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'clone limit reached' } }),
    }));
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await expect(provider.cloneVoice({ name: 'x', assetId: 'a' })).rejects.toThrow(/clone limit reached/);
  });
});

describe('HeyGenPhotoAvatarProvider.getVoiceCloneStatus', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps HeyGen "complete" to "ready"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { status: 'complete' } }),
    }));
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    const result = await provider.getVoiceCloneStatus('clone-123');

    expect(result).toEqual({ status: 'ready' });
  });

  it('maps an unrecognized status to "training" rather than propagating it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { status: 'something-new' } }),
    }));
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    const result = await provider.getVoiceCloneStatus('clone-123');

    expect(result).toEqual({ status: 'training' });
  });
});

describe('HeyGenPhotoAvatarProvider.deleteVoiceClone', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls DELETE /v3/voices/{id}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { voice_id: 'clone-123' } }) });
    vi.stubGlobal('fetch', fetchMock);
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await provider.deleteVoiceClone('clone-123');

    expect(fetchMock).toHaveBeenCalledWith('https://api.heygen.com/v3/voices/clone-123', expect.objectContaining({ method: 'DELETE' }));
  });

  it('treats a 404 voice_not_found response as success, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: { code: 'voice_not_found' } }),
    }));
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await expect(provider.deleteVoiceClone('already-gone')).resolves.toBeUndefined();
  });

  it('throws on any other error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { message: 'server error' } }),
    }));
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await expect(provider.deleteVoiceClone('clone-123')).rejects.toThrow(/server error/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/integrations/index.test.ts`
Expected: FAIL with `provider.cloneVoice is not a function` (and similarly for the other two methods).

- [ ] **Step 3: Add the three methods to the `PhotoAvatarProvider` interface** (`src/integrations/index.ts`, after line 61's closing `}` for `getAvatarGroupStatus`, still inside the interface body ending at line 62)

```typescript
  cloneVoice(input: { name: string; assetId: string; language?: string }): Promise<{ voiceCloneId: string }>;
  getVoiceCloneStatus(voiceCloneId: string): Promise<{ status: 'training' | 'ready' | 'failed' }>;
  deleteVoiceClone(voiceCloneId: string): Promise<void>;
```

- [ ] **Step 4: Implement on `HeyGenPhotoAvatarProvider`** (add inside the class, after `getAvatarGroupStatus` closes at line 323, before the class's final closing `}` at line 324)

```typescript
  async cloneVoice({ name, assetId, language }: { name: string; assetId: string; language?: string }) {
    const res = await fetch('https://api.heygen.com/v3/voices/clone', {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voice_name: name,
        audio: { type: 'asset_id', asset_id: assetId },
        ...(language && { language }),
        remove_background_noise: true,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`HeyGen clone voice error: ${json.error?.message ?? res.status}`);
    const voiceCloneId = json.data?.voice_clone_id;
    if (!voiceCloneId) throw new Error('HeyGen did not return a voice_clone_id.');
    return { voiceCloneId };
  }

  async getVoiceCloneStatus(voiceCloneId: string) {
    const res = await fetch(`https://api.heygen.com/v3/voices/${encodeURIComponent(voiceCloneId)}`, {
      headers: { 'X-Api-Key': this.apiKey },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`HeyGen get voice clone error: ${json.error?.message ?? res.status}`);
    const raw = json.data?.status;
    // Unrecognized/missing status maps to 'training' (still waiting), not
    // 'failed' or 'ready' — an unexpected status string is far more likely to
    // mean "still processing" than a real terminal state, and 'ready' would
    // be actively wrong (the clone might not exist yet).
    if (raw === 'complete') return { status: 'ready' as const };
    if (raw === 'failed') return { status: 'failed' as const };
    return { status: 'training' as const };
  }

  async deleteVoiceClone(voiceCloneId: string) {
    const res = await fetch(`https://api.heygen.com/v3/voices/${encodeURIComponent(voiceCloneId)}`, {
      method: 'DELETE',
      headers: { 'X-Api-Key': this.apiKey },
    });
    if (res.ok) return;
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    // HeyGen returns 404 voice_not_found for an already-deleted voice — treat
    // that as success so a delete-then-list flow never fails on a stale id.
    if (res.status === 404) return;
    throw new Error(`HeyGen delete voice error: ${(json as { error?: { message?: string } }).error?.message ?? res.status}`);
  }
```

- [ ] **Step 5: Add matching mocks to `MockPhotoAvatarProvider`** (`src/integrations/index.ts`, inside the class, after `getAvatarGroupStatus` at line 471, before its closing `}` at line 472)

```typescript
  async cloneVoice(_input: { name: string; assetId: string; language?: string }) { return { voiceCloneId: 'mock-voice-clone-id' }; }
  async getVoiceCloneStatus(_voiceCloneId: string) { return { status: 'ready' as const }; }
  async deleteVoiceClone(_voiceCloneId: string) { return; }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/integrations/index.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/integrations/index.ts src/integrations/index.test.ts
git commit -m "feat(heygen): add voice clone/status/delete methods to PhotoAvatarProvider"
```

---

### Task 4: Server actions — `beginVoiceCloneUploadAction`, `finalizeVoiceCloneAction`, `checkVoiceCloneStatusAction`

**Files:**
- Modify: `src/app/actions.ts` (add after `deleteAvatarAction`, which ends at line 1007 — i.e. after the avatar section, before `generatePromptLookAction` at line 1009, or anywhere in the avatar-adjacent section; exact placement doesn't matter functionally)
- Test: Create `src/app/actions.voice-clone.test.ts`

**Interfaces:**
- Consumes: `photoAvatarProvider.cloneVoice/getVoiceCloneStatus/deleteVoiceClone` (Task 3), `getCandidateProfile`/`upsertCandidateProfile` with the new fields (Task 2), `can(role, 'manage_avatars')` (`src/lib/permissions.ts:10`, existing), `billingGate.check` (`src/lib/services.ts:22`, existing).
- Produces: `beginVoiceCloneUploadAction(consent: boolean, file: { name: string; type: string; size: number }): Promise<Result & { path?: string; token?: string }>`, `finalizeVoiceCloneAction(name: string, path: string): Promise<Result>`, `checkVoiceCloneStatusAction(): Promise<Result>`. Consumed by Task 5 (`VoiceCloneManager` component).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/actions.voice-clone.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuotaExceeded } from '@/domain/quota';
import { BillingBlocked } from '@/domain/billing';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };
const campaign = {
  id: 'c-1', name: 'Test Campaign', jurisdictions: [], monthlyCostCapCents: 100_00,
  planId: null, stripeCustomerId: null, stripeSubscriptionId: null,
  subscriptionStatus: null, gracePeriodEndsAt: null, currentPeriodEnd: null,
};

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

vi.mock('@/lib/session', () => ({
  requireSession: vi.fn(() => session),
  signInAs: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
  getCampaign: vi.fn(() => Promise.resolve(campaign)),
}));

vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() })),
    storage: {
      from: vi.fn(() => ({
        createSignedUploadUrl: vi.fn((path: string) => Promise.resolve({ data: { path, token: `token-${path}` }, error: null })),
        download: vi.fn(() => Promise.resolve({
          data: { arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer), type: 'audio/mpeg' },
          error: null,
        })),
        getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://media.test/${path}` } })),
      })),
    },
  },
}));

vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'voice-attempt-1') }));

const getCandidateProfile = vi.fn();
const upsertCandidateProfile = vi.fn(() => Promise.resolve());
vi.mock('@/lib/candidate', () => ({ getCandidateProfile, upsertCandidateProfile }));

const billingGate = { check: vi.fn(() => Promise.resolve()) };
const photoAvatarProvider = {
  uploadAsset: vi.fn(),
  cloneVoice: vi.fn(),
  getVoiceCloneStatus: vi.fn(),
  deleteVoiceClone: vi.fn(),
};
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: {}, voiceProvider: {},
  billingGate, quotaGate: { checkAndIncrement: vi.fn(), checkAvatarCap: vi.fn(), release: vi.fn() },
  photoAvatarProvider,
}));

vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));
vi.mock('@/lib/avatars', () => ({ insertAvatar: vi.fn(), updateAvatarStatus: vi.fn(), getAvatar: vi.fn() }));

function audioMeta(overrides: Partial<{ name: string; type: string; size: number }> = {}) {
  return { name: 'sample.mp3', type: 'audio/mpeg', size: 1024, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  billingGate.check.mockResolvedValue(undefined);
  getCandidateProfile.mockResolvedValue(null);
});

describe('beginVoiceCloneUploadAction', () => {
  it('denies a role without manage_avatars', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const { requireSession } = await import('@/lib/session');
    vi.mocked(requireSession).mockResolvedValueOnce({ ...session, role: 'staff' as const });

    const result = await beginVoiceCloneUploadAction(true, audioMeta());

    expect(result.ok).toBe(false);
  });

  it('requires the consent checkbox', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const result = await beginVoiceCloneUploadAction(false, audioMeta());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/consent/i);
  });

  it('rejects a non-audio file', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const result = await beginVoiceCloneUploadAction(true, audioMeta({ name: 'photo.jpg', type: 'image/jpeg' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/audio/i);
  });

  it('rejects a file over the size cap', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const result = await beginVoiceCloneUploadAction(true, audioMeta({ size: 51 * 1024 * 1024 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/50 ?MB/i);
  });

  it('checks billingGate before touching storage', async () => {
    billingGate.check.mockRejectedValue(new BillingBlocked('Billing is past due.'));
    const { beginVoiceCloneUploadAction } = await import('./actions');

    const result = await beginVoiceCloneUploadAction(true, audioMeta());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/billing/i);
  });

  it('on success, returns a signed upload path/token', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const result = await beginVoiceCloneUploadAction(true, audioMeta());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toMatch(/^voices\/c-1\/voice-attempt-1\/sample\.mp3$/);
      expect(result.token).toBeTruthy();
    }
  });
});

describe('finalizeVoiceCloneAction', () => {
  it('on success with no prior clone, does not call deleteVoiceClone and persists status training', async () => {
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.cloneVoice.mockResolvedValue({ voiceCloneId: 'clone-1' });
    const { finalizeVoiceCloneAction } = await import('./actions');

    const result = await finalizeVoiceCloneAction('My voice', 'voices/c-1/voice-attempt-1/sample.mp3');

    expect(result.ok).toBe(true);
    expect(photoAvatarProvider.deleteVoiceClone).not.toHaveBeenCalled();
    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', expect.objectContaining({
      selfVoiceCloneId: 'clone-1', selfVoiceName: 'My voice', selfVoiceCloneStatus: 'training',
      selfVoiceConsentConfirmedBy: 'u-1',
    }));
  });

  it('deletes the previous self-clone before creating a new one', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneId: 'old-clone', selfVoiceCloneStatus: 'ready' });
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-2' });
    photoAvatarProvider.cloneVoice.mockResolvedValue({ voiceCloneId: 'new-clone' });
    const { finalizeVoiceCloneAction } = await import('./actions');

    await finalizeVoiceCloneAction('Replacement voice', 'voices/c-1/voice-attempt-1/sample.mp3');

    expect(photoAvatarProvider.deleteVoiceClone).toHaveBeenCalledWith('old-clone');
    expect(photoAvatarProvider.deleteVoiceClone.mock.invocationCallOrder[0])
      .toBeLessThan(photoAvatarProvider.cloneVoice.mock.invocationCallOrder[0]);
  });

  it('proceeds with the new clone even if deleting the old one fails', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneId: 'old-clone', selfVoiceCloneStatus: 'ready' });
    photoAvatarProvider.deleteVoiceClone.mockRejectedValue(new Error('HeyGen delete voice error: 500'));
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-2' });
    photoAvatarProvider.cloneVoice.mockResolvedValue({ voiceCloneId: 'new-clone' });
    const { finalizeVoiceCloneAction } = await import('./actions');

    const result = await finalizeVoiceCloneAction('Replacement voice', 'voices/c-1/voice-attempt-1/sample.mp3');

    expect(result.ok).toBe(true);
    expect(photoAvatarProvider.cloneVoice).toHaveBeenCalled();
  });

  it('marks status failed (never silently dropped) when cloneVoice throws', async () => {
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.cloneVoice.mockRejectedValue(new Error('HeyGen clone voice error: clone limit reached'));
    const { finalizeVoiceCloneAction } = await import('./actions');

    const result = await finalizeVoiceCloneAction('My voice', 'voices/c-1/voice-attempt-1/sample.mp3');

    expect(result.ok).toBe(false);
    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', expect.objectContaining({
      selfVoiceCloneStatus: 'failed',
      selfVoiceCloneError: expect.stringMatching(/clone limit reached/),
    }));
  });

  it('rejects a path outside this campaign/attempt prefix', async () => {
    const { finalizeVoiceCloneAction } = await import('./actions');
    const result = await finalizeVoiceCloneAction('My voice', 'voices/other-campaign/x/sample.mp3');
    expect(result.ok).toBe(false);
    expect(photoAvatarProvider.uploadAsset).not.toHaveBeenCalled();
  });
});

describe('checkVoiceCloneStatusAction', () => {
  it('no-ops when there is no clone in training', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'ready', selfVoiceCloneId: 'clone-1' });
    const { checkVoiceCloneStatusAction } = await import('./actions');

    const result = await checkVoiceCloneStatusAction();

    expect(result.ok).toBe(true);
    expect(photoAvatarProvider.getVoiceCloneStatus).not.toHaveBeenCalled();
  });

  it('updates status to ready when HeyGen reports ready', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'training', selfVoiceCloneId: 'clone-1' });
    photoAvatarProvider.getVoiceCloneStatus.mockResolvedValue({ status: 'ready' });
    const { checkVoiceCloneStatusAction } = await import('./actions');

    await checkVoiceCloneStatusAction();

    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', { selfVoiceCloneStatus: 'ready' });
  });

  it('updates status to failed when HeyGen reports failed', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'training', selfVoiceCloneId: 'clone-1' });
    photoAvatarProvider.getVoiceCloneStatus.mockResolvedValue({ status: 'failed' });
    const { checkVoiceCloneStatusAction } = await import('./actions');

    await checkVoiceCloneStatusAction();

    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', {
      selfVoiceCloneStatus: 'failed',
      selfVoiceCloneError: 'HeyGen reported the voice clone failed.',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/actions.voice-clone.test.ts`
Expected: FAIL — `beginVoiceCloneUploadAction is not exported` (and similarly for the other two), since none of these actions exist yet.

- [ ] **Step 3: Implement the three actions in `src/app/actions.ts`**

Add this block (placement: anywhere after `deleteAvatarAction`'s closing `}` at line 1007):

```typescript
// ── Self-service voice cloning ────────────────────────────────────────────────
// Mirrors the begin/finalize split used for avatars (see the comment above
// beginAvatarUploadAction): raw audio bytes never travel through a Server
// Action body, avoiding Vercel's function payload limit.

const MAX_VOICE_SAMPLE_BYTES = 50 * 1024 * 1024;
const ALLOWED_VOICE_SAMPLE_TYPES = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a'];

export async function beginVoiceCloneUploadAction(
  consent: boolean,
  file: { name: string; type: string; size: number },
): Promise<Result & { path?: string; token?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };
  if (!consent) return { ok: false, error: 'Consent confirmation is required.' };

  if (!file || file.size === 0) return { ok: false, error: 'Upload an audio sample.' };
  if (file.size > MAX_VOICE_SAMPLE_BYTES) return { ok: false, error: 'Audio sample must be under 50 MB.' };
  if (!ALLOWED_VOICE_SAMPLE_TYPES.includes(file.type)) return { ok: false, error: 'Only MP3, WAV, or M4A audio files are allowed.' };

  try {
    await billingGate.check(s.campaignId);
  } catch (e) {
    if (e instanceof QuotaExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }

  const attemptId = uid();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'mp3';
  const path = `voices/${s.campaignId}/${attemptId}/sample.${ext}`;
  const { data, error } = await adminDb.storage.from('media').createSignedUploadUrl(path);
  if (error) return { ok: false, error: error.message };

  return { ok: true, path, token: data.token };
}

export async function finalizeVoiceCloneAction(name: string, path: string): Promise<Result> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };

  const prefix = `voices/${s.campaignId}/`;
  if (!path.startsWith(prefix)) return { ok: false, error: 'Invalid upload.' };

  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');
  const trimmedName = name.trim() || 'My voice';

  const { data, error: downloadError } = await adminDb.storage.from('media').download(path);
  if (downloadError || !data) return { ok: false, error: downloadError?.message ?? 'Uploaded audio not found.' };
  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = data.type;

  const existingProfile = await getCandidateProfile(s.campaignId);
  if (existingProfile?.selfVoiceCloneId) {
    // Best-effort: a failure here must not block creating the replacement —
    // worst case is a stale HeyGen-side voice consuming a slot until manually
    // cleaned up (matches the digital-twin spec's precedent that partial
    // multi-step HeyGen failures don't roll back already-created state).
    try {
      await photoAvatarProvider.deleteVoiceClone(existingProfile.selfVoiceCloneId);
    } catch (e) {
      console.error(`Failed to delete previous voice clone for campaign ${s.campaignId}: ${e}`);
    }
  }

  let cloneError: string | null = null;
  let voiceCloneId: string | null = null;
  try {
    const { assetId } = await photoAvatarProvider.uploadAsset(buffer, contentType);
    const result = await photoAvatarProvider.cloneVoice({ name: trimmedName, assetId });
    voiceCloneId = result.voiceCloneId;
  } catch (e) {
    cloneError = e instanceof Error ? e.message : String(e);
  }

  await upsertCandidateProfile(s.campaignId, cloneError
    ? { selfVoiceCloneStatus: 'failed', selfVoiceCloneError: cloneError }
    : {
        selfVoiceCloneId: voiceCloneId,
        selfVoiceName: trimmedName,
        selfVoiceCloneStatus: 'training',
        selfVoiceCloneError: null,
        selfVoiceConsentConfirmedBy: s.userId,
        selfVoiceConsentConfirmedAt: new Date().toISOString(),
      });

  revalidatePath('/avatars');
  if (cloneError) return { ok: false, error: `Voice cloning failed: ${cloneError}` };
  return { ok: true };
}

export async function checkVoiceCloneStatusAction(): Promise<Result> {
  const s = await requireSession();
  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');
  const profile = await getCandidateProfile(s.campaignId);
  if (profile?.selfVoiceCloneStatus !== 'training' || !profile.selfVoiceCloneId) return { ok: true };

  const { status } = await photoAvatarProvider.getVoiceCloneStatus(profile.selfVoiceCloneId);
  if (status === 'ready') {
    await upsertCandidateProfile(s.campaignId, { selfVoiceCloneStatus: 'ready' });
  } else if (status === 'failed') {
    await upsertCandidateProfile(s.campaignId, { selfVoiceCloneStatus: 'failed', selfVoiceCloneError: 'HeyGen reported the voice clone failed.' });
  }
  revalidatePath('/avatars');
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/actions.voice-clone.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/actions.ts src/app/actions.voice-clone.test.ts
git commit -m "feat(actions): add self-service voice clone begin/finalize/status actions"
```

---

### Task 5: `VoiceCloneManager` client component + wire into `/avatars`

**Files:**
- Create: `src/components/VoiceCloneManager.tsx`
- Modify: `src/app/avatars/page.tsx`

**Interfaces:**
- Consumes: `beginVoiceCloneUploadAction`, `finalizeVoiceCloneAction`, `checkVoiceCloneStatusAction` (Task 4); `profile.selfVoiceCloneId/selfVoiceName/selfVoiceCloneStatus/selfVoiceCloneError` (Task 2); `supabaseBrowser` (`src/lib/supabase-browser`, existing, same as `AvatarManager.tsx:9`); `useToast` (`src/components/Toast`, existing).
- Produces: `VoiceCloneManager` component rendered on `/avatars`, no exports consumed elsewhere.

- [ ] **Step 1: Create `src/components/VoiceCloneManager.tsx`**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { beginVoiceCloneUploadAction, finalizeVoiceCloneAction, checkVoiceCloneStatusAction } from '@/app/actions';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { useToast } from '@/components/Toast';

const POLL_MS = 5000;

export function VoiceCloneManager({
  status,
  name,
  error,
  canManage,
}: {
  status: 'training' | 'ready' | 'failed' | null;
  name: string | null;
  error: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [voiceName, setVoiceName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status !== 'training') return;
    let cancelled = false;
    async function pollOnce() {
      await checkVoiceCloneStatusAction();
      if (!cancelled) router.refresh();
    }
    const interval = setInterval(pollOnce, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [status, router]);

  function resetModal() {
    setModalOpen(false);
    setStep(1);
    setConsent(false);
    setFile(null);
    setVoiceName('');
  }

  async function handleSubmit() {
    if (!file) return;
    setSubmitting(true);

    const begin = await beginVoiceCloneUploadAction(consent, { name: file.name, type: file.type, size: file.size });
    if (!begin.ok) {
      setSubmitting(false);
      toast(begin.error, 'error');
      return;
    }
    if (!begin.path || !begin.token) {
      setSubmitting(false);
      toast('Failed to start voice cloning', 'error');
      return;
    }

    const { error: uploadError } = await supabaseBrowser.storage.from('media')
      .uploadToSignedUrl(begin.path, begin.token, file);
    if (uploadError) {
      setSubmitting(false);
      toast(`Upload failed: ${uploadError.message}`, 'error');
      return;
    }

    const result = await finalizeVoiceCloneAction(voiceName, begin.path);
    setSubmitting(false);
    if (result.ok) {
      toast('Voice cloning started — this can take a few minutes.');
      resetModal();
      router.refresh();
    } else {
      toast(result.error ?? 'Failed to clone voice', 'error');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="eyebrow">Your voice</div>
        {canManage && status !== 'training' && (
          <button className="btn primary" style={{ fontSize: 13 }} onClick={() => setModalOpen(true)}>
            {status === 'ready' ? 'Replace voice' : 'Clone your voice'}
          </button>
        )}
      </div>

      {!status && (
        <p className="muted" style={{ fontSize: 13 }}>
          {canManage
            ? 'No cloned voice yet — clone one from a short audio sample to use it for campaign videos.'
            : 'No voice has been cloned for this campaign yet.'}
        </p>
      )}

      {status && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: status === 'ready' ? 'var(--ok)' : status === 'failed' ? 'var(--bad)' : 'var(--warn)',
            boxShadow: `0 0 6px ${status === 'ready' ? 'var(--ok)' : status === 'failed' ? 'var(--bad)' : 'var(--warn)'}`,
          }} />
          <span>
            {status === 'training' && 'Cloning your voice — usually a few minutes'}
            {status === 'ready' && `Ready — "${name}"`}
            {status === 'failed' && `Failed: ${error ?? 'Unknown error'}`}
          </span>
        </div>
      )}

      {modalOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            {step === 1 && (
              <>
                <div className="modal-step">Step 1 of 3 · Consent</div>
                <h3 style={{ marginBottom: 14, fontSize: 16 }}>Confirm permission</h3>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.5 }}>
                  <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
                  I confirm I have permission to create an AI clone of this voice.
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={resetModal}>Cancel</button>
                  <button className="btn primary" disabled={!consent} onClick={() => setStep(2)}>Next →</button>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <div className="modal-step">Step 2 of 3 · Audio sample</div>
                <h3 style={{ marginBottom: 12, fontSize: 16 }}>Upload an audio sample</h3>
                <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Upload a clear, single-speaker MP3, WAV, or M4A recording.
                </p>
                <input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a"
                  onChange={e => setFile(e.target.files?.[0] ?? null)} />
                {file && (
                  <audio src={URL.createObjectURL(file)} controls style={{ width: '100%', marginTop: 12 }} />
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={() => setStep(1)}>← Back</button>
                  <button className="btn primary" disabled={!file} onClick={() => setStep(3)}>Next →</button>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <div className="modal-step">Step 3 of 3 · Name</div>
                <h3 style={{ marginBottom: 12, fontSize: 16 }}>Name this voice</h3>
                <input className="input" placeholder="e.g. My voice" value={voiceName}
                  onChange={e => setVoiceName(e.target.value)} maxLength={60} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={() => setStep(2)}>← Back</button>
                  <button className="btn primary" disabled={submitting || !voiceName.trim()} onClick={handleSubmit}>
                    {submitting ? 'Cloning…' : 'Clone voice'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `src/app/avatars/page.tsx`**

Replace the file's content (adds a new card after the existing avatars card, before the closing `</AppFrame>`):

```tsx
import { AppFrame } from '@/components/AppFrame';
import { requireSession } from '@/lib/session';
import { getCandidateProfile } from '@/lib/candidate';
import { listAvatars } from '@/lib/avatars';
import { AvatarLibrary } from '@/components/AvatarLibrary';
import { AvatarManager } from '@/components/AvatarManager';
import { VoiceCloneManager } from '@/components/VoiceCloneManager';
import { can } from '@/lib/permissions';

export default async function AvatarsPage() {
  const s = await requireSession();
  const [profile, avatars] = await Promise.all([
    getCandidateProfile(s.campaignId),
    listAvatars(s.campaignId),
  ]);
  const canManageAvatars = can(s.role, 'manage_avatars');

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">Configuration</span><h1>Avatars</h1></div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 6 }}>Candidate avatars</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
          Create an AI avatar of your candidate from photos, then pick a look and video format for campaign videos.
        </p>
        <AvatarManager
          avatars={avatars}
          activeAvatarId={profile?.activeAvatarId ?? null}
          canManage={canManageAvatars}
        />
        {profile?.heygenBaseAvatarId && (
          <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
            <AvatarLibrary
              baseAvatarId={profile.heygenBaseAvatarId}
              currentAvatarId={profile?.heygenAvatarId}
              currentAspectRatio={profile?.videoAspectRatio}
            />
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 6 }}>Candidate voice</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
          Clone your candidate&rsquo;s voice from an audio sample to use for campaign videos, instead of waiting on an admin to assign one.
        </p>
        <VoiceCloneManager
          status={profile?.selfVoiceCloneStatus ?? null}
          name={profile?.selfVoiceName ?? null}
          error={profile?.selfVoiceCloneError ?? null}
          canManage={canManageAvatars}
        />
      </div>
    </AppFrame>
  );
}
```

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`, sign in as an `owner`-role session, navigate to `/avatars`, and confirm:
- The "Candidate voice" card renders below the avatars card.
- "Clone your voice" opens the 3-step modal; the consent checkbox gates step 2; a non-audio file is rejected by the file picker's `accept` filter.
- Submitting with `HEYGEN_API_KEY` unset (mock mode) shows the toast, closes the modal, and the card shows "Ready" within one poll cycle (mock returns `ready` instantly, but the UI still needs one `router.refresh()` — reload the page if it doesn't visibly update within 5s).

- [ ] **Step 4: Commit**

```bash
git add src/components/VoiceCloneManager.tsx src/app/avatars/page.tsx
git commit -m "feat(avatars): add self-service voice cloning UI"
```

---

### Task 6: Wire self-clone into `generateVideoAction`'s voice resolution

**Files:**
- Modify: `src/app/actions.ts:365-369` (`generateVideoAction`)
- Test: Create `src/app/actions.generate-video-voice.test.ts`

**Interfaces:**
- Consumes: `profile.selfVoiceCloneId`/`selfVoiceCloneStatus` (Task 2), `profile.heygenVoiceId` (existing, untouched).
- Produces: no new exports — changes `generateVideoAction`'s internal voice-id resolution only.

- [ ] **Step 1: Write the failing tests**

Check whether `src/app/actions.generate-video.test.ts` (or similar) already exists and covers `generateVideoAction`:

Run: `ls src/app/actions*.test.ts | xargs grep -l generateVideoAction`

If an existing test file covers it, add these cases there instead of creating a new file (to avoid duplicate mocks); otherwise create `src/app/actions.generate-video-voice.test.ts` using the same mock scaffolding as Task 4's test file (session, campaign, `@/lib/supabase`, `@/lib/candidate`, `@/lib/services` with a `videoProvider` mock added), plus:

```typescript
// Add a `videoProvider` mock (not present in Task 4's scaffold) to the
// '@/lib/services' mock: `videoProvider: { generateAvatarVideo: vi.fn(() => Promise.resolve({ videoId: 'video-1' })), getVideoStatus: vi.fn() }`
// and mock `@/domain/quota` period-start helpers / `quotaGate.checkAndIncrement` to resolve.

describe('generateVideoAction voice resolution', () => {
  it('prefers a ready self-clone over the admin-assigned heygenVoiceId', async () => {
    getCandidateProfile.mockResolvedValue({
      heygenAvatarId: 'avatar-1',
      heygenVoiceId: 'admin-voice-1',
      selfVoiceCloneId: 'self-clone-1',
      selfVoiceCloneStatus: 'ready',
    });
    const { generateVideoAction } = await import('./actions');
    const { videoProvider } = await import('@/lib/services');

    await generateVideoAction('content-1', 'script text');

    expect(videoProvider.generateAvatarVideo).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'self-clone-1' }));
  });

  it('falls back to the admin-assigned heygenVoiceId when there is no ready self-clone', async () => {
    getCandidateProfile.mockResolvedValue({
      heygenAvatarId: 'avatar-1',
      heygenVoiceId: 'admin-voice-1',
      selfVoiceCloneId: 'self-clone-1',
      selfVoiceCloneStatus: 'training',
    });
    const { generateVideoAction } = await import('./actions');
    const { videoProvider } = await import('@/lib/services');

    await generateVideoAction('content-1', 'script text');

    expect(videoProvider.generateAvatarVideo).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'admin-voice-1' }));
  });

  it('still errors when neither a ready self-clone nor an admin voice exists', async () => {
    getCandidateProfile.mockResolvedValue({ heygenAvatarId: 'avatar-1', heygenVoiceId: null, selfVoiceCloneId: null, selfVoiceCloneStatus: null });
    const { generateVideoAction } = await import('./actions');

    const result = await generateVideoAction('content-1', 'script text');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no video voice/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run <the test file from Step 1>`
Expected: FAIL on the first case — `generateAvatarVideo` is called with `voiceId: 'admin-voice-1'` (the old behavior), not `'self-clone-1'`.

- [ ] **Step 3: Update `generateVideoAction`'s voice resolution** (`src/app/actions.ts:365`)

Replace:

```typescript
  const heygenVoiceId = overrides?.voiceId ?? profile?.heygenVoiceId ?? undefined;
```

with:

```typescript
  const heygenVoiceId = overrides?.voiceId
    // A ready self-clone takes precedence over the admin-assigned heygen_voice_id
    // — self-service is the primary path once it exists, admin assignment is
    // the fallback for campaigns that haven't cloned their own voice.
    ?? (profile?.selfVoiceCloneStatus === 'ready' ? profile?.selfVoiceCloneId ?? undefined : undefined)
    ?? profile?.heygenVoiceId
    ?? undefined;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run <the test file from Step 1>`
Expected: PASS

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS (all existing tests, including any pre-existing `generateVideoAction` tests, still pass — the fallback chain's final two links are unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/app/actions.ts src/app/actions.generate-video-voice.test.ts
git commit -m "feat(video): prefer a ready self-service voice clone over the admin-assigned voice"
```

---

## Post-Implementation Checklist

- [ ] Re-read `docs/superpowers/specs/2026-08-02-self-service-voice-cloning-design.md` and confirm every section has a corresponding completed task above.
- [ ] Confirm `heygen_voice_id` (admin column) was never written or deleted anywhere in the new code (`grep -n "heygen_voice_id\|heygenVoiceId" src/app/actions.ts` — every write should be pre-existing `assignVoiceAction` in `src/app/admin/actions.ts`, untouched).
- [ ] Run `npx vitest run` once more for the full suite.
- [ ] Manually verify in the browser end-to-end: clone a voice, confirm it shows "Ready", generate a video and confirm the request uses the self-clone id (check via `getVoiceCloneStatus`/network tab in mock mode, or HeyGen dashboard in real mode), then replace the voice and confirm the old clone is deleted (`deleteVoiceClone` called) before the new one is created.
