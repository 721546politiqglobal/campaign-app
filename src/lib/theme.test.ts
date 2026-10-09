import { describe, it, expect, vi, beforeEach } from 'vitest';

const cookieStore = { get: vi.fn(), set: vi.fn() };
vi.mock('next/headers', () => ({ cookies: () => cookieStore }));

describe('theme', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('isTheme accepts only the supported values', async () => {
    const { isTheme } = await import('./theme');
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('system')).toBe(true);
    expect(isTheme('sepia')).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it('getTheme reads the cookie and falls back to system', async () => {
    const { getTheme } = await import('./theme');
    cookieStore.get.mockReturnValueOnce({ value: 'dark' });
    expect(getTheme()).toBe('dark');
    cookieStore.get.mockReturnValueOnce({ value: 'bogus' });
    expect(getTheme()).toBe('system');
    cookieStore.get.mockReturnValueOnce(undefined);
    expect(getTheme()).toBe('system');
  });

  it('themeAttribute omits the attribute for system', async () => {
    const { themeAttribute } = await import('./theme');
    expect(themeAttribute('system')).toBeUndefined();
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
  });

  it('setThemeCookie sets a one-year lax cookie on /', async () => {
    const { setThemeCookie } = await import('./theme');
    setThemeCookie('light');
    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    const [name, value, opts] = cookieStore.set.mock.calls[0];
    expect(name).toBe('theme');
    expect(value).toBe('light');
    expect(opts).toMatchObject({ sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  });
});
