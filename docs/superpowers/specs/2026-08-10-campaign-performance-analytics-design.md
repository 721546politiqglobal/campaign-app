# Campaign Performance Analytics Dashboard — Design Spec

**Date:** 2026-08-10
**Status:** Approved

---

## Overview

The candidate has no way today to see how their campaign is actually performing on social media. `/dashboard` (`src/app/dashboard/page.tsx`) is a content-*operations* view — KPI tiles for review/scheduled/published counts, opponent signal count, spend — not performance data. There is no analytics of any kind in the codebase: no `@vercel/analytics`, no PostHog/GA, no custom event tracking, no `page_views`/`events` tables.

Critically, there is also **no owned public candidate page** (no route with Issues/Videos/Bio/Donate/Volunteer sections) and content is never posted to a page the app controls — it's pushed out to the candidate's own Facebook/Instagram/X/YouTube/TikTok accounts via **Ayrshare** (`AyrsharePublisher`, `src/integrations/index.ts:457`), a social-posting aggregator, invoked from the daily `/api/cron/publish` cron. There's also no donation-processor integration (confirmed: no ActBlue/WinRed/Stripe-donations anywhere).

This rules out classic web-analytics metrics (page views, unique/returning visitors, time-on-page, section views, button-click funnels, visitor device/geo) — there is no page to instrument. What's real and buildable for v1 is **social content performance**, sourced from three places:

1. **Ayrshare's Analytics API** — reach/engagement/video metrics for posts Ayrshare already published on the candidate's behalf. Same API key already used for publishing; no new OAuth needed.
2. **The app's own database** — `content_items` (type, status, timing), `monitoring_results` (opponent activity) — already collected for other features.
3. **The app's existing Anthropic integration** — used to generate a plain-language weekly insight + recommendations from (1) and (2), the same way `ClaudeContentGenerator` (`src/integrations/index.ts:80`) already calls Claude for content drafting.

This spec covers v1 only: a new `/analytics` page showing content performance, sourced entirely from data the app can get today without a new public page or a donation integration.

---

## Current State vs. New State

| | Today | After this spec |
|---|---|---|
| Candidate-facing performance data | None | New `/analytics` page: reach, engagement, video performance, top content, breakdowns by platform/content type, opponent-activity context, AI insight |
| Ayrshare usage | Write-only (publish) | Also read (post-level analytics) |
| `content_items` | No record of the Ayrshare post id(s) created on publish | Stores `ayrshare_post_ids` so analytics can be fetched per post later |
| Crons | `/api/cron/publish` only | Adds `/api/cron/sync-analytics` (metrics sync + insight generation) |
| Nav | Dashboard / Content / Monitoring / Avatars / Team / Settings / Billing | Adds "Analytics" between Monitoring and Avatars |

---

## Scope Correction from the Original Ask

The original list included "most viewed sections (Issues, Videos, Biography, Events)" and a Donate/Volunteer/Contact click funnel. Neither is possible without an owned page and a donation integration (discussed and confirmed out of scope for v1). Also, `content_items` has no per-post "issue/topic" tag today (only `type: reel|social_post|press_release|ad_copy|talking_points` and `targetJurisdictions`) — so "performance by section" becomes **performance by content type** in v1, which is the honest equivalent of what the data actually supports.

---

## Data Model

New migration `supabase/migrations/034_analytics_metrics.sql`:

```sql
-- Ayrshare returns a post id per platform on successful publish; we need it
-- later to ask Ayrshare for that specific post's analytics.
alter table content_items
  add column if not exists ayrshare_post_ids jsonb not null default '{}'::jsonb;

create table if not exists post_metrics (
  id            text primary key default gen_random_uuid()::text,
  campaign_id   text not null references campaigns(id) on delete cascade,
  content_item_id text not null references content_items(id) on delete cascade,
  platform      text not null,
  captured_on   date not null default current_date,
  impressions   integer not null default 0,
  reach         integer not null default 0,
  likes         integer not null default 0,
  comments      integer not null default 0,
  shares        integer not null default 0,
  saves         integer not null default 0,
  video_views   integer not null default 0,
  video_avg_watch_seconds numeric not null default 0,
  created_at    timestamptz not null default now(),
  unique (content_item_id, platform, captured_on)
);

create table if not exists insight_snapshots (
  id            text primary key default gen_random_uuid()::text,
  campaign_id   text not null references campaigns(id) on delete cascade,
  generated_at  timestamptz not null default now(),
  summary       text not null,
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

`post_metrics` is a daily snapshot (not an overwrite-in-place row) so the dashboard can show trends over time, matching the existing `monitoring_results`/`usage_events` time-series style already in the schema. `unique(content_item_id, platform, captured_on)` makes the daily sync idempotent via upsert.

---

## Backend

### 1. Capture the Ayrshare post id on publish

`AyrsharePublisher.publish()` (`src/integrations/index.ts:460`) currently discards Ayrshare's response body on success. It's extended to also return the post id Ayrshare assigns per platform:

```ts
results.push({ platform, status: 'scheduled', postId: json.postIds?.[0]?.id });
```

`/api/cron/publish/route.ts` — when marking an item `published` (line 66-68), also merges the returned `postId`s into `content_items.ayrshare_post_ids` (`{ [platform]: postId }`), skipping any platform that didn't return one (never blocks the publish itself on a missing id).

### 2. New `AnalyticsProvider` integration

New interface + two implementations in `src/integrations/index.ts`, following the exact `Publisher`/`AyrsharePublisher`/`MockPublisher` pattern already established:

```ts
export interface AnalyticsProvider {
  getPostAnalytics(posts: { platform: Platform; postId: string }[]): Promise<{
    platform: Platform; impressions: number; reach: number; likes: number;
    comments: number; shares: number; saves: number;
    videoViews: number; videoAvgWatchSeconds: number;
  }[]>;
}
```

- `AyrshareAnalyticsProvider` — calls Ayrshare's analytics endpoint per post id, maps the response onto the shape above. On any per-post failure (HTTP error, plan doesn't include analytics, unknown post id), that post is skipped with zeros logged — never throws, matching the "a missing/failed integration must never crash the app" rule already documented in `src/lib/services.ts:24-30`.
- `MockAnalyticsProvider` — returns `[]` for every call. Used automatically whenever `AYRSHARE_API_KEY` is unset, same `realOrMock()` wiring as every other integration in `src/lib/services.ts`.

```ts
export const analyticsProvider: AnalyticsProvider = realOrMock(
  process.env.AYRSHARE_API_KEY,
  () => new AyrshareAnalyticsProvider(process.env.AYRSHARE_API_KEY!),
  () => new MockAnalyticsProvider());
```

**Open dependency, not blocking code:** whether analytics access requires a specific Ayrshare plan tier is unconfirmed — needs a check against the live Ayrshare account before this ships to production. Until confirmed, the mock path keeps the feature safe to deploy with an empty-state UI.

### 3. New cron: `/api/cron/sync-analytics`

New route `src/app/api/cron/sync-analytics/route.ts`, added to `vercel.json` (`{ "path": "/api/cron/sync-analytics", "schedule": "30 6 * * *" }`, right after the existing publish cron), same `CRON_SECRET` bearer-auth gate as `/api/cron/publish`.

Per run:
1. Select `content_items` where `status = 'published'`, `ayrshare_post_ids <> '{}'`, and `updated_at` within the last 45 days (bounds the sync window — older posts stop being worth refreshing for a "how's my campaign going now" dashboard).
2. For each item, call `analyticsProvider.getPostAnalytics(...)` for its platform/postId pairs; upsert one `post_metrics` row per platform for today's date (`on conflict (content_item_id, platform, captured_on) do update`). Each item is wrapped in its own try/catch so one failure doesn't abort the batch — mirrors the existing per-item loop in `/api/cron/publish/route.ts:29-80`.
3. After metrics sync, for each campaign with any published content in the window, call `generateInsight(campaignId)` (new function, `src/lib/analytics.ts`) and insert one `insight_snapshots` row. Also wrapped per-campaign so one campaign's LLM failure doesn't block others.

`generateInsight` aggregates the last 30 days of `post_metrics` (totals, by-platform, by-content-type) plus the last 30 days of `monitoring_results` count, and sends one Claude call (same `Anthropic` client pattern as `ClaudeContentGenerator`, `src/integrations/index.ts:80-110`, model `claude-sonnet-4-6`) asking for a 2-3 sentence summary and 2-3 concrete recommendations, returned as `{ summary: string, recommendations: string[] }`.

### 4. `src/lib/analytics.ts` (new)

Following the `candidate.ts` pattern (plain functions over `adminDb`, no repo abstraction needed — nothing here is written by user action, only read):

- `getPerformanceSummary(campaignId, days = 30)` — totals (impressions, reach, engagement, video views/watch time) for the period vs. the prior period (for the ▲/▼ deltas), grouped by platform and by content type, plus the top 5 `content_items` by total engagement.
- `getLatestInsight(campaignId)` — most recent `insight_snapshots` row, or `null`.

---

## UI/UX

New route `src/app/analytics/page.tsx` — server component, same shell as `/dashboard`: `requireSession()`, redirect `super_admin` to `/admin`, wrapped in `<AppFrame>`. No new permission gate — visible to every campaign role (`owner`/`manager`/`staff`/`approver`), matching `/dashboard`'s current lack of an extra check; this is read-only, nothing here writes anything.

Fetches `getPerformanceSummary`, `getLatestInsight`, and reuses the existing `getMonitoringResults` in parallel (`Promise.all`, same as `/dashboard`).

Sections, in the same hand-rolled `.card`/inline-style visual language as `/dashboard` (no new chart library — the app has none today, and nothing here needs more than the divs-as-bars technique already used for the spend meter at `src/app/dashboard/page.tsx:191-197`):

1. **Stat tiles row** — total reach, total engagement, engagement rate, video avg watch time; each with a small ▲/▼ delta vs. the prior 30 days.
2. **Performance over time** — a simple day-by-day bar strip (reach + engagement), 30 days.
3. **Top-performing content** — leaderboard table (title, platform badges, content type, engagement), each row linking to `/content/[id]` (existing route).
4. **By platform** — engagement share per connected platform.
5. **By content type** — engagement share per `reel`/`social_post`/`press_release`/`ad_copy`/`talking_points`.
6. **Opponent activity (context, not a funnel)** — the candidate's published count for the period next to the opponent-mention count already surfaced by `getMonitoringResults`. Framed explicitly as context, not a computed "share of voice" score — the data doesn't support that level of claim.
7. **AI insight card** — latest `insight_snapshots` summary + recommendation bullets, with a "Generated on [date]" timestamp. No manual "regenerate" action in v1 — refresh is cron-only, keeping this release's surface area small.

**Empty state:** if `getPerformanceSummary` returns no `post_metrics` rows at all (new campaign, or `AYRSHARE_API_KEY` unset, or Ayrshare plan doesn't expose analytics), the page renders a single explanatory empty state — "Performance data will appear here once your published content has synced" — instead of a dashboard full of zeros.

**Nav:** add to `NAV` in `src/components/Sidebar.tsx`, positioned after `/monitoring`:
```ts
{ href: '/analytics', label: 'Analytics', icon: /* new icon, following the existing 16x16 stroke-icon style */ },
```

---

## Error Handling

- Every external call (Ayrshare analytics fetch, Claude insight call) is wrapped so a failure degrades that one data point to empty/zero rather than failing the whole cron run or the page — consistent with the "integrations never crash the app" rule already enforced in `src/lib/services.ts` and the per-item try/catch already in `/api/cron/publish`.
- The dashboard page itself never calls an external API directly — it only reads what the cron already persisted, so a slow/broken third party never affects page load time or availability.

---

## Testing

- `src/integrations/index.test.ts` (or extend the existing integrations test file if one exists) — `AyrshareAnalyticsProvider` maps a sample Ayrshare response correctly; a per-post HTTP failure returns zeros for that post without throwing.
- `src/app/api/cron/sync-analytics/route.test.ts` — mirrors `src/app/api/cron/publish/route.test.ts`: rejects with 401 when `CRON_SECRET` is unset/wrong; a same-day re-run upserts rather than duplicating `post_metrics` rows; one item's analytics failure doesn't stop the rest of the batch or block insight generation.
- `src/lib/analytics.test.ts` — `getPerformanceSummary` aggregation math (totals, period-over-period deltas, top-5 sort, group-by-platform/type) against seeded fixtures.

---

## Alternatives Considered

1. **Chosen — Ayrshare Analytics API + own DB + existing Anthropic integration, daily cron-synced.** No new OAuth, no new public page, no new payment integration. Delivers real content-performance data using infrastructure that already exists and is already paid for.
2. **Build an owned public "link-in-bio" candidate page first, then instrument it.** Would unlock the full original wishlist (true page views, visitor device/geo, button-click funnels, donation conversion) but is a materially larger, separate project — a new public product surface plus a payment integration. Rejected for v1; worth revisiting as a follow-on once this ships and Ayrshare analytics access is confirmed.
3. **On-demand insight generation (call Claude on every page load) instead of a cached daily snapshot.** Rejected: adds LLM latency/cost to every page view for data that only meaningfully changes once a day when the metrics sync runs anyway.

---

## Out of Scope

- Page views, unique/returning visitors, time-on-page, "most viewed sections" — no owned page exists to instrument (see Scope Correction above and Alternative 2).
- Donate/Volunteer/Contact click tracking and completed-donation conversion — no donation processor integration exists; would need its own spec.
- Visitor device/location — not exposed by social platforms for organic (non-paid, non-owned-page) content at this granularity.
- A manual "regenerate insight now" action — cron-only refresh for v1.
- Any change to `/dashboard` itself — it remains the content-ops view; `/analytics` is additive, not a replacement.
