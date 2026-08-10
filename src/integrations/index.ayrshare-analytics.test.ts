import { describe, it, expect, vi, afterEach } from 'vitest';
import { AyrsharePublisher } from './index';

afterEach(() => { vi.unstubAllGlobals(); });

import { AyrshareAnalyticsProvider, MockAnalyticsProvider } from './index';

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
