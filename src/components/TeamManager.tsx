'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  inviteTeammateAction, removeTeammateAction, changeTeammateRoleAction,
} from '@/app/settings/team-actions';
import { INVITABLE_ROLES } from '@/lib/team-roles';

export interface TeamMember {
  id: string;
  name: string;
  email: string | null;
  role: string;
}

export interface PendingInvite {
  code: string;
  role: string;
  expiresAt: string;
  usedAt: string | null;
  shareUrl: string;
}

export function TeamManager({
  members, invites, seatUsage, canManage,
}: {
  members: TeamMember[];
  invites: PendingInvite[];
  seatUsage: { used: number; limit: number | null };
  canManage: boolean;
}) {
  const t = useTranslations('team');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [roleValues, setRoleValues] = useState<Record<string, string>>({});

  async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInviting(true);
    const formData = new FormData(e.currentTarget);
    try {
      const result = await inviteTeammateAction(formData);
      if (!result.ok) {
        setError(result.error ?? t('errors.createInviteFailed'));
        return;
      }
      router.refresh();
    } catch {
      setError(t('errors.genericError'));
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: string) {
    setError(null);
    setRoleValues(prev => ({ ...prev, [userId]: newRole }));
    try {
      const result = await changeTeammateRoleAction(userId, newRole);
      if (!result.ok) {
        setError(result.error ?? t('errors.changeRoleFailed'));
        const actualRole = members.find(m => m.id === userId)?.role ?? newRole;
        setRoleValues(prev => ({ ...prev, [userId]: actualRole }));
        return;
      }
      router.refresh();
    } catch {
      setError(t('errors.genericError'));
      const actualRole = members.find(m => m.id === userId)?.role ?? newRole;
      setRoleValues(prev => ({ ...prev, [userId]: actualRole }));
    }
  }

  async function handleRemove(userId: string) {
    setError(null);
    try {
      const result = await removeTeammateAction(userId);
      if (!result.ok) {
        setError(result.error ?? t('errors.removeTeammateFailed'));
        return;
      }
      router.refresh();
    } catch {
      setError(t('errors.genericError'));
    }
  }

  const seatLimitReached = seatUsage.limit !== null && seatUsage.used >= seatUsage.limit;

  return (
    <div className="card">
      <h2>{t('membersHeading')}</h2>

      {error && (
        <div className="banner warn" style={{ marginBottom: 12 }}>
          <div className="b">{error}</div>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>{t('table.name')}</th><th>{t('table.email')}</th><th>{t('table.role')}</th>{canManage && <th>{t('table.actions')}</th>}
          </tr>
        </thead>
        <tbody>
          {members.map(u => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td className="muted">{u.email ?? '—'}</td>
              <td className="muted">{tCommon(`roles.${u.role}`)}</td>
              {canManage && (
                <td>
                  {u.role === 'owner' ? (
                    <span className="muted" style={{ fontSize: 12 }}>—</span>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select
                        className="input"
                        style={{ width: 110 }}
                        value={roleValues[u.id] ?? u.role}
                        onChange={e => handleRoleChange(u.id, e.target.value)}
                      >
                        {INVITABLE_ROLES.map(r => <option key={r} value={r}>{tCommon(`roles.${r}`)}</option>)}
                      </select>
                      <button className="admin-delete-btn" type="button" onClick={() => handleRemove(u.id)}>
                        {t('removeButton')}
                      </button>
                    </div>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {canManage && (
        <>
          <div className="spacer-y" />
          <h2>{t('pendingInvitesHeading')}</h2>
          <table>
            <thead><tr><th>{t('invitesTable.role')}</th><th>{t('invitesTable.expires')}</th><th>{t('invitesTable.status')}</th><th>{t('invitesTable.link')}</th></tr></thead>
            <tbody>
              {invites.map(inv => {
                const expired = new Date(inv.expiresAt) < new Date();
                return (
                  <tr key={inv.code}>
                    <td className="muted">{tCommon(`roles.${inv.role}`)}</td>
                    {/* Fixed locale: the default toLocaleDateString() uses the
                        runtime's locale, which differs between the server
                        (render) and the browser (hydrate) — e.g. en-US vs a
                        DD/MM locale — producing a real hydration mismatch
                        (verified live) and an ambiguous date for viewers
                        outside the US. */}
                    <td className="muted" style={{ fontSize: 12 }}>{new Date(inv.expiresAt).toLocaleDateString('en-US')}</td>
                    <td>
                      {inv.usedAt
                        ? <span className="tag cred-high">{t('inviteStatus.used')}</span>
                        : expired
                          ? <span className="tag">{t('inviteStatus.expired')}</span>
                          : <span className="tag trending">{t('inviteStatus.active')}</span>}
                    </td>
                    <td>
                      {!inv.usedAt && !expired && (
                        <code style={{ fontSize: 11, userSelect: 'all' }} title={inv.shareUrl}>{inv.shareUrl}</code>
                      )}
                    </td>
                  </tr>
                );
              })}
              {invites.length === 0 && (
                <tr><td colSpan={4} className="muted" style={{ padding: 20 }}>{t('noPendingInvites')}</td></tr>
              )}
            </tbody>
          </table>

          <div className="spacer-y" />
          {seatLimitReached ? (
            <div className="banner warn">
              <div className="t">{t('memberLimitReachedTitle')}</div>
              <div className="b">
                {t.rich('memberLimitReachedBody', {
                  link: chunks => <a href="/pricing">{chunks}</a>,
                })}
              </div>
            </div>
          ) : (
            <form onSubmit={handleInvite} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div>
                <label className="field-label">{t('inviteRoleLabel')}</label>
                <select name="role" className="input" style={{ width: 140 }} defaultValue="staff">
                  {INVITABLE_ROLES.map(r => <option key={r} value={r}>{tCommon(`roles.${r}`)}</option>)}
                </select>
              </div>
              <button className="btn primary" type="submit" disabled={inviting}>
                {inviting ? t('generatingButton') : t('generateInviteButton')}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
