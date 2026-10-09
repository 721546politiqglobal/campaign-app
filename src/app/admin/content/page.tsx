import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/session';
import { getAdminContentPage, getCampaign, type ContentSort } from '@/lib/data';
import type { ContentStatus } from '@/domain/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/StatusPill';
import { InfoIcon } from '@/components/icons';
import { Pagination } from '../_components/Pagination';
import { SearchForm } from '../_components/SearchForm';
import { SortLink, ariaSort } from '../_components/SortLink';
import { adminFormat } from '../_components/format';
import { buildHref, parseDir, parseEnum, parsePage, parseQ, str, type SearchParams } from '../_components/query';

const PATH = '/admin/content';
// Status tabs (publishing/archived are transient/rare and reachable via ?status=).
const FILTERS = ['draft', 'in_review', 'approved', 'scheduled', 'published', 'rejected'] as const;
const ALL_STATUSES: readonly ContentStatus[] = [...FILTERS, 'publishing', 'archived'];
const SORTS = ['created', 'title', 'status'] as const;

export default async function AdminContent({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const t = await getTranslations('admin.content');
  const tStatus = await getTranslations('common.status');
  const tType = await getTranslations('content.types');
  const f = await adminFormat();

  const q = parseQ(str(searchParams, 'q'));
  const statusParam = str(searchParams, 'status');
  const status = statusParam && (ALL_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as ContentStatus) : undefined;
  const campaignId = (str(searchParams, 'campaign') ?? '').slice(0, 64) || undefined;
  const sort = parseEnum<ContentSort>(str(searchParams, 'sort'), SORTS, 'created');
  const dir = parseDir(str(searchParams, 'dir')) ?? (sort === 'created' ? 'desc' : 'asc');
  const page = parsePage(str(searchParams, 'page'));

  const [result, campaign] = await Promise.all([
    getAdminContentPage({ q, status, campaignId, sort, dir, page }),
    campaignId ? getCampaign(campaignId) : Promise.resolve(null),
  ]);

  const current = { q, status, campaign: campaignId, sort: sort === 'created' ? undefined : sort, dir: sort === 'created' && dir === 'desc' ? undefined : dir };
  const href = (over: Record<string, string | number | undefined>) => buildHref(PATH, { ...current, ...over });
  const hrefForSort = (s: string, d: 'asc' | 'desc') => href({ sort: s, dir: d, page: undefined });

  return (
    <div className="stack">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        meta={<span className="subtle text-sm">{t('itemsCount', { count: result.total })}</span>}
      />

      <nav className="tabs" aria-label={t('colStatus')}>
        <Link href={href({ status: undefined, page: undefined })} aria-current={!status ? 'page' : undefined}>{t('filterAll')}</Link>
        {FILTERS.map(s => (
          <Link key={s} href={href({ status: s, page: undefined })} aria-current={status === s ? 'page' : undefined}>{tStatus(s)}</Link>
        ))}
      </nav>

      {campaignId && (
        <div className="alert alert-info">
          <InfoIcon className="icon" size={16} />
          <div className="alert-body">
            <div className="alert-text">{t('filteredByCampaign', { campaign: campaign?.name ?? campaignId })}</div>
            <div className="alert-actions"><Link href={href({ campaign: undefined, page: undefined })} className="btn btn-sm">{t('clearFilter')}</Link></div>
          </div>
        </div>
      )}

      <div className="admin-toolbar">
        <SearchForm action={PATH} q={q} placeholder={t('searchPlaceholder')} hidden={{ status, campaign: campaignId, sort: current.sort, dir: current.dir }} clearHref={href({ q: undefined, page: undefined })} />
      </div>

      {result.rows.length === 0 ? (
        <div className="card">
          <EmptyState icon="content" title={t('empty')} description={t('emptyDesc')} action={<Link href={PATH} className="btn">{t('filterAll')}</Link>} />
        </div>
      ) : (
        <div className="card card-sectioned">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th aria-sort={ariaSort(sort, 'title', dir)}><SortLink column="title" label={t('colTitle')} sort={sort} dir={dir} hrefFor={hrefForSort} /></th>
                  <th>{t('colCampaign')}</th>
                  <th>{t('colType')}</th>
                  <th>{t('colSource')}</th>
                  <th aria-sort={ariaSort(sort, 'status', dir)}><SortLink column="status" label={t('colStatus')} sort={sort} dir={dir} hrefFor={hrefForSort} /></th>
                  <th aria-sort={ariaSort(sort, 'created', dir)}><SortLink column="created" label={t('colCreated')} sort={sort} dir={dir} defaultDir="desc" hrefFor={hrefForSort} /></th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map(c => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/content/${c.id}`} className="row-link admin-cell-clip" title={c.title}>{c.title || t('untitled')}</Link>
                    </td>
                    <td><Link href={`/admin/campaigns/${c.campaignId}`} className="link text-sm">{c.campaignName}</Link></td>
                    <td className="text-sm">{tType(c.type)}</td>
                    <td className="text-sm">{c.isAiGenerated ? t('sourceAi') : t('sourceHuman')}</td>
                    <td><StatusPill status={c.status as ContentStatus} /></td>
                    <td className="admin-cell-nowrap subtle">{f.date(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result} hrefFor={p => href({ page: p })} />
        </div>
      )}
    </div>
  );
}
