import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({
  adminDb: {
    from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn() })),
  },
}));

describe('candidate module exports', () => {
  it('exports getCandidateProfile and upsertCandidateProfile', async () => {
    const mod = await import('./candidate');
    expect(typeof mod.getCandidateProfile).toBe('function');
    expect(typeof mod.upsertCandidateProfile).toBe('function');
  });
});
