# HeyGen Voice Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super-admin assign an already-cloned HeyGen `voice_id` to a campaign, so `generateVideoAction` (avatar video generation) has a voice to use — today it always fails because nothing can ever set `candidate_profiles.heygen_voice_id`.

**Architecture:** One new admin-only server action, `assignVoiceAction` in `src/app/admin/actions.ts`, mirroring the existing `assignAvatarAction` exactly (paste a pre-created provider ID, require a consent checkbox, upsert onto the candidate profile only if one already exists). One new UI card on `src/app/admin/campaigns/[id]/page.tsx`, sibling to the existing "Candidate avatar" card.

**Tech Stack:** Next.js App Router server actions, Vitest, Supabase (via existing `@/lib/candidate` repo functions — no schema changes).

## Global Constraints

- No new database migration — `candidate_profiles.heygen_voice_id` already exists (`src/lib/candidate.ts:32`, `src/domain/types.ts:130`).
- No in-app voice cloning or HeyGen voice-catalog browsing — out of scope per the design spec (`docs/superpowers/specs/2026-07-16-heygen-voice-assignment-design.md`).
- Follow TDD: write the failing test before the implementation for Task 1.

---

### Task 1: `assignVoiceAction` server action

**Files:**
- Modify: `src/app/admin/actions.ts` (add new exported function, near `assignAvatarAction` at line 189)
- Test: `src/app/admin/actions.assign-voice.test.ts` (new)

**Interfaces:**
- Produces: `assignVoiceAction(formData: FormData): Promise<void>` — reads `campaignId`, `heygen_voice_id`, `consent` from the FormData. No return value (matches `assignAvatarAction`'s `Promise<void>` shape, since it's bound directly to a `<form action={...}>`).
- Consumes: `requireAdmin` from `@/lib/session`, `getCandidateProfile`/`upsertCandidateProfile` from `@/lib/candidate` (dynamically imported, matching `assignAvatarAction`'s existing style), `revalidatePath` from `next/cache`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/admin/actions.assign-voice.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ userId: 'sa-1', role: 'super_admin', campaignId: null })) }));

const getCandidateProfile = vi.fn();
const upsertCandidateProfile = vi.fn(() => Promise.resolve());
vi.mock('@/lib/candidate', () => ({ getCandidateProfile, upsertCandidateProfile }));

function fd(over: Record<string, string> = {}) {
  const f = new FormData();
  f.set('campaignId', 'c-1');
  f.set('heygen_voice_id', 'voice-abc123');
  f.set('consent', 'on');
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

describe('assignVoiceAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('assigns the voice when a candidate profile already exists and consent is given', async () => {
    getCandidateProfile.mockResolvedValue({ campaignId: 'c-1', fullName: 'Cand' });
    const { assignVoiceAction } = await import('./actions');
    await assignVoiceAction(fd());
    expect(upsertCandidateProfile).toHaveBeenCalledWith('c-1', { heygenVoiceId: 'voice-abc123' });
  });

  it('does nothing when campaignId is blank', async () => {
    getCandidateProfile.mockResolvedValue({ campaignId: 'c-1' });
    const { assignVoiceAction } = await import('./actions');
    await assignVoiceAction(fd({ campaignId: '' }));
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('does nothing when heygen_voice_id is blank', async () => {
    getCandidateProfile.mockResolvedValue({ campaignId: 'c-1' });
    const { assignVoiceAction } = await import('./actions');
    await assignVoiceAction(fd({ heygen_voice_id: '' }));
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('does nothing when consent is not given', async () => {
    getCandidateProfile.mockResolvedValue({ campaignId: 'c-1' });
    const { assignVoiceAction } = await import('./actions');
    await assignVoiceAction(fd({ consent: 'off' }));
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });

  it('does nothing when no candidate profile exists yet for the campaign', async () => {
    getCandidateProfile.mockResolvedValue(null);
    const { assignVoiceAction } = await import('./actions');
    await assignVoiceAction(fd());
    expect(upsertCandidateProfile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/admin/actions.assign-voice.test.ts`
Expected: FAIL — `assignVoiceAction` is not exported from `./actions` (import error / undefined function).

- [ ] **Step 3: Implement `assignVoiceAction`**

In `src/app/admin/actions.ts`, add this new function immediately after `assignAvatarAction` (after the closing `}` that follows the `revalidatePath('/avatars');` line inside `assignAvatarAction`):

```typescript
export async function assignVoiceAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const heygenVoiceId = String(formData.get('heygen_voice_id') ?? '').trim();
  if (!campaignId || !heygenVoiceId) return;

  // Same explicit-attestation requirement as assignAvatarAction — a
  // super_admin linking a pre-cloned HeyGen voice must confirm consent was
  // actually obtained; it must never be auto-stamped just because they hit submit.
  const consentConfirmed = formData.get('consent') === 'on';
  if (!consentConfirmed) return;

  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');

  // Same guard as assignAvatarAction: upsertCandidateProfile's insert path
  // requires full_name/preferred_name/office/district (not-null, no defaults)
  // this action doesn't have. Only update when a profile already exists.
  const existingProfile = await getCandidateProfile(campaignId);
  if (existingProfile) {
    await upsertCandidateProfile(campaignId, { heygenVoiceId });
  }

  revalidatePath(`/admin/campaigns/${campaignId}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/admin/actions.assign-voice.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All existing tests still pass (234 → 239), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/actions.ts src/app/admin/actions.assign-voice.test.ts
git commit -m "feat: add admin action to assign a HeyGen voice to a campaign"
```

---

### Task 2: "Candidate voice" admin UI card

**Files:**
- Modify: `src/app/admin/campaigns/[id]/page.tsx` (add import at line 7, add new card after line 225 — immediately after the "Candidate avatar" card's closing `</div>`)

**Interfaces:**
- Consumes: `assignVoiceAction` from Task 1 (`'../../actions'`), `profile.heygenVoiceId` (already-existing field, read-only here), `campaign.id` (already in scope in this component).

- [ ] **Step 1: Add the import**

In `src/app/admin/campaigns/[id]/page.tsx`, change line 7 from:

```typescript
  generateInviteAction, assignAvatarAction, assignPlanAction, openBillingPortalForCampaignAction,
```

to:

```typescript
  generateInviteAction, assignAvatarAction, assignVoiceAction, assignPlanAction, openBillingPortalForCampaignAction,
```

- [ ] **Step 2: Add the "Candidate voice" card**

Immediately after line 225 (the `</div>` that closes the "Candidate avatar" card, right before the `{/* Users */}` comment), insert:

```tsx
      {/* Candidate voice */}
      <div className="card" style={{ marginBottom: 24 }}>
        <span className="eyebrow">Video</span>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 8px' }}>Candidate voice</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
          Paste a HeyGen <strong>voice ID</strong> for this candidate's cloned voice — cloning happens
          in HeyGen directly (native cloning or a third-party import), this just links the result to
          this campaign so avatar video generation has a voice to use.
        </p>
        <form action={assignVoiceAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="field-label">HeyGen voice ID</label>
              <input
                name="heygen_voice_id"
                className="input"
                style={{ fontFamily: 'monospace', fontSize: 13 }}
                placeholder="e.g. 32e35b6753d94b61963bf8d0d2f15980"
              />
            </div>
            <button className="btn primary" type="submit" style={{ fontSize: 13, marginBottom: 1 }}>
              Assign voice
            </button>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-3)' }}>
            <input type="checkbox" name="consent" required style={{ marginTop: 2 }} />
            I confirm the candidate has given consent for this HeyGen voice to be used to generate video on their behalf.
          </label>
        </form>
        {profile?.heygenVoiceId ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 600 }}>Voice assigned</span>
            <code style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>{profile.heygenVoiceId}</code>
          </div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-3)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>No voice assigned yet</span>
          </div>
        )}
      </div>

```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No type errors (this is a Server Component; `assignVoiceAction` is `Promise<void>`, matching the `form action` type requirement exactly like `assignAvatarAction`).

- [ ] **Step 4: Manual verification**

Start the dev server (`npm run dev`), sign in as a super_admin, open `/admin/campaigns/[any-campaign-id]`, and confirm:
- The new "Candidate voice" card renders below "Candidate avatar".
- Submitting a voice ID with consent checked updates the status line to "Voice assigned" with the ID shown.
- Submitting without checking consent does nothing (page reloads, status line unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/campaigns/[id]/page.tsx
git commit -m "feat: add candidate voice assignment UI to admin campaign page"
```
