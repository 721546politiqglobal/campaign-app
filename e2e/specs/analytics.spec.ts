import type { SupabaseClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures';
import { createClient } from '@supabase/supabase-js';
import { E2E_SECRETS, E2E_ENV, BASE_URL, assertTestProject } from '../env';
import { CAMPAIGN_A, CONTENT } from '../helpers/users';
import { createThrowawayCampaign, deleteThrowawayCampaign, uiLogin } from '../helpers/throwaway-campaign';

const testKey = () => test.info().testId.split('-').pop()!;
const nf = (n: number) => n.toLocaleString('en-US');

type Metric = { platform: string; reach: number; impressions: number; likes: number; comments: number; shares: number; saves: number };

/** Same 30-day window as getPerformanceSummary (UTC dates). */
async function metricsFor(db: SupabaseClient, campaignId: string): Promise<Metric[]> {
  const since = new Date(); since.setDate(since.getDate() - 30);
  const { data, error } = await db.from('post_metrics').select('*')
    .eq('campaign_id', campaignId).gte('captured_on', since.toISOString().slice(0, 10));
  expect(error).toBeNull();
  return (data ?? []) as Metric[];
}
const sum = (rows: Metric[], f: keyof Omit<Metric, 'platform'>) => rows.reduce((t, r) => t + Number(r[f]), 0);
const engagement = (rows: Metric[]) => sum(rows, 'likes') + sum(rows, 'comments') + sum(rows, 'shares') + sum(rows, 'saves');

const tile = (page: import('@playwright/test').Page, label: string) =>
  page.locator('.stat').filter({ has: page.getByText(label, { exact: true }) }).locator('.stat-value');

test.describe('analytics page', () => {
  test('owner: seeded 7-day metrics render as tile totals, platform split and top content', async ({ asRole, db }) => {
    const rows = await metricsFor(db, CAMPAIGN_A);
    expect(rows.length, 'seed provides metrics').toBeGreaterThan(0);
    const page = await asRole('owner');
    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
    await expect(page.getByText('Last 30 days', { exact: true })).toBeVisible();

    await expect(tile(page, 'Reach')).toHaveText(nf(sum(rows, 'reach')));
    await expect(tile(page, 'Engagement')).toHaveText(nf(engagement(rows)));
    const rate = engagement(rows) / sum(rows, 'impressions');
    await expect(tile(page, 'Engagement rate')).toHaveText(
      rate.toLocaleString('en-US', { style: 'percent', maximumFractionDigits: 1 }));

    // By platform: X and Facebook, each with its own engagement total.
    const byPlatform = page.getByRole('region', { name: 'By platform' });
    for (const [id, label] of [['x', 'X'], ['facebook', 'Facebook']] as const) {
      const e = engagement(rows.filter((r) => r.platform === id));
      await expect(byPlatform.locator('.an-bar').filter({ hasText: label }).first()).toContainText(nf(e));
    }

    // Top content links to the seeded published item with its summed engagement.
    const { data: pubRows } = await db.from('post_metrics').select('likes,comments,shares,saves')
      .eq('content_item_id', CONTENT.published);
    const pubEng = (pubRows ?? []).reduce((t, r) => t + r.likes + r.comments + r.shares + r.saves, 0);
    const top = page.getByRole('region', { name: 'Top performing content' })
      .locator(`a[href="/content/${CONTENT.published}"]`);
    await expect(top).toContainText('E2E Published post');
    await expect(top).toContainText(nf(pubEng));
  });

  test('owner: AI insight panel renders the latest snapshot', async ({ asRole, db }) => {
    const marker = `e2e-insight-${testKey()}`;
    const { data: ins, error } = await db.from('insight_snapshots').insert({
      campaign_id: CAMPAIGN_A,
      summary: `Reach grew steadily (${marker}).`,
      recommendations: [`Post more video ${marker}`, 'Double down on X'],
      generated_at: new Date(Date.now() + 60_000).toISOString(),
    }).select('id').single();
    expect(error).toBeNull();
    try {
      const page = await asRole('owner');
      await page.goto('/analytics');
      const panel = page.getByRole('region', { name: 'AI insight' });
      await expect(panel).toContainText(`Reach grew steadily (${marker}).`);
      await expect(panel.getByRole('listitem').filter({ hasText: `Post more video ${marker}` })).toBeVisible();
      await expect(panel).toContainText('Generated');
    } finally {
      const { error: delErr } = await db.from('insight_snapshots').delete().eq('id', ins!.id);
      expect(delErr).toBeNull();
    }
  });

  test('owner: without a snapshot the panel prompts to check back later', async ({ asRole, db }) => {
    // The seed has no snapshots for campaign A; only this file creates them (the test above, and the
    // sync below, whose afterAll removes them). This file's tests run serially on one worker, so any
    // A snapshot here is a leftover of an aborted earlier run: remove it, then assert deterministically.
    const { error: delErr } = await db.from('insight_snapshots').delete().eq('campaign_id', CAMPAIGN_A);
    expect(delErr).toBeNull();
    const page = await asRole('owner');
    await page.goto('/analytics');
    await expect(page.getByRole('region', { name: 'AI insight' }))
      .toContainText('Check back after your next scheduled sync');
  });

  // Seed B has no candidate profile and no plan; AppFrame checks the profile first.
  test('ownerB: gated to /setup (campaign B has no profile and no plan)', async ({ asRole }) => {
    const page = await asRole('ownerB');
    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/setup$/);
  });

  test('subscribed campaign with no metrics: empty state, no errors', async ({ page, db }) => {
    const t = await createThrowawayCampaign(db, testKey(), { suffix: 't15-empty' }); // pre-cleans leftovers
    try {
      await uiLogin(page, t.owner.email);
      await page.goto('/analytics');
      await expect(page).toHaveURL(/\/analytics$/);
      await expect(page.getByText('No performance data yet')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Create content' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Connect channels' })).toBeVisible();
      await expect(page.getByText('Top performing content')).toHaveCount(0);
    } finally {
      await deleteThrowawayCampaign(db, t.campaignId);
    }
  });

  test('there are no date-range or platform filters on the page (fixed 30-day window)', async ({ asRole }) => {
    const page = await asRole('owner');
    await page.goto('/analytics');
    await expect(page.getByText('Last 30 days', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  });

  for (const role of ['manager', 'approver', 'staff'] as const) {
    test(`${role}: can view campaign analytics (page has no role gate)`, async ({ asRole }) => {
      const page = await asRole(role);
      await page.goto('/analytics');
      await expect(page).toHaveURL(/\/analytics$/);
      await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
      await expect(tile(page, 'Reach')).toBeVisible();
    });
  }

  test('admin is redirected to /admin', async ({ asRole }) => {
    const page = await asRole('admin');
    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/admin/);
  });
});

test.describe('GET /api/cron/sync-analytics', () => {
  const url = `${BASE_URL}/api/cron/sync-analytics`;

  test('rejects missing or wrong bearer with 401', async ({ request }) => {
    expect((await request.get(url)).status()).toBe(401);
    expect((await request.get(url, { headers: { authorization: 'Bearer nope' } })).status()).toBe(401);
    expect((await request.get(url, { headers: { authorization: E2E_SECRETS.cron } })).status()).toBe(401);
  });

  // One throwaway campaign (own fake-Ayrshare profile key) with a published item
  // on x + instagram, synced once in beforeAll. Setup/sync/cleanup problems fail
  // loudly there; the E2E-007 test below can only "expectedly fail" on its
  // final metrics assertion.
  test.describe('throwaway published item', () => {
    test.describe.configure({ mode: 'serial' });
    const k = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const campaignId = `e2e-t15-camp-${k}`;
    const itemId = `e2e-t15-item-${k}`;
    const adminDb = () => createClient(assertTestProject(E2E_ENV.NEXT_PUBLIC_SUPABASE_URL),
      E2E_ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // The sync covers every published item, so it also writes an insight snapshot for campaign A
    // (src/app/api/cron/sync-analytics/route.ts); afterAll removes A's snapshots from this window.
    let syncStartedAt = '';

    test.beforeAll(async () => {
      const db = adminDb();
      // 30s slack for clock skew between this machine and the DB's now().
      syncStartedAt = new Date(Date.now() - 30_000).toISOString();
      let r = await db.from('campaigns').insert({
        id: campaignId, name: `T15 ${k}`, jurisdictions: ['US-FEDERAL'],
        ayrshare_profile_key: `e2e-t15-profile-${k}`, ayrshare_ref_id: `e2e-t15-ref-${k}`,
      });
      expect(r.error, 'insert campaign').toBeNull();
      r = await db.from('content_items').insert({
        id: itemId, campaign_id: campaignId, type: 'social_post', title: `T15 published ${k}`,
        body: 'analytics sync body', status: 'published', is_ai_generated: false,
        target_jurisdictions: ['US-FEDERAL'], created_by: 'e2e-owner-a', platforms: ['x', 'instagram'],
        ayrshare_post_ids: { x: `x-t15-${k}`, instagram: `instagram-t15-${k}` },
      });
      expect(r.error, 'insert content item').toBeNull();

      const res = await fetch(url, { headers: { authorization: `Bearer ${E2E_SECRETS.cron}` } });
      expect(res.status, 'sync status').toBe(200);
      const body = await res.json();
      expect(body.failed, 'sync failed count').toEqual(expect.any(Number));
      expect(body.synced, 'sync counted at least our item').toBeGreaterThanOrEqual(1);
    });

    test.afterAll(async () => {
      const db = adminDb();
      const errs = [
        (await db.from('post_metrics').delete().eq('campaign_id', campaignId)).error,
        (await db.from('insight_snapshots').delete().eq('campaign_id', campaignId)).error,
        ...(syncStartedAt
          ? [(await db.from('insight_snapshots').delete().eq('campaign_id', CAMPAIGN_A).gte('generated_at', syncStartedAt)).error]
          : []),
        (await db.from('content_items').delete().eq('id', itemId)).error,
        (await db.from('campaigns').delete().eq('id', campaignId)).error,
      ];
      expect(errs.filter(Boolean)).toEqual([]);
    });

    test('with the bearer, an Instagram post gets metrics (supported platform)', async ({ db }) => {
      const { data, error } = await db.from('post_metrics').select('*')
        .eq('content_item_id', itemId).eq('platform', 'instagram');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      // Fake's instagram block: reach 120, likes 14, comments 3, shares 2, saves 5, views 340, 7500ms.
      expect(data![0]).toMatchObject({
        campaign_id: campaignId, reach: 120, likes: 14, comments: 3, shares: 2, saves: 5, video_views: 340,
      });
      expect(Number(data![0].video_avg_watch_seconds)).toBeCloseTo(7.5);
    });

    // E2E-007 (fixed): X posts get metrics from the twitter extractor.
    test('with the bearer, an X post gets metrics', async ({ db }) => {
      const { data, error } = await db.from('post_metrics').select('*')
        .eq('content_item_id', itemId).eq('platform', 'x');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0]).toMatchObject({ impressions: 400, likes: 12, comments: 2, shares: 4, saves: 2, video_views: 90 });
    });
  });
});
