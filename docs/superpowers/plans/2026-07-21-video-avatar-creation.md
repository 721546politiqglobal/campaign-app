# Video-Based (Digital Twin) Avatar Creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let campaign staff create a HeyGen "Digital Twin" (video-trained) avatar in-app, alongside the existing photo-avatar flow, using HeyGen's v3 API.

**Architecture:** Extend the existing `avatars` table/provider/UI with a `sourceType` discriminator (`'photo' | 'digital_twin'`) rather than building a parallel system. Staff upload a training-footage video the same way photos are uploaded today; HeyGen's own hosted webcam page (Level 1 consent, no Enterprise gate) handles the candidate's consent recording, returning a URL this app surfaces and polls.

**Tech Stack:** Next.js App Router server actions, Supabase (Postgres + Storage), HeyGen v3 REST API (raw `fetch`, no SDK), Vitest.

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-07-21-video-avatar-creation-design.md` — every task below implements a section of it; if anything here conflicts with that file, the spec wins and this plan should be corrected.
- No new dependencies (no HeyGen SDK, no `tsx`/`ts-node`) — match the existing raw-`fetch` provider style and Node's native `fetch`/ESM for the verification script.
- No RLS-equivalent trust boundary changes — every new/modified server action must check `avatar.campaignId === s.campaignId` and gate on `can(s.role, 'manage_avatars')`, exactly like the existing avatar actions.
- Do NOT run `git commit` at any point while executing this plan — the user reviews and commits the changes themselves. Stop after each task's tests pass; do not stage or commit.
- HeyGen Digital Twin API access on this account is **unconfirmed** — Task 1 produces a script for the user to run against production credentials; the remaining tasks build against the documented/inferred v3 shapes with defensive fallbacks (never trust an unrecognized enum value from HeyGen), so they proceed regardless of when the user actually runs that script.

---

### Task 1: Standalone HeyGen Digital Twin verification script

**Files:**
- Create: `scripts/verify-heygen-digital-twin.mjs`

**Interfaces:**
- Produces: nothing consumed by later tasks — this is a manual, out-of-band tool for the user to run against real credentials before relying on this feature in production. It exists to answer the open question in the spec ("does this account have Digital Twin access, and what do the real response shapes look like").

- [ ] **Step 1: Write the script**

```js
// scripts/verify-heygen-digital-twin.mjs
//
// Manual verification tool — NOT part of the app runtime.
// Confirms this HeyGen account has Digital Twin (video avatar) API access
// and prints the real response shapes, since third-party documentation was
// the only source available while designing this feature.
//
// Usage:
//   HEYGEN_API_KEY=... node scripts/verify-heygen-digital-twin.mjs <training_footage_url>
//
// <training_footage_url> must be a publicly reachable MP4 (2-5 min, 720p+,
// one continuous shot of the person talking on camera, per HeyGen's
// requirements). Upload a test clip anywhere public (e.g. Supabase Storage
// with a public URL) and pass that URL.

const apiKey = process.env.HEYGEN_API_KEY;
const videoUrl = process.argv[2];

if (!apiKey) {
  console.error('Set HEYGEN_API_KEY in the environment before running this script.');
  process.exit(1);
}
if (!videoUrl) {
  console.error('Usage: node scripts/verify-heygen-digital-twin.mjs <training_footage_url>');
  process.exit(1);
}

async function main() {
  console.log('1. Uploading training footage as a HeyGen asset...');
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) {
    console.error(`Could not fetch the training footage URL itself (${videoRes.status}). It must be public.`);
    process.exit(1);
  }
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

  const form = new FormData();
  form.append('file', new Blob([videoBuffer], { type: 'video/mp4' }), 'training.mp4');
  const uploadRes = await fetch('https://api.heygen.com/v3/assets', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: form,
  });
  const uploadJson = await uploadRes.json().catch(() => ({}));
  console.log(`   Status: ${uploadRes.status}`);
  console.log('   Body:', JSON.stringify(uploadJson, null, 2));
  const assetId = uploadJson?.data?.asset_id;
  if (!uploadRes.ok || !assetId) {
    console.error('   Asset upload failed or returned no asset_id — stopping here.');
    process.exit(1);
  }

  console.log('\n2. Creating a digital_twin avatar from that asset...');
  const createRes = await fetch('https://api.heygen.com/v3/avatars', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'digital_twin', name: 'verification-spike', file: { type: 'asset_id', asset_id: assetId } }),
  });
  const createJson = await createRes.json().catch(() => ({}));
  console.log(`   Status: ${createRes.status}`);
  console.log('   Body:', JSON.stringify(createJson, null, 2));
  if (createRes.status === 403 || createRes.status === 401) {
    console.error('\n   This looks like an access/plan problem: this HeyGen account may not have Digital Twin enabled.');
    process.exit(1);
  }
  const groupId = createJson?.data?.avatar_group?.id ?? createJson?.data?.avatar_item?.group_id;
  if (!createRes.ok || !groupId) {
    console.error('   Digital twin creation failed or returned no group id — stopping here.');
    process.exit(1);
  }

  console.log('\n3. Requesting Level-1 (hosted webcam) consent...');
  const consentRes = await fetch(`https://api.heygen.com/v3/avatars/${encodeURIComponent(groupId)}/consent`, {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const consentJson = await consentRes.json().catch(() => ({}));
  console.log(`   Status: ${consentRes.status}`);
  console.log('   Body:', JSON.stringify(consentJson, null, 2));

  console.log('\n4. Fetching the avatar group status directly...');
  const statusRes = await fetch(`https://api.heygen.com/v3/avatars/${encodeURIComponent(groupId)}`, {
    headers: { 'X-Api-Key': apiKey },
  });
  const statusJson = await statusRes.json().catch(() => ({}));
  console.log(`   Status: ${statusRes.status}`);
  console.log('   Body:', JSON.stringify(statusJson, null, 2));

  console.log('\nDone. Compare the "Body" shapes above against src/integrations/index.ts\'s');
  console.log('createVideoAvatar/requestConsent/getAvatarGroupStatus parsing (added later in this');
  console.log('plan) and adjust the field paths there if the real shape differs.');
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it once with no API key to confirm the guard rails work**

Run: `node scripts/verify-heygen-digital-twin.mjs https://example.com/test.mp4`
Expected output: `Set HEYGEN_API_KEY in the environment before running this script.` and a non-zero exit code (verifies the script is syntactically valid and its argument checks work, without needing real credentials yet).

- [ ] **Step 3: Note for the user (not an automated step)**

Before relying on this feature in production, run:
```bash
HEYGEN_API_KEY=<real key> node scripts/verify-heygen-digital-twin.mjs <public URL of a real 2-5 min test video>
```
and compare the printed response bodies against the parsing added in Tasks 4-5 below.

---

### Task 2: Data model — migration + domain types

**Files:**
- Create: `supabase/migrations/027_avatar_digital_twin.sql`
- Modify: `src/domain/types.ts:88-103`

**Interfaces:**
- Produces: `AvatarStatus` (adds `'pending_consent'`), new `Avatar` fields `sourceType`, `sourceVideoUrl`, `consentStatus`, `consentUrl` — every later task's types build on these exact names.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/027_avatar_digital_twin.sql
-- Adds support for HeyGen Digital Twin (video-trained) avatars alongside
-- the existing photo-avatar flow. See
-- docs/superpowers/specs/2026-07-21-video-avatar-creation-design.md.

alter table avatars
  add column if not exists source_type text not null default 'photo' check (source_type in ('photo', 'digital_twin')),
  add column if not exists source_video_url text,
  add column if not exists consent_status text check (consent_status in ('pending', 'approved', 'declined')),
  add column if not exists consent_url text;

alter table avatars drop constraint avatars_status_check;
alter table avatars add constraint avatars_status_check
  check (status in ('pending_consent', 'training', 'ready', 'failed'));
```

- [ ] **Step 2: Update the domain types**

In `src/domain/types.ts`, replace:

```ts
export type AvatarStatus = 'training' | 'ready' | 'failed';

export interface Avatar {
  id: string;
  campaignId: string;
  name: string;
  status: AvatarStatus;
  heygenGroupId?: string | null;
  heygenLookId?: string | null;
  sourcePhotoUrls: string[];
  errorMessage?: string | null;
  consentConfirmedBy: string;
  consentConfirmedAt: string;
  createdBy: string;
  createdAt: string;
}
```

with:

```ts
export type AvatarStatus = 'pending_consent' | 'training' | 'ready' | 'failed';
export type AvatarSourceType = 'photo' | 'digital_twin';
export type AvatarConsentStatus = 'pending' | 'approved' | 'declined';

export interface Avatar {
  id: string;
  campaignId: string;
  name: string;
  status: AvatarStatus;
  sourceType: AvatarSourceType;
  heygenGroupId?: string | null;
  heygenLookId?: string | null;
  sourcePhotoUrls: string[];
  sourceVideoUrl?: string | null;
  consentStatus?: AvatarConsentStatus | null;
  consentUrl?: string | null;
  errorMessage?: string | null;
  consentConfirmedBy: string;
  consentConfirmedAt: string;
  createdBy: string;
  createdAt: string;
}
```

- [ ] **Step 3: Confirm no type errors yet**

Run: `npm run typecheck`
Expected: FAIL — `src/lib/avatars.ts`'s `toAvatar()` and `insertAvatar()` no longer satisfy the `Avatar`/parameter shape (missing `sourceType`). This is expected; Task 3 fixes it.

---

### Task 3: `src/lib/avatars.ts` — map new columns

**Files:**
- Modify: `src/lib/avatars.ts`
- Test: `src/lib/avatars.test.ts`

**Interfaces:**
- Consumes: `Avatar`, `AvatarStatus`, `AvatarSourceType`, `AvatarConsentStatus` from Task 2.
- Produces: `insertAvatar(input)` accepts `sourceType?`, `sourceVideoUrl?`, `consentStatus?`, `consentUrl?`; `updateAvatarStatus(id, status, opts)` accepts `opts.consentStatus?`, `opts.consentUrl?`. Task 6/7 call these with these exact option names.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/avatars.test.ts` (inside the existing `describe('insertAvatar', ...)` block, as new `it`s):

```ts
  it('defaults sourceType to photo when omitted', async () => {
    const { insertAvatar } = await import('./avatars');
    await insertAvatar({ id: 'av-3', campaignId: 'c-1', name: 'A', sourcePhotoUrls: ['u1'], consentConfirmedBy: 'u-1', createdBy: 'u-1' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ source_type: 'photo' }));
  });

  it('maps digital_twin fields when creating a video avatar', async () => {
    const { insertAvatar } = await import('./avatars');
    await insertAvatar({
      id: 'av-4', campaignId: 'c-1', name: 'A', sourcePhotoUrls: [],
      sourceType: 'digital_twin', sourceVideoUrl: 'https://media.test/training.mp4',
      consentConfirmedBy: 'u-1', createdBy: 'u-1',
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      source_type: 'digital_twin', source_video_url: 'https://media.test/training.mp4',
    }));
  });
```

Add a new `describe` block at the end of the file:

```ts
describe('updateAvatarStatus with consent fields', () => {
  it('updates consentStatus and consentUrl alongside status', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }));
    update.mockReturnValueOnce({ eq } as any);
    const { updateAvatarStatus } = await import('./avatars');
    await updateAvatarStatus('av-1', 'pending_consent', { consentStatus: 'pending', consentUrl: 'https://app.heygen.com/consent/abc' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending_consent', consent_status: 'pending', consent_url: 'https://app.heygen.com/consent/abc',
    }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- avatars.test.ts`
Expected: FAIL — `source_type`/`consent_status`/`consent_url` are not present in `insert`/`update` calls yet (the current implementation doesn't write these columns).

- [ ] **Step 3: Implement**

Replace the full contents of `src/lib/avatars.ts` with:

```ts
// src/lib/avatars.ts
import { adminDb, throwOnError } from './supabase';
import { Avatar, AvatarStatus, AvatarSourceType, AvatarConsentStatus } from '@/domain/types';

function toAvatar(r: Record<string, unknown>): Avatar {
  return {
    id: r.id as string,
    campaignId: r.campaign_id as string,
    name: r.name as string,
    status: r.status as AvatarStatus,
    sourceType: (r.source_type as AvatarSourceType | null) ?? 'photo',
    heygenGroupId: (r.heygen_group_id as string | null) ?? null,
    heygenLookId: (r.heygen_look_id as string | null) ?? null,
    sourcePhotoUrls: (r.source_photo_urls as string[]) ?? [],
    sourceVideoUrl: (r.source_video_url as string | null) ?? null,
    consentStatus: (r.consent_status as AvatarConsentStatus | null) ?? null,
    consentUrl: (r.consent_url as string | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    consentConfirmedBy: r.consent_confirmed_by as string,
    consentConfirmedAt: r.consent_confirmed_at as string,
    createdBy: r.created_by as string,
    createdAt: r.created_at as string,
  };
}

export async function listAvatars(campaignId: string): Promise<Avatar[]> {
  const { data } = await adminDb
    .from('avatars')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  return (data ?? []).map(toAvatar);
}

export async function getAvatar(id: string): Promise<Avatar | null> {
  const { data } = await adminDb.from('avatars').select('*').eq('id', id).single();
  return data ? toAvatar(data) : null;
}

export async function insertAvatar(input: {
  id: string;
  campaignId: string;
  name: string;
  sourcePhotoUrls: string[];
  consentConfirmedBy: string;
  createdBy: string;
  status?: AvatarStatus;
  sourceType?: AvatarSourceType;
  sourceVideoUrl?: string | null;
  consentStatus?: AvatarConsentStatus | null;
  consentUrl?: string | null;
  heygenGroupId?: string | null;
  heygenLookId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await throwOnError(
    adminDb.from('avatars').insert({
      id: input.id,
      campaign_id: input.campaignId,
      name: input.name,
      status: input.status ?? 'training',
      source_type: input.sourceType ?? 'photo',
      heygen_group_id: input.heygenGroupId ?? null,
      heygen_look_id: input.heygenLookId ?? null,
      source_photo_urls: input.sourcePhotoUrls,
      source_video_url: input.sourceVideoUrl ?? null,
      consent_status: input.consentStatus ?? null,
      consent_url: input.consentUrl ?? null,
      error_message: input.errorMessage ?? null,
      consent_confirmed_by: input.consentConfirmedBy,
      created_by: input.createdBy,
    }),
    'avatars.insert',
  );
}

export async function updateAvatarStatus(
  id: string,
  status: AvatarStatus,
  opts?: {
    heygenGroupId?: string | null;
    heygenLookId?: string | null;
    errorMessage?: string | null;
    consentStatus?: AvatarConsentStatus | null;
    consentUrl?: string | null;
  },
): Promise<void> {
  await throwOnError(
    adminDb.from('avatars').update({
      status,
      ...(opts?.heygenGroupId !== undefined && { heygen_group_id: opts.heygenGroupId }),
      ...(opts?.heygenLookId !== undefined && { heygen_look_id: opts.heygenLookId }),
      ...(opts?.errorMessage !== undefined && { error_message: opts.errorMessage }),
      ...(opts?.consentStatus !== undefined && { consent_status: opts.consentStatus }),
      ...(opts?.consentUrl !== undefined && { consent_url: opts.consentUrl }),
    }).eq('id', id),
    'avatars.updateStatus',
  );
}

export async function deleteAvatarRow(id: string): Promise<void> {
  await throwOnError(
    adminDb.from('avatars').delete().eq('id', id),
    'avatars.delete',
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- avatars.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: Still FAILS in `src/integrations/index.ts` / `src/app/actions.ts` (Tasks 4-7 haven't run yet) — no new failures introduced by this task itself. Confirm the only errors mention `PhotoAvatarProvider`/`createVideoAvatarAction`, not `src/lib/avatars.ts`.

---

### Task 4: Provider methods — `createVideoAvatar` and `requestConsent`

**Files:**
- Modify: `src/integrations/index.ts:37-48` (interface), `src/integrations/index.ts:182-262` (`HeyGenPhotoAvatarProvider`), `src/integrations/index.ts:396-403` (`MockPhotoAvatarProvider`)
- Test: `src/integrations/index.test.ts`

**Interfaces:**
- Produces: `PhotoAvatarProvider.createVideoAvatar({ name, assetId }): Promise<{ lookId: string; groupId: string }>` and `PhotoAvatarProvider.requestConsent({ groupId, rerouteUrl? }): Promise<{ consentUrl?: string; consentStatus: 'pending' | 'approved' | 'declined' }>`. Task 6 calls both by these exact names/shapes.

- [ ] **Step 1: Write the failing tests**

First, update the import at the top of `src/integrations/index.test.ts`:

```ts
import { HeyGenPhotoAvatarProvider, MockPhotoAvatarProvider, ClaudeContentGenerator, HeyGenAccessDeniedError } from './index';
```

Then add, after the existing `describe('HeyGenPhotoAvatarProvider.createAvatarLook', ...)` block:

```ts
describe('HeyGenPhotoAvatarProvider.createVideoAvatar', () => {
  it('creates a digital_twin avatar from an uploaded asset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { avatar_item: { id: 'look_dt_1', group_id: 'group_dt_1' }, avatar_group: { id: 'group_dt_1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.createVideoAvatar({ name: 'Candidate twin', assetId: 'asset_video_1' });

    expect(result).toEqual({ lookId: 'look_dt_1', groupId: 'group_dt_1' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.heygen.com/v3/avatars');
    const body = JSON.parse(opts.body);
    expect(body).toEqual({ type: 'digital_twin', name: 'Candidate twin', file: { type: 'asset_id', asset_id: 'asset_video_1' } });
  });

  it('throws a generic error with the HeyGen message for a non-access failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'invalid training footage' } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    await expect(provider.createVideoAvatar({ name: 'n', assetId: 'a' }))
      .rejects.toThrow('invalid training footage');
  });

  it('throws HeyGenAccessDeniedError specifically on a 403 (account not enabled for Digital Twin)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'digital twin not enabled for this account' } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    await expect(provider.createVideoAvatar({ name: 'n', assetId: 'a' }))
      .rejects.toBeInstanceOf(HeyGenAccessDeniedError);
  });

  it('throws HeyGenAccessDeniedError specifically on a 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'invalid api key' } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    await expect(provider.createVideoAvatar({ name: 'n', assetId: 'a' }))
      .rejects.toBeInstanceOf(HeyGenAccessDeniedError);
  });
});

describe('HeyGenPhotoAvatarProvider.requestConsent', () => {
  it('requests Level 1 (hosted webcam) consent and returns the url + status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { url: 'https://app.heygen.com/consent/abc', avatar_group: { id: 'group_dt_1', consent_status: 'pending' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.requestConsent({ groupId: 'group_dt_1', rerouteUrl: 'https://app.test/avatars' });

    expect(result).toEqual({ consentUrl: 'https://app.heygen.com/consent/abc', consentStatus: 'pending' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.heygen.com/v3/avatars/group_dt_1/consent');
    expect(JSON.parse(opts.body)).toEqual({ reroute_url: 'https://app.test/avatars' });
  });

  it('falls back to "pending" when HeyGen returns an unrecognized consent_status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { url: 'https://app.heygen.com/consent/abc', avatar_group: { consent_status: 'something_new' } } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.requestConsent({ groupId: 'group_dt_1' });

    expect(result.consentStatus).toBe('pending');
  });
});
```

Add to the existing `describe('MockPhotoAvatarProvider', ...)` block:

```ts
  it('creates a mock digital twin and returns instantly-approved consent', async () => {
    const provider = new MockPhotoAvatarProvider();
    const { assetId } = await provider.uploadAsset(Buffer.from('x'), 'video/mp4');
    const { groupId } = await provider.createVideoAvatar({ name: 'n', assetId });
    const { consentStatus } = await provider.requestConsent({ groupId });
    expect(consentStatus).toBe('approved');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- index.test.ts`
Expected: FAIL — `createVideoAvatar`/`requestConsent` don't exist on `HeyGenPhotoAvatarProvider`/`MockPhotoAvatarProvider` yet.

- [ ] **Step 3: Implement — extend the interface**

In `src/integrations/index.ts`, replace the `PhotoAvatarProvider` interface:

```ts
export interface PhotoAvatarProvider {
  uploadAsset(buffer: Buffer, contentType: string): Promise<{ assetId: string }>;
  createAvatarLook(input: { name: string; assetId: string; avatarGroupId?: string }):
    Promise<{ lookId: string; groupId: string }>;
  createPromptLook(input: { name: string; prompt: string; avatarId: string }):
    Promise<{ lookId: string; groupId: string }>;
  createVideoAvatar(input: { name: string; assetId: string }):
    Promise<{ lookId: string; groupId: string }>;
  requestConsent(input: { groupId: string; rerouteUrl?: string }):
    Promise<{ consentUrl?: string; consentStatus: 'pending' | 'approved' | 'declined' }>;
  getAvatarGroupStatus(groupId: string): Promise<{
    status: 'processing' | 'pending_consent' | 'completed' | 'failed';
    previewImageUrl?: string;
    error?: { code: string; message: string };
    consentStatus?: 'pending' | 'approved' | 'declined' | null;
  }>;
}
```

- [ ] **Step 4: Implement — add an access-denied error type and the two methods to `HeyGenPhotoAvatarProvider`**

In `src/integrations/index.ts`, add this new exported class near the top of the "HeyGen photo avatar provider" section (just above the `HeyGenPhotoAvatarProvider` class declaration):

```ts
// Thrown specifically for 401/403 responses from Digital Twin creation, so
// callers can distinguish "this HeyGen account isn't enabled for Digital
// Twin" from any other failure and show a clear, actionable message instead
// of a generic one.
export class HeyGenAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeyGenAccessDeniedError';
  }
}
```

Then add these two methods to the `HeyGenPhotoAvatarProvider` class, directly after `createPromptLook` (before `getAvatarGroupStatus`):

```ts
  async createVideoAvatar({ name, assetId }: { name: string; assetId: string }) {
    const res = await fetch('https://api.heygen.com/v3/avatars', {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'digital_twin', name, file: { type: 'asset_id', asset_id: assetId } }),
    });
    const json = await res.json();
    if (!res.ok) {
      const message = json.error?.message ?? `HeyGen create digital twin error: ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new HeyGenAccessDeniedError(message);
      throw new Error(`HeyGen create digital twin error: ${message}`);
    }
    const lookId = json.data?.avatar_item?.id;
    const groupId = json.data?.avatar_group?.id ?? json.data?.avatar_item?.group_id;
    if (!lookId || !groupId) throw new Error('HeyGen did not return a look/group id.');
    return { lookId, groupId };
  }

  // Level 1 consent only — the candidate completes a hosted webcam recording
  // on HeyGen's own page. Level 2 (submitting a pre-recorded consent clip
  // directly) is Enterprise-whitelisted only and out of scope here.
  async requestConsent({ groupId, rerouteUrl }: { groupId: string; rerouteUrl?: string }) {
    const res = await fetch(`https://api.heygen.com/v3/avatars/${encodeURIComponent(groupId)}/consent`, {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(rerouteUrl ? { reroute_url: rerouteUrl } : {}),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`HeyGen consent request error: ${json.error?.message ?? res.status}`);
    const raw = json.data?.avatar_group?.consent_status ?? json.data?.consent_status;
    const KNOWN_CONSENT = ['pending', 'approved', 'declined'] as const;
    const consentStatus = (KNOWN_CONSENT as readonly string[]).includes(raw) ? raw as typeof KNOWN_CONSENT[number] : 'pending';
    return { consentUrl: json.data?.url as string | undefined, consentStatus };
  }
```

- [ ] **Step 5: Implement — add mocks to `MockPhotoAvatarProvider`**

In `src/integrations/index.ts`, add to `MockPhotoAvatarProvider`:

```ts
  async createVideoAvatar(_input: { name: string; assetId: string }) { return { lookId: 'mock-video-look-id', groupId: 'mock-video-group-id' }; }
  // Mock mode simulates instant success everywhere else in this file
  // (MockVideoProvider, MockPublisher) — consent resolves instantly too so
  // local dev without HEYGEN_API_KEY can exercise the full flow end to end.
  async requestConsent(_input: { groupId: string; rerouteUrl?: string }) {
    return { consentUrl: 'https://app.heygen.com/mock-consent', consentStatus: 'approved' as const };
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- index.test.ts`
Expected: PASS.

---

### Task 5: Extend `getAvatarGroupStatus` to surface `consentStatus`

**Files:**
- Modify: `src/integrations/index.ts:245-261`
- Test: `src/integrations/index.test.ts` (modifies two existing tests, adds one)

**Interfaces:**
- Consumes: the extended interface signature from Task 4.
- Produces: `getAvatarGroupStatus(groupId)` now also returns `consentStatus: 'pending' | 'approved' | 'declined' | null`. Task 7's `checkAvatarStatusAction` destructures this field by name.

- [ ] **Step 1: Update the two existing tests (they use exact `toEqual`, so they must be updated for the new field first)**

In `src/integrations/index.test.ts`, in `describe('HeyGenPhotoAvatarProvider.getAvatarGroupStatus', ...)`, change:

```ts
    expect(result).toEqual({ status: 'completed', previewImageUrl: 'https://example.com/1.jpg', error: undefined });
```
to:
```ts
    expect(result).toEqual({ status: 'completed', previewImageUrl: 'https://example.com/1.jpg', error: undefined, consentStatus: null });
```

and change:
```ts
    expect(result).toEqual({
      status: 'failed', previewImageUrl: undefined, error: { code: 'training_failed', message: 'bad photo' },
    });
```
to:
```ts
    expect(result).toEqual({
      status: 'failed', previewImageUrl: undefined, error: { code: 'training_failed', message: 'bad photo' }, consentStatus: null,
    });
```

Add a new test in the same `describe` block:

```ts
  it('surfaces consent_status for a digital twin group awaiting the candidate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'group_dt_1', status: 'pending_consent', consent_status: 'pending' } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.getAvatarGroupStatus('group_dt_1');

    expect(result).toEqual({ status: 'pending_consent', previewImageUrl: undefined, error: undefined, consentStatus: 'pending' });
  });
```

- [ ] **Step 2: Run tests to verify the new/modified ones fail**

Run: `npm test -- index.test.ts`
Expected: FAIL — actual results don't include `consentStatus` yet.

- [ ] **Step 3: Implement**

In `src/integrations/index.ts`, replace `getAvatarGroupStatus`'s body:

```ts
  async getAvatarGroupStatus(groupId: string) {
    const res = await fetch(`https://api.heygen.com/v3/avatars/${encodeURIComponent(groupId)}`, {
      headers: { 'X-Api-Key': this.apiKey },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`HeyGen get avatar error: ${json.error?.message ?? res.status}`);
    const raw = json.data?.status;
    const KNOWN = ['processing', 'pending_consent', 'completed', 'failed'] as const;
    const status = (KNOWN as readonly string[]).includes(raw) ? raw as typeof KNOWN[number] : 'failed';
    const rawConsent = json.data?.consent_status;
    const KNOWN_CONSENT = ['pending', 'approved', 'declined'] as const;
    const consentStatus = (KNOWN_CONSENT as readonly string[]).includes(rawConsent) ? rawConsent as typeof KNOWN_CONSENT[number] : null;
    return {
      status,
      previewImageUrl: json.data?.preview_image_url,
      error: json.data?.error,
      consentStatus,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- index.test.ts`
Expected: PASS.

---

### Task 6: `createVideoAvatarAction` server action

**Files:**
- Modify: `src/app/actions.ts` (add after `checkAvatarStatusAction`, i.e. after line 823 in the current file)
- Test: Create `src/app/actions.avatar-digital-twin.test.ts`

**Interfaces:**
- Consumes: `insertAvatar`/`updateAvatarStatus` (Task 3), `photoAvatarProvider.createVideoAvatar`/`requestConsent` (Task 4), `billingGate`/`usageMeter` (existing).
- Produces: `createVideoAvatarAction(formData): Promise<{ ok: true; avatarId: string } | { ok: false; error: string }>`. Task 8's UI calls this by this exact name, with a `FormData` carrying `consent`, `name`, `video` fields.

- [ ] **Step 1: Write the failing tests**

Create `src/app/actions.avatar-digital-twin.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapExceeded } from '@/domain/usage';

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
        upload: vi.fn(() => Promise.resolve({ error: null })),
        getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://media.test/${path}` } })),
      })),
    },
  },
}));

vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'avatar-1') }));

const insertAvatar = vi.fn(() => Promise.resolve());
const updateAvatarStatus = vi.fn(() => Promise.resolve());
const getAvatar = vi.fn();
vi.mock('@/lib/avatars', () => ({ insertAvatar, updateAvatarStatus, getAvatar }));

const billingGate = { check: vi.fn(() => Promise.resolve()) };
const usageMeter = { guard: vi.fn(() => Promise.resolve('res-1')), record: vi.fn(() => Promise.resolve()) };
const photoAvatarProvider = {
  uploadAsset: vi.fn(),
  createAvatarLook: vi.fn(),
  createPromptLook: vi.fn(),
  createVideoAvatar: vi.fn(),
  requestConsent: vi.fn(),
  getAvatarGroupStatus: vi.fn(),
};
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: {}, voiceProvider: {},
  billingGate, usageMeter, photoAvatarProvider,
}));

vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));

function makeVideoForm(overrides: Partial<{ consent: string; name: string; video: File }> = {}): FormData {
  const fd = new FormData();
  fd.set('consent', overrides.consent ?? 'on');
  fd.set('name', overrides.name ?? 'Candidate twin');
  fd.set('video', overrides.video ?? new File([new Uint8Array([1, 2, 3])], 'training.mp4', { type: 'video/mp4' }));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  billingGate.check.mockResolvedValue(undefined);
  usageMeter.guard.mockResolvedValue('res-1');
  usageMeter.record.mockResolvedValue(undefined);
});

describe('createVideoAvatarAction', () => {
  it('requires the consent checkbox', async () => {
    const { createVideoAvatarAction } = await import('./actions');
    const result = await createVideoAvatarAction(makeVideoForm({ consent: 'off' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/consent/i);
    expect(photoAvatarProvider.uploadAsset).not.toHaveBeenCalled();
  });

  it('rejects a non-video file', async () => {
    const { createVideoAvatarAction } = await import('./actions');
    const badFile = new File([new Uint8Array([1])], 'photo.jpg', { type: 'image/jpeg' });
    const result = await createVideoAvatarAction(makeVideoForm({ video: badFile }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/video/i);
  });

  it('checks the spend cap before calling HeyGen, and never calls HeyGen if the cap is exceeded', async () => {
    usageMeter.guard.mockRejectedValue(new CapExceeded('This campaign has reached its monthly spending cap. Raise the cap in Settings to continue.'));
    const { createVideoAvatarAction } = await import('./actions');

    const result = await createVideoAvatarAction(makeVideoForm());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/spending cap/);
    expect(photoAvatarProvider.uploadAsset).not.toHaveBeenCalled();
  });

  it('on success, persists the row as pending_consent with the consent url/status', async () => {
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.createVideoAvatar.mockResolvedValue({ lookId: 'look-1', groupId: 'group-1' });
    photoAvatarProvider.requestConsent.mockResolvedValue({ consentUrl: 'https://app.heygen.com/consent/abc', consentStatus: 'pending' });
    const { createVideoAvatarAction } = await import('./actions');

    const result = await createVideoAvatarAction(makeVideoForm());

    expect(result.ok).toBe(true);
    expect(insertAvatar).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'digital_twin', status: 'training' }));
    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'pending_consent', {
      heygenGroupId: 'group-1', heygenLookId: 'look-1', consentUrl: 'https://app.heygen.com/consent/abc', consentStatus: 'pending',
    });
    expect(usageMeter.record).toHaveBeenCalled();
  });

  it('marks the row failed (never silently dropped) when consent request fails after avatar creation', async () => {
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.createVideoAvatar.mockResolvedValue({ lookId: 'look-1', groupId: 'group-1' });
    photoAvatarProvider.requestConsent.mockRejectedValue(new Error('HeyGen consent request error: 500'));
    const { createVideoAvatarAction } = await import('./actions');

    const result = await createVideoAvatarAction(makeVideoForm());

    expect(result.ok).toBe(false);
    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'failed', expect.objectContaining({ errorMessage: expect.stringMatching(/consent/i) }));
  });

  it('shows a clear access-denied message (not a generic one) when this HeyGen account lacks Digital Twin access', async () => {
    const { HeyGenAccessDeniedError } = await import('@/integrations');
    photoAvatarProvider.uploadAsset.mockResolvedValue({ assetId: 'asset-1' });
    photoAvatarProvider.createVideoAvatar.mockRejectedValue(new HeyGenAccessDeniedError('digital twin not enabled for this account'));
    const { createVideoAvatarAction } = await import('./actions');

    const result = await createVideoAvatarAction(makeVideoForm());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/aren't enabled.*Digital Twin/i);
    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'failed', expect.objectContaining({ errorMessage: expect.stringMatching(/aren't enabled.*Digital Twin/i) }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- actions.avatar-digital-twin.test.ts`
Expected: FAIL — `createVideoAvatarAction` doesn't exist yet.

- [ ] **Step 3: Implement**

In `src/app/actions.ts`, add `HeyGenAccessDeniedError` to the existing `@/integrations`-adjacent imports — since `actions.ts` currently imports providers only via `@/lib/services`, add a new import line near the top (after the `@/lib/services` import):

```ts
import { HeyGenAccessDeniedError } from '@/integrations';
```

Then add after `checkAvatarStatusAction` (after the closing brace that currently ends at line 823):

```ts
const AVATAR_DIGITAL_TWIN_COST_CENTS = 5_00; // Placeholder — HeyGen's real Digital Twin credit cost is unconfirmed on this account; correct once the verification spike (scripts/verify-heygen-digital-twin.mjs) or HeyGen billing data shows the real figure.
const MAX_TRAINING_VIDEO_BYTES = 500 * 1024 * 1024;

export async function createVideoAvatarAction(formData: FormData): Promise<Result & { avatarId?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };

  const consent = formData.get('consent') === 'on';
  if (!consent) return { ok: false, error: 'Consent confirmation is required.' };

  const name = String(formData.get('name') ?? '').trim() || 'Avatar';
  const file = formData.get('video');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Upload a training video.' };
  if (file.size > MAX_TRAINING_VIDEO_BYTES) return { ok: false, error: 'Video must be under 500 MB.' };
  if (!file.type.startsWith('video/')) return { ok: false, error: 'Only video files are allowed.' };

  const campaign = await getCampaign(s.campaignId);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };

  let reservationId: string;
  try {
    await billingGate.check(s.campaignId);
    reservationId = await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, AVATAR_DIGITAL_TWIN_COST_CENTS);
  } catch (e) {
    if (e instanceof CapExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }

  const { insertAvatar, updateAvatarStatus } = await import('@/lib/avatars');
  const avatarId = uid();
  const buffer = Buffer.from(await file.arrayBuffer());

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'mp4';
  const filename = `avatars/${s.campaignId}/${avatarId}/training.${ext}`;
  const { error: uploadError } = await adminDb.storage.from('media').upload(filename, buffer, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) return { ok: false, error: uploadError.message };
  const { data } = adminDb.storage.from('media').getPublicUrl(filename);

  await insertAvatar({
    id: avatarId,
    campaignId: s.campaignId,
    name,
    sourceType: 'digital_twin',
    sourcePhotoUrls: [],
    sourceVideoUrl: data.publicUrl,
    consentConfirmedBy: s.userId,
    createdBy: s.userId,
    status: 'training',
  });

  let processedCost = 0;
  let createError: string | null = null;
  try {
    const { assetId } = await photoAvatarProvider.uploadAsset(buffer, file.type);
    const { groupId, lookId } = await photoAvatarProvider.createVideoAvatar({ name, assetId });
    const rerouteUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/avatars`;
    const { consentUrl, consentStatus } = await photoAvatarProvider.requestConsent({ groupId, rerouteUrl });
    processedCost = AVATAR_DIGITAL_TWIN_COST_CENTS;
    await updateAvatarStatus(avatarId, 'pending_consent', { heygenGroupId: groupId, heygenLookId: lookId, consentUrl, consentStatus });
  } catch (e) {
    const accessDenied = e instanceof HeyGenAccessDeniedError;
    createError = accessDenied
      ? "Video avatars aren't enabled for this HeyGen account. Contact HeyGen support to enable Digital Twin access."
      : e instanceof Error ? e.message : String(e);
    await updateAvatarStatus(avatarId, 'failed', { errorMessage: createError });
    // The access-denied message is already complete and user-facing — don't
    // wrap it with the generic "creation failed" prefix below.
    if (accessDenied) { revalidatePath('/avatars'); return { ok: false, error: createError }; }
  } finally {
    await usageMeter.record(reservationId, 'avatar_digital_twin_training', processedCost > 0 ? 1 : 0, processedCost);
  }

  revalidatePath('/avatars');
  if (createError) return { ok: false, error: `Video avatar creation failed: ${createError}` };
  return { ok: true, avatarId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- actions.avatar-digital-twin.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS (all suites, including the unmodified `actions.avatar-billing.test.ts`).

---

### Task 7: Extend `checkAvatarStatusAction` to poll `pending_consent`

**Files:**
- Modify: `src/app/actions.ts:808-823`
- Test: Create `src/app/actions.avatar-status-poll.test.ts`

**Interfaces:**
- Consumes: `photoAvatarProvider.getAvatarGroupStatus` (Task 5's extended return shape), `updateAvatarStatus` (Task 3).
- Produces: `checkAvatarStatusAction` now also polls when `avatar.status === 'pending_consent'`, transitioning to `'training'` once HeyGen reports `'processing'`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/actions.avatar-status-poll.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() })), storage: { from: vi.fn() } },
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn() }));

const getAvatar = vi.fn();
const updateAvatarStatus = vi.fn(() => Promise.resolve());
const insertAvatar = vi.fn();
vi.mock('@/lib/avatars', () => ({ getAvatar, updateAvatarStatus, insertAvatar }));

const photoAvatarProvider = {
  uploadAsset: vi.fn(), createAvatarLook: vi.fn(), createPromptLook: vi.fn(),
  createVideoAvatar: vi.fn(), requestConsent: vi.fn(), getAvatarGroupStatus: vi.fn(),
};
const billingGate = { check: vi.fn() };
const usageMeter = { guard: vi.fn(), record: vi.fn() };
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: {}, voiceProvider: {}, billingGate, usageMeter, photoAvatarProvider,
}));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));

const baseAvatar = {
  id: 'avatar-1', campaignId: 'c-1', name: 'Candidate twin', sourceType: 'digital_twin' as const,
  heygenGroupId: 'group-1', heygenLookId: 'look-1', sourcePhotoUrls: [],
  consentConfirmedBy: 'u-1', consentConfirmedAt: '2026-01-01T00:00:00Z', createdBy: 'u-1', createdAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('checkAvatarStatusAction — pending_consent handling', () => {
  it('polls a pending_consent row (not just training ones)', async () => {
    getAvatar.mockResolvedValue({ ...baseAvatar, status: 'pending_consent', consentStatus: 'pending' });
    photoAvatarProvider.getAvatarGroupStatus.mockResolvedValue({ status: 'pending_consent', consentStatus: 'pending' });
    const { checkAvatarStatusAction } = await import('./actions');

    await checkAvatarStatusAction('avatar-1');

    expect(photoAvatarProvider.getAvatarGroupStatus).toHaveBeenCalledWith('group-1');
  });

  it('refreshes consentStatus while still pending_consent, without changing local status', async () => {
    getAvatar.mockResolvedValue({ ...baseAvatar, status: 'pending_consent', consentStatus: 'pending' });
    photoAvatarProvider.getAvatarGroupStatus.mockResolvedValue({ status: 'pending_consent', consentStatus: 'pending' });
    const { checkAvatarStatusAction } = await import('./actions');

    await checkAvatarStatusAction('avatar-1');

    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'pending_consent', { consentStatus: 'pending' });
  });

  it('transitions pending_consent to training once HeyGen reports processing', async () => {
    getAvatar.mockResolvedValue({ ...baseAvatar, status: 'pending_consent', consentStatus: 'pending' });
    photoAvatarProvider.getAvatarGroupStatus.mockResolvedValue({ status: 'processing', consentStatus: 'approved' });
    const { checkAvatarStatusAction } = await import('./actions');

    await checkAvatarStatusAction('avatar-1');

    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'training', { consentStatus: 'approved' });
  });

  it('still transitions training rows straight to ready, unchanged from before', async () => {
    getAvatar.mockResolvedValue({ ...baseAvatar, status: 'training' });
    photoAvatarProvider.getAvatarGroupStatus.mockResolvedValue({ status: 'completed', consentStatus: 'approved' });
    const { checkAvatarStatusAction } = await import('./actions');

    await checkAvatarStatusAction('avatar-1');

    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'ready');
  });

  it('does nothing for a ready avatar', async () => {
    getAvatar.mockResolvedValue({ ...baseAvatar, status: 'ready' });
    const { checkAvatarStatusAction } = await import('./actions');

    await checkAvatarStatusAction('avatar-1');

    expect(photoAvatarProvider.getAvatarGroupStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- actions.avatar-status-poll.test.ts`
Expected: FAIL — current `checkAvatarStatusAction` returns early for `pending_consent` rows (`avatar.status !== 'training'` guard).

- [ ] **Step 3: Implement**

In `src/app/actions.ts`, replace `checkAvatarStatusAction`:

```ts
export async function checkAvatarStatusAction(avatarId: string): Promise<Result> {
  const s = await requireSession();
  const { getAvatar, updateAvatarStatus } = await import('@/lib/avatars');
  const avatar = await getAvatar(avatarId);
  if (!avatar || avatar.campaignId !== s.campaignId) return { ok: false, error: 'Avatar not found.' };
  if ((avatar.status !== 'training' && avatar.status !== 'pending_consent') || !avatar.heygenGroupId) return { ok: true };

  const { status, error, consentStatus } = await photoAvatarProvider.getAvatarGroupStatus(avatar.heygenGroupId);
  if (status === 'failed') {
    await updateAvatarStatus(avatarId, 'failed', { errorMessage: error?.message ?? 'Avatar training failed.' });
  } else if (status === 'completed') {
    await updateAvatarStatus(avatarId, 'ready');
  } else if (status === 'pending_consent') {
    // Still waiting on the candidate to complete HeyGen's hosted consent
    // recording — just refresh consentStatus in case it changed.
    await updateAvatarStatus(avatarId, 'pending_consent', { consentStatus });
  } else if (avatar.status === 'pending_consent' && status === 'processing') {
    // Consent was approved since the last poll — HeyGen has started training.
    await updateAvatarStatus(avatarId, 'training', { consentStatus });
  }
  revalidatePath('/avatars');
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- actions.avatar-status-poll.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS.

---

### Task 8: `AvatarManager.tsx` — video creation wizard + `pending_consent` UI

**Files:**
- Modify: `src/components/AvatarManager.tsx`

**Interfaces:**
- Consumes: `createVideoAvatarAction` (Task 6), `Avatar.sourceType`/`consentStatus`/`consentUrl` (Task 2/3), `checkAvatarStatusAction` (Task 7, unchanged call signature).
- Produces: no new exports — this is the final consumer in the chain.

No automated component tests exist in this codebase for `AvatarManager.tsx` today (confirmed: only Vitest unit/integration tests for lib/actions/providers) — this task is verified manually via the dev server, matching the project's existing testing depth (see spec's Testing section).

- [ ] **Step 1: Import the new action**

In `src/components/AvatarManager.tsx`, change the import:

```tsx
import {
  createAvatarAction, checkAvatarStatusAction, setActiveAvatarAction, deleteAvatarAction, generatePromptLookAction,
  createVideoAvatarAction,
} from '@/app/actions';
```

- [ ] **Step 2: Broaden the polling filter to include `pending_consent`**

Replace:

```tsx
  const trainingIds = avatars.filter(a => a.status === 'training').map(a => a.id).join(',');
```

with:

```tsx
  const pollableIds = avatars.filter(a => a.status === 'training' || a.status === 'pending_consent').map(a => a.id).join(',');
```

And update the effect that references it:

```tsx
  useEffect(() => {
    let cancelled = false;

    async function pollOnce() {
      const ids = pollableIds ? pollableIds.split(',') : [];
      if (ids.length === 0) return;
      await Promise.all(ids.map(id => checkAvatarStatusAction(id)));
      if (!cancelled) router.refresh();
    }

    pollOnce();

    if (!pollableIds) return;
    const interval = setInterval(pollOnce, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pollableIds, router]);
```

- [ ] **Step 3: Add video-wizard state and handlers**

After the existing `previewUrls` state declaration, add:

```tsx
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoStep, setVideoStep] = useState<1 | 2 | 3>(1);
  const [videoConsent, setVideoConsent] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoName, setVideoName] = useState('');
  const [videoSubmitting, setVideoSubmitting] = useState(false);
  const [videoDurationWarning, setVideoDurationWarning] = useState<string | null>(null);
```

After `resetModal`, add:

```tsx
  function resetVideoModal() {
    setVideoModalOpen(false);
    setVideoStep(1);
    setVideoConsent(false);
    setVideoFile(null);
    setVideoName('');
    setVideoDurationWarning(null);
  }

  function handleVideoFileChosen(chosen: FileList | null) {
    const file = chosen?.[0];
    if (!file) return;
    setVideoFile(file);
    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (probe.duration < 30) setVideoDurationWarning('This clip looks shorter than 30 seconds — HeyGen recommends at least 30s of footage.');
      else if (probe.duration > 300) setVideoDurationWarning('This clip looks longer than 5 minutes — HeyGen recommends under 5 minutes of footage.');
      else setVideoDurationWarning(null);
    };
    probe.src = url;
  }

  async function handleVideoSubmit() {
    if (!videoFile) return;
    setVideoSubmitting(true);
    const formData = new FormData();
    formData.set('consent', videoConsent ? 'on' : 'off');
    formData.set('name', videoName);
    formData.set('video', videoFile);
    const result = await createVideoAvatarAction(formData);
    setVideoSubmitting(false);
    if (result.ok) {
      toast('Video avatar creation started — send the candidate the consent link shown on this avatar.');
      resetVideoModal();
      router.refresh();
    } else {
      toast(result.error ?? 'Failed to create video avatar', 'error');
    }
  }

  async function handleCopyConsentLink(url: string) {
    await navigator.clipboard.writeText(url);
    toast('Consent link copied.');
  }
```

- [ ] **Step 4: Replace the single "Create avatar" button with two entry points**

Replace:

```tsx
        {canManage && (
          <button className="btn primary" style={{ fontSize: 13 }} onClick={() => setModalOpen(true)}>
            + Create avatar
          </button>
        )}
```

with:

```tsx
        {canManage && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" style={{ fontSize: 13 }} onClick={() => setModalOpen(true)}>
              + From photos
            </button>
            <button className="btn primary" style={{ fontSize: 13 }} onClick={() => setVideoModalOpen(true)}>
              + From video
            </button>
          </div>
        )}
```

- [ ] **Step 5: Add the `pending_consent` status line and copy-link button to each row**

Replace the status `<span>` block:

```tsx
                  <span>
                    {a.status === 'training' && 'Training — usually a few minutes'}
                    {a.status === 'ready' && 'Ready'}
                    {a.status === 'failed' && `Failed: ${a.errorMessage ?? 'Unknown error'}`}
                    <span className="mono" style={{ color: 'var(--text-3)' }}> · created {new Date(a.createdAt).toLocaleDateString()}</span>
                  </span>
```

with:

```tsx
                  <span>
                    {a.status === 'pending_consent' && 'Waiting on candidate consent'}
                    {a.status === 'training' && 'Training — usually a few minutes'}
                    {a.status === 'ready' && 'Ready'}
                    {a.status === 'failed' && `Failed: ${a.errorMessage ?? 'Unknown error'}`}
                    <span className="mono" style={{ color: 'var(--text-3)' }}> · created {new Date(a.createdAt).toLocaleDateString()}</span>
                  </span>
```

And in the `canManage` action-button group for each row, add a copy-link button before the "Set active" button:

```tsx
            {canManage && (
              <div style={{ display: 'flex', gap: 8 }}>
                {a.status === 'pending_consent' && a.consentUrl && (
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => handleCopyConsentLink(a.consentUrl!)}>
                    Copy consent link
                  </button>
                )}
                {a.status === 'ready' && a.id !== activeAvatarId && (
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => handleSetActive(a.id)}>
                    Set active
                  </button>
                )}
```
(the rest of that block is unchanged)

- [ ] **Step 6: Add the video wizard modal**

After the existing photo-wizard `{modalOpen && (...)}` block and before the `{lookModalAvatarId && (...)}` block, add:

```tsx
      {videoModalOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            {videoStep === 1 && (
              <>
                <div className="modal-step">Step 1 of 3 · Consent</div>
                <h3 style={{ marginBottom: 14, fontSize: 16 }}>Confirm permission</h3>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.5 }}>
                  <input type="checkbox" checked={videoConsent} onChange={e => setVideoConsent(e.target.checked)} />
                  I confirm I have the candidate&rsquo;s permission to record and use this video to create an AI avatar of them.
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={resetVideoModal}>Cancel</button>
                  <button className="btn primary" disabled={!videoConsent} onClick={() => setVideoStep(2)}>Next →</button>
                </div>
              </>
            )}
            {videoStep === 2 && (
              <>
                <div className="modal-step">Step 2 of 3 · Video</div>
                <h3 style={{ marginBottom: 12, fontSize: 16 }}>Upload training video</h3>
                <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Upload one continuous, well-lit, front-facing clip of the candidate speaking (30 seconds to 5 minutes).
                  The candidate will separately complete a short consent recording on HeyGen&rsquo;s own page after you submit this.
                </p>
                <input type="file" accept="video/mp4,video/quicktime" onChange={e => handleVideoFileChosen(e.target.files)} />
                {videoFile && (
                  <video src={URL.createObjectURL(videoFile)} controls style={{ width: '100%', marginTop: 12, borderRadius: 8, maxHeight: 200 }} />
                )}
                {videoDurationWarning && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 8, color: 'var(--warn)' }}>{videoDurationWarning}</p>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={() => setVideoStep(1)}>← Back</button>
                  <button className="btn primary" disabled={!videoFile} onClick={() => setVideoStep(3)}>Next →</button>
                </div>
              </>
            )}
            {videoStep === 3 && (
              <>
                <div className="modal-step">Step 3 of 3 · Name</div>
                <h3 style={{ marginBottom: 12, fontSize: 16 }}>Name this avatar</h3>
                <input className="input" placeholder="e.g. Alex — video twin" value={videoName}
                  onChange={e => setVideoName(e.target.value)} maxLength={60} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={() => setVideoStep(2)}>← Back</button>
                  <button className="btn primary" disabled={videoSubmitting || !videoName.trim()} onClick={handleVideoSubmit}>
                    {videoSubmitting ? 'Creating…' : 'Create Video Avatar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS with no errors.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, sign in as an `owner`/`manager` on a campaign, go to `/settings` (or wherever `AvatarManager` renders), and:
1. Confirm two buttons appear: "+ From photos" and "+ From video".
2. Click "+ From video", step through consent → upload a short local `.mp4` → name → submit.
3. Confirm a new row appears with "Waiting on candidate consent" and (in mock mode, since `HEYGEN_API_KEY` is likely unset locally) note the mock resolves consent instantly, so the row should progress to "Training" then "Ready" within a couple of 5s polls.
4. Confirm the existing photo-avatar flow ("+ From photos") still works unchanged.

---

### Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — every suite, including all files touched in Tasks 3-7 and the pre-existing suites (`permissions.test.ts`, `actions.avatar-billing.test.ts`, `avatars.delete.test.ts`, `index.defensive.test.ts`, `index.getVideoStatus.test.ts`, `api/heygen/avatars/route.test.ts`), green.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Leave everything uncommitted for review**

Per the user's instruction, do not run `git add` or `git commit` — leave all changes in the working tree. Run `git status` and report the modified/created file list so the user can review the diff themselves.
