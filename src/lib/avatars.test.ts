import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({
  adminDb: {
    from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() })),
  },
}));

describe('avatars module exports', () => {
  it('exports the expected functions', async () => {
    const mod = await import('./avatars');
    expect(typeof mod.listAvatars).toBe('function');
    expect(typeof mod.getAvatar).toBe('function');
    expect(typeof mod.insertAvatar).toBe('function');
    expect(typeof mod.updateAvatarStatus).toBe('function');
    expect(typeof mod.deleteAvatarRow).toBe('function');
  });
});
