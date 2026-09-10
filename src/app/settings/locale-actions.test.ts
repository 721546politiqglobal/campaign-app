import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

// setSessionCookie is the REAL implementation here (only requireSession is
// stubbed), so the cookie value below is a genuinely signed session token —
// decode it the same way session.ts does to inspect what got re-signed.
process.env.SESSION_SECRET = 'test-secret';

function decodeSessionCookie(raw: string) {
  const idx = raw.lastIndexOf('.');
  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  expect(sig).toBe(createHmac('sha256', 'test-secret').update(payload).digest('base64url'));
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}

const cookieStore = { set: vi.fn() };
vi.mock('next/headers', () => ({ cookies: () => cookieStore }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const requireSession = vi.fn();
vi.mock('@/lib/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/session')>('@/lib/session');
  return { ...actual, requireSession };
});

// `eq` is a single shared mock, not one created per update() call — otherwise
// the `.eq('id', s.userId)` that scopes the write to the caller's OWN row is
// unobservable, which is the whole point of the assertion below.
const eq = vi.fn().mockResolvedValue({ error: null });
const update = vi.fn(() => ({ eq }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: () => ({ update }) },
  throwOnError: async (p: Promise<{ error: unknown }>) => { await p; },
}));

const session = { userId: 'u-1', name: 'O', role: 'owner', campaignId: 'c-1', locale: 'en', exp: 1893456000 };

describe('updateLocaleAction', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects a value outside SUPPORTED_LOCALES', async () => {
    requireSession.mockResolvedValue(session);
    const { updateLocaleAction } = await import('./locale-actions');
    const result = await updateLocaleAction('fr');
    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('persists a valid locale for the caller\'s own row', async () => {
    requireSession.mockResolvedValue(session);
    const { updateLocaleAction } = await import('./locale-actions');
    const result = await updateLocaleAction('es');
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ locale: 'es' });
    expect(eq).toHaveBeenCalledWith('id', 'u-1');
  });

  it('re-signs the session cookie with the new locale and the original exp', async () => {
    requireSession.mockResolvedValue(session);
    const { updateLocaleAction } = await import('./locale-actions');
    await updateLocaleAction('es');

    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    const [name, value] = cookieStore.set.mock.calls[0];
    expect(name).toBe('cc_session');
    const payload = decodeSessionCookie(value);
    expect(payload.locale).toBe('es');
    // The re-sign must not extend (or shorten) the session's lifetime.
    expect(payload.exp).toBe(session.exp);
    expect(payload.userId).toBe('u-1');
  });
});
