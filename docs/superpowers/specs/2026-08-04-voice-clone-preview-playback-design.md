# Voice Clone Preview Playback — Design Spec

**Date:** 2026-08-04
**Status:** Approved

---

## Overview

[2026-08-02-self-service-voice-cloning-design.md](./2026-08-02-self-service-voice-cloning-design.md) and [2026-08-04-voice-clone-live-recording-design.md](./2026-08-04-voice-clone-live-recording-design.md) let a campaign owner clone their voice (from an upload or a live recording) and see it reach `ready`. Neither lets them actually hear the result — the only audio playback in the UI so far is the pre-clone sample preview (the owner's own raw upload/recording, played back before it's even sent to HeyGen). There is no way to judge whether the HeyGen-trained voice model itself sounds right.

This spec adds a "Play sample" action next to the `ready` status line, using HeyGen's text-to-speech endpoint (`POST /v3/voices/speech`) to synthesize a short spoken sample with the cloned voice and play it back in-browser.

---

## Current State vs. New State

| | Today | After this spec |
|---|---|---|
| Hearing the raw sample before cloning | Yes (`<audio>` preview in the upload/record wizard) | Unchanged |
| Hearing the actual cloned voice | Not possible | "Play sample" button next to "Ready — '{name}'", synthesizes and plays a fixed phrase |
| HeyGen speech synthesis capability | Not used anywhere in the app | New `synthesizeSpeech` method on `PhotoAvatarProvider` |

---

## Backend

**`POST https://api.heygen.com/v3/voices/speech`** — synchronous (no polling, unlike voice cloning): request `{ text, voice_id }`, response `{ data: { audio_url, duration } }`. Per HeyGen's docs, a `voice_clone_id` from `/v3/voices/clone` works directly as the `voice_id` here.

New method on `PhotoAvatarProvider` (`src/integrations/index.ts:46-65`) and its implementations:

- Interface: `synthesizeSpeech(input: { voiceId: string; text: string }): Promise<{ audioUrl: string }>`
- `HeyGenPhotoAvatarProvider`: `POST /v3/voices/speech` with `{ text, voice_id: voiceId }`, same `X-Api-Key` auth as every other method on this class; parses `json.data?.audio_url`, throws if missing (matching every other method's "throw if the expected field is absent" convention already in this file).
- `MockPhotoAvatarProvider`: returns a fake `audioUrl` instantly, matching the file's existing mock style.

New server action in `src/app/actions.ts`, alongside the existing voice-clone actions:

```typescript
const VOICE_PREVIEW_TEXT = 'Hello, this is a preview of your cloned voice.';

export async function previewVoiceCloneAction(): Promise<Result & { audioUrl?: string }>
```

- `requireSession()`. No `can()` permission gate — matches `checkVoiceCloneStatusAction`'s existing precedent (read-only, no mutation, any authenticated campaign member can listen).
- Reads the candidate profile; requires `selfVoiceCloneStatus === 'ready'` and a non-null `selfVoiceCloneId` — else `{ ok: false, error: 'No cloned voice is ready yet.' }`.
- `billingGate.check(campaignId)` — same spend-cap gate used by `beginVoiceCloneUploadAction`, since this is a real HeyGen API call. No `quotaGate` call (no accumulating count to cap — this is a one-off synthesis per click, not a resource that persists or needs replacing).
- Calls `photoAvatarProvider.synthesizeSpeech({ voiceId: selfVoiceCloneId, text: VOICE_PREVIEW_TEXT })`, returns `{ ok: true, audioUrl }` on success, `{ ok: false, error: ... }` on failure (raw provider error message — no special-casing needed here, unlike the clone-limit case, since this is a simple synthesis call with no known distinct failure mode worth special messaging).

---

## UI/UX

**`src/components/VoiceCloneManager.tsx`**, in the `status === 'ready'` branch of the status line:

- Add a "Play sample" button next to `Ready — "{name}"`.
- New state: `previewAudioUrl: string | null` (cached synthesis result) and `previewLoading: boolean`.
- First click (no cached URL): call `previewVoiceCloneAction()`, show a loading state ("Generating…"), on success cache the URL in `previewAudioUrl` and immediately play it (`new Audio(url).play()` or an `<audio>` element's `.play()`), on failure toast the error.
- Subsequent clicks while `previewAudioUrl` is already cached: replay the cached URL directly — no new server call, no new HeyGen cost.
- The cache (`previewAudioUrl`) is cleared whenever a new clone attempt starts (i.e., reset alongside the other modal state in `resetModal`, since a successful re-clone changes `selfVoiceCloneId` and the old preview would no longer represent the current voice) — resetting on `resetModal` is sufficient because that's the only path that changes which voice is active.

---

## Error Handling

- No `ready` clone: the button doesn't render (mirrors the existing pattern where "Replace voice"/"Clone your voice" already only render in the relevant states) — there's nothing to preview in `training`/`failed`/`null` states.
- Billing blocked: surfaces `BillingBlocked`'s message via the same `catch` pattern already used in `beginVoiceCloneUploadAction`.
- HeyGen synthesis failure: raw error message shown via toast — no dedicated error class needed (unlike the clone-limit case), since a TTS call has no equivalent shared-resource-cap failure mode worth distinguishing.

---

## Testing

- `src/integrations/index.test.ts`: stubbed-`fetch` unit test for `synthesizeSpeech` (happy path + missing-`audio_url` throw), matching existing style.
- New test cases in `src/app/actions.voice-clone.test.ts` (or a new file if that one has grown unwieldy — controller's call at plan-writing time) for `previewVoiceCloneAction`: rejects when no ready clone exists, calls `billingGate.check` before the provider call, returns the audio URL on success, surfaces the provider's error on failure.
- No component test for the button/playback (browser `Audio`/`<audio>` playback, same testing-infeasibility precedent as the rest of this feature's UI).
- Manual browser verification: click "Play sample," confirm audio plays; click again, confirm no new network request (cached replay); replace the voice, confirm the cache clears and a fresh click re-synthesizes.

---

## Alternatives Considered

1. **Chosen — a fixed preview phrase, synthesized on demand via HeyGen's TTS endpoint, cached client-side per session.** Minimal surface area; answers the actual question ("does this cloned voice sound right?") without new UI complexity.
2. **Let the owner type custom preview text.** Rejected for this pass (explicit user decision): adds a text input and its own validation for a feature whose whole point is a quick sanity check, not a scripting tool.
3. **Persist the preview audio URL on the server (e.g., a new column) instead of only caching client-side.** Rejected: HeyGen's `audio_url` is generated fresh per request and this is a disposable sanity-check artifact, not campaign content — nothing downstream needs to reference it later, so persisting it would be pure overhead (YAGNI).

---

## Out of Scope

- Custom/editable preview text.
- Persisting or reusing preview audio across sessions/page reloads.
- Any change to the actual campaign-video generation pipeline (`generateVideoAction`) — this is a standalone sanity-check feature, not part of the video-generation voice resolution.
