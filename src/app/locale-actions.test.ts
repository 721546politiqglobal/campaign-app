import { describe, it, expect, vi, beforeEach } from 'vitest';

const setLocaleCookie = vi.fn();
vi.mock('@/lib/locale', async () => {
  const actual = await vi.importActual<typeof import('@/lib/locale')>('@/lib/locale');
  return { ...actual, setLocaleCookie };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

describe('setPreAuthLocaleAction', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sets the cookie for a supported locale', async () => {
    const { setPreAuthLocaleAction } = await import('./locale-actions');
    await setPreAuthLocaleAction('es');
    expect(setLocaleCookie).toHaveBeenCalledWith('es');
  });

  it('ignores an unsupported value', async () => {
    const { setPreAuthLocaleAction } = await import('./locale-actions');
    await setPreAuthLocaleAction('fr');
    expect(setLocaleCookie).not.toHaveBeenCalled();
  });
});
