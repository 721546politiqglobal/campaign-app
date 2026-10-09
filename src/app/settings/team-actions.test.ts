import { describe, it, expect, vi, beforeEach } from 'vitest';

const session: { userId: string; name: string; role: string; campaignId: string; exp: number } = {
  userId: 'u-owner', name: 'Owner', role: 'owner', campaignId: 'c-1', exp: 9_999_999_999,
};
let targetUser: { id: string; role: string; campaign_id: string } | null = null;
let targetInvite: { code: string; campaign_id: string; used_at: string | null } | null = null;
let seatUsage: { used: number; limit: number | null } = { used: 1, limit: null };

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

vi.mock('@/lib/session', () => ({
  requireSession: vi.fn(() => Promise.resolve(session)),
}));

vi.mock('@/lib/data', () => ({
  getCampaignSeatUsage: vi.fn(() => Promise.resolve(seatUsage)),
}));

vi.mock('@/lib/store', () => ({ inviteCode: vi.fn(() => 'inv_test123') }));

const insertInviteCode = vi.fn((_row: unknown) => Promise.resolve({ data: null, error: null }));
const updateUser = vi.fn((_patch: unknown, ..._args: unknown[]) => Promise.resolve({ data: null, error: null }));
const deleteUser = vi.fn((..._args: unknown[]) => Promise.resolve({ data: null, error: null }));
const deleteInvite = vi.fn((..._args: unknown[]) => Promise.resolve({ data: null, error: null as unknown }));

vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: targetUser, error: null })),
            })),
          })),
          update: vi.fn((patch: unknown) => ({
            eq: (...args: unknown[]) => updateUser(patch, ...args),
          })),
          delete: vi.fn(() => ({
            eq: (...args: unknown[]) => deleteUser(...args),
          })),
        };
      }
      if (table === 'invite_codes') {
        return {
          insert: vi.fn((row: unknown) => insertInviteCode(row)),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: targetInvite, error: null })),
            })),
          })),
          // `.delete().eq('code', …).eq('campaign_id', …)` — both filters are
          // captured so the campaign scoping is observable.
          delete: vi.fn(() => ({
            eq: (k1: unknown, v1: unknown) => ({ eq: (k2: unknown, v2: unknown) => deleteInvite(k1, v1, k2, v2) }),
          })),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    }),
  },
  throwOnError: vi.fn(async (query: Promise<{ data: unknown; error: unknown }>) => {
    const { error } = await query;
    if (error) throw error;
  }),
}));

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.role = 'owner';
  session.userId = 'u-owner';
  session.campaignId = 'c-1';
  targetUser = { id: 'u-2', role: 'staff', campaign_id: 'c-1' };
  targetInvite = { code: 'inv_x', campaign_id: 'c-1', used_at: null };
  seatUsage = { used: 1, limit: null };
  deleteInvite.mockResolvedValue({ data: null, error: null });
});

describe('inviteTeammateAction', () => {
  it('denies staff', async () => {
    session.role = 'staff';
    const { inviteTeammateAction } = await import('./team-actions');
    const result = await inviteTeammateAction(formData({ role: 'manager' }));
    expect(result).toEqual({ ok: false, error: 'Permission denied.' });
    expect(insertInviteCode).not.toHaveBeenCalled();
  });

  it('rejects role "owner"', async () => {
    const { inviteTeammateAction } = await import('./team-actions');
    const result = await inviteTeammateAction(formData({ role: 'owner' }));
    expect(result.ok).toBe(false);
    expect(insertInviteCode).not.toHaveBeenCalled();
  });

  it('blocks when the seat limit is reached', async () => {
    seatUsage = { used: 3, limit: 3 };
    const { inviteTeammateAction } = await import('./team-actions');
    const result = await inviteTeammateAction(formData({ role: 'manager' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/member limit/i);
    expect(insertInviteCode).not.toHaveBeenCalled();
  });

  it("creates an invite scoped to the caller's own campaign", async () => {
    const { inviteTeammateAction } = await import('./team-actions');
    const result = await inviteTeammateAction(formData({ role: 'manager' }));
    expect(result).toEqual({ ok: true });
    expect(insertInviteCode).toHaveBeenCalledWith(expect.objectContaining({
      campaign_id: 'c-1', role: 'manager', created_by: 'u-owner', code: 'inv_test123',
    }));
    // The invites list lives on /team, not /settings.
    expect(revalidatePath).toHaveBeenCalledWith('/team');
  });

  it('allows a manager to invite too', async () => {
    session.role = 'manager';
    const { inviteTeammateAction } = await import('./team-actions');
    const result = await inviteTeammateAction(formData({ role: 'staff' }));
    expect(result).toEqual({ ok: true });
  });
});

describe('removeTeammateAction', () => {
  it('denies approver', async () => {
    session.role = 'approver';
    const { removeTeammateAction } = await import('./team-actions');
    const result = await removeTeammateAction('u-2');
    expect(result).toEqual({ ok: false, error: 'Permission denied.' });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('refuses to remove the owner', async () => {
    targetUser = { id: 'u-owner-2', role: 'owner', campaign_id: 'c-1' };
    const { removeTeammateAction } = await import('./team-actions');
    const result = await removeTeammateAction('u-owner-2');
    expect(result.ok).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('refuses to remove a user from a different campaign', async () => {
    targetUser = { id: 'u-2', role: 'staff', campaign_id: 'c-other' };
    const { removeTeammateAction } = await import('./team-actions');
    const result = await removeTeammateAction('u-2');
    expect(result.ok).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("removes a staff teammate in the caller's own campaign", async () => {
    const { removeTeammateAction } = await import('./team-actions');
    const result = await removeTeammateAction('u-2');
    expect(result).toEqual({ ok: true });
    expect(deleteUser).toHaveBeenCalledWith('id', 'u-2');
    expect(revalidatePath).toHaveBeenCalledWith('/team');
  });

  it('allows a manager to remove another manager', async () => {
    session.role = 'manager';
    targetUser = { id: 'u-3', role: 'manager', campaign_id: 'c-1' };
    const { removeTeammateAction } = await import('./team-actions');
    const result = await removeTeammateAction('u-3');
    expect(result).toEqual({ ok: true });
  });
});

describe('changeTeammateRoleAction', () => {
  it('denies staff', async () => {
    session.role = 'staff';
    const { changeTeammateRoleAction } = await import('./team-actions');
    const result = await changeTeammateRoleAction('u-2', 'manager');
    expect(result).toEqual({ ok: false, error: 'Permission denied.' });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('rejects an invalid target role', async () => {
    const { changeTeammateRoleAction } = await import('./team-actions');
    const result = await changeTeammateRoleAction('u-2', 'owner');
    expect(result.ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses to change the owner's role", async () => {
    targetUser = { id: 'u-owner-2', role: 'owner', campaign_id: 'c-1' };
    const { changeTeammateRoleAction } = await import('./team-actions');
    const result = await changeTeammateRoleAction('u-owner-2', 'manager');
    expect(result.ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('refuses to change a user in a different campaign', async () => {
    targetUser = { id: 'u-2', role: 'staff', campaign_id: 'c-other' };
    const { changeTeammateRoleAction } = await import('./team-actions');
    const result = await changeTeammateRoleAction('u-2', 'manager');
    expect(result.ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('updates the role for a valid target', async () => {
    const { changeTeammateRoleAction } = await import('./team-actions');
    const result = await changeTeammateRoleAction('u-2', 'approver');
    expect(result).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledWith({ role: 'approver' }, 'id', 'u-2');
    expect(revalidatePath).toHaveBeenCalledWith('/team');
  });
});

describe('revokeInviteAction', () => {
  it('denies staff', async () => {
    session.role = 'staff';
    const { revokeInviteAction } = await import('./team-actions');
    const result = await revokeInviteAction('inv_x');
    expect(result).toEqual({ ok: false, error: 'Permission denied.' });
    expect(deleteInvite).not.toHaveBeenCalled();
  });

  it('reports an unknown code', async () => {
    targetInvite = null;
    const { revokeInviteAction } = await import('./team-actions');
    const result = await revokeInviteAction('inv_missing');
    expect(result).toEqual({ ok: false, error: 'Invite not found.' });
    expect(deleteInvite).not.toHaveBeenCalled();
  });

  it("refuses to revoke another campaign's invite (reported as not found)", async () => {
    targetInvite = { code: 'inv_x', campaign_id: 'c-other', used_at: null };
    const { revokeInviteAction } = await import('./team-actions');
    const result = await revokeInviteAction('inv_x');
    expect(result).toEqual({ ok: false, error: 'Invite not found.' });
    expect(deleteInvite).not.toHaveBeenCalled();
  });

  it('refuses to revoke an invite that was already redeemed', async () => {
    targetInvite = { code: 'inv_x', campaign_id: 'c-1', used_at: '2026-01-01T00:00:00Z' };
    const { revokeInviteAction } = await import('./team-actions');
    const result = await revokeInviteAction('inv_x');
    expect(result).toEqual({ ok: false, error: 'This invite has already been used.' });
    expect(deleteInvite).not.toHaveBeenCalled();
  });

  it("deletes an unused invite scoped to the caller's own campaign", async () => {
    const { revokeInviteAction } = await import('./team-actions');
    const result = await revokeInviteAction('inv_x');
    expect(result).toEqual({ ok: true });
    expect(deleteInvite).toHaveBeenCalledWith('code', 'inv_x', 'campaign_id', 'c-1');
    expect(revalidatePath).toHaveBeenCalledWith('/team');
  });

  it('returns a translated error when the delete fails', async () => {
    deleteInvite.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { revokeInviteAction } = await import('./team-actions');
    const result = await revokeInviteAction('inv_x');
    expect(result).toEqual({ ok: false, error: 'Could not revoke the invite. Please try again.' });
    consoleError.mockRestore();
  });
});
