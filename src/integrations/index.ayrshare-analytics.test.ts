import { describe, it, expect, vi, afterEach } from 'vitest';
import { AyrsharePublisher } from './index';

afterEach(() => { vi.unstubAllGlobals(); });

import { AyrshareAnalyticsProvider, MockAnalyticsProvider } from './index';

describe('AyrsharePublisher.publish', () => {
  // The stored postId must be the top-level `id`, not postIds[].id — Ayrshare's
  // analytics endpoint only recognizes the former (verified live: the latter
  // returns "Post ID not found" for every platform, permanently breaking
  // analytics sync).
  it('returns the top-level Ayrshare id (not the per-platform postIds[].id) for each successfully published platform', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'top-level-id', postIds: [{ platform: 'facebook', id: 'post-abc', status: 'success' }] }),
    }));
    const publisher = new AyrsharePublisher('test-key');
    const results = await publisher.publish({ platforms: ['facebook'], title: 't', text: 'hi', disclosureText: '' });
    expect(results).toEqual([{ platform: 'facebook', status: 'scheduled', postId: 'top-level-id' }]);
  });

  it('omits postId (without throwing) when the Ayrshare response has no top-level id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const publisher = new AyrsharePublisher('test-key');
    const results = await publisher.publish({ platforms: ['x'], title: 't', text: 'hi', disclosureText: '' });
    expect(results).toEqual([{ platform: 'x', status: 'scheduled' }]);
  });

  // YouTube requires its own video title, separate from the post/description
  // text — verified live against Ayrshare: omitting it fails the upload
  // with "Error uploading YouTube video. Please verify the youTubeOptions
  // parameters and video file."
  it('sends youTubeOptions.title when publishing to youtube', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ postIds: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const publisher = new AyrsharePublisher('test-key');
    await publisher.publish({ platforms: ['youtube'], title: 'My Video Title', text: 'hi', disclosureText: '' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.youTubeOptions).toEqual({ title: 'My Video Title' });
  });

  it('does not send youTubeOptions for non-youtube platforms', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ postIds: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const publisher = new AyrsharePublisher('test-key');
    await publisher.publish({ platforms: ['instagram'], title: 'My Video Title', text: 'hi', disclosureText: '' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.youTubeOptions).toBeUndefined();
  });

  // Ayrshare's actual error shape nests the message under errors[0].message,
  // not a top-level `message` field (verified against their docs) — reading
  // json.message silently swallowed every real error and fell back to a bare
  // "HTTP 400", hiding exactly why the post was rejected (e.g. "Instagram
  // requires an image or video").
  it('surfaces the real Ayrshare error message from errors[0].message, not just the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        status: 'error',
        errors: [{ action: 'post', status: 'error', code: 138, message: 'Instagram Error: media is required', platform: 'instagram' }],
      }),
    }));
    const publisher = new AyrsharePublisher('test-key');
    const results = await publisher.publish({ platforms: ['instagram'], title: 't', text: 'hi', disclosureText: '' });
    expect(results).toEqual([{ platform: 'instagram', status: 'failed', error: 'Instagram Error: media is required' }]);
  });

  it('falls back to HTTP status when the error response has neither errors[] nor a top-level message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }));
    const publisher = new AyrsharePublisher('test-key');
    const results = await publisher.publish({ platforms: ['tiktok'], title: 't', text: 'hi', disclosureText: '' });
    expect(results).toEqual([{ platform: 'tiktok', status: 'failed', error: 'HTTP 400' }]);
  });
});

describe('AyrshareAnalyticsProvider.getPostAnalytics', () => {
  // Response shapes below are the ACTUAL shapes returned by Ayrshare for real
  // posts (captured live) — not invented. Ayrshare nests the platform key at
  // the top level of the response, with metrics one level under `.analytics`,
  // and every platform uses entirely different field names.
  it('maps a real youtube analytics response onto our metric shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'top-id', status: 'success',
        youtube: { id: 'yt-vid', analytics: { views: 5, likes: 2, comments: 1, shares: 0, averageViewDuration: 12.5 } },
      }),
    }));
    const provider = new AyrshareAnalyticsProvider('test-key');
    const out = await provider.getPostAnalytics([{ platform: 'youtube', postId: 'top-id' }]);
    expect(out).toEqual([{ platform: 'youtube', impressions: 0, reach: 0, likes: 2, comments: 1, shares: 0, saves: 0, videoViews: 5, videoAvgWatchSeconds: 12.5 }]);
  });

  it('maps a real instagram analytics response onto our metric shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'top-id', status: 'success',
        instagram: { id: 'ig-id', analytics: {
          reachCount: 19, likeCount: 3, commentsCount: 1, sharesCount: 2, savedCount: 4,
          viewsCount: 32, igReelsAvgWatchTimeCount: 1145,
        } },
      }),
    }));
    const provider = new AyrshareAnalyticsProvider('test-key');
    const out = await provider.getPostAnalytics([{ platform: 'instagram', postId: 'top-id' }]);
    expect(out).toEqual([{ platform: 'instagram', impressions: 0, reach: 19, likes: 3, comments: 1, shares: 2, saves: 4, videoViews: 32, videoAvgWatchSeconds: 1.145 }]);
  });

  it('maps a real tiktok analytics response onto our metric shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'top-id', status: 'success',
        tiktok: { id: 'tt-id', analytics: {
          reach: 0, likeCount: 0, commentsCount: 0, shareCount: 0, favorites: 0,
          videoViews: 12, averageTimeWatched: 2.82,
        } },
      }),
    }));
    const provider = new AyrshareAnalyticsProvider('test-key');
    const out = await provider.getPostAnalytics([{ platform: 'tiktok', postId: 'top-id' }]);
    expect(out).toEqual([{ platform: 'tiktok', impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, videoViews: 12, videoAvgWatchSeconds: 2.82 }]);
  });

  it('skips a platform with no extractor yet (e.g. facebook — unverified) instead of guessing at its shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'top-id', status: 'success', facebook: { id: 'fb-id', analytics: { likes: 1 } } }),
    }));
    const provider = new AyrshareAnalyticsProvider('test-key');
    const out = await provider.getPostAnalytics([{ platform: 'facebook', postId: 'top-id' }]);
    expect(out).toEqual([]);
  });

  it('skips a post that fails (never throws) and still returns data for the others', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ message: 'not on plan' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        id: 'top-id', status: 'success',
        youtube: { id: 'yt-vid', analytics: { views: 5, likes: 2, comments: 1, shares: 0, averageViewDuration: 0 } },
      }) });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new AyrshareAnalyticsProvider('test-key');
    const out = await provider.getPostAnalytics([
      { platform: 'instagram', postId: 'post-bad' },
      { platform: 'youtube', postId: 'post-good' },
    ]);
    expect(out).toEqual([{ platform: 'youtube', impressions: 0, reach: 0, likes: 2, comments: 1, shares: 0, saves: 0, videoViews: 5, videoAvgWatchSeconds: 0 }]);
  });

  it('skips a post on a network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const provider = new AyrshareAnalyticsProvider('test-key');
    const out = await provider.getPostAnalytics([{ platform: 'youtube', postId: 'post-abc' }]);
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
