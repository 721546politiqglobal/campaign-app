# Self-Service Voice Cloning — Design Spec

**Date:** 2026-08-02
**Status:** Approved

---

## Overview

[2026-07-02-avatar-creation-design.md](./2026-07-02-avatar-creation-design.md) and [2026-07-21-video-avatar-creation-design.md](./2026-07-21-video-avatar-creation-design.md) already let campaign owners create and activate their own avatars (photo or video/"digital twin"), with no admin involved. Voice is the one piece that never got the same treatment: [2026-07-16-heygen-voice-assignment-design.md](./2026-07-16-heygen-voice-assignment-design.md) only gave admins a paste-a-HeyGen-voice-ID box (`assignVoiceAction`) — there is no in-app cloning, and no owner-facing way to set the voice `generateVideoAction` actually uses.

This spec closes that gap: campaign owners upload/record an audio sample on the existing `/avatars` page and get a cloned HeyGen voice that becomes their campaign's active video voice automatically, using HeyGen's own voice-cloning API (`POST /v3/voices/clone`). The admin's paste-an-ID flow is untouched and remains available as a fallback.

**Deliberate deviation from the prior spec's follow-up note:** that spec suggested a future self-serve flow would just be "an additional writer" to `heygen_voice_id`. This spec instead adds a separate `self_voice_clone_id` (see Data Model) so that "replace on re-clone" can safely delete a previous HeyGen voice clone this app created, without ever risking deletion of a voice ID an admin pasted in from outside the app.

---

## Current State vs. New State

| | Today | After this spec |
|---|---|---|
| Voice used in video generation | Only settable by admin, pasting a raw HeyGen voice ID (`assignVoiceAction`) | Owner can clone their own voice in-app; falls back to admin-assigned voice if no self-clone exists |
| Voice cloning capability | None exists anywhere in the code | New: upload audio → HeyGen voice clone → auto-activates on completion |
| Voice clone limit | N/A | HeyGen caps clones at 10 per HeyGen account, shared across the whole platform (one `HEYGEN_API_KEY` for every campaign). Handled by deleting the previous self-clone before creating a new one — max 1 live self-clone per campaign at a time |
| `VoiceLibrary.tsx` (ElevenLabs picker) | Dead code, unrendered, writes to unrelated `elevenlabs_voice_id` (narration only) | Untouched — separate, unrelated feature |

---

## Data Model

Extend `candidate_profiles` (no new table — only one clone is ever live per campaign, so a list/library table would be unused complexity):

```sql
alter table candidate_profiles
  add column if not exists self_voice_clone_id text,
  add column if not exists self_voice_name text,
  add column if not exists self_voice_clone_status text check (self_voice_clone_status in ('training', 'ready', 'failed')),
  add column if not exists self_voice_clone_error text,
  add column if not exists self_voice_consent_confirmed_by text references users(id),
  add column if not exists self_voice_consent_confirmed_at timestamptz;
```

`heygen_voice_id` (the admin-assigned column) is **never overwritten or deleted** by this feature. `generateVideoAction`'s effective-voice resolution becomes:

1. `self_voice_clone_id` if `self_voice_clone_status = 'ready'`
2. else `heygen_voice_id` (admin-assigned)
3. else the existing "No video voice is set up for this campaign yet" error

TS mirror in `src/domain/types.ts`: `CandidateProfile` gains `selfVoiceCloneId?: string | null`, `selfVoiceName?: string | null`, `selfVoiceCloneStatus?: 'training' | 'ready' | 'failed' | null`, `selfVoiceCloneError?: string | null`, `selfVoiceConsentConfirmedBy?: string | null`, `selfVoiceConsentConfirmedAt?: string | null`. `src/lib/candidate.ts` (`getCandidateProfile`/`upsertCandidateProfile`) extended for the new columns, following the existing mapping style.

---

## Permissions

No new permission. Reuses `manage_avatars` (`src/lib/permissions.ts`) — same gate as avatar creation, so `owner`/`manager` roles can clone/replace their campaign's voice.

---

## Backend

**HeyGen voice methods**, added to the `PhotoAvatarProvider` interface and implemented on `HeyGenPhotoAvatarProvider` (`src/integrations/index.ts:207`) — **not** on `VoiceProvider`/`ElevenLabsVoiceProvider`, which is a separate, ElevenLabs-only interface used solely for narration `synthesize()`. The audio sample goes through the same `uploadAsset` → `asset_id` path avatars already use (`src/integrations/index.ts:210`):

- `cloneVoice({ name, assetId, language? }): Promise<{ voiceCloneId: string }>` → `POST /v3/voices/clone`, body `{ voice_name: name, audio: { type: 'asset_id', asset_id: assetId }, language, remove_background_noise: true }`
- `getVoiceCloneStatus(voiceCloneId): Promise<{ status: 'training' | 'ready' | 'failed' }>` → `GET /v3/voices/{voiceCloneId}`, mapping HeyGen's `training`/`pending` → `training`, `complete` → `ready`, `failed` → `failed`, unrecognized → leave status unchanged (same defensive-mapping precedent as the digital-twin spec)
- `deleteVoiceClone(voiceCloneId): Promise<void>` → `DELETE /v3/voices/{voiceCloneId}`; a `404 voice_not_found` response is treated as success (already gone), matching HeyGen's own documented behavior
- Matching mock implementations on the mock provider (instant `ready` status, fake IDs) so local dev without `HEYGEN_API_KEY` still exercises the full flow

**New server actions in `src/app/actions.ts`**, mirroring `beginVideoAvatarUploadAction`/`finalizeVideoAvatarAction`:

1. `beginVoiceCloneUploadAction(formData)` — `requireSession()` + `can(s.role, 'manage_avatars')`; validates exactly one audio file under a size cap; uploads to Supabase Storage `media` bucket at `voices/{campaignId}/{voiceAttemptId}/sample.{ext}`.
2. `finalizeVoiceCloneAction(formData)`:
   - `requireSession()` + `can(s.role, 'manage_avatars')`.
   - Validates the consent checkbox ("I confirm I have permission to create an AI clone of this voice.") — staff/owner attestation only, same framing as photo avatar consent; no HeyGen-hosted consent step exists for voices (unlike digital-twin avatars), per HeyGen's documented API surface.
   - If `self_voice_clone_id` is already set on the campaign's profile, calls `deleteVoiceClone(oldId)` first. Best-effort: a failure here is logged but does **not** block creating the new clone (matches the "partial multi-step HeyGen failures don't roll back already-created HeyGen-side state" precedent from the digital-twin spec) — worst case is a stale HeyGen-side voice consuming a slot until manually cleaned up.
   - Calls `billingGate.check(campaignId)` only — matching the actual (not the originally-drafted) avatar-creation precedent: `beginVideoAvatarUploadAction` calls `billingGate.check` + `quotaGate.checkAvatarCap` because avatars accumulate per-plan-limit rows, but voice has no accumulating count to cap (replace-on-reclone keeps it at exactly 0 or 1 per campaign by construction), so no `quotaGate` call and no new per-item cost constant are needed here.
   - Calls `uploadAsset` → `cloneVoice`. On success: `upsertCandidateProfile(campaignId, { selfVoiceCloneId: voiceCloneId, selfVoiceName: name, selfVoiceCloneStatus: 'training', selfVoiceConsentConfirmedBy, selfVoiceConsentConfirmedAt })`. On failure: `selfVoiceCloneStatus: 'failed'` with `selfVoiceCloneError` set — never leaves the attempt unrecorded.
3. `checkVoiceCloneStatusAction(campaignId)` — polls `getVoiceCloneStatus` on the same 5s cadence already used for avatar training; updates `self_voice_clone_status` to `ready` or `failed` (+ `selfVoiceCloneError` on failure). No separate "activate" action — reaching `ready` makes it the effective voice immediately per the resolution order above.

---

## UI/UX

New "Your Voice" card on `src/app/avatars/page.tsx`, alongside the existing `AvatarManager`:

- **Empty state:** "Clone your voice" button → modal: consent checkbox, audio file upload (client-side soft duration warning outside a reasonable range, non-blocking — HeyGen's own validation is authoritative), name field. On submit, `beginVoiceCloneUploadAction` → `finalizeVoiceCloneAction`.
- **Training state:** spinner + "Cloning your voice…", polled the same way avatar rows are.
- **Ready state:** voice name + "Replace voice" button, which reopens the same modal (deleting the old clone before creating the new one).
- **Failed state:** `self_voice_clone_error` message + "Try again" button.

---

## Error Handling

- **Platform-wide cap hit:** if `cloneVoice` 4xxs specifically on HeyGen's clone-limit error, the attempt is marked `failed` with a distinct message ("Voice cloning is temporarily at capacity across the platform — contact support") rather than a generic failure, so it's obviously a capacity issue and not a bug the first time this is hit in production.
- **Delete-then-create is not atomic:** if the process fails between `deleteVoiceClone` and `cloneVoice` succeeding, the campaign is left with no self-clone and falls back to the admin-assigned `heygen_voice_id` (or the existing "no voice" error) — a safe degraded state, not a broken one.
- No changes to `generateVideoAction`'s actual HeyGen video-generation call — only its voice-ID resolution step changes.

---

## Testing

- `src/integrations/index.test.ts`: stubbed-`fetch` unit tests for `cloneVoice`, `getVoiceCloneStatus`, `deleteVoiceClone` (including the 404-as-success case), matching existing style.
- New `src/app/actions.voice-clone.test.ts`, mirroring `actions.avatar-digital-twin.test.ts`: billing guard blocking the HeyGen call when the cap is exceeded, file validation, delete-before-create ordering (including when delete fails), and that a failed attempt always persists `status: 'failed'` rather than being silently dropped.
- No changes needed to existing `generateVideoAction` tests beyond adding cases for the new resolution precedence (self-clone present vs. absent).

---

## Alternatives Considered

1. **Chosen — extend `candidate_profiles` with a separate `self_voice_clone_id`, reusing the avatar upload/poll/billing infrastructure.** Minimal new surface area; keeps admin- and self-service-assigned voices fully independent so replace/delete logic can never touch an admin-pasted ID.
2. **Write directly into the existing `heygen_voice_id` field** (as the prior spec's follow-up note suggested). Rejected: makes it impossible to distinguish "a voice this app created and can safely delete on replace" from "a voice an admin pasted in from outside," risking silent deletion of an admin-managed resource.
3. **A separate `voice_clones` table supporting multiple clones/history per campaign.** Rejected: the platform-wide 10-clone cap and the replace-on-reclone decision mean only one clone is ever live per campaign — a history table would add CRUD/list UI for no real benefit (YAGNI).

---

## Out of Scope

- Fixing or wiring up the orphaned `VoiceLibrary.tsx` / ElevenLabs narration voice picker — separate, unrelated feature.
- Any change to `assignVoiceAction` or the admin voice-assignment UI.
- A friendly-message translation table for HeyGen's full voice-clone error code list (YAGNI; add specific messages only for codes actually seen in production).
- Multi-voice libraries or per-language voice variants.
