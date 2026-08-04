'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
        setError(result.error ?? 'Failed to create invite.');
        return;
      }
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
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
        setError(result.error ?? 'Failed to change role.');
        const actualRole = members.find(m => m.id === userId)?.role ?? newRole;
        setRoleValues(prev => ({ ...prev, [userId]: actualRole }));
        return;
      }
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      const actualRole = members.find(m => m.id === userId)?.role ?? newRole;
      setRoleValues(prev => ({ ...prev, [userId]: actualRole }));
    }
  }

  async function handleRemove(userId: string) {
    setError(null);
    try {
      const result = await removeTeammateAction(userId);
      if (!result.ok) {
        setError(result.error ?? 'Failed to remove teammate.');
        return;
      }
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    }
  }

  const seatLimitReached = seatUsage.limit !== null && seatUsage.used >= seatUsage.limit;

  return (
    <div className="card">
      <h2>Team</h2>

      {error && (
        <div className="banner warn" style={{ marginBottom: 12 }}>
          <div className="b">{error}</div>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th><th>Email</th><th>Role</th>{canManage && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {members.map(u => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td className="muted">{u.email ?? '—'}</td>
              <td className="muted">{u.role}</td>
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
                        {INVITABLE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button className="admin-delete-btn" type="button" onClick={() => handleRemove(u.id)}>
                        Remove
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
          <h2>Pending invites</h2>
          <table>
            <thead><tr><th>Role</th><th>Expires</th><th>Status</th><th>Link</th></tr></thead>
            <tbody>
              {invites.map(inv => {
                const expired = new Date(inv.expiresAt) < new Date();
                return (
                  <tr key={inv.code}>
                    <td className="muted">{inv.role}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{new Date(inv.expiresAt).toLocaleDateString()}</td>
                    <td>
                      {inv.usedAt
                        ? <span className="tag cred-high">Used</span>
                        : expired
                          ? <span className="tag">Expired</span>
                          : <span className="tag trending">Active</span>}
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
                <tr><td colSpan={4} className="muted" style={{ padding: 20 }}>No pending invites.</td></tr>
              )}
            </tbody>
          </table>

          <div className="spacer-y" />
          {seatLimitReached ? (
            <div className="banner warn">
              <div className="t">Seat limit reached</div>
              <div className="b">
                Your plan doesn&rsquo;t have room for more teammates. <a href="/pricing">Upgrade your plan</a> to invite more.
              </div>
            </div>
          ) : (
            <form onSubmit={handleInvite} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div>
                <label className="field-label">Role</label>
                <select name="role" className="input" style={{ width: 140 }} defaultValue="staff">
                  {INVITABLE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <button className="btn primary" type="submit" disabled={inviting}>
                {inviting ? 'Generating…' : 'Generate invite link'}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
