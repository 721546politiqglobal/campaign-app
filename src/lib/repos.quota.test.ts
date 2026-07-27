import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('./supabase', () => ({ adminDb: { rpc, from }, throwOnError: async (q: any) => (await q).data }));

describe('quotaRepo.incrementFeatureUsage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls increment_feature_usage with an ISO period_start and returns its boolean result', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const { quotaRepo } = await import('./repos');
    const periodStart = new Date('2026-07-01T00:00:00.000Z');
    const result = await quotaRepo.incrementFeatureUsage('camp-1', 'content', periodStart, 15);
    expect(result).toBe(true);
    expect(rpc).toHaveBeenCalledWith('increment_feature_usage', {
      p_campaign_id: 'camp-1',
      p_feature: 'content',
      p_period_start: '2026-07-01T00:00:00.000Z',
      p_limit: 15,
    });
  });

  it('returns false when the RPC reports the limit was reached', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const { quotaRepo } = await import('./repos');
    const result = await quotaRepo.incrementFeatureUsage('camp-1', 'video', new Date(), 1);
    expect(result).toBe(false);
  });

  it('passes null limit straight through for unlimited plans', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const { quotaRepo } = await import('./repos');
    await quotaRepo.incrementFeatureUsage('camp-1', 'content', new Date('2026-07-01T00:00:00.000Z'), null);
    expect(rpc).toHaveBeenCalledWith('increment_feature_usage', expect.objectContaining({ p_limit: null }));
  });

  it('throws when the RPC reports an error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { quotaRepo } = await import('./repos');
    await expect(quotaRepo.incrementFeatureUsage('camp-1', 'content', new Date(), 15)).rejects.toThrow();
  });
});

describe('quotaRepo.countAvatars', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the exact count from the avatars table for the campaign', async () => {
    from.mockImplementation((table: string) => {
      expect(table).toBe('avatars');
      return { select: () => ({ eq: () => Promise.resolve({ count: 3, error: null }) }) };
    });
    const { quotaRepo } = await import('./repos');
    expect(await quotaRepo.countAvatars('camp-1')).toBe(3);
  });

  it('returns 0 when count is null', async () => {
    from.mockImplementation(() => ({ select: () => ({ eq: () => Promise.resolve({ count: null, error: null }) }) }));
    const { quotaRepo } = await import('./repos');
    expect(await quotaRepo.countAvatars('camp-1')).toBe(0);
  });
});
