import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';
import type { AdminPage } from '@/lib/data';

/**
 * Footer for a paginated `.table-wrap` card: "x–y of n" + prev/next links.
 * Server component; `hrefFor(page)` builds the link for a given page.
 */
export async function Pagination({ page, hrefFor }: { page: AdminPage<unknown>; hrefFor: (page: number) => string }) {
  const t = await getTranslations('admin.common');
  if (page.total === 0) return null;
  const from = (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.total, page.page * page.pageSize);
  const hasPrev = page.page > 1;
  const hasNext = page.page < page.pageCount;

  return (
    <nav className="admin-pager" aria-label={t('pagination')}>
      <span className="num">{t('showing', { from, to, total: page.total })}</span>
      <div className="admin-pager-nav">
        <span className="subtle text-xs">{t('pageOf', { page: page.page, pageCount: page.pageCount })}</span>
        {hasPrev
          ? <Link href={hrefFor(page.page - 1)} className="btn btn-sm" rel="prev"><ChevronLeftIcon size={14} />{t('previous')}</Link>
          : <span className="btn btn-sm" aria-disabled="true"><ChevronLeftIcon size={14} />{t('previous')}</span>}
        {hasNext
          ? <Link href={hrefFor(page.page + 1)} className="btn btn-sm" rel="next">{t('next')}<ChevronRightIcon size={14} /></Link>
          : <span className="btn btn-sm" aria-disabled="true">{t('next')}<ChevronRightIcon size={14} /></span>}
      </div>
    </nav>
  );
}
