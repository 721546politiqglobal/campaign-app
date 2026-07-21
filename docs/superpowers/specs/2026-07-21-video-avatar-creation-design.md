# Video-Based (Digital Twin) Avatar Creation — Design Spec

**Date:** 2026-07-21
**Status:** Approved

---

## Overview

[2026-07-02-avatar-creation-design.md](./2026-07-02-avatar-creation-design.md) shipped in-app photo avatar creation and explicitly deferred HeyGen's video-trained "Digital Twin" avatars to a phase 2, pending confirmed Enterprise access. This spec is that phase 2.

Photo avatars only ever animate a set of still images — HeyGen has no real footage of how the candidate actually moves, gestures, or talks, so motion and lip-sync are synthesized rather than learned. HeyGen's **Digital Twin** API instead trains from an actual video of the candidate speaking, producing an avatar that reproduces their real mannerisms and voice far more accurately.

Digital Twin creation on HeyGen's v3 API is a small, additive extension of the same plumbing the photo flow already built:

- `POST /v3/avatars` (the exact endpoint `createAvatarLook` already calls for photo avatars) also accepts `type: 'digital_twin'`, given an uploaded training-footage video asset.
- A separate step, `POST /v3/avatars/{group_id}/consent`, requests consent. Its **Level 1 (hosted webcam)** mode is available to every HeyGen account — no Enterprise gate — and returns a URL that the candidate opens themselves to record a short clip reading a verification code HeyGen displays on its own page. HeyGen owns the recording UI and the liveness/anti-deepfake check; this app never captures or verifies that clip itself. Level 2 (submitting a pre-recorded consent clip directly) is Enterprise-whitelisted only and is out of scope here.
- `GET /v3/avatars/{group_id}` — the same status-polling endpoint `getAvatarGroupStatus` already calls for photo avatars — also carries consent state.

**Open risk, called out explicitly:** whether this HeyGen account has Digital Twin access at all is unconfirmed. The first implementation step (see Testing) is a real API call against a test video to confirm access and pin down the exact response shape before the rest of the UI is built.

---

## Current State vs. New State

| | Today | After this spec |
|---|---|---|
| Avatar sources | Photos only (`sourceType` implicitly `'photo'`) | Photos **or** a single training video (`sourceType: 'photo' \| 'digital_twin'`) |
| Consent | One checkbox, staff-confirmed, recorded at creation time | Photo flow unchanged. Video flow adds a second, candidate-completed consent step via a HeyGen-hosted link |
| Avatar status values | `training` \| `ready` \| `failed` | + `pending_consent` (video flow only, sits before `training`) |
| Create avatar entry point | Single "+ Create avatar" button → photo wizard | Button offers "From photos" / "From video"; video path opens a parallel 3-step wizard |
| List row states | Training / Ready / Failed | + "Waiting on candidate consent" with a copy-link action |

Everything downstream of a `ready` avatar — `AvatarLibrary` "pick a look", `setActiveAvatarAction`, `generateVideoAction` — is unchanged: a Digital Twin look's `lookId` flows into `character.avatar_id` exactly like a photo look's does, since that code already treats look ids opaquely.

---

## Data Model

New migration `supabase/migrations/027_avatar_digital_twin.sql`:

```sql
alter table avatars
  add column if not exists source_type text not null default 'photo' check (source_type in ('photo', 'digital_twin')),
  add column if not exists source_video_url text,
  add column if not exists consent_status text check (consent_status in ('pending', 'approved', 'declined')),
  add column if not exists consent_url text;

alter table avatars drop constraint avatars_status_check;
alter table avatars add constraint avatars_status_check
  check (status in ('pending_consent', 'training', 'ready', 'failed'));
```

- `source_photo_urls` stays as-is for photo avatars (`'{}'` for video ones); `source_video_url` is the video-flow analog, kept as a separate column rather than overloading the photo array since it's a single file with a different validation/UX story.
- `consent_status`/`consent_url` are `null` for photo avatars — mirrors how HeyGen itself reports `consent_status: null` for avatar types that don't require it.
- TS mirror (`src/domain/types.ts`): `AvatarStatus` gains `'pending_consent'`; `Avatar` gains `sourceType: 'photo' | 'digital_twin'`, `sourceVideoUrl?: string | null`, `consentStatus?: 'pending' | 'approved' | 'declined' | null`, `consentUrl?: string | null`.
- `src/lib/avatars.ts` CRUD helpers (`insertAvatar`, `updateAvatarStatus`, row↔domain mapping) extended for the new columns, following the existing mapping style.

---

## Permissions

No new permission. Reuses `manage_avatars` (`src/lib/permissions.ts`), already gating every avatar-management action — `createVideoAvatarAction` is gated identically to `createAvatarAction`.

---

## Backend

**`PhotoAvatarProvider` interface** (`src/integrations/index.ts`) gains two methods, implemented on the existing `HeyGenPhotoAvatarProvider` class (same v3 base URL, same `X-Api-Key` auth — no new provider class):

- `createVideoAvatar({ name, assetId }): Promise<{ lookId: string; groupId: string }>` → `POST /v3/avatars` with `type: 'digital_twin'`, `file: { type: 'asset_id', asset_id: assetId }` — same request/response shape `createAvatarLook` already parses, just a different `type`.
- `requestConsent({ groupId, rerouteUrl }): Promise<{ consentUrl?: string; consentStatus: string }>` → `POST /v3/avatars/{groupId}/consent` (Level 1: body is just `{ reroute_url }` if provided) → returns HeyGen's `url` (renamed `consentUrl`) and `avatar_group.consent_status`.
- `getAvatarGroupStatus` (existing, unchanged signature) additionally reads and returns `consentStatus: json.data?.consent_status ?? null` alongside the fields it already returns — same call, one more field extracted, so polling doesn't need a second HTTP request per check.
- Following the existing `INT-14` precedent (validating HeyGen's `status` against a known enum rather than casting through blindly), `consent_status` is validated against `['pending', 'approved', 'declined']` and falls back to `null` on anything unrecognized rather than propagating an unknown value into the DB check constraint.
- `MockPhotoAvatarProvider` gets matching mock implementations (instant `consentStatus: 'approved'`, a fake `consentUrl`) so local dev without `HEYGEN_API_KEY` still exercises the full flow.

**New server action, `src/app/actions.ts`:**

```ts
createVideoAvatarAction(formData): Promise<Result & { avatarId?: string }>
```

Mirrors `createAvatarAction`'s shape and ordering:

1. `requireSession()` + `can(s.role, 'manage_avatars')`.
2. Validate the consent checkbox (staff attestation that they have permission to initiate creation — same wording pattern as the photo flow, distinct from the candidate's own HeyGen-hosted consent later).
3. Validate exactly one file, `video/mp4` or `video/quicktime`, under a size cap (proposed 500 MB — HeyGen's own limits will be confirmed during the verification spike and this cap adjusted if needed).
4. Look up the campaign; compute `estimatedCost` from a new `AVATAR_DIGITAL_TWIN_COST_CENTS` constant (placeholder value — HeyGen's actual Digital Twin credit cost is unconfirmed and will be corrected once real pricing is visible, same open risk as API access itself); run the same `billingGate.check` → `usageMeter.guard` → (in a `finally`) `usageMeter.record` sequence as `createAvatarAction`.
5. Insert an `avatars` row (`sourceType: 'digital_twin'`, `status: 'training'` as a transient pre-HeyGen-call state, matching how the photo flow inserts before it has a `heygenGroupId`) after uploading the video to Supabase Storage `media` bucket at `avatars/{campaignId}/{avatarId}/training.{ext}` and recording `sourceVideoUrl`.
6. Call `uploadAsset` → `createVideoAvatar` → `requestConsent` (passing a `rerouteUrl` back into this app's `/avatars` page) in sequence. On success, `updateAvatarStatus(avatarId, 'pending_consent', { heygenGroupId, heygenLookId, consentUrl, consentStatus: 'pending' })`. On any failure in this sequence, `updateAvatarStatus(avatarId, 'failed', { errorMessage })` — never leaves a row silently orphaned, matching the `INT-14` precedent.

**`checkAvatarStatusAction`** extended to also poll when `avatar.status === 'pending_consent'` (not just `'training'`), still via `getAvatarGroupStatus`. Mapping: HeyGen `status: 'pending_consent'` → stays `pending_consent` locally (refresh `consentStatus`/`consentUrl` in case they changed); `'processing'` → local `'training'`; `'completed'` → `'ready'`; `'failed'` → `'failed'`. Because the exact interplay between HeyGen's top-level `status` and its separate `consent_status` field is inferred from third-party documentation rather than a verified live response, the mapping is written defensively (unknown/unexpected combinations fall back to leaving the row in its current state rather than guessing) and will be corrected against real responses during the verification spike.

---

## UI/UX

**`src/components/AvatarManager.tsx`:**

- "+ Create avatar" becomes a small two-option control ("From photos" / "From video") instead of a single button; each opens its own modal.
- New video wizard (parallel to the existing photo one, same modal chrome):
  1. **Consent** — checkbox, staff attestation only ("I confirm I have the candidate's permission to record and use this video to create an AI avatar of them.").
  2. **Upload video** — single file input (`accept="video/mp4,video/quicktime"`), client-side duration check via the file's `<video>` metadata: a non-blocking warning banner if the clip looks under 30s or over 5 minutes (soft guidance, not a hard block — HeyGen's own validation is authoritative).
  3. **Name** — same as photo flow.
  - On submit, `createVideoAvatarAction` runs; on success the new row appears with status `pending_consent` and its `consentUrl` immediately shown in a small banner ("Send this link to the candidate to finish setup" + copy button), so staff don't have to leave the modal to get it.
- **List row**, new state: when `status === 'pending_consent'`, show "Waiting on candidate consent" with a persistent "Copy link" button (re-surfaces `consentUrl` any time, not just right after creation) instead of the training spinner. Once consent is approved, the row falls through to the existing `training` → `ready`/`failed` display unchanged.
- Polling (`useEffect` in `AvatarManager.tsx`) extended to include rows in `pending_consent` alongside `training` in its poll set, so a candidate completing consent updates the UI within the existing 5s cadence with no new polling infrastructure.

---

## Error Handling

- If `createVideoAvatar` 4xxs immediately (most likely cause: this HeyGen account isn't enabled for Digital Twin at all), the row is marked `failed` with a clear message: *"Video avatars aren't enabled for this HeyGen account. Contact HeyGen support to enable Digital Twin access."* — distinguished from a generic failure message so it's obviously a plan/access issue, not a bug, the first time this runs against the real account.
- If `requestConsent` fails after the avatar group was already created successfully, the row is marked `failed` with the raw error; the orphaned HeyGen group itself is not cleaned up — matching the existing precedent that partial multi-step HeyGen failures in the photo flow don't roll back already-created HeyGen-side state either.
- No link expiry or staleness reminder (per explicit decision) — a `pending_consent` row simply waits indefinitely until the candidate completes it or staff deletes the row; `deleteAvatarAction` needs no changes, since it's already `sourceType`-agnostic (confirmed against current code — it never inspects photo-specific fields).
- HeyGen's Digital Twin/consent error codes (30+, covering footage quality, consent-code mismatches, etc.) are stored verbatim in `error_message`, same as the photo flow — no per-code translation table in this pass (YAGNI; add specific friendly messages only for codes actually seen in production).

---

## Testing

- **Verification spike (do this first, before building the UI):** a real call to `POST /v3/avatars` with `type: 'digital_twin'` and a real test video against this HeyGen account, followed by `POST .../consent` and a few polls of `GET /v3/avatars/{id}`, to (a) confirm Digital Twin access exists on this account/plan and (b) pin down the actual `consent_status`/`status` field shapes so the provider's parsing (and the defensive fallbacks above) match reality rather than third-party doc snippets.
- `src/integrations/index.test.ts`: add stubbed-`fetch` unit tests for `createVideoAvatar` and `requestConsent`, matching the existing style (`vi.stubGlobal('fetch', ...)`, restored in `afterEach`).
- New `src/app/actions.avatar-digital-twin.test.ts`, mirroring `actions.avatar-billing.test.ts`'s DI approach (`vi.mock('@/lib/services', ...)` supplying a hand-rolled `photoAvatarProvider` mock — no new DI seam needed, since the new methods live on the same `PhotoAvatarProvider` interface/instance already injected): covers the billing guard blocking the HeyGen call entirely when the cap is exceeded, file-type/size validation, and that a row is persisted with `status: 'failed'` (never silently dropped) when any step in the create→consent sequence throws.
- No new E2E/browser test infra, matching the project's current Vitest-only depth.

---

## Alternatives Considered

1. **Chosen — extend the existing `avatars` table/provider/UI with a `sourceType` discriminator, using HeyGen's Level-1 hosted consent link.** No new infrastructure; reuses billing, polling, list-view, and delete logic already built for photo avatars; Level 1 is available on every HeyGen plan, so it doesn't depend on the unconfirmed Enterprise question.
2. **Build a custom in-app webcam recorder for both training footage and consent, and pursue Level-2 (pre-recorded consent) Enterprise access.** Rejected: Enterprise access is unconfirmed, this is meaningfully more implementation surface (`MediaRecorder` browser/codec compatibility, UI for a guided recording flow), and HeyGen's own hosted consent page already solves liveness/anti-deepfake verification — a DIY version would need to solve the same problem worse.
3. **A fully separate `video_avatars` table and management UI.** Rejected: would duplicate permission checks, billing-guard plumbing, status polling, and the list/delete UI that already exist for photo avatars, for no real benefit — a single discriminator column is simpler (YAGNI).

---

## Files Changed

| File | Change |
|---|---|
| `supabase/migrations/027_avatar_digital_twin.sql` | **New** — `source_type`, `source_video_url`, `consent_status`, `consent_url` columns; widen `status` check constraint |
| `src/domain/types.ts` | `AvatarStatus` gains `'pending_consent'`; `Avatar` gains `sourceType`, `sourceVideoUrl`, `consentStatus`, `consentUrl` |
| `src/lib/avatars.ts` | Extend CRUD helpers/row mapping for new columns |
| `src/integrations/index.ts` | `PhotoAvatarProvider` interface + `HeyGenPhotoAvatarProvider`/`MockPhotoAvatarProvider` gain `createVideoAvatar`, `requestConsent`; `getAvatarGroupStatus` also returns `consentStatus` |
| `src/app/actions.ts` | Add `createVideoAvatarAction`; extend `checkAvatarStatusAction` to poll `pending_consent` rows |
| `src/components/AvatarManager.tsx` | "From photos"/"From video" entry points, new video wizard, `pending_consent` row state + copy-link |
| `src/integrations/index.test.ts` | Add `createVideoAvatar`/`requestConsent` unit tests |
| `src/app/actions.avatar-digital-twin.test.ts` | **New** — billing guard, validation, failure-persists-row tests |

---

## Out of Scope

- Level 2 (Enterprise pre-recorded consent bypass) — revisit only if Enterprise access is separately confirmed and there's an actual need to skip the candidate-facing hosted link.
- In-app webcam recorder for training footage or consent capture.
- A friendly-message translation table for HeyGen's full Digital Twin/consent error code list.
- Consent-link expiry, staleness warnings, or reminder nudges.
- Any change to `generateVideoAction`, `HeyGenVideoProvider`, or `AvatarLibrary`'s "pick a look" mechanics — a Digital Twin look's id already flows through those unchanged.
