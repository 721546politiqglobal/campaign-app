'use client';

import { useTranslations } from 'next-intl';
import type { ContentStatus } from '@/domain/types';
import { Badge, type BadgeTone } from '@/components/ui/Badge';

const TONE: Record<ContentStatus, BadgeTone> = {
  draft: 'neutral',
  in_review: 'warn',
  approved: 'info',
  scheduled: 'purple',
  publishing: 'accent',
  published: 'ok',
  rejected: 'bad',
  archived: 'neutral',
};

export function StatusPill({ status, size }: { status: ContentStatus; size?: 'sm' | 'md' }) {
  const t = useTranslations('common');
  const label = t(`status.${status}`);
  return (
    <Badge tone={TONE[status] ?? 'neutral'} dot size={size} aria-label={t('statusAriaLabel', { status: label })}>
      {label}
    </Badge>
  );
}
