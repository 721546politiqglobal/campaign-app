# Integrations Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This plan is TDD: write the failing test, watch it fail, implement, watch it pass.

**Goal:** Close the P1/P2 integration-robustness findings from the 2026-07-15 audit that the P0 plan deferred: INT-3, INT-4, INT-5, INT-6, INT-7, INT-8, INT-10, INT-11, INT-12, INT-13, INT-14. Together these make the video/voice/publish pipelines fail loudly instead of silently, stop cross-tenant/data leakage on the provider proxies, prevent double-publishing, and remove the last hardcoded/global-fallback footguns.

**Architecture:** Every fix is a bounded edit to existing provider adapters (`src/integrations/index.ts`), the provider seam (`src/lib/services.ts`), a handful of server actions (`src/app/actions.ts`), two API proxy routes, the publish cron route, one client component (`src/components/ContentWizard.tsx`), and the n8n workflow JSON. Two findings need a new schema column (INT-5 persists the video job on the content row; INT-7 adds a per-campaign HeyGen voice id), so two new numbered migrations are introduced (`015`, `016`) alongside the matching `repos.ts`/`candidate.ts` mapper and `domain/types.ts` updates. No new dependencies.

**Tech Stack:** Next.js 14 App Router, Supabase (`adminDb` service-role client), Vitest. Server actions return `type Result = { ok: true } | { ok: false; error: string }`.

## Global Constraints

- **No autonomous git commits** — the user reviews and commits (per project memory).
- Server actions return `type Result = { ok: true } | { ok: false; error: string }` (already declared at `src/app/actions.ts:18`). Actions that also return data widen it as `Result & { … }` (existing convention: `generateVideoAction`, `synthesizeVoiceAction`).
- **Preserve the existing mock/real provider seam.** `src/lib/services.ts` picks a real adapter when the env key is present and a `Mock*` adapter otherwise. Do not remove that structure — INT-3 only makes the *fallback* fail-closed in production; every adapter must still instantiate the real class when its key is set and the mock in dev/test.
- Add `requireSession()` (from `@/lib/session`) to every server action / route handler that currently reads provider data without it (INT-10). Where the fetched record is campaign-scoped, also compare against `s.campaignId`.
- Never introduce a second global/hardcoded provider id. Per-tenant ids live on `candidate_profiles`; when one is missing the action returns `{ ok: false }` rather than silently falling back to an env default (INT-6, INT-7).
- Tests mock `next/cache`, `next/navigation`, `@/lib/session`, `@/lib/data`, `@/lib/supabase`, `@/lib/repos`, `@/lib/services`, `@/lib/candidate` — mirror the scaffolding in `src/app/actions.avatar-billing.test.ts`. Provider-level tests stub `fetch` with `vi.stubGlobal` — mirror `src/integrations/index.test.ts`.
- **This plan assumes the P0 plan (`2026-07-15-p0-launch-blockers.md`) has landed.** In particular INT-11 (Task 8) depends on P0 **Task 5** (publish-on-success): it edits the post-Task-5 `src/app/api/cron/publish/route.ts` where the loop already declares `results_out`, inspects the `publisher.publish` results array, and reverts to `approved` on all-platform failure. Do not start Task 8 until P0 Task 5 is merged.

## Phase mapping (audit "Phase 3 — Provider robustness")

- **Fail-loud seam:** Task 1 (INT-3).
- **Video path:** Task 2 (INT-4), Task 3 (INT-5).
- **Voice path:** Task 4 (INT-6, INT-8), Task 5 (INT-7).
- **Defensive provider parsing:** Task 6 (INT-13, INT-14).
- **Access control:** Task 7 (INT-10).
- **Pipeline correctness:** Task 8 (INT-11).
- **External workflow:** Task 9 (INT-12).

---

### Task 1: Fail closed instead of silently mocking providers in production (INT-3)

**Files:**
- Modify: `src/lib/services.ts:24-46` (all six provider selectors)
- Test: `src/lib/services.test.ts` (new)

**Interfaces:**
- Produces: `function realOrMock<R, M>(key: string | undefined, name: string, real: () => R, mock: () => M): R | M` — returns `real()` when `key` is set; in production with no key it **throws** (fail closed); in dev/test with no key it returns `mock()`. Preserves the existing seam exactly (real when keyed, mock otherwise) for every non-production environment.

- [ ] **Step 1: Write the failing test** (`src/lib/services.test.ts`)

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('provider seam fails closed in production', () => {
  it('throws when a required provider key is missing in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AYRSHARE_API_KEY;
    delete process.env.HEYGEN_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    await expect(import('./services')).rejects.toThrow(/AYRSHARE_API_KEY|not configured/i);
  });

  it('uses mocks (no throw) when keys are missing outside production', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.AYRSHARE_API_KEY;
    const mod = await import('./services');
    // MockPublisher returns scheduled for every platform
    const out = await mod.publisher.publish({ platforms: ['x'], text: 't', disclosureText: '' } as never);
    expect(out).toEqual([{ platform: 'x', status: 'scheduled' }]);
  });

  it('uses the real adapter when the key is present, in any environment', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AYRSHARE_API_KEY = 'k';
    process.env.HEYGEN_API_KEY = 'k';
    process.env.LLM_API_KEY = 'k';
    process.env.ELEVENLABS_API_KEY = 'k';
    process.env.NEWSDATA_API_KEY = 'k';
    const mod = await import('./services');
    const { AyrsharePublisher } = await import('@/integrations');
    expect(mod.publisher).toBeInstanceOf(AyrsharePublisher);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/services.test.ts`
Expected: FAIL — today `services.ts` silently constructs `MockPublisher` in production, so the first test does not throw.

- [ ] **Step 3: Implement `realOrMock` and rewrite the six selectors** in `src/lib/services.ts`. Replace the block at lines 24-46:

```ts
function realOrMock<R, M>(
  key: string | undefined,
  envVar: string,
  real: () => R,
  mock: () => M,
): R | M {
  if (key) return real();
  if (process.env.NODE_ENV === 'production') {
    // Silently mocking in prod means "publish succeeded / video ready" while
    // nothing actually happened. Refuse to boot instead.
    throw new Error(`${envVar} is not configured. Refusing to start with a mock provider in production.`);
  }
  return mock();
}

export const contentGenerator = realOrMock(
  process.env.LLM_API_KEY, 'LLM_API_KEY',
  () => new ClaudeContentGenerator(process.env.LLM_API_KEY!),
  () => new MockContentGenerator());

export const videoProvider = realOrMock(
  process.env.HEYGEN_API_KEY, 'HEYGEN_API_KEY',
  () => new HeyGenVideoProvider(process.env.HEYGEN_API_KEY!),
  () => new MockVideoProvider());

export const photoAvatarProvider: PhotoAvatarProvider = realOrMock(
  process.env.HEYGEN_API_KEY, 'HEYGEN_API_KEY',
  () => new HeyGenPhotoAvatarProvider(process.env.HEYGEN_API_KEY!),
  () => new MockPhotoAvatarProvider());

export const voiceProvider = realOrMock(
  process.env.ELEVENLABS_API_KEY, 'ELEVENLABS_API_KEY',
  () => new ElevenLabsVoiceProvider(process.env.ELEVENLABS_API_KEY!),
  () => new MockVoiceProvider());

export const publisher = realOrMock(
  process.env.AYRSHARE_API_KEY, 'AYRSHARE_API_KEY',
  () => new AyrsharePublisher(process.env.AYRSHARE_API_KEY!),
  () => new MockPublisher());

export const monitoringSource = realOrMock(
  process.env.NEWSDATA_API_KEY, 'NEWSDATA_API_KEY',
  () => new NewsDataMonitoringSource(process.env.NEWSDATA_API_KEY!),
  () => new MockMonitoringSource());
```

Leave the `import` block (lines 9-17) and the four domain-service exports (`lifecycle`, `disclosureEngine`, `usageMeter`, `billingGate`) untouched.

- [ ] **Step 4: Run the test and the full suite**

Run: `npx vitest run src/lib/services.test.ts && npm test && npm run typecheck`
Expected: new test PASSES; existing suite still green (tests run with `NODE_ENV=test`, so mocks still activate).

---

### Task 2: HeyGen `getVideoStatus` reports failure; client polling has a deadline (INT-4)

**Files:**
- Modify: `src/integrations/index.ts:153-162` (`HeyGenVideoProvider.getVideoStatus`)
- Modify: `src/components/ContentWizard.tsx:87-133` (poll effect + a bounded state)
- Test: `src/integrations/index.getVideoStatus.test.ts` (new)

**Interfaces:**
- `getVideoStatus(videoId)` still returns `{ status: 'processing' | 'completed' | 'failed'; url?: string }`, but a non-2xx response or an unrecognized status now yields `failed` (never `processing`).

- [ ] **Step 1: Write the failing test** (`src/integrations/index.getVideoStatus.test.ts`)

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { HeyGenVideoProvider } from './index';

afterEach(() => { vi.unstubAllGlobals(); });

describe('HeyGenVideoProvider.getVideoStatus', () => {
  it('returns failed (not processing) on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ message: 'unauthorized' }),
    }));
    const p = new HeyGenVideoProvider('k');
    expect(await p.getVideoStatus('v1')).toEqual({ status: 'failed' });
  });

  it('returns failed on an unrecognized status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: { status: 'weird_new_value' } }),
    }));
    const p = new HeyGenVideoProvider('k');
    expect(await p.getVideoStatus('v1')).toEqual({ status: 'failed' });
  });

  it('still reports processing and completed on the happy path', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'processing' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'completed', video_url: 'http://v/1.mp4' } }) }));
    const p = new HeyGenVideoProvider('k');
    expect(await p.getVideoStatus('v1')).toEqual({ status: 'processing' });
    expect(await p.getVideoStatus('v1')).toEqual({ status: 'completed', url: 'http://v/1.mp4' });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/integrations/index.getVideoStatus.test.ts`
Expected: FAIL — the first two cases currently return `{ status: 'processing' }` because `res.ok` is never checked and an unknown status falls through to the `processing` default.

- [ ] **Step 3: Rewrite `getVideoStatus`** (`src/integrations/index.ts:153-162`):

```ts
  async getVideoStatus(videoId: string) {
    const res = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
      headers: { 'X-Api-Key': this.apiKey },
    });
    // A 401/404/429/5xx is a real error, not "still working" — never let it
    // masquerade as processing or the client polls forever.
    if (!res.ok) return { status: 'failed' as const };
    const json = await res.json().catch(() => null);
    const status = json?.data?.status;
    if (status === 'completed') return { status: 'completed' as const, url: json.data.video_url };
    if (status === 'processing' || status === 'pending' || status === 'waiting') return { status: 'processing' as const };
    if (status === 'failed') return { status: 'failed' as const };
    // Unknown / missing status: fail rather than spin indefinitely.
    return { status: 'failed' as const };
  }
```

- [ ] **Step 4: Bound the client poll** in `src/components/ContentWizard.tsx`. Add a `'timed_out'` state and a max-attempt cap so a stuck job surfaces a "check back later" message instead of an infinite spinner.

Change the state type at line 88:

```tsx
  const [videoStatus, setVideoStatus] = useState<'idle' | 'generating' | 'ready' | 'failed' | 'timed_out'>('idle');
```

Replace the poll effect (lines 119-133):

```tsx
  useEffect(() => {
    if (!videoId || videoStatus !== 'generating') return;
    const MAX_ATTEMPTS = 60; // 60 × 5s = 5 minutes
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      const result = await getVideoStatusAction(videoId);
      if (result.status === 'completed' && result.url) {
        setVideoStatus('ready');
        setVideoUrl(result.url);
        clearInterval(interval);
      } else if (result.status === 'failed') {
        setVideoStatus('failed');
        clearInterval(interval);
      } else if (attempts >= MAX_ATTEMPTS) {
        setVideoStatus('timed_out');
        clearInterval(interval);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [videoId, videoStatus]);
```

Add a `timed_out` branch in the Video step render, next to the existing `videoStatus === 'failed'` block (after line 389):

```tsx
            {videoStatus === 'timed_out' && (
              <div>
                <div className="error">
                  This is taking longer than expected. Your video may still be processing —
                  leave this page and check back in a few minutes.
                </div>
                <button className="btn" style={{ marginTop: 12 }} onClick={() => router.refresh()}>
                  Refresh
                </button>
              </div>
            )}
```

- [ ] **Step 5: Run the test and the full suite**

Run: `npx vitest run src/integrations/index.getVideoStatus.test.ts && npm test && npm run typecheck`
Expected: PASS. (`ContentWizard` has no unit test; typecheck covers the new state literal.)

---

### Task 3: Persist the video job on the content item so a $50 render is never orphaned (INT-5)

**Files:**
- Create: `supabase/migrations/015_content_video_job.sql`
- Modify: `src/domain/types.ts:13-26` (add `videoJobId`, `videoStatus` to `ContentItem`)
- Modify: `src/lib/repos.ts:12-25` (`toContentItem` mapper)
- Modify: `src/app/actions.ts:277-320` (`generateVideoAction` persists job; `getVideoStatusAction` reconciles)
- Modify: `src/app/content/[id]/page.tsx` (pass job through) and `src/components/ContentWizard.tsx:87-89,135-148` (hydrate from item)
- Test: `src/app/actions.video-job.test.ts` (new)

**Interfaces:**
- `ContentItem` gains `videoJobId?: string | null` and `videoStatus?: 'processing' | 'completed' | 'failed' | null`.
- `generateVideoAction` writes `video_job_id` + `video_status='processing'` on the row before returning; on completion `getVideoStatusAction` writes back `video_status` and, when completed, `media_url`.

- [ ] **Step 1: Write the migration** (`supabase/migrations/015_content_video_job.sql`)

```sql
-- supabase/migrations/015_content_video_job.sql
-- Persist the in-flight HeyGen video job on the content row so a page refresh
-- can resume polling instead of orphaning a paid ($50) generation and letting
-- the user regenerate. Nullable / no default: existing rows are unaffected.
alter table content_items
  add column if not exists video_job_id text,
  add column if not exists video_status text
    check (video_status is null or video_status in ('processing', 'completed', 'failed'));
```

- [ ] **Step 2: Write the failing test** (`src/app/actions.video-job.test.ts`) — reuse the `actions.avatar-billing.test.ts` mock block, then add a spyable `content_items` update. Minimal version:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', jurisdictions: [], monthlyCostCapCents: 100_00 })) }));
vi.mock('@/lib/candidate', () => ({ getCandidateProfile: vi.fn(() => Promise.resolve({ heygenAvatarId: 'look-1', heygenVoiceId: 'hv-1' })) }));

const updateEq = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq: updateEq }));
const insert = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update, insert, select: vi.fn() })) } }));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'x') }));
vi.mock('@/lib/repos', () => ({ contentRepo: { get: vi.fn() }, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));

const generateAvatarVideo = vi.fn(() => Promise.resolve({ videoId: 'job-123' }));
const billingGate = { check: vi.fn() };
const usageMeter = { guard: vi.fn(), record: vi.fn() };
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: { generateAvatarVideo, getVideoStatus: vi.fn() }, voiceProvider: {}, photoAvatarProvider: {},
  billingGate, usageMeter,
}));

describe('generateVideoAction persists the job', () => {
  beforeEach(() => vi.clearAllMocks());
  it('writes video_job_id + video_status=processing on the content row', async () => {
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('content-1', 'script');
    expect(r.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ video_job_id: 'job-123', video_status: 'processing' }));
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/app/actions.video-job.test.ts`
Expected: FAIL — `generateVideoAction` currently records the job id only in an `audit_entries` blob, never on `content_items`.

- [ ] **Step 4: Add the type fields** (`src/domain/types.ts`, inside `ContentItem`, after `mediaUrl` at line 22):

```ts
  videoJobId?: string | null;
  videoStatus?: 'processing' | 'completed' | 'failed' | null;
```

- [ ] **Step 5: Map the columns** (`src/lib/repos.ts`, in `toContentItem`, after `mediaUrl` at line 21):

```ts
    videoJobId: (r.video_job_id as string | null) ?? null,
    videoStatus: (r.video_status as 'processing' | 'completed' | 'failed' | null) ?? null,
```

- [ ] **Step 6: Persist the job in `generateVideoAction`** (`src/app/actions.ts`, in the `try` block, right after `usageMeter.record(...)` at line 305):

```ts
    await adminDb.from('content_items')
      .update({ video_job_id: videoId, video_status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', contentId);
```

Keep the existing `audit_entries` insert and `return { ok: true, videoId }`.

- [ ] **Step 7: Reconcile status in `getVideoStatusAction`** (`src/app/actions.ts:318-320`) so a resumed poll writes back to the row (and requires a session — see Task 7, which owns the auth edit; here we add the write-back):

```ts
export async function getVideoStatusAction(videoId: string): Promise<{ status: string; url?: string }> {
  const s = await requireSession();
  const result = await videoProvider.getVideoStatus(videoId);
  if (result.status === 'completed' && result.url) {
    await adminDb.from('content_items')
      .update({ video_status: 'completed', media_url: result.url, updated_at: new Date().toISOString() })
      .eq('video_job_id', videoId).eq('campaign_id', s.campaignId);
  } else if (result.status === 'failed') {
    await adminDb.from('content_items')
      .update({ video_status: 'failed', updated_at: new Date().toISOString() })
      .eq('video_job_id', videoId).eq('campaign_id', s.campaignId);
  }
  return result;
}
```

- [ ] **Step 8: Hydrate the wizard.** In `src/components/ContentWizard.tsx` seed state from the item (lines 87-89):

```tsx
  const [videoId, setVideoId] = useState<string | null>(item.videoJobId ?? null);
  const [videoStatus, setVideoStatus] = useState<'idle' | 'generating' | 'ready' | 'failed' | 'timed_out'>(
    item.videoStatus === 'processing' && !item.mediaUrl ? 'generating'
    : item.videoStatus === 'completed' || item.mediaUrl ? 'idle'
    : 'idle',
  );
  const [videoUrl, setVideoUrl] = useState<string | null>(item.mediaUrl ?? null);
```

No change is needed in `src/app/content/[id]/page.tsx` — it already passes the full `item` (which now carries `videoJobId`/`videoStatus`) to `<ContentWizard item={item} … />`. Confirm the prop type `ContentItem` flows through unchanged.

- [ ] **Step 9: Run the test and the full suite**

Run: `npx vitest run src/app/actions.video-job.test.ts && npm test && npm run typecheck`
Expected: PASS. Manual check after deploy: start a generation, hard-refresh the page mid-render, confirm the wizard resumes the "generating" state and the button does not reappear.

---

### Task 4: Voice synthesis uses the campaign voice and fails on a dead upload (INT-6, INT-8)

**Files:**
- Modify: `src/app/actions.ts:324-338` (`synthesizeVoiceAction` loads + passes the campaign voice)
- Modify: `src/integrations/index.ts:249-276` (`ElevenLabsVoiceProvider.synthesize`: require a voice id, check the upload error)
- Modify: `.env.example:22` (blank the real `ELEVENLABS_VOICE_ID`)
- Test: `src/app/actions.voice.test.ts` (new), `src/integrations/index.voice.test.ts` (new)

**Interfaces:**
- `synthesizeVoiceAction(text)` loads `getCandidateProfile(s.campaignId)`; if `profile.elevenLabsVoiceId` is unset it returns `{ ok: false, error }` without calling the provider or billing.
- `ElevenLabsVoiceProvider.synthesize({ text, voiceId })` throws when no voice id resolves (no hardcoded literal) and throws when `storage.upload` returns an `error` (before fabricating a URL).

- [ ] **Step 1: Write the failing action test** (`src/app/actions.voice.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', jurisdictions: [], monthlyCostCapCents: 100_00 })) }));
const getCandidateProfile = vi.fn();
vi.mock('@/lib/candidate', () => ({ getCandidateProfile }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update: vi.fn(), insert: vi.fn(), select: vi.fn() })) } }));
vi.mock('@/lib/store', () => ({ uid: vi.fn() }));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: {} }));
const synthesize = vi.fn(() => Promise.resolve({ audioUrl: 'http://a/1.mp3' }));
const billingGate = { check: vi.fn() };
const usageMeter = { guard: vi.fn(), record: vi.fn() };
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: {}, voiceProvider: { synthesize }, photoAvatarProvider: {}, billingGate, usageMeter,
}));

describe('synthesizeVoiceAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the campaign voice id to the provider', async () => {
    getCandidateProfile.mockResolvedValue({ elevenLabsVoiceId: 'campaign-voice-1' });
    const { synthesizeVoiceAction } = await import('./actions');
    const r = await synthesizeVoiceAction('hello');
    expect(r.ok).toBe(true);
    expect(synthesize).toHaveBeenCalledWith({ text: 'hello', voiceId: 'campaign-voice-1' });
  });

  it('refuses (and never bills) when no campaign voice is configured', async () => {
    getCandidateProfile.mockResolvedValue({ elevenLabsVoiceId: null });
    const { synthesizeVoiceAction } = await import('./actions');
    const r = await synthesizeVoiceAction('hello');
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/voice/i) });
    expect(synthesize).not.toHaveBeenCalled();
    expect(usageMeter.guard).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write the failing provider test** (`src/integrations/index.voice.test.ts`)

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ElevenLabsVoiceProvider } from './index';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('ElevenLabsVoiceProvider.synthesize', () => {
  it('throws when no voice id is provided and none is in the env', async () => {
    delete process.env.ELEVENLABS_VOICE_ID;
    const p = new ElevenLabsVoiceProvider('k');
    await expect(p.synthesize({ text: 'hi' })).rejects.toThrow(/voice/i);
  });

  it('throws when the storage upload fails instead of returning a dead url', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }));
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        storage: { from: () => ({
          upload: async () => ({ error: { message: 'bucket unavailable' } }),
          getPublicUrl: () => ({ data: { publicUrl: 'http://dead/url.mp3' } }),
        }) },
      }),
    }));
    const p = new ElevenLabsVoiceProvider('k');
    await expect(p.synthesize({ text: 'hi', voiceId: 'v1' })).rejects.toThrow(/upload|bucket/i);
  });
});
```

- [ ] **Step 3: Run both and confirm they fail**

Run: `npx vitest run src/app/actions.voice.test.ts src/integrations/index.voice.test.ts`
Expected: FAIL — the action ignores the campaign voice, and the provider both falls back to the hardcoded `'EXAVITQu4vr4xnSDxMaL'` and ignores the upload `{error}`.

- [ ] **Step 4: Rewrite `synthesizeVoiceAction`** (`src/app/actions.ts:324-338`):

```ts
export async function synthesizeVoiceAction(text: string): Promise<Result & { audioUrl?: string }> {
  const s = await requireSession();
  const { getCandidateProfile } = await import('@/lib/candidate');
  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };
  const voiceId = profile?.elevenLabsVoiceId ?? undefined;
  if (!voiceId) {
    return { ok: false, error: 'No voice is configured for this campaign yet. Set one in Settings → Avatar.' };
  }
  try {
    await billingGate.check(s.campaignId);
    await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, 20_00);
    const { audioUrl } = await voiceProvider.synthesize({ text, voiceId });
    await usageMeter.record(s.campaignId, 'voice_synthesis', 1, 20_00);
    return { ok: true, audioUrl };
  } catch (e) {
    if (e instanceof CapExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }
}
```

- [ ] **Step 5: Harden `ElevenLabsVoiceProvider.synthesize`** (`src/integrations/index.ts:252-275`):

```ts
  async synthesize({ text, voiceId }: { text: string; voiceId?: string }) {
    const vid = voiceId ?? process.env.ELEVENLABS_VOICE_ID;
    if (!vid) throw new Error('No ElevenLabs voice id configured for this request.');
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs error: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const { createClient } = await import('@supabase/supabase-js');
    const storage = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const filename = `voice/${Date.now()}.mp3`;
    const { error: uploadError } = await storage.storage.from('media').upload(filename, buffer, { contentType: 'audio/mpeg' });
    if (uploadError) throw new Error(`Voice upload failed: ${uploadError.message}`);
    const { data } = storage.storage.from('media').getPublicUrl(filename);
    return { audioUrl: data.publicUrl };
  }
```

(The hardcoded `'EXAVITQu4vr4xnSDxMaL'` literal is removed — the only sources of a voice id are now the per-request `voiceId` or the operator's `ELEVENLABS_VOICE_ID`.)

- [ ] **Step 6: Blank the real id in `.env.example`** (line 22):

```
ELEVENLABS_VOICE_ID=
```

- [ ] **Step 7: Run the tests and the full suite**

Run: `npx vitest run src/app/actions.voice.test.ts src/integrations/index.voice.test.ts && npm test && npm run typecheck`
Expected: PASS.

---

### Task 5: HeyGen video uses a per-campaign HeyGen voice id, not the ElevenLabs id (INT-7)

**Files:**
- Create: `supabase/migrations/016_heygen_voice_id.sql`
- Modify: `src/domain/types.ts:115-118` (add `heygenVoiceId` to `CandidateProfile`)
- Modify: `src/lib/candidate.ts` (`toProfile` mapper + `upsertCandidateProfile` payload)
- Modify: `src/app/actions.ts:298-304` (`generateVideoAction` passes `profile.heygenVoiceId`, refuses when unset) and `saveVideoSettingsAction` accepts it
- Modify: `src/integrations/index.ts:138-142` (`HeyGenVideoProvider` drops the global `HEYGEN_VOICE_ID` fallback)
- Modify: `.env.example:16-17` (blank the real `HEYGEN_AVATAR_ID` / `HEYGEN_VOICE_ID`)
- Test: `src/app/actions.heygen-voice.test.ts` (new)

**Interfaces:**
- `CandidateProfile` gains `heygenVoiceId?: string | null` (column `candidate_profiles.heygen_voice_id`). It is HeyGen-namespaced and distinct from `elevenLabsVoiceId`.
- `generateVideoAction` passes `voiceId: profile.heygenVoiceId` to `videoProvider.generateAvatarVideo`; if none is set it returns `{ ok: false }` (mirrors the existing missing-avatar guard). The ElevenLabs id is never sent to HeyGen.

- [ ] **Step 1: Write the migration** (`supabase/migrations/016_heygen_voice_id.sql`)

```sql
-- supabase/migrations/016_heygen_voice_id.sql
-- HeyGen and ElevenLabs use different voice-id namespaces. Storing only the
-- ElevenLabs id and passing it to HeyGen's voice.voice_id made every keyed
-- video 400 ("voice not found"). Track a dedicated HeyGen voice id.
alter table candidate_profiles
  add column if not exists heygen_voice_id text;
```

- [ ] **Step 2: Write the failing test** (`src/app/actions.heygen-voice.test.ts`) — reuse the Task 3 mock block but drive the profile:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', jurisdictions: [], monthlyCostCapCents: 100_00 })) }));
const getCandidateProfile = vi.fn();
vi.mock('@/lib/candidate', () => ({ getCandidateProfile, upsertCandidateProfile: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })), insert: vi.fn(), select: vi.fn() })) } }));
vi.mock('@/lib/store', () => ({ uid: vi.fn() }));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: {} }));
const generateAvatarVideo = vi.fn(() => Promise.resolve({ videoId: 'job-1' }));
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, contentGenerator: {}, publisher: {},
  videoProvider: { generateAvatarVideo, getVideoStatus: vi.fn() }, voiceProvider: {}, photoAvatarProvider: {},
  billingGate: { check: vi.fn() }, usageMeter: { guard: vi.fn(), record: vi.fn() },
}));

describe('generateVideoAction voice namespace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the HeyGen voice id (not the ElevenLabs id) to HeyGen', async () => {
    getCandidateProfile.mockResolvedValue({ heygenAvatarId: 'look-1', heygenVoiceId: 'heygen-v-1', elevenLabsVoiceId: 'eleven-x' });
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('c-1', 'script');
    expect(r.ok).toBe(true);
    expect(generateAvatarVideo).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'heygen-v-1' }));
  });

  it('refuses when no HeyGen voice id is configured (never falls back to a global)', async () => {
    getCandidateProfile.mockResolvedValue({ heygenAvatarId: 'look-1', heygenVoiceId: null, elevenLabsVoiceId: 'eleven-x' });
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('c-1', 'script');
    expect(r.ok).toBe(false);
    expect(generateAvatarVideo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/app/actions.heygen-voice.test.ts`
Expected: FAIL — today `generateVideoAction` passes `profile?.elevenLabsVoiceId` as the HeyGen voice id and never refuses on a missing HeyGen voice.

- [ ] **Step 4: Add the type field** (`src/domain/types.ts`, in `CandidateProfile`, after `elevenLabsVoiceId` at line 118):

```ts
  heygenVoiceId?: string | null;
```

- [ ] **Step 5: Map and upsert the column** (`src/lib/candidate.ts`). In `toProfile`, after the `elevenLabsVoiceId` line:

```ts
    heygenVoiceId: (r.heygen_voice_id as string | null) ?? null,
```

In `upsertCandidateProfile`'s `payload`, after the `elevenlabs_voice_id` spread:

```ts
    ...(data.heygenVoiceId     !== undefined && { heygen_voice_id:     data.heygenVoiceId ?? null }),
```

- [ ] **Step 6: Wire `generateVideoAction`** (`src/app/actions.ts`). After the existing avatar guard (line 293), add a voice guard, and change the `voiceId` passed to the provider (line 301):

```ts
  const heygenVoiceId = overrides?.voiceId ?? profile?.heygenVoiceId ?? undefined;
  // Do not fall back to the global HEYGEN_VOICE_ID — that narrates every
  // tenant's video with one shared voice. And never pass the ElevenLabs id
  // here: HeyGen uses a different voice-id namespace and 400s on it.
  if (!heygenVoiceId) return { ok: false, error: 'No video voice is set up for this campaign yet. Choose a HeyGen voice in Settings → Avatar.' };
```

Then in the `generateAvatarVideo({ … })` call, replace the `voiceId` line:

```ts
      voiceId: heygenVoiceId,
```

- [ ] **Step 7: Accept it in `saveVideoSettingsAction`** (`src/app/actions.ts:510-524`). Add `heygenVoiceId?: string | null;` to the `data` parameter type; `upsertCandidateProfile(s.campaignId, data)` already forwards it via the payload spread from Step 5. Add a matching input to the Settings → Avatar form (`src/app/settings/**`) next to the existing ElevenLabs voice field. *(Manual UI step — mirror the existing `elevenLabsVoiceId` input; no server test required.)*

- [ ] **Step 8: Drop the global fallback in the provider** (`src/integrations/index.ts:138-142`). Change the HeyGen `voice` block so a missing `voiceId` is an error rather than a silent global default:

```ts
          voice: {
            type: 'text',
            input_text: script,
            voice_id: voiceId ?? (() => { throw new Error('HeyGen voice_id is required.'); })(),
          },
```

(The action already guarantees `voiceId` is set before calling, so this only guards against a future caller; the `?? process.env.HEYGEN_VOICE_ID ?? ''` fallback is removed.)

- [ ] **Step 9: Blank the real ids in `.env.example`** (lines 16-17):

```
HEYGEN_AVATAR_ID=
HEYGEN_VOICE_ID=
```

- [ ] **Step 10: Run the test and the full suite**

Run: `npx vitest run src/app/actions.heygen-voice.test.ts && npm test && npm run typecheck`
Expected: PASS.

---

### Task 6: Defensive provider parsing + validated avatar status; avatar creation failure returns `ok:false` (INT-13, INT-14)

**Files:**
- Modify: `src/integrations/index.ts` — `HeyGenVideoProvider.generateAvatarVideo` (148-150), `HeyGenPhotoAvatarProvider.uploadAsset` (183-185), `createAvatarLook` (199-204), `createPromptLook` (220-225), `getAvatarGroupStatus` (237-243)
- Modify: `src/app/actions.ts:650-677` (`createAvatarAction` returns `ok:false` on provider failure)
- Test: `src/integrations/index.defensive.test.ts` (new), extend `src/app/actions.avatar-billing.test.ts`

**Interfaces:**
- Provider methods parse the body only after checking `res.ok`, and **throw** when a required id (`video_id`, `asset_id`, `avatar_item.id`, group id) is missing/empty rather than coercing to `''`.
- `getAvatarGroupStatus` returns `status: 'failed'` for any status HeyGen sends that is not one of the four known values (never an unvalidated cast that strands the avatar in "training").
- `createAvatarAction` returns `{ ok: false, error }` when the HeyGen creation loop throws (today it swallows the error, sets the row to `failed`, and still returns `{ ok: true }`).

- [ ] **Step 1: Write the failing provider test** (`src/integrations/index.defensive.test.ts`)

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { HeyGenVideoProvider, HeyGenPhotoAvatarProvider } from './index';

afterEach(() => { vi.unstubAllGlobals(); });

describe('defensive provider parsing', () => {
  it('generateAvatarVideo throws when the response has no video_id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) }));
    const p = new HeyGenVideoProvider('k');
    await expect(p.generateAvatarVideo({ script: 's', avatarId: 'a', voiceId: 'v' })).rejects.toThrow(/video id|video_id/i);
  });

  it('uploadAsset throws when the response has no asset_id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) }));
    const p = new HeyGenPhotoAvatarProvider('k');
    await expect(p.uploadAsset(Buffer.from('x'), 'image/jpeg')).rejects.toThrow(/asset/i);
  });

  it('getAvatarGroupStatus reports failed for an unknown status instead of casting it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { status: 'garbage' } }) }));
    const p = new HeyGenPhotoAvatarProvider('k');
    const r = await p.getAvatarGroupStatus('g1');
    expect(r.status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/integrations/index.defensive.test.ts`
Expected: FAIL — `generateAvatarVideo` returns `{ videoId: '' }`, `uploadAsset` returns `{ assetId: '' }`, and `getAvatarGroupStatus` casts `'garbage'` straight through.

- [ ] **Step 3: Harden the HeyGen methods** (`src/integrations/index.ts`).

`generateAvatarVideo` return (149-150):

```ts
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) throw new Error(`HeyGen error: ${(json as { message?: string }).message ?? res.status}`);
    const videoId = (json as { data?: { video_id?: string } }).data?.video_id;
    if (!videoId) throw new Error('HeyGen did not return a video id.');
    return { videoId, url: undefined };
```

`uploadAsset` return (183-185):

```ts
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) throw new Error(`HeyGen upload error: ${(json as { error?: { message?: string } }).error?.message ?? res.status}`);
    const assetId = (json as { data?: { asset_id?: string } }).data?.asset_id;
    if (!assetId) throw new Error('HeyGen did not return an asset id.');
    return { assetId };
```

`createAvatarLook` and `createPromptLook` — after the existing `if (!res.ok) throw …`, guard the ids before returning:

```ts
    const lookId = json.data?.avatar_item?.id;
    const groupId = json.data?.avatar_group?.id ?? json.data?.avatar_item?.group_id;
    if (!lookId || !groupId) throw new Error('HeyGen did not return a look/group id.');
    return { lookId, groupId };
```

`getAvatarGroupStatus` return (239-243):

```ts
    const raw = json.data?.status;
    const KNOWN = ['processing', 'pending_consent', 'completed', 'failed'] as const;
    const status = (KNOWN as readonly string[]).includes(raw) ? raw as typeof KNOWN[number] : 'failed';
    return {
      status,
      previewImageUrl: json.data?.preview_image_url,
      error: json.data?.error,
    };
```

- [ ] **Step 4: Extend the avatar-billing test** (`src/app/actions.avatar-billing.test.ts`) — add to the `createAvatarAction billing` describe:

```ts
  it('returns ok:false when the HeyGen creation loop fails', async () => {
    photoAvatarProvider.uploadAsset.mockRejectedValue(new Error('HeyGen upload error: bad file'));
    const { createAvatarAction } = await import('./actions');
    const result = await createAvatarAction(makePhotos(4));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/bad file|failed/i);
    expect(updateAvatarStatus).toHaveBeenCalledWith('avatar-1', 'failed', expect.objectContaining({ errorMessage: expect.any(String) }));
  });
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `npx vitest run src/app/actions.avatar-billing.test.ts`
Expected: FAIL on the new case — `createAvatarAction` currently returns `{ ok: true, avatarId }` even after the catch marks the row `failed`.

- [ ] **Step 6: Make `createAvatarAction` report the failure** (`src/app/actions.ts:650-677`). Track a failure inside the catch and return it after `finally` records usage:

```ts
  let processedCount = 0;
  let createError: string | null = null;
  try {
    let groupId: string | undefined;
    let baseLookId: string | undefined;
    for (let i = 0; i < files.length; i++) {
      const { assetId } = await photoAvatarProvider.uploadAsset(buffers[i], files[i].type);
      const { groupId: newGroupId, lookId } = await photoAvatarProvider.createAvatarLook({
        name, assetId, avatarGroupId: groupId,
      });
      processedCount++;
      groupId = groupId ?? newGroupId;
      baseLookId = baseLookId ?? lookId;
    }
    await updateAvatarStatus(avatarId, 'training', { heygenGroupId: groupId, heygenLookId: baseLookId });
  } catch (e) {
    createError = e instanceof Error ? e.message : String(e);
    await updateAvatarStatus(avatarId, 'failed', { errorMessage: createError });
  } finally {
    await usageMeter.record(s.campaignId, 'avatar_training', processedCount, processedCount * AVATAR_LOOK_COST_CENTS, estimatedCost);
  }

  revalidatePath('/avatars');
  if (createError) return { ok: false, error: `Avatar creation failed: ${createError}` };
  return { ok: true, avatarId };
```

- [ ] **Step 7: Run the tests and the full suite**

Run: `npx vitest run src/integrations/index.defensive.test.ts src/app/actions.avatar-billing.test.ts && npm test && npm run typecheck`
Expected: PASS. (Confirm the two pre-existing avatar-billing tests that assert `updateAvatarStatus('avatar-1','failed', …)` on mid-way failure still pass — the change only adds a return value.)

---

### Task 7: Authenticate the provider proxy endpoints and `getVideoStatusAction` (INT-10)

**Files:**
- Modify: `src/app/api/heygen/avatars/route.ts:10` (require a session)
- Modify: `src/app/api/elevenlabs/voices/route.ts:3` (require a session)
- Modify: `src/app/actions.ts:318` (`getVideoStatusAction` — the `requireSession()` added in Task 3 Step 7 also satisfies INT-10; this task adds the campaign-scope check on the row lookup)
- Test: `src/app/api/heygen/avatars/route.test.ts` (new)

**Interfaces:**
- Both GET routes call `getSession()`; when there is no session they return `401` (JSON `{ error: 'Unauthorized' }`) before touching the provider. They keep their existing "empty list when no key" behavior for authenticated callers.
- `getVideoStatusAction` already requires a session (Task 3) and scopes its write-back with `.eq('campaign_id', s.campaignId)`.

- [ ] **Step 1: Write the failing route test** (`src/app/api/heygen/avatars/route.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSession = vi.fn();
vi.mock('@/lib/session', () => ({ getSession }));

describe('heygen avatars proxy auth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null);
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    const res = await GET(new NextRequest('http://x/api/heygen/avatars?baseId=b1'));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/api/heygen/avatars/route.test.ts`
Expected: FAIL — the route has no auth and returns 200 with `{ avatars: [] }` (or hits `fetch`).

- [ ] **Step 3: Add the session gate to `src/app/api/heygen/avatars/route.ts`** — import and check at the top of `GET` (before reading `HEYGEN_API_KEY` at line 11):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.HEYGEN_API_KEY;
  // …unchanged from here…
```

- [ ] **Step 4: Add the same gate to `src/app/api/elevenlabs/voices/route.ts`** — this route currently has no `req`; add one:

```ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  // …unchanged from here…
```

- [ ] **Step 5: Confirm `getVideoStatusAction` is scoped.** Verify Task 3 Step 7 landed: `getVideoStatusAction` starts with `const s = await requireSession();` and every write-back includes `.eq('campaign_id', s.campaignId)`. No further edit needed here; if Task 3 has not landed, add the `requireSession()` line now.

- [ ] **Step 6: Run the test and the full suite**

Run: `npx vitest run src/app/api/heygen/avatars/route.test.ts && npm test && npm run typecheck`
Expected: PASS.

---

### Task 8: Atomically claim scheduled rows so the publish cron can't double-post (INT-11)

> **Depends on P0 Task 5 (publish-on-success).** This edits the post-Task-5 route where the loop already declares `results_out`, inspects the `publisher.publish` results array, marks `published` only on success, and reverts to `approved` on all-platform failure. Do not start until that is merged.

**Files:**
- Modify: `src/app/api/cron/publish/route.ts` (add the atomic claim at the top of the per-item loop)
- Modify: `src/domain/types.ts:1-2` (add `'publishing'` to `ContentStatus`)
- Test: `src/app/api/cron/publish/claim.test.ts` (new)

**Interfaces:**
- Before publishing each due item, the route runs `update … set status='publishing' where id=? and status='scheduled' … returning id`. If zero rows come back, another concurrent run (or a prior crash) already claimed it, so the loop `continue`s without publishing. On success the row moves `publishing → published`; on all-platform failure it reverts `publishing → approved` (consistent with P0 Task 5).
- The select still filters `status='scheduled'`, so a batch is capped implicitly by the number of due rows; add an explicit `.limit(50)` to bound a single run.

- [ ] **Step 1: Add `'publishing'` to the status union** (`src/domain/types.ts:1-2`):

```ts
export type ContentStatus =
  | 'draft' | 'in_review' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'rejected' | 'archived';
```

(`StatusPill` renders unknown statuses via its existing default styling; `'publishing'` is transient and only set by the cron. Verify `StatusPill` has a fallback branch — if it switches exhaustively, add a `publishing` label.)

- [ ] **Step 2: Write the failing test** (`src/app/api/cron/publish/claim.test.ts`) — a chainable `adminDb` mock where the claim `update(...).eq(...).eq(...).select()` resolves to an empty array (row already claimed), and assert `publisher.publish` is never called:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const publish = vi.fn(() => Promise.resolve([{ platform: 'x', status: 'scheduled' }]));
vi.mock('@/lib/services', () => ({ publisher: { publish } }));
vi.mock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));

// Chainable query builder. The SELECT of due items returns one row; the
// claiming UPDATE returns an empty array (someone else already claimed it).
const dueItem = { id: 'ci-1', campaign_id: 'c-1', body: 'b', media_url: null, platforms: ['x'] };
function makeAdminDb(claimRows: unknown[]) {
  const selectDue = { eq: () => selectDue, not: () => selectDue, lte: () => Promise.resolve({ data: [dueItem] }) };
  const claim = { eq: () => claim, select: () => Promise.resolve({ data: claimRows, error: null }) };
  const finalUpdate = { eq: () => Promise.resolve({ error: null }) };
  let updateCalls = 0;
  return {
    from: () => ({
      select: () => selectDue,
      update: () => { updateCalls += 1; return updateCalls === 1 ? claim : finalUpdate; },
      insert: () => Promise.resolve({ error: null }),
    }),
  };
}

describe('cron publish atomic claim', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = 'secret'; });

  it('skips publishing an item it did not win the claim on', async () => {
    vi.doMock('@/lib/supabase', () => ({ adminDb: makeAdminDb([]) }));
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    await GET(new NextRequest('http://x', { headers: { authorization: 'Bearer secret' } }));
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes an item it does win the claim on', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase', () => ({ adminDb: makeAdminDb([{ id: 'ci-1' }]) }));
    vi.doMock('@/lib/services', () => ({ publisher: { publish } }));
    vi.doMock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    await GET(new NextRequest('http://x', { headers: { authorization: 'Bearer secret' } }));
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/app/api/cron/publish/claim.test.ts`
Expected: FAIL — the post-Task-5 route publishes every selected row unconditionally; there is no claim, so `publish` is called even when the claim would have returned no rows.

- [ ] **Step 4: Add the claim** at the very top of the `for (const item of dueItems)` loop, before the `try`/`disclosureRepo.listFor` block:

```ts
  for (const item of dueItems) {
    // Atomically claim: only one runner can flip scheduled → publishing.
    // A concurrent 5-min run (or a crash-restarted run) that lost the race
    // gets zero rows back and skips, so nothing is published twice.
    const { data: claimed, error: claimError } = await adminDb
      .from('content_items')
      .update({ status: 'publishing', updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('status', 'scheduled')
      .select('id');
    if (claimError || !claimed || claimed.length === 0) continue;

    try {
      // …existing post-Task-5 body: listFor, publish, inspect results…
```

In that existing body, the failure path (P0 Task 5 reverts to `approved`) and the success path (`published`) now transition **from** `publishing` — no query change needed since they update by `id`. Also cap the batch: add `.limit(50)` to the due-items select (line 19, after `.lte(...)`).

- [ ] **Step 5: Run the test and the full suite**

Run: `npx vitest run src/app/api/cron/publish/claim.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Manual verification of true atomicity** (mocks can't prove the DB guarantee). Against a staging DB with one row `status='scheduled', scheduled_at` in the past, fire two `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/publish` requests concurrently (`&`), then `select status from content_items where id=…`. Expected: exactly one `published`, one runner reports 0 published; the row is never posted twice. Note the follow-up caveat in the PR: a runner that crashes between claim and publish leaves the row in `publishing`; a stale-`publishing` reclaim (rows in `publishing` with `updated_at` older than ~15 min) is a separate hardening item, out of scope here.

---

### Task 9: n8n workflow iterates every campaign and uses a configurable base URL (INT-12)

**Files:**
- Modify: `n8n-opposition-monitoring.json` — the `App Config` node (lines 15-27) and every `*: Format` code node that reads `$input.first()` against a fan-out response (`NewsData: Format` 84, `GDELT: Format` 145, `Twitter: Format` 229, `YouTube: Format` 293, `Instagram: Format` 384, `Facebook: Format` 474)

**Note:** This is workflow JSON with no unit-test harness. The fix is exact string edits plus an import-and-run manual verification. The root problems: (a) `App Config` hardcodes `http://localhost:3001`, so a deployed workflow posts monitoring hits to localhost and silently drops them (all HTTP nodes are `continueOnFail`); (b) `Prepare Query` correctly emits one item per campaign, but each `*: Format` node reads only `$input.first().json`, so when more than one campaign flows through, only the **first** campaign's fetched results are formatted and ingested.

- [ ] **Step 1: Make the base URL configurable.** In the `App Config` node (id `2222…2222`), change the `app_base_url` assignment (line 18) from a hardcoded string to an environment expression with a localhost fallback for dev:

```json
{ "id": "f1", "name": "app_base_url", "value": "={{ $env.APP_BASE_URL || 'http://localhost:3001' }}", "type": "string" }
```

Deployment note (add to the workflow's README / n8n env): set `APP_BASE_URL=https://<production-app-host>` in the n8n instance's environment.

- [ ] **Step 2: Format every campaign's results, not just the first.** In each `*: Format` code node, replace the `const res = $input.first().json;` single-item read with an all-items loop that pairs each fetch response to its source campaign via the input's paired-item index. Representative rewrite for **NewsData: Format** (node `5555…5555`, line 84) — the `jsCode` becomes:

```js
const out = [];
const inputs = $input.all();
for (let i = 0; i < inputs.length; i++) {
  const cfg = $('Prepare Query').all()[i].json;
  const res = inputs[i].json;
  if (!res || !Array.isArray(res.results)) continue;
  for (const a of res.results.filter(a => a && a.link).slice(0, 15)) {
    out.push({ json: {
      campaign_id: cfg.campaign_id,
      source: String(a.source_id || 'NewsData'),
      opponent: cfg.opponent_names_array.find(o =>
        (String(a.title || '') + ' ' + String(a.description || '')).toLowerCase().includes(o.toLowerCase())
      ) || null,
      excerpt: String(a.description || a.title || '').substring(0, 500),
      url: String(a.link),
    }});
  }
}
return out;
```

Apply the same `$input.all()` + paired-index pattern to `GDELT: Format` (guarding `res.articles`, and its existing `typeof res === 'string'` error check per item), `Twitter: Format` (`res.data`), `YouTube: Format` (`res.items`), `Instagram: Format` (array-or-`res.items`), and `Facebook: Format` (array-or-`res.items`). Each keeps its own source label, `opponent` match, `excerpt`, and `url` shape — only the outer "read first item" wrapper changes to "loop all items with paired cfg". `Google Alerts: Format` already uses `$input.all()` and needs no change.

- [ ] **Step 3: Validate the JSON.** The file must remain valid JSON after the edits.

Run: `node -e "JSON.parse(require('fs').readFileSync('n8n-opposition-monitoring.json','utf8')); console.log('valid')"`
Expected: `valid`.

- [ ] **Step 4: Manual verification.** Import the workflow into n8n, set `APP_BASE_URL` to a reachable app host and seed **two** campaigns with `opponent_name` set (so `/api/monitoring/campaigns` returns two rows). Execute the workflow manually and confirm: (a) the `Get Campaigns` node returns 2 items; (b) each `*: Format` node emits rows for **both** campaigns (not just the first); (c) `monitoring_results` receives ingests for both `campaign_id`s. Because the HTTP nodes are `continueOnFail`, also confirm a deliberately bad source (e.g. an invalid API key) does not abort the run but the others still ingest. *(Deeper: converting the silent `continueOnFail` drops into a visible error branch/notification is a follow-up beyond this task.)*

---

## Self-review checklist (run before handing off)

- [ ] Every listed INT finding maps to a task: **INT-3 → T1**, **INT-4 → T2**, **INT-5 → T3**, **INT-6 → T4**, **INT-7 → T5**, **INT-8 → T4**, **INT-10 → T7**, **INT-11 → T8**, **INT-12 → T9**, **INT-13 → T6**, **INT-14 → T6**.
- [ ] The mock/real provider seam is preserved: outside production every adapter still falls back to its `Mock*` class; only production with a missing key throws (T1).
- [ ] No provider id is sourced from a hardcoded literal or a global env fallback anymore: voice ids come from `candidate_profiles` (T4 ElevenLabs, T5 HeyGen); `.env.example` ships blank `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`, `ELEVENLABS_VOICE_ID` (grep after edits: `grep -nE "EXAVITQu4vr4xnSDxMaL|ff20d45346a6|bd310dd03b17|zcIk2xc7SGwl" src .env.example` returns nothing).
- [ ] No provider method returns a status/id it did not actually receive: `getVideoStatus` and `getAvatarGroupStatus` never emit `processing`/a raw cast on an error or unknown value (T2, T6); id getters throw on empty (T6).
- [ ] Every proxy/provider-status entry point requires a session: `api/heygen/avatars`, `api/elevenlabs/voices`, `getVideoStatusAction` (T7), and campaign-scoped writes use `.eq('campaign_id', s.campaignId)`.
- [ ] The publish cron claims rows atomically before publishing and never posts a row twice (T8); T8 was implemented only after P0 Task 5 landed.
- [ ] Two new migrations (`015_content_video_job.sql`, `016_heygen_voice_id.sql`) each have a matching `types.ts` field and `repos.ts`/`candidate.ts` mapper + upsert entry.
- [ ] `npm test && npm run typecheck` green after every task; `n8n-opposition-monitoring.json` still parses as valid JSON (T9).
- [ ] No git commits made (user commits).
