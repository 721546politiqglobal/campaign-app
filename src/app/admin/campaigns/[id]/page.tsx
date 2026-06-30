import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/StatusPill';
import { getCampaignWithStats, getUsers, getContentItems, getAuditEntries, getInviteCodes } from '@/lib/data';
import { updateCampaignAction, addUserAction, removeUserAction, impersonateAction, generateInviteAction, assignAvatarAction } from '../../actions';
import { getCandidateProfile } from '@/lib/candidate';

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ROLE_OPTS = ['owner', 'manager', 'staff', 'approver'];

export default async function CampaignDetail({ params }: { params: { id: string } }) {
  const [campaign, users, content, audit, invites, profile] = await Promise.all([
    getCampaignWithStats(params.id),
    getUsers(params.id),
    getContentItems(params.id),
    getAuditEntries(params.id),
    getInviteCodes(params.id),
    getCandidateProfile(params.id),
  ]);
  if (!campaign) notFound();

  const recentAudit = audit.slice(0, 10);

  return (
    <div>
      <div className="pagehead">
        <div>
          <Link href="/admin" style={{ fontSize: 12, color: 'var(--text-3)', textDecoration: 'none' }}>
            ← All campaigns
          </Link>
          <span className="eyebrow" style={{ marginTop: 8 }}>Campaign</span>
          <h1>{campaign.name}</h1>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
        {/* Edit campaign */}
        <div className="card">
          <span className="eyebrow">Settings</span>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 16px' }}>Edit campaign</h2>
          <form action={updateCampaignAction} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input type="hidden" name="id" value={campaign.id} />
            <div>
              <label className="field-label">Name</label>
              <input name="name" className="input" defaultValue={campaign.name} required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="field-label">Monthly cap (USD)</label>
                <input name="cap" type="number" className="input"
                  defaultValue={campaign.monthlyCostCapCents / 100} min="0" />
              </div>
              <div>
                <label className="field-label">Jurisdictions</label>
                <input name="jurisdictions" className="input"
                  defaultValue={campaign.jurisdictions.join(', ')} />
              </div>
            </div>
            <button className="btn primary" style={{ alignSelf: 'flex-start', fontSize: 13 }}>
              Save changes
            </button>
          </form>
        </div>

        {/* Spend summary */}
        <div className="card">
          <span className="eyebrow">Spend</span>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 16px' }}>This month</h2>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: 6 }}>
            {fmt(campaign.monthlySpendCents)}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 14 }}>
            of {fmt(campaign.monthlyCostCapCents)} cap
          </div>
          <div style={{ height: 6, background: 'var(--bg-hover)', borderRadius: 3 }}>
            <div style={{
              height: '100%', borderRadius: 3,
              width: `${Math.min((campaign.monthlySpendCents / campaign.monthlyCostCapCents) * 100, 100)}%`,
              background: campaign.monthlySpendCents > campaign.monthlyCostCapCents ? 'var(--bad)' : 'var(--accent)',
            }} />
          </div>
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { label: 'Users', value: campaign.userCount },
              { label: 'Content', value: campaign.contentCount },
              { label: 'In review', value: campaign.inReviewCount },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: 'center', padding: '10px 0', background: 'var(--bg-hover)', borderRadius: 'var(--r)' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{value}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Avatar assignment */}
      <div className="card" style={{ marginBottom: 24 }}>
        <span className="eyebrow">Video</span>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 8px' }}>Candidate avatar</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
          Assign the HeyGen <strong>avatar_id</strong> for this campaign&rsquo;s candidate.
          All looks (outfits / poses) of that avatar become available for the campaign owner to choose from in their Settings.
          Find the ID in HeyGen → Avatars → click the avatar → copy the ID from the URL or details panel.
        </p>
        <form action={assignAvatarAction} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="field-label">HeyGen avatar ID</label>
            <input
              name="heygen_base_avatar_id"
              className="input"
              style={{ fontFamily: 'monospace', fontSize: 13 }}
              defaultValue={profile?.heygenBaseAvatarId ?? ''}
              placeholder="e.g. ee7b9943a5ac4d6e9e986075299dbb02"
            />
          </div>
          <button className="btn primary" type="submit" style={{ fontSize: 13, marginBottom: 1 }}>
            {profile?.heygenBaseAvatarId ? 'Update avatar' : 'Assign avatar'}
          </button>
        </form>
        {profile?.heygenBaseAvatarId && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 600 }}>Avatar assigned</span>
            <code style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>{profile.heygenBaseAvatarId}</code>
          </div>
        )}
        {!profile?.heygenBaseAvatarId && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-3)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>No avatar assigned yet</span>
          </div>
        )}
      </div>

      {/* Users */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Users</h2>
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600, color: 'var(--text)' }}>{u.name}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {u.email ?? <span style={{ color: 'var(--bad)', fontSize: 11 }}>No email</span>}
                  </td>
                  <td>
                    <span className="pill"
                      style={u.role === 'owner' ? { borderColor: 'rgba(249,115,22,0.3)', color: 'var(--accent)' } : {}}>
                      {u.role}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <form action={impersonateAction.bind(null, u.id)}>
                        <button className="admin-impersonate-btn" type="submit">Sign in as</button>
                      </form>
                      <form action={removeUserAction.bind(null, u.id, campaign.id)}>
                        <button className="admin-delete-btn" type="submit">Remove</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={3} className="muted" style={{ padding: 20 }}>No users yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add user */}
        <form action={addUserAction} style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div>
            <label className="field-label">Name</label>
            <input name="name" className="input" placeholder="Full name" required style={{ width: 160 }} />
          </div>
          <div>
            <label className="field-label">Email</label>
            <input type="email" name="email" className="input" placeholder="user@example.com" required style={{ width: 200 }} />
          </div>
          <div>
            <label className="field-label">Role</label>
            <select name="role" className="input" style={{ width: 130 }}>
              {ROLE_OPTS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button className="btn primary" style={{ fontSize: 13, marginBottom: 1 }}>Add &amp; invite</button>
        </form>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Creates the user account and generates an invite link below — share it so they can set their password.
        </p>
      </div>

      {/* Content */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Content</h2>
          <Link href={`/admin/content?campaign=${campaign.id}`} style={{ fontSize: 12, color: 'var(--text-3)', textDecoration: 'none' }}>
            View all →
          </Link>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Title</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>
              {content.slice(0, 6).map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500, color: 'var(--text)' }}>{c.title}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{c.type.replace('_', ' ')}</td>
                  <td><StatusPill status={c.status} /></td>
                </tr>
              ))}
              {content.length === 0 && (
                <tr><td colSpan={3} className="muted" style={{ padding: 20 }}>No content yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite codes */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Invite links</h2>
        <div className="card" style={{ padding: 0 }}>
          {invites.length > 0 ? (
            <table>
              <thead>
                <tr><th>Code</th><th>Role</th><th>Expires</th><th>Status</th><th>Link</th></tr>
              </thead>
              <tbody>
                {invites.map(inv => {
                  const expired = new Date(inv.expiresAt) < new Date();
                  const shareUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/join?code=${inv.code}`;
                  return (
                    <tr key={inv.code}>
                      <td className="mono" style={{ fontSize: 12 }}>{inv.code}</td>
                      <td><span className="pill">{inv.role}</span></td>
                      <td className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </td>
                      <td>
                        {inv.usedAt ? (
                          <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 600 }}>Used</span>
                        ) : expired ? (
                          <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>Expired</span>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>Active</span>
                        )}
                      </td>
                      <td>
                        {!inv.usedAt && !expired && (
                          <code style={{
                            fontSize: 11, color: 'var(--text-2)',
                            background: 'var(--bg-hover)', padding: '2px 8px',
                            borderRadius: 4, userSelect: 'all',
                            display: 'block', maxWidth: 340,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                            title={shareUrl}
                          >
                            {shareUrl || `/join?code=${inv.code}`}
                          </code>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 20 }} className="muted">No invite links yet.</div>
          )}
        </div>

        <form action={generateInviteAction} style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'flex-end' }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div>
            <label className="field-label">Role</label>
            <select name="role" className="input" style={{ width: 140 }}>
              {ROLE_OPTS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button className="btn primary" style={{ fontSize: 13, marginBottom: 1 }}>
            Generate invite link
          </button>
        </form>
      </div>

      {/* Audit log */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Recent activity</h2>
          <Link href="/admin/audit" style={{ fontSize: 12, color: 'var(--text-3)', textDecoration: 'none' }}>
            Full log →
          </Link>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Time</th><th>Action</th><th>Entity</th></tr></thead>
            <tbody>
              {recentAudit.map(e => (
                <tr key={e.id}>
                  <td className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{e.action}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {e.entityType}{e.entityId ? ` · ${e.entityId}` : ''}
                  </td>
                </tr>
              ))}
              {recentAudit.length === 0 && (
                <tr><td colSpan={3} className="muted" style={{ padding: 20 }}>No activity yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
