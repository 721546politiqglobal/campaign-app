import { describe, it, expect, vi, afterEach } from 'vitest';
import { HeyGenPhotoAvatarProvider, MockPhotoAvatarProvider } from './index';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HeyGenPhotoAvatarProvider.uploadAsset', () => {
  it('posts multipart form data and returns the asset id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { asset_id: 'asset_123' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.uploadAsset(Buffer.from('fake-image-bytes'), 'image/jpeg');

    expect(result).toEqual({ assetId: 'asset_123' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.heygen.com/v3/assets');
    expect(opts.method).toBe('POST');
    expect(opts.headers['X-Api-Key']).toBe('test-key');
  });

  it('throws with the HeyGen error message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'bad file' } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    await expect(provider.uploadAsset(Buffer.from('x'), 'image/jpeg')).rejects.toThrow('bad file');
  });
});

describe('HeyGenPhotoAvatarProvider.createAvatarLook', () => {
  it('creates a new group when avatarGroupId is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { avatar_item: { id: 'look_1', group_id: 'group_1' }, avatar_group: { id: 'group_1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.createAvatarLook({ name: 'Studio look', assetId: 'asset_123' });

    expect(result).toEqual({ lookId: 'look_1', groupId: 'group_1' });
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.type).toBe('photo');
    expect(body.file).toEqual({ type: 'asset_id', asset_id: 'asset_123' });
    expect(body.avatar_group_id).toBeUndefined();
  });

  it('adds a look to an existing group when avatarGroupId is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { avatar_item: { id: 'look_2', group_id: 'group_1' }, avatar_group: { id: 'group_1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    await provider.createAvatarLook({ name: 'Studio look', assetId: 'asset_456', avatarGroupId: 'group_1' });

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.avatar_group_id).toBe('group_1');
  });
});

describe('HeyGenPhotoAvatarProvider.getAvatarGroupStatus', () => {
  it('polls the single-resource endpoint and normalizes a completed group', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { id: 'group_1', status: 'completed', preview_image_url: 'https://example.com/1.jpg', looks_count: 4 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.getAvatarGroupStatus('group_1');

    expect(result).toEqual({ status: 'completed', previewImageUrl: 'https://example.com/1.jpg', error: undefined });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.heygen.com/v3/avatars/group_1');
  });

  it('normalizes a failed group', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { id: 'group_2', status: 'failed', error: { code: 'training_failed', message: 'bad photo' } },
      }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.getAvatarGroupStatus('group_2');

    expect(result).toEqual({
      status: 'failed', previewImageUrl: undefined, error: { code: 'training_failed', message: 'bad photo' },
    });
  });
});

describe('MockPhotoAvatarProvider', () => {
  it('returns immediately-completed mock data', async () => {
    const provider = new MockPhotoAvatarProvider();
    const { assetId } = await provider.uploadAsset(Buffer.from('x'), 'image/jpeg');
    const { groupId } = await provider.createAvatarLook({ name: 'n', assetId });
    const result = await provider.getAvatarGroupStatus(groupId);
    expect(result).toEqual({ status: 'completed', previewImageUrl: 'https://example.com/mock-avatar.jpg' });
  });
});
