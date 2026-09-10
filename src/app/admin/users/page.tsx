import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getAllUsersAdmin } from '@/lib/data';
import { impersonateAction, removeUserAction } from '../actions';

export default async function AdminUsers() {
  const t = await getTranslations('admin.users');
  const tCommon = await getTranslations('common');
  const users = await getAllUsersAdmin();
  const campaignUsers = users.filter(u => u.role !== 'super_admin');

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">{t('eyebrow')}</span>
          <h1>{t('title')}</h1>
        </div>
        <div className="actions">
          <span className="muted" style={{ fontSize: 13 }}>{t('countSummary', { count: campaignUsers.length })}</span>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>{t('colName')}</th>
              <th>{t('colEmail')}</th>
              <th>{t('colRole')}</th>
              <th>{t('colCampaign')}</th>
              <th>{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {campaignUsers.map(u => (
              <tr key={u.id}>
                <td>
                  <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13.5 }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{u.id}</div>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {u.email ?? <span style={{ color: 'var(--bad)', fontWeight: 500 }}>{t('noEmail')}</span>}
                </td>
                <td>
                  <span className="tag"
                    style={u.role === 'owner'
                      ? { color: 'var(--accent)', borderColor: 'rgba(249,115,22,0.28)', background: 'var(--accent-dim)' }
                      : undefined}>
                    {tCommon(`roles.${u.role}`)}
                  </span>
                </td>
                <td>
                  {u.campaignName ? (
                    <Link href={`/admin/campaigns/${u.campaignId}`}
                      style={{ color: 'var(--text-2)', fontSize: 13, textDecoration: 'none' }}
                      className="hover-accent">
                      {u.campaignName}
                    </Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <form action={impersonateAction.bind(null, u.id)}>
                      <button className="admin-impersonate-btn" type="submit">{t('signInAs')}</button>
                    </form>
                    {u.campaignId && (
                      <form action={removeUserAction.bind(null, u.id, u.campaignId)}>
                        <button className="admin-delete-btn" type="submit">{t('remove')}</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
