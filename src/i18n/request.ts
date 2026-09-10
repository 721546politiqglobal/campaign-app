import { getRequestConfig } from 'next-intl/server';
import { getLocale, isSupportedLocale } from '@/lib/locale';

export default getRequestConfig(async ({ requestLocale }) => {
  // next-intl passes `requestLocale` through whenever a caller asked for a
  // specific locale — e.g. every `getTranslations({ locale, namespace })` in a
  // server action. Honour that explicitly-requested locale; fall back to the
  // ambient request locale (session cookie → pre-auth cookie → Accept-Language)
  // for the no-explicit-locale case (root layout, Server Components).
  const requested = await requestLocale;
  const locale = isSupportedLocale(requested) ? requested : getLocale();
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
