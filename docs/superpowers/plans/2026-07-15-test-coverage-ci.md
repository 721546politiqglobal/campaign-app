# Test Coverage & CI Hardening Plan — 2026-07-15

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (or `superpowers:subagent-driven-development`) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close every test-coverage and build-health finding from the 2026-07-15 audit that is *not* already owned by the P0 launch-blocker plan — TEST-1, TEST-2, TEST-3, TEST-5, TEST-6, TEST-7, TEST-8, TEST-9, TEST-10, TEST-11, TEST-BUILD-1 — by authoring regression tests that assert the guarded **behavior**, adding CI that runs the suite, and removing the last build-time network dependency (Google Fonts).

**Architecture:** These are almost all *characterization / regression* tests over code that already behaves correctly (the lifecycle hard gate, the disclosure engine, webhook idempotency, the billing-sync double-billing protections all exist and are correct today — they are simply untested). The TDD rhythm here is therefore inverted from feature TDD: write the test, run it, expect **PASS** against current code, then **prove the test is not vacuous** by temporarily applying the exact regression the finding warns about and confirming the test goes **RED**, then revert. Two tasks (TEST-5, TEST-6) touch production only for testability; TEST-5 needs a small extraction, TEST-6 needs none. TEST-BUILD-1 is a build-config migration; TEST-11 is a new CI file.

**Tech Stack:** Next.js 14.2.5 App Router, Supabase (`adminDb` service-role client), Stripe SDK v22.3.0, Vitest 4.x (`environment: 'node'`, `@` → `./src` alias per `vitest.config.ts`). Tests mock `next/cache`, `next/navigation`, `@/lib/session`, `@/lib/supabase`, `@/lib/stripe`, `@/lib/data`, `@/lib/services`, `@/lib/repos` — mirroring `src/app/actions.avatar-billing.test.ts`. Domain classes (`ContentLifecycle`, `DisclosureEngine`, `UsageMeter`) are constructor-injected and are tested directly with in-memory fakes (mirroring `src/domain/usage.test.ts`), never through the Supabase repos.

## Global Constraints

- **No autonomous git commits.** The user reviews and commits (per project memory). Do not run `git commit`, `git push`, or any history-mutating command. Reading git state is fine.
- **Tests must assert the guarded BEHAVIOR, not merely that a function exists.** A test that only checks `typeof fn === 'function'` (the TEST-9 anti-pattern) does **not** count and must not be written. Every test here either drives an input through the unit and asserts an observable outcome (return value, thrown error type/message, or a specific downstream call with specific arguments) **or** it is not done.
- **Every regression test must be proven non-vacuous.** Each behavioral task includes a mutation-check step: apply the exact break the finding describes, watch the new test fail, revert. If the test stays green under the mutation, it is wrong — fix the test.
- **Do not weaken existing tests.** After every task, `npm test && npm run typecheck` must be green (96 existing tests plus the new ones).
- **No new runtime dependencies.** CI and font self-hosting add dev/config files only.
- Server actions return `type Result = { ok: true } | { ok: false; error: string }`.

## Overlap with the P0 launch-blocker plan (`2026-07-15-p0-launch-blockers.md`) — READ BEFORE STARTING

The P0 plan already authors regression tests. Do **not** duplicate these here:

| Behavior | Owned by | This plan |
|---|---|---|
| **TEST-4** — `decideAction` approve permission (`can(role,'approve')`) | P0 Task 1 (`actions.ownership.test.ts`) | **Out of scope.** Not re-tested here. |
| Action-layer scheduling gate (`confirmDisclosureAction`/`approveTextAction` routed through `lifecycle.schedule`, never a raw `status:'scheduled'`) | P0 Task 2 (`actions.gate.test.ts`) | **Complements** TEST-1. TEST-1 tests the *domain* `ContentLifecycle.schedule` gate in isolation; P0 tests that the *actions* call into it. Both are needed; they do not overlap. |
| `publishAction` marks published only on success | P0 Task 5 (`actions.publish.test.ts`) | **Out of scope** for the publish path. TEST-8 covers only the *metered-billing* actions (draft/video/voice), not publish. |
| Cron **auth** fail-closed on unset `CRON_SECRET` (both cron routes) | P0 Task 3 (`api/cron/publish/route.test.ts`) | **Out of scope.** TEST-5 tests billing-sync *double-billing* behavior, not its auth guard. TEST-5's extracted function is tested below the auth check, so the two never collide. |
| Campaign-ownership enforcement on content actions | P0 Task 1 | Out of scope. |

If the P0 plan has **not** yet been executed when you start, TEST-1/TEST-2/TEST-5/TEST-8 are still valid and independent — none of them depend on P0 code changes. Only note: if P0 Task 2 renamed or removed an action this plan references, reconcile before writing.

## Phase / effort summary

| Task | Finding | Sev | Effort | Kind |
|---|---|---|---|---|
| 1 | TEST-1 | P1 | S | New domain test |
| 2 | TEST-2 | P1 | S | New domain test |
| 3 | TEST-3 | P1 | M | New route test |
| 4 | TEST-5 | P1 | M | Extract + route-logic test |
| 5 | TEST-6 | P1 | M | New action test |
| 6 | TEST-8 | P2 | M | New action test |
| 7 | TEST-7 | P2 | L | Integration/pgTAP test |
| 8 | TEST-9 | P3 | S | Replace false-coverage tests |
| 9 | TEST-10 | P3 | S | Extend permission test |
| 10 | TEST-11 | P2 | S | CI workflow |
| 11 | TEST-BUILD-1 | P2 | S | Font self-host |

---

### Task 1: Content-lifecycle hard-gate tests (TEST-1)

**Files:**
- Create: `src/domain/content-lifecycle.test.ts`
- Read-only reference: `src/domain/content-lifecycle.ts` (`TRANSITIONS` map lines 6–14; `schedule` hard gate lines 50–61; `GateError` line 16), `src/domain/types.ts:59-73` (repo interfaces).

**Interfaces (from the modules, do not guess):**
- `new ContentLifecycle(content: ContentRepo, approvals: ApprovalRepo, disclosures: DisclosureRepo, audit: AuditRepo)`.
- `ContentRepo { get(id): Promise<ContentItem|null>; setStatus(id, status): Promise<void> }`.
- `ApprovalRepo { add(rec): Promise<void>; hasApproval(id): Promise<boolean> }`.
- `DisclosureRepo { add(rec): Promise<void>; listFor(id): Promise<DisclosureRecord[]> }`.
- `AuditRepo { append(entry): Promise<void> }`.
- `schedule` throws `GateError` (a) on illegal transition, (b) when `!hasApproval(id)` (message contains "no human approval"), (c) when `isAiGenerated && listFor(id).length === 0` (message contains "needs a disclosure"). Only `approved` → `scheduled` is legal (TRANSITIONS line 9).

- [ ] **Step 1: Write the test** (`src/domain/content-lifecycle.test.ts`). Uses only in-memory fakes — no Supabase, no vi.mock:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ContentLifecycle, GateError } from './content-lifecycle';
import type {
  ContentItem, ContentStatus, DisclosureRecord,
  ContentRepo, ApprovalRepo, DisclosureRepo, AuditRepo,
} from './types';

function makeItem(over: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 'ci-1', campaignId: 'c-1', type: 'social_post', title: 't', body: 'b',
    status: 'approved', isAiGenerated: false, targetJurisdictions: ['US-CA'],
    mediaUrl: null, createdBy: 'u-1', createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z',
    ...over,
  };
}

// In-memory fakes capturing observable effects.
function fakes(item: ContentItem, opts: { approved?: boolean; disclosures?: DisclosureRecord[] } = {}) {
  const state = { status: item.status };
  const audit: string[] = [];
  const content: ContentRepo = {
    async get(id) { return id === item.id ? { ...item, status: state.status } : null; },
    async setStatus(_id, status) { state.status = status; },
  };
  const approvals: ApprovalRepo = {
    async add() {},
    async hasApproval() { return opts.approved ?? false; },
  };
  const disclosures: DisclosureRepo = {
    async add() {},
    async listFor() { return opts.disclosures ?? []; },
  };
  const auditRepo: AuditRepo = { async append(e) { audit.push(e.action); } };
  const lifecycle = new ContentLifecycle(content, approvals, disclosures, auditRepo);
  return { lifecycle, state, audit };
}

describe('ContentLifecycle.schedule — the hard gate', () => {
  it('blocks scheduling when there is no human approval on record', async () => {
    const item = makeItem({ status: 'approved', isAiGenerated: false });
    const { lifecycle, state } = fakes(item, { approved: false });
    await expect(lifecycle.schedule('ci-1', 'u-1')).rejects.toThrow(GateError);
    await expect(lifecycle.schedule('ci-1', 'u-1')).rejects.toThrow(/no human approval/);
    expect(state.status).toBe('approved'); // never advanced
  });

  it('blocks scheduling AI content that has no disclosure attached, even when approved', async () => {
    const item = makeItem({ status: 'approved', isAiGenerated: true });
    const { lifecycle, state } = fakes(item, { approved: true, disclosures: [] });
    await expect(lifecycle.schedule('ci-1', 'u-1')).rejects.toThrow(/needs a disclosure/);
    expect(state.status).toBe('approved');
  });

  it('schedules AI content once approved AND a disclosure is attached', async () => {
    const item = makeItem({ status: 'approved', isAiGenerated: true });
    const disc: DisclosureRecord = {
      id: 'd-1', contentItemId: 'ci-1', campaignId: 'c-1', jurisdiction: 'US-CA',
      disclosureText: 'AI disclosure', placement: 'overlay', appliedAt: '2026-07-15T00:00:00Z',
    };
    const { lifecycle, state, audit } = fakes(item, { approved: true, disclosures: [disc] });
    await lifecycle.schedule('ci-1', 'u-1');
    expect(state.status).toBe('scheduled');
    expect(audit).toContain('schedule');
  });

  it('schedules non-AI approved content without requiring a disclosure', async () => {
    const item = makeItem({ status: 'approved', isAiGenerated: false });
    const { lifecycle, state } = fakes(item, { approved: true, disclosures: [] });
    await lifecycle.schedule('ci-1', 'u-1');
    expect(state.status).toBe('scheduled');
  });

  it('rejects an illegal draft → scheduled jump before any gate check', async () => {
    const item = makeItem({ status: 'draft', isAiGenerated: false });
    const { lifecycle, state } = fakes(item, { approved: true });
    await expect(lifecycle.schedule('ci-1', 'u-1')).rejects.toThrow(/from draft to scheduled/);
    expect(state.status).toBe('draft');
  });
});

describe('ContentLifecycle transition guards', () => {
  it('approve records an approval and moves in_review → approved', async () => {
    const item = makeItem({ status: 'in_review' });
    let added = 0;
    const content: ContentRepo = { async get() { return item; }, async setStatus(_i, s) { item.status = s as ContentStatus; } };
    const approvals: ApprovalRepo = { async add() { added++; }, async hasApproval() { return true; } };
    const disclosures: DisclosureRepo = { async add() {}, async listFor() { return []; } };
    const audit: AuditRepo = { async append() {} };
    const lifecycle = new ContentLifecycle(content, approvals, disclosures, audit);
    await lifecycle.approve('ci-1', 'u-approver', 'lgtm');
    expect(added).toBe(1);
    expect(item.status).toBe('approved');
  });

  it('refuses to approve content that is not in_review', async () => {
    const item = makeItem({ status: 'published' });
    const content: ContentRepo = { async get() { return item; }, async setStatus() {} };
    const lifecycle = new ContentLifecycle(
      content,
      { async add() {}, async hasApproval() { return false; } },
      { async add() {}, async listFor() { return []; } },
      { async append() {} },
    );
    await expect(lifecycle.approve('ci-1', 'u-1')).rejects.toThrow(GateError);
  });
});
```

- [ ] **Step 2: Run and confirm PASS**

Run: `npx vitest run src/domain/content-lifecycle.test.ts`
Expected: all tests PASS (the gate already behaves correctly).

- [ ] **Step 3: Prove non-vacuous (mutation check).** Temporarily, in `src/domain/content-lifecycle.ts`, invert the approval gate at line 53 from `if (!(await this.approvals.hasApproval(itemId)))` to `if (false)`, and re-run. Expected: the "no human approval" and "blocks AI without disclosure" tests go **RED** (unapproved content now schedules). Also temporarily add `'scheduled'` to the `draft` transition list (line 7) and confirm the "illegal draft → scheduled" test goes RED. **Revert both mutations** and re-run to green.

- [ ] **Step 4: Full suite**

Run: `npm test && npm run typecheck`
Expected: PASS.

---

### Task 2: DisclosureEngine jurisdiction-rule tests (TEST-2)

**Files:**
- Create: `src/domain/disclosure.test.ts`
- Read-only reference: `src/domain/disclosure.ts` — `combineDisclosureText` (lines 26–28), `DisclosureEngine.requiredFor` (lines 33–47), `DEFAULT_LABEL` (line 22: `'This content was generated or substantially altered using AI.'`), `DisclosureRulesRepo` interface (lines 10–13).

**Interfaces:**
- `new DisclosureEngine(rules: DisclosureRulesRepo)`; `DisclosureRulesRepo { get(j): Promise<DisclosureRule|null>; all(): Promise<DisclosureRule[]> }`.
- `requiredFor(jurisdictions, isAiGenerated)`: returns `[]` when `!isAiGenerated`; skips a jurisdiction whose rule is `null` or `requiresAiLabel === false`; uses `rule.requiredText` or falls back to `DEFAULT_LABEL` when it is `null`.
- `combineDisclosureText(records)`: dedupes, drops empty strings, joins with `\n\n`.

- [ ] **Step 1: Write the test** (`src/domain/disclosure.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { DisclosureEngine, combineDisclosureText } from './disclosure';
import type { DisclosureRule, DisclosureRulesRepo } from './disclosure';

const DEFAULT_LABEL = 'This content was generated or substantially altered using AI.';

function rule(over: Partial<DisclosureRule>): DisclosureRule {
  return {
    jurisdiction: 'US-CA', requiresAiLabel: true, requiredText: null, placement: 'overlay',
    blackoutDaysBeforeElection: null, needsLegalReview: false, ...over,
  };
}

function repoWith(map: Record<string, DisclosureRule>): DisclosureRulesRepo {
  return {
    async get(j) { return map[j] ?? null; },
    async all() { return Object.values(map); },
  };
}

describe('DisclosureEngine.requiredFor', () => {
  it('returns nothing for non-AI content regardless of jurisdiction', async () => {
    const engine = new DisclosureEngine(repoWith({ 'US-CA': rule({}) }));
    expect(await engine.requiredFor(['US-CA'], false)).toEqual([]);
  });

  it('skips jurisdictions with no rule and jurisdictions that do not require an AI label', async () => {
    const engine = new DisclosureEngine(repoWith({
      'US-CA': rule({ jurisdiction: 'US-CA', requiresAiLabel: true, requiredText: 'CA text' }),
      'US-TX': rule({ jurisdiction: 'US-TX', requiresAiLabel: false }),
    }));
    const out = await engine.requiredFor(['US-CA', 'US-TX', 'US-NOWHERE'], true);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ jurisdiction: 'US-CA', disclosureText: 'CA text', placement: 'overlay', needsLegalReview: false });
  });

  it('falls back to the DEFAULT_LABEL when a required rule has no required text', async () => {
    const engine = new DisclosureEngine(repoWith({
      'US-FEDERAL': rule({ jurisdiction: 'US-FEDERAL', requiresAiLabel: true, requiredText: null }),
    }));
    const out = await engine.requiredFor(['US-FEDERAL'], true);
    expect(out[0].disclosureText).toBe(DEFAULT_LABEL);
  });

  it('aggregates a distinct required disclosure per matching jurisdiction and propagates needsLegalReview', async () => {
    const engine = new DisclosureEngine(repoWith({
      'US-CA': rule({ jurisdiction: 'US-CA', requiredText: 'CA', placement: 'overlay', needsLegalReview: true }),
      'US-NY': rule({ jurisdiction: 'US-NY', requiredText: 'NY', placement: 'caption', needsLegalReview: false }),
    }));
    const out = await engine.requiredFor(['US-CA', 'US-NY'], true);
    expect(out.map(o => o.jurisdiction)).toEqual(['US-CA', 'US-NY']);
    expect(out.find(o => o.jurisdiction === 'US-CA')!.needsLegalReview).toBe(true);
  });
});

describe('combineDisclosureText', () => {
  it('joins distinct disclosure texts with a blank line', () => {
    expect(combineDisclosureText([{ disclosureText: 'A' }, { disclosureText: 'B' }])).toBe('A\n\nB');
  });
  it('deduplicates identical texts and drops empty ones', () => {
    expect(combineDisclosureText([{ disclosureText: 'A' }, { disclosureText: 'A' }, { disclosureText: '' }])).toBe('A');
  });
  it('returns an empty string for no records', () => {
    expect(combineDisclosureText([])).toBe('');
  });
});
```

- [ ] **Step 2: Run and confirm PASS**

Run: `npx vitest run src/domain/disclosure.test.ts` — Expected: PASS.

- [ ] **Step 3: Prove non-vacuous.** Temporarily change line 38 `if (!rule || !rule.requiresAiLabel) continue;` to `if (!rule) continue;` (drop the `requiresAiLabel` guard) — the "skips jurisdictions that do not require an AI label" test must go RED. Temporarily change the fallback (line 41) `rule.requiredText ?? DEFAULT_LABEL` to `rule.requiredText ?? ''` — the DEFAULT_LABEL test must go RED. **Revert both.**

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck` → PASS.

---

### Task 3: Stripe webhook route tests — idempotency, retry, duplicate (TEST-3)

**Files:**
- Create: `src/app/api/webhooks/stripe/route.test.ts`
- Read-only reference: `src/app/api/webhooks/stripe/route.ts` — dedup lookup (22–32), campaign lookup + `computeSubscriptionUpdate` + update (36–75), update-error returns 500 **before** recording (67–69), `billing_events` insert **last** (77–82). `computeSubscriptionUpdate` stays real (pure, already tested).

**Interfaces:**
- Handler: `POST(req: NextRequest): Promise<NextResponse>`.
- `stripe.webhooks.constructEvent(rawBody, signature, secret)` — throws on bad signature.
- `adminDb.from('billing_events').select('id').eq('id', event.id).maybeSingle()` → `{ data, error }` (dedup).
- `adminDb.from('campaigns').select(...).eq('stripe_subscription_id', sub.id).maybeSingle()` → `{ data }`.
- `adminDb.from('campaigns').update(...).eq('id', ...)` → `{ error }`.
- `adminDb.from('billing_events').insert(...)` → `{ error }`.

- [ ] **Step 1: Write the test.** Uses a table-routing `adminDb.from` mock and a fake `constructEvent`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const constructEvent = vi.fn();
vi.mock('@/lib/stripe', () => ({ stripe: { webhooks: { constructEvent } } }));

const billingEventsMaybeSingle = vi.fn();
const billingEventsInsert = vi.fn(() => Promise.resolve({ error: null }));
const campaignsMaybeSingle = vi.fn();
const campaignsUpdateEq = vi.fn(() => Promise.resolve({ error: null }));

const from = vi.fn((table: string) => {
  if (table === 'billing_events') {
    return {
      select: () => ({ eq: () => ({ maybeSingle: billingEventsMaybeSingle }) }),
      insert: billingEventsInsert,
    };
  }
  if (table === 'campaigns') {
    return {
      select: () => ({ eq: () => ({ maybeSingle: campaignsMaybeSingle }) }),
      update: () => ({ eq: campaignsUpdateEq }),
    };
  }
  return {};
});
vi.mock('@/lib/supabase', () => ({ adminDb: { from } }));

function req(body = '{}') {
  return new Request('http://x/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig_test' },
    body,
  }) as any;
}

function subEvent(over: Partial<{ id: string; type: string; status: string }> = {}) {
  return {
    id: over.id ?? 'evt_1',
    type: over.type ?? 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status: over.status ?? 'past_due', items: { data: [{ current_period_end: 1893456000 }] } } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  billingEventsMaybeSingle.mockResolvedValue({ data: null, error: null });
  campaignsMaybeSingle.mockResolvedValue({ data: { id: 'c-1', grace_period_ends_at: null }, error: null });
  campaignsUpdateEq.mockResolvedValue({ error: null });
  billingEventsInsert.mockResolvedValue({ error: null });
});

describe('Stripe webhook route', () => {
  it('rejects a bad signature with 400 and never touches the DB', async () => {
    constructEvent.mockImplementation(() => { throw new Error('bad sig'); });
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('acks a duplicate event without processing or inserting again', async () => {
    constructEvent.mockReturnValue(subEvent());
    billingEventsMaybeSingle.mockResolvedValue({ data: { id: 'evt_1' }, error: null });
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(campaignsUpdateEq).not.toHaveBeenCalled();
    expect(billingEventsInsert).not.toHaveBeenCalled();
  });

  it('processes a new subscription event and records it last', async () => {
    constructEvent.mockReturnValue(subEvent({ status: 'past_due' }));
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(campaignsUpdateEq).toHaveBeenCalled();
    // Recorded to billing_events so a redelivery is deduped.
    expect(billingEventsInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt_1', campaign_id: 'c-1' }));
  });

  it('returns 500 and does NOT record the event when the campaign update fails, so Stripe retries', async () => {
    constructEvent.mockReturnValue(subEvent());
    campaignsUpdateEq.mockResolvedValue({ error: { message: 'db down' } });
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(billingEventsInsert).not.toHaveBeenCalled(); // not deduped away — retryable
  });
});
```

- [ ] **Step 2: Run and confirm PASS**

Run: `npx vitest run src/app/api/webhooks/stripe/route.test.ts` — Expected: PASS.

- [ ] **Step 3: Prove non-vacuous.** Temporarily move the `billing_events` insert (route.ts:77–82) to **before** the campaign-update block, or change the `if (updateError) return 500` (67–69) to swallow the error — re-run: the "returns 500 and does NOT record" test must go RED (event gets recorded before the failed write, so a redelivery would be silently dropped). **Revert.**

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck` → PASS.

> **Note (do not fix here):** the "no matching campaign still acks + inserts" path (route.ts:70–74, BILL-6) is a known P2. This task pins current behavior; do not add a test that asserts a *changed* behavior for it.

---

### Task 4: Billing-sync double-billing protection tests + testability extraction (TEST-5)

**Files:**
- Modify (minimal refactor): `src/app/api/cron/billing-sync/route.ts` — extract the per-campaign body of the `for` loop into a new exported function.
- Create: `src/lib/billing-sync-runner.ts` — holds `syncCampaignUsage`.
- Create: `src/lib/billing-sync-runner.test.ts`.
- Read-only reference: `src/app/api/cron/billing-sync/route.ts` (27–95: cursor read 29–33; pending-key reuse 39–48; `_reserved` exclusion via `.neq('kind','_reserved')` 53–59; zero-total short-circuit 63–66; persist-intent-before-Stripe upsert 71–76; meter event 78–82; cursor-advance upsert 84–89), `src/lib/billing-sync.ts` (`sumUsageCents`, `buildSyncKey`), `src/lib/billing-catalog.ts:20` (`METER_EVENT_NAME = 'platform_usage_cents'`).

**Interfaces (produced):**
- `export async function syncCampaignUsage(campaign: { id: string; stripe_customer_id: string | null; subscription_status: string | null }): Promise<{ campaignId: string; synced: boolean; error?: string }>` — byte-for-byte the current loop body; imports `adminDb`, `stripe`, `sumUsageCents`, `buildSyncKey`, `METER_EVENT_NAME`.

- [ ] **Step 1: Extract `syncCampaignUsage`** into `src/lib/billing-sync-runner.ts`. Move the *entire* `try { … } catch (e) { … }` body from route.ts lines 28–94 verbatim, wrapping it so the function returns the same result object the loop pushed:

```ts
import { adminDb } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { sumUsageCents, buildSyncKey } from '@/lib/billing-sync';
import { METER_EVENT_NAME } from '@/lib/billing-catalog';

export interface SyncableCampaign {
  id: string;
  stripe_customer_id: string | null;
  subscription_status: string | null;
}

export async function syncCampaignUsage(
  campaign: SyncableCampaign,
): Promise<{ campaignId: string; synced: boolean; error?: string }> {
  try {
    const { data: cursorRow } = await adminDb
      .from('usage_sync_cursor')
      .select('last_synced_at, pending_key, pending_until')
      .eq('campaign_id', campaign.id)
      .maybeSingle();

    const since = cursorRow?.last_synced_at ?? '1970-01-01T00:00:00Z';
    let until: string;
    let key: string;

    if (cursorRow?.pending_key && cursorRow?.pending_until) {
      until = cursorRow.pending_until;
      key = cursorRow.pending_key;
    } else {
      until = new Date().toISOString();
      key = buildSyncKey(campaign.id, since, until);
    }

    const { data: events } = await adminDb
      .from('usage_events')
      .select('cost_cents')
      .eq('campaign_id', campaign.id)
      .neq('kind', '_reserved')
      .gt('created_at', since)
      .lte('created_at', until);

    const totalCents = sumUsageCents((events ?? []).map((e) => ({ costCents: e.cost_cents })));

    if (totalCents === 0) {
      return { campaignId: campaign.id, synced: false };
    }

    await adminDb.from('usage_sync_cursor').upsert({
      campaign_id: campaign.id,
      last_synced_at: since,
      pending_key: key,
      pending_until: until,
    });

    await stripe!.billing.meterEvents.create({
      event_name: METER_EVENT_NAME,
      payload: { stripe_customer_id: campaign.stripe_customer_id!, value: String(totalCents) },
      identifier: key,
    });

    await adminDb.from('usage_sync_cursor').upsert({
      campaign_id: campaign.id,
      last_synced_at: until,
      pending_key: null,
      pending_until: null,
    });

    return { campaignId: campaign.id, synced: true };
  } catch (e) {
    return { campaignId: campaign.id, synced: false, error: String(e) };
  }
}
```

Then in `src/app/api/cron/billing-sync/route.ts`, replace the inline loop body with a call, keeping the auth guard (or the P0 fail-closed guard) and the `if (!stripe)` check untouched:

```ts
import { syncCampaignUsage } from '@/lib/billing-sync-runner';
// … auth + stripe guard + campaigns query unchanged …
const results = [] as { campaignId: string; synced: boolean; error?: string }[];
for (const campaign of campaigns ?? []) {
  results.push(await syncCampaignUsage(campaign));
}
```

Remove the now-unused `sumUsageCents`/`buildSyncKey`/`METER_EVENT_NAME` imports from the route if nothing else uses them.

- [ ] **Step 2: Write the test** (`src/lib/billing-sync-runner.test.ts`) with table-routing chain mocks that record the calls we care about:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cursorMaybeSingle = vi.fn();
const cursorUpsert = vi.fn(() => Promise.resolve({ error: null }));
const eventsLte = vi.fn();
const neqSpy = vi.fn();
const meterCreate = vi.fn(() => Promise.resolve({}));

const from = vi.fn((table: string) => {
  if (table === 'usage_sync_cursor') {
    return {
      select: () => ({ eq: () => ({ maybeSingle: cursorMaybeSingle }) }),
      upsert: cursorUpsert,
    };
  }
  if (table === 'usage_events') {
    return {
      select: () => ({
        eq: () => ({
          neq: (col: string, val: string) => {
            neqSpy(col, val);
            return { gt: () => ({ lte: eventsLte }) };
          },
        }),
      }),
    };
  }
  return {};
});
vi.mock('@/lib/supabase', () => ({ adminDb: { from } }));
vi.mock('@/lib/stripe', () => ({ stripe: { billing: { meterEvents: { create: meterCreate } } } }));

const campaign = { id: 'c-1', stripe_customer_id: 'cus_1', subscription_status: 'active' };

beforeEach(() => {
  vi.clearAllMocks();
  cursorMaybeSingle.mockResolvedValue({ data: { last_synced_at: '2026-07-01T00:00:00Z', pending_key: null, pending_until: null } });
  eventsLte.mockResolvedValue({ data: [{ cost_cents: 500 }, { cost_cents: 300 }] });
  cursorUpsert.mockResolvedValue({ error: null });
  meterCreate.mockResolvedValue({});
});

describe('syncCampaignUsage — double-billing protections', () => {
  it('excludes in-flight _reserved rows from the billable total', async () => {
    const { syncCampaignUsage } = await import('./billing-sync-runner');
    await syncCampaignUsage(campaign);
    expect(neqSpy).toHaveBeenCalledWith('kind', '_reserved');
  });

  it('sends nothing to Stripe and reports not-synced when the window total is zero', async () => {
    eventsLte.mockResolvedValue({ data: [] });
    const { syncCampaignUsage } = await import('./billing-sync-runner');
    const r = await syncCampaignUsage(campaign);
    expect(meterCreate).not.toHaveBeenCalled();
    expect(cursorUpsert).not.toHaveBeenCalled();
    expect(r).toEqual({ campaignId: 'c-1', synced: false });
  });

  it('reuses the persisted pending key/range on retry instead of minting a new one', async () => {
    cursorMaybeSingle.mockResolvedValue({
      data: { last_synced_at: '2026-07-01T00:00:00Z', pending_key: 'c-1:2026-07-01T00:00:00Z:2026-07-01T01:00:00Z', pending_until: '2026-07-01T01:00:00Z' },
    });
    const { syncCampaignUsage } = await import('./billing-sync-runner');
    await syncCampaignUsage(campaign);
    expect(meterCreate).toHaveBeenCalledWith(expect.objectContaining({
      identifier: 'c-1:2026-07-01T00:00:00Z:2026-07-01T01:00:00Z',
    }));
  });

  it('persists intent BEFORE the Stripe call and advances the cursor only AFTER it succeeds', async () => {
    const { syncCampaignUsage } = await import('./billing-sync-runner');
    await syncCampaignUsage(campaign);
    // first upsert writes pending_key; second clears it and advances last_synced_at.
    expect(cursorUpsert).toHaveBeenNthCalledWith(1, expect.objectContaining({ pending_key: expect.any(String) }));
    expect(cursorUpsert).toHaveBeenNthCalledWith(2, expect.objectContaining({ pending_key: null }));
  });

  it('leaves the pending key in place (does NOT advance the cursor) when the Stripe call fails', async () => {
    meterCreate.mockRejectedValue(new Error('stripe 500'));
    const { syncCampaignUsage } = await import('./billing-sync-runner');
    const r = await syncCampaignUsage(campaign);
    expect(r.synced).toBe(false);
    expect(cursorUpsert).toHaveBeenCalledTimes(1); // only the intent write; the clear/advance never ran
    expect(cursorUpsert).toHaveBeenCalledWith(expect.objectContaining({ pending_key: expect.any(String) }));
  });
});
```

- [ ] **Step 3: Run and confirm PASS**

Run: `npx vitest run src/lib/billing-sync-runner.test.ts` — Expected: PASS.

- [ ] **Step 4: Prove non-vacuous.** Temporarily drop `.neq('kind','_reserved')` from the events query — the `_reserved` exclusion test goes RED (spy not called). Temporarily change the retry branch to always mint a fresh key (`key = buildSyncKey(...)` unconditionally) — the "reuses the persisted pending key" test goes RED. Temporarily move the cursor-advance upsert *before* `meterEvents.create` — the "leaves the pending key in place on failure" test goes RED. **Revert all.**

- [ ] **Step 5: Full suite** — `npm test && npm run typecheck` → PASS (route still compiles; the pre-existing `billing-sync.test.ts` for `sumUsageCents`/`buildSyncKey` is untouched).

---

### Task 5: `assignPlanAction` Stripe-subscription tests (TEST-6)

**Files:**
- Create: `src/app/admin/actions.assign-plan.test.ts`
- Read-only reference: `src/app/admin/actions.ts` — `assignPlanAction` (82–138): no-stripe guard (84), required-fields guard (88), customer create when absent (96–102), **cancel previous subscription before creating** (107–109), create with two price items + `payment_behavior:'default_incomplete'` (116–120), campaign row update writing `plan_id`/`stripe_subscription_id`/`subscription_status`/`monthly_cost_cost_cap_cents=plan.includedUsageCents` (126–134). `src/lib/data.ts:154-183` (`BillingPlan` fields `stripeFlatPriceId`, `stripeMeteredPriceId`, `includedUsageCents`).

**No production refactor needed.** `assignPlanAction` is already testable: it is an exported async function taking `FormData`, and every collaborator (`requireAdmin`, `stripe`, dynamic `import('@/lib/data')`, `adminDb`) is mockable exactly as `actions.avatar-billing.test.ts` mocks its collaborators. (Contrast TEST-5, which did need extraction because the logic was buried in a route handler loop.)

**Interfaces:**
- `requireAdmin()` from `@/lib/session`.
- `stripe.customers.create`, `stripe.subscriptions.cancel`, `stripe.subscriptions.create` (returns `{ id, status, items: { data: [{ current_period_end }] } }`).
- `getCampaign`, `getBillingPlan` from `@/lib/data` (dynamically imported — mock the module).
- `adminDb.from('campaigns').update(...).eq('id', ...)`.

- [ ] **Step 1: Write the test:**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ userId: 'sa-1', role: 'super_admin', campaignId: null })) }));

const customersCreate = vi.fn();
const subscriptionsCancel = vi.fn(() => Promise.resolve({}));
const subscriptionsCreate = vi.fn();
vi.mock('@/lib/stripe', () => ({
  stripe: { customers: { create: customersCreate }, subscriptions: { cancel: subscriptionsCancel, create: subscriptionsCreate } },
}));

const campaignsUpdateEq = vi.fn(() => Promise.resolve({ error: null }));
const campaignsUpdate = vi.fn(() => ({ eq: campaignsUpdateEq }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update: campaignsUpdate })) } }));

const getCampaign = vi.fn();
const getBillingPlan = vi.fn();
vi.mock('@/lib/data', () => ({ getCampaign, getBillingPlan }));

const PLAN = {
  id: 'plan-starter', name: 'Starter', monthlyPriceCents: 9900, seatLimit: 5,
  includedUsageCents: 2500, overageMultiplier: 1, stripeProductId: 'prod_1',
  stripeFlatPriceId: 'price_flat', stripeMeteredPriceId: 'price_metered', isActive: true,
};

function fd(over: Record<string, string> = {}) {
  const f = new FormData();
  f.set('campaignId', 'c-1'); f.set('planId', 'plan-starter');
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  subscriptionsCreate.mockResolvedValue({ id: 'sub_new', status: 'incomplete', items: { data: [{ current_period_end: 1893456000 }] } });
  customersCreate.mockResolvedValue({ id: 'cus_new' });
  getBillingPlan.mockResolvedValue(PLAN);
});

describe('assignPlanAction', () => {
  it('creates a Stripe customer first when the campaign has none, then a two-item incomplete subscription', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: null, stripeSubscriptionId: null });
    const { assignPlanAction } = await import('./actions');
    const r = await assignPlanAction(fd());
    expect(r).toEqual({ ok: true });
    expect(customersCreate).toHaveBeenCalled();
    expect(subscriptionsCancel).not.toHaveBeenCalled();
    expect(subscriptionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus_new',
      items: [{ price: 'price_flat' }, { price: 'price_metered' }],
      payment_behavior: 'default_incomplete',
    }));
  });

  it('cancels the existing subscription BEFORE creating the replacement on a plan change', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_old', stripeSubscriptionId: 'sub_old' });
    const order: string[] = [];
    subscriptionsCancel.mockImplementation(async () => { order.push('cancel'); return {}; });
    subscriptionsCreate.mockImplementation(async () => { order.push('create'); return { id: 'sub_new', status: 'incomplete', items: { data: [{ current_period_end: 1893456000 }] } }; });
    const { assignPlanAction } = await import('./actions');
    await assignPlanAction(fd());
    expect(subscriptionsCancel).toHaveBeenCalledWith('sub_old');
    expect(order).toEqual(['cancel', 'create']);
    expect(customersCreate).not.toHaveBeenCalled(); // reuse existing customer
  });

  it('persists the new subscription id, status, and resets the cap to the plan allowance', async () => {
    getCampaign.mockResolvedValue({ id: 'c-1', name: 'Camp', stripeCustomerId: 'cus_1', stripeSubscriptionId: null });
    const { assignPlanAction } = await import('./actions');
    await assignPlanAction(fd());
    expect(campaignsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      plan_id: 'plan-starter',
      stripe_subscription_id: 'sub_new',
      subscription_status: 'incomplete',
      monthly_cost_cap_cents: 2500,
      grace_period_ends_at: null,
    }));
    expect(campaignsUpdateEq).toHaveBeenCalledWith('id', 'c-1');
  });

  it('returns a clear error and touches nothing when Stripe is not configured', async () => {
    vi.resetModules();
    vi.doMock('@/lib/stripe', () => ({ stripe: null }));
    const { assignPlanAction } = await import('./actions');
    const r = await assignPlanAction(fd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/STRIPE_SECRET_KEY/);
    vi.doUnmock('@/lib/stripe');
    vi.resetModules();
  });
});
```

- [ ] **Step 2: Run and confirm PASS**

Run: `npx vitest run src/app/admin/actions.assign-plan.test.ts` — Expected: PASS.

- [ ] **Step 3: Prove non-vacuous.** Temporarily delete the `stripe.subscriptions.cancel(...)` call (107–109) — the "cancels before creating" test goes RED. Temporarily drop `payment_behavior: 'default_incomplete'` — the "two-item incomplete subscription" test goes RED. **Revert both.**

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck` → PASS.

---

### Task 6: Draft / video / voice metered-billing tests (TEST-8)

**Files:**
- Create: `src/app/actions.metered-billing.test.ts`
- Read-only reference: `src/app/actions.ts` — imports/`guard` (1–25); `generateDraftAction` (164–189: gate→guard→`contentGenerator.draft` in `try`, **`usageMeter.record` in `finally`** 184–188); `generateVideoAction` (277–316: campaign+profile load, **no-avatar refusal** 293, gate→guard→provider→record 296–305, `CapExceeded`/`BillingBlocked`→`{ok:false}` 313); `synthesizeVoiceAction` (324–338). Mirror the mock scaffold in `src/app/actions.avatar-billing.test.ts` (session/data/supabase/services/repos), which is the established convention.

**Interfaces:**
- `billingGate.check`, `usageMeter.guard`, `usageMeter.record` from `@/lib/services`.
- `contentGenerator.draft`, `videoProvider.generateAvatarVideo`, `voiceProvider.synthesize` from `@/lib/services`.
- `getCandidateProfile` from `@/lib/candidate` (dynamically imported); `getCampaign` from `@/lib/data`.
- `CONTENT_COST_CENTS` from `@/lib/prompt` (dynamically imported).

- [ ] **Step 1: Write the test.** Reuse the avatar-billing mock block, adding `contentGenerator`/`videoProvider`/`voiceProvider` fns and mocking `@/lib/prompt`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapExceeded } from '@/domain/usage';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };
const campaign = {
  id: 'c-1', name: 'Test', jurisdictions: [], monthlyCostCapCents: 100_00,
  planId: null, stripeCustomerId: null, stripeSubscriptionId: null,
  subscriptionStatus: null, gracePeriodEndsAt: null, currentPeriodEnd: null,
};

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session), signInAs: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/data', () => ({ getCampaign: vi.fn(() => Promise.resolve(campaign)) }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(() => Promise.resolve({ error: null })), update: vi.fn(), delete: vi.fn() })) },
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'ci-1') }));
vi.mock('@/lib/prompt', () => ({ CONTENT_COST_CENTS: { social_post: 5_00 } }));

const getCandidateProfile = vi.fn(() => Promise.resolve(null as any));
vi.mock('@/lib/candidate', () => ({ getCandidateProfile, upsertCandidateProfile: vi.fn() }));

const billingGate = { check: vi.fn(() => Promise.resolve()) };
const usageMeter = { guard: vi.fn(() => Promise.resolve()), record: vi.fn(() => Promise.resolve()) };
const contentGenerator = { draft: vi.fn() };
const videoProvider = { generateAvatarVideo: vi.fn(), getVideoStatus: vi.fn() };
const voiceProvider = { synthesize: vi.fn() };
vi.mock('@/lib/services', () => ({
  lifecycle: {}, disclosureEngine: {}, publisher: {}, photoAvatarProvider: {},
  billingGate, usageMeter, contentGenerator, videoProvider, voiceProvider,
}));
vi.mock('@/lib/repos', () => ({ contentRepo: {}, approvalRepo: {}, disclosureRepo: {}, auditRepo: { append: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  billingGate.check.mockResolvedValue(undefined);
  usageMeter.guard.mockResolvedValue(undefined);
  usageMeter.record.mockResolvedValue(undefined);
  getCandidateProfile.mockResolvedValue(null);
});

describe('generateDraftAction billing', () => {
  it('records llm_tokens usage even when the generator throws (the Anthropic call already billed)', async () => {
    contentGenerator.draft.mockRejectedValue(new Error('model refused'));
    const { generateDraftAction } = await import('./actions');
    await expect(generateDraftAction('write a post', 'social_post')).rejects.toThrow('model refused');
    expect(usageMeter.record).toHaveBeenCalledWith('c-1', 'llm_tokens', 1, 5_00);
  });

  it('guards the cap before generating and records after success', async () => {
    contentGenerator.draft.mockResolvedValue({ title: 'T', text: 'B' });
    const { generateDraftAction } = await import('./actions');
    await generateDraftAction('write a post', 'social_post');
    expect(usageMeter.guard).toHaveBeenCalledWith('c-1', 100_00, 5_00);
    expect(usageMeter.record).toHaveBeenCalledWith('c-1', 'llm_tokens', 1, 5_00);
  });
});

describe('generateVideoAction billing', () => {
  it('refuses (and never guards spend or calls HeyGen) when no avatar is configured', async () => {
    getCandidateProfile.mockResolvedValue(null);
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('ci-1', 'script'); // no override avatarId, no profile avatar
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/avatar/i);
    expect(usageMeter.guard).not.toHaveBeenCalled();
    expect(videoProvider.generateAvatarVideo).not.toHaveBeenCalled();
  });

  it('guards $50 before calling HeyGen and records $50 after success', async () => {
    videoProvider.generateAvatarVideo.mockResolvedValue({ videoId: 'v-1' });
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('ci-1', 'script', { avatarId: 'look_1' });
    expect(r.ok).toBe(true);
    expect(usageMeter.guard).toHaveBeenCalledWith('c-1', 100_00, 50_00);
    expect(usageMeter.record).toHaveBeenCalledWith('c-1', 'video_generation', 1, 50_00);
  });

  it('does not call HeyGen or record when the cap guard rejects', async () => {
    usageMeter.guard.mockRejectedValue(new CapExceeded('This campaign has reached its monthly spending cap. Raise the cap in Settings to continue.'));
    const { generateVideoAction } = await import('./actions');
    const r = await generateVideoAction('ci-1', 'script', { avatarId: 'look_1' });
    expect(r.ok).toBe(false);
    expect(videoProvider.generateAvatarVideo).not.toHaveBeenCalled();
    expect(usageMeter.record).not.toHaveBeenCalled();
  });
});

describe('synthesizeVoiceAction billing', () => {
  it('guards $20 before synth and records $20 after success', async () => {
    voiceProvider.synthesize.mockResolvedValue({ audioUrl: 'https://media/x.mp3' });
    const { synthesizeVoiceAction } = await import('./actions');
    const r = await synthesizeVoiceAction('hello');
    expect(r.ok).toBe(true);
    expect(usageMeter.guard).toHaveBeenCalledWith('c-1', 100_00, 20_00);
    expect(usageMeter.record).toHaveBeenCalledWith('c-1', 'voice_synthesis', 1, 20_00);
  });
});
```

- [ ] **Step 2: Run and confirm PASS**

Run: `npx vitest run src/app/actions.metered-billing.test.ts` — Expected: PASS.

- [ ] **Step 3: Prove non-vacuous.** Temporarily move `usageMeter.record` in `generateDraftAction` out of the `finally` block into the `try` (after `draft(...)`) — the "records even when the generator throws" test goes RED (a failed draft no longer meters, leaving the reserve open, the exact BILL-9/TEST-8 bug). Temporarily delete the no-avatar guard (293) — the "refuses when no avatar" test goes RED. **Revert both.**

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck` → PASS.

---

### Task 7: Real `reserve_usage` RPC integration test (TEST-7)

**Files:**
- Create: `supabase/tests/reserve_usage.test.sql` (pgTAP).
- Modify (docs): add a short "Database tests" note to `docs/audit/PRODUCTION-REMEDIATION.md` if it exists, else skip.
- Read-only reference: `supabase/migrations/013_atomic_usage_guard.sql` (the `reserve_usage(p_campaign_id, p_cap_cents, p_cost_cents)` function: advisory-lock, month-to-date sum excluding `_reserved` older than 5 min, insert a `_reserved` row on success), `src/lib/repos.ts:135-142` (the `SupabaseUsageRepo.reserve` calls `adminDb.rpc('reserve_usage', …)` — this is the untested production path the Vitest fake stands in for).

**Why this is separate from `usage.test.ts`:** `src/domain/usage.test.ts` exercises a hand-written `fakeAtomicRepo` that *mirrors* the SQL. If the real SQL comparison drifts from the fake, the Vitest suite stays green while prod overshoots the cap. This task tests the **real** Postgres function against a real database, so drift is caught.

**Runtime requirement:** a local Postgres with pgTAP and migration 013 applied — the Supabase CLI provides this (`supabase start` → `supabase test db`, which loads `supabase/migrations/*` then runs `supabase/tests/*.sql`). This test is **not** part of the Vitest suite and is **not** wired into the default CI job (Task 10) because CI has no database; it is run on demand and can be added to a future DB-backed CI lane.

- [ ] **Step 1: Write the pgTAP test** (`supabase/tests/reserve_usage.test.sql`):

```sql
begin;
select plan(5);

-- Isolate: work in a campaign id no seed data uses.
delete from usage_events where campaign_id = 'test-cap';

-- 1. A reservation that fits under the cap succeeds.
select is( reserve_usage('test-cap', 1000, 400), true,
  'reserve returns true when 400 fits under the 1000 cap' );

-- 2. That reservation is now counted; a second one that would exceed is rejected.
select is( reserve_usage('test-cap', 1000, 700), false,
  'reserve returns false when 400 (in-flight) + 700 exceeds the 1000 cap' );

-- 3. A second reservation that still fits alongside the first succeeds.
select is( reserve_usage('test-cap', 1000, 500), true,
  'reserve returns true when 400 + 500 stays within 1000' );

-- 4. Exactly hitting the cap is allowed (> comparison, not >=).
delete from usage_events where campaign_id = 'test-cap';
select is( reserve_usage('test-cap', 1000, 1000), true,
  'reserve allows a request that exactly equals the cap' );

-- 5. An abandoned _reserved row older than 5 minutes is excluded from the total.
delete from usage_events where campaign_id = 'test-cap';
insert into usage_events (campaign_id, kind, cost_cents, created_at)
  values ('test-cap', '_reserved', 900, now() - interval '10 minutes');
select is( reserve_usage('test-cap', 1000, 800), true,
  'a _reserved row older than 5 minutes does not count against the cap' );

select * from finish();
rollback;
```

- [ ] **Step 2: Run against a local database**

Run: `supabase start && supabase test db`
Expected: `reserve_usage.test.sql .. ok` — 5/5 assertions pass.
(If the Supabase CLI is unavailable, run manually: apply `supabase/migrations/013_atomic_usage_guard.sql` and the pgTAP extension to a scratch Postgres, then `pg_prove -d "$LOCAL_DB_URL" supabase/tests/reserve_usage.test.sql`.)

- [ ] **Step 3: Prove non-vacuous.** Temporarily change migration 013 line 37 from `if v_used + p_cost_cents > p_cap_cents` to `>=` and reload the function — assertion 4 ("exactly equals the cap") goes RED. Temporarily drop the `or created_at >= now() - interval '5 minutes'` clause (line 35) so *all* `_reserved` rows count — assertion 5 goes RED. **Revert** and reload.

---

### Task 8: Replace the false-coverage avatars/candidate tests (TEST-9)

**Files:**
- Rewrite: `src/lib/avatars.test.ts` (currently asserts only `typeof fn === 'function'`, lines 9–18).
- Rewrite: `src/lib/candidate.test.ts` (currently asserts only `typeof fn === 'function'`, lines 9–15).
- Read-only reference: `src/lib/avatars.ts` (`insertAvatar` maps camelCase→snake_case and defaults `status` to `'training'`, 36–60; `toAvatar` maps rows back, 5–20), `src/lib/candidate.ts` (`upsertCandidateProfile` update-vs-insert branch keyed on `getCandidateProfile`, 48–87; `toProfile` defaults, 6–37).

These modules are thin DB-mappers, so the meaningful behavior to assert is the **camelCase↔snake_case mapping and defaulting** — captured by spying on the `adminDb` insert/update payloads. That is a real behavioral assertion, not `typeof`.

- [ ] **Step 1: Rewrite `src/lib/avatars.test.ts`:**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
const from = vi.fn(() => ({ insert, update, select: vi.fn(), delete: vi.fn() }));
vi.mock('./supabase', () => ({ adminDb: { from } }));

beforeEach(() => vi.clearAllMocks());

describe('insertAvatar', () => {
  it('maps camelCase fields to snake_case columns and defaults status to training', async () => {
    const { insertAvatar } = await import('./avatars');
    await insertAvatar({
      id: 'av-1', campaignId: 'c-1', name: 'A', sourcePhotoUrls: ['u1'],
      consentConfirmedBy: 'u-1', createdBy: 'u-1', heygenGroupId: 'g-1',
    });
    expect(from).toHaveBeenCalledWith('avatars');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'av-1', campaign_id: 'c-1', name: 'A', status: 'training',
      heygen_group_id: 'g-1', source_photo_urls: ['u1'], consent_confirmed_by: 'u-1', created_by: 'u-1',
    }));
  });

  it('honors an explicit status when provided', async () => {
    const { insertAvatar } = await import('./avatars');
    await insertAvatar({ id: 'av-2', campaignId: 'c-1', name: 'A', sourcePhotoUrls: [], consentConfirmedBy: 'u', createdBy: 'u', status: 'ready' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));
  });
});

describe('updateAvatarStatus', () => {
  it('updates only the provided optional fields alongside status', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }));
    update.mockReturnValueOnce({ eq } as any);
    const { updateAvatarStatus } = await import('./avatars');
    await updateAvatarStatus('av-1', 'failed', { errorMessage: 'boom' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error_message: 'boom' }));
    expect(eq).toHaveBeenCalledWith('id', 'av-1');
  });
});
```

- [ ] **Step 2: Rewrite `src/lib/candidate.test.ts`.** `upsertCandidateProfile` calls `getCandidateProfile` (a `.select().eq().single()` chain) to decide update vs insert; drive both branches by controlling `single`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const single = vi.fn();
const insert = vi.fn(() => Promise.resolve({ error: null }));
const updateEq = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq: updateEq }));
const from = vi.fn(() => ({
  select: () => ({ eq: () => ({ single }) }),
  insert, update,
}));
vi.mock('./supabase', () => ({ adminDb: { from } }));
vi.mock('./store', () => ({ uid: vi.fn(() => 'cp-1') }));

beforeEach(() => vi.clearAllMocks());

describe('upsertCandidateProfile', () => {
  it('inserts a new snake_cased row (with a generated id) when none exists', async () => {
    single.mockResolvedValue({ data: null });
    const { upsertCandidateProfile } = await import('./candidate');
    await upsertCandidateProfile('c-1', { fullName: 'Jane Doe', elevenLabsVoiceId: 'voice_1' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'cp-1', campaign_id: 'c-1', full_name: 'Jane Doe', elevenlabs_voice_id: 'voice_1',
    }));
    expect(update).not.toHaveBeenCalled();
  });

  it('updates the existing row (no id, no insert) when a profile already exists', async () => {
    single.mockResolvedValue({ data: { id: 'cp-existing', campaign_id: 'c-1', full_name: 'X', preferred_name: 'X', office: 'o', district: 'd' } });
    const { upsertCandidateProfile } = await import('./candidate');
    await upsertCandidateProfile('c-1', { activeAvatarId: 'av-9' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ active_avatar_id: 'av-9' }));
    expect(updateEq).toHaveBeenCalledWith('campaign_id', 'c-1');
    expect(insert).not.toHaveBeenCalled();
  });

  it('getCandidateProfile maps a row back to a camelCase profile with defaults', async () => {
    single.mockResolvedValue({ data: { id: 'cp-1', campaign_id: 'c-1', full_name: 'Jane', preferred_name: 'J', office: 'Senate', district: 'CA', created_at: 't', updated_at: 't' } });
    const { getCandidateProfile } = await import('./candidate');
    const p = await getCandidateProfile('c-1');
    expect(p).toMatchObject({ campaignId: 'c-1', fullName: 'Jane', voiceTone: 'conversational', videoAspectRatio: '16:9' });
  });
});
```

- [ ] **Step 3: Run and confirm PASS**

Run: `npx vitest run src/lib/avatars.test.ts src/lib/candidate.test.ts` — Expected: PASS.

- [ ] **Step 4: Prove non-vacuous.** Temporarily change `insertAvatar`'s `status: input.status ?? 'training'` (avatars.ts:52) to `?? 'ready'` — the "defaults status to training" test goes RED. Temporarily break a mapping in `upsertCandidateProfile` (e.g. `elevenlabs_voice_id` → `voice_id`) — the insert test goes RED. **Revert.** (These are the assertions the old `typeof` tests could never make.)

- [ ] **Step 5: Full suite** — `npm test && npm run typecheck` → PASS. The old `typeof`-only tests are now gone.

---

### Task 9: Pin `super_admin` all-deny in the permission matrix (TEST-10)

**Files:**
- Modify: `src/lib/permissions.test.ts` (append a describe block).
- Read-only reference: `src/lib/permissions.ts` — `PERMISSIONS` (5–11) lists no `super_admin` in any action, so `can('super_admin', anything) === false` for all five actions. This is deliberate (admin surfaces gate on `requireAdminSession`/`requireAdmin`, not `can`), but it is currently unpinned — a future edit adding `super_admin` to a list would silently grant campaign-level permissions to a role meant to be scoped out.

- [ ] **Step 1: Append the test** to `src/lib/permissions.test.ts`:

```ts
describe('can – super_admin is intentionally denied every campaign-level action', () => {
  // super_admin operates admin surfaces via requireAdmin/requireAdminSession,
  // NOT via can(). It must never appear in any PERMISSIONS list, or it would
  // gain campaign-scoped approve/schedule/publish rights it is not meant to hold.
  const actions = ['approve', 'schedule', 'publish', 'edit_settings', 'manage_avatars'] as const;
  for (const action of actions) {
    it(`denies super_admin '${action}'`, () => {
      expect(can('super_admin', action)).toBe(false);
    });
  }
});
```

- [ ] **Step 2: Run and confirm PASS**

Run: `npx vitest run src/lib/permissions.test.ts` — Expected: PASS (5 new assertions).

- [ ] **Step 3: Prove non-vacuous.** Temporarily add `'super_admin'` to the `approve` list in `permissions.ts` — the `denies super_admin 'approve'` test goes RED. **Revert.**

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck` → PASS.

---

### Task 10: GitHub Actions CI running typecheck + test (TEST-11)

**Files:**
- Create: `.github/workflows/ci.yml`
- Read-only reference: `package.json` (`typecheck` → `tsc --noEmit`, `test` → `vitest run`; `package-lock.json` exists so `npm ci` is valid; `@types/node ^20` → Node 20).

**Note:** No build step in this job — production `build` currently fails on the Google Fonts fetch (TEST-BUILD-1) and CI runners may lack that egress. The build is safe to add to CI *after* Task 11 lands (self-hosted font). The Vitest suite runs under `environment: 'node'` and needs no browser or DB, so it runs on a bare runner. The `reserve_usage` pgTAP test (Task 7) is intentionally excluded — CI has no Postgres.

- [ ] **Step 1: Create `.github/workflows/ci.yml`:**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    name: typecheck + test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        run: npm test
```

- [ ] **Step 2: Validate locally.** CI just runs the two scripts, so reproduce the job locally:

Run: `npm ci && npm run typecheck && npm test`
Expected: install succeeds, typecheck clean, all tests (existing + those added by this plan) pass. This is exactly what the runner will execute.

- [ ] **Step 3: Confirm the workflow is well-formed.** `cat .github/workflows/ci.yml` and verify indentation is valid YAML (2-space). After the user pushes, the Actions tab should show the "CI / typecheck + test" check on the PR. (Do not push — the user commits.)

- [ ] **Step 4 (deferred, note only):** once Task 11 removes the Google Fonts dependency, add a `- run: npm run build` step after `npm test` so CI also catches build breakage.

---

### Task 11: Self-host the Manrope font via `next/font/local` (TEST-BUILD-1)

**Files:**
- Create: `src/app/fonts/` directory holding the Manrope `.woff2` files (committed binaries).
- Modify: `src/app/layout.tsx` (lines 2, 6–11, 20 — swap `next/font/google` `Manrope(...)` for `next/font/local` `localFont(...)`).
- Read-only reference: `src/app/layout.tsx` currently imports `{ Manrope } from 'next/font/google'` and builds `manrope` with `variable: '--font'`, `weight: ['400','500','600','700','800']`, `display: 'swap'`, applied as `<html className={manrope.variable}>`. The `--font` CSS variable and the class application must be preserved exactly so `globals.css` and the rest of the UI are unaffected.

**Why:** `next/font/google` fetches Manrope from Google's servers at build time. Any build environment without Google Fonts egress fails (`npm run build` fails here today, and it blocks adding `build` to CI in Task 10). Self-hosting bundles the font with the app — zero network at build.

- [ ] **Step 1: Obtain and commit the font files.** The files are binary assets that MUST be committed (they cannot be fetched at build — that is the whole point). Download Manrope weights 400/500/600/700/800 as `.woff2`:
  - Source: Google Fonts (`https://fonts.google.com/specimen/Manrope` → Download family) or the `@fontsource/manrope` npm package's `files/*.woff2` (do not add the package as a dependency — just copy the `.woff2` files out).
  - Manrope is an OFL-licensed variable font. Either approach is fine:
    - **Static weights (matches current config exactly):** place `Manrope-Regular.woff2` (400), `Manrope-Medium.woff2` (500), `Manrope-SemiBold.woff2` (600), `Manrope-Bold.woff2` (700), `Manrope-ExtraBold.woff2` (800) in `src/app/fonts/`.
    - **Single variable file (smaller repo):** place `Manrope-Variable.woff2` (weight axis 200–800) and declare a `weight: '400 800'` range.
  - This plan uses the static-weight layout below to preserve the exact five weights the design already loads.

- [ ] **Step 2: Edit `src/app/layout.tsx`.** Replace the import and font construction:

```ts
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { ToastProvider } from '@/components/Toast';
import './globals.css';

const manrope = localFont({
  src: [
    { path: './fonts/Manrope-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Manrope-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Manrope-SemiBold.woff2', weight: '600', style: 'normal' },
    { path: './fonts/Manrope-Bold.woff2', weight: '700', style: 'normal' },
    { path: './fonts/Manrope-ExtraBold.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font',
  display: 'swap',
});
```

Leave `metadata`, `RootLayout`, and `<html lang="en" className={manrope.variable}>` unchanged. (If you chose the single variable file instead, use `src: [{ path: './fonts/Manrope-Variable.woff2', weight: '400 800', style: 'normal' }]`.)

- [ ] **Step 3: Confirm no Google Fonts reference remains**

Run: `grep -rn "next/font/google" src` — Expected: no matches.
Run: `ls src/app/fonts` — Expected: the five `.woff2` files present.

- [ ] **Step 4: Verify the build no longer needs network**

Run: `npm run build`
Expected: the build completes (previously it failed fetching Manrope). Because there is no automated test for build config, verification here is the successful build plus the grep in Step 3. Sanity-check that headings/body still render in Manrope by loading a page (`npm run dev`) — the `--font` variable is unchanged so `globals.css` continues to resolve it.

- [ ] **Step 5: Full suite** — `npm test && npm run typecheck` → PASS (font change does not affect the node-environment tests).

---

## Self-review checklist (run before handing off)

- [ ] **Every in-scope TEST finding maps to exactly one task:** TEST-1→T1, TEST-2→T2, TEST-3→T3, TEST-5→T4, TEST-6→T5, TEST-8→T6, TEST-7→T7, TEST-9→T8, TEST-10→T9, TEST-11→T10, TEST-BUILD-1→T11.
- [ ] **TEST-4 is explicitly out of scope** (owned by the P0 plan's `actions.ownership.test.ts`) and was not re-implemented.
- [ ] **No overlap with the P0 plan:** T1 tests the *domain* gate (P0 tests the *action* routing); T6 covers only draft/video/voice metering (P0 covers publish); T4 tests billing-sync *double-billing* (P0 tests cron *auth*). Confirmed none duplicate a P0 test file.
- [ ] **No test is vacuous:** every behavioral task (T1, T2, T3, T4, T5, T6, T7, T8, T9) has a mutation-check step proving the test goes RED under the exact regression the finding warns about. No `typeof fn` assertions remain (T8 deleted the two that existed).
- [ ] **Only two tasks touch production code, both minimally for testability:** T4 extracts `syncCampaignUsage` (behavior-preserving move); T11 swaps the font loader. T5 confirmed to need **no** refactor.
- [ ] **`npm test && npm run typecheck` is green after each task**; the 96 pre-existing tests still pass.
- [ ] **CI (T10) runs `npm ci && typecheck && test`** on push-to-main and every PR; the `build` step is deferred until T11 lands, and the pgTAP test (T7) is excluded from CI (no DB).
- [ ] **T11 font files are committed binaries** and `grep next/font/google src` returns nothing.
- [ ] **No autonomous git commits were made** — the user reviews and commits.
