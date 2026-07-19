import { describe, it, expect, vi, beforeEach } from 'vitest';

const del = vi.fn();
const eq = vi.fn(() => del());
vi.mock('./supabase', async () => {
  const actual = await vi.importActual<typeof import('./supabase')>('./supabase');
  return { ...actual, adminDb: { from: vi.fn(() => ({ delete: vi.fn(() => ({ eq })) })) } };
});

describe('deleteAvatarRow surfaces FK-blocked deletes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when Supabase reports a foreign-key violation', async () => {
    del.mockResolvedValueOnce({ data: null, error: { message: 'update or delete on table "avatars" violates foreign key constraint' } });
    const { deleteAvatarRow } = await import('./avatars');
    await expect(deleteAvatarRow('av-1')).rejects.toThrow(/foreign key/);
  });

  it('resolves when the delete succeeds', async () => {
    del.mockResolvedValueOnce({ data: null, error: null });
    const { deleteAvatarRow } = await import('./avatars');
    await expect(deleteAvatarRow('av-1')).resolves.toBeUndefined();
  });
});
