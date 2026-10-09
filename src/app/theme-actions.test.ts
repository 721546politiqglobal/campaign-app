import { describe, it, expect, vi, beforeEach } from 'vitest';

const cookieStore = { get: vi.fn(), set: vi.fn() };
vi.mock('next/headers', () => ({ cookies: () => cookieStore }));

describe('setThemeAction', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects an unknown theme without touching the cookie', async () => {
    const { setThemeAction } = await import('./theme-actions');
    const result = await setThemeAction('neon');
    expect(result.ok).toBe(false);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('persists a valid theme in the theme cookie', async () => {
    const { setThemeAction } = await import('./theme-actions');
    const result = await setThemeAction('dark');
    expect(result.ok).toBe(true);
    const [name, value] = cookieStore.set.mock.calls[0];
    expect(name).toBe('theme');
    expect(value).toBe('dark');
  });
});
