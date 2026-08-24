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
