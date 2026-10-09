'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  inviteTeammateAction, removeTeammateAction, changeTeammateRoleAction, revokeInviteAction,
} from '@/app/settings/team-actions';
import { INVITABLE_ROLES } from '@/lib/team-roles';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Field } from '@/components/ui/Field';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SubmitButton } from '@/components/SubmitButton';
import { AlertIcon, ChevronRightIcon, CopyIcon, TrashIcon } from '@/components/icons';

export interface TeamMember {
  id: string;
  name: string;
  email: string | null;
  role: string;
}

export interface PendingInvite {
  code: string;
  role: string;
  /** Expiry already formatted on the server in the viewer's locale. */
  expiresLabel: string;
  expired: boolean;
  usedAt: string | null;
  shareUrl: string;
}

const ROLE_TONE: Record<string, BadgeTone> = { owner: 'purple', manager: 'accent', approver: 'info', staff: 'neutral' };
const DESCRIBED_ROLES = new Set(['owner', 'manager', 'approver', 'staff']);

export function TeamManager({
  members, invites, seatUsage, canManage, currentUserId,
}: {
  members: TeamMember[];
  invites: PendingInvite[];
  seatUsage: { used: number; limit: number | null };
  canManage: boolean;
  currentUserId: string;
}) {
  const t = useTranslations('team');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<string>('staff');
  const [roleValues, setRoleValues] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string | undefined>>({});
  const [busyRows, setBusyRows] = useState<Record<string, boolean>>({});
  const [inviteErrors, setInviteErrors] = useState<Record<string, string | undefined>>({});
  const [busyInvites, setBusyInvites] = useState<Record<string, boolean>>({});

  const roleLabel = (role: string) => tCommon(`roles.${role}`);
  const roleDescription = (role: string) => (DESCRIBED_ROLES.has(role) ? t(`roleDescriptions.${role}`) : '');
  const setRowError = (id: string, message?: string) => setRowErrors(prev => ({ ...prev, [id]: message }));
  const setRowBusy = (id: string, busy: boolean) => setBusyRows(prev => ({ ...prev, [id]: busy }));
  const setInviteRowError = (code: string, message?: string) => setInviteErrors(prev => ({ ...prev, [code]: message }));
  const setInviteBusy = (code: string, busy: boolean) => setBusyInvites(prev => ({ ...prev, [code]: busy }));

  // Used invites are filtered out server-side; what's left is split so expired
  // links don't crowd the active ones (they stay revocable in a collapsed group).
  const pendingInvites = invites.filter(inv => !inv.expired);
  const expiredInvites = invites.filter(inv => inv.expired);

  function invitesTable(rows: PendingInvite[]) {
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('invitesTable.role')}</th>
              <th>{t('invitesTable.expires')}</th>
              <th>{t('invitesTable.status')}</th>
              <th>{t('invitesTable.link')}</th>
              <th className="table-num">{t('invitesTable.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(inv => {
              const active = !inv.usedAt && !inv.expired;
              const busy = !!busyInvites[inv.code];
              return (
                <tr key={inv.code} aria-busy={busy || undefined}>
                  <td>{roleLabel(inv.role)}</td>
                  <td className="muted">{inv.expiresLabel}</td>
                  <td>
                    {inv.usedAt
                      ? <Badge tone="ok" dot>{t('inviteStatus.used')}</Badge>
                      : inv.expired
                        ? <Badge tone="neutral" dot>{t('inviteStatus.expired')}</Badge>
                        : <Badge tone="accent" dot>{t('inviteStatus.active')}</Badge>}
                  </td>
                  <td>
                    {active ? (
                      <span className="team-link">
                        <code title={inv.shareUrl}>{inv.shareUrl}</code>
                        <button type="button" className="btn btn-sm" onClick={() => copyLink(inv.shareUrl)}>
                          <CopyIcon size={14} />{t('copyLinkButton')}
                        </button>
                      </span>
                    ) : (
                      <span className="subtle">—</span>
                    )}
                  </td>
                  <td>
                    {inv.usedAt ? (
                      <span className="subtle">—</span>
                    ) : (
                      <>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            aria-busy={busy}
                            onClick={() => handleRevoke(inv)}
                          >
                            {busy ? t('revokingButton') : t('revokeButton')}
                          </button>
                        </div>
                        {inviteErrors[inv.code] && <span className="team-row-error" role="alert">{inviteErrors[inv.code]}</span>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const seatLimitReached = seatUsage.limit !== null && seatUsage.used >= seatUsage.limit;
  const seatText = seatUsage.limit === null
    ? t('seats.unlimited', { count: seatUsage.used })
    : t('seats.used', { used: seatUsage.used, limit: seatUsage.limit });

  async function handleInvite(formData: FormData) {
    setInviteError(null);
    try {
      const result = await inviteTeammateAction(formData);
      if (!result.ok) {
        setInviteError(result.error ?? t('errors.createInviteFailed'));
        return;
      }
      toast(t('toasts.inviteCreated'));
      router.refresh();
    } catch {
      setInviteError(t('errors.genericError'));
    }
  }

  async function handleRoleChange(member: TeamMember, newRole: string) {
    if (newRole === member.role) return;
    setRoleValues(prev => ({ ...prev, [member.id]: newRole }));
    const revert = () => setRoleValues(prev => ({ ...prev, [member.id]: member.role }));

    const ok = await confirm({
      title: t('confirmRoleChange.title', { name: member.name }),
      description: t('confirmRoleChange.body', { role: roleLabel(newRole), description: roleDescription(newRole) }),
      confirmLabel: t('confirmRoleChange.confirm'),
    });
    if (!ok) { revert(); return; }

    setRowError(member.id, undefined);
    setRowBusy(member.id, true);
    try {
      const result = await changeTeammateRoleAction(member.id, newRole);
      if (!result.ok) {
        setRowError(member.id, result.error ?? t('errors.changeRoleFailed'));
        revert();
        return;
      }
      toast(t('toasts.roleChanged'));
      router.refresh();
    } catch {
      setRowError(member.id, t('errors.genericError'));
      revert();
    } finally {
      setRowBusy(member.id, false);
    }
  }

  async function handleRemove(member: TeamMember) {
    const ok = await confirm({
      title: t('confirmRemove.title', { name: member.name }),
      description: t('confirmRemove.body'),
      confirmLabel: t('confirmRemove.confirm'),
      tone: 'danger',
    });
    if (!ok) return;

    setRowError(member.id, undefined);
    setRowBusy(member.id, true);
    try {
      const result = await removeTeammateAction(member.id);
      if (!result.ok) {
        setRowError(member.id, result.error ?? t('errors.removeTeammateFailed'));
        return;
      }
      toast(t('toasts.removed'));
      router.refresh();
    } catch {
      setRowError(member.id, t('errors.genericError'));
    } finally {
      setRowBusy(member.id, false);
    }
  }

  async function handleRevoke(invite: PendingInvite) {
    const ok = await confirm({
      title: t('confirmRevoke.title'),
      description: t('confirmRevoke.body'),
      confirmLabel: t('confirmRevoke.confirm'),
      tone: 'danger',
    });
    if (!ok) return;

    setInviteRowError(invite.code, undefined);
    setInviteBusy(invite.code, true);
    try {
      const result = await revokeInviteAction(invite.code);
      if (!result.ok) {
        setInviteRowError(invite.code, result.error ?? t('errors.revokeInviteFailed'));
        return;
      }
      toast(t('toasts.inviteRevoked'));
      router.refresh();
    } catch {
      setInviteRowError(invite.code, t('errors.genericError'));
    } finally {
      setInviteBusy(invite.code, false);
    }
  }

  async function copyLink(url: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(url);
      toast(t('toasts.linkCopied'));
    } catch {
      toast(t('toasts.copyFailed'), 'error');
    }
  }

  return (
    <div className="stack">
      <section className="card card-sectioned" aria-labelledby="team-members-heading">
        <div className="card-header">
          <div className="card-header-text">
            <h2 id="team-members-heading">{t('membersHeading')}</h2>
            <span className="card-header-desc">{seatText}</span>
          </div>
          {seatLimitReached && (
            <div className="card-header-actions">
              <Badge tone="warn" dot>{t('seats.full', { limit: seatUsage.limit ?? 0 })}</Badge>
            </div>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('table.name')}</th>
                <th>{t('table.email')}</th>
                <th>{t('table.role')}</th>
                {canManage && <th className="table-num">{t('table.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {members.map(u => {
                const isSelf = u.id === currentUserId;
                const editable = canManage && u.role !== 'owner' && !isSelf;
                const busy = !!busyRows[u.id];
                return (
                  <tr key={u.id} aria-busy={busy || undefined}>
                    <td>
                      <span className="team-member-name">{u.name}</span>
                      {isSelf && <Badge tone="neutral" size="sm" className="team-you">{t('you')}</Badge>}
                    </td>
                    <td className="muted">{u.email ?? t('noEmail')}</td>
                    <td>
                      <Badge tone={ROLE_TONE[u.role] ?? 'neutral'} title={roleDescription(u.role) || undefined}>{roleLabel(u.role)}</Badge>
                    </td>
                    {canManage && (
                      <td>
                        {editable ? (
                          <>
                            <div className="team-row-actions">
                              <select
                                className="input input-sm"
                                aria-label={t('roleSelectLabel', { name: u.name })}
                                value={roleValues[u.id] ?? u.role}
                                disabled={busy}
                                onChange={e => handleRoleChange(u, e.target.value)}
                              >
                                {INVITABLE_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                              </select>
                              <button
                                type="button"
                                className="btn btn-danger-soft btn-sm"
                                aria-label={t('removeAria', { name: u.name })}
                                disabled={busy}
                                aria-busy={busy}
                                onClick={() => handleRemove(u)}
                              >
                                <TrashIcon size={14} />{t('removeButton')}
                              </button>
                            </div>
                            {rowErrors[u.id] && <span className="team-row-error" role="alert">{rowErrors[u.id]}</span>}
                          </>
                        ) : (
                          <span className="subtle">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!canManage && <div className="card-body team-readonly">{t('readOnlyNote')}</div>}
      </section>

      {canManage && (
        <>
          <section className="card card-sectioned" aria-labelledby="team-invite-heading">
            <div className="card-header">
              <div className="card-header-text">
                <h2 id="team-invite-heading">{t('inviteHeading')}</h2>
                <span className="card-header-desc">{t('inviteDescription')}</span>
              </div>
            </div>
            <div className="card-body">
              {seatLimitReached ? (
                <div className="alert alert-warn">
                  <AlertIcon size={16} />
                  <div className="alert-body">
                    <div className="alert-title">{t('memberLimitReachedTitle')}</div>
                    <div className="alert-text">{t('memberLimitReachedBody')}</div>
                    <div className="alert-actions">
                      <Link href="/billing" className="btn btn-sm">{t('memberLimitReachedCta')}</Link>
                    </div>
                  </div>
                </div>
              ) : (
                <form action={handleInvite} className="stack">
                  {inviteError && (
                    <div className="alert alert-bad" role="alert">
                      <AlertIcon size={16} />
                      <div className="alert-body"><div className="alert-text">{inviteError}</div></div>
                    </div>
                  )}
                  <div className="team-invite-form">
                    <Field label={t('inviteRoleLabel')}>
                      {p => (
                        <select {...p} name="role" className="input" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                          {INVITABLE_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                        </select>
                      )}
                    </Field>
                    <SubmitButton pendingText={t('generatingButton')}>{t('generateInviteButton')}</SubmitButton>
                  </div>
                  <p className="field-hint team-role-hint">{roleDescription(inviteRole)}</p>
                </form>
              )}
            </div>
          </section>

          <section className="card card-sectioned" aria-labelledby="team-invites-heading">
            <div className="card-header">
              <div className="card-header-text">
                <h2 id="team-invites-heading">{t('pendingInvitesHeading')}</h2>
                <span className="card-header-desc">{t('pendingInvitesDescription')}</span>
              </div>
            </div>
            {pendingInvites.length === 0 ? (
              <div className="card-body">
                <EmptyState plain icon="mail" title={t('noPendingInvites')} description={t('noPendingInvitesBody')} />
              </div>
            ) : (
              invitesTable(pendingInvites)
            )}
            {/* Expired links are kept out of the way but still revocable, so the list can be cleaned up. */}
            {expiredInvites.length > 0 && (
              <details className="team-expired">
                <summary className="team-expired-summary">
                  <ChevronRightIcon size={14} className="team-expired-chevron" />
                  <span className="team-expired-title">{t('expiredInvitesSummary', { count: expiredInvites.length })}</span>
                  <span className="team-expired-desc">{t('expiredInvitesDescription')}</span>
                </summary>
                <h3 className="sr-only">{t('expiredInvitesHeading')}</h3>
                {invitesTable(expiredInvites)}
              </details>
            )}
          </section>
        </>
      )}
    </div>
  );
}
