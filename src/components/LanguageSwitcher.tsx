'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { updateLocaleAction } from '@/app/settings/locale-actions';
import { useToast } from '@/components/Toast';
import type { Locale } from '@/lib/locale';

export function LanguageSwitcher({ currentLocale }: { currentLocale: Locale }) {
  const t = useTranslations('common');
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="field">
      <span>{t('language')}</span>
      <select
        defaultValue={currentLocale}
        disabled={isPending}
        onChange={(e) => {
          const locale = e.target.value as Locale;
          // Surface a failed switch instead of letting the rejected promise
          // disappear — otherwise the select silently snaps back to a language
          // the user did not choose with no explanation.
          startTransition(() => {
            updateLocaleAction(locale)
              .then(result => {
                if (!result.ok) toast(result.error ?? t('languageUpdateFailed'), 'error');
              })
              .catch(() => toast(t('languageUpdateFailed'), 'error'));
          });
        }}
      >
        <option value="en">{t('languageEnglish')}</option>
        <option value="es">{t('languageSpanish')}</option>
      </select>
    </label>
  );
}
