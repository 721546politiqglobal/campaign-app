import { describe, it, expect, vi, beforeEach } from 'vitest';

const eq = vi.fn();
const update = vi.fn(() => ({ eq }));
const insert = vi.fn();
vi.mock('./supabase', async () => {
  const actual = await vi.importActual<typeof import('./supabase')>('./supabase');
  return { ...actual, adminDb: { from: vi.fn(() => ({ update, insert })) } };
});

describe('repos surface Supabase write errors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('contentRepo.setStatus throws when the update fails', async () => {
    eq.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const { contentRepo } = await import('./repos');
    await expect(contentRepo.setStatus('ct-1', 'approved')).rejects.toThrow(/boom/);
  });

  it('auditRepo.append throws when the insert fails', async () => {
    insert.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    const { auditRepo } = await import('./repos');
    await expect(auditRepo.append({
      campaignId: 'c-1', action: 'x', entityType: 'content_item', entityId: 'ct-1',
    })).rejects.toThrow(/nope/);
  });
});
