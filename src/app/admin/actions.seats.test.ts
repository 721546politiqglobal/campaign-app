import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(() => ({ userId: 'u-admin', locale: 'en' })) }));
vi.mock('@/lib/stripe', () => ({ stripe: null }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(() => 'u-x'), inviteCode: vi.fn(() => 'inv_x') }));

const userInsert = vi.fn(async (_row: unknown): Promise<{ error: null | { code?: string; message: string } }> => ({ error: null }));
const inviteInsert = vi.fn(async (_row: unknown) => ({ error: null }));
const auditInsert = vi.fn(async (_row: unknown) => ({ error: null }));
vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: vi.fn((table: string) => {
      if (table === 'users') return { insert: userInsert };
      if (table === 'invite_codes') return { insert: inviteInsert };
      if (table === 'audit_entries') return { insert: auditInsert };
      throw new Error('unexpected table ' + table);
    }),
  },
  throwOnError: async (q: any) => { const r = await q; if (r?.error) throw new Error(r.error.message); return r?.data; },
}));

const getCampaignSeatUsage = vi.fn();
vi.mock('@/lib/data', () => ({ getCampaignSeatUsage }));

function fd(o: Record<string, string>) { const f = new FormData(); for (const k in o) f.set(k, o[k]); return f; }
const VALID = { campaignId: 'c-1', name: 'New', email: 'n@x.com', role: 'staff' };

describe('addUserAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    userInsert.mockResolvedValue({ error: null });
  });

  it('refuses with a translated message when the campaign is at its seat limit', async () => {
    getCampaignSeatUsage.mockResolvedValue({ used: 3, limit: 3 });
    const { addUserAction } = await import('./actions');
    const r = await addUserAction(fd(VALID));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/3 seats/);
      expect(r.values).toMatchObject({ name: 'New', email: 'n@x.com', role: 'staff' });
    }
    expect(userInsert).not.toHaveBeenCalled();
  });

  it('inserts the user, an invite and an audit entry when under the seat limit', async () => {
    getCampaignSeatUsage.mockResolvedValue({ used: 1, limit: 3 });
    const { addUserAction } = await import('./actions');
    const r = await addUserAction(fd(VALID));
    expect(r).toEqual({ ok: true });
    expect(userInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-x', campaign_id: 'c-1', email: 'n@x.com', role: 'staff' }));
    expect(inviteInsert).toHaveBeenCalledWith(expect.objectContaining({ code: 'inv_x', campaign_id: 'c-1', role: 'staff' }));
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin_user_added', entity_id: 'u-x' }));
  });

  it('rejects roles outside the allow-list (super_admin, garbage) before touching the DB', async () => {
    getCampaignSeatUsage.mockResolvedValue({ used: 0, limit: null });
    const { addUserAction } = await import('./actions');
    for (const role of ['super_admin', 'root', '']) {
      const r = await addUserAction(fd({ ...VALID, role }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/role/i);
    }
    expect(userInsert).not.toHaveBeenCalled();
  });

  it('rejects an invalid email and an over-long name', async () => {
    getCampaignSeatUsage.mockResolvedValue({ used: 0, limit: null });
    const { addUserAction } = await import('./actions');
    const bad = await addUserAction(fd({ ...VALID, email: 'not-an-email' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/email/i);
    const long = await addUserAction(fd({ ...VALID, name: 'x'.repeat(121) }));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toMatch(/120 characters/);
    expect(userInsert).not.toHaveBeenCalled();
  });

  it('reports a duplicate email instead of silently bailing', async () => {
    getCampaignSeatUsage.mockResolvedValue({ used: 0, limit: null });
    userInsert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const { addUserAction } = await import('./actions');
    const r = await addUserAction(fd(VALID));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/already exists/i);
      expect(r.error).not.toMatch(/unique constraint/);
    }
    expect(inviteInsert).not.toHaveBeenCalled();
  });
});
