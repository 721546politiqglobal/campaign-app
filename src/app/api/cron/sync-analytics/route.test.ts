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
