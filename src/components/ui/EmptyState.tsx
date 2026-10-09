import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';

/**
 * Designed empty state with an icon, title, description and a CTA. Server-safe.
 *
 *   <EmptyState
 *     icon="content"
 *     title={t('empty.title')}
 *     description={t('empty.description')}
 *     action={<Link href="/content/new" className="btn btn-primary">{t('empty.cta')}</Link>}
 *   />
 *
 * Inside a `.card` it drops its own dashed border (`.card > .empty-state`);
 * pass `plain` to do the same anywhere.
 */
export interface EmptyStateProps {
  icon?: IconName | ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  plain?: boolean;
  className?: string;
}

export function EmptyState({ icon, title, description, action, plain, className }: EmptyStateProps) {
  const classes = ['empty-state', plain ? 'plain' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      {icon && (
        <div className="empty-state-icon" aria-hidden="true">
          {typeof icon === 'string' ? <Icon name={icon as IconName} size={20} /> : icon}
        </div>
      )}
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-desc">{description}</p>}
      {action && <div className="empty-state-actions">{action}</div>}
    </div>
  );
}
