# Voice Clone Preview Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a campaign owner hear their actual cloned HeyGen voice speak a sample phrase, so they can judge whether the clone sounds right — not just replay their own pre-clone upload/recording.

**Architecture:** Add a `synthesizeSpeech` method to the existing `PhotoAvatarProvider` interface/implementations (calls HeyGen's synchronous `POST /v3/voices/speech`), a new read-only server action `previewVoiceCloneAction`, and a "Play sample" button in `VoiceCloneManager` that caches the synthesized audio URL client-side so repeat plays don't re-hit HeyGen.

**Tech Stack:** HeyGen v3 API (`POST /v3/voices/speech`, synchronous — no polling), Next.js Server Actions, browser `Audio`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-04-voice-clone-preview-playback-design.md`

## Global Constraints

- `previewVoiceCloneAction` has no `can()` permission gate — matches `checkVoiceCloneStatusAction`'s existing precedent (read-only, any authenticated campaign member can listen).
- `billingGate.check(campaignId)` is required (real HeyGen API call) — no `quotaGate` call (no accumulating resource to cap; this is a one-off synthesis, not a persisted asset).
- The preview text is fixed, not user-editable: `'Hello, this is a preview of your cloned voice.'`
- The synthesized audio URL is cached client-side only (component state) — never persisted to the database. It's disposable; nothing downstream references it.
- No component test for the button/playback itself (browser `Audio` playback is not feasible to test in this project's Vitest setup — matches the established precedent for this feature's other browser-API-dependent UI).

---

### Task 1: `synthesizeSpeech` on `PhotoAvatarProvider`

**Files:**
- Modify: `src/integrations/index.ts` (interface at line 46-65, `HeyGenPhotoAvatarProvider` class ending at line 396, `MockPhotoAvatarProvider` class ending at line 548)
- Test: `src/integrations/index.test.ts`

**Interfaces:**
- Consumes: nothing new (same `this.apiKey` the class already has).
- Produces: `PhotoAvatarProvider.synthesizeSpeech(input: { voiceId: string; text: string }): Promise<{ audioUrl: string }>`. Consumed by Task 2 (`previewVoiceCloneAction`).

- [ ] **Step 1: Write the failing tests**

Add to `src/integrations/index.test.ts`, following the same `vi.stubGlobal('fetch', ...)` style already used for `cloneVoice`/`getVoiceCloneStatus` in that file:

```typescript
describe('HeyGenPhotoAvatarProvider.synthesizeSpeech', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts to /v3/voices/speech and returns the audio_url', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { audio_url: 'https://heygen.test/preview.mp3', duration: 3.2 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    const result = await provider.synthesizeSpeech({ voiceId: 'clone-123', text: 'Hello, this is a preview.' });

    expect(result).toEqual({ audioUrl: 'https://heygen.test/preview.mp3' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.heygen.com/v3/voices/speech', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Api-Key': 'test-key' }),
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ text: 'Hello, this is a preview.', voice_id: 'clone-123' });
  });

  it('throws if HeyGen does not return an audio_url', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    }));
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await expect(provider.synthesizeSpeech({ voiceId: 'clone-123', text: 'x' })).rejects.toThrow(/did not return an audio/i);
  });

  it('throws with the HeyGen error message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'invalid voice_id' } }),
    }));
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await expect(provider.synthesizeSpeech({ voiceId: 'bad-id', text: 'x' })).rejects.toThrow(/invalid voice_id/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/integrations/index.test.ts`
Expected: FAIL with `provider.synthesizeSpeech is not a function`.

- [ ] **Step 3: Add the method to the `PhotoAvatarProvider` interface**

In `src/integrations/index.ts`, inside the interface body (after `deleteVoiceClone(voiceCloneId: string): Promise<void>;` at line 64, before the closing `}` at line 65):

```typescript
  synthesizeSpeech(input: { voiceId: string; text: string }): Promise<{ audioUrl: string }>;
```

- [ ] **Step 4: Implement on `HeyGenPhotoAvatarProvider`**

In `src/integrations/index.ts`, inside the `HeyGenPhotoAvatarProvider` class, after `deleteVoiceClone`'s closing `}` (currently ending at line 396), before the class's own closing `}` (line 397):

```typescript
  async synthesizeSpeech({ voiceId, text }: { voiceId: string; text: string }) {
    const res = await fetch('https://api.heygen.com/v3/voices/speech', {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice_id: voiceId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`HeyGen synthesize speech error: ${json.error?.message ?? res.status}`);
    const audioUrl = json.data?.audio_url;
    if (!audioUrl) throw new Error('HeyGen did not return an audio_url.');
    return { audioUrl };
  }
```

- [ ] **Step 5: Add the mock implementation**

In `src/integrations/index.ts`, inside `MockPhotoAvatarProvider`, after `deleteVoiceClone` (line 547), before the class's closing `}` (line 548):

```typescript
  async synthesizeSpeech(_input: { voiceId: string; text: string }) { return { audioUrl: 'https://example.com/mock-voice-preview.mp3' }; }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/integrations/index.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `npx vitest run --exclude '**/.claude/**'` (required exclusion flag — stale unrelated worktrees in this repo fail for unrelated reasons and are not your concern).
Expected: PASS

- [ ] **Step 8: Stage your changes**

```bash
git add src/integrations/index.ts src/integrations/index.test.ts
```

Do NOT commit — the user reviews and commits everything themselves at the end.

---

### Task 2: `previewVoiceCloneAction` server action

**Files:**
- Modify: `src/app/actions.ts` (add after `checkVoiceCloneStatusAction`, which currently ends at line 1157, before `generatePromptLookAction` at line 1159)
- Test: `src/app/actions.voice-clone.test.ts`

**Interfaces:**
- Consumes: `photoAvatarProvider.synthesizeSpeech` (Task 1), `getCandidateProfile` (existing, `@/lib/candidate`), `billingGate.check` (existing, `@/lib/services`).
- Produces: `previewVoiceCloneAction(): Promise<Result & { audioUrl?: string }>`. Consumed by Task 3 (`VoiceCloneManager`'s "Play sample" button).

- [ ] **Step 1: Write the failing tests**

Add to `src/app/actions.voice-clone.test.ts`. This file already mocks `@/lib/session` (`requireSession` → a session with `campaignId: 'c-1'`), `@/lib/candidate` (`getCandidateProfile`/`upsertCandidateProfile` as `vi.fn()`), and `@/lib/services` (including `billingGate: { check: vi.fn(...) }` and `photoAvatarProvider` — add `synthesizeSpeech: vi.fn()` to that existing mock object). Add this new `describe` block:

```typescript
describe('previewVoiceCloneAction', () => {
  it('rejects when there is no ready self-clone', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'training', selfVoiceCloneId: 'clone-1' });
    const { previewVoiceCloneAction } = await import('./actions');

    const result = await previewVoiceCloneAction();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no cloned voice/i);
    expect(photoAvatarProvider.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it('checks billingGate before calling the provider', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'ready', selfVoiceCloneId: 'clone-1' });
    billingGate.check.mockRejectedValue(new BillingBlocked('Billing is past due.'));
    const { previewVoiceCloneAction } = await import('./actions');

    const result = await previewVoiceCloneAction();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/billing/i);
    expect(photoAvatarProvider.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it('on success, returns the audio URL using the fixed preview text and the self-clone voice id', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'ready', selfVoiceCloneId: 'clone-1' });
    photoAvatarProvider.synthesizeSpeech.mockResolvedValue({ audioUrl: 'https://heygen.test/preview.mp3' });
    const { previewVoiceCloneAction } = await import('./actions');

    const result = await previewVoiceCloneAction();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.audioUrl).toBe('https://heygen.test/preview.mp3');
    expect(photoAvatarProvider.synthesizeSpeech).toHaveBeenCalledWith({
      voiceId: 'clone-1',
      text: 'Hello, this is a preview of your cloned voice.',
    });
  });

  it('surfaces the provider error on failure', async () => {
    getCandidateProfile.mockResolvedValue({ selfVoiceCloneStatus: 'ready', selfVoiceCloneId: 'clone-1' });
    photoAvatarProvider.synthesizeSpeech.mockRejectedValue(new Error('HeyGen synthesize speech error: invalid voice_id'));
    const { previewVoiceCloneAction } = await import('./actions');

    const result = await previewVoiceCloneAction();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid voice_id/);
  });
});
```

Check the top of `src/app/actions.voice-clone.test.ts` for the existing `photoAvatarProvider` mock object (it currently has `uploadAsset`, `cloneVoice`, `getVoiceCloneStatus`, `deleteVoiceClone` as `vi.fn()`s inside the `vi.mock('@/lib/services', ...)` call) and add `synthesizeSpeech: vi.fn(),` to it — do not create a second mock.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/actions.voice-clone.test.ts`
Expected: FAIL with `previewVoiceCloneAction is not exported` (and `photoAvatarProvider.synthesizeSpeech` undefined until the mock object is updated).

- [ ] **Step 3: Implement the action in `src/app/actions.ts`**

Add after `checkVoiceCloneStatusAction`'s closing `}` (currently line 1157):

```typescript
const VOICE_PREVIEW_TEXT = 'Hello, this is a preview of your cloned voice.';

export async function previewVoiceCloneAction(): Promise<Result & { audioUrl?: string }> {
  const s = await requireSession();
  const { getCandidateProfile } = await import('@/lib/candidate');
  const profile = await getCandidateProfile(s.campaignId);
  if (profile?.selfVoiceCloneStatus !== 'ready' || !profile.selfVoiceCloneId) {
    return { ok: false, error: 'No cloned voice is ready yet.' };
  }

  try {
    await billingGate.check(s.campaignId);
  } catch (e) {
    if (e instanceof QuotaExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }

  try {
    const { audioUrl } = await photoAvatarProvider.synthesizeSpeech({
      voiceId: profile.selfVoiceCloneId,
      text: VOICE_PREVIEW_TEXT,
    });
    return { ok: true, audioUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/actions.voice-clone.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npx vitest run --exclude '**/.claude/**'`
Expected: PASS

- [ ] **Step 6: Stage your changes**

```bash
git add src/app/actions.ts src/app/actions.voice-clone.test.ts
```

Do NOT commit — the user reviews and commits everything themselves at the end.

---

### Task 3: "Play sample" button in `VoiceCloneManager`

**Files:**
- Modify: `src/components/VoiceCloneManager.tsx`

**Interfaces:**
- Consumes: `previewVoiceCloneAction` (Task 2).
- Produces: no new exports — same component signature as before.

- [ ] **Step 1: Read the current file and confirm it matches**

The file should currently be 367 lines, importing `beginVoiceCloneUploadAction, finalizeVoiceCloneAction, checkVoiceCloneStatusAction` from `@/app/actions` at line 5, and its `status === 'ready'` rendering is at line 248: `` {status === 'ready' && `Ready — "${name}"`} ``, inside the `{status && (...)}` block that starts at line 239. If the file doesn't match (different line count, different imports, this exact line missing), stop and report back with what you found rather than guessing.

- [ ] **Step 2: Update the import line**

Replace line 5:
```typescript
import { beginVoiceCloneUploadAction, finalizeVoiceCloneAction, checkVoiceCloneStatusAction } from '@/app/actions';
```
with:
```typescript
import { beginVoiceCloneUploadAction, finalizeVoiceCloneAction, checkVoiceCloneStatusAction, previewVoiceCloneAction } from '@/app/actions';
```

- [ ] **Step 3: Add preview state**

After line 43 (`const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);`), add:

```typescript
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
```

- [ ] **Step 4: Clear the preview cache in `resetModal`**

In `resetModal` (currently lines 85-104), add `setPreviewAudioUrl(null);` right after `setAudioPreviewUrl(null);` (currently line 91):

```typescript
    setAudioPreviewUrl(null);
    setPreviewAudioUrl(null);
```

- [ ] **Step 5: Add the `handlePlaySample` function**

Add this function after `handleSubmit` (which currently ends at line 218), before the `return (` (line 220):

```typescript
  async function handlePlaySample() {
    if (previewAudioUrl) {
      new Audio(previewAudioUrl).play();
      return;
    }
    setPreviewLoading(true);
    const result = await previewVoiceCloneAction();
    setPreviewLoading(false);
    if (!result.ok || !result.audioUrl) {
      toast(result.ok ? 'Failed to generate voice preview' : result.error, 'error');
      return;
    }
    setPreviewAudioUrl(result.audioUrl);
    new Audio(result.audioUrl).play();
  }
```

- [ ] **Step 6: Add the "Play sample" button to the ready-status line**

Replace (currently lines 239-252):
```tsx
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
```

with:
```tsx
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
          {status === 'ready' && (
            <button type="button" className="btn" style={{ fontSize: 12 }} disabled={previewLoading} onClick={handlePlaySample}>
              {previewLoading ? 'Generating…' : '▶ Play sample'}
            </button>
          )}
        </div>
      )}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Run the full suite to confirm no regressions**

Run: `npx vitest run --exclude '**/.claude/**'`
Expected: PASS (this task adds no new automated tests — see Global Constraints).

- [ ] **Step 9: Manual browser verification (required)**

If a dev server and real browser session are available: navigate to `/avatars`, with a campaign that already has a `ready` self-voice-clone (per the conversation, this project's own dev database has one — "hamza", confirmed ready). Confirm:
- "Play sample" appears next to "Ready — ..." and shows "Generating…" on first click.
- Audio plays after generation completes.
- Clicking "Play sample" again replays without a new loading state (cached).
- Replacing the voice (going through the clone wizard again) and then clicking "Play sample" on the new ready state generates a fresh preview (cache was cleared).

If not feasible in this environment, say so explicitly in your report rather than skipping verification silently.

- [ ] **Step 10: Stage your changes**

```bash
git add src/components/VoiceCloneManager.tsx
```

Do NOT commit — the user reviews and commits everything themselves at the end.

---

## Post-Implementation Checklist

- [ ] Re-read `docs/superpowers/specs/2026-08-04-voice-clone-preview-playback-design.md` and confirm every section has a corresponding completed task above.
- [ ] Confirm no database column or migration was added — this feature is deliberately stateless server-side (Global Constraints).
- [ ] Run `npx vitest run --exclude '**/.claude/**'` once more for the full suite.
- [ ] If a real browser session is available, do the manual verification from Task 3 Step 9 if it wasn't already done.
