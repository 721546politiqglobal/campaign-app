import type { ReactNode } from 'react';

/**
 * Status badge. Tones map to the semantic tokens; `dot` adds a leading dot.
 * Server-safe.
 *
 *   <Badge tone="ok" dot>{t('status.published')}</Badge>
 *   <Badge tone="neutral" size="sm">{role}</Badge>
 *
 * CSS equivalent: `.badge .badge-<tone> [.badge-dot] [.badge-sm]`. The legacy
 * `.pill.<content-status>` and `.tag` classes share the same styles.
 */
export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info' | 'purple';

export interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  title?: string;
  'aria-label'?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', dot, size = 'md', className, children, ...rest }: BadgeProps) {
  const classes = ['badge', `badge-${tone}`, dot ? 'badge-dot' : '', size === 'sm' ? 'badge-sm' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <span className={classes} {...rest}>{children}</span>;
}
