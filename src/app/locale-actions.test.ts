import { describe, it, expect, vi, beforeEach } from 'vitest';

const setLocaleCookie = vi.fn();
vi.mock('@/lib/locale', async () => {
  const actual = await vi.importActual<typeof import('@/lib/locale')>('@/lib/locale');
  return { ...actual, setLocaleCookie };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const getSession = vi.fn();
const setSessionCookie = vi.fn();
vi.mock('@/lib/session', () => ({ getSession, setSessionCookie }));

const eq = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ update }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from },
  throwOnError: async (p: Promise<unknown>) => p,
}));

const session = { userId: 'u1', name: 'Ana', role: 'owner', campaignId: 'c1', locale: 'en', exp: 123 };

describe('setPreAuthLocaleAction', () => {
  beforeEach(() => { vi.clearAllMocks(); getSession.mockResolvedValue(null); });

  it('sets the cookie for a supported locale', async () => {
    const { setPreAuthLocaleAction } = await import('./locale-actions');
    await setPreAuthLocaleAction('es');
    expect(setLocaleCookie).toHaveBeenCalledWith('es');
  });

  it('ignores an unsupported value', async () => {
    const { setPreAuthLocaleAction } = await import('./locale-actions');
    await setPreAuthLocaleAction('fr');
    expect(setLocaleCookie).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('does not touch the database when signed out', async () => {
    const { setPreAuthLocaleAction } = await import('./locale-actions');
    await setPreAuthLocaleAction('es');
    expect(from).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('saves the locale to the signed-in user and re-signs the session', async () => {
    getSession.mockResolvedValue(session);
    const { setPreAuthLocaleAction } = await import('./locale-actions');
    await setPreAuthLocaleAction('es');
    expect(from).toHaveBeenCalledWith('users');
    expect(update).toHaveBeenCalledWith({ locale: 'es' });
    expect(eq).toHaveBeenCalledWith('id', 'u1');
    expect(setSessionCookie).toHaveBeenCalledWith({ ...session, locale: 'es' });
  });
});
