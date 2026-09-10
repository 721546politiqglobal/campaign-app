import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

process.env.SESSION_SECRET = 'test-secret';

function signCookie(payloadObj: object): string {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = createHmac('sha256', 'test-secret').update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const cookieStore = { get: vi.fn(), set: vi.fn() };
vi.mock('next/headers', () => ({ cookies: () => cookieStore }));

const maybeSingle = vi.fn();
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) },
}));

const future = Math.floor(Date.now() / 1000) + 10_000;

describe('session locale', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getSession returns the locale column from the DB row', async () => {
    cookieStore.get.mockReturnValue({
      value: signCookie({ userId: 'u-1', name: 'O', role: 'owner', campaignId: 'c-1', locale: 'en', exp: future }),
    });
    maybeSingle.mockResolvedValue({ data: { id: 'u-1', name: 'O', role: 'owner', campaign_id: 'c-1', locale: 'es' } });
    const { getSession } = await import('./session');
    const s = await getSession();
    expect(s?.locale).toBe('es');
  });

  it('peekSessionLocale reads locale straight from a validly-signed cookie, no DB call', async () => {
    cookieStore.get.mockReturnValue({
      value: signCookie({ userId: 'u-1', name: 'O', role: 'owner', campaignId: 'c-1', locale: 'es', exp: future }),
    });
    const { peekSessionLocale } = await import('./session');
    expect(peekSessionLocale()).toBe('es');
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('peekSessionLocale returns null when there is no valid cookie', async () => {
    cookieStore.get.mockReturnValue(undefined);
    const { peekSessionLocale } = await import('./session');
    expect(peekSessionLocale()).toBeNull();
  });
});
