import { describe, it, expect, afterEach, vi } from 'vitest';
import { HeyGenVideoProvider, HeyGenPhotoAvatarProvider } from './index';

afterEach(() => { vi.unstubAllGlobals(); });

describe('defensive provider parsing', () => {
  it('generateAvatarVideo throws when the response has no video_id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) }));
    const p = new HeyGenVideoProvider('k');
    await expect(p.generateAvatarVideo({ script: 's', avatarId: 'a', voiceId: 'v' })).rejects.toThrow(/video id|video_id/i);
  });

  it('uploadAsset throws when the response has no asset_id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) }));
    const p = new HeyGenPhotoAvatarProvider('k');
    await expect(p.uploadAsset(Buffer.from('x'), 'image/jpeg')).rejects.toThrow(/asset/i);
  });

  it('getAvatarGroupStatus reports failed for an unknown status instead of casting it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { status: 'garbage' } }) }));
    const p = new HeyGenPhotoAvatarProvider('k');
    const r = await p.getAvatarGroupStatus('g1');
    expect(r.status).toBe('failed');
  });
});
