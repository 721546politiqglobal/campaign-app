# Voice Clone Live Recording — Design Spec

**Date:** 2026-08-04
**Status:** Approved

---

## Overview

[2026-08-02-self-service-voice-cloning-design.md](./2026-08-02-self-service-voice-cloning-design.md) let campaign owners clone their own voice by uploading an audio file. Owners now want to record directly in the browser instead of needing a pre-existing recording — recording live, in a controlled setting, tends to produce a cleaner sample than whatever file happens to be lying around, which is the whole point of a "best and accurate result."

This spec adds an in-browser microphone recorder as a second path alongside the existing file upload, inside the same Step 2 of `VoiceCloneManager`'s 3-step modal. It reuses every piece of backend/server-action infrastructure the upload path already built — the recorded audio is wrapped in a `File` object client-side and fed through the exact same `beginVoiceCloneUploadAction` → signed-upload → `finalizeVoiceCloneAction` pipeline. No new server actions.

---

## Current State vs. New State

| | Today | After this spec |
|---|---|---|
| Step 2 options | File upload only | Choice of "Record" or "Upload a file" |
| Recording mechanism | None | Browser `MediaRecorder` API via `getUserMedia` |
| Backend audio-type allowlist | `audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/mp4`, `audio/x-m4a` (exact match) | Same list plus `audio/webm`, matched by **prefix** instead of exact match (recorded audio reports a codec suffix, e.g. `audio/webm;codecs=opus`) |
| Duration guidance | None for voice (video avatar has soft 30s–5min warnings) | Same soft, non-blocking 30s–5min warning applied to recordings |
| Mic permission denial | N/A | Clear inline message; upload option stays available as fallback |

---

## UI/UX

**`src/components/VoiceCloneManager.tsx`, Step 2** becomes a small two-option control at the top ("Record" / "Upload a file"), mirroring `AvatarManager.tsx`'s existing "From photos"/"From video" pattern, each revealing its own sub-view within the same step (not a separate wizard step — stays "Step 2 of 3").

**Record sub-view:**
- Idle: "Start Recording" button. Clicking calls `navigator.mediaDevices.getUserMedia({ audio: true })`.
  - On permission denial or no device (`NotAllowedError`/`NotFoundError`), show: "Microphone access is needed to record — you can upload a file instead," and switch focus to the upload option (still selectable via the toggle).
- Recording: elapsed-time counter (`0:00` ticking up), pulsing "recording" indicator, "Stop Recording" button. Uses `MediaRecorder` on the `MediaStream`, collecting chunks via `ondataavailable`.
- Stopped: the recorded chunks combine into a `Blob` (`new Blob(chunks, { type: mediaRecorder.mimeType })`). This is wrapped into a `File` (`new File([blob], `recording.${ext}`, { type: blob.type })`, where `ext` is the MIME type's subtype before any `;codecs=` suffix — e.g. `audio/webm;codecs=opus` → `webm`). The extension is cosmetic only: `beginVoiceCloneUploadAction` (`src/app/actions.ts:1042`) uses it solely to name the Storage path (`sample.${ext}`) and never inspects it for validation — that's what the MIME-type prefix check below is for. The resulting `File` is set into the **same `file` state** the upload path already uses — so playback preview, the existing `audioPreviewUrl` effect, Step 2's "Next" button, and `handleSubmit` all work unmodified.
  - Below the preview: "Re-record" (discards the `File`, clears `file` state, returns to Idle) alongside the existing Step 2 controls.
  - Soft duration warning (matching the video-avatar pattern): if the recorded duration is under 30s or over 5 minutes, show a non-blocking warning banner; "Next" stays enabled either way.
- The microphone `MediaStream`'s tracks are stopped (`track.stop()`) as soon as recording stops or the modal closes/resets, so the mic indicator in the browser tab/OS doesn't stay active.

**Upload sub-view:** unchanged — the existing `<input type="file">` and preview.

Toggling between "Record" and "Upload a file" clears whichever `file` was set by the other path, so there's never ambiguity about which source produced the current sample.

---

## Backend

**`src/app/actions.ts`, `beginVoiceCloneUploadAction`** (line 1021, 1033):

```typescript
const ALLOWED_VOICE_SAMPLE_TYPE_PREFIXES = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm'];
```

The check changes from exact match to prefix match:

```typescript
if (!ALLOWED_VOICE_SAMPLE_TYPE_PREFIXES.some(prefix => file.type.startsWith(prefix))) {
  return { ok: false, error: 'Only MP3, WAV, M4A, or WebM audio files are allowed.' };
}
```

This is the only backend change. Everything downstream — the signed upload URL, `finalizeVoiceCloneAction`'s download-from-storage step, `uploadAsset` → `cloneVoice`, status polling — is source-agnostic (it never inspected the file's MIME type beyond this one check) and needs no changes.

No new consent wording: the existing Step 1 consent checkbox ("I confirm I have permission to create an AI clone of this voice") already covers a live recording the same way it covers an uploaded file — recording is just another way of producing the same audio sample.

---

## Error Handling

- **Mic permission denied / no device:** handled entirely client-side (see UI/UX) — never reaches the server, so no new server-side error path.
- **`MediaRecorder` unsupported** (very old browsers): feature-detect via `typeof MediaRecorder === 'undefined'`. **As actually implemented** (a deliberate, reviewed deviation from this section's original wording, which called for hiding the toggle entirely): the "Record" toggle button always renders, but selecting it on an unsupported browser shows "Recording isn't supported in this browser — please upload a file instead" instead of the recording controls — never a broken/inert button. This was judged acceptable during final review (simpler than conditionally hiding a toggle button) and this doc is updated to match what shipped.
- **Empty recording** (user starts and immediately stops): the resulting `Blob` still produces a `File` with `size > 0` in practice (container overhead), but as a guard, disable "Stop Recording" until at least 1 second has elapsed, and treat a resulting file under 1KB as if no recording was made (stay on the Idle sub-view with a brief toast).

---

## Testing

- No new automated tests are practical for `MediaRecorder`/`getUserMedia` browser APIs in this project's Vitest setup (no existing precedent for mocking browser media APIs in the codebase, and the actual capture behavior can only be meaningfully verified in a real browser) — consistent with Task 5 of the original voice-cloning plan, which was also UI-only with no component tests.
- `src/app/actions.voice-clone.test.ts`: add a test confirming `beginVoiceCloneUploadAction` accepts `audio/webm;codecs=opus` (prefix match) and still rejects an unrelated type like `image/jpeg`.
- Manual browser verification (required, given no automated coverage is feasible): record a short clip, confirm playback preview, confirm "Re-record" discards and restarts cleanly, confirm the full clone flow completes exactly as it does for an uploaded file, and confirm the mic indicator turns off after stopping/closing.

---

## Alternatives Considered

1. **Chosen — reuse the existing `file` state and upload pipeline by wrapping the recorded Blob in a File.** Zero new server actions, zero new storage paths, zero new billing/quota logic — the entire backend already treats "an audio file arrived" generically.
2. **A separate `finalizeVoiceCloneFromRecordingAction`.** Rejected: would duplicate the consent/billing/delete-before-create/status-persistence logic `finalizeVoiceCloneAction` already has, for no behavioral difference — the two audio sources are indistinguishable once they're bytes in Storage (YAGNI).
3. **Client-side transcoding to a fixed format (e.g., always re-encode to WAV) before upload.** Rejected: adds real complexity (a WASM encoder or Web Audio API render pipeline) to solve a problem that doesn't need solving — HeyGen's clone endpoint accepts common audio containers, and the backend only needs to widen a type check, not normalize bytes.

---

## Out of Scope

- Waveform visualization during recording (a plain elapsed-time counter is sufficient).
- Multi-take recording (recording several clips and picking the best) — one recording at a time, replace via "Re-record."
- Any change to the ElevenLabs `VoiceLibrary.tsx` narration feature — unrelated, as in the original spec.
