'use client';

import { useTransition } from 'react';
import { setPreAuthLocaleAction } from '@/app/locale-actions';
import type { Locale } from '@/lib/locale';

const LABEL: Record<Locale, string> = { en: 'EN', es: 'ES' };
const SWITCH_TO_LABEL: Record<Locale, string> = { en: 'Switch to Español', es: 'Cambiar a English' };

export function PreAuthLanguageToggle({ currentLocale }: { currentLocale: Locale }) {
  const [isPending, startTransition] = useTransition();
  const other: Locale = currentLocale === 'en' ? 'es' : 'en';

  return (
    <button
      type="button"
      className="lang-toggle"
      disabled={isPending}
      title={SWITCH_TO_LABEL[currentLocale]}
      aria-label={SWITCH_TO_LABEL[currentLocale]}
      onClick={() => startTransition(() => { setPreAuthLocaleAction(other); })}
    >
      <svg className="lang-toggle-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M1.75 8h12.5M8 1.75c1.8 1.7 2.8 4 2.8 6.25s-1 4.55-2.8 6.25c-1.8-1.7-2.8-4-2.8-6.25S6.2 3.45 8 1.75Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
      <span>{LABEL[currentLocale]}</span>
    </button>
  );
}
