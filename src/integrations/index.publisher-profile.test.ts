import { describe, it, expect, vi, afterEach } from 'vitest';
import { AyrsharePublisher, AyrshareAnalyticsProvider } from './index';

afterEach(() => vi.unstubAllGlobals());

describe('Ayrshare calls are scoped to the campaign profile', () => {
  it('publish sends the campaign Profile-Key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'post-1' }) });
    vi.stubGlobal('fetch', fetchMock);
    await new AyrsharePublisher('k').publish({ platforms: ['x'], title: 't', text: 'b', disclosureText: '', profileKey: 'pk-7' });
    expect(fetchMock.mock.calls[0][1].headers['Profile-Key']).toBe('pk-7');
  });

  it('publish refuses (all failed, no API call) without a profile key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await new AyrsharePublisher('k').publish({ platforms: ['x'], title: 't', text: 'b', disclosureText: '', profileKey: '' });
    expect(r).toEqual([{ platform: 'x', status: 'failed', error: expect.any(String) }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('analytics sends the campaign Profile-Key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await new AyrshareAnalyticsProvider('k').getPostAnalytics([{ platform: 'x', postId: 'p' }], 'pk-7');
    expect(fetchMock.mock.calls[0][1].headers['Profile-Key']).toBe('pk-7');
  });
});
