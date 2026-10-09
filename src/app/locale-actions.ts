'use server';

import { revalidatePath } from 'next/cache';
import { isSupportedLocale, setLocaleCookie } from '@/lib/locale';
import { getSession, setSessionCookie } from '@/lib/session';
import { adminDb, throwOnError } from '@/lib/supabase';

// Language toggle on the public pages (landing / login / join). Signed-in
// visitors render in their account locale, which outranks the pre-auth cookie,
// so for them the choice is also saved to the account and the session cookie
// is re-signed — otherwise the toggle would appear to do nothing.
export async function setPreAuthLocaleAction(locale: string): Promise<void> {
  if (!isSupportedLocale(locale)) return;
  setLocaleCookie(locale);

  const s = await getSession();
  if (s) {
    await throwOnError(
      adminDb.from('users').update({ locale }).eq('id', s.userId),
      'users.update_locale',
    );
    setSessionCookie({ ...s, locale });
  }

  revalidatePath('/', 'layout');
}
