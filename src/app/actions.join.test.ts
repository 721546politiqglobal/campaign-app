import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Real Next redirect() throws; model that so control flow stops at the redirect.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(async () => 'hashed'), compare: vi.fn() } }));
const setSessionCookie = vi.fn();
vi.mock('@/lib/session', () => ({ setSessionCookie, requireSession: vi.fn(), signOut: vi.fn() }));
// getLocale() reads next/headers cookies()/headers(), neither of which exists
// under plain Vitest — stub it to the language a Spanish joiner would have
// picked with the pre-auth toggle on /join.
vi.mock('@/lib/locale', () => ({ getLocale: vi.fn(() => 'es') }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(() => 'u-new'), uid: vi.fn(), inviteCode: vi.fn() }));

const usersInsert = vi.fn(async () => ({ error: null }));
const usersUpdateEq = vi.fn(async () => ({ error: null }));
const usersUpdate = vi.fn(() => ({ eq: usersUpdateEq }));
const claimMaybeSingle = vi.fn();
const inviteSelectSingle = vi.fn();
const existingMaybeSingle = vi.fn(async (): Promise<{ data: { id: string; password_hash: string | null } | null }> => ({ data: null }));

function makeAdminDb() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'invite_codes') {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ single: inviteSelectSingle })) })),
          update: vi.fn(() => ({ eq: vi.fn(() => ({ is: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle: claimMaybeSingle })) })) })) })),
        };
      }
      if (table === 'users') {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: existingMaybeSingle })) })),
          insert: usersInsert,
          update: usersUpdate,
        };
      }
      if (table === 'audit_entries') return { insert: vi.fn(async () => ({ error: null })) };
      return {};
    }),
  };
}
vi.mock('@/lib/supabase', () => ({ adminDb: makeAdminDb(), throwOnError: async (q: any) => (await q).data }));

function joinForm() {
  const fd = new FormData();
  fd.set('code', 'inv_abc'); fd.set('name', 'New User');
  fd.set('email', 'new@example.com'); fd.set('password', 'password123');
  return fd;
}

describe('joinAction single-use invite claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inviteSelectSingle.mockResolvedValue({ data: { code: 'inv_abc', campaign_id: 'c-1', role: 'staff', used_at: null, expires_at: '2999-01-01T00:00:00Z' } });
    existingMaybeSingle.mockResolvedValue({ data: null });
  });

  it('redirects with error=used and never creates a user when the atomic claim returns no row', async () => {
    claimMaybeSingle.mockResolvedValue({ data: null });
    const { joinAction } = await import('./actions');
    await expect(joinAction(joinForm())).rejects.toThrow(/REDIRECT:.*error=used/);
    expect(usersInsert).not.toHaveBeenCalled();
    expect(usersUpdateEq).not.toHaveBeenCalled();
  });

  it('creates the user when the atomic claim wins the row', async () => {
    claimMaybeSingle.mockResolvedValue({ data: { code: 'inv_abc' } });
    const { joinAction } = await import('./actions');
    await expect(joinAction(joinForm())).rejects.toThrow(/REDIRECT:\/dashboard/);
    expect(usersInsert).toHaveBeenCalledTimes(1);
  });

  it('persists the language the joiner picked on the pre-auth toggle', async () => {
    claimMaybeSingle.mockResolvedValue({ data: { code: 'inv_abc' } });
    const { joinAction } = await import('./actions');
    await expect(joinAction(joinForm())).rejects.toThrow(/REDIRECT:\/dashboard/);
    expect(usersInsert).toHaveBeenCalledWith(expect.objectContaining({ locale: 'es' }));
    expect(setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ locale: 'es' }));
  });

  it('persists the picked language when claiming an invited placeholder row', async () => {
    existingMaybeSingle.mockResolvedValue({ data: { id: 'u-placeholder', password_hash: null } });
    claimMaybeSingle.mockResolvedValue({ data: { code: 'inv_abc' } });
    const { joinAction } = await import('./actions');
    await expect(joinAction(joinForm())).rejects.toThrow(/REDIRECT:\/dashboard/);
    expect(usersInsert).not.toHaveBeenCalled();
    expect(usersUpdate).toHaveBeenCalledWith(expect.objectContaining({ locale: 'es' }));
    expect(usersUpdateEq).toHaveBeenCalledWith('id', 'u-placeholder');
    expect(setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ locale: 'es' }));
  });
});
