# In-App Avatar Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let campaign owners/managers create a HeyGen photo avatar for their candidate directly in-app (upload photos → HeyGen trains it → pick a look), replacing the current flow where a super-admin manually pastes a HeyGen avatar-group ID.

**Architecture:** A new `avatars` table (many per campaign, one marked active via `candidate_profiles.active_avatar_id`) backs a new `AvatarManager` UI in Settings. Creating an avatar uploads photos to Supabase Storage (audit trail) and to HeyGen's v3 API (one `POST /v3/assets` + `POST /v3/avatars` call per photo, chaining them into one HeyGen avatar group). A polling server action checks HeyGen's per-look training status until the whole group is ready. Setting an avatar active feeds its HeyGen group ID into the existing `AvatarLibrary` "pick a look" component, which is otherwise untouched.

**Tech Stack:** Next.js 14 (App Router, server actions), Supabase (Postgres + Storage), HeyGen v3 REST API via raw `fetch` (no SDK), Vitest.

Reference spec: `docs/superpowers/specs/2026-07-02-avatar-creation-design.md`

## Global Constraints

- Target HeyGen's **v3 API only** for all new avatar-creation code (`https://api.heygen.com/v3/...`). Do not use v1/v2 paths — those sunset 2026-10-31 and v3 fully covers avatar creation. (The existing `HeyGenVideoProvider` still uses v1/v2 for video rendering — that is out of scope and untouched by this plan.)
- All third-party HTTP calls use the existing hand-rolled `fetch()` style already in `src/integrations/index.ts` — no new SDK dependency, no changes to `package.json`.
- Every database ID in this app is an app-generated opaque string via `uid()` (`src/lib/store.ts`), never a database-generated UUID. New tables use `text` primary keys, matching every existing table (see `supabase/migrations/001_init.sql`).
- The `manage_avatars` permission (owner + manager only, same role set as `edit_settings`) gates every avatar-mutating server action, via the existing `can()` utility in `src/lib/permissions.ts`.
- **Do not create any git commits during implementation.** Leave all changes uncommitted in the working tree — the user will review the diff and commit it themselves.
- Vitest (`environment: 'node'`, see `vitest.config.ts`) is the only test runner in this repo, and only `src/lib/*` modules have unit tests today — there is no component/browser/action test infra. Match that existing depth: new pure logic (`src/lib/avatars.ts`, `src/lib/permissions.ts`, `src/integrations/index.ts`) gets Vitest tests; UI components (`AvatarManager`, `AvatarLibrary`) and server actions (`src/app/actions.ts`) are verified manually via `npm run dev`, consistent with how `scheduleAction`/`publishAction`/`ContentEditor` are untested today.
- Run `npm run typecheck` (`tsc --noEmit`) after any change to `src/domain/types.ts`, since many files depend on it.

---

### Task 1: Database migration — `avatars` table

**Files:**
- Create: `supabase/migrations/009_avatars.sql`

**Interfaces:**
- Produces: table `avatars(id, campaign_id, name, status, heygen_group_id, source_photo_urls, error_message, consent_confirmed_by, consent_confirmed_at, created_by, created_at)`; new column `candidate_profiles.active_avatar_id`; removes `candidate_profiles.heygen_look_id`. All later tasks read/write these exact column names.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/009_avatars.sql
-- Campaigns create and manage their own HeyGen photo avatars in-app,
-- replacing admin-only manual avatar-group-ID assignment.

create table if not exists avatars (
  id                    text primary key,
  campaign_id           text not null references campaigns(id) on delete cascade,
  name                  text not null,
  status                text not null default 'training'
                          check (status in ('training', 'ready', 'failed')),
  heygen_group_id       text,
  source_photo_urls     text[] not null default '{}',
  error_message         text,
  consent_confirmed_by  text not null references users(id),
  consent_confirmed_at  timestamptz not null default now(),
  created_by            text not null references users(id),
  created_at            timestamptz not null default now()
);

create index if not exists idx_avatars_campaign on avatars(campaign_id);

-- No `on delete cascade`/`set null` here on purpose: this FK doubles as a
-- database-level guard against deleting the currently active avatar,
-- backing up the same check in deleteAvatarAction.
alter table candidate_profiles
  add column if not exists active_avatar_id text references avatars(id);

-- Unused: AvatarLibrary.tsx always hardcoded this to null.
alter table candidate_profiles
  drop column if exists heygen_look_id;
```

- [ ] **Step 2: Apply and verify**

Run this file's contents against your Supabase project's SQL Editor (Supabase dashboard → SQL Editor → paste and run), or via `psql "$SUPABASE_DB_URL" -f supabase/migrations/009_avatars.sql` if you have a direct connection string linked.

Then verify with:

```sql
select column_name from information_schema.columns where table_name = 'avatars' order by column_name;
select column_name from information_schema.columns where table_name = 'candidate_profiles' and column_name in ('active_avatar_id', 'heygen_look_id');
```

Expected: the first query lists all 10 `avatars` columns; the second returns only `active_avatar_id` (no `heygen_look_id` row).

---

### Task 2: Domain types + `manage_avatars` permission

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/lib/permissions.ts`
- Modify: `src/lib/permissions.test.ts`

**Interfaces:**
- Produces: `AvatarStatus` type, `Avatar` interface, `CandidateProfile.activeAvatarId` (removes `CandidateProfile.heygenLookId`), `can(role, 'manage_avatars')`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing permission test**

Add to `src/lib/permissions.test.ts` (after the existing `edit_settings` describe block):

```ts
describe('can – manage_avatars', () => {
  it('allows owner',    () => expect(can('owner',    'manage_avatars')).toBe(true));
  it('allows manager',  () => expect(can('manager',  'manage_avatars')).toBe(true));
  it('denies approver', () => expect(can('approver', 'manage_avatars')).toBe(false));
  it('denies staff',    () => expect(can('staff',    'manage_avatars')).toBe(false));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- permissions`
Expected: FAIL — TypeScript error / runtime error, since `'manage_avatars'` isn't a valid `Action` yet.

- [ ] **Step 3: Add the permission**

In `src/lib/permissions.ts`, replace the full file with:

```ts
import type { Role } from '@/domain/types';

type Action = 'approve' | 'schedule' | 'publish' | 'edit_settings' | 'manage_avatars';

const PERMISSIONS: Record<Action, Role[]> = {
  approve:        ['owner', 'manager', 'approver'],
  schedule:       ['owner', 'manager'],
  publish:        ['owner', 'manager'],
  edit_settings:  ['owner', 'manager'],
  manage_avatars: ['owner', 'manager'],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[action].includes(role);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- permissions`
Expected: PASS, all `can – manage_avatars` cases green.

- [ ] **Step 5: Add domain types**

In `src/domain/types.ts`, add after the `VoiceTone` type declaration (before `CandidateProfile`):

```ts
export type AvatarStatus = 'training' | 'ready' | 'failed';

export interface Avatar {
  id: string;
  campaignId: string;
  name: string;
  status: AvatarStatus;
  heygenGroupId?: string | null;
  sourcePhotoUrls: string[];
  errorMessage?: string | null;
  consentConfirmedBy: string;
  consentConfirmedAt: string;
  createdBy: string;
  createdAt: string;
}
```

Then in the `CandidateProfile` interface, remove this line:

```ts
  heygenLookId?: string | null;
```

and add this line in its place:

```ts
  activeAvatarId?: string | null;
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: FAILS at this point — `src/lib/candidate.ts` and `src/components/AvatarLibrary.tsx` still reference `heygenLookId`. This is expected; Task 3 and Task 8 fix those. Confirm the only errors mention `heygenLookId`, nothing else.

---

### Task 3: Update `candidate.ts` for the type changes

**Files:**
- Modify: `src/lib/candidate.ts`

**Interfaces:**
- Consumes: `CandidateProfile.activeAvatarId` / removed `heygenLookId` (Task 2).
- Produces: `getCandidateProfile`/`upsertCandidateProfile` read/write `active_avatar_id` instead of `heygen_look_id`.

- [ ] **Step 1: Update `toProfile`**

In `src/lib/candidate.ts`, in the `toProfile` function, remove this line:

```ts
    heygenLookId: (r.heygen_look_id as string | null) ?? null,
```

and add this line in its place:

```ts
    activeAvatarId: (r.active_avatar_id as string | null) ?? null,
```

- [ ] **Step 2: Update `upsertCandidateProfile`**

In the same file, in the `upsertCandidateProfile` payload object, remove this line:

```ts
    ...(data.heygenLookId      !== undefined && { heygen_look_id:      data.heygenLookId ?? null }),
```

and add this line in its place:

```ts
    ...(data.activeAvatarId    !== undefined && { active_avatar_id:    data.activeAvatarId ?? null }),
```

- [ ] **Step 3: Run existing candidate test**

Run: `npm test -- candidate`
Expected: PASS (the existing test only checks the module's function exports, so it's unaffected by this field swap — this step just confirms the file still parses/imports cleanly).

---

### Task 4: `avatars` repo module

**Files:**
- Create: `src/lib/avatars.ts`
- Create: `src/lib/avatars.test.ts`

**Interfaces:**
- Consumes: `Avatar`, `AvatarStatus` (Task 2); `adminDb` (`src/lib/supabase.ts`).
- Produces: `listAvatars(campaignId): Promise<Avatar[]>`, `getAvatar(id): Promise<Avatar | null>`, `insertAvatar(input): Promise<void>`, `updateAvatarStatus(id, status, opts?): Promise<void>`, `deleteAvatarRow(id): Promise<void>` — these exact names/signatures are used by `src/app/actions.ts` in Task 7 and `src/app/settings/page.tsx` in Task 11.

- [ ] **Step 1: Write the failing module-shape test**

Create `src/lib/avatars.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({
  adminDb: {
    from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() })),
  },
}));

describe('avatars module exports', () => {
  it('exports the expected functions', async () => {
    const mod = await import('./avatars');
    expect(typeof mod.listAvatars).toBe('function');
    expect(typeof mod.getAvatar).toBe('function');
    expect(typeof mod.insertAvatar).toBe('function');
    expect(typeof mod.updateAvatarStatus).toBe('function');
    expect(typeof mod.deleteAvatarRow).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- avatars`
Expected: FAIL with "Cannot find module './avatars'" (file doesn't exist yet).

- [ ] **Step 3: Write the module**

Create `src/lib/avatars.ts`:

```ts
// src/lib/avatars.ts
import { adminDb } from './supabase';
import { Avatar, AvatarStatus } from '@/domain/types';

function toAvatar(r: Record<string, unknown>): Avatar {
  return {
    id: r.id as string,
    campaignId: r.campaign_id as string,
    name: r.name as string,
    status: r.status as AvatarStatus,
    heygenGroupId: (r.heygen_group_id as string | null) ?? null,
    sourcePhotoUrls: (r.source_photo_urls as string[]) ?? [],
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
  heygenGroupId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await adminDb.from('avatars').insert({
    id: input.id,
    campaign_id: input.campaignId,
    name: input.name,
    status: input.status ?? 'training',
    heygen_group_id: input.heygenGroupId ?? null,
    source_photo_urls: input.sourcePhotoUrls,
    error_message: input.errorMessage ?? null,
    consent_confirmed_by: input.consentConfirmedBy,
    created_by: input.createdBy,
  });
}

export async function updateAvatarStatus(
  id: string,
  status: AvatarStatus,
  opts?: { heygenGroupId?: string | null; errorMessage?: string | null },
): Promise<void> {
  await adminDb.from('avatars').update({
    status,
    ...(opts?.heygenGroupId !== undefined && { heygen_group_id: opts.heygenGroupId }),
    ...(opts?.errorMessage !== undefined && { error_message: opts.errorMessage }),
  }).eq('id', id);
}

export async function deleteAvatarRow(id: string): Promise<void> {
  await adminDb.from('avatars').delete().eq('id', id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- avatars`
Expected: PASS.

---

### Task 5: HeyGen v3 photo-avatar integration + service wiring

**Files:**
- Modify: `src/integrations/index.ts`
- Create: `src/integrations/index.test.ts`
- Modify: `src/lib/services.ts`

**Interfaces:**
- Produces: `PhotoAvatarProvider` interface, `HeyGenPhotoAvatarProvider`, `MockPhotoAvatarProvider`, and `photoAvatarProvider` singleton exported from `src/lib/services.ts` — this exact export name is imported by `src/app/actions.ts` in Task 7.
  - `uploadAsset(buffer: Buffer, contentType: string): Promise<{ assetId: string }>`
  - `createAvatarLook(input: { name: string; assetId: string; avatarGroupId?: string }): Promise<{ lookId: string; groupId: string }>`
  - `getGroupLooks(groupId: string): Promise<{ id: string; status: 'processing' | 'pending_consent' | 'completed' | 'failed'; previewImageUrl?: string; error?: { code: string; message: string } }[]>`

- [ ] **Step 1: Write the failing integration tests**

Create `src/integrations/index.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { HeyGenPhotoAvatarProvider, MockPhotoAvatarProvider } from './index';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HeyGenPhotoAvatarProvider.uploadAsset', () => {
  it('posts multipart form data and returns the asset id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { asset_id: 'asset_123' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.uploadAsset(Buffer.from('fake-image-bytes'), 'image/jpeg');

    expect(result).toEqual({ assetId: 'asset_123' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.heygen.com/v3/assets');
    expect(opts.method).toBe('POST');
    expect(opts.headers['X-Api-Key']).toBe('test-key');
  });

  it('throws with the HeyGen error message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'bad file' } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    await expect(provider.uploadAsset(Buffer.from('x'), 'image/jpeg')).rejects.toThrow('bad file');
  });
});

describe('HeyGenPhotoAvatarProvider.createAvatarLook', () => {
  it('creates a new group when avatarGroupId is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { avatar_item: { id: 'look_1', group_id: 'group_1' }, avatar_group: { id: 'group_1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.createAvatarLook({ name: 'Studio look', assetId: 'asset_123' });

    expect(result).toEqual({ lookId: 'look_1', groupId: 'group_1' });
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.type).toBe('photo');
    expect(body.file).toEqual({ type: 'asset_id', asset_id: 'asset_123' });
    expect(body.avatar_group_id).toBeUndefined();
  });

  it('adds a look to an existing group when avatarGroupId is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { avatar_item: { id: 'look_2', group_id: 'group_1' }, avatar_group: { id: 'group_1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    await provider.createAvatarLook({ name: 'Studio look', assetId: 'asset_456', avatarGroupId: 'group_1' });

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.avatar_group_id).toBe('group_1');
  });
});

describe('HeyGenPhotoAvatarProvider.getGroupLooks', () => {
  it('normalizes the looks array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          looks: [
            { id: 'look_1', status: 'completed', preview_image_url: 'https://example.com/1.jpg' },
            { id: 'look_2', status: 'failed', error: { code: 'training_failed', message: 'bad photo' } },
          ],
        },
      }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const looks = await provider.getGroupLooks('group_1');

    expect(looks).toEqual([
      { id: 'look_1', status: 'completed', previewImageUrl: 'https://example.com/1.jpg', error: undefined },
      { id: 'look_2', status: 'failed', previewImageUrl: undefined, error: { code: 'training_failed', message: 'bad photo' } },
    ]);
  });
});

describe('MockPhotoAvatarProvider', () => {
  it('returns immediately-completed mock data', async () => {
    const provider = new MockPhotoAvatarProvider();
    const { assetId } = await provider.uploadAsset(Buffer.from('x'), 'image/jpeg');
    const { lookId, groupId } = await provider.createAvatarLook({ name: 'n', assetId });
    const looks = await provider.getGroupLooks(groupId);
    expect(looks).toEqual([{ id: lookId, status: 'completed', previewImageUrl: 'https://example.com/mock-avatar.jpg' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- integrations`
Expected: FAIL — `HeyGenPhotoAvatarProvider`/`MockPhotoAvatarProvider` aren't exported yet.

- [ ] **Step 3: Add the provider interface and implementations**

In `src/integrations/index.ts`, add this new interface next to the existing `VideoProvider`/`VoiceProvider` interfaces (after the `VoiceProvider` interface block):

```ts
export interface PhotoAvatarProvider {
  uploadAsset(buffer: Buffer, contentType: string): Promise<{ assetId: string }>;
  createAvatarLook(input: { name: string; assetId: string; avatarGroupId?: string }):
    Promise<{ lookId: string; groupId: string }>;
  getGroupLooks(groupId: string): Promise<{
    id: string;
    status: 'processing' | 'pending_consent' | 'completed' | 'failed';
    previewImageUrl?: string;
    error?: { code: string; message: string };
  }[]>;
}
```

Then add the implementation after the `HeyGenVideoProvider` class (before the `ElevenLabsVoiceProvider` section):

```ts
// ── HeyGen photo avatar provider (v3 API) ─────────────────────────────────────
// Legacy v1/v2 (used by HeyGenVideoProvider above for rendering) sunsets
// 2026-10-31 — this provider targets v3 only, which fully covers avatar
// creation. v3 has no separate "train" step: training starts automatically
// and asynchronously inside createAvatarLook; readiness comes from polling
// getGroupLooks.

export class HeyGenPhotoAvatarProvider implements PhotoAvatarProvider {
  constructor(private apiKey: string) {}

  async uploadAsset(buffer: Buffer, contentType: string) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType }), 'photo');
    const res = await fetch('https://api.heygen.com/v3/assets', {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey },
      body: form,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`HeyGen upload error: ${json.error?.message ?? res.status}`);
    return { assetId: json.data?.asset_id ?? '' };
  }

  async createAvatarLook({ name, assetId, avatarGroupId }: { name: string; assetId: string; avatarGroupId?: string }) {
    const res = await fetch('https://api.heygen.com/v3/avatars', {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'photo',
        name,
        file: { type: 'asset_id', asset_id: assetId },
        ...(avatarGroupId && { avatar_group_id: avatarGroupId }),
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`HeyGen create avatar error: ${json.error?.message ?? res.status}`);
    return {
      lookId: json.data?.avatar_item?.id ?? '',
      groupId: json.data?.avatar_group?.id ?? json.data?.avatar_item?.group_id ?? '',
    };
  }

  async getGroupLooks(groupId: string) {
    const res = await fetch(`https://api.heygen.com/v3/avatars/looks?group_id=${encodeURIComponent(groupId)}`, {
      headers: { 'X-Api-Key': this.apiKey },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`HeyGen get looks error: ${json.error?.message ?? res.status}`);
    const looks: { id: string; status: string; preview_image_url?: string; error?: { code: string; message: string } }[] =
      json.data?.looks ?? [];
    return looks.map(l => ({
      id: l.id,
      status: l.status as 'processing' | 'pending_consent' | 'completed' | 'failed',
      previewImageUrl: l.preview_image_url,
      error: l.error,
    }));
  }
}
```

And add the mock next to the other mocks at the bottom of the file (near `MockVideoProvider`):

```ts
export class MockPhotoAvatarProvider implements PhotoAvatarProvider {
  async uploadAsset() { return { assetId: 'mock-asset-id' }; }
  async createAvatarLook() { return { lookId: 'mock-look-id', groupId: 'mock-group-id' }; }
  async getGroupLooks() {
    return [{ id: 'mock-look-id', status: 'completed' as const, previewImageUrl: 'https://example.com/mock-avatar.jpg' }];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- integrations`
Expected: PASS.

- [ ] **Step 5: Wire the service singleton**

In `src/lib/services.ts`, update the import block:

```ts
import {
  ClaudeContentGenerator, MockContentGenerator,
  HeyGenVideoProvider, MockVideoProvider,
  HeyGenPhotoAvatarProvider, MockPhotoAvatarProvider,
  ElevenLabsVoiceProvider, MockVoiceProvider,
  AyrsharePublisher, MockPublisher,
  NewsDataMonitoringSource, MockMonitoringSource,
} from '@/integrations';
```

And add, after the `videoProvider` export:

```ts
export const photoAvatarProvider = process.env.HEYGEN_API_KEY
  ? new HeyGenPhotoAvatarProvider(process.env.HEYGEN_API_KEY)
  : new MockPhotoAvatarProvider();
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no new errors introduced by this task (pre-existing `heygenLookId` errors in `AvatarLibrary.tsx` from Task 2 still present until Task 9 — confirm no *other* errors appear).

---

### Task 6: Server actions — create, poll, activate, delete

**Files:**
- Modify: `src/app/actions.ts`

**Interfaces:**
- Consumes: `insertAvatar`, `getAvatar`, `updateAvatarStatus`, `deleteAvatarRow` (Task 4); `photoAvatarProvider` (Task 5); `upsertCandidateProfile`, `getCandidateProfile` (Task 3); `can`, `uid`, `adminDb`, `GateError`, `requireSession`, `revalidatePath` (already imported in this file).
- Produces: `createAvatarAction(formData): Promise<Result & { avatarId?: string }>`, `checkAvatarStatusAction(avatarId): Promise<Result>`, `setActiveAvatarAction(avatarId): Promise<Result>`, `deleteAvatarAction(avatarId): Promise<Result>` — these exact names are called from `src/components/AvatarManager.tsx` in Task 10. Also updates `saveVideoSettingsAction`'s parameter type and adds a permission gate to it and to `uploadBackgroundAction`.

- [ ] **Step 1: Update the `photoAvatarProvider` import**

In `src/app/actions.ts`, update this line:

```ts
import { lifecycle, disclosureEngine, usageMeter, contentGenerator, publisher, videoProvider, voiceProvider } from '@/lib/services';
```

to:

```ts
import { lifecycle, disclosureEngine, usageMeter, contentGenerator, publisher, videoProvider, voiceProvider, photoAvatarProvider } from '@/lib/services';
```

- [ ] **Step 2: Gate `saveVideoSettingsAction` and drop `heygenLookId`**

Replace the existing `saveVideoSettingsAction`:

```ts
export async function saveVideoSettingsAction(data: {
  heygenBaseAvatarId?: string | null;
  heygenAvatarId?: string | null;
  heygenLookId?: string | null;
  elevenLabsVoiceId?: string | null;
  videoAspectRatio?: '16:9' | '9:16' | '1:1';
  videoBackground?: string;
}): Promise<Result> {
  return guard(async () => {
    const s = requireSession();
    const { upsertCandidateProfile } = await import('@/lib/candidate');
    await upsertCandidateProfile(s.campaignId, data);
    revalidatePath('/settings');
  });
}
```

with:

```ts
export async function saveVideoSettingsAction(data: {
  heygenBaseAvatarId?: string | null;
  heygenAvatarId?: string | null;
  elevenLabsVoiceId?: string | null;
  videoAspectRatio?: '16:9' | '9:16' | '1:1';
  videoBackground?: string;
}): Promise<Result> {
  return guard(async () => {
    const s = requireSession();
    if (!can(s.role, 'edit_settings')) throw new GateError('Permission denied.');
    const { upsertCandidateProfile } = await import('@/lib/candidate');
    await upsertCandidateProfile(s.campaignId, data);
    revalidatePath('/settings');
  });
}
```

- [ ] **Step 3: Gate `uploadBackgroundAction`**

In the existing `uploadBackgroundAction`, add the permission check right after `requireSession()`:

```ts
export async function uploadBackgroundAction(formData: FormData): Promise<Result & { url?: string }> {
  return guard(async () => {
    const s = requireSession();
    if (!can(s.role, 'edit_settings')) throw new GateError('Permission denied.');
    const file = formData.get('file') as File | null;
```

(the rest of the function body is unchanged).

- [ ] **Step 4: Add the four new avatar actions**

Add this block at the end of `src/app/actions.ts`:

```ts
// ── Avatar creation ───────────────────────────────────────────────────────────

export async function createAvatarAction(formData: FormData): Promise<Result & { avatarId?: string }> {
  const s = requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };

  const consent = formData.get('consent') === 'on';
  if (!consent) return { ok: false, error: 'Consent confirmation is required.' };

  const name = String(formData.get('name') ?? '').trim() || 'Avatar';
  const files = formData.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length < 4 || files.length > 10) return { ok: false, error: 'Upload between 4 and 10 photos.' };
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'Each photo must be under 10 MB.' };
    if (!file.type.startsWith('image/')) return { ok: false, error: 'Only image files are allowed.' };
  }

  const { insertAvatar, updateAvatarStatus } = await import('@/lib/avatars');
  const avatarId = uid();
  const buffers = await Promise.all(files.map(f => f.arrayBuffer().then(b => Buffer.from(b))));

  const sourcePhotoUrls: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const ext = files[i].name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const filename = `avatars/${s.campaignId}/${avatarId}/${i}.${ext}`;
    const { error } = await adminDb.storage.from('media').upload(filename, buffers[i], {
      contentType: files[i].type,
      upsert: false,
    });
    if (error) return { ok: false, error: error.message };
    const { data } = adminDb.storage.from('media').getPublicUrl(filename);
    sourcePhotoUrls.push(data.publicUrl);
  }

  await insertAvatar({
    id: avatarId,
    campaignId: s.campaignId,
    name,
    sourcePhotoUrls,
    consentConfirmedBy: s.userId,
    createdBy: s.userId,
    status: 'training',
  });

  try {
    let groupId: string | undefined;
    for (let i = 0; i < files.length; i++) {
      const { assetId } = await photoAvatarProvider.uploadAsset(buffers[i], files[i].type);
      const { groupId: newGroupId } = await photoAvatarProvider.createAvatarLook({
        name,
        assetId,
        avatarGroupId: groupId,
      });
      groupId = groupId ?? newGroupId;
    }
    await updateAvatarStatus(avatarId, 'training', { heygenGroupId: groupId });
  } catch (e) {
    await updateAvatarStatus(avatarId, 'failed', { errorMessage: e instanceof Error ? e.message : String(e) });
  }

  revalidatePath('/settings');
  return { ok: true, avatarId };
}

export async function checkAvatarStatusAction(avatarId: string): Promise<Result> {
  const s = requireSession();
  const { getAvatar, updateAvatarStatus } = await import('@/lib/avatars');
  const avatar = await getAvatar(avatarId);
  if (!avatar || avatar.campaignId !== s.campaignId) return { ok: false, error: 'Avatar not found.' };
  if (avatar.status !== 'training' || !avatar.heygenGroupId) return { ok: true };

  const looks = await photoAvatarProvider.getGroupLooks(avatar.heygenGroupId);
  const failedLook = looks.find(l => l.status === 'failed');
  if (failedLook) {
    await updateAvatarStatus(avatarId, 'failed', { errorMessage: failedLook.error?.message ?? 'Avatar training failed.' });
  } else if (looks.length > 0 && looks.every(l => l.status === 'completed')) {
    await updateAvatarStatus(avatarId, 'ready');
  }
  revalidatePath('/settings');
  return { ok: true };
}

export async function setActiveAvatarAction(avatarId: string): Promise<Result> {
  const s = requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };
  const { getAvatar } = await import('@/lib/avatars');
  const { upsertCandidateProfile } = await import('@/lib/candidate');
  const avatar = await getAvatar(avatarId);
  if (!avatar || avatar.campaignId !== s.campaignId) return { ok: false, error: 'Avatar not found.' };
  if (avatar.status !== 'ready') return { ok: false, error: 'Avatar is not ready yet.' };

  await upsertCandidateProfile(s.campaignId, {
    activeAvatarId: avatarId,
    heygenBaseAvatarId: avatar.heygenGroupId,
    heygenAvatarId: null,
  });
  revalidatePath('/settings');
  return { ok: true };
}

export async function deleteAvatarAction(avatarId: string): Promise<Result> {
  const s = requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };
  const { getAvatar, deleteAvatarRow } = await import('@/lib/avatars');
  const { getCandidateProfile } = await import('@/lib/candidate');
  const avatar = await getAvatar(avatarId);
  if (!avatar || avatar.campaignId !== s.campaignId) return { ok: false, error: 'Avatar not found.' };
  const profile = await getCandidateProfile(s.campaignId);
  if (profile?.activeAvatarId === avatarId) return { ok: false, error: 'Cannot delete the active avatar.' };
  await deleteAvatarRow(avatarId);
  revalidatePath('/settings');
  return { ok: true };
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors from `src/app/actions.ts` (pre-existing `heygenLookId` errors in `AvatarLibrary.tsx` still present until Task 9).

---

### Task 7: Remove the admin manual-assignment path

**Files:**
- Modify: `src/app/admin/actions.ts`
- Modify: `src/app/admin/campaigns/[id]/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `assignAvatarAction` no longer exists; the admin campaign page no longer fetches or displays `CandidateProfile`.

- [ ] **Step 1: Remove `assignAvatarAction`**

In `src/app/admin/actions.ts`, delete this entire function:

```ts
export async function assignAvatarAction(formData: FormData) {
  requireAdmin();
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const heygenBaseAvatarId = String(formData.get('heygen_base_avatar_id') ?? '').trim() || null;
  if (!campaignId) return;
  const { upsertCandidateProfile } = await import('@/lib/candidate');
  await upsertCandidateProfile(campaignId, { heygenBaseAvatarId });
  revalidatePath(`/admin/campaigns/${campaignId}`);
}
```

- [ ] **Step 2: Remove the admin UI section and its now-unused data fetch**

In `src/app/admin/campaigns/[id]/page.tsx`, update the imports at the top:

```ts
import { getCampaignWithStats, getUsers, getContentItems, getAuditEntries, getInviteCodes } from '@/lib/data';
import { updateCampaignAction, addUserAction, removeUserAction, impersonateAction, generateInviteAction, assignAvatarAction } from '../../actions';
import { getCandidateProfile } from '@/lib/candidate';
```

to:

```ts
import { getCampaignWithStats, getUsers, getContentItems, getAuditEntries, getInviteCodes } from '@/lib/data';
import { updateCampaignAction, addUserAction, removeUserAction, impersonateAction, generateInviteAction } from '../../actions';
```

Update the data fetch:

```ts
  const [campaign, users, content, audit, invites, profile] = await Promise.all([
    getCampaignWithStats(params.id),
    getUsers(params.id),
    getContentItems(params.id),
    getAuditEntries(params.id),
    getInviteCodes(params.id),
    getCandidateProfile(params.id),
  ]);
```

to:

```ts
  const [campaign, users, content, audit, invites] = await Promise.all([
    getCampaignWithStats(params.id),
    getUsers(params.id),
    getContentItems(params.id),
    getAuditEntries(params.id),
    getInviteCodes(params.id),
  ]);
```

Delete the entire "Avatar assignment" block (the `<div className="card" style={{ marginBottom: 24 }}>` containing the "Candidate avatar" heading, the `assignAvatarAction` form, and the two status indicators below it — everything between the "Spend summary" card's closing `</div>` and the "Users" section's opening comment).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors from either modified file.

---

### Task 8: Simplify `AvatarLibrary`

**Files:**
- Modify: `src/components/AvatarLibrary.tsx`

**Interfaces:**
- Consumes: `saveVideoSettingsAction` (Task 6, `heygenLookId` param removed).
- Produces: `AvatarLibrary` now requires a non-null `baseAvatarId: string` prop (previously `string | null | undefined`) — `src/app/settings/page.tsx` in Task 11 only renders this component when an active avatar's group ID exists.

- [ ] **Step 1: Replace the file**

Replace the full contents of `src/components/AvatarLibrary.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { saveVideoSettingsAction } from '@/app/actions';
import { useToast } from '@/components/Toast';

interface HeyGenAvatar {
  avatar_id: string;
  avatar_name: string;
  preview_image_url?: string;
  preview_video_url?: string;
}

const ASPECT_RATIOS = [
  { id: '16:9' as const, label: '16:9', sub: 'YouTube · LinkedIn' },
  { id: '9:16' as const, label: '9:16', sub: 'Reels · TikTok' },
  { id: '1:1'  as const, label: '1:1',  sub: 'Facebook · X' },
];

export function AvatarLibrary({
  baseAvatarId,
  currentAvatarId,
  currentAspectRatio,
}: {
  baseAvatarId: string;
  currentAvatarId?: string | null;
  currentAspectRatio?: string;
}) {
  const { toast } = useToast();

  const [looks, setLooks]     = useState<HeyGenAvatar[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);

  const [selectedLookId, setSelectedLookId] = useState(currentAvatarId ?? '');
  const [selectedRatio,  setSelectedRatio]  = useState<'16:9' | '9:16' | '1:1'>(
    (currentAspectRatio as '16:9' | '9:16' | '1:1') ?? '16:9'
  );

  useEffect(() => {
    setLoading(true);
    fetch(`/api/heygen/avatars?baseId=${encodeURIComponent(baseAvatarId)}`)
      .then(r => r.json())
      .then(d => setLooks(d.avatars ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [baseAvatarId]);

  async function handleSave() {
    const selected = looks.find(l => l.avatar_id === selectedLookId) ?? looks[0];
    setSaving(true);
    const result = await saveVideoSettingsAction({
      heygenAvatarId:   selected?.avatar_id ?? null,
      videoAspectRatio: selectedRatio,
    });
    setSaving(false);
    if (result.ok) toast('Video settings saved!');
    else toast(result.error ?? 'Save failed', 'error');
  }

  return (
    <div>
      {/* ── Avatar looks grid ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Your avatar</div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
          These are the available looks for your avatar. Pick the one to use in campaign videos.
        </p>

        {loading && (
          <div style={{ display: 'flex', gap: 12 }}>
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton" style={{ width: 140, height: 190, borderRadius: 10, flexShrink: 0 }} />
            ))}
          </div>
        )}

        {!loading && looks.length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>
            This avatar has no completed looks yet — check back once training finishes.
          </p>
        )}

        {!loading && looks.length > 0 && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {looks.map((look, i) => {
              const isSelected = selectedLookId === look.avatar_id || (!selectedLookId && i === 0);
              return (
                <button key={`${look.avatar_id}-${i}`} type="button"
                  onClick={() => setSelectedLookId(look.avatar_id)}
                  style={{
                    padding: 0, borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                    border: `3px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}`,
                    background: 'var(--bg-hover)', position: 'relative', textAlign: 'left',
                    width: 140, flexShrink: 0,
                    boxShadow: isSelected ? '0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)' : 'none',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}>
                  {look.preview_image_url ? (
                    <img src={look.preview_image_url} alt={look.avatar_name}
                      style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '3/4', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
                      👤
                    </div>
                  )}
                  {isSelected && (
                    <div style={{
                      position: 'absolute', top: 8, right: 8, width: 24, height: 24,
                      background: 'var(--accent)', borderRadius: '50%', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700,
                    }}>✓</div>
                  )}
                  <div style={{ padding: '8px 10px 10px', fontSize: 12, fontWeight: 600 }}>
                    {look.avatar_name || `Look ${i + 1}`}
                    {look.preview_video_url && (
                      <a href={look.preview_video_url} target="_blank" rel="noreferrer"
                        style={{ display: 'block', fontSize: 11, color: 'var(--accent)', marginTop: 2, textDecoration: 'none' }}>
                        Preview ↗
                      </a>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Video format ──────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Video format</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {ASPECT_RATIOS.map(r => (
            <button key={r.id} type="button" onClick={() => setSelectedRatio(r.id)}
              style={{
                padding: '10px 16px', borderRadius: 8, border: '1.5px solid',
                borderColor: selectedRatio === r.id ? 'var(--accent)' : 'var(--line)',
                background: selectedRatio === r.id ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                cursor: 'pointer', textAlign: 'center',
              }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: selectedRatio === r.id ? 'var(--accent)' : 'var(--text)' }}>{r.label}</div>
              <div className="muted" style={{ fontSize: 11 }}>{r.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Save ──────────────────────────────────────────────────────────── */}
      <button className="btn primary" disabled={saving} onClick={handleSave}>
        {saving ? 'Saving…' : 'Save video settings'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS with zero errors — this was the last file with a stale `heygenLookId`/nullable-`baseAvatarId` reference from Task 2/6.

---

### Task 9: `AvatarManager` component

**Files:**
- Create: `src/components/AvatarManager.tsx`

**Interfaces:**
- Consumes: `Avatar` type (Task 2); `createAvatarAction`, `checkAvatarStatusAction`, `setActiveAvatarAction`, `deleteAvatarAction` (Task 6); `useToast` (`src/components/Toast.tsx`).
- Produces: `AvatarManager({ avatars, activeAvatarId, canManage }: { avatars: Avatar[]; activeAvatarId: string | null; canManage: boolean })` — this exact prop shape is used by `src/app/settings/page.tsx` in Task 10.

- [ ] **Step 1: Write the component**

Create `src/components/AvatarManager.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createAvatarAction, checkAvatarStatusAction, setActiveAvatarAction, deleteAvatarAction } from '@/app/actions';
import { useToast } from '@/components/Toast';
import type { Avatar } from '@/domain/types';

const MIN_PHOTOS = 4;
const MAX_PHOTOS = 10;
const POLL_MS = 5000;

export function AvatarManager({
  avatars,
  activeAvatarId,
  canManage,
}: {
  avatars: Avatar[];
  activeAvatarId: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trainingIds = avatars.filter(a => a.status === 'training').map(a => a.id).join(',');

  useEffect(() => {
    let cancelled = false;

    async function pollOnce() {
      const ids = trainingIds ? trainingIds.split(',') : [];
      if (ids.length === 0) return;
      await Promise.all(ids.map(id => checkAvatarStatusAction(id)));
      if (!cancelled) router.refresh();
    }

    // One-shot check on mount even if nothing is currently "training" locally,
    // so status catches up if the user navigated away and back.
    pollOnce();

    if (!trainingIds) return;
    const interval = setInterval(pollOnce, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [trainingIds, router]);

  function resetModal() {
    setModalOpen(false);
    setStep(1);
    setConsent(false);
    setFiles([]);
    setName('');
  }

  function handleFilesChosen(chosen: FileList | null) {
    if (!chosen) return;
    setFiles([...files, ...Array.from(chosen)].slice(0, MAX_PHOTOS));
  }

  async function handleSubmit() {
    setSubmitting(true);
    const formData = new FormData();
    formData.set('consent', consent ? 'on' : 'off');
    formData.set('name', name);
    files.forEach(f => formData.append('photos', f));
    const result = await createAvatarAction(formData);
    setSubmitting(false);
    if (result.ok) {
      toast('Avatar creation started — this can take a few minutes.');
      resetModal();
      router.refresh();
    } else {
      toast(result.error ?? 'Failed to create avatar', 'error');
    }
  }

  async function handleSetActive(id: string) {
    const result = await setActiveAvatarAction(id);
    if (result.ok) { toast('Active avatar updated.'); router.refresh(); }
    else toast(result.error ?? 'Failed to set active avatar', 'error');
  }

  async function handleDelete(id: string) {
    const result = await deleteAvatarAction(id);
    if (result.ok) { toast('Avatar deleted.'); router.refresh(); }
    else toast(result.error ?? 'Failed to delete avatar', 'error');
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="eyebrow">Avatars</div>
        {canManage && (
          <button className="btn primary" style={{ fontSize: 13 }} onClick={() => setModalOpen(true)}>
            + Create Avatar
          </button>
        )}
      </div>

      {avatars.length === 0 && (
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
          {canManage
            ? 'No avatars yet — create one from a set of candidate photos.'
            : 'No avatars have been created for this campaign yet.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {avatars.map(a => (
          <div key={a.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 10,
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                {a.name}
                {a.id === activeAvatarId && (
                  <span className="pill approved" style={{ fontSize: 10 }}>Active</span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {a.status === 'training' && 'Training… (usually a few minutes)'}
                {a.status === 'ready' && 'Ready'}
                {a.status === 'failed' && `Failed: ${a.errorMessage ?? 'Unknown error'}`}
              </div>
            </div>
            {canManage && (
              <div style={{ display: 'flex', gap: 8 }}>
                {a.status === 'ready' && a.id !== activeAvatarId && (
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => handleSetActive(a.id)}>
                    Set active
                  </button>
                )}
                <button className="admin-delete-btn" onClick={() => handleDelete(a.id)}>Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div className="card" style={{ width: 440, maxWidth: '90vw' }}>
            {step === 1 && (
              <>
                <h3 style={{ marginBottom: 12 }}>Step 1 of 3: Consent</h3>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.5 }}>
                  <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
                  I confirm I have the candidate&rsquo;s permission to use these photos to create an AI avatar of them.
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={resetModal}>Cancel</button>
                  <button className="btn primary" disabled={!consent} onClick={() => setStep(2)}>Next →</button>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <h3 style={{ marginBottom: 12 }}>Step 2 of 3: Upload photos</h3>
                <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Upload {MIN_PHOTOS}–{MAX_PHOTOS} recent, high-resolution photos. Mix of angles and expressions gives the best result.
                </p>
                <input type="file" accept="image/*" multiple onChange={e => handleFilesChosen(e.target.files)} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  {files.map((f, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img src={URL.createObjectURL(f)} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6 }} />
                      <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}
                        style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'var(--bad)', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{files.length} of {MAX_PHOTOS} photos added</p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={() => setStep(1)}>← Back</button>
                  <button className="btn primary" disabled={files.length < MIN_PHOTOS} onClick={() => setStep(3)}>Next →</button>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <h3 style={{ marginBottom: 12 }}>Step 3 of 3: Name this avatar</h3>
                <input className="input" placeholder="e.g. Studio look" value={name} onChange={e => setName(e.target.value)} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={() => setStep(2)}>← Back</button>
                  <button className="btn primary" disabled={submitting} onClick={handleSubmit}>
                    {submitting ? 'Creating…' : 'Create Avatar'}
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

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

---

### Task 10: Wire it into the Settings page

**Files:**
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `listAvatars` (Task 4); `AvatarManager` (Task 9); `AvatarLibrary` (Task 8, now requires non-null `baseAvatarId`); `can(role, 'manage_avatars')` (Task 2).

- [ ] **Step 1: Update imports**

In `src/app/settings/page.tsx`, update:

```ts
import { getCandidateProfile } from '@/lib/candidate';
import { upsertCandidateProfile } from '@/lib/candidate';
import { setCapAction } from '@/app/actions';
import { AvatarLibrary } from '@/components/AvatarLibrary';
import { can } from '@/lib/permissions';
```

to:

```ts
import { getCandidateProfile } from '@/lib/candidate';
import { upsertCandidateProfile } from '@/lib/candidate';
import { listAvatars } from '@/lib/avatars';
import { setCapAction } from '@/app/actions';
import { AvatarLibrary } from '@/components/AvatarLibrary';
import { AvatarManager } from '@/components/AvatarManager';
import { can } from '@/lib/permissions';
```

- [ ] **Step 2: Fetch avatars and compute the new permission flag**

Update:

```ts
  const [campaign, rules, users, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getDisclosureRules(),
    getUsers(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  const cap = ((campaign?.monthlyCostCapCents ?? 0) / 100).toFixed(0);
  const canEdit = can(s.role, 'edit_settings');
```

to:

```ts
  const [campaign, rules, users, profile, avatars] = await Promise.all([
    getCampaign(s.campaignId),
    getDisclosureRules(),
    getUsers(s.campaignId),
    getCandidateProfile(s.campaignId),
    listAvatars(s.campaignId),
  ]);
  const cap = ((campaign?.monthlyCostCapCents ?? 0) / 100).toFixed(0);
  const canEdit = can(s.role, 'edit_settings');
  const canManageAvatars = can(s.role, 'manage_avatars');
```

- [ ] **Step 3: Replace the "Avatar & video settings" card**

Replace:

```tsx
      {/* Avatar & video settings */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 4 }}>Avatar & video settings</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
          Choose the avatar look and video format used when generating campaign videos.
        </p>
        <AvatarLibrary
          baseAvatarId={profile?.heygenBaseAvatarId}
          currentAvatarId={profile?.heygenAvatarId}
          currentAspectRatio={profile?.videoAspectRatio}
        />
      </div>
```

with:

```tsx
      {/* Avatars */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 4 }}>Avatars</h2>
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
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS with zero errors across the whole project.

---

### Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new `permissions`, `avatars`, and `integrations` tests from Tasks 2, 4, and 5.

- [ ] **Step 2: Full typecheck**

Run: `npm run typecheck`
Expected: PASS with zero errors.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, then in the browser (as an `owner` or `manager` user):
1. Go to **Settings** → confirm the new "Avatars" card appears with an empty state and a "+ Create Avatar" button.
2. Click **+ Create Avatar** → check the consent checkbox → upload 4+ photos → name it → submit. Confirm the modal closes and a new card appears with status "Training…".
3. Wait a few seconds (or reload) — since `HEYGEN_API_KEY` is likely unset in local dev, `MockPhotoAvatarProvider` returns instantly-completed looks, so the card should flip to "Ready" on the next poll tick.
4. Click **Set active** — confirm the "Active" badge moves to that avatar, and the "pick a look" grid appears below (via `AvatarLibrary`, showing the mock/HeyGen look).
5. Try deleting the active avatar — confirm it's blocked with "Cannot delete the active avatar."
6. Log in as a `staff` or `approver` user and revisit Settings — confirm the Avatars list is visible but read-only (no "+ Create Avatar", "Set active", or "Delete" controls).
7. Go to **/admin/campaigns/[id]** as a super-admin — confirm the old "Candidate avatar" manual-assignment card is gone.

Report back with any discrepancies rather than assuming success — this step cannot be automated given the codebase's current test depth (see Global Constraints).

---

## Addendum (post-Task-10 revision)

After Tasks 1–10 were implemented and reviewed, the user requested two changes to the original design:

1. **Restore admin-side avatar assignment** — not as the old standalone mechanism removed in Task 7, but *integrated* with the `avatars` table: an admin-assigned avatar becomes a real `avatars` row (status `'ready'` immediately, no photos) so it shows up in the campaign's own avatar list and can be replaced/managed like any self-created avatar. Rationale: a newly created campaign has no avatar and no photos yet — the admin should be able to give it a starting default.
2. **Move avatars to their own top-level page** (`/avatars`, new sidebar entry) instead of a section inside Settings.

Tasks 12–14 below supersede parts of Tasks 7 and 10: Task 7's removal of `assignAvatarAction` is reinstated in a new form, and Task 10's placement of the avatar UI inside `src/app/settings/page.tsx` is relocated to a new page.

---

### Task 12: Restore admin avatar assignment, integrated with the `avatars` table

**Files:**
- Modify: `src/app/admin/actions.ts`
- Modify: `src/app/admin/campaigns/[id]/page.tsx`

**Interfaces:**
- Consumes: `insertAvatar` (`src/lib/avatars.ts`), `upsertCandidateProfile` (`src/lib/candidate.ts`), `requireAdmin` (`src/lib/session.ts`).
- Produces: `assignAvatarAction(formData)` back in `src/app/admin/actions.ts`.

- [ ] **Step 1: Add `assignAvatarAction` back to `src/app/admin/actions.ts`**

Add this function (place it where it used to live, after `createCampaignAction` and before `addUserAction`, matching the original file order):

```ts
export async function assignAvatarAction(formData: FormData) {
  const s = requireAdmin();
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const heygenGroupId = String(formData.get('heygen_base_avatar_id') ?? '').trim();
  if (!campaignId || !heygenGroupId) return;

  const { insertAvatar } = await import('@/lib/avatars');
  const { upsertCandidateProfile } = await import('@/lib/candidate');

  const avatarId = 'av-' + Math.random().toString(36).slice(2, 9);
  await insertAvatar({
    id: avatarId,
    campaignId,
    name: 'Default avatar',
    status: 'ready',
    heygenGroupId,
    sourcePhotoUrls: [],
    consentConfirmedBy: s.userId,
    createdBy: s.userId,
  });
  await upsertCandidateProfile(campaignId, {
    activeAvatarId: avatarId,
    heygenBaseAvatarId: heygenGroupId,
    heygenAvatarId: null,
  });

  revalidatePath(`/admin/campaigns/${campaignId}`);
  revalidatePath('/avatars');
}
```

This mirrors the id-generation style already used elsewhere in this same file (`'camp-' + Math.random()...`, `'u-' + Math.random()...`) rather than importing the main app's `uid()` helper, which this file doesn't otherwise use. Setting `status: 'ready'` immediately is correct: unlike self-service creation, an admin-pasted group ID is presumed to already be a working, trained HeyGen avatar.

- [ ] **Step 2: Re-add the admin UI card**

In `src/app/admin/campaigns/[id]/page.tsx`, update the imports:

```ts
import { getCampaignWithStats, getUsers, getContentItems, getAuditEntries, getInviteCodes } from '@/lib/data';
import { updateCampaignAction, addUserAction, removeUserAction, impersonateAction, generateInviteAction, assignAvatarAction } from '../../actions';
import { getCandidateProfile } from '@/lib/candidate';
```

Update the data fetch:

```tsx
  const [campaign, users, content, audit, invites, profile] = await Promise.all([
    getCampaignWithStats(params.id),
    getUsers(params.id),
    getContentItems(params.id),
    getAuditEntries(params.id),
    getInviteCodes(params.id),
    getCandidateProfile(params.id),
  ]);
```

Add this card between the "Spend summary" card's closing `</div>` (end of the `gridTemplateColumns: '1fr 1fr'` grid) and the `{/* Users */}` section:

```tsx
      {/* Avatar assignment */}
      <div className="card" style={{ marginBottom: 24 }}>
        <span className="eyebrow">Video</span>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 8px' }}>Candidate avatar</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
          Paste a HeyGen <strong>avatar group ID</strong> to give this campaign a starting avatar —
          useful right after a campaign is created, before the owner has made their own.
          This creates an avatar entry that shows up on the campaign's own Avatars page, where they
          can pick a look, create additional avatars, or replace this one at any time.
          Find the ID in HeyGen → Photo Avatars → open the avatar → copy the group ID shown in the URL or identity panel.
        </p>
        <form action={assignAvatarAction} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="field-label">HeyGen avatar group ID</label>
            <input
              name="heygen_base_avatar_id"
              className="input"
              style={{ fontFamily: 'monospace', fontSize: 13 }}
              placeholder="e.g. ee7b9943a5ac4d6e9e986075299dbb02"
            />
          </div>
          <button className="btn primary" type="submit" style={{ fontSize: 13, marginBottom: 1 }}>
            Assign avatar
          </button>
        </form>
        {profile?.heygenBaseAvatarId ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 600 }}>Active avatar assigned</span>
            <code style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>{profile.heygenBaseAvatarId}</code>
          </div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-3)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>No avatar assigned yet</span>
          </div>
        )}
      </div>
```

Note this form deliberately has no `defaultValue` on the input and the button always reads "Assign avatar" (not "Update avatar") — every submission creates a *new* `avatars` row and activates it, rather than editing a single persistent field, so pre-filling the old value would invite confusingly re-submitting the same ID as a duplicate row.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

---

### Task 13: Move avatars to their own `/avatars` page

**Files:**
- Create: `src/app/avatars/page.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/app/settings/page.tsx`
- Modify: `src/app/actions.ts`

**Interfaces:**
- Consumes: `listAvatars` (`src/lib/avatars.ts`), `AvatarManager`, `AvatarLibrary`, `getCandidateProfile`, `can`.

- [ ] **Step 1: Create the new page**

Create `src/app/avatars/page.tsx`:

```tsx
import { AppFrame } from '@/components/AppFrame';
import { requireSession } from '@/lib/session';
import { getCandidateProfile } from '@/lib/candidate';
import { listAvatars } from '@/lib/avatars';
import { AvatarLibrary } from '@/components/AvatarLibrary';
import { AvatarManager } from '@/components/AvatarManager';
import { can } from '@/lib/permissions';

export default async function AvatarsPage() {
  const s = requireSession();
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
        <h2 style={{ marginBottom: 4 }}>Avatars</h2>
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
    </AppFrame>
  );
}
```

- [ ] **Step 2: Add the sidebar nav entry**

In `src/components/Sidebar.tsx`, insert a new entry into the `NAV` array between the `/monitoring` entry and the `/settings` entry:

```tsx
  {
    href: '/avatars',
    label: 'Avatars',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
```

- [ ] **Step 3: Remove the Avatars section from Settings**

In `src/app/settings/page.tsx`, update the imports:

```ts
import { revalidatePath } from 'next/cache';
import { AppFrame } from '@/components/AppFrame';
import { requireSession } from '@/lib/session';
import { getCampaign, getDisclosureRules, getUsers } from '@/lib/data';
import { getCandidateProfile } from '@/lib/candidate';
import { upsertCandidateProfile } from '@/lib/candidate';
import { setCapAction } from '@/app/actions';
import { can } from '@/lib/permissions';
import type { VoiceTone } from '@/domain/types';
```

(this removes the `listAvatars`, `AvatarLibrary`, `AvatarManager` imports).

Update the data fetch and remove the now-unused permission flag:

```tsx
  const [campaign, rules, users, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getDisclosureRules(),
    getUsers(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  const cap = ((campaign?.monthlyCostCapCents ?? 0) / 100).toFixed(0);
  const canEdit = can(s.role, 'edit_settings');
```

Delete the entire "Avatars" card block:

```tsx
      {/* Avatars */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 4 }}>Avatars</h2>
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
```

- [ ] **Step 4: Point avatar-action cache invalidation at the new page**

In `src/app/actions.ts`, in each of the four avatar actions (`createAvatarAction`, `checkAvatarStatusAction`, `setActiveAvatarAction`, `deleteAvatarAction`), change `revalidatePath('/settings');` to `revalidatePath('/avatars');` — each action currently has exactly one such call, right before its `return`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

---

### Task 14: Re-verify

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, same 51 tests as before (this addendum touches no test files).

- [ ] **Step 2: Full typecheck**

Run: `npm run typecheck`
Expected: PASS with zero errors.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, then:
1. As super-admin, go to `/admin/campaigns/[id]` for a campaign with no avatar yet → paste a HeyGen avatar group ID (or any placeholder string, since `MockPhotoAvatarProvider` is used without `HEYGEN_API_KEY`) → submit → confirm "Active avatar assigned" appears.
2. As that campaign's owner/manager, go to the new **Avatars** sidebar entry (`/avatars`) → confirm the admin-assigned avatar appears in the list, marked Active, and the "pick a look" grid renders below it.
3. Create a second avatar via the in-app wizard → confirm it appears alongside the admin-assigned one, and "Set active" can switch between them.
4. Go to **Settings** → confirm the Avatars card is gone from that page entirely.
5. Confirm the sidebar shows "Avatars" as its own top-level entry, both on desktop and the mobile tab bar.
