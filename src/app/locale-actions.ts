'use server';

import { revalidatePath } from 'next/cache';
import { isSupportedLocale, setLocaleCookie } from '@/lib/locale';

export async function setPreAuthLocaleAction(locale: string): Promise<void> {
  if (!isSupportedLocale(locale)) return;
  setLocaleCookie(locale);
  revalidatePath('/', 'layout');
}
