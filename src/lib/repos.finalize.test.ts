import { describe, it, expect, vi, beforeEach } from 'vitest';
const rpc = vi.fn();
vi.mock('./supabase', () => ({ adminDb: { rpc, from: vi.fn() }, throwOnError: async (q: any) => (await q).data }));

describe('usageRepo finalize/reserve use the atomic RPCs', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reserve returns the id string from reserve_usage', async () => {
    rpc.mockResolvedValue({ data: 'res-9', error: null });
    const { usageRepo } = await import('./repos');
    expect(await usageRepo.reserve('c-1', 100, 10)).toBe('res-9');
  });
  it('reserve returns null when the RPC returns null (cap exceeded)', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { usageRepo } = await import('./repos');
    expect(await usageRepo.reserve('c-1', 100, 10)).toBeNull();
  });
  it('finalize calls finalize_usage keyed on the reservation id', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { usageRepo } = await import('./repos');
    await usageRepo.finalize('res-9', 'llm_tokens', 1, 500);
    expect(rpc).toHaveBeenCalledWith('finalize_usage', { p_reservation_id: 'res-9', p_kind: 'llm_tokens', p_cost_cents: 500 });
  });
});
