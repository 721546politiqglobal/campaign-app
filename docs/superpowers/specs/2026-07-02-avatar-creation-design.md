# In-App Avatar Creation — Design Spec

**Date:** 2026-07-02
**Status:** Approved

---

## Overview

Today, creating a candidate's HeyGen avatar happens entirely outside this app: someone builds a "photo avatar group" in HeyGen's own console, and a super-admin pastes the resulting group ID into `candidate_profiles.heygen_base_avatar_id` via `assignAvatarAction` on the admin campaign page. Everything downstream — picking a "look" (`AvatarLibrary`), setting video preferences, and generating the final video (`HeyGenVideoProvider`) — already lives in-app.

This spec closes that one remaining gap: campaign owners/managers upload photos of the candidate and create the avatar themselves, in-app, without ever touching HeyGen's dashboard or needing an admin.

HeyGen is not being removed — it remains the video-synthesis engine (`character.avatar_id` in `/v2/video/generate`) and now also the avatar-training backend (`/v2/photo_avatar/*`). What changes is who triggers avatar *creation* and where.

**Scope note:** HeyGen also offers a "Digital Twin" (video-trained) avatar API, which produces higher-fidelity avatars from a training video + consent video. That API is gated to HeyGen's Enterprise plan, which this account is not confirmed to have. This spec covers **photo-based avatar creation only**; Digital Twin is a candidate phase 2 once Enterprise access is confirmed.

---

## Current State vs. New State

| | Today | After this spec |
|---|---|---|
| Who creates the avatar | HeyGen console, manually, then a super-admin pastes the group ID | Campaign owner/manager, in-app |
| Admin manual override | `assignAvatarAction` + admin campaign-page field | Removed entirely |
| Number of avatars per campaign | One (`heygen_base_avatar_id`) | Many, one marked active |
| Consent tracking | None in-app (assumed handled elsewhere) | Required checkbox, recorded per avatar |
| "Pick a look" step | `AvatarLibrary`, keyed off `heygen_base_avatar_id` | Unchanged — now fed by the active created avatar instead of an admin-pasted ID |

---

## Data Model

New migration `supabase/migrations/009_avatars.sql`:

```sql
create table avatars (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  name text not null,
  status text not null check (status in ('training','ready','failed')) default 'training',
  heygen_group_id text,
  source_photo_urls text[] not null default '{}',
  error_message text,
  consent_confirmed_by uuid not null references users(id),
  consent_confirmed_at timestamptz not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create index avatars_campaign_id_idx on avatars(campaign_id);

alter table candidate_profiles
  add column active_avatar_id uuid references avatars(id);
```

- `candidate_profiles.heygen_base_avatar_id` is kept as-is and stays in sync with the active avatar's `heygen_group_id` — every existing read path (`AvatarLibrary`, `generateVideoAction`, `/api/heygen/avatars`) keeps working unchanged.
- `candidate_profiles.heygen_look_id` is dropped — it was already unused (`AvatarLibrary.tsx` hardcodes it to `null` on save).
- The admin-assignment path is removed: `assignAvatarAction` (`src/app/admin/actions.ts`) and its corresponding UI section in `src/app/admin/campaigns/[id]/page.tsx` are deleted.
- TS mirror (`src/domain/types.ts`): new `Avatar` interface; `CandidateProfile.activeAvatarId` added, `heygenLookId` removed.

---

## Permissions

Extend the existing permission matrix (`src/lib/permissions.ts`) with one new action, mapped to the same roles as `edit_settings`:

```ts
type Action = 'approve' | 'schedule' | 'publish' | 'edit_settings' | 'manage_avatars'

const PERMISSIONS: Record<Action, Role[]> = {
  approve:        ['owner', 'manager', 'approver'],
  schedule:       ['owner', 'manager'],
  publish:        ['owner', 'manager'],
  edit_settings:  ['owner', 'manager'],
  manage_avatars: ['owner', 'manager'],
}
```

| Action function | Gate |
|---|---|
| `createAvatarAction` | `can(s.role, 'manage_avatars')` |
| `setActiveAvatarAction` | `can(s.role, 'manage_avatars')` |
| `deleteAvatarAction` | `can(s.role, 'manage_avatars')` |
| `checkAvatarStatusAction` | none (read-only status poll, requires a valid session only — matches `getVideoStatusAction`) |

**In-scope fix:** `saveVideoSettingsAction` and `uploadBackgroundAction` (`src/app/actions.ts`) currently have no `can()` check at all. Add `can(s.role, 'edit_settings')` to both, consistent with every other settings action, since new gated avatar code will sit right next to them.

UI: `src/app/settings/page.tsx` passes a `canManageAvatars = can(s.role, 'manage_avatars')` boolean into the new avatar component, following the same disabled/hidden pattern already used for `canEdit` on the candidate-profile form. Restricted roles see the avatar list read-only; "Create Avatar", "Set active", and "Delete" controls are hidden.

---

## Backend

New methods on a `HeyGenPhotoAvatarProvider` in `src/integrations/index.ts`, alongside the existing `HeyGenVideoProvider`, using the same raw-`fetch` style (no new SDK dependency):

- `uploadAsset(imageBuffer)` → HeyGen Upload Asset → `image_key`
- `createAvatarGroup(name, imageKeys)` → HeyGen Create Photo Avatar Group → `group_id`
- `trainAvatarGroup(groupId)` → HeyGen Train Photo Avatar Group (async)
- `getTrainingStatus(groupId)` → `GET /v2/photo_avatar/train/status/{group_id}`

New server actions in `src/app/actions.ts`:

- **`createAvatarAction(formData)`** — validates the consent checkbox and photo set (4–10 files, `image/*`, <10MB each — reusing `uploadBackgroundAction`'s existing validation), gated by `manage_avatars`. Uploads photos to Supabase Storage (`media` bucket, path `avatars/{campaignId}/{avatarId}/{n}.{ext}`, following the `uploadBackgroundAction`/`ElevenLabsVoiceProvider` path convention), then calls HeyGen: upload each photo → create group → train. Inserts an `avatars` row with `status='training'` before returning; any HeyGen failure during this sequence still inserts the row with `status='failed'` and `error_message` set, rather than returning an error with no persisted record.
- **`checkAvatarStatusAction(avatarId)`** — polls HeyGen training status, updates the row's `status`/`error_message` accordingly.
- **`setActiveAvatarAction(avatarId)`** — gated by `manage_avatars`. Sets `candidate_profiles.active_avatar_id` and `heygen_base_avatar_id` to the chosen avatar, clears `heygen_avatar_id` (the previously selected "look" belonged to the old group and is no longer valid).
- **`deleteAvatarAction(avatarId)`** — gated by `manage_avatars`. Returns `{ ok: false, error: 'Cannot delete the active avatar' }` if the target is currently active.

No training timeout in v1 — a `training` row with no HeyGen error just stays `training` indefinitely, matching how `getVideoStatusAction` polling has no timeout today.

---

## UI/UX

`src/app/settings/page.tsx`: replace the current avatar empty-state ("Your platform admin will set up your candidate avatar") with a new `<AvatarManager />` component.

**`src/components/AvatarManager.tsx`** (new):

- **List view** — one card per avatar: name, thumbnail (once ready), status pill (`Training…` / `Ready` / `Failed: <error_message>`), "Set active" (disabled if already active or not ready), delete icon. The active avatar is marked with a badge.
- **Create Avatar** button opens a 3-step modal:
  1. **Consent** — checkbox ("I confirm I have the candidate's permission to use these photos to create an AI avatar of them"), required before proceeding.
  2. **Upload photos** — drag/drop or file picker, 4–10 photos, client-side validation on count/type/size before submit, removable thumbnails.
  3. **Name** — text input (defaults to "Avatar N" if blank).
  - Submit calls `createAvatarAction`; modal closes immediately, new card appears with `status='training'`.
- **Polling**: while any avatar in the list is `training`, poll `checkAvatarStatusAction` for those rows every ~5s; stop once all rows are terminal (`ready`/`failed`). A one-shot check also fires on component mount regardless of state, so status is fresh if the user navigates away and back later (no background reconciler in v1 — see Alternatives Considered).
- Once an avatar is `ready` and set active, the existing `AvatarLibrary` "pick a look" grid renders below unchanged, now always populated (its old "ask your admin" empty state becomes unreachable and is deleted).

---

## Error Handling

- HeyGen upload/create/train failures during `createAvatarAction`: caught, avatar row persisted with `status='failed'` and a message — never silently dropped.
- Deleting the active avatar is blocked server-side; the user must set a different avatar active first.
- Concurrent creations are allowed — a campaign can have multiple `training` rows in flight; each is an independent HeyGen group.
- Photo count/type/size is validated both client-side (fast feedback) and server-side (real API cost/quality concern, not just UX).

---

## Testing

- `permissions.test.ts` — add `manage_avatars` cases (owner/manager pass, approver/staff fail), matching the existing table style.
- New tests for `HeyGenPhotoAvatarProvider` methods, mocking `fetch` the same way other integration tests do.
- Server action tests for `createAvatarAction` / `setActiveAvatarAction` / `deleteAvatarAction`: permission gating, active-avatar-delete guard, row shape on success/failure.
- No new E2E/browser test infra — matches the project's current Vitest-only testing depth.

---

## Alternatives Considered

**Avatar training status delivery** — three options were considered for surfacing HeyGen's async training completion:

1. **Client polling + refresh-on-mount (chosen)** — reuses the exact pattern already used for video rendering (`generateVideoAction` → `getVideoStatusAction`). No new infrastructure.
2. **Add a Vercel Cron reconciler** — more robust if a user closes the tab mid-training, but this app has no cron jobs today; not justified for a one-time, several-minute setup step.
3. **HeyGen webhooks** — most efficient, but adds webhook signature verification and is unconfirmed to be available outside HeyGen's Enterprise tier (same tier gate as Digital Twin).

---

## Files Changed

| File | Change |
|---|---|
| `supabase/migrations/009_avatars.sql` | **New** — `avatars` table, `candidate_profiles.active_avatar_id` |
| `src/domain/types.ts` | Add `Avatar` type; add `activeAvatarId`, remove `heygenLookId` on `CandidateProfile` |
| `src/lib/permissions.ts` | Add `manage_avatars` action |
| `src/lib/permissions.test.ts` | Add `manage_avatars` cases |
| `src/integrations/index.ts` | **New** `HeyGenPhotoAvatarProvider` (upload/create/train/status) |
| `src/app/actions.ts` | Add `createAvatarAction`, `checkAvatarStatusAction`, `setActiveAvatarAction`, `deleteAvatarAction`; add `can()` gate to `saveVideoSettingsAction` and `uploadBackgroundAction` |
| `src/app/admin/actions.ts` | Remove `assignAvatarAction` |
| `src/app/admin/campaigns/[id]/page.tsx` | Remove manual avatar-ID assignment UI |
| `src/app/settings/page.tsx` | Replace avatar empty-state with `<AvatarManager />`, pass `canManageAvatars` |
| `src/components/AvatarManager.tsx` | **New** — list view, create wizard, polling |
| `src/components/AvatarLibrary.tsx` | Remove now-unreachable "ask your admin" empty state |

---

## Out of Scope

- Digital Twin (video-trained) avatar creation — phase 2, pending confirmed HeyGen Enterprise access.
- Background cron reconciler for training status.
- Any change to `generateVideoAction`, `HeyGenVideoProvider`, or the "pick a look" mechanics in `AvatarLibrary`.
- Rotating the currently-committed live API keys in `.env`/`.env.example` — separate housekeeping, unrelated to this feature.
