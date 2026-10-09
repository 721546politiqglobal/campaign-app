'use client';

import { useTransition } from 'react';
import { setPreAuthLocaleAction } from '@/app/locale-actions';
import { GlobeIcon } from '@/components/icons';
import type { Locale } from '@/lib/locale';

const LABEL: Record<Locale, string> = { en: 'EN', es: 'ES' };
// Deliberately names the *target* language in that language, so a visitor who
// cannot read the current one still finds the switch.
const SWITCH_TO_LABEL: Record<Locale, string> = { en: 'Switch to Español', es: 'Cambiar a English' };

export function PreAuthLanguageToggle({ currentLocale }: { currentLocale: Locale }) {
  const [isPending, startTransition] = useTransition();
  const other: Locale = currentLocale === 'en' ? 'es' : 'en';

  return (
    <button
      type="button"
      className="lang-toggle"
      disabled={isPending}
      aria-busy={isPending}
      title={SWITCH_TO_LABEL[currentLocale]}
      aria-label={SWITCH_TO_LABEL[currentLocale]}
      onClick={() => startTransition(() => { setPreAuthLocaleAction(other); })}
    >
      <GlobeIcon size={14} className="lang-toggle-icon" />
      <span>{LABEL[currentLocale]}</span>
    </button>
  );
}
