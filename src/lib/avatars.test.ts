import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
const from = vi.fn(() => ({ insert, update, select: vi.fn(), delete: vi.fn() }));
vi.mock('./supabase', () => ({
  adminDb: { from },
  throwOnError: async (q: any) => { const r = await q; if (r?.error) throw new Error(r.error.message); return r?.data; },
}));

beforeEach(() => vi.clearAllMocks());

describe('insertAvatar', () => {
  it('maps camelCase fields to snake_case columns and defaults status to training', async () => {
    const { insertAvatar } = await import('./avatars');
    await insertAvatar({
      id: 'av-1', campaignId: 'c-1', name: 'A', sourcePhotoUrls: ['u1'],
      consentConfirmedBy: 'u-1', createdBy: 'u-1', heygenGroupId: 'g-1',
    });
    expect(from).toHaveBeenCalledWith('avatars');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'av-1', campaign_id: 'c-1', name: 'A', status: 'training',
      heygen_group_id: 'g-1', source_photo_urls: ['u1'], consent_confirmed_by: 'u-1', created_by: 'u-1',
    }));
  });

  it('honors an explicit status when provided', async () => {
    const { insertAvatar } = await import('./avatars');
    await insertAvatar({ id: 'av-2', campaignId: 'c-1', name: 'A', sourcePhotoUrls: [], consentConfirmedBy: 'u', createdBy: 'u', status: 'ready' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));
  });
});

describe('updateAvatarStatus', () => {
  it('updates only the provided optional fields alongside status', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }));
    update.mockReturnValueOnce({ eq } as any);
    const { updateAvatarStatus } = await import('./avatars');
    await updateAvatarStatus('av-1', 'failed', { errorMessage: 'boom' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error_message: 'boom' }));
    expect(eq).toHaveBeenCalledWith('id', 'av-1');
  });
});
