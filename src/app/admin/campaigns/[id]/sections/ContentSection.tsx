import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/StatusPill';
import type { ContentItemWithCampaign } from '@/lib/data';
import type { ContentStatus } from '@/domain/types';
import type { AdminFormat } from '../../../_components/format';

export async function ContentSection({ campaignId, items, total, f }: {
  campaignId: string;
  items: ContentItemWithCampaign[];
  total: number;
  f: AdminFormat;
}) {
  const t = await getTranslations('admin.campaigns.detail');
  const tContent = await getTranslations('admin.content');
  const tType = await getTranslations('content.types');
  const viewAll = `/admin/content?campaign=${encodeURIComponent(campaignId)}`;

  return (
    <section className="card card-sectioned">
      <div className="card-header">
        <div className="card-header-text">
          <h2>{t('contentHeading')}</h2>
          <span className="card-header-desc">{tContent('itemsCount', { count: total })}</span>
        </div>
        <div className="card-header-actions">
          <Link href={viewAll} className="btn btn-sm">{t('viewAllLink')}</Link>
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState icon="content" title={t('noContentYet')} description={t('noContentDesc')} plain />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tContent('colTitle')}</th>
                <th>{tContent('colType')}</th>
                <th>{tContent('colStatus')}</th>
                <th>{tContent('colCreated')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id}>
                  <td><Link href={`/content/${c.id}`} className="row-link admin-cell-clip" title={c.title}>{c.title || tContent('untitled')}</Link></td>
                  <td className="text-sm">{tType(c.type)}</td>
                  <td><StatusPill status={c.status as ContentStatus} /></td>
                  <td className="admin-cell-nowrap subtle">{f.date(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
