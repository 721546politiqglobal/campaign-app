import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { AlertIcon, ErrorIcon, InfoIcon } from '@/components/icons';
import { requireSession } from '@/lib/session';
import {
  getCampaign, getBillingPlan, getContentUsageThisPeriod, getVideoUsageToday, getAvatarCount, getCampaignSeatUsage,
} from '@/lib/data';
import { can } from '@/lib/permissions';
import { INACTIVE_STATUSES } from '@/domain/billing';
import { BillingPortalForm } from './BillingPortalForm';

const STATUS: Record<string, { labelKey: string; tone: BadgeTone }> = {
  active:             { labelKey: 'status.active',            tone: 'ok' },
  trialing:           { labelKey: 'status.trialing',          tone: 'info' },
  incomplete:         { labelKey: 'status.incomplete',        tone: 'warn' },
  past_due:           { labelKey: 'status.pastDue',           tone: 'warn' },
  canceled:           { labelKey: 'status.canceled',          tone: 'bad' },
  unpaid:             { labelKey: 'status.unpaid',            tone: 'bad' },
  incomplete_expired: { labelKey: 'status.incompleteExpired', tone: 'bad' },
  paused:             { labelKey: 'status.paused',            tone: 'neutral' },
};

function Meter({ label, used, limit, valueText }: { label: string; used: number; limit: number | null; valueText: string }) {
  const pct = limit ? Math.min(Math.round((used / limit) * 100), 100) : 0;
  const over = limit !== null && used >= limit;
  return (
    <div className={over ? 'billing-meter over' : 'billing-meter'}>
      <div className="billing-meter-head">
        <span className="muted">{label}</span>
        <span className="billing-meter-value num">{valueText}</span>
      </div>
      {limit !== null && (
        <div
          className="billing-meter-bar"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-valuetext={valueText}
        >
          {/* The fill width is the one genuinely dynamic value on this page. */}
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export default async function Billing() {
  const t = await getTranslations('billing');
  const format = await getFormatter();
  const s = await requireSession();
  const campaign = await getCampaign(s.campaignId);
  const plan = campaign?.planId ? await getBillingPlan(campaign.planId) : null;
  const [contentUsed, videoUsed, avatarCount, seats] = await Promise.all([
    getContentUsageThisPeriod(s.campaignId, campaign?.currentPeriodEnd ?? null),
    getVideoUsageToday(s.campaignId),
    getAvatarCount(s.campaignId),
    getCampaignSeatUsage(s.campaignId),
  ]);
  const canEdit = can(s.role, 'edit_settings');

  const status = campaign?.subscriptionStatus ?? null;
  const statusInfo = status ? STATUS[status] : null;
  const unlimited = t('unlimited');
  const meterValueText = (used: number, limit: number | null) => t('usedOfLimit', { used, limit: limit ?? unlimited });
  const fmtDate = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long' });

  const price = plan ? format.number(plan.monthlyPriceCents / 100, { style: 'currency', currency: 'USD' }) : null;
  const interval = plan?.billingInterval === 'week' ? t('perWeekLong') : t('perMonthLong');
  const renewsOn = campaign?.currentPeriodEnd && (status === 'active' || status === 'trialing')
    ? fmtDate(campaign.currentPeriodEnd)
    : null;
  const hasPortal = canEdit && !!campaign?.stripeCustomerId;

  return (
    <AppFrame>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={canEdit && plan ? <Link href="/pricing" className="btn">{t('changePlan')}</Link> : undefined}
      />

      <div className="stack">
        {!canEdit && (
          <div className="alert alert-info">
            <InfoIcon size={16} />
            <div className="alert-body">
              <div className="alert-title">{t('readOnly.title')}</div>
              <div className="alert-text">{t('readOnly.body')}</div>
            </div>
          </div>
        )}

        {status === 'past_due' && (
          <div className="alert alert-warn" role="alert">
            <AlertIcon size={16} />
            <div className="alert-body">
              <div className="alert-title">{t('pastDueTitle')}</div>
              <div className="alert-text">
                {campaign?.gracePeriodEndsAt
                  ? t('pastDueWithDate', { date: fmtDate(campaign.gracePeriodEndsAt) })
                  : t('pastDueGeneric')}
              </div>
            </div>
          </div>
        )}
        {status && INACTIVE_STATUSES.has(status) && (
          <div className="alert alert-bad" role="alert">
            <ErrorIcon size={16} />
            <div className="alert-body">
              <div className="alert-title">{t('inactiveTitle')}</div>
              <div className="alert-text">{t('inactiveBody')}</div>
            </div>
          </div>
        )}

        <section className="card card-sectioned" aria-labelledby="billing-plan-heading">
          <div className="card-body billing-plan">
            <div className="billing-plan-main">
              <span className="eyebrow">{t('campaignSubscription')}</span>
              <div className="billing-plan-title">
                <h2 id="billing-plan-heading">{plan ? plan.name : t('noPlan')}</h2>
                {statusInfo && <Badge tone={statusInfo.tone} dot>{t(statusInfo.labelKey)}</Badge>}
              </div>
              {plan
                ? <p className="billing-price"><strong className="num">{price}</strong> {interval}</p>
                : <p className="billing-price muted">{t('noPlanBody')}</p>}
              {renewsOn && <p className="billing-meta">{t('renewsOn', { date: renewsOn })}</p>}
            </div>
            {canEdit && (
              <div className="billing-actions">
                {!plan && <Link href="/pricing" className="btn btn-primary">{t('choosePlan')}</Link>}
                {hasPortal
                  ? <BillingPortalForm />
                  : plan && <span className="subtle text-xs">{t('noBillingAccountHint')}</span>}
              </div>
            )}
          </div>
          {hasPortal && (
            <div className="card-footer billing-footer">
              <span className="subtle text-xs">{t('manageBillingHint')}</span>
            </div>
          )}
        </section>

        <section className="card card-sectioned" aria-labelledby="billing-usage-heading">
          <div className="card-header">
            <div className="card-header-text">
              <h2 id="billing-usage-heading">{t('usageHeading')}</h2>
              <span className="card-header-desc">{t('usageDescription')}</span>
            </div>
            <div className="card-header-actions">
              <Link href="/team" className="btn btn-ghost btn-sm">{t('manageTeam')}</Link>
            </div>
          </div>
          <div className="card-body billing-meters">
            <Meter label={t('contentPiecesThisPeriod')} used={contentUsed} limit={plan?.contentLimitMonthly ?? null} valueText={meterValueText(contentUsed, plan?.contentLimitMonthly ?? null)} />
            <Meter label={t('videosToday')} used={videoUsed} limit={plan?.videoLimitDaily ?? null} valueText={meterValueText(videoUsed, plan?.videoLimitDaily ?? null)} />
            <Meter label={t('avatarsLabel')} used={avatarCount} limit={plan?.avatarLimit ?? null} valueText={meterValueText(avatarCount, plan?.avatarLimit ?? null)} />
            <Meter label={t('seatsLabel')} used={seats.used} limit={seats.limit} valueText={meterValueText(seats.used, seats.limit)} />
          </div>
        </section>
      </div>
    </AppFrame>
  );
}
