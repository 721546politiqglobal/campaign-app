import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSession = vi.fn();
vi.mock('@/lib/session', () => ({ getSession }));

describe('heygen avatars proxy auth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null);
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    const res = await GET(new NextRequest('http://x/api/heygen/avatars?baseId=b1'));
    expect(res.status).toBe(401);
  });
});

describe('heygen avatars proxy — v2 avatar_list parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ userId: 'u-1' });
    process.env.HEYGEN_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HEYGEN_API_KEY;
  });

  it('parses the real v2 avatar_list shape (avatar_id/avatar_name/preview_*, no status field)', async () => {
    // Real response captured from HeyGen's v2 endpoint for a live digital_twin
    // group — the SDK does not return id/name/image_url/motion_preview_url/
    // status, which the parser previously (incorrectly) expected.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: null,
        data: {
          avatar_list: [{
            avatar_id: '718d472751514fe9bf890150e01b0975',
            avatar_name: 'ernesto',
            preview_image_url: 'https://resource2.heygen.ai/best_frame_selection/candidates/x.jpg',
            preview_video_url: 'https://resource2.heygen.ai/avatar/v3/718d.../preview_video_target.mp4',
          }],
        },
      }),
    }));

    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    const res = await GET(new NextRequest('http://x/api/heygen/avatars?baseId=b000d4cc322f423fb0f275c23d5c7553'));
    const json = await res.json();

    expect(json.avatars).toEqual([{
      avatar_id: '718d472751514fe9bf890150e01b0975',
      avatar_name: 'ernesto',
      preview_image_url: 'https://resource2.heygen.ai/best_frame_selection/candidates/x.jpg',
      preview_video_url: 'https://resource2.heygen.ai/avatar/v3/718d.../preview_video_target.mp4',
    }]);
  });
});
