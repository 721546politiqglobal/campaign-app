import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(() => ({ userId: 'u-admin' })) }));
vi.mock('@/lib/stripe', () => ({ stripe: null }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(() => 'u-x'), inviteCode: vi.fn(() => 'inv_x') }));

const insert = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ insert })) }, throwOnError: async (q: any) => (await q).data }));

const getCampaignSeatUsage = vi.fn();
vi.mock('@/lib/data', () => ({ getCampaignSeatUsage }));

function fd(o: Record<string, string>) { const f = new FormData(); for (const k in o) f.set(k, o[k]); return f; }

describe('addUserAction enforces seat limits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not insert a user when the campaign is at its seat limit', async () => {
    getCampaignSeatUsage.mockResolvedValue({ used: 3, limit: 3 });
    const { addUserAction } = await import('./actions');
    await addUserAction(fd({ campaignId: 'c-1', name: 'New', email: 'n@x.com', role: 'staff' }));
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts when under the seat limit', async () => {
    getCampaignSeatUsage.mockResolvedValue({ used: 1, limit: 3 });
    const { addUserAction } = await import('./actions');
    await addUserAction(fd({ campaignId: 'c-1', name: 'New', email: 'n@x.com', role: 'staff' }));
    expect(insert).toHaveBeenCalled();
  });
});
