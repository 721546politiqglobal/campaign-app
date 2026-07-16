import { describe, it, expect, afterEach, vi } from 'vitest';
import { HeyGenVideoProvider } from './index';

afterEach(() => { vi.unstubAllGlobals(); });

describe('HeyGenVideoProvider.getVideoStatus', () => {
  it('returns failed (not processing) on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'unauthorized' }) }));
    const p = new HeyGenVideoProvider('k');
    expect(await p.getVideoStatus('v1')).toEqual({ status: 'failed' });
  });

  it('returns failed on an unrecognized status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { status: 'weird_new_value' } }) }));
    const p = new HeyGenVideoProvider('k');
    expect(await p.getVideoStatus('v1')).toEqual({ status: 'failed' });
  });

  it('still reports processing and completed on the happy path', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'processing' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { status: 'completed', video_url: 'http://v/1.mp4' } }) }));
    const p = new HeyGenVideoProvider('k');
    expect(await p.getVideoStatus('v1')).toEqual({ status: 'processing' });
    expect(await p.getVideoStatus('v1')).toEqual({ status: 'completed', url: 'http://v/1.mp4' });
  });
});
