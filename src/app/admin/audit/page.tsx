import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/session';
import { getAdminAuditPage, getCampaign } from '@/lib/data';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InfoIcon } from '@/components/icons';
import { Pagination } from '../_components/Pagination';
import { SearchForm } from '../_components/SearchForm';
import { SortLink, ariaSort } from '../_components/SortLink';
import { adminFormat } from '../_components/format';
import { auditActionLabel } from '../_components/audit-labels';
import { buildHref, parseDir, parsePage, parseQ, str, type SearchParams } from '../_components/query';

const PATH = '/admin/audit';

export default async function AdminAudit({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const t = await getTranslations('admin.audit');
  const tContent = await getTranslations('admin.content');
  const f = await adminFormat();

  const q = parseQ(str(searchParams, 'q'));
  const campaignId = (str(searchParams, 'campaign') ?? '').slice(0, 64) || undefined;
  const dir = parseDir(str(searchParams, 'dir')) ?? 'desc';
  const page = parsePage(str(searchParams, 'page'));

  const [result, campaign] = await Promise.all([
    getAdminAuditPage({ q, campaignId, dir, page }),
    campaignId ? getCampaign(campaignId) : Promise.resolve(null),
  ]);

  const current = { q, campaign: campaignId, dir: dir === 'desc' ? undefined : dir };
  const href = (over: Record<string, string | number | undefined>) => buildHref(PATH, { ...current, ...over });

  return (
    <div className="stack">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        meta={<span className="subtle text-sm">{t('entriesSummary', { count: result.total })}</span>}
      />

      {campaignId && (
        <div className="alert alert-info">
          <InfoIcon className="icon" size={16} />
          <div className="alert-body">
            <div className="alert-text">{tContent('filteredByCampaign', { campaign: campaign?.name ?? campaignId })}</div>
            <div className="alert-actions"><Link href={href({ campaign: undefined, page: undefined })} className="btn btn-sm">{tContent('clearFilter')}</Link></div>
          </div>
        </div>
      )}

      <div className="admin-toolbar">
        <SearchForm action={PATH} q={q} placeholder={t('searchPlaceholder')} hidden={{ campaign: campaignId, dir: current.dir }} clearHref={href({ q: undefined, page: undefined })} />
      </div>

      {result.rows.length === 0 ? (
        <div className="card">
          <EmptyState icon="audit" title={t('empty')} description={t('emptyDesc')} action={q || campaignId ? <Link href={PATH} className="btn">{tContent('filterAll')}</Link> : undefined} />
        </div>
      ) : (
        <div className="card card-sectioned">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th aria-sort={ariaSort('created', 'created', dir)}>
                    <SortLink column="created" label={t('colTimestamp')} sort="created" dir={dir} defaultDir="desc" hrefFor={(_s, d) => href({ dir: d, page: undefined })} />
                  </th>
                  <th>{t('colAction')}</th>
                  <th>{t('colCampaign')}</th>
                  <th>{t('colActor')}</th>
                  <th>{t('colEntity')}</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map(e => (
                  <tr key={e.id}>
                    <td className="admin-cell-nowrap subtle num">{f.dateTime(e.createdAt)}</td>
                    <td>
                      <div className="admin-cell-primary">{auditActionLabel(t, e.action)}</div>
                      {e.action !== auditActionLabel(t, e.action) && <div className="admin-cell-sub mono">{e.action}</div>}
                    </td>
                    <td><Link href={`/admin/campaigns/${e.campaignId}`} className="link text-sm">{e.campaignName}</Link></td>
                    <td className="text-sm">{e.actorUserId ? e.actorName : t('system')}</td>
                    <td className="text-sm subtle">
                      {e.entityType}
                      {e.entityId && <> · <span className="mono">{e.entityId}</span></>}
                    </td>
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
