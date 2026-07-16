# P0 Launch-Blocker Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This plan is TDD: write the failing test, watch it fail, implement, watch it pass.

**Goal:** Close all 7 launch-blocking (P0) findings from the 2026-07-15 audit, plus the two P1 issues (SEC-11, DATA-3) that are inseparable from fully closing the approval-gate bypass (DATA-2).

**Architecture:** Most P0s are bounded edits to existing server actions, two cron routes, one page, one config file, and the migration set. The single largest structural change is introducing a shared campaign-ownership guard used by every content server action. No new dependencies.

**Tech Stack:** Next.js 14 App Router, Supabase (`adminDb` service-role client), Vitest. Server actions return `type Result = { ok: true } | { ok: false; error: string }`.

## Global Constraints

- **No autonomous git commits** — the user reviews and commits (per project memory).
- Server actions must not leak cross-tenant existence: on an ownership mismatch, return the same `{ ok: false, error: 'Content not found.' }` used for a missing item (do not distinguish "exists but not yours").
- `contentRepo.get(id)` returns a `ContentItem` with a camelCase `campaignId` field (or `null`).
- The scheduling **hard gate** lives in `ContentLifecycle.schedule` (src/domain/content-lifecycle.ts:50). All paths to `status='scheduled'` MUST go through it — never a raw `adminDb.update({ status: 'scheduled' })`.
- Tests mock `next/cache`, `next/navigation`, `@/lib/session`, `@/lib/data`, `@/lib/supabase`, `@/lib/repos`, `@/lib/services` — mirror the scaffolding in `src/app/actions.avatar-billing.test.ts`.
- Cron auth must fail closed when its secret env var is unset.

## Phase mapping

- **Phase 1 (tenant isolation + gate):** Task 1 (SEC-1/2/3/6/11), Task 2 (DATA-2/DATA-3).
- **Phase 2 (pipelines real):** Task 3 (SEC-4), Task 4 (INT-1), Task 5 (INT-2).
- **Data hygiene:** Task 6 (DATA-4) — includes a production remediation step, since the known credentials already exist in the live DB.

---

### Task 1: Campaign-ownership guard + content-action hardening (SEC-1, SEC-2, SEC-3, SEC-6, SEC-11)

**Files:**
- Modify: `src/app/actions.ts` (add helper; harden saveBodyAction, submitAction, decideAction, attachDisclosureAction, scheduleAction, publishAction, approveTextAction, confirmVideoAction, generateFromMonitoringAction)
- Modify: `src/app/content/[id]/page.tsx:19`
- Test: `src/app/actions.ownership.test.ts` (new)

**Interfaces:**
- Produces: `async function requireOwnedItem(id: string, campaignId: string): Promise<ContentItem | null>` — returns the item only if `item.campaignId === campaignId`, else `null`. Used by Task 2 as well.

- [ ] **Step 1: Write the failing test** (`src/app/actions.ownership.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve({ id: 'c-1', jurisdictions: [], monthlyCostCapCents: 100_00 })) }));

const updateEq = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq: updateEq }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update, select: vi.fn(), insert: vi.fn() })) } }));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'new-1') }));

const get = vi.fn();
vi.mock('@/lib/repos', () => ({
  contentRepo: { get }, approvalRepo: { add: vi.fn() },
  disclosureRepo: { add: vi.fn(), listFor: vi.fn(() => []) }, auditRepo: { append: vi.fn() },
}));
const lifecycle = { submitForReview: vi.fn(), approve: vi.fn(), reject: vi.fn(), schedule: vi.fn(), markPublished: vi.fn() };
vi.mock('@/lib/services', () => ({
  lifecycle, disclosureEngine: { requiredFor: vi.fn(() => []) },
  usageMeter: { guard: vi.fn(), record: vi.fn() }, billingGate: { check: vi.fn() },
  contentGenerator: {}, publisher: { publish: vi.fn(() => []) }, videoProvider: {}, voiceProvider: {}, photoAvatarProvider: {},
}));

const FOREIGN = { id: 'x', campaignId: 'c-2', status: 'draft', type: 'social_post', isAiGenerated: false, body: 'b', title: 't', targetJurisdictions: [] };

describe('content actions enforce campaign ownership', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('saveBodyAction refuses an item from another campaign', async () => {
    get.mockResolvedValue(FOREIGN);
    const { saveBodyAction } = await import('./actions');
    const r = await saveBodyAction('x', 'hacked');
    expect(r).toEqual({ ok: false, error: 'Content not found.' });
    expect(update).not.toHaveBeenCalled();
  });

  it('submitAction refuses an item from another campaign', async () => {
    get.mockResolvedValue(FOREIGN);
    const { submitAction } = await import('./actions');
    const r = await submitAction('x');
    expect(r).toEqual({ ok: false, error: 'Content not found.' });
    expect(lifecycle.submitForReview).not.toHaveBeenCalled();
  });

  it('decideAction denies approve for a role without permission', async () => {
    get.mockResolvedValue({ ...FOREIGN, campaignId: 'c-1' });
    const staff = { ...session, role: 'staff' as const };
    const sessionMod = await import('@/lib/session');
    (sessionMod.requireSession as any).mockResolvedValueOnce(staff);
    const { decideAction } = await import('./actions');
    const r = await decideAction('x', 'approve', '');
    expect(r).toEqual({ ok: false, error: 'Permission denied.' });
    expect(lifecycle.approve).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/actions.ownership.test.ts`
Expected: FAIL — `saveBodyAction` still updates, `decideAction` still calls approve.

- [ ] **Step 3: Add the ownership helper** near the top of `src/app/actions.ts` (after the `guard` helper, ~line 25). Add `ContentItem` to the type import from `@/domain/types` if not present.

```ts
async function requireOwnedItem(id: string, campaignId: string) {
  const item = await contentRepo.get(id);
  if (!item || item.campaignId !== campaignId) return null;
  return item;
}

const NOT_FOUND = { ok: false as const, error: 'Content not found.' };
```

- [ ] **Step 4: Harden `saveBodyAction`** (SEC-1) — replace the body (actions.ts:342-349):

```ts
export async function saveBodyAction(id: string, body: string): Promise<Result> {
  const s = await requireSession();
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return NOT_FOUND;
  // Editing after approval would let unapproved text reach publish — only allow pre-approval states.
  if (!['draft', 'in_review', 'rejected'].includes(item.status)) {
    return { ok: false, error: 'This content can no longer be edited. Move it back to draft first.' };
  }
  const { error } = await adminDb.from('content_items')
    .update({ body, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: 'Save failed.' };
  revalidatePath(`/content/${id}`);
  return { ok: true };
}
```

- [ ] **Step 5: Add ownership to `submitAction`, `decideAction`, `scheduleAction`** (SEC-2) and the approve-permission check to `decideAction` (SEC-11):

```ts
export async function submitAction(id: string): Promise<Result> {
  const s = await requireSession();
  if (!(await requireOwnedItem(id, s.campaignId))) return NOT_FOUND;
  const r = await guard(() => lifecycle.submitForReview(id, s.userId));
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  return r;
}

export async function decideAction(id: string, decision: 'approve' | 'reject', note: string): Promise<Result> {
  const s = await requireSession();
  if (decision === 'approve' && !can(s.role, 'approve')) return { ok: false, error: 'Permission denied.' };
  if (!(await requireOwnedItem(id, s.campaignId))) return NOT_FOUND;
  const r = await guard(() =>
    decision === 'approve'
      ? lifecycle.approve(id, s.userId, note)
      : lifecycle.reject(id, s.userId, note));
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  return r;
}

export async function scheduleAction(id: string): Promise<Result> {
  const s = await requireSession();
  if (!can(s.role, 'schedule')) return { ok: false, error: 'Permission denied.' };
  if (!(await requireOwnedItem(id, s.campaignId))) return NOT_FOUND;
  const r = await guard(() => lifecycle.schedule(id, s.userId));
  revalidatePath(`/content/${id}`); revalidatePath('/');
  return r;
}
```

- [ ] **Step 6: Add ownership to the actions that already fetch the item** (SEC-2). In `attachDisclosureAction` (actions.ts:210), `publishAction` (234), `approveTextAction` (354), `confirmVideoAction` (387), replace the existing `const item = await contentRepo.get(id); if (!item) return { ok: false, error: 'Content not found.' };` with:

```ts
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return NOT_FOUND;
```

(For `attachDisclosureAction`, which references `s.campaignId` when adding disclosures, this is now guaranteed to match `item.campaignId`.)

- [ ] **Step 7: Scope `generateFromMonitoringAction`** (SEC-6) — actions.ts:416-420, add the campaign filter:

```ts
  const { data: result } = await adminDb
    .from('monitoring_results')
    .select('*')
    .eq('id', monitoringResultId)
    .eq('campaign_id', s.campaignId)
    .single();
```

- [ ] **Step 8: Scope the content detail page** (SEC-3) — `src/app/content/[id]/page.tsx:19`, change the guard:

```ts
  if (!item || item.campaignId !== s.campaignId) notFound();
```

- [ ] **Step 9: Run the test and the full suite**

Run: `npx vitest run src/app/actions.ownership.test.ts && npm test && npm run typecheck`
Expected: new test PASSES, all 96 existing tests still pass, typecheck clean.

### Task 2: Close the scheduling hard-gate bypass (DATA-2, DATA-3)

**Files:**
- Modify: `src/app/actions.ts` (confirmDisclosureAction, approveTextAction, confirmVideoAction)
- Test: `src/app/actions.gate.test.ts` (new)

**Interfaces:**
- Consumes: `requireOwnedItem` and `NOT_FOUND` from Task 1; `lifecycle.schedule` (throws `GateError` when approval/disclosure missing); `guard()`.

- [ ] **Step 1: Write the failing test** (`src/app/actions.gate.test.ts`) — reuse Task 1's mock block, then:

```ts
describe('scheduling hard gate cannot be bypassed', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('confirmDisclosureAction routes through lifecycle.schedule (never a raw scheduled write)', async () => {
    get.mockResolvedValue({ id: 'x', campaignId: 'c-1', status: 'approved', type: 'social_post', isAiGenerated: true, body: 'b', title: 't', targetJurisdictions: ['US-CA'] });
    const { confirmDisclosureAction } = await import('./actions');
    await confirmDisclosureAction('x');
    expect(lifecycle.schedule).toHaveBeenCalledWith('x', 'u-1');
    // no raw status:'scheduled' update
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'scheduled' }));
  });

  it('confirmDisclosureAction surfaces the gate error when approval is missing', async () => {
    const { GateError } = await import('@/domain/content-lifecycle');
    lifecycle.schedule.mockRejectedValueOnce(new GateError('Can’t schedule: no human approval on record.'));
    get.mockResolvedValue({ id: 'x', campaignId: 'c-1', status: 'approved', type: 'social_post', isAiGenerated: true, body: 'b', title: 't', targetJurisdictions: ['US-CA'] });
    const { confirmDisclosureAction } = await import('./actions');
    const r = await confirmDisclosureAction('x');
    expect(r.ok).toBe(false);
  });

  it('approveTextAction never writes status=scheduled directly', async () => {
    get.mockResolvedValue({ id: 'x', campaignId: 'c-1', status: 'in_review', type: 'social_post', isAiGenerated: false, body: 'b', title: 't', targetJurisdictions: [] });
    const { approveTextAction } = await import('./actions');
    await approveTextAction('x');
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'scheduled' }));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/actions.gate.test.ts`
Expected: FAIL — confirmDisclosureAction still does a raw `status:'scheduled'` update and never calls `lifecycle.schedule`.

- [ ] **Step 3: Rewrite `confirmDisclosureAction`** (DATA-2) — actions.ts:474-497:

```ts
export async function confirmDisclosureAction(id: string): Promise<Result> {
  const s = await requireSession();
  if (!can(s.role, 'schedule')) return { ok: false, error: 'Permission denied.' };
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return NOT_FOUND;
  const required = await disclosureEngine.requiredFor(item.targetJurisdictions, item.isAiGenerated);
  for (const req of required) {
    await disclosureRepo.add({
      contentItemId: id, campaignId: s.campaignId,
      jurisdiction: req.jurisdiction, disclosureText: req.disclosureText, placement: req.placement,
    });
  }
  // Route through the hard gate — enforces approval-on-record + disclosure-for-AI + valid transition.
  const r = await guard(() => lifecycle.schedule(id, s.userId));
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  return r;
}
```

- [ ] **Step 4: Fix `approveTextAction` and `confirmVideoAction`** (DATA-3) so they never fabricate a `scheduled` status. They should only move content to `approved` (via the lifecycle) or `in_review`; scheduling always goes through `confirmDisclosureAction`/`scheduleAction`. Replace the status branching in `approveTextAction` (actions.ts:364-379):

```ts
  // Approve via the lifecycle so a valid transition + approval record are enforced.
  await guard(() => lifecycle.approve(id, s.userId));
  // Video types still need the video step; everything else is now 'approved' and
  // proceeds to disclosure/schedule through the normal gated actions.
  if (VIDEO_CONTENT_TYPES.includes(item.type)) {
    const { error } = await adminDb.from('content_items')
      .update({ status: 'in_review', updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return { ok: false, error: 'Update failed.' };
  }
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  return { ok: true };
```

Remove the now-unused `nextStatus`/raw `approvalRepo.add` block above it (the lifecycle records the approval). For `confirmVideoAction` (actions.ts:389-392), persist only the media URL and keep status in an approved/in_review state — never `scheduled`:

```ts
  const { error } = await adminDb.from('content_items')
    .update({ media_url: videoUrl, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: 'Update failed.' };
  await guard(() => lifecycle.approve(id, s.userId));
```

- [ ] **Step 5: Run the test and the full suite**

Run: `npx vitest run src/app/actions.gate.test.ts && npm test && npm run typecheck`
Expected: PASS. If any existing wizard test asserted the old direct-to-scheduled behavior, update it to expect the gated path (that behavior was the bug).

### Task 3: Fail closed on missing cron secret (SEC-4)

**Files:**
- Modify: `src/app/api/cron/publish/route.ts:9`, `src/app/api/cron/billing-sync/route.ts:9`
- Modify: `.env.example` (add `CRON_SECRET`)
- Test: `src/app/api/cron/publish/route.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn() } }));
vi.mock('@/lib/services', () => ({ publisher: { publish: vi.fn() } }));
vi.mock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));

describe('cron publish auth', () => {
  it('rejects when CRON_SECRET is unset even with Bearer undefined', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import('./route');
    const res = await GET(new Request('http://x', { headers: { authorization: 'Bearer undefined' } }) as any);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/api/cron/publish/route.test.ts`
Expected: FAIL — currently returns 200-path because `Bearer undefined` matches.

- [ ] **Step 3: Add the fail-closed guard** at the top of both routes' `GET`, before the comparison:

```ts
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
```

- [ ] **Step 4: Add `CRON_SECRET` to `.env.example`** under an auth section:

```
# ── Cron auth — REQUIRED in production. Vercel injects this on cron requests. ─
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CRON_SECRET=
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/app/api/cron/publish/route.test.ts`
Expected: PASS.

### Task 4: Register crons in vercel.json (INT-1)

**Files:**
- Create: `vercel.json`
- Delete: `vercel.ts`

**Note:** Vercel reads cron schedules from `vercel.json` only. There is no test harness for platform config; verification is by inspection + a deploy check.

- [ ] **Step 1: Create `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/cron/publish", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/billing-sync", "schedule": "0 * * * *" }
  ]
}
```

- [ ] **Step 2: Delete `vercel.ts`**

Run: `git rm vercel.ts` (or delete the file). Confirm nothing imports it: `grep -rn "vercel.ts\|from '@/vercel'" src` returns nothing.

- [ ] **Step 3: Verify build still succeeds**

Run: `npm run build` (in an environment with Google Fonts egress, or after TEST-BUILD-1 is fixed).
Expected: build completes; Vercel will list both crons on the next deploy's Cron Jobs tab (confirm post-deploy).

### Task 5: Publish only on success; never mark published on failure (INT-2)

**Files:**
- Modify: `src/app/actions.ts` (publishAction, ~231-247)
- Modify: `src/app/api/cron/publish/route.ts` (~27-50)
- Test: `src/app/actions.publish.test.ts` (new)

**Interfaces:**
- Consumes: `publisher.publish(...)` returns `{ platform: Platform; status: 'scheduled' | 'failed'; error?: string }[]`.

- [ ] **Step 1: Write the failing test**

```ts
// reuse Task 1 mock block; set publisher.publish per test
describe('publishAction does not mark published when every platform fails', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns an error and does not call markPublished on all-failure', async () => {
    get.mockResolvedValue({ id: 'x', campaignId: 'c-1', status: 'scheduled', type: 'social_post', isAiGenerated: false, body: 'b', title: 't', targetJurisdictions: [], mediaUrl: null });
    (await import('@/lib/services')).publisher.publish = vi.fn(async () => [{ platform: 'x', status: 'failed', error: 'account unlinked' }]);
    const { publishAction } = await import('./actions');
    const r = await publishAction('x', ['x'] as any);
    expect(r.ok).toBe(false);
    expect(lifecycle.markPublished).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/actions.publish.test.ts`
Expected: FAIL — current code marks published before publishing and ignores results.

- [ ] **Step 3: Rewrite `publishAction`** (actions.ts:231-247) — publish first, inspect results, mark published only if at least one platform succeeded:

```ts
export async function publishAction(id: string, platforms: Platform[]): Promise<Result> {
  const s = await requireSession();
  if (!can(s.role, 'publish')) return { ok: false, error: 'Permission denied.' };
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return NOT_FOUND;
  const disc = await disclosureRepo.listFor(id);
  const results = await publisher.publish({
    platforms, text: item.body,
    disclosureText: combineDisclosureText(disc),
    mediaUrl: item.mediaUrl ?? undefined,
  });
  const failed = results.filter(r => r.status === 'failed');
  if (failed.length === results.length) {
    return { ok: false, error: `Publishing failed: ${failed.map(f => `${f.platform} (${f.error ?? 'unknown'})`).join(', ')}` };
  }
  const r = await guard(() => lifecycle.markPublished(id, s.userId));
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  if (failed.length) return { ok: false, error: `Published, but failed on: ${failed.map(f => f.platform).join(', ')}` };
  return r;
}
```

- [ ] **Step 4: Fix the cron publish route** (`src/app/api/cron/publish/route.ts:27-50`) — inspect results, only mark published on success, record failures:

```ts
    try {
      const disclosures = await disclosureRepo.listFor(item.id);
      const results = await publisher.publish({
        platforms: (item.platforms ?? []) as Platform[],
        text: item.body,
        disclosureText: combineDisclosureText(disclosures),
        mediaUrl: item.media_url ?? undefined,
      });
      const failed = results.filter(r => r.status === 'failed');
      if (failed.length === results.length) {
        await adminDb.from('content_items')
          .update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', item.id);
        await adminDb.from('audit_entries').insert({
          campaign_id: item.campaign_id, action: 'cron_publish_failed',
          entity_type: 'content_item', entity_id: item.id,
          details: { errors: failed.map(f => ({ platform: f.platform, error: f.error })) },
        });
        results_out.push({ id: item.id, ok: false, error: 'all platforms failed' });
        continue;
      }
      await adminDb.from('content_items')
        .update({ status: 'published', updated_at: new Date().toISOString() }).eq('id', item.id);
      await adminDb.from('audit_entries').insert({
        campaign_id: item.campaign_id, action: 'cron_publish',
        entity_type: 'content_item', entity_id: item.id,
        details: { platforms: item.platforms, failed: failed.map(f => f.platform) },
      });
      results_out.push({ id: item.id, ok: true });
    } catch (e) {
      results_out.push({ id: item.id, ok: false, error: String(e) });
    }
```

(Rename the local `results` array declared at route.ts:25 to `results_out` to avoid shadowing the per-item `results`.)

- [ ] **Step 5: Run the test and full suite**

Run: `npx vitest run src/app/actions.publish.test.ts && npm test && npm run typecheck`
Expected: PASS.

> **Deferred to Phase 3 (not this task), tracked from the audit:** INT-11 (atomic claim to prevent double-publish) and INT-3 (fail loudly instead of silent mock in prod). This task stops the false-"published" bug; the double-publish race is a separate fix.

### Task 6: Remove seeded credentials & demo data from migrations, and remediate the live DB (DATA-4)

**Files:**
- Modify: `supabase/migrations/003_auth.sql` (remove the four credential `UPDATE`s, lines 33-55)
- Modify: `supabase/migrations/001_init.sql`, `002_super_admin.sql` (move demo campaign/user/content/usage `INSERT`s out)
- Create: `supabase/seed.dev.sql` (all demo data + dev credentials, clearly dev-only)
- Create: `docs/audit/PRODUCTION-REMEDIATION.md` (steps the operator must run against the live DB)

**Note:** Editing the migration files stops *future* deploys from seeding known credentials, but the live DB already has them (the `admin@commandcenter.local` / `changeme123` super-admin logs in today). Both parts are required.

- [ ] **Step 1: Move demo seed data to `supabase/seed.dev.sql`**

Cut the demo `INSERT`s from `001_init.sql` (campaigns/users/content/usage seed, ~lines 107-160) and `002_super_admin.sql` (the demo user/content rows), and the four credential `UPDATE`s from `003_auth.sql` (lines 33-55), into a new `supabase/seed.dev.sql` with a header:

```sql
-- DEV/LOCAL SEED ONLY. Do NOT run against production.
-- Provides demo campaigns, users, and content with password 'changeme123'.
-- Apply locally with: psql "$LOCAL_DB_URL" -f supabase/seed.dev.sql
```

Leave `001`/`002`/`003` containing schema + the super-admin *structure* only — no fixed password. The migrations must still create the tables, columns, indexes, and constraints exactly as before.

- [ ] **Step 2: Verify migrations are schema-only**

Run: `grep -niE "changeme123|crypt\('|@example.com|admin@commandcenter" supabase/migrations/*.sql`
Expected: no matches (all moved to seed.dev.sql).

- [ ] **Step 3: Write `docs/audit/PRODUCTION-REMEDIATION.md`** with the exact SQL for the operator to run against the live Supabase (do NOT run it yourself):

```sql
-- 1. Rotate or disable the seeded super-admin.
UPDATE users SET password_hash = NULL
  WHERE email IN ('admin@commandcenter.local','alex@example.com','sarah@example.com','mike@example.com');
-- 2. Then create a real super-admin via a proper bootstrap (generated password),
--    or set a new hash: UPDATE users SET password_hash = crypt('<STRONG_PW>', gen_salt('bf',10)) WHERE email='<real-admin>';
-- 3. Audit for accounts still using the default (should return 0 rows after step 1):
SELECT id, email FROM users WHERE password_hash = crypt('changeme123', password_hash);
```

- [ ] **Step 4: Confirm the app still boots against a freshly-migrated (unseeded) DB**

Run: `npm run typecheck && npm test`
Expected: PASS (no code depends on seed rows existing). Note in the PR description that a fresh prod DB now needs the bootstrap step from PRODUCTION-REMEDIATION.md.

---

## Self-review checklist (run before handing off)

- [ ] Every P0 has a task: SEC-1→T1, SEC-2→T1, DATA-2→T2, INT-1→T4, INT-2→T5, SEC-4→T3, DATA-4→T6. Plus SEC-11→T1, DATA-3→T2.
- [ ] No path writes `status:'scheduled'` except `lifecycle.schedule` (grep after edits: `grep -n "status: 'scheduled'" src`).
- [ ] `requireOwnedItem`/`NOT_FOUND` are defined once (T1) and reused (T2, T5) — no duplicate definitions.
- [ ] `npm test && npm run typecheck` green after every task.
- [ ] No git commits made (user commits).
