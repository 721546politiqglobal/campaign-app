import { cookies } from 'next/headers';
import { DEFAULT_THEME, THEME_COOKIE, isTheme, type Theme } from './theme-shared';

// Colour theme preference. Resolution order: the `theme` cookie (explicit
// light / dark) → `system`, which renders no `data-theme` attribute so the CSS
// `prefers-color-scheme` media query decides. The root layout reads the cookie
// on the server and sets `<html data-theme>` so there is no flash.
//
// Server-only (uses next/headers). Client components import the constants
// from './theme-shared' instead.
export { THEMES, DEFAULT_THEME, THEME_COOKIE, isTheme, themeAttribute, type Theme } from './theme-shared';

/** Server-only: the theme the current request should render in. */
export function getTheme(): Theme {
  const value = cookies().get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : DEFAULT_THEME;
}

export function setThemeCookie(theme: Theme): void {
  cookies().set(THEME_COOKIE, theme, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === 'production',
  });
}
