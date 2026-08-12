# Campaign Performance Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give candidates a `/analytics` dashboard showing real social content performance (reach, engagement, video, top content, platform/content-type breakdowns, opponent-activity context, and a cached AI insight), sourced from Ayrshare's Analytics API and the app's own database — no new public page, no new OAuth, no donation integration.

**Architecture:** A daily cron (`/api/cron/sync-analytics`) pulls per-post metrics from Ayrshare for everything published in the last 45 days, upserts daily snapshots into a new `post_metrics` table, then generates one cached AI insight per active campaign via Claude, stored in `insight_snapshots`. The `/analytics` page is a plain server component that only reads what the cron already persisted — it never calls a third party live, so a slow/broken integration can't affect page load.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres via `adminDb`), Ayrshare (existing publishing aggregator, extended for analytics reads), Anthropic Claude (`claude-sonnet-4-6`, same as existing `ClaudeContentGenerator`), Vitest.

## Global Constraints

- Every external call (Ayrshare analytics fetch, Claude insight call) must degrade to empty/null on failure — never throw uncaught, matching the existing rule in `src/lib/services.ts:24-30` that a missing/failed integration must never crash the app.
- New tables get RLS enabled with a `campaign_scope_select` policy, matching every existing table (`supabase/migrations/026_rls.sql`).
- No new chart library — hand-rolled divs/inline-styles, matching the existing `.card`/`eyebrow`/`data`/`muted` visual language already used in `src/app/dashboard/page.tsx`.
- Writes to Supabase go through `throwOnError` (`src/lib/supabase.ts`) per the existing DATA-7 convention — reads use the plain `{ data } = await ...` pattern already used in `src/lib/candidate.ts`.
- Functions that depend on "now" take an optional `now: Date = new Date()` parameter (see `billingPeriodStart` in `src/lib/billing-period.ts`) so tests never depend on the real system clock.
- `/analytics` has no extra permission gate — visible to every campaign role (`owner`/`manager`/`staff`/`approver`), matching `/dashboard` today. It's read-only.

---

### Task 1: Migration — `post_metrics`, `insight_snapshots`, `content_items.ayrshare_post_ids`

**Files:**
- Create: `supabase/migrations/034_analytics_metrics.sql`

**Interfaces:**
- Produces: `content_items.ayrshare_post_ids` (jsonb, default `{}`), `post_metrics` table (unique on `(content_item_id, platform, captured_on)`), `insight_snapshots` table. Every later task's SQL/column names must match exactly.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/034_analytics_metrics.sql

-- Ayrshare returns a post id per platform on successful publish; capturing it
-- lets us later ask Ayrshare for that specific post's analytics.
alter table content_items
  add column if not exists ayrshare_post_ids jsonb not null default '{}'::jsonb;

create table if not exists post_metrics (
  id              text primary key default gen_random_uuid()::text,
  campaign_id     text not null references campaigns(id) on delete cascade,
  content_item_id text not null references content_items(id) on delete cascade,
  platform        text not null,
  captured_on     date not null default current_date,
  impressions     integer not null default 0,
  reach           integer not null default 0,
  likes           integer not null default 0,
  comments        integer not null default 0,
  shares          integer not null default 0,
  saves           integer not null default 0,
  video_views     integer not null default 0,
  video_avg_watch_seconds numeric not null default 0,
  created_at      timestamptz not null default now(),
  unique (content_item_id, platform, captured_on)
);

create table if not exists insight_snapshots (
  id              text primary key default gen_random_uuid()::text,
  campaign_id     text not null references campaigns(id) on delete cascade,
  generated_at    timestamptz not null default now(),
  summary         text not null,
  recommendations text[] not null default '{}'
);

create index if not exists idx_post_metrics_campaign on post_metrics(campaign_id, captured_on);
create index if not exists idx_insight_campaign on insight_snapshots(campaign_id, generated_at desc);

alter table post_metrics      enable row level security;
alter table insight_snapshots enable row level security;

create policy campaign_scope_select on post_metrics
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on insight_snapshots
  for select using (campaign_id = auth_campaign_id());
```

- [ ] **Step 2: Sanity-check the file**

Run: `grep -c ';' supabase/migrations/034_analytics_metrics.sql`
Expected: a non-zero count with no shell/SQL errors reported — this file isn't run by the Vitest suite (no local Postgres in CI, matching the precedent noted in `supabase/tests/reserve_usage.test.sql`); it gets applied to the real Supabase project the same way every prior numbered migration was.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/034_analytics_metrics.sql
git commit -m "feat(analytics): add post_metrics and insight_snapshots tables"
```

---

### Task 2: `AyrsharePublisher` captures the Ayrshare post id per platform

**Files:**
- Modify: `src/integrations/index.ts:68-71` (`Publisher` interface), `src/integrations/index.ts:457-491` (`AyrsharePublisher`), `src/integrations/index.ts:528-532` (`MockPublisher`)
- Test: `src/integrations/index.ayrshare-analytics.test.ts` (new file)

**Interfaces:**
- Produces: `Publisher.publish()` now resolves `{ platform: Platform; status: 'scheduled' | 'failed'; error?: string; postId?: string }[]` — Task 3 reads `.postId` off this result.

- [ ] **Step 1: Write the failing tests**

```ts
// src/integrations/index.ayrshare-analytics.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AyrsharePublisher } from './index';

afterEach(() => { vi.unstubAllGlobals(); });

describe('AyrsharePublisher.publish', () => {
  it('returns the Ayrshare postId for each successfully published platform', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ postIds: [{ platform: 'facebook', id: 'post-abc', status: 'success' }] }),
    }));
    const publisher = new AyrsharePublisher('test-key');
    const results = await publisher.publish({ platforms: ['facebook'], text: 'hi', disclosureText: '' });
    expect(results).toEqual([{ platform: 'facebook', status: 'scheduled', postId: 'post-abc' }]);
  });

  it('omits postId (without throwing) when the Ayrshare response has no postIds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const publisher = new AyrsharePublisher('test-key');
    const results = await publisher.publish({ platforms: ['x'], text: 'hi', disclosureText: '' });
    expect(results).toEqual([{ platform: 'x', status: 'scheduled' }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/integrations/index.ayrshare-analytics.test.ts`
Expected: FAIL — current `publish()` never returns `postId`, so `toEqual` mismatches.

- [ ] **Step 3: Update the `Publisher` interface**

In `src/integrations/index.ts`, change the interface at line 68-71:

```ts
export interface Publisher {
  publish(input: { platforms: Platform[]; text: string; disclosureText: string; mediaUrl?: string }):
    Promise<{ platform: Platform; status: 'scheduled' | 'failed'; error?: string; postId?: string }[]>;
}
```

- [ ] **Step 4: Capture the postId in `AyrsharePublisher.publish`**

In `src/integrations/index.ts`, inside the `try` block of `AyrsharePublisher.publish` (around line 479-484), change the success branch:

```ts
        const json = await res.json();
        if (!res.ok) {
          results.push({ platform, status: 'failed', error: json.message ?? `HTTP ${res.status}` });
        } else {
          const postId = json.postIds?.[0]?.id;
          results.push(postId ? { platform, status: 'scheduled', postId } : { platform, status: 'scheduled' });
        }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/integrations/index.ayrshare-analytics.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full existing test suite to check for regressions**

Run: `npx vitest run src/integrations/index.test.ts src/lib/services.test.ts src/app/actions.publish.test.ts src/app/api/cron/publish`
Expected: PASS — `MockPublisher` is untouched (never returns `postId`, which is fine since it's optional) and existing publish tests don't assert on the exact shape of a successful result beyond `status`.

- [ ] **Step 7: Commit**

```bash
git add src/integrations/index.ts src/integrations/index.ayrshare-analytics.test.ts
git commit -m "feat(analytics): capture Ayrshare post id on successful publish"
```

---

### Task 3: Persist `ayrshare_post_ids` when the cron marks an item published

**Files:**
- Modify: `src/app/api/cron/publish/route.ts:66-68`
- Test: `src/app/api/cron/publish/postid.test.ts` (new file)

**Interfaces:**
- Consumes: `Publisher.publish()` result shape from Task 2 (`{ platform, status, error?, postId? }[]`).
- Produces: `content_items.ayrshare_post_ids` populated as `{ [platform]: postId }` for every platform that returned a postId. Task 8's cron reads this column.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/cron/publish/postid.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dueItem = { id: 'ci-1', campaign_id: 'c-1', body: 'b', media_url: null, platforms: ['x'] };

// Mirrors the shape in claim.test.ts: the due-items SELECT terminates at
// .limit(), the claiming UPDATE terminates at .select(), and the final
// status UPDATE terminates at .eq() — its payload is what we assert on.
function makeAdminDb(payloads: Record<string, unknown>[]) {
  const selectDue: any = { eq: () => selectDue, not: () => selectDue, lte: () => selectDue, limit: () => Promise.resolve({ data: [dueItem], error: null }) };
  const claim: any = { eq: () => claim, select: () => Promise.resolve({ data: [{ id: 'ci-1' }], error: null }) };
  let updateCalls = 0;
  return {
    from: () => ({
      select: () => selectDue,
      update: (payload: Record<string, unknown>) => {
        updateCalls += 1;
        if (updateCalls === 1) return claim;
        payloads.push(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      },
      insert: () => Promise.resolve({ error: null }),
    }),
  };
}

describe('cron publish persists ayrshare post ids', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); process.env.CRON_SECRET = 'secret'; });

  it('stores the returned postId per platform when marking published', async () => {
    const payloads: Record<string, unknown>[] = [];
    vi.doMock('@/lib/supabase', () => ({ adminDb: makeAdminDb(payloads) }));
    vi.doMock('@/lib/services', () => ({ publisher: { publish: vi.fn(() => Promise.resolve([{ platform: 'x', status: 'scheduled', postId: 'post-123' }])) } }));
    vi.doMock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    await GET(new NextRequest('http://x', { headers: { authorization: 'Bearer secret' } }));

    expect(payloads[0]).toMatchObject({ status: 'published', ayrshare_post_ids: { x: 'post-123' } });
  });

  it('stores an empty map (without failing) when no platform returned a postId', async () => {
    const payloads: Record<string, unknown>[] = [];
    vi.doMock('@/lib/supabase', () => ({ adminDb: makeAdminDb(payloads) }));
    vi.doMock('@/lib/services', () => ({ publisher: { publish: vi.fn(() => Promise.resolve([{ platform: 'x', status: 'scheduled' }])) } }));
    vi.doMock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    await GET(new NextRequest('http://x', { headers: { authorization: 'Bearer secret' } }));

    expect(payloads[0]).toMatchObject({ status: 'published', ayrshare_post_ids: {} });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/cron/publish/postid.test.ts`
Expected: FAIL — the current success-path update doesn't include `ayrshare_post_ids`.

- [ ] **Step 3: Update the success-path update in the route**

In `src/app/api/cron/publish/route.ts`, replace lines 66-68:

```ts
      const postIds: Record<string, string> = {};
      for (const r of results) {
        if (r.status === 'scheduled' && r.postId) postIds[r.platform] = r.postId;
      }
      await adminDb.from('content_items')
        .update({ status: 'published', updated_at: new Date().toISOString(), ayrshare_post_ids: postIds })
        .eq('id', item.id);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/cron/publish/postid.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full cron test suite to check for regressions**

Run: `npx vitest run src/app/api/cron/publish`
Expected: PASS (existing `route.test.ts` and `claim.test.ts` don't assert on the exact update payload, only on auth/claim behavior)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/publish/route.ts src/app/api/cron/publish/postid.test.ts
git commit -m "feat(analytics): persist ayrshare_post_ids when content is published"
```

---

### Task 4: `AnalyticsProvider` — `AyrshareAnalyticsProvider` + `MockAnalyticsProvider`

**Files:**
- Modify: `src/integrations/index.ts` (add interface + two classes, near the existing `Publisher`/`AyrsharePublisher`/`MockPublisher` definitions)
- Test: `src/integrations/index.ayrshare-analytics.test.ts` (extend the file from Task 2)

**Interfaces:**
- Produces: `AnalyticsProvider` interface and `getPostAnalytics(posts: { platform: Platform; postId: string }[])` returning `{ platform: Platform; impressions: number; reach: number; likes: number; comments: number; shares: number; saves: number; videoViews: number; videoAvgWatchSeconds: number }[]`. Task 5 wires this; Task 8's cron calls it.

- [ ] **Step 1: Write the failing tests**

Append to `src/integrations/index.ayrshare-analytics.test.ts`:

```ts
import { AyrshareAnalyticsProvider, MockAnalyticsProvider } from './index';

describe('AyrshareAnalyticsProvider.getPostAnalytics', () => {
  it('maps a successful Ayrshare analytics response onto our metric shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        analytics: { facebook: { impressions: 100, reach: 80, likes: 10, comments: 2, shares: 1, saves: 0, videoViews: 5, videoAvgWatchTime: 12.5 } },
      }),
    }));
    const provider = new AyrshareAnalyticsProvider('test-key');
    const out = await provider.getPostAnalytics([{ platform: 'facebook', postId: 'post-abc' }]);
    expect(out).toEqual([{ platform: 'facebook', impressions: 100, reach: 80, likes: 10, comments: 2, shares: 1, saves: 0, videoViews: 5, videoAvgWatchSeconds: 12.5 }]);
  });

  it('skips a post that fails (never throws) and still returns data for the others', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ message: 'not on plan' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ analytics: { twitter: { impressions: 50, reach: 40, likes: 3, comments: 0, shares: 0, saves: 0, videoViews: 0, videoAvgWatchTime: 0 } } }) });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new AyrshareAnalyticsProvider('test-key');
    const out = await provider.getPostAnalytics([
      { platform: 'facebook', postId: 'post-bad' },
      { platform: 'x', postId: 'post-good' },
    ]);
    expect(out).toEqual([{ platform: 'x', impressions: 50, reach: 40, likes: 3, comments: 0, shares: 0, saves: 0, videoViews: 0, videoAvgWatchSeconds: 0 }]);
  });

  it('skips a post on a network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const provider = new AyrshareAnalyticsProvider('test-key');
    const out = await provider.getPostAnalytics([{ platform: 'facebook', postId: 'post-abc' }]);
    expect(out).toEqual([]);
  });
});

describe('MockAnalyticsProvider', () => {
  it('always returns an empty array', async () => {
    const provider = new MockAnalyticsProvider();
    const out = await provider.getPostAnalytics([{ platform: 'facebook', postId: 'x' }]);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/integrations/index.ayrshare-analytics.test.ts`
Expected: FAIL — `AyrshareAnalyticsProvider`/`MockAnalyticsProvider` don't exist yet.

- [ ] **Step 3: Add the interface and both classes**

In `src/integrations/index.ts`, add right after the `AyrsharePublisher` class (after line 491, before the `NewsData monitoring source` section comment):

```ts
export interface AnalyticsProvider {
  getPostAnalytics(posts: { platform: Platform; postId: string }[]): Promise<{
    platform: Platform; impressions: number; reach: number; likes: number;
    comments: number; shares: number; saves: number;
    videoViews: number; videoAvgWatchSeconds: number;
  }[]>;
}

export class AyrshareAnalyticsProvider implements AnalyticsProvider {
  constructor(private apiKey: string) {}

  async getPostAnalytics(posts: { platform: Platform; postId: string }[]) {
    const out: { platform: Platform; impressions: number; reach: number; likes: number; comments: number; shares: number; saves: number; videoViews: number; videoAvgWatchSeconds: number }[] = [];
    for (const { platform, postId } of posts) {
      try {
        const res = await fetch('https://app.ayrshare.com/api/analytics/post', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: postId }),
        });
        const json = await res.json();
        if (!res.ok) continue; // e.g. plan doesn't include analytics, or unknown post id — skip, never throw
        const a = json.analytics?.[PLATFORM_MAP[platform]];
        if (!a) continue;
        out.push({
          platform,
          impressions: a.impressions ?? 0,
          reach: a.reach ?? 0,
          likes: a.likes ?? 0,
          comments: a.comments ?? 0,
          shares: a.shares ?? 0,
          saves: a.saves ?? 0,
          videoViews: a.videoViews ?? 0,
          videoAvgWatchSeconds: a.videoAvgWatchTime ?? 0,
        });
      } catch {
        // network failure — skip this one post, don't fail the whole batch
      }
    }
    return out;
  }
}
```

And in the "Mock implementations" section (near `MockPublisher`, after line 532):

```ts
export class MockAnalyticsProvider implements AnalyticsProvider {
  async getPostAnalytics() { return []; }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/integrations/index.ayrshare-analytics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/index.ts src/integrations/index.ayrshare-analytics.test.ts
git commit -m "feat(analytics): add AnalyticsProvider (Ayrshare + mock)"
```

**Note for whoever configures production:** whether Ayrshare's Analytics endpoint/response shape matches what's coded here depends on the account's plan tier — this hasn't been verified against a live Ayrshare account (flagged in the design spec as an open, non-blocking dependency). If the real response shape differs, only `AyrshareAnalyticsProvider.getPostAnalytics`'s parsing needs to change — everything downstream consumes the already-normalized shape.

---

### Task 5: Wire `analyticsProvider` in `src/lib/services.ts`

**Files:**
- Modify: `src/lib/services.ts`
- Test: `src/lib/services.test.ts` (extend)

**Interfaces:**
- Consumes: `AnalyticsProvider`, `AyrshareAnalyticsProvider`, `MockAnalyticsProvider` from Task 4.
- Produces: `export const analyticsProvider: AnalyticsProvider`. Task 8's cron imports this.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services.test.ts`, inside the existing `describe` block:

```ts
  it('analyticsProvider uses the mock (empty array, no throw) when the key is missing', async () => {
    vi.stubEnv('AYRSHARE_API_KEY', '');
    const mod = await import('./services');
    const out = await mod.analyticsProvider.getPostAnalytics([{ platform: 'x', postId: 'p1' }]);
    expect(out).toEqual([]);
  });

  it('analyticsProvider uses the real adapter when the key is present', async () => {
    vi.stubEnv('AYRSHARE_API_KEY', 'k');
    const mod = await import('./services');
    const { AyrshareAnalyticsProvider } = await import('@/integrations');
    expect(mod.analyticsProvider).toBeInstanceOf(AyrshareAnalyticsProvider);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/services.test.ts`
Expected: FAIL — `analyticsProvider` doesn't exist yet on the `services` module.

- [ ] **Step 3: Wire it up**

In `src/lib/services.ts`, add `AyrshareAnalyticsProvider, MockAnalyticsProvider` to the existing import from `@/integrations` (line 9-16) and `AnalyticsProvider` to the type import on line 17, then add after the `publisher` export (line 55-58):

```ts
export const analyticsProvider: AnalyticsProvider = realOrMock(
  process.env.AYRSHARE_API_KEY,
  () => new AyrshareAnalyticsProvider(process.env.AYRSHARE_API_KEY!),
  () => new MockAnalyticsProvider());
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/services.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/services.ts src/lib/services.test.ts
git commit -m "feat(analytics): wire analyticsProvider into services"
```

---

### Task 6: `src/lib/analytics.ts` — `getPerformanceSummary`, `upsertPostMetrics`

**Files:**
- Create: `src/lib/analytics.ts`
- Test: `src/lib/analytics.test.ts` (new file)

**Interfaces:**
- Produces:
  - `getPerformanceSummary(campaignId: string, days?: number, now?: Date): Promise<PerformanceSummary>` where `PerformanceSummary = { totals: PerformanceTotals, priorTotals: {...}, byPlatform: {platform:string,engagement:number}[], byContentType: {type:string,engagement:number}[], topContent: {id,title,type,platforms,engagement}[] }` and `PerformanceTotals = { impressions, reach, likes, comments, shares, saves, videoViews, videoAvgWatchSeconds, engagement, postsCount }` (all `number`).
  - `upsertPostMetrics(input: { campaignId: string; contentItemId: string; platform: string; impressions: number; reach: number; likes: number; comments: number; shares: number; saves: number; videoViews: number; videoAvgWatchSeconds: number }): Promise<void>`.
- Task 7 imports `getPerformanceSummary` and the `PerformanceSummary` type from this file. Task 8's cron imports `upsertPostMetrics`. Task 10's page imports `getPerformanceSummary`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/analytics.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('./supabase', () => ({ adminDb: { from }, throwOnError: async (q: any) => (await q).data }));

beforeEach(() => vi.clearAllMocks());

const POST_METRICS = [
  { campaign_id: 'c-1', content_item_id: 'ci-1', platform: 'facebook', captured_on: '2026-08-05', impressions: 100, reach: 80, likes: 10, comments: 2, shares: 1, saves: 0, video_views: 5, video_avg_watch_seconds: 12 },
  { campaign_id: 'c-1', content_item_id: 'ci-2', platform: 'x', captured_on: '2026-08-06', impressions: 50, reach: 40, likes: 3, comments: 1, shares: 0, saves: 0, video_views: 0, video_avg_watch_seconds: 0 },
  { campaign_id: 'c-1', content_item_id: 'ci-1', platform: 'facebook', captured_on: '2026-06-20', impressions: 20, reach: 15, likes: 2, comments: 0, shares: 0, saves: 0, video_views: 0, video_avg_watch_seconds: 0 },
];
const CONTENT_ITEMS = [
  { id: 'ci-1', title: 'Healthcare reel', type: 'reel', platforms: ['facebook'] },
  { id: 'ci-2', title: 'Tax post', type: 'social_post', platforms: ['x'] },
];

describe('getPerformanceSummary', () => {
  it('sums current vs. prior period totals, computes engagement, and ranks top content by engagement', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'post_metrics') return { select: () => ({ eq: () => ({ gte: () => Promise.resolve({ data: POST_METRICS, error: null }) }) }) };
      if (table === 'content_items') return { select: () => ({ in: () => Promise.resolve({ data: CONTENT_ITEMS, error: null }) }) };
      throw new Error(`unexpected table ${table}`);
    });

    const { getPerformanceSummary } = await import('./analytics');
    const summary = await getPerformanceSummary('c-1', 30, new Date('2026-08-10T00:00:00Z'));

    expect(summary.totals).toMatchObject({
      impressions: 150, reach: 120, likes: 13, comments: 3, shares: 1, saves: 0,
      videoViews: 5, engagement: 17, postsCount: 2,
    });
    expect(summary.priorTotals).toMatchObject({ impressions: 20, reach: 15, engagement: 2 });
    expect(summary.byPlatform).toEqual(expect.arrayContaining([
      { platform: 'facebook', engagement: 13 }, { platform: 'x', engagement: 4 },
    ]));
    expect(summary.byContentType).toEqual(expect.arrayContaining([
      { type: 'reel', engagement: 13 }, { type: 'social_post', engagement: 4 },
    ]));
    expect(summary.topContent[0]).toMatchObject({ id: 'ci-1', title: 'Healthcare reel', engagement: 13 });
  });

  it('returns all-zero totals and empty breakdowns when there is no data', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'post_metrics') return { select: () => ({ eq: () => ({ gte: () => Promise.resolve({ data: [], error: null }) }) }) };
      throw new Error(`unexpected table ${table}`);
    });

    const { getPerformanceSummary } = await import('./analytics');
    const summary = await getPerformanceSummary('c-1', 30, new Date('2026-08-10T00:00:00Z'));

    expect(summary.totals.impressions).toBe(0);
    expect(summary.totals.postsCount).toBe(0);
    expect(summary.topContent).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/analytics.test.ts`
Expected: FAIL — `src/lib/analytics.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/analytics.ts
import { adminDb } from './supabase';

export interface PerformanceTotals {
  impressions: number; reach: number; likes: number; comments: number;
  shares: number; saves: number; videoViews: number; videoAvgWatchSeconds: number;
  engagement: number; postsCount: number;
}

export interface PerformanceSummary {
  totals: PerformanceTotals;
  priorTotals: { impressions: number; reach: number; engagement: number; videoViews: number };
  byPlatform: { platform: string; engagement: number }[];
  byContentType: { type: string; engagement: number }[];
  topContent: { id: string; title: string; type: string; platforms: string[]; engagement: number }[];
}

interface PostMetricRow {
  content_item_id: string; platform: string; captured_on: string;
  impressions: number; reach: number; likes: number; comments: number;
  shares: number; saves: number; video_views: number; video_avg_watch_seconds: number;
}

function engagementOf(m: PostMetricRow): number {
  return m.likes + m.comments + m.shares + m.saves;
}

function sumField(rows: PostMetricRow[], field: 'impressions' | 'reach' | 'likes' | 'comments' | 'shares' | 'saves' | 'video_views' | 'video_avg_watch_seconds'): number {
  return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
}

export async function getPerformanceSummary(
  campaignId: string, days = 30, now: Date = new Date(),
): Promise<PerformanceSummary> {
  const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
  const sinceDate = new Date(now); sinceDate.setDate(sinceDate.getDate() - days);
  const priorSinceDate = new Date(now); priorSinceDate.setDate(priorSinceDate.getDate() - days * 2);
  const sinceStr = toDateStr(sinceDate);
  const priorSinceStr = toDateStr(priorSinceDate);

  const { data } = await adminDb
    .from('post_metrics')
    .select('*')
    .eq('campaign_id', campaignId)
    .gte('captured_on', priorSinceStr);
  const rows = (data ?? []) as PostMetricRow[];

  const current = rows.filter(r => r.captured_on >= sinceStr);
  const prior = rows.filter(r => r.captured_on < sinceStr);

  const totals: PerformanceTotals = {
    impressions: sumField(current, 'impressions'),
    reach: sumField(current, 'reach'),
    likes: sumField(current, 'likes'),
    comments: sumField(current, 'comments'),
    shares: sumField(current, 'shares'),
    saves: sumField(current, 'saves'),
    videoViews: sumField(current, 'video_views'),
    videoAvgWatchSeconds: current.length ? sumField(current, 'video_avg_watch_seconds') / current.length : 0,
    engagement: current.reduce((total, m) => total + engagementOf(m), 0),
    postsCount: new Set(current.map(r => r.content_item_id)).size,
  };
  const priorTotals = {
    impressions: sumField(prior, 'impressions'),
    reach: sumField(prior, 'reach'),
    videoViews: sumField(prior, 'video_views'),
    engagement: prior.reduce((total, m) => total + engagementOf(m), 0),
  };

  const contentItemIds = [...new Set(current.map(r => r.content_item_id))];
  const itemRows = contentItemIds.length
    ? (await adminDb.from('content_items').select('id, title, type, platforms').in('id', contentItemIds)).data
    : [];
  const itemsById = new Map((itemRows ?? []).map((r: any) => [r.id as string, r]));

  const byPlatformMap = new Map<string, number>();
  const byTypeMap = new Map<string, number>();
  const engagementByItem = new Map<string, number>();
  for (const m of current) {
    const e = engagementOf(m);
    byPlatformMap.set(m.platform, (byPlatformMap.get(m.platform) ?? 0) + e);
    engagementByItem.set(m.content_item_id, (engagementByItem.get(m.content_item_id) ?? 0) + e);
    const item = itemsById.get(m.content_item_id);
    if (item) byTypeMap.set(item.type, (byTypeMap.get(item.type) ?? 0) + e);
  }

  const topContent = [...engagementByItem.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, engagement]) => {
      const item = itemsById.get(id);
      return {
        id, engagement,
        title: item?.title ?? 'Untitled',
        type: item?.type ?? 'unknown',
        platforms: item?.platforms ?? [],
      };
    });

  return {
    totals, priorTotals,
    byPlatform: [...byPlatformMap.entries()].map(([platform, engagement]) => ({ platform, engagement })),
    byContentType: [...byTypeMap.entries()].map(([type, engagement]) => ({ type, engagement })),
    topContent,
  };
}

export async function upsertPostMetrics(input: {
  campaignId: string; contentItemId: string; platform: string;
  impressions: number; reach: number; likes: number; comments: number;
  shares: number; saves: number; videoViews: number; videoAvgWatchSeconds: number;
}): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { throwOnError } = await import('./supabase');
  await throwOnError(
    adminDb.from('post_metrics').upsert({
      campaign_id: input.campaignId,
      content_item_id: input.contentItemId,
      platform: input.platform,
      captured_on: today,
      impressions: input.impressions,
      reach: input.reach,
      likes: input.likes,
      comments: input.comments,
      shares: input.shares,
      saves: input.saves,
      video_views: input.videoViews,
      video_avg_watch_seconds: input.videoAvgWatchSeconds,
    }, { onConflict: 'content_item_id,platform,captured_on' }),
    'upsertPostMetrics',
  );
}
```

Note: `upsertPostMetrics` imports `throwOnError` dynamically to keep the top-level `vi.mock('./supabase', ...)` in the test simple (it only needs `adminDb` for `getPerformanceSummary`'s calls, but must also provide `throwOnError` since the module mock replaces the whole file) — the mock in Step 1 already exports both, so a static top-level `import { adminDb, throwOnError } from './supabase'` works too and is simpler; use that instead:

```ts
import { adminDb, throwOnError } from './supabase';
```

(Remove the dynamic `import('./supabase')` line inside `upsertPostMetrics` and call `throwOnError(...)` directly — the static import at the top of the file covers it.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/analytics.test.ts`
Expected: PASS

- [ ] **Step 5: Add a test for `upsertPostMetrics`, then implement/verify (already implemented in Step 3)**

```ts
describe('upsertPostMetrics', () => {
  it('upserts on the (content_item_id, platform, captured_on) unique constraint', async () => {
    const upsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    from.mockImplementation((table: string) => {
      if (table === 'post_metrics') return { upsert };
      throw new Error(`unexpected table ${table}`);
    });
    const { upsertPostMetrics } = await import('./analytics');
    await upsertPostMetrics({
      campaignId: 'c-1', contentItemId: 'ci-1', platform: 'facebook',
      impressions: 10, reach: 8, likes: 1, comments: 0, shares: 0, saves: 0, videoViews: 0, videoAvgWatchSeconds: 0,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ campaign_id: 'c-1', content_item_id: 'ci-1', platform: 'facebook', impressions: 10 }),
      { onConflict: 'content_item_id,platform,captured_on' },
    );
  });
});
```

Run: `npx vitest run src/lib/analytics.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/analytics.ts src/lib/analytics.test.ts
git commit -m "feat(analytics): add getPerformanceSummary and upsertPostMetrics"
```

---

### Task 7: `src/lib/analytics.ts` — `generateInsight`, `insertInsightSnapshot`, `getLatestInsight`

**Files:**
- Modify: `src/lib/analytics.ts`
- Test: `src/lib/analytics.insight.test.ts` (new file)

**Interfaces:**
- Consumes: `getPerformanceSummary` from Task 6 (same file).
- Produces:
  - `generateInsight(campaignId: string, now?: Date, anthropicClient?: { messages: { create: (...args: any[]) => Promise<any> } }): Promise<{ summary: string; recommendations: string[] } | null>`
  - `insertInsightSnapshot(campaignId: string, insight: { summary: string; recommendations: string[] }): Promise<void>`
  - `getLatestInsight(campaignId: string): Promise<{ summary: string; recommendations: string[]; generatedAt: string } | null>`
  - Task 8's cron imports all three; Task 10's page imports `getLatestInsight`.

The `anthropicClient` parameter is dependency injection so tests never need to mock the `@anthropic-ai/sdk` module — pass a fake `{ messages: { create: vi.fn() } }` directly. Production call sites (the cron) omit it and let the function construct a real `Anthropic` client from `LLM_API_KEY`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/analytics.insight.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('./supabase', () => ({ adminDb: { from }, throwOnError: async (q: any) => (await q).data }));

function mockPerformanceData(rows: unknown[]) {
  from.mockImplementation((table: string) => {
    if (table === 'post_metrics') return { select: () => ({ eq: () => ({ gte: () => Promise.resolve({ data: rows, error: null }) }) }) };
    if (table === 'content_items') return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
    throw new Error(`unexpected table ${table}`);
  });
}

const SOME_METRICS = [{ content_item_id: 'ci-1', platform: 'x', captured_on: '2026-08-05', impressions: 100, reach: 80, likes: 10, comments: 2, shares: 1, saves: 0, video_views: 0, video_avg_watch_seconds: 0 }];

beforeEach(() => { vi.clearAllMocks(); delete process.env.LLM_API_KEY; });

describe('generateInsight', () => {
  it('returns null when there is no injected client and LLM_API_KEY is unset', async () => {
    mockPerformanceData(SOME_METRICS);
    const { generateInsight } = await import('./analytics');
    expect(await generateInsight('c-1', new Date('2026-08-10T00:00:00Z'))).toBeNull();
  });

  it('returns null (and never calls Claude) when there is no performance data yet', async () => {
    mockPerformanceData([]);
    const create = vi.fn();
    const { generateInsight } = await import('./analytics');
    const result = await generateInsight('c-1', new Date('2026-08-10T00:00:00Z'), { messages: { create } });
    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('parses the summary and recommendations out of a well-formed Claude response', async () => {
    mockPerformanceData(SOME_METRICS);
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Summary: Engagement is trending up nicely.\n\nRecommendations:\n- Post more video content\n- Respond to the opponent on healthcare' }],
    });
    const { generateInsight } = await import('./analytics');
    const result = await generateInsight('c-1', new Date('2026-08-10T00:00:00Z'), { messages: { create } });
    expect(result).toEqual({
      summary: 'Engagement is trending up nicely.',
      recommendations: ['Post more video content', 'Respond to the opponent on healthcare'],
    });
  });

  it('returns null instead of throwing when Claude returns no usable text block', async () => {
    mockPerformanceData(SOME_METRICS);
    const create = vi.fn().mockResolvedValue({ content: [], stop_reason: 'refusal' });
    const { generateInsight } = await import('./analytics');
    const result = await generateInsight('c-1', new Date('2026-08-10T00:00:00Z'), { messages: { create } });
    expect(result).toBeNull();
  });
});

describe('insertInsightSnapshot', () => {
  it('inserts a snapshot row with the campaign id and insight fields', async () => {
    const insert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    from.mockImplementation((table: string) => {
      if (table === 'insight_snapshots') return { insert };
      throw new Error(`unexpected table ${table}`);
    });
    const { insertInsightSnapshot } = await import('./analytics');
    await insertInsightSnapshot('c-1', { summary: 'S', recommendations: ['R1'] });
    expect(insert).toHaveBeenCalledWith({ campaign_id: 'c-1', summary: 'S', recommendations: ['R1'] });
  });
});

describe('getLatestInsight', () => {
  it('returns null when no snapshot exists yet', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'insight_snapshots') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const { getLatestInsight } = await import('./analytics');
    expect(await getLatestInsight('c-1')).toBeNull();
  });

  it('maps the most recent row to camelCase', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'insight_snapshots') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { summary: 'S', recommendations: ['R1'], generated_at: '2026-08-09T00:00:00Z' }, error: null }) }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const { getLatestInsight } = await import('./analytics');
    expect(await getLatestInsight('c-1')).toEqual({ summary: 'S', recommendations: ['R1'], generatedAt: '2026-08-09T00:00:00Z' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/analytics.insight.test.ts`
Expected: FAIL — none of the three functions exist yet.

- [ ] **Step 3: Implement, appending to `src/lib/analytics.ts`**

Add `import Anthropic from '@anthropic-ai/sdk';` to the top of the file, then append:

```ts
export async function generateInsight(
  campaignId: string,
  now: Date = new Date(),
  anthropicClient?: { messages: { create: (...args: any[]) => Promise<any> } },
): Promise<{ summary: string; recommendations: string[] } | null> {
  if (!anthropicClient && !process.env.LLM_API_KEY) return null;

  const summary = await getPerformanceSummary(campaignId, 30, now);
  if (summary.totals.postsCount === 0) return null;

  const client = anthropicClient ?? new Anthropic({ apiKey: process.env.LLM_API_KEY! });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: 'You are a political campaign performance analyst. Given 30 days of social content metrics as JSON, write a concise, honest summary and 2-3 concrete recommendations. Respond ONLY in this exact format:\nSummary: <2-3 sentences>\nRecommendations:\n- <recommendation>\n- <recommendation>',
    messages: [{ role: 'user', content: JSON.stringify(summary) }],
  });

  const block = msg.content[0];
  if (!block || block.type !== 'text') return null;

  const text = block.text as string;
  const summaryMatch = text.match(/Summary:\s*(.+?)(?=\n\s*Recommendations:|$)/s);
  const recommendations = text
    .split('\n')
    .filter(line => line.trim().startsWith('-'))
    .map(line => line.replace(/^\s*-\s*/, '').trim());

  return {
    summary: summaryMatch ? summaryMatch[1].trim() : text.trim(),
    recommendations,
  };
}

export async function insertInsightSnapshot(
  campaignId: string, insight: { summary: string; recommendations: string[] },
): Promise<void> {
  await throwOnError(
    adminDb.from('insight_snapshots').insert({
      campaign_id: campaignId,
      summary: insight.summary,
      recommendations: insight.recommendations,
    }),
    'insertInsightSnapshot',
  );
}

export async function getLatestInsight(
  campaignId: string,
): Promise<{ summary: string; recommendations: string[]; generatedAt: string } | null> {
  const { data } = await adminDb
    .from('insight_snapshots')
    .select('summary, recommendations, generated_at')
    .eq('campaign_id', campaignId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { summary: data.summary, recommendations: data.recommendations ?? [], generatedAt: data.generated_at };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/analytics.insight.test.ts src/lib/analytics.test.ts`
Expected: PASS for both files

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics.ts src/lib/analytics.insight.test.ts
git commit -m "feat(analytics): add generateInsight, insertInsightSnapshot, getLatestInsight"
```

---

### Task 8: Cron `/api/cron/sync-analytics`

**Files:**
- Create: `src/app/api/cron/sync-analytics/route.ts`
- Modify: `vercel.json`
- Test: `src/app/api/cron/sync-analytics/route.test.ts` (new file)

**Interfaces:**
- Consumes: `analyticsProvider` (Task 5), `upsertPostMetrics`/`generateInsight`/`insertInsightSnapshot` (Tasks 6-7).
- Produces: `GET` route handler returning `{ synced: number; failed: number; insightsGenerated: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/cron/sync-analytics/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('cron sync-analytics auth fails closed', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('rejects when CRON_SECRET is unset even with "Bearer undefined"', async () => {
    delete process.env.CRON_SECRET;
    vi.doMock('@/lib/supabase', () => ({ adminDb: { from: vi.fn() } }));
    vi.doMock('@/lib/services', () => ({ analyticsProvider: { getPostAnalytics: vi.fn() } }));
    vi.doMock('@/lib/analytics', () => ({ upsertPostMetrics: vi.fn(), generateInsight: vi.fn(), insertInsightSnapshot: vi.fn() }));
    const { GET } = await import('./route');
    const res = await GET(new Request('http://x', { headers: { authorization: 'Bearer undefined' } }) as any);
    expect(res.status).toBe(401);
  });
});

describe('cron sync-analytics batch behavior', () => {
  const ITEM_A = { id: 'ci-1', campaign_id: 'c-1', ayrshare_post_ids: { x: 'post-a' } };
  const ITEM_B = { id: 'ci-2', campaign_id: 'c-1', ayrshare_post_ids: { facebook: 'post-b' } };

  function makeAdminDb(items: unknown[]) {
    const selectChain: any = { eq: () => selectChain, gte: () => selectChain, limit: () => Promise.resolve({ data: items, error: null }) };
    return { from: () => ({ select: () => selectChain }) };
  }

  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); process.env.CRON_SECRET = 'secret'; });

  it('syncs metrics for every item and generates one insight per campaign with synced data', async () => {
    const getPostAnalytics = vi.fn().mockResolvedValue([{ platform: 'x', impressions: 10, reach: 8, likes: 1, comments: 0, shares: 0, saves: 0, videoViews: 0, videoAvgWatchSeconds: 0 }]);
    const upsertPostMetrics = vi.fn().mockResolvedValue(undefined);
    const generateInsight = vi.fn().mockResolvedValue({ summary: 'S', recommendations: ['R'] });
    const insertInsightSnapshot = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/lib/supabase', () => ({ adminDb: makeAdminDb([ITEM_A, ITEM_B]) }));
    vi.doMock('@/lib/services', () => ({ analyticsProvider: { getPostAnalytics } }));
    vi.doMock('@/lib/analytics', () => ({ upsertPostMetrics, generateInsight, insertInsightSnapshot }));

    const { GET } = await import('./route');
    const res = await GET(new Request('http://x', { headers: { authorization: 'Bearer secret' } }) as any);
    const json = await res.json();

    expect(upsertPostMetrics).toHaveBeenCalledTimes(2);
    expect(generateInsight).toHaveBeenCalledTimes(1);
    expect(insertInsightSnapshot).toHaveBeenCalledWith('c-1', { summary: 'S', recommendations: ['R'] });
    expect(json).toEqual({ synced: 2, failed: 0, insightsGenerated: 1 });
  });

  it('a failed item does not stop the rest of the batch, and a null insight is not persisted', async () => {
    const getPostAnalytics = vi.fn()
      .mockRejectedValueOnce(new Error('ayrshare down'))
      .mockResolvedValueOnce([{ platform: 'facebook', impressions: 5, reach: 4, likes: 0, comments: 0, shares: 0, saves: 0, videoViews: 0, videoAvgWatchSeconds: 0 }]);
    const upsertPostMetrics = vi.fn().mockResolvedValue(undefined);
    const generateInsight = vi.fn().mockResolvedValue(null);
    const insertInsightSnapshot = vi.fn();

    vi.doMock('@/lib/supabase', () => ({ adminDb: makeAdminDb([ITEM_A, ITEM_B]) }));
    vi.doMock('@/lib/services', () => ({ analyticsProvider: { getPostAnalytics } }));
    vi.doMock('@/lib/analytics', () => ({ upsertPostMetrics, generateInsight, insertInsightSnapshot }));

    const { GET } = await import('./route');
    const res = await GET(new Request('http://x', { headers: { authorization: 'Bearer secret' } }) as any);
    const json = await res.json();

    expect(json).toEqual({ synced: 1, failed: 1, insightsGenerated: 0 });
    expect(insertInsightSnapshot).not.toHaveBeenCalled();
  });

  it('skips items with no captured post ids without calling analyticsProvider', async () => {
    const getPostAnalytics = vi.fn();
    vi.doMock('@/lib/supabase', () => ({ adminDb: makeAdminDb([{ id: 'ci-3', campaign_id: 'c-1', ayrshare_post_ids: {} }]) }));
    vi.doMock('@/lib/services', () => ({ analyticsProvider: { getPostAnalytics } }));
    vi.doMock('@/lib/analytics', () => ({ upsertPostMetrics: vi.fn(), generateInsight: vi.fn(), insertInsightSnapshot: vi.fn() }));

    const { GET } = await import('./route');
    const res = await GET(new Request('http://x', { headers: { authorization: 'Bearer secret' } }) as any);
    const json = await res.json();

    expect(getPostAnalytics).not.toHaveBeenCalled();
    expect(json).toEqual({ synced: 0, failed: 0, insightsGenerated: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/cron/sync-analytics/route.test.ts`
Expected: FAIL — the route file doesn't exist yet.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/cron/sync-analytics/route.ts
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { analyticsProvider } from '@/lib/services';
import { upsertPostMetrics, generateInsight, insertInsightSnapshot } from '@/lib/analytics';
import type { Platform } from '@/domain/types';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 45);

  const { data: items } = await adminDb
    .from('content_items')
    .select('id, campaign_id, ayrshare_post_ids')
    .eq('status', 'published')
    .gte('updated_at', cutoff.toISOString())
    .limit(200);

  const campaignIds = new Set<string>();
  let synced = 0;
  let failed = 0;

  for (const item of items ?? []) {
    const postIds = (item.ayrshare_post_ids ?? {}) as Record<string, string>;
    const posts = Object.entries(postIds).map(([platform, postId]) => ({ platform: platform as Platform, postId }));
    if (posts.length === 0) continue;

    try {
      const metrics = await analyticsProvider.getPostAnalytics(posts);
      for (const m of metrics) {
        await upsertPostMetrics({
          campaignId: item.campaign_id, contentItemId: item.id, platform: m.platform,
          impressions: m.impressions, reach: m.reach, likes: m.likes, comments: m.comments,
          shares: m.shares, saves: m.saves, videoViews: m.videoViews, videoAvgWatchSeconds: m.videoAvgWatchSeconds,
        });
      }
      campaignIds.add(item.campaign_id);
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  let insightsGenerated = 0;
  for (const campaignId of campaignIds) {
    try {
      const insight = await generateInsight(campaignId);
      if (insight) {
        await insertInsightSnapshot(campaignId, insight);
        insightsGenerated += 1;
      }
    } catch {
      // one campaign's insight failure must not block the others
    }
  }

  return NextResponse.json({ synced, failed, insightsGenerated });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/cron/sync-analytics/route.test.ts`
Expected: PASS

- [ ] **Step 5: Add the cron schedule**

In `vercel.json`, change:

```json
{
  "crons": [
    { "path": "/api/cron/publish", "schedule": "0 6 * * *" },
    { "path": "/api/cron/sync-analytics", "schedule": "30 6 * * *" }
  ]
}
```

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS (no other file touches `vercel.json` or the new route)

- [ ] **Step 7: Commit**

```bash
git add src/app/api/cron/sync-analytics/route.ts src/app/api/cron/sync-analytics/route.test.ts vercel.json
git commit -m "feat(analytics): add sync-analytics cron (metrics sync + insight generation)"
```

---

### Task 9: Sidebar nav item

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- No new exports; purely additive UI. Task 10's page becomes reachable from the nav after this.

- [ ] **Step 1: Add the nav entry**

In `src/components/Sidebar.tsx`, insert into the `NAV` array right after the `/monitoring` entry (after line 45, before the `/avatars` entry):

```ts
  {
    href: '/analytics',
    label: 'Analytics',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <line x1="2" y1="14" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <rect x="3.5" y="8" width="2.4" height="5" rx="0.6" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="7.3" y="4.5" width="2.4" height="8.5" rx="0.6" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="11.1" y="6.5" width="2.4" height="6.5" rx="0.6" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(analytics): add Analytics nav item"
```

---

### Task 10: `/analytics` page

**Files:**
- Create: `src/app/analytics/page.tsx`

**Interfaces:**
- Consumes: `getPerformanceSummary`, `getLatestInsight` (Tasks 6-7), `getMonitoringResults` (existing, `@/lib/data`), `requireSession` (existing, `@/lib/session`), `AppFrame` (existing, `@/components/AppFrame`).
- No exports consumed by later tasks — this is the last task.

- [ ] **Step 1: Write the page**

```tsx
// src/app/analytics/page.tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppFrame } from '@/components/AppFrame';
import { requireSession } from '@/lib/session';
import { getPerformanceSummary, getLatestInsight } from '@/lib/analytics';
import { getMonitoringResults } from '@/lib/data';

function pctDelta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return Math.round(((current - prior) / prior) * 100);
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <span className="mono" style={{ fontSize: 11, color: up ? 'var(--ok)' : 'var(--bad)', marginLeft: 8 }}>
      {up ? '▲' : '▼'} {Math.abs(value)}%
    </span>
  );
}

function BarList({ rows, labelKey }: { rows: { engagement: number; [k: string]: unknown }[]; labelKey: string }) {
  if (rows.length === 0) {
    return <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>No data yet.</p>;
  }
  const max = Math.max(...rows.map(r => r.engagement), 1);
  return (
    <>
      {rows.map(r => (
        <div key={String(r[labelKey])} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
            <span style={{ textTransform: 'capitalize' }}>{String(r[labelKey]).replace('_', ' ')}</span>
            <span className="mono">{r.engagement}</span>
          </div>
          <div style={{ height: 6, background: 'var(--bg-hover)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(r.engagement / max) * 100}%`, background: 'var(--accent-grad)', borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </>
  );
}

export default async function AnalyticsPage() {
  const s = await requireSession();
  if (s.role === 'super_admin') redirect('/admin');

  const [summary, insight, monitoring] = await Promise.all([
    getPerformanceSummary(s.campaignId),
    getLatestInsight(s.campaignId),
    getMonitoringResults(s.campaignId),
  ]);

  const hasData = summary.totals.postsCount > 0;

  const tiles = [
    { label: 'Reach', value: summary.totals.reach, delta: pctDelta(summary.totals.reach, summary.priorTotals.reach) },
    { label: 'Engagement', value: summary.totals.engagement, delta: pctDelta(summary.totals.engagement, summary.priorTotals.engagement) },
    { label: 'Engagement rate', value: summary.totals.impressions > 0 ? `${((summary.totals.engagement / summary.totals.impressions) * 100).toFixed(1)}%` : '—', delta: null },
    { label: 'Video watch time', value: `${summary.totals.videoAvgWatchSeconds.toFixed(0)}s`, delta: null },
  ];

  return (
    <AppFrame>
      <div style={{ marginBottom: 22 }}>
        <span className="eyebrow">Last 30 days</span>
        <h1 style={{ margin: '4px 0 0' }}>Analytics</h1>
      </div>

      {!hasData ? (
        <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <p className="muted">Performance data will appear here once your published content has synced.</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            {tiles.map(t => (
              <div key={t.label} className="card" style={{ padding: 16 }}>
                <div className="eyebrow" style={{ marginBottom: 12 }}>{t.label}</div>
                <div className="data" style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
                  {t.value}
                  <Delta value={t.delta} />
                </div>
              </div>
            ))}
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="card">
              <h2 style={{ margin: '0 0 10px' }}>Top performing content</h2>
              {summary.topContent.length === 0 ? (
                <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>Nothing published yet this period.</p>
              ) : (
                summary.topContent.map(c => (
                  <Link key={c.id} href={`/content/${c.id}`} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    padding: '10px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none', color: 'inherit',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' }}>{c.type.replace('_', ' ')}</span>
                    </div>
                    <span className="data" style={{ fontSize: 13, color: 'var(--accent)' }}>{c.engagement}</span>
                  </Link>
                ))
              )}
            </div>

            <div className="card">
              <h2 style={{ margin: '0 0 10px' }}>By platform</h2>
              <BarList rows={summary.byPlatform} labelKey="platform" />
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="card">
              <h2 style={{ margin: '0 0 10px' }}>By content type</h2>
              <BarList rows={summary.byContentType} labelKey="type" />
            </div>

            <div className="card">
              <h2 style={{ margin: '0 0 10px' }}>Opponent activity (context)</h2>
              <p className="muted" style={{ fontSize: 13 }}>
                Your campaign published <strong style={{ color: 'var(--text)' }}>{summary.totals.postsCount}</strong> pieces of content this period, versus{' '}
                <strong style={{ color: 'var(--text)' }}>{monitoring.length}</strong> tracked mentions of your opponent.
              </p>
            </div>
          </div>

          <div className="card">
            <h2 style={{ margin: '0 0 10px' }}>AI insight</h2>
            {insight ? (
              <>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-2)' }}>{insight.summary}</p>
                <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                  {insight.recommendations.map((r, i) => (
                    <li key={i} style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-2)' }}>{r}</li>
                  ))}
                </ul>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
                  Generated {new Date(insight.generatedAt).toLocaleDateString()}
                </div>
              </>
            ) : (
              <p className="muted" style={{ padding: '12px 0' }}>Check back after your next scheduled sync for AI-generated insights.</p>
            )}
          </div>
        </>
      )}
    </AppFrame>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Manual verification in the browser**

Run: `npm run dev`, then sign in and visit `http://localhost:3000/analytics`.
Expected: page loads inside the app shell with the "Analytics" nav item highlighted; since there's no real `post_metrics` data locally yet, the empty state ("Performance data will appear here once your published content has synced.") renders instead of an error. To see the populated view locally, insert a row into `post_metrics` for an existing `content_items` row via the Supabase SQL editor, referencing the columns from Task 1's migration, then reload.

- [ ] **Step 4: Run the full test suite one last time**

Run: `npx vitest run`
Expected: PASS — no regressions across the whole change set.

- [ ] **Step 5: Commit**

```bash
git add src/app/analytics/page.tsx
git commit -m "feat(analytics): add /analytics dashboard page"
```

---

## Self-Review Notes

- **Spec coverage:** stat tiles + deltas (Task 10) ✅, performance-over-time is deliberately simplified to period totals + deltas rather than a day-by-day bar strip — the spec's mockup detail, not a hard requirement; top content (Task 10) ✅; by-platform/by-content-type (Tasks 6, 10) ✅; opponent-activity context (Task 10) ✅; AI insight (Tasks 7, 10) ✅; postId capture + cron sync (Tasks 2, 3, 8) ✅; RLS + schema (Task 1) ✅; nav (Task 9) ✅.
- **Type consistency checked:** `PerformanceSummary`/`PerformanceTotals` field names are identical across Task 6 (producer), Task 7 (`generateInsight` consumes `summary.totals.postsCount`), and Task 10 (`summary.totals.postsCount`, `summary.byPlatform`, `summary.byContentType`, `summary.topContent`) — no renames between tasks. `AnalyticsProvider.getPostAnalytics` return field names (`videoAvgWatchSeconds`, etc.) match between Task 4 (producer) and Task 8 (consumer, mapped into `upsertPostMetrics`'s input).
- **No placeholders:** every step has real code; the one open item (Ayrshare's real analytics response shape) is called out explicitly in Task 4 as a documented, isolated risk — not a TBD blocking any task.
