import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { StatusPill } from '@/components/StatusPill';
import { getAllContentAdmin } from '@/lib/data';

const FILTERS = ['all', 'draft', 'in_review', 'approved', 'scheduled', 'published', 'rejected'];

export default async function AdminContent({
  searchParams,
}: {
  searchParams: { status?: string; campaign?: string };
}) {
  const t = await getTranslations('admin.content');
  const tStatus = await getTranslations('common.status');
  const tType = await getTranslations('content.types');
  const filter = searchParams.status && searchParams.status !== 'all'
    ? searchParams.status : undefined;
  const items = await getAllContentAdmin(filter);
  const filtered = searchParams.campaign
    ? items.filter(i => i.campaignId === searchParams.campaign)
    : items;

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">{t('eyebrow')}</span>
          <h1>{t('title')}</h1>
        </div>
        <div className="actions">
          <span className="muted" style={{ fontSize: 13 }}>{t('itemsCount', { count: filtered.length })}</span>
        </div>
      </div>

      <div className="btnrow" style={{ marginBottom: 16 }}>
        {FILTERS.map(f => {
          const active = f === 'all' ? !filter : f === filter;
          return (
            <Link
              key={f}
              className={`btn${active ? ' active' : ''}`}
              href={f === 'all' ? '/admin/content' : `/admin/content?status=${f}`}>
              {f === 'all' ? t('filterAll') : tStatus(f)}
            </Link>
          );
        })}
      </div>

      {searchParams.campaign && (
        <div className="banner" style={{ marginBottom: 14 }}>
          <div>
            <span className="t">{t('filteredByCampaign')}</span>
            <Link href="/admin/content" style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-3)' }}>
              {t('clearFilter')}
            </Link>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>{t('colTitle')}</th>
              <th>{t('colCampaign')}</th>
              <th>{t('colType')}</th>
              <th>{t('colSource')}</th>
              <th>{t('colStatus')}</th>
              <th>{t('colCreated')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600, color: 'var(--text)', maxWidth: 280 }}>
                  <Link href={`/content/${c.id}`}
                    style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'inherit', textDecoration: 'none' }}>
                    {c.title}
                  </Link>
                </td>
                <td>
                  <Link href={`/admin/campaigns/${c.campaignId}`}
                    style={{ color: 'var(--text-2)', fontSize: 12.5, textDecoration: 'none' }}>
                    {c.campaignName}
                  </Link>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{tType(c.type)}</td>
                <td className="muted" style={{ fontSize: 12 }}>{c.isAiGenerated ? t('sourceAi') : t('sourceHuman')}</td>
                <td><StatusPill status={c.status as never} /></td>
                <td className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  {new Date(c.createdAt).toLocaleDateString('en-US')}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: 32, textAlign: 'center' }}>
                  {t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
