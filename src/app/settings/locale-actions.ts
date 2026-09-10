'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { requireSession, setSessionCookie } from '@/lib/session';
import { adminDb, throwOnError } from '@/lib/supabase';
import { isSupportedLocale } from '@/lib/locale';

export async function updateLocaleAction(locale: string): Promise<{ ok: boolean; error?: string }> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.team' });
  if (!isSupportedLocale(locale)) return { ok: false, error: t('invalidLanguage') };

  await throwOnError(
    adminDb.from('users').update({ locale }).eq('id', s.userId),
    'users.update_locale',
  );

  // Re-sign the cookie so the new locale takes effect on the very next
  // request instead of waiting for the (up to 7-day-old) cookie to reissue.
  setSessionCookie({
    userId: s.userId,
    name: s.name,
    role: s.role,
    campaignId: s.campaignId,
    locale,
    exp: s.exp,
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
