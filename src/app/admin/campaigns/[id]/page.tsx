import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
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
  const t = await getTranslations('admin.campaigns.detail');
  const tUsers = await getTranslations('admin.users');
  const tContent = await getTranslations('admin.content');
  const tAudit = await getTranslations('admin.audit');
  const tCampaignsTable = await getTranslations('admin.campaignsTable');
  const tRoles = await getTranslations('common.roles');
  const tStatus = await getTranslations('common.status');
  const tType = await getTranslations('content.types');

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
      redirect(`/admin/campaigns/${params.id}?billingError=${encodeURIComponent(result.error ?? t('assignPlanFailedError'))}`);
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
            {t('backToCampaigns')}
          </Link>
          <span className="eyebrow" style={{ marginTop: 8 }}>{t('eyebrow')}</span>
          <h1>{campaign.name}</h1>
        </div>
      </div>

      {searchParams.settingsSaved && (
        <div className="banner ok" style={{ marginBottom: 20 }}>
          <div>
            <div className="t">{t('settingsSavedTitle')}</div>
            <div className="b">{t('settingsSavedBody')}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
        {/* Edit campaign */}
        <div className="card">
          <span className="eyebrow">{t('settingsEyebrow')}</span>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 16px' }}>{t('editCampaignHeading')}</h2>
          <form action={saveSettings} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input type="hidden" name="id" value={campaign.id} />
            <div>
              <label className="field-label">{t('nameLabel')}</label>
              <input name="name" className="input" defaultValue={campaign.name} required />
            </div>
            <div>
              <label className="field-label">{t('jurisdictionsLabel')}</label>
              <input name="jurisdictions" className="input"
                defaultValue={campaign.jurisdictions.join(', ')} />
            </div>
            <div>
              <label className="field-label">{t('tagsLabel')}</label>
              <input name="tags" className="input" placeholder={t('tagsPlaceholder')}
                defaultValue={campaign.tags.join(', ')} />
            </div>
            <SubmitButton style={{ alignSelf: 'flex-start', fontSize: 13 }} pendingText={t('savingButton')}>
              {t('saveChangesButton')}
            </SubmitButton>
          </form>
        </div>

        {/* Spend summary */}
        <div className="card">
          <span className="eyebrow">{t('spendEyebrow')}</span>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 16px' }}>{t('billingPeriodHeading')}</h2>
          <div className="data" style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            {fmt(campaign.monthlySpendCents)}
          </div>
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { label: tCampaignsTable('colUsers'), value: campaign.userCount },
              { label: tCampaignsTable('colContent'), value: campaign.contentCount },
              { label: tStatus('in_review'), value: campaign.inReviewCount },
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
        <span className="eyebrow">{t('billingEyebrow')}</span>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 16px' }}>{t('subscriptionHeading')}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: campaign.subscriptionStatus === 'active' ? 'var(--ok)' : campaign.subscriptionStatus ? 'var(--warn)' : 'var(--text-3)', display: 'inline-block' }} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {campaign.planId
              ? t('planStatusLine', {
                  planName: plans.find(p => p.id === campaign.planId)?.name ?? campaign.planId,
                  status: campaign.subscriptionStatus ?? t('unknownStatus'),
                })
              : t('noPlanAssigned')}
          </span>
        </div>
        {campaign.currentPeriodEnd && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
            {t('currentPeriodEnds', {
              date: new Date(campaign.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            })}
          </p>
        )}
        {searchParams.billingError && (
          <p style={{ fontSize: 12, color: 'var(--bad)', marginBottom: 12 }}>{searchParams.billingError}</p>
        )}
        <form action={assignPlan} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: campaign.stripeCustomerId ? 12 : 0 }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div style={{ minWidth: 200 }}>
            <label className="field-label">{t('planLabel')}</label>
            <select name="planId" className="input" defaultValue={campaign.planId ?? ''} required>
              <option value="" disabled>{t('selectPlanOption')}</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <button className="btn primary" type="submit" style={{ fontSize: 13, marginBottom: 1 }}>
            {campaign.planId ? t('changePlanButton') : t('assignPlanButton')}
          </button>
        </form>
        {campaign.stripeCustomerId && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <form action={openBillingPortalForCampaignAction}>
              <input type="hidden" name="campaignId" value={campaign.id} />
              <button className="btn" type="submit" style={{ fontSize: 12 }}>{t('openBillingPortalButton')}</button>
            </form>
            <a
              href={`https://dashboard.stripe.com/customers/${campaign.stripeCustomerId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: 'var(--text-3)' }}
            >
              {t('viewInStripeDashboard')}
            </a>
          </div>
        )}
      </div>

      {/* Avatar assignment */}
      <div className="card" style={{ marginBottom: 24 }}>
        <span className="eyebrow">{t('videoEyebrow')}</span>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 8px' }}>{t('candidateAvatarHeading')}</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
          {t.rich('avatarIntro', { strong: chunks => <strong>{chunks}</strong> })}
        </p>
        <form action={assignAvatarAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="field-label">{t('heygenAvatarGroupIdLabel')}</label>
              <input
                name="heygen_base_avatar_id"
                className="input"
                style={{ fontFamily: 'monospace', fontSize: 13 }}
                placeholder={t('avatarIdPlaceholder')}
              />
            </div>
            <button className="btn primary" type="submit" style={{ fontSize: 13, marginBottom: 1 }}>
              {t('assignAvatarButton')}
            </button>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-3)' }}>
            <input type="checkbox" name="consent" required style={{ marginTop: 2 }} />
            {t('consentAvatarLabel')}
          </label>
        </form>
        {profile?.heygenBaseAvatarId ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 600 }}>{t('activeAvatarAssigned')}</span>
            <code style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>{profile.heygenBaseAvatarId}</code>
          </div>
        ) : avatars.length > 0 ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--warn)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--warn)', fontWeight: 600 }}>
              {t('avatarCreatedNotActive')}
            </span>
          </div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-3)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>{t('noAvatarAssigned')}</span>
          </div>
        )}
      </div>

      {/* Candidate voice */}
      <div className="card" style={{ marginBottom: 24 }}>
        <span className="eyebrow">{t('videoEyebrow')}</span>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 8px' }}>{t('candidateVoiceHeading')}</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
          {t.rich('voiceIntro', { strong: chunks => <strong>{chunks}</strong> })}
        </p>
        <form action={assignVoiceAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="field-label">{t('heygenVoiceIdLabel')}</label>
              <input
                name="heygen_voice_id"
                className="input"
                style={{ fontFamily: 'monospace', fontSize: 13 }}
                placeholder={t('voiceIdPlaceholder')}
              />
            </div>
            <button className="btn primary" type="submit" style={{ fontSize: 13, marginBottom: 1 }}>
              {t('assignVoiceButton')}
            </button>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-3)' }}>
            <input type="checkbox" name="consent" required style={{ marginTop: 2 }} />
            {t('consentVoiceLabel')}
          </label>
        </form>
        {profile?.heygenVoiceId ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 600 }}>{t('voiceAssigned')}</span>
            <code style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>{profile.heygenVoiceId}</code>
          </div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-3)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>{t('noVoiceAssigned')}</span>
          </div>
        )}
      </div>

      {/* Users */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>{tCampaignsTable('colUsers')}</h2>
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr><th>{tUsers('colName')}</th><th>{tUsers('colEmail')}</th><th>{tUsers('colRole')}</th><th>{tUsers('colActions')}</th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600, color: 'var(--text)' }}>{u.name}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {u.email ?? <span style={{ color: 'var(--bad)', fontSize: 11 }}>{tUsers('noEmail')}</span>}
                  </td>
                  <td>
                    <span className="tag"
                      style={u.role === 'owner' ? { color: 'var(--accent)', borderColor: 'rgba(249,115,22,0.28)', background: 'var(--accent-dim)' } : undefined}>
                      {tRoles(u.role)}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <form action={impersonateAction.bind(null, u.id)}>
                        <button className="admin-impersonate-btn" type="submit">{tUsers('signInAs')}</button>
                      </form>
                      <form action={removeUserAction.bind(null, u.id, campaign.id)}>
                        <button className="admin-delete-btn" type="submit">{tUsers('remove')}</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={3} className="muted" style={{ padding: 20 }}>{t('noUsersYet')}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add user */}
        <form action={addUserAction} style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div>
            <label className="field-label">{tUsers('colName')}</label>
            <input name="name" className="input" placeholder={t('addUserNamePlaceholder')} required style={{ width: 160 }} />
          </div>
          <div>
            <label className="field-label">{tUsers('colEmail')}</label>
            <input type="email" name="email" className="input" placeholder={t('addUserEmailPlaceholder')} required style={{ width: 200 }} />
          </div>
          <div>
            <label className="field-label">{tUsers('colRole')}</label>
            <select name="role" className="input" style={{ width: 130 }}>
              {ROLE_OPTS.map(r => <option key={r} value={r}>{tRoles(r)}</option>)}
            </select>
          </div>
          <button className="btn primary" style={{ fontSize: 13, marginBottom: 1 }}>{t('addAndInviteButton')}</button>
        </form>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {t('addUserHelperText')}
        </p>
      </div>

      {/* Content */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{tCampaignsTable('colContent')}</h2>
          <Link href={`/admin/content?campaign=${campaign.id}`} style={{ fontSize: 12, color: 'var(--text-3)', textDecoration: 'none' }}>
            {t('viewAllLink')}
          </Link>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>{tContent('colTitle')}</th><th>{tContent('colType')}</th><th>{tContent('colStatus')}</th></tr></thead>
            <tbody>
              {content.slice(0, 6).map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500, color: 'var(--text)' }}>{c.title}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{tType(c.type)}</td>
                  <td><StatusPill status={c.status} /></td>
                </tr>
              ))}
              {content.length === 0 && (
                <tr><td colSpan={3} className="muted" style={{ padding: 20 }}>{t('noContentYet')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite codes */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>{t('inviteLinksHeading')}</h2>
        <div className="card" style={{ padding: 0 }}>
          {invites.length > 0 ? (
            <table>
              <thead>
                <tr><th>{t('codeColumn')}</th><th>{tUsers('colRole')}</th><th>{t('expiresColumn')}</th><th>{tContent('colStatus')}</th><th>{t('linkColumn')}</th></tr>
              </thead>
              <tbody>
                {invites.map(inv => {
                  const expired = new Date(inv.expiresAt) < new Date();
                  const shareUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/join?code=${inv.code}`;
                  return (
                    <tr key={inv.code}>
                      <td className="mono" style={{ fontSize: 12 }}>{inv.code}</td>
                      <td><span className="tag">{tRoles(inv.role)}</span></td>
                      <td className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {new Date(inv.expiresAt).toLocaleDateString('en-US')}
                      </td>
                      <td>
                        {inv.usedAt ? (
                          <span className="tag cred-high"><span className="dot" />{t('inviteUsed')}</span>
                        ) : expired ? (
                          <span className="tag">{t('inviteExpired')}</span>
                        ) : (
                          <span className="tag trending"><span className="dot" />{t('inviteActive')}</span>
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
            <div style={{ padding: 20 }} className="muted">{t('emptyInvites')}</div>
          )}
        </div>

        <form action={generateInviteAction} style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'flex-end' }}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div>
            <label className="field-label">{tUsers('colRole')}</label>
            <select name="role" className="input" style={{ width: 140 }}>
              {ROLE_OPTS.map(r => <option key={r} value={r}>{tRoles(r)}</option>)}
            </select>
          </div>
          <button className="btn primary" style={{ fontSize: 13, marginBottom: 1 }}>
            {t('generateInviteButton')}
          </button>
        </form>
      </div>

      {/* Audit log */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{t('recentActivityHeading')}</h2>
          <Link href="/admin/audit" style={{ fontSize: 12, color: 'var(--text-3)', textDecoration: 'none' }}>
            {t('fullLogLink')}
          </Link>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>{t('timeColumn')}</th><th>{tAudit('colAction')}</th><th>{tAudit('colEntity')}</th></tr></thead>
            <tbody>
              {recentAudit.map(e => (
                <tr key={e.id}>
                  <td className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    {new Date(e.createdAt).toLocaleString('en-US')}
                  </td>
                  <td style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{e.action}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {e.entityType}{e.entityId ? ` · ${e.entityId}` : ''}
                  </td>
                </tr>
              ))}
              {recentAudit.length === 0 && (
                <tr><td colSpan={3} className="muted" style={{ padding: 20 }}>{t('noActivityYet')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
