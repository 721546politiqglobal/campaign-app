import { cookies, headers } from 'next/headers';
import { peekSessionLocale } from './session';

import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from './locale-shared';

export { SUPPORTED_LOCALES, DEFAULT_LOCALE, isSupportedLocale } from './locale-shared';
export type { Locale } from './locale-shared';

const LOCALE_COOKIE = 'locale';

// Picks the language the current request renders in:
// 1. The signed-in user's session cookie (peekSessionLocale — no DB call).
// 2. The `locale` cookie set by the pre-auth language toggle.
// 3. The browser's Accept-Language header.
// 4. DEFAULT_LOCALE.
export function getLocale(): Locale {
  const sessionLocale = peekSessionLocale();
  if (isSupportedLocale(sessionLocale)) return sessionLocale;

  const cookieLocale = cookies().get(LOCALE_COOKIE)?.value;
  if (isSupportedLocale(cookieLocale)) return cookieLocale;

  const acceptLanguage = headers().get('accept-language') ?? '';
  for (const tag of acceptLanguage.split(',')) {
    const lang = tag.trim().split(';')[0].split('-')[0];
    if (isSupportedLocale(lang)) return lang;
  }

  return DEFAULT_LOCALE;
}

export function setLocaleCookie(locale: Locale): void {
  // Matches setSessionCookie's flags. Nothing reads this cookie from client-side
  // JS — the pre-auth toggle and the settings switcher both go through server
  // actions — so httpOnly costs nothing and keeps it out of reach of scripts.
  cookies().set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === 'production',
  });
}
