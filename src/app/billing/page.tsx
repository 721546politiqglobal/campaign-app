import { getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { requireSession } from '@/lib/session';
import { getCampaign, getBillingPlan, getContentUsageThisPeriod, getVideoUsageToday, getAvatarCount } from '@/lib/data';
import { openMyBillingPortalAction } from '@/app/actions';
import { can } from '@/lib/permissions';
import { formatDate } from '@/lib/formatDate';
import { INACTIVE_STATUSES } from '@/domain/billing';
import Link from 'next/link';

const STATUS_TONE: Record<string, { labelKey: string; color: string; bg: string; border: string }> = {
  active:              { labelKey: 'status.active',             color: 'var(--ok)',     bg: 'var(--ok-dim)',     border: 'var(--ok-border)' },
  trialing:            { labelKey: 'status.trialing',           color: 'var(--info)',   bg: 'var(--info-dim)',   border: 'var(--info-border)' },
  incomplete:          { labelKey: 'status.incomplete',         color: 'var(--warn)',   bg: 'var(--warn-dim)',   border: 'var(--warn-border)' },
  past_due:            { labelKey: 'status.pastDue',            color: 'var(--warn)',   bg: 'var(--warn-dim)',   border: 'var(--warn-border)' },
  canceled:            { labelKey: 'status.canceled',           color: 'var(--bad)',    bg: 'var(--bad-dim)',    border: 'var(--bad-border)' },
  unpaid:              { labelKey: 'status.unpaid',             color: 'var(--bad)',    bg: 'var(--bad-dim)',    border: 'var(--bad-border)' },
  incomplete_expired:  { labelKey: 'status.incompleteExpired',  color: 'var(--bad)',    bg: 'var(--bad-dim)',    border: 'var(--bad-border)' },
  paused:              { labelKey: 'status.paused',             color: 'var(--text-2)', bg: 'rgba(120,110,98,0.14)', border: 'rgba(255,255,255,0.08)' },
};

const usd = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function Meter({ label, used, limit, valueText }: { label: string; used: number; limit: number | null; valueText: string }) {
  const pct = limit ? Math.min((used / limit) * 100, 100) : 0;
  const over = limit !== null && used >= limit;
  return (
    <div style={{ padding: '16px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
        <span className="muted">{label}</span>
        <span className="data" style={{ color: over ? 'var(--warn)' : 'var(--text)' }}>
          {valueText}
        </span>
      </div>
      {limit !== null && (
        <div style={{ height: 6, background: 'var(--bg-hover)', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, borderRadius: 999, background: over ? 'var(--warn)' : 'var(--accent-grad)' }} />
        </div>
      )}
    </div>
  );
}

export default async function Billing() {
  const t = await getTranslations('billing');
  const s = await requireSession();
  const campaign = await getCampaign(s.campaignId);
  const plan = campaign?.planId ? await getBillingPlan(campaign.planId) : null;
  const [contentUsed, videoUsed, avatarCount] = await Promise.all([
    getContentUsageThisPeriod(s.campaignId, campaign?.currentPeriodEnd ?? null),
    getVideoUsageToday(s.campaignId),
    getAvatarCount(s.campaignId),
  ]);
  const canEdit = can(s.role, 'edit_settings');

  const status = campaign?.subscriptionStatus ?? null;
  const tone = status ? STATUS_TONE[status] : null;
  const unlimited = t('unlimited');

  const meterValueText = (used: number, limit: number | null) =>
    t('usedOfLimit', { used, limit: limit ?? unlimited });

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">{t('eyebrow')}</span><h1>{t('title')}</h1></div>
      </div>

      {status === 'past_due' && (
        <div className="banner warn" style={{ marginBottom: 14 }}>
          <div>
            <div className="t">{t('pastDueTitle')}</div>
            <div className="b">
              {campaign?.gracePeriodEndsAt
                ? t('pastDueWithDate', { date: formatDate(campaign.gracePeriodEndsAt, 'date') })
                : t('pastDueGeneric')}
            </div>
          </div>
        </div>
      )}
      {status && INACTIVE_STATUSES.has(status) && (
        <div className="banner warn" style={{ marginBottom: 14 }}>
          <div>
            <div className="t">{t('inactiveTitle')}</div>
            <div className="b">{t('inactiveBody')}</div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '22px 24px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em' }}>{plan ? plan.name : t('noPlan')}</span>
              {tone && (
                <span className="mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 9px', borderRadius: 999, color: tone.color, background: tone.bg, border: `1px solid ${tone.border}` }}>{t(tone.labelKey)}</span>
              )}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {plan ? <>{t('campaignSubscription')} · <span className="data" style={{ color: 'var(--text)' }}>{usd(plan.monthlyPriceCents)}</span>/{plan.billingInterval === 'week' ? t('perWeek') : t('perMonth')}</> : t('noPlanAssigned')}
            </div>
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 10 }}>
              <Link href="/pricing" className="btn">{t('changePlan')}</Link>
              {campaign?.stripeCustomerId && (
                <form action={openMyBillingPortalAction}>
                  <button className="btn primary" type="submit">{t('manageBilling')}</button>
                </form>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '6px 24px 22px' }}>
          <Meter label={t('contentPiecesThisPeriod')} used={contentUsed} limit={plan?.contentLimitMonthly ?? null} valueText={meterValueText(contentUsed, plan?.contentLimitMonthly ?? null)} />
          <Meter label={t('videosToday')} used={videoUsed} limit={plan?.videoLimitDaily ?? null} valueText={meterValueText(videoUsed, plan?.videoLimitDaily ?? null)} />
          <Meter label={t('avatarsLabel')} used={avatarCount} limit={plan?.avatarLimit ?? null} valueText={meterValueText(avatarCount, plan?.avatarLimit ?? null)} />
        </div>
      </div>
    </AppFrame>
  );
}
