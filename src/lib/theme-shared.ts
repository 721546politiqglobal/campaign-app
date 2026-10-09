// Client-safe half of the theme module (no `next/headers`). Server code should
// import from './theme', which re-exports everything here plus the cookie
// helpers.
export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = 'system';
export const THEME_COOKIE = 'theme';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** The value for `<html data-theme>`: undefined for `system` (follow the OS). */
export function themeAttribute(theme: Theme): 'light' | 'dark' | undefined {
  return theme === 'system' ? undefined : theme;
}
