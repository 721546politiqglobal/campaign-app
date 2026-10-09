import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { ChevronRightIcon } from '@/components/icons';

/**
 * Page-level header: optional breadcrumb → eyebrow → h1 title → description,
 * with an actions slot on the right. Server-safe.
 *
 *   <PageHeader
 *     title={t('title')}
 *     description={t('description')}
 *     eyebrow={t('eyebrow')}
 *     breadcrumb={[{ label: t('content'), href: '/content' }, { label: item.title }]}
 *     actions={<Link href="/content/new" className="btn btn-primary">{t('new')}</Link>}
 *   />
 */
export interface BreadcrumbItem { label: ReactNode; href?: string }

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: BreadcrumbItem[];
  /** Accessible name for the breadcrumb nav (translate it). */
  breadcrumbLabel?: string;
  /** Extra content under the title row (e.g. a status pill next to the title). */
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, eyebrow, actions, breadcrumb, breadcrumbLabel, meta, className }: PageHeaderProps) {
  return (
    <>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="breadcrumb" aria-label={breadcrumbLabel}>
          {breadcrumb.map((item, i) => {
            const last = i === breadcrumb.length - 1;
            return (
              <Fragment key={i}>
                {item.href && !last
                  ? <Link href={item.href}>{item.label}</Link>
                  : <span aria-current={last ? 'page' : undefined}>{item.label}</span>}
                {!last && <span className="breadcrumb-sep" aria-hidden="true"><ChevronRightIcon size={14} /></span>}
              </Fragment>
            );
          })}
        </nav>
      )}
      <header className={className ? `page-header ${className}` : 'page-header'}>
        <div className="page-header-main">
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <div className="page-header-title-row">
            <h1>{title}</h1>
            {meta}
          </div>
          {description && <p className="page-header-desc">{description}</p>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </header>
    </>
  );
}
