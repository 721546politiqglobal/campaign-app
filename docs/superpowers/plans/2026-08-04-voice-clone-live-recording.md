# Voice Clone Live Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a campaign owner record their voice sample directly in the browser (via microphone), as an alternative to uploading a file, when cloning their voice on `/avatars`.

**Architecture:** Widen the backend's audio-type check from an exact match to a prefix match (browser-recorded audio reports a MIME type with a codec suffix, e.g. `audio/webm;codecs=opus`). Add a `MediaRecorder`-based recording flow to `VoiceCloneManager`'s existing Step 2, which produces a `File` object fed into the exact same `file` state, upload pipeline, and server actions the file-upload path already uses. No new server actions.

**Tech Stack:** Browser `MediaRecorder`/`getUserMedia` APIs, React (existing `VoiceCloneManager.tsx` client component), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-04-voice-clone-live-recording-design.md`

## Global Constraints

- Recording is an *addition* to file upload, not a replacement — both remain selectable.
- The recorded `Blob` is wrapped in a `File` and set into the same `file` state the upload input already uses — no new server actions, no new Storage path pattern.
- Backend audio-type validation becomes a **prefix** match (not exact) and gains `audio/webm`, so a MIME type like `audio/webm;codecs=opus` is accepted.
- Duration guidance is soft/non-blocking only: warn under 30s or over 5 minutes, never block "Next."
- Microphone permission denial must show a clear inline message and leave "Upload a file" selectable — never a silent dead end.
- No automated tests are added for `MediaRecorder`/`getUserMedia` behavior itself (no feasible way to exercise real browser media APIs in this project's Vitest setup) — matches the precedent set by the original voice-cloning plan's Task 5 (UI-only, no component tests, verified via typecheck + full suite + manual browser check).

---

### Task 1: Widen backend audio-type validation to accept recorded audio

**Files:**
- Modify: `src/app/actions.ts:1020-1033` (`beginVoiceCloneUploadAction`)
- Test: `src/app/actions.voice-clone.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change — `beginVoiceCloneUploadAction(consent: boolean, file: { name: string; type: string; size: number })` behaves identically for existing callers, and additionally accepts any `file.type` starting with `audio/webm` (or any of the pre-existing prefixes, now prefix-matched instead of exact-matched). Consumed by Task 2's recording flow, which passes a `File` whose `.type` is the browser's `MediaRecorder.mimeType` (e.g. `audio/webm;codecs=opus`).

- [ ] **Step 1: Write the failing test**

Open `src/app/actions.voice-clone.test.ts` and find the `describe('beginVoiceCloneUploadAction', ...)` block (it already contains tests like "requires the consent checkbox", "rejects a non-audio file", etc., using the `audioMeta()` helper defined near the top of the file: `function audioMeta(overrides = {}) { return { name: 'sample.mp3', type: 'audio/mpeg', size: 1024, ...overrides }; }`). Add this test inside that same `describe` block:

```typescript
  it('accepts a browser-recorded webm file with a codec suffix', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const result = await beginVoiceCloneUploadAction(true, audioMeta({ name: 'recording.webm', type: 'audio/webm;codecs=opus' }));
    expect(result.ok).toBe(true);
  });

  it('still rejects a non-audio type after the prefix-match change', async () => {
    const { beginVoiceCloneUploadAction } = await import('./actions');
    const result = await beginVoiceCloneUploadAction(true, audioMeta({ name: 'photo.jpg', type: 'image/jpeg' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/audio/i);
  });
```

- [ ] **Step 2: Run tests to verify the new test fails**

Run: `npx vitest run src/app/actions.voice-clone.test.ts`
Expected: the "accepts a browser-recorded webm file" test FAILS with `result.ok` being `false` (the current exact-match check rejects `audio/webm;codecs=opus` since it isn't literally in the allowlist). The "still rejects a non-audio type" test should already PASS (it's a regression check, not new behavior) — if it doesn't, stop and report back before proceeding, since that would mean something else has changed.

- [ ] **Step 3: Widen the validation in `src/app/actions.ts`**

Find this code (currently at line 1020-1033):

```typescript
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
```

Replace it with:

```typescript
const MAX_VOICE_SAMPLE_BYTES = 50 * 1024 * 1024;
// Prefix match, not exact: browser-recorded audio (MediaRecorder) reports a
// MIME type with a codec suffix, e.g. "audio/webm;codecs=opus", which never
// exact-matches a bare "audio/webm" entry.
const ALLOWED_VOICE_SAMPLE_TYPE_PREFIXES = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm'];

export async function beginVoiceCloneUploadAction(
  consent: boolean,
  file: { name: string; type: string; size: number },
): Promise<Result & { path?: string; token?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };
  if (!consent) return { ok: false, error: 'Consent confirmation is required.' };

  if (!file || file.size === 0) return { ok: false, error: 'Upload an audio sample.' };
  if (file.size > MAX_VOICE_SAMPLE_BYTES) return { ok: false, error: 'Audio sample must be under 50 MB.' };
  if (!ALLOWED_VOICE_SAMPLE_TYPE_PREFIXES.some(prefix => file.type.startsWith(prefix))) {
    return { ok: false, error: 'Only MP3, WAV, M4A, or WebM audio files are allowed.' };
  }
```

Everything after this point in the function (the `attemptId`/`ext`/`path` construction, the `billingGate.check` call, the signed-upload-URL creation) is unchanged — do not modify anything below this block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/actions.voice-clone.test.ts`
Expected: PASS (all tests in the file, including the two new ones and every pre-existing one — the pre-existing "rejects a non-audio file" test used `image/jpeg`, which still correctly fails the prefix check).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npx vitest run --exclude '**/.claude/**'` (the exclusion flag is required — this repo has stale unrelated worktrees under `.claude/worktrees/` that fail for unrelated reasons and are not your concern).
Expected: PASS, same file/test counts as before this task plus the 2 new tests.

- [ ] **Step 6: Stage your changes**

```bash
git add src/app/actions.ts src/app/actions.voice-clone.test.ts
```

Do NOT commit — the user reviews and commits everything themselves at the end.

---

### Task 2: Add in-browser recording to `VoiceCloneManager`'s Step 2

**Files:**
- Modify: `src/components/VoiceCloneManager.tsx` (full-file replacement — see below)

**Interfaces:**
- Consumes: `beginVoiceCloneUploadAction` with the widened type-prefix check from Task 1 — the recorded `File`'s `.type` (the browser's `MediaRecorder.mimeType`, e.g. `audio/webm;codecs=opus`) must pass that check for the end-to-end flow to work, so Task 1 must be complete first.
- Produces: no new exports — same `VoiceCloneManager({ status, name, error, canManage })` component signature as before. Nothing outside this file changes.

This file currently has 184 lines. The diff is large enough (new state, new handlers, restructured Step 2 JSX) that a full-file replacement is clearer and less error-prone than a series of small edits. Read the current file first (`src/components/VoiceCloneManager.tsx`) to confirm it still matches what's below before overwriting — if it has diverged (e.g. Task 1 or something else changed it), stop and report back rather than guessing which parts to keep.

- [ ] **Step 1: Read the current file and confirm it matches**

The file should currently start with:
```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { beginVoiceCloneUploadAction, finalizeVoiceCloneAction, checkVoiceCloneStatusAction } from '@/app/actions';
```
and be 184 lines total. If it doesn't match this (different line count, different imports), stop and report back with what you found instead of proceeding.

- [ ] **Step 2: Replace the entire file with this content**

```tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { beginVoiceCloneUploadAction, finalizeVoiceCloneAction, checkVoiceCloneStatusAction } from '@/app/actions';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { useToast } from '@/components/Toast';

const POLL_MS = 5000;
const mediaRecorderSupported = typeof MediaRecorder !== 'undefined';

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
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);

  const [audioSource, setAudioSource] = useState<'upload' | 'record'>('upload');
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [recordDurationWarning, setRecordDurationWarning] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!file) { setAudioPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setAudioPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Stops the microphone (releasing the browser/OS recording indicator) if
  // the component unmounts mid-recording, e.g. the owner navigates away.
  useEffect(() => {
    return () => { mediaStreamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

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
    setAudioPreviewUrl(null);
    setAudioSource('upload');
    setIsRecording(false);
    setRecordedSeconds(0);
    setRecordDurationWarning(null);
    setMicError(null);
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    mediaStreamRef.current = null;
  }

  function selectAudioSource(source: 'upload' | 'record') {
    setAudioSource(source);
    setFile(null);
    setRecordDurationWarning(null);
    setMicError(null);
  }

  async function startRecording() {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) recordingChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        mediaStreamRef.current?.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType });
        // A near-empty blob means the recording was effectively instant
        // (start immediately followed by stop) — treat it as no recording
        // rather than sending a useless sample through the clone pipeline.
        if (blob.size < 1024) {
          toast('Recording was too short — try again.', 'error');
          return;
        }
        const ext = recorder.mimeType.split(';')[0].split('/')[1] || 'webm';
        setFile(new File([blob], `recording.${ext}`, { type: recorder.mimeType }));
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordedSeconds(0);
      setRecordDurationWarning(null);
      recordingTimerRef.current = setInterval(() => setRecordedSeconds(s => s + 1), 1000);
    } catch {
      setMicError('Microphone access is needed to record — you can upload a file instead.');
    }
  }

  function stopRecording() {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (recordedSeconds < 30) setRecordDurationWarning('This recording looks shorter than 30 seconds — a longer sample usually clones more accurately.');
    else if (recordedSeconds > 300) setRecordDurationWarning('This recording looks longer than 5 minutes — HeyGen recommends under 5 minutes.');
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
                <h3 style={{ marginBottom: 12, fontSize: 16 }}>Provide an audio sample</h3>

                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <button type="button" className={audioSource === 'record' ? 'btn primary' : 'btn'} style={{ fontSize: 12 }}
                    onClick={() => selectAudioSource('record')}>
                    Record
                  </button>
                  <button type="button" className={audioSource === 'upload' ? 'btn primary' : 'btn'} style={{ fontSize: 12 }}
                    onClick={() => selectAudioSource('upload')}>
                    Upload a file
                  </button>
                </div>

                {audioSource === 'upload' && (
                  <>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                      Upload a clear, single-speaker MP3, WAV, or M4A recording.
                    </p>
                    <input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/webm"
                      onChange={e => setFile(e.target.files?.[0] ?? null)} />
                  </>
                )}

                {audioSource === 'record' && mediaRecorderSupported && (
                  <>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                      Record a clear, single-speaker sample directly from your microphone.
                    </p>
                    {micError && (
                      <p className="muted" style={{ fontSize: 12, marginBottom: 10, color: 'var(--bad)' }}>{micError}</p>
                    )}
                    {!isRecording && !file && (
                      <button type="button" className="btn primary" style={{ fontSize: 13 }} onClick={startRecording}>
                        ● Start Recording
                      </button>
                    )}
                    {isRecording && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--bad)', boxShadow: '0 0 6px var(--bad)' }} />
                        <span className="mono">{Math.floor(recordedSeconds / 60)}:{String(recordedSeconds % 60).padStart(2, '0')}</span>
                        <button type="button" className="btn" style={{ fontSize: 13 }} disabled={recordedSeconds < 1} onClick={stopRecording}>
                          Stop Recording
                        </button>
                      </div>
                    )}
                    {!isRecording && file && (
                      <button type="button" className="btn" style={{ fontSize: 12 }}
                        onClick={() => { setFile(null); setRecordDurationWarning(null); }}>
                        Re-record
                      </button>
                    )}
                  </>
                )}

                {audioSource === 'record' && !mediaRecorderSupported && (
                  <p className="muted" style={{ fontSize: 12 }}>
                    Recording isn&rsquo;t supported in this browser — please upload a file instead.
                  </p>
                )}

                {file && (
                  <audio src={audioPreviewUrl ?? undefined} controls style={{ width: '100%', marginTop: 12 }} />
                )}
                {recordDurationWarning && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 8, color: 'var(--warn)' }}>{recordDurationWarning}</p>
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

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (`MediaRecorder`, `MediaStream`, `BlobPart`, `getUserMedia` are all standard `lib.dom.d.ts` types already available in this Next.js project's TypeScript config — no new `@types` package needed.)

- [ ] **Step 4: Run the full suite to confirm no regressions**

Run: `npx vitest run --exclude '**/.claude/**'`
Expected: PASS, same counts as after Task 1 (this task adds no new automated tests — see Global Constraints for why).

- [ ] **Step 5: Manual browser verification (required — this is the only verification for the recording behavior itself)**

If a dev server and real browser session are available in this environment: run `npm run dev`, sign in as an `owner`-role session, navigate to `/avatars`, open "Clone your voice," go to Step 2, and confirm:
- The "Record" / "Upload a file" toggle renders and switching between them clears any previously selected file.
- Clicking "Start Recording" prompts for microphone permission (first time) and then shows the live timer and pulsing indicator.
- "Stop Recording" (enabled only after ~1 second) produces a playable preview via the existing `<audio>` element.
- "Re-record" discards the take and returns to the "Start Recording" button.
- Denying microphone permission shows the inline error message and "Upload a file" is still clickable and functional.
- After the browser tab/mic indicator, confirm the microphone indicator turns off after stopping a recording or closing the modal.

If no real browser session is available in this sandboxed environment (no authenticated session, no display), say so explicitly in your report rather than skipping verification silently — this matches how Task 5 of the original voice-cloning plan handled the same constraint.

- [ ] **Step 6: Stage your changes**

```bash
git add src/components/VoiceCloneManager.tsx
```

Do NOT commit — the user reviews and commits everything themselves at the end.

---

## Post-Implementation Checklist

- [ ] Re-read `docs/superpowers/specs/2026-08-04-voice-clone-live-recording-design.md` and confirm every section has a corresponding completed task above.
- [ ] Confirm the "Upload a file" path still works exactly as before (regression check) — its `<input type="file">`, `accept` attribute (now includes `audio/webm`), and submit flow are otherwise untouched.
- [ ] Run `npx vitest run --exclude '**/.claude/**'` once more for the full suite.
- [ ] If a real browser session is available, do the manual verification from Task 2 Step 5 if it wasn't already done.
