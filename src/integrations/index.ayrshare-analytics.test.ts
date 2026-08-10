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
