# Role-Based Permission Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add enforced role-based permission gates for `owner`, `manager`, `approver`, and `staff` so they can only perform the actions their role allows.

**Architecture:** A single pure `can(role, action)` function in `src/lib/permissions.ts` is the source of truth. Server actions do an early-return guard. The ContentWizard and Settings UI receive the role from the server-component parent and hide/disable restricted controls.

**Tech Stack:** Next.js App Router (server components + server actions), Vitest for tests, TypeScript.

## Global Constraints

- `super_admin` is NOT affected — it already has its own `requireAdmin()` gate, do not touch it.
- All campaign roles (`owner`, `manager`, `approver`, `staff`) are defined in `src/domain/types.ts` as `Role`.
- Test runner: `npm test` (Vitest).
- Type-check: `npm run typecheck`.
- Permission matrix (do not deviate):
  - `approve`: owner ✅ manager ✅ approver ✅ staff ❌
  - `schedule`: owner ✅ manager ✅ approver ❌ staff ❌
  - `publish`: owner ✅ manager ✅ approver ❌ staff ❌
  - `edit_settings`: owner ✅ manager ✅ approver ❌ staff ❌

---

## File Map

| File | Change |
|---|---|
| `src/lib/permissions.ts` | **Create** — exports `can(role, action): boolean` |
| `src/lib/permissions.test.ts` | **Create** — unit tests for all 16 role/action combos |
| `src/app/actions.ts` | **Modify** — add permission guard to 5 actions |
| `src/app/settings/page.tsx` | **Modify** — guard `saveProfileAction` + read-only UI |
| `src/app/content/[id]/page.tsx` | **Modify** — pass `role` prop to `ContentWizard` |
| `src/components/ContentWizard.tsx` | **Modify** — accept `role` prop, hide restricted buttons |

---

## Task 1: Create `src/lib/permissions.ts` with tests

**Files:**
- Create: `src/lib/permissions.ts`
- Create: `src/lib/permissions.test.ts`

**Interfaces:**
- Produces: `can(role: Role, action: 'approve' | 'schedule' | 'publish' | 'edit_settings'): boolean` — imported by all subsequent tasks.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/permissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { can } from './permissions';

describe('can – approve', () => {
  it('allows owner',    () => expect(can('owner',    'approve')).toBe(true));
  it('allows manager',  () => expect(can('manager',  'approve')).toBe(true));
  it('allows approver', () => expect(can('approver', 'approve')).toBe(true));
  it('denies staff',    () => expect(can('staff',    'approve')).toBe(false));
});

describe('can – schedule', () => {
  it('allows owner',    () => expect(can('owner',    'schedule')).toBe(true));
  it('allows manager',  () => expect(can('manager',  'schedule')).toBe(true));
  it('denies approver', () => expect(can('approver', 'schedule')).toBe(false));
  it('denies staff',    () => expect(can('staff',    'schedule')).toBe(false));
});

describe('can – publish', () => {
  it('allows owner',    () => expect(can('owner',    'publish')).toBe(true));
  it('allows manager',  () => expect(can('manager',  'publish')).toBe(true));
  it('denies approver', () => expect(can('approver', 'publish')).toBe(false));
  it('denies staff',    () => expect(can('staff',    'publish')).toBe(false));
});

describe('can – edit_settings', () => {
  it('allows owner',    () => expect(can('owner',    'edit_settings')).toBe(true));
  it('allows manager',  () => expect(can('manager',  'edit_settings')).toBe(true));
  it('denies approver', () => expect(can('approver', 'edit_settings')).toBe(false));
  it('denies staff',    () => expect(can('staff',    'edit_settings')).toBe(false));
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd /Users/yahyashah/Downloads/campaign-app && npm test -- --reporter=verbose 2>&1 | head -30
```

Expected: error like `Cannot find module './permissions'`

- [ ] **Step 3: Implement `src/lib/permissions.ts`**

```ts
import type { Role } from '@/domain/types';

type Action = 'approve' | 'schedule' | 'publish' | 'edit_settings';

const PERMISSIONS: Record<Action, Role[]> = {
  approve:       ['owner', 'manager', 'approver'],
  schedule:      ['owner', 'manager'],
  publish:       ['owner', 'manager'],
  edit_settings: ['owner', 'manager'],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[action].includes(role);
}
```

- [ ] **Step 4: Run tests — confirm all 16 pass**

```bash
cd /Users/yahyashah/Downloads/campaign-app && npm test -- --reporter=verbose 2>&1 | tail -30
```

Expected: 16 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/lib/permissions.test.ts
git commit -m "feat: add can() permission utility with tests"
```

---

## Task 2: Gate server actions in `src/app/actions.ts`

**Files:**
- Modify: `src/app/actions.ts`

**Interfaces:**
- Consumes: `can` from `src/lib/permissions.ts`

Five actions need guards. Add `import { can } from '@/lib/permissions';` at the top of the file alongside the existing imports, then add the early-return (or GateError throw) shown for each action below.

- [ ] **Step 1: Add the import**

In `src/app/actions.ts`, add to the existing import block at the top:

```ts
import { can } from '@/lib/permissions';
```

- [ ] **Step 2: Guard `approveTextAction` (line ~307)**

The function currently starts with:
```ts
export async function approveTextAction(id: string): Promise<Result> {
  const s = requireSession();
  const item = await contentRepo.get(id);
```

Change to:
```ts
export async function approveTextAction(id: string): Promise<Result> {
  const s = requireSession();
  if (!can(s.role, 'approve')) return { ok: false, error: 'Permission denied.' };
  const item = await contentRepo.get(id);
```

- [ ] **Step 3: Guard `confirmVideoAction` (line ~339)**

The function currently starts with:
```ts
export async function confirmVideoAction(id: string, videoUrl: string): Promise<Result> {
  const s = requireSession();
  const item = await contentRepo.get(id);
```

Change to:
```ts
export async function confirmVideoAction(id: string, videoUrl: string): Promise<Result> {
  const s = requireSession();
  if (!can(s.role, 'approve')) return { ok: false, error: 'Permission denied.' };
  const item = await contentRepo.get(id);
```

- [ ] **Step 4: Guard `publishAction` (line ~210)**

The function currently starts with:
```ts
export async function publishAction(id: string, platforms: Platform[]): Promise<Result> {
  const s = requireSession();
  const item = await contentRepo.get(id);
```

Change to:
```ts
export async function publishAction(id: string, platforms: Platform[]): Promise<Result> {
  const s = requireSession();
  if (!can(s.role, 'publish')) return { ok: false, error: 'Permission denied.' };
  const item = await contentRepo.get(id);
```

- [ ] **Step 5: Guard `scheduleAction` (line ~203)**

The function currently starts with:
```ts
export async function scheduleAction(id: string): Promise<Result> {
  const s = requireSession();
  const r = await guard(() => lifecycle.schedule(id, s.userId));
```

Change to:
```ts
export async function scheduleAction(id: string): Promise<Result> {
  const s = requireSession();
  if (!can(s.role, 'schedule')) return { ok: false, error: 'Permission denied.' };
  const r = await guard(() => lifecycle.schedule(id, s.userId));
```

- [ ] **Step 6: Guard `scheduleWithTimeAction` (line ~496)**

`requireSession()` is called *inside* the `guard()` callback, so use `throw new GateError(...)` (already imported, already caught by `guard()`). The function currently starts with:

```ts
export async function scheduleWithTimeAction(
  id: string,
  platforms: Platform[],
  scheduledAt: string,
  timezone: string,
): Promise<Result> {
  return guard(async () => {
    const s = requireSession();
    if (!scheduledAt) throw new GateError('Scheduled time is required');
```

Change to:
```ts
export async function scheduleWithTimeAction(
  id: string,
  platforms: Platform[],
  scheduledAt: string,
  timezone: string,
): Promise<Result> {
  return guard(async () => {
    const s = requireSession();
    if (!can(s.role, 'schedule')) throw new GateError('Permission denied.');
    if (!scheduledAt) throw new GateError('Scheduled time is required');
```

- [ ] **Step 7: Guard `setCapAction` (line ~227)**

The function currently starts with:
```ts
export async function setCapAction(formData: FormData): Promise<void> {
  const s = requireSession();
  const dollars = Number(formData.get('cap'));
```

Change to:
```ts
export async function setCapAction(formData: FormData): Promise<void> {
  const s = requireSession();
  if (!can(s.role, 'edit_settings')) return;
  const dollars = Number(formData.get('cap'));
```

- [ ] **Step 8: Type-check**

```bash
cd /Users/yahyashah/Downloads/campaign-app && npm run typecheck 2>&1
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/actions.ts
git commit -m "feat: add permission gates to server actions"
```

---

## Task 3: Gate settings page — server action + read-only UI

**Files:**
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `can` from `src/lib/permissions.ts`

Two changes in one file: (1) guard `saveProfileAction` server-side, (2) disable all inputs and hide save buttons for `approver` and `staff`.

- [ ] **Step 1: Guard `saveProfileAction`**

`saveProfileAction` uses dynamic imports because of the `'use server'` directive. It currently starts with:

```ts
async function saveProfileAction(formData: FormData) {
  'use server';
  const { requireSession } = await import('@/lib/session');
  const s = requireSession();
  const keyPositions = ...
```

Change to:
```ts
async function saveProfileAction(formData: FormData) {
  'use server';
  const { requireSession } = await import('@/lib/session');
  const { can } = await import('@/lib/permissions');
  const s = requireSession();
  if (!can(s.role, 'edit_settings')) return;
  const keyPositions = ...
```

- [ ] **Step 2: Add `canEdit` to the page component**

In the `Settings` page component, `s` is already available from `requireSession()`. Add `canEdit` right after the data fetching `Promise.all`:

```ts
export default async function Settings() {
  const s = requireSession();
  const [campaign, rules, users, profile] = await Promise.all([...]);
  const cap = ((campaign?.monthlyCostCapCents ?? 0) / 100).toFixed(0);
  const canEdit = can(s.role, 'edit_settings');   // ← add this line
```

Also add the static import at the top of the file:
```ts
import { can } from '@/lib/permissions';
```

- [ ] **Step 3: Make candidate profile form read-only when `!canEdit`**

The profile `<form>` currently ends with:
```tsx
          <button className="btn primary" type="submit" style={{ alignSelf: 'flex-start' }}>Save profile</button>
        </form>
```

Replace the entire `<form>` opening tag and submit button so all inputs are disabled and the button is hidden when `!canEdit`:

Add `aria-disabled={!canEdit}` to the `<form>` tag and `disabled={!canEdit}` to every `<input>`, `<textarea>`, and `<select>` inside it, and wrap the submit button in a conditional:

```tsx
        <form action={saveProfileAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="field-label">Full name</label>
              <input name="full_name" className="input" defaultValue={profile?.fullName ?? ''} required disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">Preferred name</label>
              <input name="preferred_name" className="input" defaultValue={profile?.preferredName ?? ''} required disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">Running for</label>
              <input name="office" className="input" defaultValue={profile?.office ?? ''} required disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">District</label>
              <input name="district" className="input" defaultValue={profile?.district ?? ''} required disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">Party</label>
              <input name="party" className="input" defaultValue={profile?.party ?? ''} disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">Primary opponent</label>
              <input name="opponent_name" className="input" defaultValue={profile?.opponentName ?? ''} disabled={!canEdit} />
            </div>
          </div>
          <div>
            <label className="field-label">Bio (2–3 sentences)</label>
            <textarea name="bio" className="input" style={{ minHeight: 72 }} defaultValue={profile?.bio ?? ''} disabled={!canEdit} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="field-label">Tagline</label>
              <input name="tagline" className="input" defaultValue={profile?.tagline ?? ''} disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">Target audience</label>
              <input name="target_audience" className="input" defaultValue={profile?.targetAudience ?? ''} disabled={!canEdit} />
            </div>
          </div>
          <div>
            <label className="field-label">Key positions (one per line)</label>
            <textarea name="key_positions" className="input" style={{ minHeight: 100 }}
              defaultValue={profile?.keyPositions.join('\n') ?? ''} disabled={!canEdit} />
          </div>
          <div>
            <label className="field-label">Voice tone</label>
            <select name="voice_tone" className="input" defaultValue={profile?.voiceTone ?? 'conversational'} disabled={!canEdit}>
              <option value="conversational">Conversational</option>
              <option value="formal">Formal</option>
              <option value="urgent">Urgent</option>
              <option value="inspirational">Inspirational</option>
            </select>
          </div>
          {canEdit && (
            <button className="btn primary" type="submit" style={{ alignSelf: 'flex-start' }}>Save profile</button>
          )}
        </form>
```

- [ ] **Step 4: Make spending cap form read-only when `!canEdit`**

The cap form currently is:
```tsx
          <form action={setCapAction}>
            <label className="field">
              <span className="cap">Cap (USD)</span>
              <input type="text" name="cap" defaultValue={cap} inputMode="numeric" />
            </label>
            <button className="btn primary" type="submit">Save cap</button>
          </form>
```

Replace with:
```tsx
          <form action={setCapAction}>
            <label className="field">
              <span className="cap">Cap (USD)</span>
              <input type="text" name="cap" defaultValue={cap} inputMode="numeric" disabled={!canEdit} />
            </label>
            {canEdit && <button className="btn primary" type="submit">Save cap</button>}
          </form>
```

- [ ] **Step 5: Type-check**

```bash
cd /Users/yahyashah/Downloads/campaign-app && npm run typecheck 2>&1
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat: restrict settings edits to owner and manager"
```

---

## Task 4: Gate ContentWizard action buttons by role

**Files:**
- Modify: `src/app/content/[id]/page.tsx`
- Modify: `src/components/ContentWizard.tsx`

**Interfaces:**
- Consumes: `can` from `src/lib/permissions.ts`, `Role` from `@/domain/types`
- `ContentWizard` gains a new required prop: `role: Role`

The server component (`content/[id]/page.tsx`) reads `s.role` and passes it to the client component (`ContentWizard`). `ContentWizard` imports `can()` and conditionally renders the approve, confirm-video, publish, and schedule buttons.

- [ ] **Step 1: Pass `role` from the page to `ContentWizard`**

In `src/app/content/[id]/page.tsx`, `s` is already available. Find the `<ContentWizard .../>` call and add the `role` prop:

```tsx
      <ContentWizard
        item={item}
        hasDisclosure={hasDisclosure}
        requiredDisclosures={requiredDisclosures}
        videoSettings={{
          avatarId: profile?.heygenAvatarId ?? undefined,
          voiceId: profile?.elevenLabsVoiceId ?? undefined,
          background: profile?.videoBackground ?? 'plain',
          aspectRatio: profile?.videoAspectRatio ?? '16:9',
        }}
        role={s.role}
      />
```

- [ ] **Step 2: Update `ContentWizard` props type and add imports**

In `src/components/ContentWizard.tsx`, add these imports at the top:

```ts
import type { Role } from '@/domain/types';
import { can } from '@/lib/permissions';
```

Then find the props destructuring (currently around line 57):
```ts
export function ContentWizard({
  item,
  hasDisclosure,
  requiredDisclosures,
  videoSettings,
}: {
  item: ContentItem;
  hasDisclosure: boolean;
  requiredDisclosures: RequiredDisclosure[];
  videoSettings?: {
    avatarId?: string;
    voiceId?: string;
    background?: string;
    aspectRatio?: '16:9' | '9:16' | '1:1';
  };
}) {
```

Change to:
```ts
export function ContentWizard({
  item,
  hasDisclosure,
  requiredDisclosures,
  videoSettings,
  role,
}: {
  item: ContentItem;
  hasDisclosure: boolean;
  requiredDisclosures: RequiredDisclosure[];
  videoSettings?: {
    avatarId?: string;
    voiceId?: string;
    background?: string;
    aspectRatio?: '16:9' | '9:16' | '1:1';
  };
  role: Role;
}) {
```

- [ ] **Step 3: Gate the "Looks good — Continue →" (approve) button**

Find the approve button in the review step (around line 259):
```tsx
            <button
              className="btn primary"
              style={{ width: '100%' }}
              disabled={busy}
              onClick={() => run(() => approveTextAction(item.id))}
            >
              {busy ? 'Saving…' : 'Looks good — Continue →'}
            </button>
```

Wrap it so it only renders for roles that can approve:
```tsx
            {can(role, 'approve') ? (
              <button
                className="btn primary"
                style={{ width: '100%' }}
                disabled={busy}
                onClick={() => run(() => approveTextAction(item.id))}
              >
                {busy ? 'Saving…' : 'Looks good — Continue →'}
              </button>
            ) : (
              <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                Approval requires manager or approver access.
              </p>
            )}
```

- [ ] **Step 4: Gate the "Video looks good — Continue →" (confirm video) buttons**

There are two confirm-video buttons in the video step. Both need the same gate.

First button (when video has just been generated, around line 356):
```tsx
                <button
                  className="btn primary"
                  style={{ width: '100%' }}
                  disabled={busy}
                  onClick={() => run(() => confirmVideoAction(item.id, videoUrl))}
                >
                  {busy ? 'Saving…' : 'Video looks good — Continue →'}
                </button>
```

Wrap with:
```tsx
                {can(role, 'approve') && (
                  <button
                    className="btn primary"
                    style={{ width: '100%' }}
                    disabled={busy}
                    onClick={() => run(() => confirmVideoAction(item.id, videoUrl))}
                  >
                    {busy ? 'Saving…' : 'Video looks good — Continue →'}
                  </button>
                )}
```

Second button (when video already exists on item, around line 381):
```tsx
                <button
                  className="btn primary"
                  style={{ width: '100%' }}
                  disabled={busy}
                  onClick={() => run(() => confirmVideoAction(item.id, item.mediaUrl!))}
                >
                  {busy ? 'Saving…' : 'Video looks good — Continue →'}
                </button>
```

Wrap with:
```tsx
                {can(role, 'approve') && (
                  <button
                    className="btn primary"
                    style={{ width: '100%' }}
                    disabled={busy}
                    onClick={() => run(() => confirmVideoAction(item.id, item.mediaUrl!))}
                  >
                    {busy ? 'Saving…' : 'Video looks good — Continue →'}
                  </button>
                )}
```

- [ ] **Step 5: Gate the publish/schedule buttons in the publish step**

The publish step currently ends with (around line 521):
```tsx
            {scheduleMode === 'now' ? (
              <button className="btn primary" style={{ width: '100%' }}
                disabled={busy || platforms.length === 0}
                onClick={() => run(() => publishAction(item.id, platforms), 'Published successfully!')}>
                {busy ? 'Publishing…' : `Publish to ${platforms.length} platform${platforms.length !== 1 ? 's' : ''}`}
              </button>
            ) : (
              <button className="btn primary" style={{ width: '100%' }}
                disabled={busy || platforms.length === 0 || !scheduledAt}
                onClick={() => run(() => scheduleWithTimeAction(item.id, platforms, scheduledAt, timezone), 'Content scheduled!')}>
                {busy ? 'Scheduling…' : scheduledAt
                  ? `Schedule for ${new Date(scheduledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                  : 'Pick a time above'}
              </button>
            )}
```

Replace with:
```tsx
            {scheduleMode === 'now' ? (
              can(role, 'publish') ? (
                <button className="btn primary" style={{ width: '100%' }}
                  disabled={busy || platforms.length === 0}
                  onClick={() => run(() => publishAction(item.id, platforms), 'Published successfully!')}>
                  {busy ? 'Publishing…' : `Publish to ${platforms.length} platform${platforms.length !== 1 ? 's' : ''}`}
                </button>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>Publishing requires manager access.</p>
              )
            ) : (
              can(role, 'schedule') ? (
                <button className="btn primary" style={{ width: '100%' }}
                  disabled={busy || platforms.length === 0 || !scheduledAt}
                  onClick={() => run(() => scheduleWithTimeAction(item.id, platforms, scheduledAt, timezone), 'Content scheduled!')}>
                  {busy ? 'Scheduling…' : scheduledAt
                    ? `Schedule for ${new Date(scheduledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                    : 'Pick a time above'}
                </button>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>Scheduling requires manager access.</p>
              )
            )}
```

- [ ] **Step 6: Run tests and type-check**

```bash
cd /Users/yahyashah/Downloads/campaign-app && npm test 2>&1 | tail -10
npm run typecheck 2>&1
```

Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/content/[id]/page.tsx src/components/ContentWizard.tsx
git commit -m "feat: hide approve/publish/schedule buttons by role in ContentWizard"
```
