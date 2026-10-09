import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import type { InviteCode, SeatUsage, User } from '@/lib/data';
import { UserRowActions } from '../../../users/UserRowActions';
import { CopyButton } from '../../../_components/CopyButton';
import type { AdminFormat } from '../../../_components/format';
import { AddUserForm, GenerateInviteForm } from './TeamForms';

const ROLE_OPTS = ['owner', 'manager', 'staff', 'approver'] as const;

export async function TeamSection({ campaignId, users, invites, seats, f }: {
  campaignId: string;
  users: User[];
  invites: InviteCode[];
  seats: SeatUsage;
  f: AdminFormat;
}) {
  const t = await getTranslations('admin.campaigns.detail');
  const tUsers = await getTranslations('admin.users');
  const tRoles = await getTranslations('common.roles');
  const roles = ROLE_OPTS.map(r => ({ value: r, label: tRoles(r) }));
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const now = Date.now();

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h2>{t('teamHeading')}</h2>
          <p className="muted text-sm">{t('teamDesc')}</p>
        </div>
        <div className="admin-seat-summary">
          <Badge tone={seats.limit !== null && seats.used >= seats.limit ? 'warn' : 'neutral'}>
            {seats.limit === null ? t('seatUsageUnlimited', { used: seats.used }) : t('seatUsage', { used: seats.used, limit: seats.limit })}
          </Badge>
          {seats.pendingInvites > 0 && <span className="subtle text-xs">{t('pendingInvitesNote', { count: seats.pendingInvites })}</span>}
        </div>
      </div>

      <div className="stack">
        {users.length === 0 ? (
          <EmptyState icon="users" title={t('noUsersYet')} description={t('noUsersDesc')} plain />
        ) : (
          <div className="table-wrap admin-table-inset">
            <table>
              <thead>
                <tr>
                  <th>{tUsers('colName')}</th>
                  <th>{tUsers('colEmail')}</th>
                  <th>{tUsers('colRole')}</th>
                  <th><span className="sr-only">{tUsers('colActions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td className="admin-cell-primary">{u.name}</td>
                    <td className="text-sm">{u.email ?? <span className="admin-bad-text">{tUsers('noEmail')}</span>}</td>
                    <td><Badge tone={u.role === 'owner' ? 'accent' : 'neutral'}>{tRoles(u.role)}</Badge></td>
                    <td><UserRowActions user={{ id: u.id, name: u.name, campaignId }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <AddUserForm campaignId={campaignId} roles={roles} />

        <div className="divider" />

        <h3>{t('inviteLinksHeading')}</h3>
        {invites.length === 0 ? (
          <EmptyState icon="link" title={t('emptyInvites')} description={t('emptyInvitesDesc')} plain />
        ) : (
          <div className="table-wrap admin-table-inset">
            <table>
              <thead>
                <tr>
                  <th>{t('codeColumn')}</th>
                  <th>{tUsers('colRole')}</th>
                  <th>{t('expiresColumn')}</th>
                  <th>{tUsers('colActions')}</th>
                  <th>{t('linkColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {invites.map(inv => {
                  const expired = new Date(inv.expiresAt).getTime() < now;
                  const shareUrl = `${siteUrl}/join?code=${inv.code}`;
                  const live = !inv.usedAt && !expired;
                  return (
                    <tr key={inv.code}>
                      <td className="mono">{inv.code}</td>
                      <td><Badge tone="neutral" size="sm">{tRoles(inv.role)}</Badge></td>
                      <td className="admin-cell-nowrap subtle">{f.date(inv.expiresAt)}</td>
                      <td>
                        {inv.usedAt
                          ? <Badge tone="ok" dot>{t('inviteUsed')}</Badge>
                          : expired
                            ? <Badge tone="neutral">{t('inviteExpired')}</Badge>
                            : <Badge tone="accent" dot>{t('inviteActive')}</Badge>}
                      </td>
                      <td>
                        {live && (
                          <div className="admin-invite-link">
                            <code className="admin-code" title={shareUrl}>{shareUrl}</code>
                            <CopyButton text={shareUrl} label={t('copyLink')} copiedMessage={t('copied')} />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <GenerateInviteForm campaignId={campaignId} roles={roles} />
      </div>
    </section>
  );
}
