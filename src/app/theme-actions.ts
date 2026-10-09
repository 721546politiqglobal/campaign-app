'use server';

import { isTheme, setThemeCookie } from '@/lib/theme';

// Persists the colour-theme preference. The toggle applies the theme
// optimistically on the client (`document.documentElement.dataset.theme`) and
// then calls this so the next server render agrees with it (no flash).
export async function setThemeAction(theme: string): Promise<{ ok: boolean }> {
  if (!isTheme(theme)) return { ok: false };
  setThemeCookie(theme);
  return { ok: true };
}
