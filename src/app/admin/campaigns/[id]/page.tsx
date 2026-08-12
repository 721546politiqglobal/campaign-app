import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { StatusPill } from '@/components/StatusPill';
import { getCampaignWithStats, getUsers, getContentItems, getAuditEntries, getInviteCodes, getBillingPlans } from '@/lib/data';
import {
  updateCampaignAction, addUserAction, removeUserAction, impersonateAction,
  generateInviteAction, assignAvatarAction, assignVoiceAction, assignPlanAction, openBillingPortalForCampaignAction,
} from '../../actions';
import { getCandidateProfile } from '@/lib/candidate';
import { listAvatars } from '@/lib/avatars';
import { SubmitButton } from '@/components/SubmitButton';

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ROLE_OPTS = ['owner', 'manager', 'staff', 'approver'];

export default async function CampaignDetail({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { billingError?: string; settingsSaved?: string };
}) {
  const [campaign, users, content, audit, invites, profile, plans, avatars] = await Promise.all([
    getCampaignWithStats(params.id),
    getUsers(params.id),
    getContentItems(params.id),
    getAuditEntries(params.id),
    getInviteCodes(params.id),
    getCandidateProfile(params.id),
    getBillingPlans(),
    listAvatars(params.id),
  ]);
  if (!campaign) notFound();

  const recentAudit = audit.slice(0, 10);

  // assignPlanAction returns a result object (for future programmatic
  // callers) rather than void, so a Server Component form action can't bind
  // it directly — wrap it the same way src/app/admin/billing/page.tsx wraps
  // syncBillingPlansAction, redirecting back with the error in the query string.
  async function assignPlan(formData: FormData) {
    'use server';
    const result = await assignPlanAction(formData);
    if (!result.ok) {
      redirect(`/admin/campaigns/${params.id}?billingError=${encodeURIComponent(result.error ?? 'Failed to assign plan.')}`);
    }
  }

  async function saveSettings(formData: FormData) {
    'use server';
    await updateCampaignAction(formData);
    redirect(`/admin/campaigns/${params.id}?settingsSaved=1`);
  }

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

      {searchParams.settingsSaved && (
        <div className="banner ok" style={{ marginBottom: 20 }}>
          <div>
            <div className="t">Campaign settings saved</div>
            <div className="b">Name, jurisdictions, and tags are up to date.</div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
        {/* Edit campaign */}
        <div className="card">
          <span className="eyebrow">Settings</span>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 16px' }}>Edit campaign</h2>
          <form action={saveSettings} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input type="hidden" name="id" value={campaign.id} />
            <div>
              <label className="field-label">Name</label>
              <input name="name" className="input" defaultValue={campaign.name} required />
            </div>
            <div>
              <label className="field-label">Jurisdictions</label>
              <input name="jurisdictions" className="input"
                defaultValue={campaign.jurisdictions.join(', ')} />
            </div>
            <div>
              <label className="field-label">Tags</label>
              <input name="tags" className="input" placeholder="2026-midterm, statewide"
                defaultValue={campaign.tags.join(', ')} />
            </div>
            <SubmitButton style={{ alignSelf: 'flex-start', fontSize: 13 }} pendingText="Saving…">
              Save changes
            </SubmitButton>
          </form>
        </div>

        {/* Spend summary */}
        <div className="card">
          <span className="eyebrow">Spend</span>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 16px' }}>This billing period</h2>
          <div className="data" style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            {fmt(campaign.monthlySpendCents)}
          </div>
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { label: 'Users', value: campaign.userCount },
              { label: 'Content', value: campaign.contentCount },
              { label: 'In review', value: campaign.inReviewCount },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: 'center', padding: '10px 0', background: 'var(--bg-hover)', borderRadius: 'var(--r)' }}>
                <div className="data" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
                <div className="eyebrow" style={{ marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Billing */}
      <div className="card" style={{ marginBottom: 24 }}>
        <span className="eyebrow">Billing</span>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 16px' }}>Subscription</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: campaign.subscriptionStatus === 'active' ? 'var(--ok)' : campaign.subscriptionStatus ? 'var(--warn)' : 'var(--text-3)', display: 'inline-block' }} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {campaign.planId
              ? `${plans.find(p => p.id === campaign.planId)?.name ?? campaign.planId} — ${campaign.subscriptionStatus ?? 'unknown'}`
              : 'No plan assigned'}
          </span>
        </div>
        {campaign.currentPeriodEnd && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
            Current period ends {new Date(campaign.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        )}
        {searchParams.billingError && (
          <p style={{ fontSize: 12, color: 'var(--bad)', marginBottom: 12 }}>{searchParams.billingError}</p>
        )}
        <form action={assignPlan} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: campaign.stripeCustomerId ? 12 : 0 }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div style={{ minWidth: 200 }}>
            <label className="field-label">Plan</label>
            <select name="planId" className="input" defaultValue={campaign.planId ?? ''} required>
              <option value="" disabled>Select a plan</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <button className="btn primary" type="submit" style={{ fontSize: 13, marginBottom: 1 }}>
            {campaign.planId ? 'Change plan' : 'Assign plan'}
          </button>
        </form>
        {campaign.stripeCustomerId && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <form action={openBillingPortalForCampaignAction}>
              <input type="hidden" name="campaignId" value={campaign.id} />
              <button className="btn" type="submit" style={{ fontSize: 12 }}>Open billing portal for this customer →</button>
            </form>
            <a
              href={`https://dashboard.stripe.com/customers/${campaign.stripeCustomerId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: 'var(--text-3)' }}
            >
              View in Stripe Dashboard →
            </a>
          </div>
        )}
      </div>

      {/* Avatar assignment */}
      <div className="card" style={{ marginBottom: 24 }}>
        <span className="eyebrow">Video</span>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 8px' }}>Candidate avatar</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
          Paste a HeyGen <strong>avatar group ID</strong> to give this campaign a starting avatar —
          useful right after a campaign is created, before the owner has made their own.
          This creates an avatar entry that shows up on the campaign's own Avatars page, where they
          can pick a look, create additional avatars, or replace this one at any time.
          Find the ID in HeyGen → Photo Avatars → open the avatar → copy the group ID shown in the URL or identity panel.
        </p>
        <form action={assignAvatarAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="field-label">HeyGen avatar group ID</label>
              <input
                name="heygen_base_avatar_id"
                className="input"
                style={{ fontFamily: 'monospace', fontSize: 13 }}
                placeholder="e.g. ee7b9943a5ac4d6e9e986075299dbb02"
              />
            </div>
            <button className="btn primary" type="submit" style={{ fontSize: 13, marginBottom: 1 }}>
              Assign avatar
            </button>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-3)' }}>
            <input type="checkbox" name="consent" required style={{ marginTop: 2 }} />
            I confirm the candidate has given consent for this HeyGen avatar to be used to generate video on their behalf.
          </label>
        </form>
        {profile?.heygenBaseAvatarId ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 600 }}>Active avatar assigned</span>
            <code style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>{profile.heygenBaseAvatarId}</code>
          </div>
        ) : avatars.length > 0 ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--warn)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--warn)', fontWeight: 600 }}>
              Avatar created, not yet active — the campaign hasn&rsquo;t completed setup
            </span>
          </div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-3)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>No avatar assigned yet</span>
          </div>
        )}
      </div>

      {/* Candidate voice */}
      <div className="card" style={{ marginBottom: 24 }}>
        <span className="eyebrow">Video</span>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 8px' }}>Candidate voice</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
          Paste a HeyGen <strong>voice ID</strong> for this candidate's cloned voice — cloning happens
          in HeyGen directly (native cloning or a third-party import), this just links the result to
          this campaign so avatar video generation has a voice to use.
        </p>
        <form action={assignVoiceAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="field-label">HeyGen voice ID</label>
              <input
                name="heygen_voice_id"
                className="input"
                style={{ fontFamily: 'monospace', fontSize: 13 }}
                placeholder="e.g. 32e35b6753d94b61963bf8d0d2f15980"
              />
            </div>
            <button className="btn primary" type="submit" style={{ fontSize: 13, marginBottom: 1 }}>
              Assign voice
            </button>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-3)' }}>
            <input type="checkbox" name="consent" required style={{ marginTop: 2 }} />
            I confirm the candidate has given consent for this HeyGen voice to be used to generate video on their behalf.
          </label>
        </form>
        {profile?.heygenVoiceId ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 600 }}>Voice assigned</span>
            <code style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>{profile.heygenVoiceId}</code>
          </div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-3)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>No voice assigned yet</span>
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
                    <span className="tag"
                      style={u.role === 'owner' ? { color: 'var(--accent)', borderColor: 'rgba(249,115,22,0.28)', background: 'var(--accent-dim)' } : undefined}>
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
                      <td><span className="tag">{inv.role}</span></td>
                      <td className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </td>
                      <td>
                        {inv.usedAt ? (
                          <span className="tag cred-high"><span className="dot" />Used</span>
                        ) : expired ? (
                          <span className="tag">Expired</span>
                        ) : (
                          <span className="tag trending"><span className="dot" />Active</span>
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
