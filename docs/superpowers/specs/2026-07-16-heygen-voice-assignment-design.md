# Admin-Assigned HeyGen Voice — Design Spec

**Date:** 2026-07-16
**Status:** Approved

---

## Overview

Avatar video generation (`generateVideoAction`) requires `candidate_profiles.heygen_voice_id`, but nothing in the app has ever been able to set it — there is no picker, no admin field, nothing. This makes every campaign's avatar video generation fail with "No video voice is set up for this campaign yet," unconditionally.

HeyGen voices are not something campaigns pick from a shared catalog: each candidate's voice is individually cloned (via HeyGen's native cloning or a third-party import), done outside this app, the same way `candidate_profiles.heygen_base_avatar_id` (the HeyGen avatar group ID) is created outside the app and then linked in by a super-admin via `assignAvatarAction`.

This spec closes the gap using that exact same pattern: a new admin-only action, `assignVoiceAction`, lets a super-admin paste an already-cloned HeyGen `voice_id` and link it to a campaign. No new upload/cloning automation, no new HeyGen voice-catalog browsing UI — cloning stays a manual, outside-the-app step; the app's job is only remembering which voice ID belongs to which campaign.

---

## Current State vs. New State

| | Today | After this spec |
|---|---|---|
| Who creates the voice clone | Nobody, in-app — would need to happen in HeyGen's own dashboard | Unchanged — still outside the app |
| Who links a clone to a campaign | Nobody — no UI writes `heygen_voice_id` at all | Super-admin, via `assignVoiceAction` on `/admin/campaigns/[id]` |
| `generateVideoAction` | Always fails for every campaign (`heygenVoiceId` never set) | Works once an admin assigns a voice |
| Consent tracking | None | Required checkbox on assignment, same framing as avatar consent |

---

## Implementation

**1. New admin action — `assignVoiceAction` in `src/app/admin/actions.ts`**

Mirrors `assignAvatarAction` (`src/app/admin/actions.ts:189`):
- `await requireAdmin()`.
- Reads `campaignId` and `heygen_voice_id` from `FormData`; no-ops (returns without doing anything) if either is blank.
- Requires a `consent` checkbox (`formData.get('consent') === 'on'`); no-ops if missing.
- Loads the existing candidate profile via `getCandidateProfile(campaignId)`. Only calls `upsertCandidateProfile(campaignId, { heygenVoiceId })` if a profile row already exists — matching `assignAvatarAction`'s guard, since `upsertCandidateProfile`'s insert path requires other not-null fields (`full_name`, `office`, `district`) this action doesn't have. If no profile exists yet, this is a silent no-op (same behavior as the avatar action today).
- `revalidatePath('/admin/campaigns/[campaignId]')` equivalent — match whatever revalidation `assignAvatarAction` already does for this page.

No new domain types, no new repo methods — `heygenVoiceId` already exists on `CandidateProfile` (`src/domain/types.ts:130`) and `upsertCandidateProfile` (`src/lib/candidate.ts:77`) already persists it.

**2. New UI — "Candidate voice" card on `src/app/admin/campaigns/[id]/page.tsx`**

A sibling card to the existing "Candidate avatar" card (not merged into it), same visual pattern:
- Paste-an-ID text input (`name="heygen_voice_id"`, monospace, placeholder showing an example HeyGen voice ID).
- "Assign voice" submit button.
- Required consent checkbox: "I confirm the candidate has given consent for this HeyGen voice to be used to generate video on their behalf."
- Status indicator below the form: green dot + "Voice assigned" + the assigned ID in `<code>` when `profile?.heygenVoiceId` is set; otherwise no status line (matches the avatar card's `heygenBaseAvatarId` present/absent branching, minus the "created but not active" middle state — voices don't have that lifecycle).

**3. Out of scope (explicitly, per discussion)**
- No in-app voice cloning (ElevenLabs or HeyGen's `v3/voices/clone`) — a manual step for now.
- No HeyGen voice-catalog browsing/picker UI — campaigns don't choose from a shared list.
- The ElevenLabs voice picker (`VoiceLibrary.tsx`, currently unrendered) is a separate, pre-existing gap for the standalone-audio feature — not touched here.

---

## Testing

- `src/app/admin/actions.assign-voice.test.ts` (new), modeled on the existing `actions.assign-plan.test.ts` mocking style:
  - Requires admin session (mirrors the `requireAdmin` guard already covered on other admin actions).
  - No-ops when `campaignId` or `heygen_voice_id` is blank.
  - No-ops when `consent` is not `'on'`.
  - Calls `upsertCandidateProfile` with `{ heygenVoiceId }` when a profile exists and consent is given.
  - Does **not** call `upsertCandidateProfile` when no profile exists yet for that campaign.
- No changes needed to `generateVideoAction`'s tests — it already reads `profile?.heygenVoiceId` correctly; this spec only adds a way to set it.

---

## Risks / Follow-ups

- HeyGen's voice cloning requires a paid plan tier and has a per-account clone-count limit (confirmed via HeyGen's docs during design, exact limit not yet checked against this account) — worth verifying before cloning voices for many campaigns.
- If self-serve, in-app voice cloning is wanted later, this spec's `heygen_voice_id` field is the same one that flow would write to — no rework needed, just an additional writer.
