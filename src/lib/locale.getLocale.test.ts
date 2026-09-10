import { describe, it, expect, vi, beforeEach } from 'vitest';

const cookieStore = { get: vi.fn(), set: vi.fn() };
const headerStore = { get: vi.fn() };
vi.mock('next/headers', () => ({ cookies: () => cookieStore, headers: () => headerStore }));

const peekSessionLocale = vi.fn();
vi.mock('./session', () => ({ peekSessionLocale }));

describe('getLocale', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('prefers a supported locale from the session cookie', async () => {
    peekSessionLocale.mockReturnValue('es');
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('es');
  });

  it('falls back to the pre-auth locale cookie when there is no session', async () => {
    peekSessionLocale.mockReturnValue(null);
    cookieStore.get.mockReturnValue({ value: 'es' });
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('es');
  });

  it('falls back to Accept-Language when there is no session or cookie', async () => {
    peekSessionLocale.mockReturnValue(null);
    cookieStore.get.mockReturnValue(undefined);
    headerStore.get.mockReturnValue('es-MX,es;q=0.9,en;q=0.8');
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('es');
  });

  it('defaults to en when nothing matches', async () => {
    peekSessionLocale.mockReturnValue(null);
    cookieStore.get.mockReturnValue(undefined);
    headerStore.get.mockReturnValue('fr-FR,fr;q=0.9');
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('en');
  });

  it('ignores an unsupported/corrupted value from the session cookie', async () => {
    peekSessionLocale.mockReturnValue('xx');
    cookieStore.get.mockReturnValue(undefined);
    headerStore.get.mockReturnValue(null);
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('en');
  });
});
