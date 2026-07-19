# Data-Integrity Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This plan is TDD: write the failing test, watch it fail, implement, watch it pass. For migration-only fixes, run the given verification query.

**Goal:** Close the remaining data-integrity findings from the 2026-07-15 audit that were **not** owned by the P0 launch-blocker plan: DATA-7, DATA-8, DATA-11, DATA-12, DATA-13, DATA-14, DATA-16, DATA-17, DATA-18. Together these stop silent write-loss, timezone corruption, race-y single-use claims, guessable identifiers, unconstrained enum values, duplicate ingest rows, and referential-integrity gaps.

**Architecture:** Almost every fix is a bounded edit to an existing repo module (`src/lib/repos.ts`, `src/lib/avatars.ts`), a server action (`src/app/actions.ts`, `src/app/admin/actions.ts`), one API route (`src/app/api/monitoring/ingest/route.ts`), the id helper (`src/lib/store.ts`), the domain types (`src/domain/types.ts`), or an additive migration under `supabase/migrations/`. The one foundational change is **DATA-7**: a single `throwOnError` helper (added to `src/lib/supabase.ts`) that every mutation is wrapped in so a failed Supabase write throws instead of being silently discarded. Every later task in this plan reuses that helper. No new runtime dependencies.

**Tech Stack:** Next.js 14 App Router, Supabase (`adminDb` service-role client, `@supabase/supabase-js` v2), Stripe v22.3.0, Vitest. Server actions return `type Result = { ok: true } | { ok: false; error: string }`. Node 18+ runtime (global `crypto.randomUUID`, `node:crypto`).

## Global Constraints

- **No autonomous git commits** — the user reviews and commits (per project memory). Do not run `git commit`, `git push`, or `git rm`; delete files with the filesystem only if a task calls for it.
- **Every DB mutation must check its error.** After this plan, no `await adminDb.from(...).insert/update/delete(...)` may exist whose `{ error }` is ignored. Either wrap it in `throwOnError` (DATA-7) or check `error` inline and return an explicit `Result` — never drop it.
- **Migrations must be additive and reversible where possible.** Prefer `add column`, `create index if not exists`, `add constraint`. When a policy must change (e.g. an FK's `ON DELETE`), drop-and-recreate the named constraint in the same migration and record the inverse. Never `drop column` holding live data; keep unused columns rather than destroy them.
- **Do not weaken the scheduling hard gate.** The P0 plan established that all paths to `status='scheduled'` go through `ContentLifecycle.schedule` (`src/domain/content-lifecycle.ts:50`). Nothing in this plan writes `status:'scheduled'` directly.
- Tests mock `next/cache`, `next/navigation`, `@/lib/session`, `@/lib/data`, `@/lib/supabase`, `@/lib/repos`, `@/lib/services`, `@/lib/store` — mirror the scaffolding in `src/app/actions.avatar-billing.test.ts`.
- `npm test && npm run typecheck` must be green after every task. Test command is `vitest run` (`npm test`); typecheck is `tsc --noEmit` (`npm run typecheck`).

## Overlap with the P0 plan (`2026-07-15-p0-launch-blockers.md`) — read before starting

DATA-7 is foundational and its call sites partly overlap the P0 edits. To stay consistent:

- The P0 plan **rewrote** `saveBodyAction`, `publishAction`, the cron publish route, `confirmDisclosureAction`, `approveTextAction`, and `confirmVideoAction` with **inline** `{ error }` checks that return a `Result` (e.g. `if (error) return { ok: false, error: 'Save failed.' }`). **Leave those inline checks exactly as the P0 plan wrote them** — do not re-wrap them in `throwOnError`. They already satisfy the "check its error" constraint.
- DATA-7 in this plan therefore targets the **repo layer** (`repos.ts`, `avatars.ts`) and the action-level raw mutations the P0 plan did **not** touch (`createContentAction`, `joinAction`, `generateVideoAction`'s audit insert, `generateFromMonitoringAction`'s insert). Those repo methods throw on error; because actions wrap lifecycle calls in `guard()` (which rethrows anything that is not `GateError`/`CapExceeded`/`BillingBlocked`), a genuinely failed write now surfaces loudly instead of corrupting state.
- If a P0 task and a DATA task both name the same line, **the P0 edit lands first**; the DATA task then adjusts only what remains. Re-read the file before editing.
- DATA-14's "check inserts" and DATA-12's "check delete errors" are satisfied by the same `throwOnError` helper from DATA-7. Do DATA-7 first.

## Task ordering

1. **Task 1 — DATA-7** (`throwOnError` helper + wrap repo/action mutations). Foundational; do first.
2. **Task 2 — DATA-14** (crypto-strong ids + wrap the id-generating inserts).
3. **Task 3 — DATA-8** (naive-datetime → UTC via submitted IANA tz).
4. **Task 4 — DATA-11** (atomic single-use invite claim).
5. **Task 5 — DATA-12** (delete error checks + `ON DELETE` policy).
6. **Task 6 — DATA-16** (validate `content_items.type` + CHECK constraint).
7. **Task 7 — DATA-17** (monitoring ingest: partial unique index + upsert).
8. **Task 8 — DATA-13** (remove the unenforced blackout-days surface).
9. **Task 9 — DATA-18** (referential-integrity FKs + model `campaignId: string | null`).

---

### Task 1: `throwOnError` write helper; wrap every ignored mutation (DATA-7)

**Files:**
- Modify: `src/lib/supabase.ts` (add the helper after the `adminDb` export, currently 7 lines)
- Modify: `src/lib/repos.ts` (`contentRepo.setStatus` :46-50, `approvalRepo.add` :54-62, `disclosureRepo.add` :74-82, `auditRepo.append` :100-109, `usageRepo.finalize` :144-160)
- Modify: `src/lib/avatars.ts` (`insertAvatar` :48-59, `updateAvatarStatus` :67-72 — `deleteAvatarRow` :75-77 is handled in Task 5)
- Modify: `src/app/actions.ts` (`createContentAction` :150-160, `generateVideoAction` audit insert :306-310, `generateFromMonitoringAction` insert :446-456; `joinAction` mutations :99-127 are refined in Task 4)
- Test: `src/lib/supabase.throwOnError.test.ts` (new), `src/lib/repos.write-errors.test.ts` (new)

**Interfaces:**
- Produces: `export async function throwOnError<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>, context: string): Promise<T>` — awaits a Supabase query builder (they are thenables), throws `Error("<context>: <message>")` when `error` is set, otherwise returns `data`. Reused by Tasks 2, 4, 5, 6, 7.

- [ ] **Step 1: Write the failing test** (`src/lib/supabase.throwOnError.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { throwOnError } from './supabase';

describe('throwOnError', () => {
  it('returns data when there is no error', async () => {
    const q = Promise.resolve({ data: [{ id: 'a' }], error: null });
    await expect(throwOnError(q, 'ctx')).resolves.toEqual([{ id: 'a' }]);
  });

  it('throws with the context prefix when Supabase reports an error', async () => {
    const q = Promise.resolve({ data: null, error: { message: 'duplicate key value' } });
    await expect(throwOnError(q, 'content_items.setStatus'))
      .rejects.toThrow('content_items.setStatus: duplicate key value');
  });
});
```

- [ ] **Step 2: Write the failing repo test** (`src/lib/repos.write-errors.test.ts`) — assert the repo throws when the underlying write fails.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const eq = vi.fn();
const update = vi.fn(() => ({ eq }));
const insert = vi.fn();
vi.mock('./supabase', async () => {
  const actual = await vi.importActual<typeof import('./supabase')>('./supabase');
  return { ...actual, adminDb: { from: vi.fn(() => ({ update, insert })) } };
});

describe('repos surface Supabase write errors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('contentRepo.setStatus throws when the update fails', async () => {
    eq.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const { contentRepo } = await import('./repos');
    await expect(contentRepo.setStatus('ct-1', 'approved')).rejects.toThrow(/boom/);
  });

  it('auditRepo.append throws when the insert fails', async () => {
    insert.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    const { auditRepo } = await import('./repos');
    await expect(auditRepo.append({
      campaignId: 'c-1', action: 'x', entityType: 'content_item', entityId: 'ct-1',
    })).rejects.toThrow(/nope/);
  });
});
```

Note: `throwOnError` is imported from the *real* module (`importActual`) so only `adminDb` is mocked.

- [ ] **Step 3: Run both and confirm they fail**

Run: `npx vitest run src/lib/supabase.throwOnError.test.ts src/lib/repos.write-errors.test.ts`
Expected: FAIL — `throwOnError` does not exist yet; the repo methods currently ignore `{ error }` and resolve without throwing.

- [ ] **Step 4: Add the helper** to `src/lib/supabase.ts`. The current file is:

```ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Server-side admin client — bypasses RLS, only used in server actions and server components.
export const adminDb = createClient(url, serviceKey);
```

Append:

```ts
// supabase-js reports write failures on the resolved `{ error }` field WITHOUT
// throwing. Every mutation must be routed through this so a failed write is
// surfaced loudly instead of silently desyncing lifecycle/audit/usage state
// (audit finding DATA-7). Query builders are thenables, so this awaits them
// directly. `context` names the call site for the thrown message.
export async function throwOnError<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
  context: string,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`${context}: ${error.message}`);
  return data;
}
```

- [ ] **Step 5: Wrap the repo mutations** in `src/lib/repos.ts`. Add `throwOnError` to the existing import on line 1 (`import { adminDb, throwOnError } from './supabase';`). Then replace each method body.

`contentRepo.setStatus` (currently :46-50):

```ts
  async setStatus(id, status: ContentStatus) {
    await throwOnError(
      adminDb.from('content_items')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id),
      'content_items.setStatus',
    );
  },
```

`approvalRepo.add` (currently :54-62):

```ts
  async add(rec) {
    await throwOnError(
      adminDb.from('approval_records').insert({
        content_item_id: rec.contentItemId,
        campaign_id: rec.campaignId,
        approver_user_id: rec.approverUserId,
        decision: rec.decision,
        note: rec.note ?? null,
      }),
      'approval_records.add',
    );
  },
```

`disclosureRepo.add` (currently :74-82):

```ts
  async add(rec) {
    await throwOnError(
      adminDb.from('disclosure_records').insert({
        content_item_id: rec.contentItemId,
        campaign_id: rec.campaignId,
        jurisdiction: rec.jurisdiction,
        disclosure_text: rec.disclosureText,
        placement: rec.placement,
      }),
      'disclosure_records.add',
    );
  },
```

`auditRepo.append` (currently :100-109):

```ts
  async append(entry) {
    await throwOnError(
      adminDb.from('audit_entries').insert({
        campaign_id: entry.campaignId,
        actor_user_id: entry.actorUserId ?? null,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId ?? null,
        details: entry.details ?? null,
      }),
      'audit_entries.append',
    );
  },
```

`usageRepo.finalize` (currently :144-160) — both the delete and the insert must be checked. Keep the reservation lookup as-is (a read):

```ts
  async finalize(campaignId, kind, _quantity, costCents, reservedCents) {
    const { data: reservation } = await adminDb
      .from('usage_events')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('kind', '_reserved')
      .eq('cost_cents', reservedCents)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (reservation) {
      await throwOnError(
        adminDb.from('usage_events').delete().eq('id', reservation.id),
        'usage_events.finalize.delete',
      );
    }
    if (costCents > 0) {
      await throwOnError(
        adminDb.from('usage_events').insert({ campaign_id: campaignId, kind, cost_cents: costCents }),
        'usage_events.finalize.insert',
      );
    }
  },
```

- [ ] **Step 6: Wrap the avatar mutations** in `src/lib/avatars.ts`. Change the import on line 2 to `import { adminDb, throwOnError } from './supabase';`. Wrap `insertAvatar` (:48-59) and `updateAvatarStatus` (:67-72):

```ts
  await throwOnError(
    adminDb.from('avatars').insert({
      id: input.id,
      campaign_id: input.campaignId,
      name: input.name,
      status: input.status ?? 'training',
      heygen_group_id: input.heygenGroupId ?? null,
      heygen_look_id: input.heygenLookId ?? null,
      source_photo_urls: input.sourcePhotoUrls,
      error_message: input.errorMessage ?? null,
      consent_confirmed_by: input.consentConfirmedBy,
      created_by: input.createdBy,
    }),
    'avatars.insert',
  );
```

```ts
  await throwOnError(
    adminDb.from('avatars').update({
      status,
      ...(opts?.heygenGroupId !== undefined && { heygen_group_id: opts.heygenGroupId }),
      ...(opts?.heygenLookId !== undefined && { heygen_look_id: opts.heygenLookId }),
      ...(opts?.errorMessage !== undefined && { error_message: opts.errorMessage }),
    }).eq('id', id),
    'avatars.updateStatus',
  );
```

(`deleteAvatarRow` at :75-77 is intentionally left for Task 5, which also adds the `ON DELETE` policy.)

- [ ] **Step 7: Wrap the un-checked action inserts** in `src/app/actions.ts`. Add `throwOnError` to the supabase import on line 6 (`import { adminDb, throwOnError } from '@/lib/supabase';`). Wrap `createContentAction`'s insert (:150-160):

```ts
  await throwOnError(
    adminDb.from('content_items').insert({
      id,
      campaign_id: s.campaignId,
      type: (formData.get('type') as ContentType) || 'social_post',
      title: String(formData.get('title') || 'Untitled'),
      body: String(formData.get('body') || ''),
      status: 'draft',
      is_ai_generated: formData.get('isAiGenerated') === 'on',
      target_jurisdictions: campaign.jurisdictions,
      created_by: s.userId,
    }),
    'content_items.create',
  );
```

Wrap `generateVideoAction`'s audit insert (:306-310) and `generateFromMonitoringAction`'s content insert (:446-456) the same way (`context: 'audit_entries.generate_video'` and `'content_items.from_monitoring'`). Both already sit inside `try` blocks that only convert `CapExceeded`/`BillingBlocked` to a `Result`; a thrown write error correctly propagates as a 500 rather than a false success. Do **not** touch the raw inserts the P0 plan already rewrote (`joinAction` — refined in Task 4; `saveBodyAction`, `publishAction`, `confirmDisclosureAction`, `approveTextAction`, `confirmVideoAction` — already inline-checked by P0).

- [ ] **Step 8: Run the tests and the full suite**

Run: `npx vitest run src/lib/supabase.throwOnError.test.ts src/lib/repos.write-errors.test.ts && npm test && npm run typecheck`
Expected: new tests PASS; all existing tests still pass; typecheck clean.

- [ ] **Note:** `guard()` (`actions.ts:20`) still only maps `GateError`/`CapExceeded`/`BillingBlocked` to `Result`; a `throwOnError` failure is a generic `Error` and propagates by design — an unrecoverable write failure should not read as `{ ok: true }`. Do not add generic writes into `guard`'s catch list.

---

### Task 2: Crypto-strong identifiers + checked id-generating inserts (DATA-14)

**Files:**
- Modify: `src/lib/store.ts` (whole file — currently 4 lines)
- Modify: `src/app/admin/actions.ts` (`generateInviteAction` code :29-36, `createCampaignAction` id :72-76, `addUserAction` userId+invite :211-226, `assignAvatarAction` avatarId :171-181)
- Modify: `src/app/actions.ts` (`joinAction` fallback userId :96 — coordinate with Task 4)
- Test: `src/lib/store.test.ts` (new)

**Interfaces:**
- Produces (from `src/lib/store.ts`): `uid(): string` (now a UUID), `prefixedId(prefix: string): string`, `inviteCode(): string` (high-entropy, URL-safe).

The current file is:

```ts
// Thin helpers used by actions and pages.
// All data now lives in Supabase — see src/lib/data.ts and src/lib/repos.ts.

export const uid = () => Math.random().toString(36).slice(2, 10);
```

`Math.random()` gives ~40 bits over 8 base36 chars — collision-prone at scale and predictable, and invite codes built the same way (`'inv_' + Math.random().toString(36).slice(2, 14)`) are guessable.

- [ ] **Step 1: Write the failing test** (`src/lib/store.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { uid, prefixedId, inviteCode } from './store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('id helpers', () => {
  it('uid returns a v4 UUID', () => {
    expect(uid()).toMatch(UUID);
  });

  it('uid is collision-resistant across many draws', () => {
    const set = new Set(Array.from({ length: 10_000 }, () => uid()));
    expect(set.size).toBe(10_000);
  });

  it('prefixedId keeps the prefix and appends a UUID', () => {
    const id = prefixedId('camp-');
    expect(id.startsWith('camp-')).toBe(true);
    expect(id.slice('camp-'.length)).toMatch(UUID);
  });

  it('inviteCode is high-entropy and URL-safe', () => {
    const c = inviteCode();
    expect(c.startsWith('inv_')).toBe(true);
    expect(c.length).toBeGreaterThan(20);
    expect(c.slice(4)).toMatch(/^[A-Za-z0-9_-]+$/);
    const many = new Set(Array.from({ length: 10_000 }, () => inviteCode()));
    expect(many.size).toBe(10_000);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/store.test.ts`
Expected: FAIL — `prefixedId`/`inviteCode` are not exported and `uid()` is not a UUID.

- [ ] **Step 3: Rewrite `src/lib/store.ts`**

```ts
// Thin id helpers used by actions and API routes.
// All data now lives in Supabase — see src/lib/data.ts and src/lib/repos.ts.
import { randomUUID, randomBytes } from 'node:crypto';

// Primary keys. UUIDv4 — collision-resistant and unguessable, unlike the old
// 8-char Math.random() ids (audit finding DATA-14).
export const uid = (): string => randomUUID();

// Human-scannable ids that keep a readable prefix (e.g. 'camp-', 'u-', 'av-').
export const prefixedId = (prefix: string): string => `${prefix}${randomUUID()}`;

// Invite codes must be unguessable — they authorize joining a campaign.
// 18 random bytes → 24 URL-safe chars, ~144 bits of entropy.
export const inviteCode = (): string => `inv_${randomBytes(18).toString('base64url')}`;
```

- [ ] **Step 4: Use the strong generators in `src/app/admin/actions.ts`.** Import them: `import { prefixedId, inviteCode } from '@/lib/store';` (add near the top). Replace:
  - `generateInviteAction` :29 — `const code = 'inv_' + Math.random().toString(36).slice(2, 14);` → `const code = inviteCode();`
  - `createCampaignAction` :72 — `const id = 'camp-' + Math.random().toString(36).slice(2, 8);` → `const id = prefixedId('camp-');`
  - `addUserAction` :211 — `const userId = 'u-' + Math.random().toString(36).slice(2, 9);` → `const userId = prefixedId('u-');`
  - `addUserAction` :219 — `const code = 'inv_' + Math.random().toString(36).slice(2, 14);` → `const code = inviteCode();`
  - `assignAvatarAction` :171 — `const avatarId = 'av-' + Math.random().toString(36).slice(2, 9);` → `const avatarId = prefixedId('av-');`

- [ ] **Step 5: Check the id-generating inserts** (the "check inserts" half of DATA-14). `addUserAction` :212 already checks `{ error }` and bails — keep it. Wrap the previously-unchecked inserts with `throwOnError` (from Task 1); import it via `import { adminDb, throwOnError } from '@/lib/supabase';`:
  - `generateInviteAction` invite insert (:30-36) → `throwOnError(adminDb.from('invite_codes').insert({...}), 'invite_codes.generate')`
  - `createCampaignAction` campaign insert (:73-76) → `throwOnError(..., 'campaigns.create')`
  - `addUserAction` auto-invite insert (:220-226) → `throwOnError(..., 'invite_codes.auto')`
  - `assignAvatarAction` uses `insertAvatar` (already wrapped in Task 1).
  - `joinAction` (`src/app/actions.ts:96`) fallback id → `const userId = existing?.id ?? prefixedId('u-');` (its inserts/updates are finalized in Task 4).

- [ ] **Step 6: Run the test and full suite**

Run: `npx vitest run src/lib/store.test.ts && npm test && npm run typecheck`
Expected: PASS. `uid` is mocked in `actions.avatar-billing.test.ts` (returns `'avatar-1'`) and in the P0 tests — those keep working since they mock `@/lib/store` wholesale.

---

### Task 3: Convert scheduled time to UTC via the submitted IANA timezone (DATA-8)

**Files:**
- Create: `src/lib/timezone.ts`
- Create test: `src/lib/timezone.test.ts`
- Modify: `src/app/actions.ts` (`scheduleWithTimeAction` :550-589 — the validation on :560 and the write on :569-576)

**Interfaces:**
- Produces: `export function zonedNaiveToUtc(naive: string, timeZone: string): Date` — interprets a naive `datetime-local` string (`"2026-07-20T10:00"`, no offset) as wall-clock time **in `timeZone`** and returns the corresponding UTC instant.

The bug: `scheduleWithTimeAction` stores `new Date(scheduledAt).toISOString()` (:571). `new Date("2026-07-20T10:00")` parses a naive datetime in the **server's** TZ (UTC on Vercel), so "10:00 AM PT" is stored as 10:00 UTC and fires 7 hours early. The `timezone` column exists (migration 005) but is never applied to the instant.

- [ ] **Step 1: Write the failing test** (`src/lib/timezone.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { zonedNaiveToUtc } from './timezone';

describe('zonedNaiveToUtc', () => {
  it('interprets a summer PT wall-clock time as PDT (UTC-7)', () => {
    // 10:00 in America/Los_Angeles on 2026-07-20 (PDT) === 17:00 UTC.
    expect(zonedNaiveToUtc('2026-07-20T10:00', 'America/Los_Angeles').toISOString())
      .toBe('2026-07-20T17:00:00.000Z');
  });

  it('interprets a winter PT wall-clock time as PST (UTC-8)', () => {
    // 10:00 in America/Los_Angeles on 2026-01-20 (PST) === 18:00 UTC.
    expect(zonedNaiveToUtc('2026-01-20T10:00', 'America/Los_Angeles').toISOString())
      .toBe('2026-01-20T18:00:00.000Z');
  });

  it('is identity for UTC', () => {
    expect(zonedNaiveToUtc('2026-07-20T10:00', 'UTC').toISOString())
      .toBe('2026-07-20T10:00:00.000Z');
  });

  it('handles a positive-offset zone (Europe/Berlin, CEST UTC+2)', () => {
    expect(zonedNaiveToUtc('2026-07-20T10:00', 'Europe/Berlin').toISOString())
      .toBe('2026-07-20T08:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/timezone.test.ts`
Expected: FAIL — `src/lib/timezone.ts` does not exist.

- [ ] **Step 3: Implement the helper** (`src/lib/timezone.ts`) — no dependency; compute the zone's offset at that instant with `Intl.DateTimeFormat`:

```ts
// Convert a naive `datetime-local` string ("YYYY-MM-DDTHH:mm", no offset) that
// represents wall-clock time in `timeZone` into the true UTC instant. The old
// code used `new Date(naive)` which silently parses in the SERVER timezone,
// publishing scheduled posts hours early (audit finding DATA-8).
export function zonedNaiveToUtc(naive: string, timeZone: string): Date {
  // Read the wall-clock digits as if they were UTC. This instant is wrong by
  // exactly the zone's offset, which we then measure and subtract out.
  const asIfUtc = new Date(`${naive}Z`);
  if (Number.isNaN(asIfUtc.getTime())) throw new Error(`Invalid datetime: ${naive}`);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(asIfUtc).map(x => [x.type, x.value]));
  const seenAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);

  // offset = (what the wall clock shows in timeZone for this instant) − (the instant itself)
  const offsetMs = seenAsUtc - asIfUtc.getTime();
  return new Date(asIfUtc.getTime() - offsetMs);
}
```

- [ ] **Step 4: Apply it in `scheduleWithTimeAction`** (`src/app/actions.ts`). Add the import: `import { zonedNaiveToUtc } from '@/lib/timezone';`. The current body (:556-588) validates and writes like this:

```ts
    if (!scheduledAt) throw new GateError('Scheduled time is required');
    if (new Date(scheduledAt) <= new Date()) throw new GateError('Scheduled time must be in the future');
    ...
    await adminDb.from('content_items')
      .update({
        scheduled_at: new Date(scheduledAt).toISOString(),
        timezone,
        platforms,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
```

Compute the UTC instant once from the submitted `timezone`, validate and store that:

```ts
    if (!scheduledAt) throw new GateError('Scheduled time is required');
    const scheduledUtc = zonedNaiveToUtc(scheduledAt, timezone);
    if (scheduledUtc <= new Date()) throw new GateError('Scheduled time must be in the future');

    const item = await contentRepo.get(id);
    if (!item || item.campaignId !== s.campaignId) throw new GateError('Content not found.');

    // Hard gate: enforces human approval, and disclosure-on-file for AI content.
    await lifecycle.schedule(id, s.userId);

    await throwOnError(
      adminDb.from('content_items')
        .update({
          scheduled_at: scheduledUtc.toISOString(),
          timezone,
          platforms,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id),
      'content_items.scheduleWithTime',
    );
```

(This keeps the existing ownership check and hard-gate call verbatim, applies DATA-7 to the previously-unchecked write, and swaps the timezone-naive conversion.)

- [ ] **Step 5: Run the test and full suite**

Run: `npx vitest run src/lib/timezone.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Note:** The publish cron (`src/app/api/cron/publish/route.ts`) and `getScheduledToday` (`src/lib/data.ts:322`) already compare against `scheduled_at` as a UTC `timestamptz`, so storing the correct UTC instant fixes them without further change. The `timezone` column is retained for display ("10:00 AM PT").

---

### Task 4: Atomic single-use invite claim (DATA-11)

**Files:**
- Modify: `src/app/actions.ts` (`joinAction` :61-138 — specifically the claim at :116-118, reordered before user creation)
- Test: `src/app/actions.join.test.ts` (new)

The bug: `joinAction` reads the invite, checks `invite.used_at` (:82), creates the user, then marks the invite used (:116). Two concurrent redemptions both read `used_at == null` and both succeed. Fix: claim atomically with a conditional update (`... where code=? and used_at is null`) and treat "no row returned" as already-claimed.

- [ ] **Step 1: Write the failing test** (`src/app/actions.join.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Real Next redirect() throws; model that so control flow stops at the redirect.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(async () => 'hashed'), compare: vi.fn() } }));
vi.mock('@/lib/session', () => ({ setSessionCookie: vi.fn(), requireSession: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(() => 'u-new'), uid: vi.fn(), inviteCode: vi.fn() }));

// adminDb builder harness: each `.from(table)` returns a chainable stub.
const usersInsert = vi.fn(async () => ({ error: null }));
const usersUpdateEq = vi.fn(async () => ({ error: null }));
const claimMaybeSingle = vi.fn(); // the atomic invite claim result
const inviteSelectSingle = vi.fn();
const existingMaybeSingle = vi.fn(async () => ({ data: null }));

function makeAdminDb() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'invite_codes') {
        return {
          // read: .select('*').eq('code', code).single()
          select: vi.fn(() => ({ eq: vi.fn(() => ({ single: inviteSelectSingle })) })),
          // atomic claim: .update({...}).eq('code', code).is('used_at', null).select().maybeSingle()
          update: vi.fn(() => ({ eq: vi.fn(() => ({ is: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle: claimMaybeSingle })) })) })) })),
        };
      }
      if (table === 'users') {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: existingMaybeSingle })) })),
          insert: usersInsert,
          update: vi.fn(() => ({ eq: usersUpdateEq })),
        };
      }
      if (table === 'audit_entries') return { insert: vi.fn(async () => ({ error: null })) };
      return {};
    }),
  };
}
vi.mock('@/lib/supabase', () => ({ adminDb: makeAdminDb(), throwOnError: async (q: any) => (await q).data }));

function joinForm() {
  const fd = new FormData();
  fd.set('code', 'inv_abc'); fd.set('name', 'New User');
  fd.set('email', 'new@example.com'); fd.set('password', 'password123');
  return fd;
}

describe('joinAction single-use invite claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inviteSelectSingle.mockResolvedValue({ data: { code: 'inv_abc', campaign_id: 'c-1', role: 'staff', used_at: null, expires_at: '2999-01-01T00:00:00Z' } });
    existingMaybeSingle.mockResolvedValue({ data: null });
  });

  it('redirects with error=used and never creates a user when the atomic claim returns no row', async () => {
    claimMaybeSingle.mockResolvedValue({ data: null }); // someone else already claimed it
    const { joinAction } = await import('./actions');
    await expect(joinAction(joinForm())).rejects.toThrow(/REDIRECT:.*error=used/);
    expect(usersInsert).not.toHaveBeenCalled();
    expect(usersUpdateEq).not.toHaveBeenCalled();
  });

  it('creates the user when the atomic claim wins the row', async () => {
    claimMaybeSingle.mockResolvedValue({ data: { code: 'inv_abc' } });
    const { joinAction } = await import('./actions');
    await expect(joinAction(joinForm())).rejects.toThrow(/REDIRECT:\/dashboard/);
    expect(usersInsert).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/actions.join.test.ts`
Expected: FAIL — current `joinAction` marks the invite used *after* creating the user with a plain `.update().eq('code', code)` (no `.is('used_at', null)` guard, no result check), so the "already claimed" case still inserts a user.

- [ ] **Step 3: Rewrite the claim in `joinAction`.** Keep the early reads/validations (:75-93) and password hashing (:95-96, using `prefixedId('u-')` from Task 2). Replace the create-then-mark ordering so the **claim happens first and gates everything**. Where the current code has the user create block (:98-114) followed by the invite update (:116-118), substitute:

```ts
  const password_hash = await bcrypt.default.hash(password, 10);
  const userId = existing?.id ?? prefixedId('u-');

  // Atomically claim the invite: only one concurrent redemption can flip
  // used_at from null. If no row comes back, someone else already claimed it
  // (audit finding DATA-11) — bail before creating any user.
  const { data: claimed } = await adminDb.from('invite_codes')
    .update({ used_by: userId, used_at: new Date().toISOString() })
    .eq('code', code)
    .is('used_at', null)
    .select()
    .maybeSingle();
  if (!claimed) redirect(`${base}&error=used`);

  if (existing) {
    await throwOnError(
      adminDb.from('users').update({
        name, password_hash, campaign_id: invite.campaign_id, role: invite.role,
      }).eq('id', existing.id),
      'users.join.update',
    );
  } else {
    await throwOnError(
      adminDb.from('users').insert({
        id: userId, campaign_id: invite.campaign_id, name, email, password_hash, role: invite.role,
      }),
      'users.join.insert',
    );
  }

  await throwOnError(
    adminDb.from('audit_entries').insert({
      campaign_id: invite.campaign_id, actor_user_id: userId,
      action: 'user_joined', entity_type: 'user', entity_id: userId,
      details: { via_invite: code },
    }),
    'audit_entries.join',
  );
```

The pre-claim `if (invite.used_at) redirect(...)` on :82 stays as a cheap fast-path; the atomic claim is the authoritative guard. (Import `prefixedId` and `throwOnError`; both added in earlier tasks.)

- [ ] **Step 4: Run the test and full suite**

Run: `npx vitest run src/app/actions.join.test.ts && npm test && npm run typecheck`
Expected: PASS.

---

### Task 5: Fail loudly on blocked deletes + set an `ON DELETE` policy (DATA-12)

**Files:**
- Modify: `src/lib/avatars.ts` (`deleteAvatarRow` :75-77)
- Modify: `src/app/admin/actions.ts` (`removeUserAction` :232-237)
- Create: `supabase/migrations/015_avatar_delete_policy.sql`
- Test: `src/lib/avatars.delete.test.ts` (new)

The bug: `deleteAvatarRow` and `removeUserAction` call `.delete().eq(...)` and ignore `{ error }`. When an FK blocks the delete (e.g. `candidate_profiles.active_avatar_id` → `avatars(id)` with no `ON DELETE`; `avatars.created_by`/`consent_confirmed_by` → `users(id)`), Supabase returns an error and the row survives, but the action reports success. A "removed" user still passes `getSession`.

- [ ] **Step 1: Write the failing test** (`src/lib/avatars.delete.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const del = vi.fn();
const eq = vi.fn(() => del());
vi.mock('./supabase', async () => {
  const actual = await vi.importActual<typeof import('./supabase')>('./supabase');
  return { ...actual, adminDb: { from: vi.fn(() => ({ delete: vi.fn(() => ({ eq })) })) } };
});

describe('deleteAvatarRow surfaces FK-blocked deletes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when Supabase reports a foreign-key violation', async () => {
    del.mockResolvedValueOnce({ data: null, error: { message: 'update or delete on table "avatars" violates foreign key constraint' } });
    const { deleteAvatarRow } = await import('./avatars');
    await expect(deleteAvatarRow('av-1')).rejects.toThrow(/foreign key/);
  });

  it('resolves when the delete succeeds', async () => {
    del.mockResolvedValueOnce({ data: null, error: null });
    const { deleteAvatarRow } = await import('./avatars');
    await expect(deleteAvatarRow('av-1')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/avatars.delete.test.ts`
Expected: FAIL — `deleteAvatarRow` ignores `{ error }` and resolves in both cases.

- [ ] **Step 3: Check the avatar delete** (`src/lib/avatars.ts:75-77`), using the Task 1 helper:

```ts
export async function deleteAvatarRow(id: string): Promise<void> {
  await throwOnError(
    adminDb.from('avatars').delete().eq('id', id),
    'avatars.delete',
  );
}
```

- [ ] **Step 4: Check the user delete** (`src/app/admin/actions.ts:232-237`). Import `throwOnError`. `removeUserAction` is a `void` action; surface the failure rather than silently no-op:

```ts
export async function removeUserAction(userId: string, campaignId: string) {
  await requireAdmin();
  // A user who authored an avatar (avatars.created_by / consent_confirmed_by →
  // users(id)) cannot be hard-deleted; surface that instead of a silent no-op
  // that leaves a "removed" user still able to log in (audit finding DATA-12).
  await throwOnError(
    adminDb.from('users').delete().eq('id', userId),
    'users.remove',
  );
  revalidatePath(`/admin/campaigns/${campaignId}`);
  revalidatePath('/admin/users');
}
```

Note in the PR that the admin "Remove user" control now errors visibly when a user has authored avatars; a future task may add soft-deactivation. This is intentional — silent success was the bug.

- [ ] **Step 5: Add the `ON DELETE` policy migration** (`supabase/migrations/015_avatar_delete_policy.sql`). Migration 009 left `candidate_profiles.active_avatar_id` with no `ON DELETE`, so deleting the active avatar is blocked at the DB even though `deleteAvatarAction` clears the profile pointer in code first. Add `ON DELETE SET NULL` as defense-in-depth (additive, reversible):

```sql
-- supabase/migrations/015_avatar_delete_policy.sql
-- DATA-12: candidate_profiles.active_avatar_id (added in 009_avatars.sql) had
-- no ON DELETE rule, so deleting an avatar that is still referenced fails at
-- the DB layer. deleteAvatarAction clears the pointer in code first, but SET
-- NULL is a safe backstop and makes the reference self-healing. The column is
-- nullable, so SET NULL is valid.
alter table candidate_profiles
  drop constraint if exists candidate_profiles_active_avatar_id_fkey;

alter table candidate_profiles
  add constraint candidate_profiles_active_avatar_id_fkey
  foreign key (active_avatar_id) references avatars(id) on delete set null;
```

Reverse (for the record; do not run): re-add the constraint without `on delete set null`.

- [ ] **Step 6: Verification query** (run against a scratch/staging DB, not prod):

```sql
-- Confirm the FK now carries ON DELETE SET NULL (expect confdeltype = 'n').
select conname, confdeltype
from pg_constraint
where conrelid = 'candidate_profiles'::regclass
  and conname = 'candidate_profiles_active_avatar_id_fkey';
```

Expected: one row, `confdeltype = 'n'` (SET NULL). The constraint name assumes Postgres's default (`<table>_<column>_fkey`); if 009 was applied with a different name, discover it first with `select conname from pg_constraint where conrelid='candidate_profiles'::regclass and confrelid='avatars'::regclass;` and use that in the `drop constraint`.

- [ ] **Step 7: Run the test and full suite**

Run: `npx vitest run src/lib/avatars.delete.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Note (scope):** `avatars.created_by`/`consent_confirmed_by` and other NOT-NULL author columns cannot take `ON DELETE SET NULL`. Deliberately not changing them here — see Task 9 for the referential-integrity policy decision on author columns. The DATA-12 fix is: deletes now fail loudly instead of pretending to succeed.

---

### Task 6: Validate `content_items.type` against the union + CHECK constraint (DATA-16)

**Files:**
- Modify: `src/domain/types.ts` (add after `VIDEO_CONTENT_TYPES` :11)
- Modify: `src/app/actions.ts` (`createContentAction` :153, `generateFromMonitoringAction` :404-456)
- Create: `supabase/migrations/016_content_type_check.sql`
- Test: `src/domain/types.test.ts` (new), extend the content-type guard into `src/app/actions.gate.test.ts` if present, else a small new test.

The bug: `content_items.type` is unconstrained `text` (migration 001:24). `generateFromMonitoringAction` persists a **client-supplied** `contentType` string verbatim (:449), and `createContentAction` casts `formData.get('type') as ContentType` (:153) without checking. Garbage types flow into the DB and into AI prompts.

- [ ] **Step 1: Write the failing test** (`src/domain/types.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { CONTENT_TYPES, isContentType } from './types';

describe('content type guard', () => {
  it('lists exactly the five known types', () => {
    expect([...CONTENT_TYPES].sort()).toEqual(
      ['ad_copy', 'press_release', 'reel', 'social_post', 'talking_points'].sort(),
    );
  });
  it('accepts a known type', () => {
    expect(isContentType('social_post')).toBe(true);
  });
  it('rejects an unknown type', () => {
    expect(isContentType('malicious_kind')).toBe(false);
    expect(isContentType('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/domain/types.test.ts`
Expected: FAIL — `CONTENT_TYPES`/`isContentType` are not exported.

- [ ] **Step 3: Add the runtime guard** to `src/domain/types.ts`. The current declaration is:

```ts
export type ContentType =
  | 'reel' | 'social_post' | 'press_release' | 'ad_copy' | 'talking_points';

export const VIDEO_CONTENT_TYPES: ContentType[] = ['reel'];
```

Add immediately after:

```ts
// Single source of truth for valid content types at runtime — used to reject
// client-supplied values before they hit the DB (audit finding DATA-16).
export const CONTENT_TYPES: readonly ContentType[] =
  ['reel', 'social_post', 'press_release', 'ad_copy', 'talking_points'] as const;

export function isContentType(value: string): value is ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Validate in the actions.** In `src/app/actions.ts`, import `isContentType` (extend the existing `@/domain/types` import on :11). 

`createContentAction` (:153) — replace the unchecked cast:

```ts
  const rawType = String(formData.get('type') ?? '');
  const type: ContentType = isContentType(rawType) ? rawType : 'social_post';
```

and use `type` in the insert instead of `(formData.get('type') as ContentType) || 'social_post'`.

`generateFromMonitoringAction` (:404, signature `contentType: string`) — reject an invalid type up front, right after `requireSession()`:

```ts
  if (!isContentType(contentType)) return { ok: false, error: 'Unknown content type.' };
```

so the later `type: contentType` insert (:449) is guaranteed valid.

- [ ] **Step 5: Add the CHECK-constraint migration** (`supabase/migrations/016_content_type_check.sql`). All seed rows use valid types, so the constraint is safe to add:

```sql
-- supabase/migrations/016_content_type_check.sql
-- DATA-16: content_items.type was unconstrained text. Constrain it to the
-- ContentType union so a bad client-supplied value can never persist.
alter table content_items
  add constraint content_items_type_check
  check (type in ('reel', 'social_post', 'press_release', 'ad_copy', 'talking_points'));
```

Reverse (do not run): `alter table content_items drop constraint content_items_type_check;`.

- [ ] **Step 6: Verification query** (scratch DB): confirm the constraint rejects a bad value.

```sql
-- Expect this to raise: new row ... violates check constraint "content_items_type_check"
insert into content_items (id, campaign_id, type, title, created_by)
values ('bad-1', 'camp-1', 'not_a_type', 'x', 'u-alex');
```

Expected: error raised; no row inserted. Clean up any valid test rows afterward.

- [ ] **Step 7: Run the tests and full suite**

Run: `npx vitest run src/domain/types.test.ts && npm test && npm run typecheck`
Expected: PASS.

---

### Task 7: Monitoring ingest — partial unique index + upsert-on-conflict (DATA-17)

**Files:**
- Modify: `src/app/api/monitoring/ingest/route.ts` (dedupe block :35-63)
- Create: `supabase/migrations/017_monitoring_dedupe.sql`
- Test: `src/app/api/monitoring/ingest/route.test.ts` (new)

The bug: dedupe is check-then-insert (`select ... maybeSingle()` then `insert`), with no unique index (:35-56). Two concurrent ingests for the same `(campaign_id, url)` both see "not existing" and both insert a duplicate.

- [ ] **Step 1: Write the failing test** (`src/app/api/monitoring/ingest/route.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsert = vi.fn(async () => ({ error: null, data: null }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ upsert })) },
}));
vi.mock('@/lib/credibility', () => ({
  scoreCredibility: vi.fn(() => 'medium'),
  categorizeSource: vi.fn(() => 'news'),
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'mr-1') }));

function req(body: unknown) {
  return new Request('http://x/api/monitoring/ingest', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;
}

describe('monitoring ingest dedupe via upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('upserts with ignoreDuplicates on the (campaign_id, url) conflict target', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ campaign_id: 'c-1', source: 'NewsData', excerpt: 'x', url: 'https://e.com/a' }));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    const [, opts] = upsert.mock.calls[0];
    expect(opts).toMatchObject({ onConflict: 'campaign_id,url', ignoreDuplicates: true });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/api/monitoring/ingest/route.test.ts`
Expected: FAIL — the route calls `.select().maybeSingle()` then `.insert()`, never `.upsert()`.

- [ ] **Step 3: Replace the dedupe block** in `src/app/api/monitoring/ingest/route.ts`. Current logic (:35-63) selects for an existing row, early-returns `skipped`, then inserts. Replace with a single upsert that ignores conflicts:

```ts
  // Dedup atomically on (campaign_id, url) — a partial unique index backs this
  // (migration 017). Concurrent ingests can't both insert the same URL any more
  // (audit finding DATA-17); the DB collapses the conflict and we skip.
  const { error: upsertError } = await adminDb
    .from('monitoring_results')
    .upsert(
      {
        id: uid(),
        campaign_id,
        source,
        opponent: opponent || null,
        excerpt: String(excerpt).substring(0, 1000),
        url,
        credibility: scoreCredibility(url),
        category: categorizeSource(url, source),
      },
      { onConflict: 'campaign_id,url', ignoreDuplicates: true },
    );

  if (upsertError) {
    console.error('[monitoring/ingest]', upsertError);
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
```

(Removes the now-redundant `select ... maybeSingle()` and the separate `insert`.)

- [ ] **Step 4: Add the migration** (`supabase/migrations/017_monitoring_dedupe.sql`). Existing rows may already contain duplicates (the old code let them through under races), so dedupe **before** creating the unique index or it will fail:

```sql
-- supabase/migrations/017_monitoring_dedupe.sql
-- DATA-17: enforce single-row-per-(campaign_id, url) so ingest can upsert
-- on-conflict instead of racing a check-then-insert.

-- 1. Collapse any pre-existing duplicates, keeping the earliest captured row.
delete from monitoring_results a
using monitoring_results b
where a.campaign_id = b.campaign_id
  and a.url = b.url
  and a.captured_at > b.captured_at;

-- 2. Unique index that upsert's onConflict target references.
create unique index if not exists monitoring_results_campaign_url_uniq
  on monitoring_results (campaign_id, url);
```

Reverse (do not run): `drop index if exists monitoring_results_campaign_url_uniq;` (the dedupe delete is not reversible — note that in the PR).

- [ ] **Step 5: Verification query** (scratch DB): after applying, a second insert of the same `(campaign_id, url)` via the route returns `ok` without adding a row.

```sql
select campaign_id, url, count(*)
from monitoring_results
group by campaign_id, url
having count(*) > 1;
```

Expected: zero rows.

- [ ] **Step 6: Run the test and full suite**

Run: `npx vitest run src/app/api/monitoring/ingest/route.test.ts && npm test && npm run typecheck`
Expected: PASS.

---

### Task 8: Remove the unenforced blackout-days surface (DATA-13)

**Recommendation & decision:** `blackout_days_before_election` is stored (migration 001:74), admin-editable (`updateDisclosureRuleAction` :244-251, and the form field at `admin/disclosure-rules/page.tsx:63-71`), mapped through the domain (`repos.ts:34`, `disclosure.ts` type), and **never enforced** anywhere — `DisclosureEngine.requiredFor` (`src/domain/disclosure.ts:33`) never reads it. Enforcing it correctly requires a per-campaign **election date**, which the schema does not have (no election-date column on `campaigns` or `candidate_profiles`). 

**Decision: REMOVE the surface, keep the column.** Stop presenting and writing `blackout_days_before_election` so the product no longer advertises a compliance gate that does not exist, but **retain the DB column** (dropping it would be a destructive, non-reversible migration for no benefit). Re-introduce enforcement in a future task once a per-campaign election date exists. This is the least-risk, reversible choice.

**Files:**
- Modify: `src/app/admin/actions.ts` (`updateDisclosureRuleAction` :239-256 — stop reading/writing `blackoutDays`)
- Modify: `src/app/admin/disclosure-rules/page.tsx` (remove the field :62-72)
- Test: `src/app/admin/actions.disclosure.test.ts` (new)

- [ ] **Step 1: Write the failing test** (`src/app/admin/actions.disclosure.test.ts`) — assert the update no longer includes `blackout_days_before_election`.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(async () => ({ userId: 'u-admin' })) }));
vi.mock('@/lib/stripe', () => ({ stripe: null }));

const updateEq = vi.fn(async () => ({ error: null }));
const update = vi.fn(() => ({ eq: updateEq }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update })) }, throwOnError: async (q: any) => (await q).data }));

function form() {
  const fd = new FormData();
  fd.set('jurisdiction', 'US-CA');
  fd.set('requiredText', 'AI notice');
  fd.set('placement', 'overlay');
  fd.set('blackoutDays', '60'); // still posted by a stale client — must be ignored
  fd.set('requiresAiLabel', 'on');
  return fd;
}

describe('updateDisclosureRuleAction no longer touches blackout days', () => {
  beforeEach(() => vi.clearAllMocks());

  it('omits blackout_days_before_election from the update payload', async () => {
    const { updateDisclosureRuleAction } = await import('./actions');
    await updateDisclosureRuleAction(form());
    const payload = update.mock.calls[0][0];
    expect(payload).not.toHaveProperty('blackout_days_before_election');
    expect(payload).toMatchObject({ required_text: 'AI notice', placement: 'overlay' });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/admin/actions.disclosure.test.ts`
Expected: FAIL — the current payload includes `blackout_days_before_election: blackoutDays`.

- [ ] **Step 3: Edit `updateDisclosureRuleAction`** (`src/app/admin/actions.ts:239-256`). Remove the `blackoutDays` read (:244-245) and the `blackout_days_before_election` key (:251). Route the write through `throwOnError` (DATA-7):

```ts
export async function updateDisclosureRuleAction(formData: FormData) {
  await requireAdmin();
  const jurisdiction = String(formData.get('jurisdiction'));
  const requiredText = String(formData.get('requiredText') ?? '').trim() || null;
  const placement = String(formData.get('placement') ?? 'overlay');

  // blackout_days_before_election is intentionally NOT written here: it was
  // never enforced anywhere and enforcement needs a per-campaign election date
  // the schema lacks (audit finding DATA-13). Column retained for future use.
  await throwOnError(
    adminDb.from('disclosure_rules').update({
      requires_ai_label: formData.get('requiresAiLabel') === 'on',
      required_text: requiredText,
      placement,
      needs_legal_review: formData.get('needsLegalReview') === 'on',
    }).eq('jurisdiction', jurisdiction),
    'disclosure_rules.update',
  );

  revalidatePath('/admin/disclosure-rules');
}
```

- [ ] **Step 4: Remove the form field** from `src/app/admin/disclosure-rules/page.tsx`. Delete the `<div>` block at :62-72 (label "Blackout days before election" + its `<input name="blackoutDays">`). The parent grid on :52 is `gridTemplateColumns: '1fr 1fr 1fr'`; after removing one of the three cells, change it to `'1fr 1fr'` so Placement and the checkbox column stay balanced.

- [ ] **Step 5: Run the test and full suite**

Run: `npx vitest run src/app/admin/actions.disclosure.test.ts && npm test && npm run typecheck`
Expected: PASS. The `DisclosureRule.blackoutDaysBeforeElection` type field and its mappers (`repos.ts:34`, `data.ts`) stay — the column still exists and is read for display elsewhere; only the editable/advertised surface is removed. No migration.

---

### Task 9: Referential-integrity FKs + model `campaignId: string | null` (DATA-18)

**Files:**
- Create: `supabase/migrations/018_referential_integrity.sql`
- Modify: `src/lib/session.ts` (`Session` interface :6-12)
- Modify: `src/lib/data.ts` (`User` interface :16)
- Modify: `src/app/actions.ts` (add a `tenantId(s)` guard; apply to tenant-scoped actions)
- Test: `src/app/actions.tenant.test.ts` (new)

Three distinct gaps (audit DATA-18):
1. `billing_events.campaign_id` references `campaigns(id)` with **no `ON DELETE`** (migration 010:36) while every sibling table cascades — so a campaign delete is blocked by leftover billing events.
2. Author columns are unconstrained `text` with no FK (`audit_entries.actor_user_id` :61, `content_items.created_by` :32, `approval_records.approver_user_id` :41, `invite_codes.created_by`).
3. `super_admin` has `campaign_id = NULL` (migration 002:43) but `Session.campaignId` and `data.ts`'s `User.campaignId` are typed non-null `string` — a lie that hides the null from the type system.

- [ ] **Step 1: Add the migration** (`supabase/migrations/018_referential_integrity.sql`). For `billing_events`, switch to `ON DELETE SET NULL` (the column is already nullable). For author columns, add FKs **only where the column is nullable** so they can `SET NULL` — adding a blocking FK to a NOT-NULL author column (`content_items.created_by`, `approval_records.approver_user_id`, `invite_codes.created_by`) would re-introduce the DATA-12 delete-block problem, so those are deliberately left as text (documented below).

```sql
-- supabase/migrations/018_referential_integrity.sql
-- DATA-18: close referential-integrity gaps without re-introducing the
-- DATA-12 delete-block problem.

-- 1. billing_events blocked campaign deletes (no ON DELETE, unlike siblings
--    which cascade). The column is nullable, so SET NULL is safe and keeps the
--    payload for post-mortem after a campaign is removed.
alter table billing_events
  drop constraint if exists billing_events_campaign_id_fkey;
alter table billing_events
  add constraint billing_events_campaign_id_fkey
  foreign key (campaign_id) references campaigns(id) on delete set null;

-- 2. audit_entries.actor_user_id is nullable — add a real FK with ON DELETE SET
--    NULL so the author reference is validated but never blocks a user delete.
alter table audit_entries
  add constraint audit_entries_actor_user_id_fkey
  foreign key (actor_user_id) references users(id) on delete set null;

-- NOTE: content_items.created_by, approval_records.approver_user_id, and
-- invite_codes.created_by are NOT NULL. A blocking FK there would re-create the
-- silent-delete-block this audit is fixing (DATA-12), and SET NULL is
-- impossible on a NOT-NULL column. They are intentionally left as text; treat
-- them as historical author snapshots, not live FKs.
```

Reverse (do not run): restore `billing_events` FK without `on delete set null`; `drop constraint audit_entries_actor_user_id_fkey`.

- [ ] **Step 2: Verification query** (scratch DB):

```sql
select conname, confdeltype from pg_constraint
where conname in ('billing_events_campaign_id_fkey', 'audit_entries_actor_user_id_fkey');
```

Expected: both rows show `confdeltype = 'n'` (SET NULL). If `audit_entries` already contains an `actor_user_id` that has no matching `users` row (possible from `'system'` placeholders), the `add constraint` will fail — first run `select distinct actor_user_id from audit_entries ae where actor_user_id is not null and not exists (select 1 from users u where u.id = ae.actor_user_id);` and null those rows (`update audit_entries set actor_user_id = null where ...`) before adding the FK. Document this data-cleanup step in the PR.

- [ ] **Step 3: Write the failing test** (`src/app/actions.tenant.test.ts`) — a `super_admin` session (null `campaignId`) must be rejected by tenant-scoped actions rather than silently querying `campaign_id = null`.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session: any = { userId: 'u-admin', name: 'Super Admin', role: 'super_admin', campaignId: null, exp: 9_999_999_999 };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn() }, throwOnError: vi.fn() }));
vi.mock('@/lib/store', () => ({ uid: vi.fn(), prefixedId: vi.fn(), inviteCode: vi.fn() }));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: {} }));
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, usageMeter: {}, billingGate: {},
  contentGenerator: {}, publisher: {}, videoProvider: {}, voiceProvider: {}, photoAvatarProvider: {},
}));

describe('tenant actions reject a session with no campaign', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dismissMonitoringAction fails for a super_admin (null campaignId)', async () => {
    const { dismissMonitoringAction } = await import('./actions');
    const r = await dismissMonitoringAction('mr-1');
    expect(r).toEqual({ ok: false, error: 'No campaign in session.' });
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx vitest run src/app/actions.tenant.test.ts`
Expected: FAIL — `dismissMonitoringAction` currently queries `.eq('campaign_id', s.campaignId)` with `null` and returns `{ ok: true }`.

- [ ] **Step 5: Model the null.** In `src/lib/session.ts`, change the `Session` interface:

```ts
export interface Session {
  userId: string;
  name: string;
  role: Role;
  campaignId: string | null;   // null for super_admin (no tenant)
  exp: number;
}
```

In `src/lib/data.ts` (:16) change the `User` interface field to `campaignId: string | null;` (the row's `campaign_id` is nullable for `super_admin`).

- [ ] **Step 6: Add the `tenantId` guard** near the top of `src/app/actions.ts` (after `guard`, ~:25):

```ts
// super_admin sessions carry no campaign (campaignId === null). Tenant-scoped
// actions must refuse rather than silently query `campaign_id = null`
// (audit finding DATA-18).
function tenantId(s: { campaignId: string | null }): string | null {
  return s.campaignId ?? null;
}
```

Then in each tenant-scoped action that reads `s.campaignId`, add an early guard. The minimal, correctness-critical set: `dismissMonitoringAction`, `createContentAction`, `generateDraftAction`, `generateVideoAction`, `synthesizeVoiceAction`, `generateFromMonitoringAction`, `createAvatarAction`, `scheduleWithTimeAction`, and the ownership-checked lifecycle actions. Pattern (shown for `dismissMonitoringAction` :499-508):

```ts
export async function dismissMonitoringAction(id: string): Promise<Result> {
  const s = await requireSession();
  const campaignId = tenantId(s);
  if (!campaignId) return { ok: false, error: 'No campaign in session.' };
  return guard(async () => {
    await adminDb.from('monitoring_results')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('campaign_id', campaignId);
    revalidatePath('/monitoring');
  });
}
```

For actions that already do `const campaign = await getCampaign(s.campaignId)` and bail on `!campaign`, the null case is effectively covered (a null id returns no campaign) — but add the explicit `tenantId` guard anyway for a clear error message and to satisfy the now-nullable type.

- [ ] **Step 7: Resolve typecheck fallout.** Making `Session.campaignId` nullable will surface `tsc` errors everywhere `s.campaignId` is passed to a `string` parameter (server components, other actions, `admin/actions.ts` uses `requireAdmin` not `requireSession` so it is unaffected). For each error, route the value through the local guard (`const campaignId = tenantId(s); if (!campaignId) ...`) or, in read-only server components that are already admin-gated, assert non-null with a comment. Run `npm run typecheck` and fix until clean; the compiler enumerates every site — do not suppress with `!` blindly except where a route is provably non-super_admin.

- [ ] **Step 8: Run the test and full suite**

Run: `npx vitest run src/app/actions.tenant.test.ts && npm test && npm run typecheck`
Expected: PASS, typecheck clean. Existing tests use a non-null `campaignId: 'c-1'` session, so they are unaffected.

- [ ] **Note (scope):** This models and guards the null at the type + action layer. Enabling RLS as a deeper backstop is **SEC-7**, out of scope here.

---

## Self-review checklist (run before handing off)

- [ ] Every DATA finding maps to a task:
  - **DATA-7** → Task 1 (`throwOnError` + wrapped repo/avatar/action mutations)
  - **DATA-8** → Task 3 (`zonedNaiveToUtc` in `scheduleWithTimeAction`)
  - **DATA-11** → Task 4 (atomic invite claim `where code=? and used_at is null`)
  - **DATA-12** → Task 5 (checked deletes + `candidate_profiles.active_avatar_id ON DELETE SET NULL`)
  - **DATA-13** → Task 8 (blackout-days surface removed; column retained; recommendation = remove-until-election-date, stated)
  - **DATA-14** → Task 2 (`randomUUID`/`randomBytes` ids + checked inserts)
  - **DATA-16** → Task 6 (`isContentType` guard + `content_items_type_check`)
  - **DATA-17** → Task 7 (partial unique index + `upsert … ignoreDuplicates`)
  - **DATA-18** → Task 9 (`billing_events`/`audit_entries` FKs + `campaignId: string | null` model + `tenantId` guard)
- [ ] No mutation ignores `{ error }`: `grep -rnE "await adminDb\.(from|storage)" src | grep -vE "throwOnError|\.select\(|getPublicUrl|const \{ (data|error)" ` returns nothing surprising (spot-check each hit is a checked write or a read).
- [ ] No path writes `status:'scheduled'` outside `lifecycle.schedule`: `grep -rn "status: 'scheduled'" src` returns nothing (P0 invariant preserved).
- [ ] `throwOnError` is defined once (Task 1) and imported everywhere else — no duplicate definitions.
- [ ] All new migrations are additive; each has a stated (un-run) reverse, and the two with irreversible data steps (017 dedupe delete, 018 orphan cleanup) are called out for the PR.
- [ ] Coordinated with the P0 plan: `saveBodyAction`, `publishAction`, cron publish, `confirmDisclosureAction`, `approveTextAction`, `confirmVideoAction` keep their P0 inline error checks; DATA tasks did not re-wrap or contradict them.
- [ ] `npm test && npm run typecheck` green after every task.
- [ ] No git commits made (user commits).
