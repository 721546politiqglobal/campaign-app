import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AuditEntry } from '@/lib/data';
import { auditActionLabel } from '../../../_components/audit-labels';
import type { AdminFormat } from '../../../_components/format';

export async function ActivitySection({ campaignId, entries, f }: { campaignId: string; entries: AuditEntry[]; f: AdminFormat }) {
  const t = await getTranslations('admin.campaigns.detail');
  const tAudit = await getTranslations('admin.audit');
  const fullLog = `/admin/audit?campaign=${encodeURIComponent(campaignId)}`;

  return (
    <section className="card card-sectioned">
      <div className="card-header">
        <div className="card-header-text">
          <h2>{t('recentActivityHeading')}</h2>
        </div>
        <div className="card-header-actions">
          <Link href={fullLog} className="btn btn-sm">{t('fullLogLink')}</Link>
        </div>
      </div>
      {entries.length === 0 ? (
        <EmptyState icon="audit" title={t('noActivityYet')} description={t('noActivityDesc')} plain />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('timeColumn')}</th>
                <th>{tAudit('colAction')}</th>
                <th>{tAudit('colEntity')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  <td className="admin-cell-nowrap subtle num">{f.dateTime(e.createdAt)}</td>
                  <td className="admin-cell-primary">{auditActionLabel(tAudit, e.action)}</td>
                  <td className="text-sm subtle">
                    {e.entityType}
                    {e.entityId && <> · <span className="mono">{e.entityId}</span></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
