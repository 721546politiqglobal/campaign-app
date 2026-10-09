import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/app/admin/_components/Pagination';
import { SortLink, ariaSort } from '@/app/admin/_components/SortLink';
import { adminFormat } from '@/app/admin/_components/format';
import { isCampaignActive } from '@/lib/campaign-filters';
import type { AdminPage, CampaignWithStats, CampaignSort } from '@/lib/data';

/**
 * Paginated campaigns table (server component). Filtering, search, sort and
 * pagination are all server-side — the caller passes the current page plus
 * `hrefFor` builders so links preserve the rest of the query.
 */
export async function CampaignsTable({ page, sort, dir, filtered, hrefForPage, hrefForSort, newCampaignAction, compact }: {
  page: AdminPage<CampaignWithStats>;
  sort: CampaignSort;
  dir: 'asc' | 'desc';
  /** True when a search/filter is active (changes the empty state copy). */
  filtered: boolean;
  hrefForPage: (page: number) => string;
  hrefForSort: (sort: string, dir: 'asc' | 'desc') => string;
  /** CTA rendered in the "no campaigns yet" empty state. */
  newCampaignAction?: React.ReactNode;
  /** Hide the pager (used on the overview, which links to the full list). */
  compact?: boolean;
}) {
  const t = await getTranslations('admin.campaignsTable');
  const f = await adminFormat();

  if (page.rows.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon="campaign"
          title={filtered ? t('emptyFiltered') : t('emptyNone')}
          description={filtered ? t('emptyFilteredDesc') : t('emptyNoneDesc')}
          action={filtered ? undefined : newCampaignAction}
        />
      </div>
    );
  }

  return (
    <div className="card card-sectioned">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th aria-sort={ariaSort(sort, 'name', dir)}>
                <SortLink column="name" label={t('colCampaign')} sort={sort} dir={dir} hrefFor={hrefForSort} />
              </th>
              <th>{t('colJurisdictions')}</th>
              <th>{t('colTags')}</th>
              <th>{t('colStatus')}</th>
              <th className="num">{t('colUsers')}</th>
              <th className="num">{t('colContent')}</th>
              <th aria-sort={ariaSort(sort, 'created', dir)}>
                <SortLink column="created" label={t('colCreated')} sort={sort} dir={dir} defaultDir="desc" hrefFor={hrefForSort} />
              </th>
              <th><span className="sr-only">{t('manage')}</span></th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map(c => {
              const active = isCampaignActive(c.subscriptionStatus);
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/campaigns/${c.id}`} className="row-link">{c.name}</Link>
                    {c.inReviewCount > 0 && (
                      <div className="admin-cell-sub">
                        <span className="admin-warn-text">{t('inReviewCount', { count: c.inReviewCount })}</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="admin-tags">
                      {c.jurisdictions.map(j => <span key={j} className="tag">{j}</span>)}
                    </div>
                  </td>
                  <td>
                    <div className="admin-tags">
                      {c.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
                    </div>
                  </td>
                  <td>
                    <Badge tone={active ? 'ok' : 'neutral'} dot>{active ? t('active') : t('inactive')}</Badge>
                  </td>
                  <td className="num">{f.integer(c.userCount)}</td>
                  <td className="num">{f.integer(c.contentCount)}</td>
                  <td className="admin-cell-nowrap subtle">{f.date(c.createdAt)}</td>
                  <td>
                    <div className="table-actions">
                      <Link href={`/admin/campaigns/${c.id}`} className="btn btn-sm">{t('manage')}</Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!compact && <Pagination page={page} hrefFor={hrefForPage} />}
    </div>
  );
}
