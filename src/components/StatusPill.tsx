'use client';

import { useTranslations } from 'next-intl';
import { ContentStatus } from '@/domain/types';

export function StatusPill({ status }: { status: ContentStatus }) {
  const t = useTranslations('common');
  return (
    <span className={`pill ${status}`} aria-label={t('statusAriaLabel', { status: t(`status.${status}`) })}>
      {t(`status.${status}`)}
    </span>
  );
}
