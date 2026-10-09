import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const redirect = vi.fn((url: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;push;${url}` }); });
vi.mock('next/navigation', () => ({ redirect }));
const setSessionCookie = vi.fn();
vi.mock('@/lib/session', () => ({
  requireAdmin: vi.fn(() => Promise.resolve({ userId: 'sa-1', name: 'Admin', role: 'super_admin', campaignId: null, locale: 'en' })),
  setSessionCookie,
}));
vi.mock('@/lib/stripe', () => ({ stripe: null }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(() => 'u-x'), inviteCode: vi.fn(() => 'inv_x') }));

let target: Record<string, unknown> | null = null;
let otherOwners = 1;
const usersDelete = vi.fn(async (): Promise<{ error: null | { message: string } }> => ({ error: null }));
const usersDeleteEq2 = vi.fn((..._a: unknown[]) => usersDelete());
const usersDeleteEq1 = vi.fn((..._a: unknown[]) => ({ eq: usersDeleteEq2 }));
const auditInsert = vi.fn(async (_row: unknown): Promise<{ error: null | { message: string } }> => ({ error: null }));

vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: vi.fn((table: string) => {
      if (table === 'users') return {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) {
            // owner count: .eq('campaign_id').eq('role','owner').neq('id', userId)
            const chain: any = { eq: () => chain, neq: async () => ({ count: otherOwners, error: null }) };
            return chain;
          }
          return { eq: () => ({ maybeSingle: async () => ({ data: target, error: null }) }) };
        },
        delete: () => ({ eq: usersDeleteEq1 }),
      };
      if (table === 'audit_entries') return { insert: auditInsert };
      throw new Error('unexpected table ' + table);
    }),
  },
  throwOnError: async (q: any) => { const r = await q; if (r?.error) throw new Error(r.error.message); return r?.data; },
}));

describe('removeUserAction (#15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    target = { id: 'u-2', role: 'staff', campaign_id: 'c-1' };
    otherOwners = 1;
    usersDelete.mockResolvedValue({ error: null });
  });

  it('deletes a staff member scoped to the campaign and writes an audit entry', async () => {
    const { removeUserAction } = await import('./actions');
    const r = await removeUserAction('u-2', 'c-1');
    expect(r).toEqual({ ok: true });
    expect(usersDeleteEq1).toHaveBeenCalledWith('id', 'u-2');
    expect(usersDeleteEq2).toHaveBeenCalledWith('campaign_id', 'c-1');
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin_user_removed', campaign_id: 'c-1', entity_id: 'u-2', actor_user_id: 'sa-1' }));
  });

  it('refuses when the user belongs to a different campaign than the page', async () => {
    target = { id: 'u-2', role: 'staff', campaign_id: 'c-other' };
    const { removeUserAction } = await import('./actions');
    const r = await removeUserAction('u-2', 'c-1');
    expect(r.ok).toBe(false);
    expect(usersDelete).not.toHaveBeenCalled();
  });

  it('refuses to remove a super_admin', async () => {
    target = { id: 'u-2', role: 'super_admin', campaign_id: 'c-1' };
    const { removeUserAction } = await import('./actions');
    const r = await removeUserAction('u-2', 'c-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/super admin/i);
    expect(usersDelete).not.toHaveBeenCalled();
  });

  it('refuses to remove yourself', async () => {
    const { removeUserAction } = await import('./actions');
    const r = await removeUserAction('sa-1', 'c-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/own account/i);
    expect(usersDelete).not.toHaveBeenCalled();
  });

  it('refuses to remove the last owner but allows it when another owner remains', async () => {
    target = { id: 'u-2', role: 'owner', campaign_id: 'c-1' };
    otherOwners = 0;
    const { removeUserAction } = await import('./actions');
    const r = await removeUserAction('u-2', 'c-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/only owner/i);
    expect(usersDelete).not.toHaveBeenCalled();

    otherOwners = 1;
    const r2 = await removeUserAction('u-2', 'c-1');
    expect(r2).toEqual({ ok: true });
  });

  it('turns an FK failure into a translated message instead of throwing', async () => {
    usersDelete.mockResolvedValueOnce({ error: { message: 'violates foreign key constraint "avatars_created_by_fkey"' } });
    const { removeUserAction } = await import('./actions');
    const r = await removeUserAction('u-2', 'c-1');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/can't be removed/i);
      expect(r.error).not.toMatch(/foreign key/);
    }
  });
});

describe('impersonateAction (#15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    target = { id: 'u-2', name: 'Pat', role: 'owner', campaign_id: 'c-1', locale: 'es' };
  });

  it('writes an audit entry, sets the session cookie and redirects to the dashboard', async () => {
    const { impersonateAction } = await import('./actions');
    await expect(impersonateAction('u-2')).rejects.toMatchObject({ digest: expect.stringContaining('/dashboard') });
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'admin_impersonate', campaign_id: 'c-1', entity_type: 'user', entity_id: 'u-2', actor_user_id: 'sa-1',
    }));
    expect(auditInsert.mock.invocationCallOrder[0]).toBeLessThan(setSessionCookie.mock.invocationCallOrder[0]);
    expect(setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-2', role: 'owner', campaignId: 'c-1', locale: 'es' }));
  });

  it('refuses to impersonate a super_admin', async () => {
    target = { id: 'u-3', name: 'Root', role: 'super_admin', campaign_id: null, locale: 'en' };
    const { impersonateAction } = await import('./actions');
    const r = await impersonateAction('u-3');
    expect(r).toMatchObject({ ok: false });
    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it('reports an unknown user', async () => {
    target = null;
    const { impersonateAction } = await import('./actions');
    const r = await impersonateAction('u-404');
    expect(r).toMatchObject({ ok: false });
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('does not switch sessions when the audit entry cannot be written', async () => {
    auditInsert.mockResolvedValueOnce({ error: { message: 'db down' } });
    const { impersonateAction } = await import('./actions');
    const r = await impersonateAction('u-2');
    expect(r).toMatchObject({ ok: false });
    expect(setSessionCookie).not.toHaveBeenCalled();
  });
});
