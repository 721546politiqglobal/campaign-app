import { describe, it, expect, vi, beforeEach } from 'vitest';
import en from '@/messages/en.json';
import { INITIAL_FORM_STATE } from '@/lib/form-state';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));
vi.mock('next/headers', () => ({
  headers: () => ({ get: (name: string) => (name === 'x-forwarded-for' ? '203.0.113.9' : null) }),
  cookies: () => ({ get: () => undefined, set: vi.fn() }),
}));
const compare = vi.fn(async () => false);
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(), compare } }));
const setSessionCookie = vi.fn();
vi.mock('@/lib/session', () => ({ setSessionCookie, requireSession: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/locale', () => ({ getLocale: vi.fn(() => 'en') }));

const isLockedOut = vi.fn(() => false);
const getAttempts = vi.fn(async () => null);
const recordFailure = vi.fn(async () => undefined);
const clearAttempts = vi.fn(async () => undefined);
vi.mock('@/lib/login-throttle', () => ({ isLockedOut, getAttempts, recordFailure, clearAttempts }));

const userSingle = vi.fn(async (): Promise<{ data: Record<string, unknown> | null }> => ({ data: null }));
vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: vi.fn((table: string) => {
      if (table === 'users') return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: userSingle })) })) };
      throw new Error(`unexpected table ${table}`);
    }),
  },
  throwOnError: async (q: any) => (await q).data,
}));

function loginForm(email = 'owner@example.com', password = 'secret-pass') {
  const fd = new FormData();
  fd.set('email', email); fd.set('password', password);
  return fd;
}

async function login(fd = loginForm()) {
  const { loginAction } = await import('./actions');
  return loginAction(INITIAL_FORM_STATE, fd);
}

const E = en.login.errors;
const USER = { id: 'u-1', name: 'Owner', role: 'owner', campaign_id: 'c-1', password_hash: 'hash', locale: 'en' };

describe('loginAction (useFormState)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isLockedOut.mockReturnValue(false);
    compare.mockResolvedValue(false);
    userSingle.mockResolvedValue({ data: null });
  });

  it('returns the credentials error and keeps the email when a field is empty', async () => {
    const result = await login(loginForm('Owner@Example.com', ''));
    expect(result).toEqual({ ok: false, error: E.incorrectCredentials, values: { email: 'owner@example.com' } });
    expect(compare).not.toHaveBeenCalled();
  });

  it('fails closed with the lockout message before touching bcrypt', async () => {
    isLockedOut.mockReturnValue(true);
    const result = await login();
    expect(result).toEqual({ ok: false, error: E.tooManyAttempts, values: { email: 'owner@example.com' } });
    expect(compare).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('records a failure for both ip and email keys on a wrong password and never echoes it back', async () => {
    userSingle.mockResolvedValue({ data: USER });
    compare.mockResolvedValue(false);
    const result = await login();
    expect(result).toEqual({ ok: false, error: E.incorrectCredentials, values: { email: 'owner@example.com' } });
    expect(result.values).not.toHaveProperty('password');
    expect(recordFailure).toHaveBeenCalledWith('ip:203.0.113.9', expect.any(Number));
    expect(recordFailure).toHaveBeenCalledWith('email:owner@example.com', expect.any(Number));
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('still runs bcrypt against the dummy hash for an unknown email (no enumeration)', async () => {
    userSingle.mockResolvedValue({ data: null });
    await login();
    expect(compare).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledTimes(2);
  });

  it('clears the throttle, sets the session cookie and redirects on success', async () => {
    userSingle.mockResolvedValue({ data: USER });
    compare.mockResolvedValue(true);
    await expect(login()).rejects.toThrow(/REDIRECT:\/dashboard/);
    expect(clearAttempts).toHaveBeenCalledTimes(2);
    expect(setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-1', role: 'owner', campaignId: 'c-1', locale: 'en' }));
  });

  it('sends super admins to /admin', async () => {
    userSingle.mockResolvedValue({ data: { ...USER, role: 'super_admin', campaign_id: null } });
    compare.mockResolvedValue(true);
    await expect(login()).rejects.toThrow(/REDIRECT:\/admin/);
  });
});
